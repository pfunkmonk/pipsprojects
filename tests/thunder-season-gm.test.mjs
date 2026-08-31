import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FBG_NATIVE_WEEKLY_COLUMNS, parseFbgNativeWeeklyCsv, parseFbgWeeklyCsv } from "../netlify/functions/_lib/fbg-season-source.mjs";
import { leagueStateFromFinalLedger } from "../netlify/functions/_lib/cbs-season-source.mjs";
import { buildSeasonSetupSnapshot } from "../netlify/functions/_lib/season-service.mjs";
import { readSeasonPack } from "../netlify/functions/_lib/season-pack.mjs";
import {
  buildInjuryWatch,
  buildSeasonRecommendationSnapshot,
  optimizeExactLineup,
  recommendWaivers,
} from "../netlify/functions/_lib/season-recommendations.mjs";
import { diffLeagueOwnership } from "../netlify/functions/_lib/season-store.mjs";
import { isDenverTuesdayRefresh, seasonIdempotencyKey, seasonWeekForDate } from "../netlify/functions/_lib/season-time.mjs";

const projectionSources = ["Footballguys", "CBS", "FantasyPros", "PFF"];

function player(id, position, points, overrides = {}) {
  const weekly = Array.from({ length: 18 }, (_, index) => index === 5 ? null : points + (index % 3) * 0.2);
  const seasonTotal = weekly.filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  return {
    id,
    name: overrides.name || id.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    position,
    nflTeam: overrides.nflTeam || "DEN",
    weeklyProjection: { points: weekly, byeWeek: 6, asOf: "2026-09-08T11:00:00.000Z" },
    projectedPoints: seasonTotal,
    projectionSources: projectionSources.map((source, index) => ({ source, points: seasonTotal + index, asOf: "2026-09-08T11:00:00.000Z" })),
    vbd: overrides.vbd ?? points * 3,
    marketValue: overrides.marketValue ?? points,
  };
}

function rosterPlayers() {
  return [
    player("qb-one", "QB", 20), player("qb-two", "QB", 14),
    player("rb-one", "RB", 16), player("rb-two", "RB", 14), player("rb-three", "RB", 9), player("rb-four", "RB", 7),
    player("wr-one", "WR", 17), player("wr-two", "WR", 15), player("wr-three", "WR", 10), player("wr-four", "WR", 8),
    player("te-one", "TE", 11), player("te-two", "TE", 6),
    player("k-one", "K", 8), player("dst-one", "DST", 7),
  ];
}

function rosterRows(players) {
  return players.map((item, index) => ({ playerId: item.id, salary: index + 1, contractYear: 1, opponent: null, gameTime: null, bye: item.weeklyProjection.byeWeek }));
}

test("America/Denver Tuesday scheduling handles both daylight and standard time", () => {
  assert.equal(isDenverTuesdayRefresh("2026-09-08T12:05:00.000Z"), true);
  assert.equal(isDenverTuesdayRefresh("2026-11-03T13:05:00.000Z"), true);
  assert.equal(isDenverTuesdayRefresh("2026-11-03T12:05:00.000Z"), false);
  assert.equal(seasonWeekForDate("2026-09-08T12:05:00.000Z"), 1);
  assert.equal(seasonWeekForDate("2026-09-29T12:05:00.000Z"), 4);
  assert.equal(seasonIdempotencyKey({ date: "2026-09-29T12:05:00.000Z", source: "Tuesday plan" }), "2026/week-4/tuesday-plan/v1");
});

test("an incomplete auction ledger returns a safe authenticated setup state instead of trapping login", () => {
  const pack = { season: 2026, packId: "test-pack", players: [] };
  assert.throws(
    () => leagueStateFromFinalLedger({ ledger: { document: { events: [], generation: 3, updatedAt: "2026-08-30T12:00:00.000Z" } }, pack }),
    (error) => error.code === "SEASON_BASELINE_UNAVAILABLE" && /12 legal rosters/.test(error.message),
  );
  const setup = buildSeasonSetupSnapshot({ pack, now: "2026-08-30T12:00:00.000Z" });
  assert.equal(setup.kind, "thunder-bowl-season-setup-required");
  assert.equal(setup.requiresLeagueSync, true);
  assert.equal(setup.lineup.starters.length, 0);
  assert.match(setup.waivers.blockedReason, /Update everything/);
  assert.match(setup.sourceFingerprint, /^[a-f0-9]{64}$/);
});

test("the protected season pack loads from both source and flattened Netlify bundle layouts", async () => {
  const pack = await readSeasonPack();
  assert.equal(pack.season, 2026);
  assert.ok(pack.players.length >= 650);
  const source = await readFile(new URL("../netlify/functions/_lib/season-pack.mjs", import.meta.url), "utf8");
  assert.match(source, /new URL\("\.\/_data\/draft-pack-2026-provisional\.json"/);
  assert.match(source, /new URL\("\.\.\/_data\/draft-pack-2026-provisional\.json"/);
});

test("Footballguys weekly CSV is strict, traceable, and never turns missing into zero", () => {
  const pack = { season: 2026, players: [player("qb-one", "QB", 20)] };
  const header = "player_id,player_name,nfl_team,position,week,projected_points,floor,ceiling,provider_as_of";
  const csv = `${header}\nqb-one,Qb One,DEN,QB,1,22.4,18.0,28.0,${new Date().toISOString()}\n`;
  const snapshot = parseFbgWeeklyCsv(csv, pack, { minimumRows: 1 });
  assert.equal(snapshot.week, 1);
  assert.equal(snapshot.items[0].points, 22.4);
  assert.match(snapshot.rawSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => parseFbgWeeklyCsv(csv.replace(",22.4,", ",,"), pack, { minimumRows: 1 }), /missing projected points/);
  assert.throws(() => parseFbgWeeklyCsv(csv.replace("player_id", "id"), pack, { minimumRows: 1 }), /headers must be exactly/);
  assert.throws(() => parseFbgWeeklyCsv(csv.replace(/\d{4}-\d{2}-\d{2}T[^,\r\n]+/, "2099-01-01T00:00:00.000Z"), pack, { minimumRows: 1 }), /invalid provider timestamp/);
});

test("official Footballguys weekly downloads use consensus stat lines and exact Thunder Bowl scoring", () => {
  const pack = { season: 2026, players: [player("fbg:GibbJa00", "RB", 20, { name: "Jahmyr Gibbs", nflTeam: "DET" })] };
  const values = Object.fromEntries(FBG_NATIVE_WEEKLY_COLUMNS.map((column) => [column, "0"]));
  Object.assign(values, {
    id: "GibbJa00", name: "Jahmyr Gibbs", pos: "rb", team: "DET", "set-id": "1", "set-userid": "0", "set-name": "Projections Consensus",
    "rush-2pt": "1", "rush-yds": "80", "rush-td": "1", "rec-rec": "4", "rec-yds": "40", "fum-lost": "0.5",
  });
  const zeroDuplicate = { ...values, "set-id": "2", "rush-2pt": "0", "rush-yds": "0", "rush-td": "0", "rec-rec": "0", "rec-yds": "0", "fum-lost": "0" };
  const csv = `${FBG_NATIVE_WEEKLY_COLUMNS.join(",")}\n${FBG_NATIVE_WEEKLY_COLUMNS.map((column) => zeroDuplicate[column]).join(",")}\n${FBG_NATIVE_WEEKLY_COLUMNS.map((column) => values[column]).join(",")}\n`;
  const snapshot = parseFbgNativeWeeklyCsv(csv, pack, { week: 1, providerAsOf: "2026-08-30T16:00:00.000Z", minimumRows: 1 });
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].points, 23);
  assert.equal(snapshot.items[0].projectedStats.rushingYards, 80);
  assert.equal(snapshot.items[0].projectedStats.receptions, 4);
  assert.equal(snapshot.items[0].projectedStats.fumblesLost, 0.5);
  assert.equal(snapshot.items[0].projectedStats.rushingTwoPointConversions, 1);
  assert.equal(snapshot.source, "Footballguys official weekly projections download");
  assert.equal(snapshot.consensusRowCount, 2);
});

test("official kicker conversions and DST points-allowed columns map without turning a bye into ten points", () => {
  const pack = { season: 2026, players: [
    player("fbg:AubrBr00", "K", 8, { name: "Brandon Aubrey", nflTeam: "DAL" }),
    player("fbg:pitxxx99", "DST", 8, { name: "Pittsburgh Steelers", nflTeam: "PIT" }),
    player("fbg:denxxx99", "DST", 8, { name: "Denver Broncos", nflTeam: "DEN" }),
  ] };
  const row = (overrides) => ({
    ...Object.fromEntries(FBG_NATIVE_WEEKLY_COLUMNS.map((column) => [column, "0"])),
    "set-name": "Projections Consensus",
    ...overrides,
  });
  const rows = [
    row({ id: "AubrBr00", name: "Brandon Aubrey", pos: "pk", team: "DAL", "kck-xpc": "2", "kck-fgc": "1.5" }),
    row({ id: "pitxxx99", name: "Pittsburgh Steelers", pos: "td", team: "PIT", "tmd-sck": "2", "tmd-int": "0.8", "tmd-fmr": "0.8", "tmd-td": "0.5", "tmd-saf": "0.04", "tmd-pa": "20", "tmd-ya": "333" }),
    row({ id: "denxxx99", name: "Denver Broncos", pos: "td", team: "DEN" }),
  ];
  const csv = `${FBG_NATIVE_WEEKLY_COLUMNS.join(",")}\n${rows.map((values) => FBG_NATIVE_WEEKLY_COLUMNS.map((column) => values[column]).join(",")).join("\n")}\n`;
  const snapshot = parseFbgNativeWeeklyCsv(csv, pack, { week: 1, providerAsOf: "2026-08-30T16:00:00.000Z", minimumRows: 3 });
  const points = new Map(snapshot.items.map((item) => [item.playerId, item.points]));
  assert.equal(points.get("fbg:AubrBr00"), 6.5);
  assert.equal(points.get("fbg:pitxxx99"), 14.28);
  assert.equal(points.get("fbg:denxxx99"), 0);
});

test("exact optimizer fills 1 QB, 2 RB, 2 WR, 1 TE, 1 K, and 1 DST without bench scoring", () => {
  const players = rosterPlayers();
  const result = optimizeExactLineup(rosterRows(players), { week: 1, playerById: new Map(players.map((item) => [item.id, item])) });
  assert.equal(result.starters.length, 8);
  assert.deepEqual(Object.fromEntries(["QB", "RB", "WR", "TE", "K", "DST"].map((position) => [position, result.starters.filter((row) => row.player.position === position).length])), { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 });
  assert.equal(result.bench.length, 6);
  assert.equal(result.missingSlots.length, 0);
  assert.equal(result.total, 108.8);
  assert.ok(result.total < [...result.starters, ...result.bench].reduce((sum, row) => sum + (row.projection.points || 0), 0));
});

test("an owner weekly FBG row can supply the current week when the dated baseline is missing", () => {
  const players = rosterPlayers();
  players[0].weeklyProjection.points[0] = null;
  const fbgRows = new Map([["qb-one|1", { playerId: "qb-one", week: 1, points: 25, floor: 19, ceiling: 31, providerAsOf: "2026-09-08T11:00:00.000Z" }]]);
  const result = optimizeExactLineup(rosterRows(players), { week: 1, playerById: new Map(players.map((item) => [item.id, item])), fbgRows });
  assert.equal(result.starters.find((row) => row.playerId === "qb-one").projection.points, 25);
});

test("waiver recommendations remain blocked until CBS supplies authenticated availability", () => {
  const players = rosterPlayers();
  const result = recommendWaivers({
    pack: { players },
    leagueState: { authority: "week-one roster baseline only; not current CBS availability", teams: [{ teamId: "dogs-of-war", roster: rosterRows(players) }], availablePlayerIds: null },
    week: 1,
  });
  assert.equal(result.recommendations.length, 0);
  assert.match(result.blockedReason, /Sync private CBS/);
});

test("partial authenticated auction captures update safely without confirming free agents", () => {
  const roster = rosterPlayers();
  const freeAgent = player("rb-undrafted", "RB", 18, { vbd: 80, marketValue: 30 });
  const leagueState = {
    authority: "authenticated league roster and availability authority",
    capturedAt: "2026-08-31T14:00:00.000Z",
    rostersComplete: false,
    completeTeamCount: 3,
    teamCount: 12,
    teams: [{ teamId: "dogs-of-war", roster: rosterRows(roster) }],
    availablePlayerIds: [freeAgent.id],
  };
  const result = recommendWaivers({ pack: { players: [...roster, freeAgent] }, leagueState, week: 1 });
  assert.equal(result.recommendations.length, 0);
  assert.match(result.blockedReason, /legal 8–14 player roster/);
  assert.match(result.blockedReason, /3 of 12 teams/);
});

test("waiver recommendations use only CBS-available adds and pair every add with a legal roster drop", () => {
  const roster = rosterPlayers();
  const freeAgent = player("rb-upgrade", "RB", 18, { vbd: 80, marketValue: 30 });
  const result = recommendWaivers({
    pack: { players: [...roster, freeAgent] },
    leagueState: {
      authority: "authenticated league roster and availability authority",
      capturedAt: "2026-09-08T12:00:00.000Z",
      teams: [{ teamId: "dogs-of-war", roster: rosterRows(roster) }],
      availablePlayerIds: [freeAgent.id],
    },
    week: 1,
  });
  assert.ok(result.recommendations.length >= 1);
  assert.equal(result.recommendations[0].add.playerId, freeAgent.id);
  assert.ok(roster.some((item) => item.id === result.recommendations[0].drop.playerId));
  assert.match(result.recommendations[0].availability.source, /CBS/);
});

test("CBS snapshot diffs distinguish pickups, drops, and owner changes without inferring transaction type", () => {
  const pack = { players: [player("one", "RB", 10), player("two", "WR", 10), player("three", "TE", 10)] };
  const previous = { rawSha256: "a", teams: [{ teamId: "a", teamName: "A", roster: [{ playerId: "one" }, { playerId: "two" }] }] };
  const current = { rawSha256: "b", capturedAt: "2026-09-09T12:00:00.000Z", teams: [{ teamId: "b", teamName: "B", roster: [{ playerId: "one" }, { playerId: "three" }] }] };
  const moves = diffLeagueOwnership(previous, current, pack);
  assert.deepEqual(moves.map((move) => move.type).sort(), ["DROP", "OWNER CHANGE", "PICKUP"]);
  assert.ok(moves.every((move) => /not inferred/.test(move.evidence)));
});

test("IR watch reports only evidence-backed reserve statuses and does not invent return dates", () => {
  const target = player("ir-star", "RB", 15, { marketValue: 35, vbd: 50 });
  const leagueState = { teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster: [] }], availablePlayerIds: [target.id] };
  const statusSnapshot = { capturedAt: "2026-09-09T12:00:00.000Z", updates: [{ playerId: target.id, severity: "critical", status: "Injured Reserve", injuryStatus: "IR", practiceParticipation: "", newsUpdated: "2026-09-09T11:00:00.000Z" }] };
  const result = buildInjuryWatch({ pack: { players: [target] }, leagueState, week: 1, statusSnapshot });
  assert.equal(result.irTargets.length, 1);
  assert.equal(result.irTargets[0].action, "STASH WATCH");
  assert.match(result.irTargets[0].returnOutlook, /not inferred/);
  assert.equal(result.irTargets[0].keeperUpside, "HIGH");
});

test("combined plans are deterministic for identical sources and disclose baseline limits", () => {
  const players = rosterPlayers();
  const pack = { season: 2026, packId: "test-pack", asOf: "2026-09-08T11:00:00.000Z", players, sources: [], weeklyContext: { asOf: "2026-09-08T11:00:00.000Z" } };
  const leagueState = { source: "final ledger", authority: "week-one roster baseline only; not current CBS availability", capturedAt: "2026-08-30T12:00:00.000Z", teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(players) }], availablePlayerIds: null };
  const input = { pack, leagueState, week: 1, generatedAt: "2026-09-08T12:00:00.000Z" };
  const left = buildSeasonRecommendationSnapshot(input);
  const right = buildSeasonRecommendationSnapshot(input);
  assert.deepEqual(left, right);
  assert.equal(left.lineup.legal, true);
  assert.equal(left.waivers.recommendations.length, 0);
  assert.ok(left.alerts.some((message) => message.includes("CBS league data has not been synced")));
});

test("private season shell exposes the complete weekly workflow without unsafe HTML rendering", async () => {
  const [html, source, css, worker, netlify] = await Promise.all([
    readFile(new URL("../public/thunder-bowl/season/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/season.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/season.css", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
  ]);
  for (const id of ["refresh-plan", "helper-setup", "helper-download", "fbg-file", "starter-rows", "waiver-list", "trade-list", "move-list", "injury-list", "ir-list", "evidence-dialog"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, />Update everything</);
  assert.match(html, /Advanced recovery tools/);
  assert.match(source, /action: "capture-cbs"/);
  assert.match(source, /action: "refresh-fbg"/);
  assert.match(source, /action: "refresh-news"/);
  assert.match(source, /snapshot, fbgSnapshot/);
  assert.match(source, /CBS was saved successfully/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /thunder-bowl-season-setup-required/);
  assert.match(source, /Too many recent access checks/);
  assert.match(html, /maxlength="100"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /clientX < rect\.left/);
  assert.match(css, /@media \(max-width:620px\)/);
  assert.match(worker, /\/thunder-bowl\/season\/index\.html/);
  assert.match(worker, /thunder-bowl-shell-v135/);
  assert.match(worker, /client\.navigate\(client\.url\)/);
  assert.match(worker, /season\.mjs\?v=20260831h/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(netlify, /from = "\/api\/thunder-bowl\/season\/snapshot"/);
  assert.match(netlify, /from = "\/api\/thunder-bowl\/season\/refresh"/);
});

test("scheduled and persistence source preserve write-once Tuesday archives and separate live pointers", async () => {
  const [storeSource, tuesdaySource, serviceSource, refreshSource] = await Promise.all([
    readFile(new URL("../netlify/functions/_lib/season-store.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/thunder-season-tuesday-collector.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_lib/season-service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/thunder-season-refresh.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(storeSource, /`\$\{prefix\}\/tuesday`, plan, \{ onlyIfNew: true \}/);
  assert.match(storeSource, /setJSON\("plans\/v1\/latest", plan\)/);
  assert.match(storeSource, /sources\/cbs\/v1\/raw\/\$\{canonical\.rawSha256\}/);
  assert.match(tuesdaySource, /isDenverTuesdayRefresh\(now\)/);
  assert.match(tuesdaySource, /refreshFootballguys: true/);
  assert.match(tuesdaySource, /schedule: "0,10 12,13 \* \* 2"/);
  assert.match(serviceSource, /archiveTuesday && fbgRefreshError/);
  assert.match(refreshSource, /refreshSeasonPlan\(\{ forcePublic: true, refreshFootballguys: true \}\)/);
});

test("a legal authenticated roster remains PARTIAL until current-week CBS component stats are captured", () => {
  const players = rosterPlayers();
  const pack = { season: 2026, packId: "test-pack", asOf: "2026-09-08T11:00:00.000Z", players, sources: [], weeklyContext: { asOf: "2026-09-08T11:00:00.000Z" } };
  const leagueState = {
    source: "CBS",
    authority: "authenticated league roster and availability authority",
    capturedAt: "2026-09-08T11:30:00.000Z",
    rostersReady: true,
    legalTeamCount: 12,
    teamCount: 12,
    teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(players) }],
    availablePlayerIds: [],
    projectionWeek: null,
    projectionCount: 0,
    weeklyProjections: [],
  };
  const result = buildSeasonRecommendationSnapshot({ pack, leagueState, week: 1, generatedAt: "2026-09-08T12:00:00.000Z" });
  assert.equal(result.state, "PARTIAL");
  assert.equal(result.sources.find((source) => source.label === "CBS stats").asOf, null);
  assert.ok(result.alerts.some((message) => message.includes("CBS Week 1 component-stat projections")));
});
