import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FBG_NATIVE_WEEKLY_COLUMNS, parseFbgAuthenticatedWeeklyCapture, parseFbgNativeWeeklyCsv, parseFbgWeeklyCsv } from "../netlify/functions/_lib/fbg-season-source.mjs";
import { buildSeasonSetupSnapshot } from "../netlify/functions/_lib/season-service.mjs";
import { readSeasonPack } from "../netlify/functions/_lib/season-pack.mjs";
import {
  buildInjuryWatch,
  buildSeasonRecommendationSnapshot,
  optimizeExactLineup,
  recommendTrades,
  recommendWaivers,
  simulateFabTieClaims,
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

function fabState({ dogsBudget = 50, dogsOrder = 4, dogsPickups = 0 } = {}) {
  const catalog = ["angry-face", "orange-crush", "big-head", "dogs-of-war", "t-dogs", "super-suckers", "three-amigos", "goon-skwad", "el-guapo", "crime-and-punishment", "the-hobbits", "the-bungles"];
  return {
    schemaVersion: 1,
    status: "COMPLETE",
    capturedAt: "2026-09-08T12:00:00.000Z",
    coverage: { pickupEvidence: "CURRENT_WEEK" },
    rules: { processingNights: ["TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"], typicalProcessingWindow: "1–4 a.m. ET the following morning" },
    teams: catalog.map((teamId, index) => ({
      teamId,
      remainingBudget: teamId === "dogs-of-war" ? dogsBudget : 50,
      fabOrder: teamId === "dogs-of-war" ? dogsOrder : index + 1 === dogsOrder ? 12 : index + 1,
      record: { wins: 0, losses: 0, ties: 0 },
      weeklySuccessfulPickups: teamId === "dogs-of-war" ? dogsPickups : 0,
    })),
  };
}

test("America/Denver Tuesday scheduling handles both daylight and standard time", () => {
  assert.equal(isDenverTuesdayRefresh("2026-09-08T12:05:00.000Z"), true);
  assert.equal(isDenverTuesdayRefresh("2026-11-03T13:05:00.000Z"), true);
  assert.equal(isDenverTuesdayRefresh("2026-11-03T12:05:00.000Z"), false);
  assert.equal(seasonWeekForDate("2026-09-08T12:05:00.000Z"), 1);
  assert.equal(seasonWeekForDate("2026-09-29T12:05:00.000Z"), 4);
  assert.equal(seasonIdempotencyKey({ date: "2026-09-29T12:05:00.000Z", source: "Tuesday plan" }), "2026/week-4/tuesday-plan/v1");
});

test("a missing CBS baseline returns a safe setup state without consulting the auction system", async () => {
  const pack = { season: 2026, packId: "test-pack", players: [] };
  const serviceSource = await readFile(new URL("../netlify/functions/_lib/season-service.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(serviceSource, /ledger-store|leagueStateFromFinalLedger|readLedger/);
  const setup = buildSeasonSetupSnapshot({ pack, now: "2026-08-30T12:00:00.000Z" });
  assert.equal(setup.kind, "thunder-bowl-season-setup-required");
  assert.equal(setup.requiresLeagueSync, true);
  assert.equal(setup.lineup.starters.length, 0);
  assert.match(setup.waivers.blockedReason, /Update everything/);
  assert.match(setup.sourceFingerprint, /^[a-f0-9]{64}$/);
});

test("the protected season player catalog loads directly without the auction release workflow", async () => {
  const pack = await readSeasonPack();
  assert.equal(pack.season, 2026);
  assert.ok(pack.players.length >= 650);
  const source = await readFile(new URL("../netlify/functions/_lib/season-pack.mjs", import.meta.url), "utf8");
  assert.match(source, /new URL\("\.\/_data\/draft-pack-2026-provisional\.json"/);
  assert.match(source, /new URL\("\.\.\/_data\/draft-pack-2026-provisional\.json"/);
  assert.doesNotMatch(source, /pack-release-store|readDraftPackRelease|releasedPackText/);
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

test("authenticated Footballguys PRO captures require the Thunder Bowl account view and preserve raw-stat authority", async () => {
  const fullPack = await readSeasonPack();
  const supported = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);
  const selected = fullPack.players.filter((item) => item.id.startsWith("fbg:") && supported.has(item.position)).slice(0, 200);
  assert.equal(selected.length, 200);
  const position = { QB: "qb", RB: "rb", WR: "wr", TE: "te", K: "pk", DST: "td" };
  const cell = (value) => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
  const rows = selected.map((item) => {
    const values = Object.fromEntries(FBG_NATIVE_WEEKLY_COLUMNS.map((column) => [column, "0"]));
    Object.assign(values, { id: item.id.slice(4), name: item.name, pos: position[item.position], team: item.nflTeam, "set-id": "1", "set-userid": "123", "set-name": "Projections Consensus", "rush-yds": item.position === "RB" ? "40" : "0" });
    return FBG_NATIVE_WEEKLY_COLUMNS.map((column) => cell(values[column])).join(",");
  });
  const capture = {
    schemaVersion: 1,
    source: "Footballguys authenticated weekly projections download",
    modelEffect: "none",
    authenticated: true,
    accountLeague: "Thunder Bowl",
    capturedAt: "2026-08-31T18:00:00.000Z",
    providerAsOf: "2026-08-31T17:59:00.000Z",
    season: 2026,
    week: 1,
    pageUrl: "https://www.footballguys.com/projections/duration/weekly?week=1&pos=qb",
    downloadUrl: "https://www.footballguys.com/projections/download/weekly/all/2026/1",
    csv: `${FBG_NATIVE_WEEKLY_COLUMNS.join(",")}\n${rows.join("\n")}\n`,
  };
  const snapshot = parseFbgAuthenticatedWeeklyCapture(capture, fullPack);
  assert.equal(snapshot.itemCount, 200);
  assert.equal(snapshot.accountLeague, "Thunder Bowl");
  assert.match(snapshot.authority, /authenticated Footballguys PRO browser-session capture/);
  assert.ok(snapshot.items.some((item) => item.projectedStats.rushingYards === 40));
  assert.throws(() => parseFbgAuthenticatedWeeklyCapture({ ...capture, accountLeague: "Default" }, fullPack), /signed-in Thunder Bowl subscriber view/);
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
  assert.equal(result.total, 108);
  assert.ok(result.total < [...result.starters, ...result.bench].reduce((sum, row) => sum + (row.projection.points || 0), 0));
});

test("an owner weekly FBG row can supply the current week when the dated baseline is missing", () => {
  const players = rosterPlayers();
  players[0].weeklyProjection.points[0] = null;
  const fbgRows = new Map([["qb-one|1", { playerId: "qb-one", week: 1, points: 25, floor: 19, ceiling: 31, providerAsOf: "2026-09-08T11:00:00.000Z" }]]);
  const result = optimizeExactLineup(rosterRows(players), { week: 1, playerById: new Map(players.map((item) => [item.id, item])), fbgRows });
  assert.equal(result.starters.find((row) => row.playerId === "qb-one").projection.points, 25);
});

test("the current-week lineup blend uses signed-in FantasyPros and PFF component-stat snapshots", () => {
  const players = rosterPlayers();
  const rows = (points) => players.map((item) => ({ playerId: item.id, week: 1, points, providerAsOf: "2026-09-08T11:30:00.000Z", projectedStats: { rushingYards: points * 10 } }));
  const leagueState = {
    source: "CBS", authority: "authenticated league roster and availability authority", capturedAt: "2026-09-08T11:30:00.000Z",
    rostersReady: true, legalTeamCount: 12, teamCount: 12, availablePlayerIds: [], projectionWeek: 1, projectionCount: 100,
    teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(players) }], weeklyProjections: rows(20),
  };
  const projectionSnapshot = (source, points) => ({ source, authority: `authenticated ${source} browser-session capture`, providerAsOf: "2026-09-08T11:30:00.000Z", items: rows(points) });
  const result = buildSeasonRecommendationSnapshot({
    pack: { season: 2026, packId: "test-pack", asOf: "2026-09-08T11:00:00.000Z", players, sources: [], weeklyContext: { asOf: "2026-09-08T11:00:00.000Z" } },
    leagueState, week: 1, generatedAt: "2026-09-08T12:00:00.000Z",
    fbgSnapshot: projectionSnapshot("Footballguys", 21), fantasyProsSnapshot: projectionSnapshot("FantasyPros", 22), pffSnapshot: projectionSnapshot("PFF", 23),
  });
  const starter = result.lineup.starters[0];
  assert.deepEqual(starter.sources.map((source) => source.source), projectionSources);
  assert.ok(starter.sources.every((source) => /component stats scored by Thunder Bowl rules/.test(source.input)));
  assert.equal(result.sources.find((source) => source.label === "FantasyPros").asOf, "2026-09-08T11:30:00.000Z");
  assert.equal(result.sources.find((source) => source.label === "PFF").asOf, "2026-09-08T11:30:00.000Z");
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

test("partial authenticated CBS captures update safely without confirming free agents", () => {
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
      fabState: fabState(),
    },
    week: 1,
  });
  assert.ok(result.recommendations.length >= 1);
  assert.equal(result.recommendations[0].add.playerId, freeAgent.id);
  assert.ok(roster.some((item) => item.id === result.recommendations[0].drop.playerId));
  assert.match(result.recommendations[0].availability.source, /CBS/);
  assert.ok(result.recommendations[0].fab.recommended >= 1);
  assert.ok(result.recommendations[0].fab.maximum >= result.recommendations[0].fab.recommended);
  assert.ok(result.recommendations[0].fab.budgetAfter < 50);
  assert.doesNotMatch(JSON.stringify(result.recommendations), /contract|keeper/i);
});

test("CBS FAB-not-started evidence uses the confirmed $50 opening balance without inventing tie order", () => {
  const roster = rosterPlayers();
  const freeAgent = player("rb-preseason-upgrade", "RB", 18, { vbd: 80, marketValue: 30 });
  const partialFab = fabState();
  partialFab.status = "PARTIAL";
  partialFab.coverage = { budgetTeams: 0, orderTeams: 0, recordTeams: 12, pickupEvidence: "CURRENT_WEEK", pickupRows: 0 };
  partialFab.teams = partialFab.teams.map((team) => ({ ...team, remainingBudget: null, fabOrder: null }));
  const result = recommendWaivers({
    pack: { players: [...roster, freeAgent] },
    leagueState: {
      authority: "authenticated league roster and availability authority",
      capturedAt: "2026-08-31T12:00:00.000Z",
      teams: [{ teamId: "dogs-of-war", roster: rosterRows(roster) }],
      availablePlayerIds: [freeAgent.id],
      fabState: partialFab,
    },
    week: 1,
  });
  assert.ok(result.recommendations[0].fab.recommended >= 1);
  assert.equal(result.recommendations[0].fab.currentBudget, 50);
  assert.equal(result.recommendations[0].fab.tiePosition, null);
  assert.equal(result.fab.notStarted, true);
  assert.equal(result.fab.orderAvailable, false);
});

test("FAB bids preserve K/DST bye and injury reserves without using roster salary", () => {
  const roster = rosterPlayers();
  const freeAgent = player("wr-upgrade", "WR", 21, { vbd: 100, marketValue: 40 });
  const leagueState = {
    authority: "authenticated league roster and availability authority",
    capturedAt: "2026-09-08T12:00:00.000Z",
    rostersReady: true,
    teams: [{ teamId: "dogs-of-war", roster: rosterRows(roster) }],
    availablePlayerIds: [freeAgent.id],
    fabState: fabState({ dogsBudget: 20 }),
  };
  const first = recommendWaivers({ pack: { players: [...roster, freeAgent] }, leagueState, week: 1 });
  const changed = structuredClone(leagueState);
  for (const row of changed.teams[0].roster) row.salary += 100;
  const second = recommendWaivers({ pack: { players: [...roster, freeAgent] }, leagueState: changed, week: 1 });
  assert.ok(first.fab.plannedReserve >= 2);
  assert.ok(first.recommendations[0].fab.maximum <= 20 - first.fab.plannedReserve);
  assert.deepEqual(second, first);
});

test("an earlier tied FAB win lowers that team for a later tied claim in the same overnight run", () => {
  const teams = [
    { teamId: "dogs-of-war", remainingBudget: 50, fabOrder: 1, record: { wins: 1, losses: 2, ties: 0 }, weeklySuccessfulPickups: 0 },
    { teamId: "orange-crush", remainingBudget: 50, fabOrder: 2, record: { wins: 1, losses: 2, ties: 0 }, weeklySuccessfulPickups: 0 },
  ];
  const simulation = simulateFabTieClaims({
    teams,
    claims: [
      { playerId: "first", offers: [{ teamId: "dogs-of-war", bid: 5 }, { teamId: "orange-crush", bid: 5 }] },
      { playerId: "second", offers: [{ teamId: "dogs-of-war", bid: 5 }, { teamId: "orange-crush", bid: 5 }] },
    ],
  });
  assert.deepEqual(simulation.results.map((row) => row.winnerTeamId), ["dogs-of-war", "orange-crush"]);
  assert.equal(simulation.teams.find((team) => team.teamId === "dogs-of-war").weeklySuccessfulPickups, 1);
  assert.equal(simulation.teams.find((team) => team.teamId === "orange-crush").weeklySuccessfulPickups, 1);
});

test("waiver and trade recommendations are invariant to salary and contract data", () => {
  const teamPlayers = (prefix, rbPoints, wrPoints) => [
    player(`${prefix}-qb-one`, "QB", 20), player(`${prefix}-qb-two`, "QB", 14),
    ...rbPoints.map((points, index) => player(`${prefix}-rb-${index + 1}`, "RB", points)),
    ...wrPoints.map((points, index) => player(`${prefix}-wr-${index + 1}`, "WR", points)),
    player(`${prefix}-te-one`, "TE", 10), player(`${prefix}-te-two`, "TE", 6),
    player(`${prefix}-k-one`, "K", 8), player(`${prefix}-dst-one`, "DST", 7),
  ];
  const dogs = teamPlayers("dogs", [13, 8, 7, 6], [20, 18, 17, 16]);
  const rival = teamPlayers("rival", [20, 18, 17, 16], [13, 8, 7, 6]);
  const pack = { players: [...dogs, ...rival] };
  const baseLeague = {
    authority: "authenticated league roster and availability authority",
    capturedAt: "2026-09-08T12:00:00.000Z",
    rostersReady: true,
    availablePlayerIds: [],
    teams: [
      { teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(dogs) },
      { teamId: "rival", teamName: "Orange Crush", roster: rosterRows(rival) },
    ],
  };
  const changedLeague = structuredClone(baseLeague);
  for (const team of changedLeague.teams) for (const row of team.roster) {
    row.salary += 100;
    row.contractYear = 9;
  }
  const base = recommendTrades({ pack, leagueState: baseLeague, week: 1 });
  const changed = recommendTrades({ pack, leagueState: changedLeague, week: 1 });
  assert.ok(base.recommendations.length > 0);
  assert.deepEqual(changed, base);
  assert.doesNotMatch(JSON.stringify(base.recommendations), /salary|contract|keeper/i);
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
  assert.equal(result.irTargets[0].keeperEvaluationActive, false);
  assert.equal(result.irTargets[0].keeperCost, null);
});

test("keeper salary remains gated until the Week 13 keeper-review window", () => {
  const target = player("late-keeper", "RB", 15, { marketValue: 35, vbd: 50 });
  const leagueState = {
    teams: [
      { teamId: "dogs-of-war", teamName: "Dogs of War", roster: [] },
      { teamId: "rival", teamName: "Orange Crush", roster: [{ playerId: target.id, salary: 7, contractYear: 2 }] },
    ],
    availablePlayerIds: [],
  };
  const statusSnapshot = { capturedAt: "2026-11-25T12:00:00.000Z", updates: [{ playerId: target.id, severity: "critical", status: "Injured Reserve", injuryStatus: "IR", newsUpdated: "2026-11-25T11:00:00.000Z" }] };
  const early = buildInjuryWatch({ pack: { players: [target] }, leagueState, week: 12, statusSnapshot }).irTargets[0];
  const late = buildInjuryWatch({ pack: { players: [target] }, leagueState, week: 13, statusSnapshot }).irTargets[0];
  assert.equal(early.keeperEvaluationActive, false);
  assert.equal(early.keeperCost, null);
  assert.equal(late.keeperEvaluationActive, true);
  assert.equal(late.keeperCost, 7);
});

test("combined plans are deterministic for identical sources and disclose baseline limits", () => {
  const players = rosterPlayers();
  const pack = { season: 2026, packId: "test-pack", asOf: "2026-09-08T11:00:00.000Z", players, sources: [], weeklyContext: { asOf: "2026-09-08T11:00:00.000Z" } };
  const leagueState = { source: "unverified roster baseline", authority: "not current CBS availability", capturedAt: "2026-08-30T12:00:00.000Z", teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(players) }], availablePlayerIds: null };
  const input = { pack, leagueState, week: 1, generatedAt: "2026-09-08T12:00:00.000Z" };
  const left = buildSeasonRecommendationSnapshot(input);
  const right = buildSeasonRecommendationSnapshot(input);
  assert.deepEqual(left, right);
  assert.equal(left.lineup.legal, true);
  assert.equal(left.waivers.recommendations.length, 0);
  assert.ok(left.alerts.some((message) => message.includes("CBS league data has not been synced")));
});

test("private season shell supports full and per-source updates without auction navigation or caching", async () => {
  const [html, source, css, worker, rootWorker, manifest, netlify, refreshHandler] = await Promise.all([
    readFile(new URL("../public/thunder-bowl/season/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/season.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/season.css", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/thunder-season-refresh.mjs", import.meta.url), "utf8"),
  ]);
  for (const id of ["refresh-plan", "update-cbs-only", "update-fbg-only", "update-fp-only", "update-pff-only", "update-news-only", "helper-setup", "helper-download", "fbg-file", "starter-rows", "bench-rows", "waiver-list", "trade-list", "move-list", "injury-list", "ir-list", "evidence-dialog", "evidence-eyebrow"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, />Update everything</);
  assert.match(html, /Two-sided current-season value/);
  for (const label of ["Update CBS", "Update FBG", "Update FantasyPros", "Update PFF", "Update injuries/news"]) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /Advanced recovery tools/);
  assert.doesNotMatch(html, /auction room|auction command center/i);
  assert.match(html, /\.\/manifest\.webmanifest/);
  assert.match(source, /action: "capture-cbs"/);
  assert.match(source, /requestFbgProjectionCapture/);
  assert.match(source, /action: "capture-fbg"/);
  assert.match(source, /action: "refresh-news"/);
  assert.match(source, /provider: "fantasyPros"/);
  assert.match(source, /provider: "pff"/);
  assert.match(source, /action: "capture-fantasypros"/);
  assert.match(source, /action: "capture-pff"/);
  assert.match(source, /action: "rebuild-plan"/);
  assert.match(refreshHandler, /input\.action === "rebuild-plan"/);
  assert.match(refreshHandler, /return json\(await refreshSeasonPlan\(\)\)/);
  assert.match(source, /CBS was saved successfully/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /JSON\.stringify\(value/);
  assert.doesNotMatch(source, /metric\("Salary"/);
  assert.match(source, /buildEvidenceExplanation/);
  assert.match(source, /collectLatestPlayerNews/);
  assert.match(source, /\/api\/thunder-bowl\/news\?force=1/);
  assert.match(source, /\/api\/thunder-bowl\/research\?force=1/);
  assert.match(source, /Latest news for \$\{player\.name\}/);
  assert.match(source, /recommendationNewsButtons\(\[row\.add, row\.drop\]\)/);
  assert.match(source, /recommendationNewsButtons\(\[\.\.\.row\.sends, \.\.\.row\.receives\]\)/);
  assert.match(source, /News: \$\{player\.name\}/);
  assert.match(source, /Recommended blind bid/);
  assert.match(source, /Do not exceed/);
  assert.match(source, /Remaining after a win/);
  for (const kind of ["starter", "bench", "swap", "waiver", "trade", "move", "injury", "ir"]) assert.match(source, new RegExp(`"${kind}"`));
  assert.match(source, /thunder-bowl-season-setup-required/);
  assert.match(source, /Too many recent access checks/);
  assert.match(html, /maxlength="100"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /clientX < rect\.left/);
  assert.match(css, /@media \(max-width:620px\)/);
  assert.match(css, /\.source-update-button \{[^}]*min-height:44px/);
  assert.match(source, /register\("\.\/service-worker\.js", \{ scope: "\.\/" \}\)/);
  assert.match(worker, /\/thunder-bowl\/season\/index\.html/);
  assert.match(worker, /thunder-bowl-season-v7/);
  assert.doesNotMatch(worker, /auctioneer|draft-board|sample-draft-pack/);
  assert.match(worker, /season\.mjs\?v=20260901b/);
  assert.match(worker, /season-news\.mjs\?v=20260831a/);
  assert.match(worker, /fbg-session-capture\.mjs\?v=20260831a/);
  assert.match(worker, /supplemental-session-capture\.mjs\?v=20260831a/);
  assert.match(worker, /season-evidence\.mjs\?v=20260831c/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(rootWorker, /thunder-bowl-shell-v140/);
  assert.doesNotMatch(rootWorker, /\/thunder-bowl\/season\/index\.html/);
  assert.equal(JSON.parse(manifest).scope, "/thunder-bowl/season/");
  assert.match(netlify, /from = "\/api\/thunder-bowl\/season\/snapshot"/);
  assert.match(netlify, /from = "\/api\/thunder-bowl\/season\/refresh"/);
  assert.match(netlify, /for = "\/thunder-bowl\/season\/service-worker\.js"/);
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
