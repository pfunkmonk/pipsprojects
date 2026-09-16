import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FBG_NATIVE_WEEKLY_COLUMNS, parseFbgAuthenticatedWeeklyCapture, parseFbgNativeWeeklyCsv, parseFbgWeeklyCsv } from "../netlify/functions/_lib/fbg-season-source.mjs";
import { buildSeasonSetupSnapshot, cbsFinalScoreRecords, normalizeSeasonViewingTeam, normalizeSeasonViewingWeek, RECOMMENDATION_ENGINE_VERSION, retainPriorCbsOptionalEvidence } from "../netlify/functions/_lib/season-service.mjs";
import { readSeasonPack } from "../netlify/functions/_lib/season-pack.mjs";
import {
  analyzeTradeProposal,
  buildInjuryWatch,
  buildSeasonRecommendationSnapshot,
  classifyWaiverEdge,
  classifyTradeIdea,
  optimizeExactLineup,
  projectionWeightsForPosition,
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

test("CBS optional evidence falls back only to safe same-week data", () => {
  const priorFab = { week: 1, status: "COMPLETE" };
  const priorPreview = { week: 1, status: "COMPLETE", teams: [{ teamId: "dogs-of-war" }] };
  const priorRows = [{ playerId: "qb-one", week: 1, points: 20 }];
  const prior = { fabState: priorFab, scoringPreview: priorPreview, projectionWeek: 1, projectionCount: 1, unmatchedProjectionCount: 2, weeklyProjections: priorRows };
  const retained = retainPriorCbsOptionalEvidence({ projectionWeek: 1, projectionCount: 0, fabState: null, scoringPreview: { week: 1, status: "PARTIAL", teams: [] } }, prior);
  assert.equal(retained.fabState, priorFab);
  assert.equal(retained.scoringPreview, priorPreview);
  assert.equal(retained.weeklyProjections, priorRows);
  assert.equal(retained.projectionCount, 1);
  assert.equal(retained.unmatchedProjectionCount, 2);

  const currentFab = { week: 1, status: "PARTIAL" };
  const currentRows = [{ playerId: "qb-two", week: 1, points: 18 }];
  const currentPreview = { week: 1, status: "PARTIAL", teams: [{ coverage: { exactStarters: true, completeRoster: true } }] };
  const current = retainPriorCbsOptionalEvidence({ projectionWeek: 1, projectionCount: 1, fabState: currentFab, scoringPreview: currentPreview, weeklyProjections: currentRows }, prior);
  assert.equal(current.fabState, currentFab);
  assert.equal(current.scoringPreview, currentPreview);
  assert.equal(current.weeklyProjections, currentRows);

  const nextWeek = retainPriorCbsOptionalEvidence({ projectionWeek: 2, projectionCount: 0, fabState: null }, prior);
  assert.equal(nextWeek.fabState, null);
  assert.equal(nextWeek.scoringPreview, undefined);
  assert.equal(nextWeek.weeklyProjections, undefined);
});

test("lineup outlooks allow only the current week and the next two weeks", () => {
  assert.equal(normalizeSeasonViewingWeek(null, 1), 1);
  assert.equal(normalizeSeasonViewingWeek("2", 1), 2);
  assert.equal(normalizeSeasonViewingWeek(3, 1), 3);
  assert.throws(() => normalizeSeasonViewingWeek(4, 1), /between Week 1 and Week 3/);
  assert.throws(() => normalizeSeasonViewingWeek(0, 1), /between Week 1 and Week 3/);
  assert.equal(normalizeSeasonViewingWeek(18, 18), 18);
});

test("lineup team selection accepts every governed CBS team and rejects unknown teams", () => {
  assert.equal(normalizeSeasonViewingTeam(null), "dogs-of-war");
  assert.equal(normalizeSeasonViewingTeam("t-dogs"), "t-dogs");
  assert.equal(normalizeSeasonViewingTeam("THE-HOBBITS"), "the-hobbits");
  assert.throws(() => normalizeSeasonViewingTeam("not-a-team"), /12 CBS Thunder Bowl teams/);
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
  const roster = rosterRows(players).map((row) => ({ ...row, opponent: "LV", gameTime: "Sun 11:00am MT" }));
  const leagueState = {
    source: "CBS", authority: "authenticated league roster and availability authority", capturedAt: "2026-09-08T11:30:00.000Z",
    rostersReady: true, legalTeamCount: 12, teamCount: 12, availablePlayerIds: [], projectionWeek: 1, projectionCount: 100,
    teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster }], weeklyProjections: rows(20),
  };
  const projectionSnapshot = (source, points) => ({ source, authority: `authenticated ${source} browser-session capture`, providerAsOf: "2026-09-08T11:30:00.000Z", items: rows(points) });
  const weights = { Footballguys: 0.1, CBS: 0.1, FantasyPros: 0.1, PFF: 0.7 };
  const projectionCalibration = { active: true, positions: Object.fromEntries(["QB", "RB", "WR", "TE", "K", "DST"].map((position) => [position, { active: true, weights }])) };
  const result = buildSeasonRecommendationSnapshot({
    pack: { season: 2026, packId: "test-pack", asOf: "2026-09-08T11:00:00.000Z", players, sources: [], weeklyContext: { asOf: "2026-09-08T11:00:00.000Z" } },
    leagueState, week: 1, generatedAt: "2026-09-08T12:00:00.000Z",
    fbgSnapshot: projectionSnapshot("Footballguys", 21), fantasyProsSnapshot: projectionSnapshot("FantasyPros", 22), pffSnapshot: projectionSnapshot("PFF", 23),
    projectionCalibration,
  });
  const starter = result.lineup.starters[0];
  assert.equal(starter.kickoffAt, "2026-09-13T17:00:00.000Z");
  assert.deepEqual(starter.sources.map((source) => source.source), projectionSources);
  assert.ok(starter.sources.every((source) => /component stats scored by Thunder Bowl rules/.test(source.input)));
  assert.equal(starter.points, 22.4);
  const partialWeights = projectionWeightsForPosition(["CBS", "PFF"], "QB", projectionCalibration);
  assert.ok(Math.abs(partialWeights.CBS - 0.125) < 1e-10 && Math.abs(partialWeights.PFF - 0.875) < 1e-10);
  assert.equal(result.model.projectionCalibration, projectionCalibration);
  assert.equal(result.sources.find((source) => source.label === "FantasyPros").asOf, "2026-09-08T11:30:00.000Z");
  assert.equal(result.sources.find((source) => source.label === "PFF").asOf, "2026-09-08T11:30:00.000Z");
});

test("an upcoming-week lineup uses the four-source schedule-shaped outlook without reusing current game details", () => {
  const players = rosterPlayers();
  const roster = rosterRows(players).map((row) => ({ ...row, opponent: "LV", gameTime: "2026-09-10T00:00:00.000Z" }));
  const leagueState = {
    source: "CBS", authority: "authenticated league roster and availability authority", capturedAt: "2026-09-08T11:30:00.000Z",
    rostersReady: true, legalTeamCount: 12, teamCount: 12, availablePlayerIds: [], projectionWeek: 1, projectionCount: 100,
    teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster }], weeklyProjections: [],
  };
  const result = buildSeasonRecommendationSnapshot({
    pack: { season: 2026, packId: "future-pack", asOf: "2026-09-08T11:00:00.000Z", players, sources: [], weeklyContext: { asOf: "2026-09-08T11:00:00.000Z" } },
    leagueState,
    week: 2,
    currentWeek: 1,
    generatedAt: "2026-09-08T12:00:00.000Z",
  });
  assert.equal(result.viewing.mode, "FORECAST");
  assert.equal(result.viewing.currentWeek, 1);
  assert.equal(result.viewing.selectedWeek, 2);
  assert.equal(result.viewing.maxSelectableWeek, 3);
  assert.match(result.lineup.decisionSummary.headline, /projected Week 2 lineup/i);
  assert.deepEqual(result.lineup.starters[0].sources.map((source) => source.source), projectionSources);
  assert.ok(result.lineup.starters[0].sources.every((source) => source.input === "governed early-outlook weekly shape"));
  assert.equal(result.lineup.starters[0].opponent, null);
  assert.equal(result.lineup.starters[0].gameTime, null);
});

test("every starter exposes only higher-projected CBS-confirmed free agents at the same position", () => {
  const roster = rosterPlayers();
  const betterQuarterback = player("qb-free-better", "QB", 24, { name: "Better Free QB" });
  const lowerQuarterback = player("qb-free-lower", "QB", 18, { name: "Lower Free QB" });
  const rosterEntries = rosterRows(roster).map((row) => ({ ...row, opponent: "LV" }));
  const leagueState = {
    source: "CBS", authority: "authenticated league roster and availability authority", capturedAt: "2026-09-08T11:30:00.000Z",
    rostersReady: true, legalTeamCount: 12, teamCount: 12, availablePlayerIds: [betterQuarterback.id, lowerQuarterback.id], projectionWeek: 1, projectionCount: 100,
    teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterEntries }], weeklyProjections: [],
  };
  const result = buildSeasonRecommendationSnapshot({
    pack: { season: 2026, packId: "starter-free-agents", asOf: "2026-09-08T11:00:00.000Z", players: [...roster, betterQuarterback, lowerQuarterback], sources: [], weeklyContext: { asOf: "2026-09-08T11:00:00.000Z" } },
    leagueState,
    week: 1,
    generatedAt: "2026-09-08T12:00:00.000Z",
  });
  const startingQuarterback = result.lineup.starters.find((row) => row.position === "QB");
  const alternatives = result.lineup.freeAgentAlternatives[startingQuarterback.playerId];
  assert.deepEqual(alternatives.map((row) => row.name), ["Better Free QB"]);
  assert.equal(alternatives[0].leagueStatus, "FREE AGENT");
  assert.equal(alternatives[0].starterName, startingQuarterback.name);
  assert.ok(alternatives[0].delta > 0);
  assert.ok(Object.values(result.lineup.freeAgentAlternatives).flat().every((row) => row.position === result.lineup.starters.find((starter) => starter.playerId === row.starterPlayerId).position));
});

test("Start/Sit can optimize any CBS roster and carries the selected team's scheduled opponent", () => {
  const dogs = rosterPlayers();
  const rivals = rosterPlayers().map((row, index) => ({ ...structuredClone(row), id: `rival-${row.id}`, name: `Rival ${index + 1}` }));
  const leagueState = {
    source: "CBS", authority: "authenticated league roster and availability authority", capturedAt: "2026-09-08T11:30:00.000Z",
    rostersReady: true, legalTeamCount: 12, teamCount: 12, availablePlayerIds: [], projectionWeek: 1, projectionCount: 100,
    teams: [
      { teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(dogs) },
      { teamId: "t-dogs", teamName: "T-Dogs", roster: rosterRows(rivals) },
    ],
    weeklyProjections: [],
    leagueSchedule: {
      source: "CBS Sports authenticated Thunder Bowl league schedule", capturedAt: "2026-09-08T11:25:00.000Z", headToHeadWeeks: [1], allPlayWeeks: [14], matchupCount: 1,
      matchups: [{ week: 1, teamAId: "dogs-of-war", teamAName: "Dogs of War", teamBId: "t-dogs", teamBName: "T-Dogs" }],
    },
  };
  const result = buildSeasonRecommendationSnapshot({
    pack: { season: 2026, packId: "alternate-team-lineup", asOf: "2026-09-08T11:00:00.000Z", players: [...dogs, ...rivals], sources: [], weeklyContext: { asOf: "2026-09-08T11:00:00.000Z" } },
    leagueState,
    week: 1,
    lineupTeamId: "t-dogs",
    generatedAt: "2026-09-08T12:00:00.000Z",
  });
  assert.equal(result.lineup.teamId, "t-dogs");
  assert.equal(result.lineup.teamName, "T-Dogs");
  assert.equal(result.lineup.opponent.teamId, "dogs-of-war");
  assert.equal(result.viewing.userOpponentTeamId, "t-dogs");
  assert.ok(result.lineup.starters.every((row) => row.playerId.startsWith("rival-") && row.adviceTeamName === "T-Dogs"));
  assert.equal(result.schedule.selectedTeam[0].opponent.teamName, "Dogs of War");
  assert.equal(result.schedule.matchups[0].teamAName, "Dogs of War");
});

test("Scoring Preview uses CBS submitted starters for both teams and Thunder Bowl projections for points", () => {
  const dogs = rosterPlayers();
  const rivals = rosterPlayers().map((row, index) => ({ ...structuredClone(row), id: `preview-rival-${row.id}`, name: `Preview Rival ${index + 1}` }));
  const dogsStarterIds = ["qb-two", "rb-one", "rb-two", "wr-one", "wr-two", "te-one", "k-one", "dst-one"];
  const rivalStarterIds = ["preview-rival-qb-one", "preview-rival-rb-one", "preview-rival-rb-two", "preview-rival-wr-one", "preview-rival-wr-two", "preview-rival-te-one", "preview-rival-k-one", "preview-rival-dst-one"];
  const previewTeam = (teamId, teamName, roster, starterIds, actualPoints) => ({
    teamId,
    teamName,
    starters: starterIds.map((playerId, index) => ({
      playerId, cbsPlayerId: `cbs-${playerId}`, actualPoints: index === 0 ? actualPoints : null,
      scoreStatus: index === 0 ? "FINAL" : "NOT_STARTED", cbsLiveProjection: 20, gameText: index === 0 ? "FINAL" : "Sun 11:00 AM MT", statsText: index === 0 ? "Passing: 250 Yds, 2 TD" : null,
    })),
    bench: roster.filter((row) => !starterIds.includes(row.id)).map((row) => ({ playerId: row.id, cbsPlayerId: `cbs-${row.id}`, actualPoints: null, scoreStatus: "NOT_STARTED" })),
    actuals: { currentPoints: actualPoints, knownStarters: 1, finalStarters: 1, liveStarters: 0, status: "LIVE" },
    coverage: { exactStarters: true, completeRoster: true },
  });
  const leagueState = {
    source: "CBS", authority: "authenticated league roster and availability authority", capturedAt: "2026-09-08T11:30:00.000Z",
    rostersReady: true, legalTeamCount: 12, teamCount: 12, availablePlayerIds: [], projectionWeek: 1, projectionCount: 100,
    teams: [
      { teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(dogs) },
      { teamId: "three-amigos", teamName: "Three Amigos", roster: rosterRows(rivals) },
    ],
    weeklyProjections: [],
    leagueSchedule: {
      source: "CBS Sports authenticated Thunder Bowl league schedule", capturedAt: "2026-09-08T11:25:00.000Z", headToHeadWeeks: [1], allPlayWeeks: [14], matchupCount: 1,
      matchups: [{ week: 1, teamAId: "dogs-of-war", teamAName: "Dogs of War", teamBId: "three-amigos", teamBName: "Three Amigos" }],
    },
    scoringPreview: {
      schemaVersion: 1, source: "CBS Sports authenticated Thunder Bowl scoring preview", modelEffect: "submitted_lineup_and_actual_score_authority", status: "COMPLETE", coverageScope: "MATCHUP",
      season: 2026, week: 1, capturedAt: "2026-09-08T11:29:00.000Z", pageUrl: "https://berrymvp.football.cbssports.com/scoring/live/1/", errors: [],
      teams: [previewTeam("dogs-of-war", "Dogs of War", dogs, dogsStarterIds, 17.5), previewTeam("three-amigos", "Three Amigos", rivals, rivalStarterIds, 14.2)],
    },
  };
  const result = buildSeasonRecommendationSnapshot({
    pack: { season: 2026, packId: "scoring-preview", asOf: "2026-09-08T11:00:00.000Z", players: [...dogs, ...rivals], sources: [], weeklyContext: { asOf: "2026-09-08T11:00:00.000Z" } },
    leagueState,
    week: 1,
    generatedAt: "2026-09-08T12:00:00.000Z",
  });
  assert.equal(result.scoringPreview.status, "COMPLETE");
  assert.equal(result.scoringPreview.teams.length, 2);
  assert.equal(result.scoringPreview.teams[0].starters.find((row) => row.position === "QB").playerId, "qb-two");
  assert.equal(result.lineup.starters.find((row) => row.position === "QB").playerId, "qb-one");
  assert.equal(result.scoringPreview.teams[0].bench.length, 6);
  assert.ok(Number.isFinite(result.scoringPreview.teams[0].total));
  assert.equal(result.scoringPreview.teams[0].actualPoints, 17.5);
  assert.equal(result.scoringPreview.teams[0].starters[0].actualPoints, 17.5);
  assert.equal(result.scoringPreview.teams[0].starters[0].liveStats, "Passing: 250 Yds, 2 TD");
  assert.equal(result.scoringPreview.actualMargin, 3.3);
  assert.match(result.scoringPreview.authorityNote, /CBS determines/);
});

test("CBS final player scores become trusted result evidence without accepting ordinary current-week imports", () => {
  const dogs = rosterPlayers();
  const pack = { season: 2026, players: dogs };
  const snapshot = {
    teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(dogs) }],
    scoringPreview: {
      modelEffect: "submitted_lineup_and_actual_score_authority", week: 1, capturedAt: "2026-09-12T12:00:00.000Z",
      pageUrl: "https://berrymvp.football.cbssports.com/scoring/live/1/",
      teams: [{ teamId: "dogs-of-war", starters: [
        { playerId: "qb-one", actualPoints: 24.7, scoreStatus: "FINAL" },
        { playerId: "rb-one", actualPoints: 7.1, scoreStatus: "LIVE" },
      ], bench: [] }],
    },
  };
  const records = cbsFinalScoreRecords(snapshot, pack, new Date("2026-09-12T12:01:00.000Z"));
  assert.equal(records.length, 1);
  assert.equal(records[0].playerId, "qb-one");
  assert.equal(records[0].points, 24.7);
  assert.equal(records[0].final, true);
});

test("Scoring Preview can show any scheduled matchup without claiming projected lineups were submitted", () => {
  const makeRoster = (prefix) => rosterPlayers().map((row, index) => ({ ...structuredClone(row), id: `${prefix}-${row.id}`, name: `${prefix} ${index + 1}` }));
  const dogs = makeRoster("dogs"), rivals = makeRoster("rivals"), alpha = makeRoster("alpha"), beta = makeRoster("beta");
  const teams = [
    ["dogs-of-war", "Dogs of War", dogs], ["rivals", "Rivals", rivals], ["alpha", "Alpha", alpha], ["beta", "Beta", beta],
  ].map(([teamId, teamName, roster]) => ({ teamId, teamName, roster: rosterRows(roster) }));
  const leagueState = {
    source: "CBS", authority: "authenticated league roster and availability authority", capturedAt: "2026-09-08T11:30:00.000Z",
    rostersReady: true, legalTeamCount: 4, teamCount: 4, availablePlayerIds: [], projectionWeek: 1, projectionCount: 100,
    teams, weeklyProjections: [],
    leagueSchedule: { source: "CBS schedule", capturedAt: "2026-09-08T11:25:00.000Z", headToHeadWeeks: [1], allPlayWeeks: [], matchupCount: 2,
      matchups: [
        { week: 1, teamAId: "dogs-of-war", teamAName: "Dogs of War", teamBId: "rivals", teamBName: "Rivals" },
        { week: 1, teamAId: "alpha", teamAName: "Alpha", teamBId: "beta", teamBName: "Beta" },
      ] },
  };
  const result = buildSeasonRecommendationSnapshot({
    pack: { season: 2026, packId: "all-matchups", asOf: "2026-09-08T11:00:00.000Z", players: [...dogs, ...rivals, ...alpha, ...beta], sources: [], weeklyContext: { asOf: "2026-09-08T11:00:00.000Z" } },
    leagueState, week: 1, lineupTeamId: "alpha", generatedAt: "2026-09-08T12:00:00.000Z",
  });
  assert.deepEqual(result.scoringPreview.teams.map((team) => team.teamName), ["Alpha", "Beta"]);
  assert.ok(result.scoringPreview.teams.every((team) => team.starters.length === 8 && team.submitted === false));
  assert.match(result.scoringPreview.authorityNote, /not confirmation/i);
  assert.equal(result.schedule.matchups.length, 2);
});

test("start-sit analysis separates strong calls, leans, toss-ups, and injury monitors", () => {
  const roster = [
    player("hurts", "QB", 23.1, { name: "Jalen Hurts" }), player("caleb", "QB", 20.4, { name: "Caleb Williams" }),
    player("bijan", "RB", 19.9, { name: "Bijan Robinson" }), player("brown", "RB", 16.2, { name: "Chase Brown" }),
    player("judkins", "RB", 11.9, { name: "Quinshon Judkins" }), player("pollard", "RB", 10.9, { name: "Tony Pollard" }),
    player("flowers", "WR", 14.3, { name: "Zay Flowers" }), player("adams", "WR", 12.7, { name: "Davante Adams" }),
    player("odunze", "WR", 12.1, { name: "Rome Odunze" }), player("moore", "WR", 11.4, { name: "DJ Moore" }), player("concepcion", "WR", 9.3, { name: "KC Concepcion" }),
    player("fannin", "TE", 11.6, { name: "Harold Fannin Jr." }), player("myers", "K", 8.4, { name: "Jason Myers" }), player("steelers", "DST", 12.4, { name: "Pittsburgh Steelers" }),
  ];
  const leagueState = {
    source: "CBS",
    authority: "authenticated league roster and availability authority",
    capturedAt: "2026-09-01T14:55:00.000Z",
    rostersReady: true,
    legalTeamCount: 12,
    teamCount: 12,
    availablePlayerIds: [],
    teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(roster) }],
  };
  const result = buildSeasonRecommendationSnapshot({
    pack: { season: 2026, packId: "start-sit-strength", asOf: "2026-09-01T14:55:00.000Z", players: roster, sources: [], weeklyContext: { asOf: "2026-09-01T14:55:00.000Z" } },
    leagueState,
    week: 1,
    generatedAt: "2026-09-01T15:00:00.000Z",
    statusSnapshot: { capturedAt: "2026-09-01T14:58:00.000Z", updates: [{ playerId: "flowers", severity: "watch", status: "Questionable", injuryStatus: "Questionable", newsUpdated: "2026-09-01T14:58:00.000Z" }] },
  });
  const decisions = new Map(result.lineup.swaps.map((row) => [row.sit, row]));
  assert.equal(decisions.get("Rome Odunze").strength, "TOSS-UP");
  assert.equal(decisions.get("Rome Odunze").verdict, "PASS");
  assert.equal(decisions.get("Rome Odunze").actionable, false);
  assert.equal(decisions.get("DJ Moore").strength, "TOSS-UP");
  assert.equal(decisions.get("KC Concepcion").strength, "STRONG");
  assert.equal(decisions.get("Caleb Williams").strength, "LEAN");
  assert.equal(result.lineup.decisionSummary.verdict, "KEEP");
  assert.equal(result.lineup.decisionSummary.counts.tossUp, 2);
  assert.equal(result.lineup.monitors[0].name, "Zay Flowers");
  assert.match(result.lineup.monitors[0].reason, /rechecked before/);
});

test("the optimizer preserves a later WR when an early-game projection edge is under three points", () => {
  const players = rosterPlayers();
  const adams = players.find((row) => row.id === "wr-two");
  const moore = players.find((row) => row.id === "wr-three");
  adams.name = "Davante Adams"; adams.weeklyProjection.points[0] = 12.9;
  moore.name = "DJ Moore"; moore.weeklyProjection.points[0] = 11.6;
  const cbsRows = new Map([
    [`${adams.id}|1`, { playerId: adams.id, week: 1, points: 12.9, opponent: "SF", gameTime: "Thu 6:35pm MT" }],
    [`${moore.id}|1`, { playerId: moore.id, week: 1, points: 11.6, opponent: "HOU", gameTime: "Sun 11:00am MT" }],
  ]);
  const result = optimizeExactLineup(rosterRows(players), { week: 1, playerById: new Map(players.map((item) => [item.id, item])), cbsRows });
  assert.ok(result.starters.some((row) => row.playerId === moore.id));
  assert.ok(result.bench.some((row) => row.playerId === adams.id));
  assert.deepEqual(result.optionalitySwaps.map((row) => [row.earlierName, row.laterName, row.projectedCost]), [["Davante Adams", "DJ Moore", 1.3]]);
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
  assert.ok(result.recommendations[0].dropValue.week > 0);
  assert.equal(result.recommendations[0].dropProjectionLoss, result.recommendations[0].dropValue.week);
  assert.match(result.recommendations[0].reason, /bench\/depth points/);
  assert.match(JSON.stringify(result.recommendations), /dropProtection/);
  assert.ok(result.recommendations.every((row) => row.gains.restOfSeason >= 0 || ["RENTAL", "WATCH"].includes(row.verdict)));
});

test("a full legal roster holds FAB for tiny duplicate QB, K, and DST gains", () => {
  const roster = rosterPlayers();
  roster.find((item) => item.id === "qb-one").name = "Jalen Hurts";
  roster.find((item) => item.id === "qb-two").name = "Caleb Williams";
  roster.find((item) => item.id === "rb-three").name = "Tony Pollard";
  roster.find((item) => item.id === "rb-three").weeklyProjection.points = Array.from({ length: 18 }, (_, index) => index === 5 ? null : 10.9);
  roster.find((item) => item.id === "k-one").name = "Jason Myers";
  roster.find((item) => item.id === "dst-one").name = "Pittsburgh Steelers";
  const freeAgents = [
    player("qb-tiny", "QB", 20.2),
    player("k-tiny", "K", 8.2),
    player("dst-tiny", "DST", 7.3),
  ];
  const result = recommendWaivers({
    pack: { players: [...roster, ...freeAgents] },
    leagueState: {
      authority: "authenticated league roster and availability authority",
      capturedAt: "2026-09-08T12:00:00.000Z",
      rostersReady: true,
      teams: [{ teamId: "dogs-of-war", roster: rosterRows(roster) }],
      availablePlayerIds: freeAgents.map((item) => item.id),
      fabState: fabState(),
    },
    week: 1,
  });
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.hold.verdict, "HOLD");
  assert.equal(result.hold.confidence, "HIGH");
  assert.equal(result.hold.roster.size, 14);
  assert.match(result.hold.reason, /Hold FAB and roster depth/);
  assert.match(result.hold.reason, /Duplicate QB, K, or DST/);
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

test("missing current CBS FAB balances still produce clearly estimated conservative dollar caps", () => {
  const roster = rosterPlayers();
  const freeAgent = player("wr-week-two-upgrade", "WR", 22, { vbd: 110, marketValue: 45 });
  const partialFab = fabState();
  partialFab.status = "PARTIAL";
  partialFab.coverage = { budgetTeams: 0, orderTeams: 0, recordTeams: 12, pickupEvidence: "CURRENT_WEEK", pickupRows: 0 };
  partialFab.teams = partialFab.teams.map((team) => ({ ...team, remainingBudget: null, fabOrder: null }));
  const result = recommendWaivers({
    pack: { players: [...roster, freeAgent] },
    leagueState: {
      authority: "authenticated league roster and availability authority",
      capturedAt: "2026-09-15T12:00:00.000Z",
      rostersReady: true,
      teams: [{ teamId: "dogs-of-war", roster: rosterRows(roster) }],
      availablePlayerIds: [freeAgent.id],
      fabState: partialFab,
    },
    week: 2,
  });
  const recommendation = result.recommendations.find((row) => row.policy.actionable);
  assert.ok(recommendation.fab.recommended >= 1);
  assert.ok(recommendation.fab.maximum >= recommendation.fab.recommended);
  assert.equal(recommendation.fab.currentBudget, null);
  assert.equal(recommendation.fab.bidBudget, 50);
  assert.equal(recommendation.fab.budgetAfter, null);
  assert.equal(recommendation.fab.pricingEstimated, true);
  assert.equal(recommendation.fab.tiePosition, null);
});

test("FAB bids preserve K/DST reserves while high roster salaries never inflate a claim", () => {
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
  assert.equal(second.recommendations[0].verdict, first.recommendations[0].verdict);
  assert.deepEqual(second.recommendations[0].fab, first.recommendations[0].fab);
  assert.equal(second.recommendations[0].policy.dropProtection.protected, false);
  assert.equal(first.recommendations[0].policy.dropProtection.protected, false);
});

test("waiver policy downgrades short-term gains with negative ROS to WATCH", () => {
  const decision = classifyWaiverEdge({
    addPlayer: player("short-rental", "WR", 14),
    drop: { ...rosterRows([player("rome", "WR", 13, { name: "Rome Odunze" })])[0], player: player("rome", "WR", 13, { name: "Rome Odunze" }) },
    currentDelta: { delta: 2.2, resilienceWeeks: 0 },
    nextThreeDelta: { delta: 1.7, resilienceWeeks: 0 },
    rosDelta: { delta: -0.1, resilienceWeeks: 0 },
    addValue: { week: 15.2, nextThree: 14.7, restOfSeason: 12.9 },
    dropValue: { week: 13, nextThree: 13, restOfSeason: 13 },
    depthDelta: { week: 2.2, nextThree: 1.7, restOfSeason: -0.1 },
    immediateNeed: false,
  });
  assert.equal(decision.verdict, "WATCH");
  assert.equal(decision.actionable, false);
  assert.match(decision.rationale, /rest-of-season/i);
});

test("waiver policy does not spend FAB on a safe but weak 2.3 and 1.2 point edge", () => {
  const dropPlayer = player("replaceable-depth", "WR", 10);
  const decision = classifyWaiverEdge({
    addPlayer: player("small-edge", "WR", 12.3),
    drop: { playerId: dropPlayer.id, salary: 12, contractYear: 1, player: dropPlayer },
    currentDelta: { delta: 2.3, resilienceWeeks: 0 },
    nextThreeDelta: { delta: 1.2, resilienceWeeks: 0 },
    rosDelta: { delta: 0.2, resilienceWeeks: 0 },
    addValue: { week: 12.3, nextThree: 11.2, restOfSeason: 10.2 },
    dropValue: { week: 10, nextThree: 10, restOfSeason: 10 },
    depthDelta: { week: 2.3, nextThree: 1.2, restOfSeason: 0.2 },
    immediateNeed: false,
  });
  assert.equal(decision.verdict, "WATCH");
  assert.equal(decision.actionable, false);
  assert.match(decision.rationale, /minimum paid-bid thresholds/i);
});

test("waiver policy reserves RENTAL for a true lineup emergency with a major temporary edge", () => {
  const dropPlayer = player("replaceable", "WR", 10);
  const decision = classifyWaiverEdge({
    addPlayer: player("emergency-cover", "WR", 14),
    drop: { playerId: dropPlayer.id, salary: 12, contractYear: 1, player: dropPlayer },
    currentDelta: { delta: 3.4, resilienceWeeks: 1 },
    nextThreeDelta: { delta: 2.2, resilienceWeeks: 1 },
    rosDelta: { delta: -0.2, resilienceWeeks: 0 },
    addValue: { week: 14, nextThree: 12.2, restOfSeason: 10.1 },
    dropValue: { week: 10, nextThree: 10, restOfSeason: 10 },
    depthDelta: { week: 4, nextThree: 2.2, restOfSeason: 0.1 },
    immediateNeed: true,
  });
  assert.equal(decision.verdict, "RENTAL");
  assert.equal(decision.actionable, true);
  assert.match(decision.rationale, /emergency short-term rental/i);
});

test("waiver policy protects a cheap keeper asset without a material ROS replacement gain", () => {
  const rome = player("rome", "WR", 13, { name: "Rome Odunze", marketValue: 12 });
  rome.tier = 3;
  const decision = classifyWaiverEdge({
    addPlayer: player("small-upgrade", "WR", 14),
    drop: { playerId: rome.id, salary: 3, contractYear: 1, player: rome },
    currentDelta: { delta: 2.4, resilienceWeeks: 0 },
    nextThreeDelta: { delta: 1.4, resilienceWeeks: 0 },
    rosDelta: { delta: 0.4, resilienceWeeks: 0 },
    addValue: { week: 15.4, nextThree: 14.4, restOfSeason: 13.4 },
    dropValue: { week: 13, nextThree: 13, restOfSeason: 13 },
    depthDelta: { week: 2.4, nextThree: 1.4, restOfSeason: 0.4 },
    immediateNeed: false,
  });
  assert.equal(decision.verdict, "WATCH");
  assert.equal(decision.dropProtection.protected, true);
  assert.equal(decision.dropProtection.blocked, true);
  assert.match(decision.rationale, /low-cost keeper/i);
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
  assert.ok(["OFFER", "MONITOR", "PASS"].includes(base.recommendations[0].verdict));
  assert.ok(base.recommendations[0].receives[0].weekProjection);
  assert.ok(base.recommendations[0].rosterContext.rival.beforeCounts);
  assert.doesNotMatch(JSON.stringify(base.recommendations), /salary|contract|keeper/i);
});

test("trade classification passes thin or one-sided ideas and reserves OFFER for strong mutual value", () => {
  const thin = classifyTradeIdea({
    dogsDeltas: { week: 0.1, nextThree: 0.2, restOfSeason: 0.3, division: 0.1, playoffs: 0.2 },
    rivalDeltas: { week: -0.5, nextThree: -0.8, restOfSeason: 0.2, division: -0.6, playoffs: -0.7 },
    evidenceComplete: false,
    week: 1,
  });
  assert.equal(thin.verdict, "PASS");
  assert.equal(thin.confidence, "HIGH");
  const plausible = classifyTradeIdea({
    dogsDeltas: { week: 0, nextThree: 0.2, restOfSeason: 0.6, division: 0.3, playoffs: 0.5 },
    rivalDeltas: { week: 0, nextThree: 0, restOfSeason: 0, division: -0.1, playoffs: 0 },
    evidenceComplete: true,
    week: 1,
  });
  assert.equal(plausible.verdict, "MONITOR");
  const strong = classifyTradeIdea({
    dogsDeltas: { week: 0.8, nextThree: 0.9, restOfSeason: 1.5, division: 0.8, playoffs: 1 },
    rivalDeltas: { week: 0.4, nextThree: 0.4, restOfSeason: 0.6, division: 0.4, playoffs: 0.4 },
    evidenceComplete: true,
    week: 1,
  });
  assert.equal(strong.verdict, "OFFER");
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
  assert.equal(result.irTargets[0].longTermStashAnalysisActive, true);
  assert.equal(result.irTargets[0].acquisitionSalaryEvidence.known, false);
  assert.equal(result.irTargets[0].acquisitionSalaryEvidence.minimumPossible, 1);
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
  assert.equal(early.currentSalary, 7);
  assert.equal(early.longTermStashAnalysisActive, true);
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

test("the proposed trade analyzer supports legal multi-player three-team packages", () => {
  const makeTeam = (prefix, base) => [
    player(`${prefix}-qb`, "QB", base + 8),
    player(`${prefix}-rb-one`, "RB", base + 5),
    player(`${prefix}-rb-two`, "RB", base + 3),
    player(`${prefix}-wr-one`, "WR", base + 4),
    player(`${prefix}-wr-two`, "WR", base + 2),
    player(`${prefix}-te`, "TE", base + 1),
    player(`${prefix}-k`, "K", base),
    player(`${prefix}-dst`, "DST", base - 1),
  ];
  const dogs = makeTeam("dogs", 8);
  const orange = makeTeam("orange", 9);
  const hobbits = makeTeam("hobbits", 10);
  const pack = { players: [...dogs, ...orange, ...hobbits] };
  const leagueState = {
    authority: "authenticated CBS private league report",
    rostersReady: true,
    availablePlayerIds: [],
    teams: [
      { teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(dogs) },
      { teamId: "orange-crush", teamName: "Orange Crush", roster: rosterRows(orange) },
      { teamId: "the-hobbits", teamName: "The Hobbits", roster: rosterRows(hobbits) },
    ],
  };
  const result = analyzeTradeProposal({
    pack,
    leagueState,
    week: 1,
    transfers: [
      { fromTeamId: "dogs-of-war", toTeamId: "orange-crush", playerIds: ["dogs-rb-two"] },
      { fromTeamId: "orange-crush", toTeamId: "the-hobbits", playerIds: ["orange-rb-two"] },
      { fromTeamId: "the-hobbits", toTeamId: "dogs-of-war", playerIds: ["hobbits-rb-two"] },
    ],
  });
  assert.equal(result.teams.length, 3);
  assert.equal(result.teams.every((team) => team.afterRosterSize === 8), true);
  assert.ok(["GOOD IDEA", "POSSIBLE", "UNLIKELY", "DECLINE"].includes(result.verdict));
  assert.match(result.method, /Exact legal optimal lineups/);
});

test("a full 717-player weekly rebuild stays below the production response timeout", async () => {
  const pack = await readSeasonPack();
  const teamIds = ["dogs-of-war", "angry-face", "orange-crush", "big-head", "t-dogs", "super-suckers", "three-amigos", "goon-skwad", "el-guapo", "crime-and-punishment", "the-hobbits", "the-bungles"];
  const pools = new Map(["QB", "RB", "WR", "TE", "K", "DST"].map((position) => [position, pack.players.filter((candidate) => candidate.position === position)]));
  const cursors = new Map([...pools].map(([position]) => [position, 0]));
  const used = new Set();
  const take = (position) => {
    const pool = pools.get(position);
    const index = cursors.get(position);
    const candidate = pool[index];
    cursors.set(position, index + 1);
    used.add(candidate.id);
    return candidate;
  };
  const teams = teamIds.map((teamId) => {
    const required = [take("QB"), take("RB"), take("RB"), take("WR"), take("WR"), take("TE"), take("K"), take("DST")];
    return { teamId, teamName: teamId === "dogs-of-war" ? "Dogs of War" : teamId, roster: rosterRows(required) };
  });
  const extras = pack.players.filter((candidate) => !used.has(candidate.id));
  let extraIndex = 0;
  for (const team of teams) {
    while (team.roster.length < 14) {
      const candidate = extras[extraIndex++];
      used.add(candidate.id);
      team.roster.push(...rosterRows([candidate]));
    }
  }
  const leagueState = {
    source: "authenticated CBS all-team report",
    authority: "authenticated CBS private league report",
    capturedAt: "2026-09-08T12:00:00.000Z",
    rostersReady: true,
    teamCount: 12,
    legalTeamCount: 12,
    teams,
    availablePlayerIds: pack.players.filter((candidate) => !used.has(candidate.id)).map((candidate) => candidate.id),
    weeklyProjections: [],
    fabState: fabState(),
  };
  const started = performance.now();
  const result = buildSeasonRecommendationSnapshot({ pack, leagueState, week: 1, generatedAt: "2026-09-08T12:00:00.000Z" });
  const elapsed = performance.now() - started;
  assert.equal(result.playerStats.length, 717);
  assert.equal(result.league.teams.length, 12);
  assert.ok(result.playerStats.every((row) => Object.hasOwn(row, "divisionAverage") && Object.hasOwn(row, "playoffAverage")));
  assert.ok(elapsed < 12_000, `full weekly rebuild took ${elapsed.toFixed(0)} ms`);
});

test("private season shell supports full and per-source updates without auction navigation or caching", async () => {
  const [html, source, managementUi, css, worker, rootWorker, manifest, netlify, refreshHandler, snapshotHandler, aiHandler, backgroundAiHandler, backgroundRebuildHandler, seasonService, seasonStore] = await Promise.all([
    readFile(new URL("../public/thunder-bowl/season/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/season.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/season-management-ui.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/season.css", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/thunder-season-refresh.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/thunder-season-snapshot.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/thunder-season-ai-advice.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/thunder-season-ai-advice-background.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/thunder-season-rebuild-background.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_lib/season-service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_lib/season-store.mjs", import.meta.url), "utf8"),
  ]);
  assert.equal(RECOMMENDATION_ENGINE_VERSION, 17);
  for (const id of ["refresh-plan", "update-cbs-only", "update-fbg-only", "update-fp-only", "update-pff-only", "update-news-only", "refresh-team-news", "helper-setup", "helper-download", "fbg-file", "cbs-json-paste", "import-cbs-json-paste", "lineup-team", "lineup-week", "lineup-week-note", "scoring-preview-matchup", "starter-rows", "lineup-summary", "bench-rows", "waiver-list", "trade-board-summary", "trade-list", "move-list", "injury-list", "ir-list", "player-stats-rows", "team-news-list", "team-news-count", "team-news-updated", "trade-team-rows", "analyze-trade", "evidence-dialog", "evidence-eyebrow", "ai-run-lineup", "ai-view-lineup", "ai-run-waivers", "ai-view-waivers", "ai-run-trades", "ai-view-trades", "ai-run-trade-finder", "ai-view-trade-finder", "ai-run-stash-watch", "ai-view-stash-watch"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.ok(html.indexOf('id="lineup-summary"') < html.indexOf('class="bench-details"'));
  assert.ok(html.indexOf('class="bench-details"') < html.indexOf('id="swap-list"'));
  assert.equal((html.match(/Game \/ kickoff \(Denver\)/g) || []).length, 2);
  for (const label of ["Start/Sit", "Waiver Wire", "Trades", "Player Stats", "News", "Admin"]) assert.match(html, new RegExp(`>${label}<`));
  for (const key of ["name", "leagueStatus", "opponent", "bye", "sourceCount", "points", "range", "passingYards", "passingTouchdowns", "interceptionsThrown", "rushingAttempts", "rushingYards", "rushingTouchdowns", "receptions", "receivingYards", "receivingTouchdowns", "fumblesLost", "fieldGoalsMade", "extraPointsMade", "defensiveSacks", "defensiveInterceptions", "defensiveFumblesRecovered", "defensiveTouchdowns"]) assert.match(html, new RegExp(`data-player-sort="${key}"`));
  assert.match(html, /Click any column heading to sort/);
  assert.match(source, /function comparePlayerStats/);
  assert.match(source, /playerStatsView\.direction === "asc"/);
  assert.match(source, /button\[data-player-sort\]/);
  assert.match(source, /async function loadLineupSelection/);
  assert.match(source, /starter-alternatives-toggle/);
  assert.match(source, /value\.lineup\.freeAgentAlternatives/);
  assert.match(source, /const rows = eligible\.slice\(0, 25\)/);
  assert.match(source, /if \(current\.rebuildRequired\)/);
  assert.match(source, /if \(value\.rebuildRequired\)/);
  assert.match(source, /no stale add\/drop label or bid is actionable/);
  assert.match(source, /Rebuilding the current weekly plan automatically/);
  assert.match(source, /STRONG BID/);
  assert.match(source, /VALUE BID/);
  assert.match(source, /CBS did not expose your current remaining FAB balance/);
  assert.match(source, /row\.drop\.position/);
  assert.match(source, /verdict-\$\{String\(row\.verdict/);
  assert.match(css, /\.verdict-watch/);
  assert.match(css, /\.verdict-rental/);
  assert.match(source, /CBS-confirmed free agent/);
  assert.match(source, /url\.searchParams\.set\("week", String\(week\)\)/);
  assert.match(source, /url\.searchParams\.set\("team", teamId\)/);
  assert.match(source, /userOpponentTeamId/);
  assert.match(source, /Dogs' Week \$\{value\.week\} opponent/);
  assert.match(source, /Current week AI only/);
  assert.match(snapshotHandler, /searchParams\.get\("week"\)/);
  assert.match(snapshotHandler, /searchParams\.get\("team"\)/);
  assert.match(seasonService, /normalizeSeasonViewingWeek/);
  assert.match(seasonService, /normalizeSeasonViewingTeam/);
  assert.match(seasonService, /rebuildRequired = current\.recommendationEngineVersion !== RECOMMENDATION_ENGINE_VERSION/);
  assert.match(seasonService, /expectedRecommendationEngineVersion: RECOMMENDATION_ENGINE_VERSION/);
  assert.match(seasonService, /season: pack\.season,\s*week,\s*lineupTeamId,\s*packId: pack\.packId/);
  assert.doesNotMatch(seasonService, /captureFootballguysSource[\s\S]*?return \{\s*week,\s*lineupTeamId,/);
  assert.doesNotMatch(html, /id="player-sort"/);
  assert.match(html, />Update everything</);
  assert.match(html, /Two-sided current-season value/);
  for (const label of ["Update CBS", "Update FBG", "Update FantasyPros", "Update PFF", "Update injuries/news"]) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /Advanced recovery tools/);
  assert.match(html, /Paste captured CBS JSON/);
  assert.match(source, /CBS pasted-data import failed validation/);
  assert.match(source, /action: "sync-cbs", snapshot/);
  assert.doesNotMatch(html, /auction room|auction command center/i);
  assert.match(html, /\.\/manifest\.webmanifest/);
  assert.match(source, /action: "capture-cbs"/);
  assert.equal((source.match(/requestCbsRosterCapture\(\{ timeoutMs: 300_000, week: currentCaptureWeek\(\)/g) || []).length, 2);
  assert.match(seasonService, /function retainPriorCbsOptionalEvidence/);
  assert.match(seasonService, /prior\.fabState\?\.week === captured\.projectionWeek/);
  assert.match(seasonService, /captured\.projectionCount === 0/);
  assert.match(seasonService, /prior\.projectionWeek === captured\.projectionWeek/);
  assert.equal((seasonService.match(/const snapshot = retainPriorCbsOptionalEvidence\(captured, prior\)/g) || []).length, 2);
  assert.match(source, /requestFbgProjectionCapture/);
  assert.match(source, /action: "capture-fbg"/);
  assert.match(refreshHandler, /input\.action === "refresh-news"/);
  assert.match(source, /provider: "fantasyPros"/);
  assert.match(source, /provider: "pff"/);
  assert.match(source, /action: "capture-fantasypros"/);
  assert.match(source, /action: "capture-pff"/);
  assert.match(source, /action: "rebuild-plan"/);
  assert.match(source, /REBUILD_BACKGROUND_URL = "\/api\/thunder-bowl\/season\/rebuild-background"/);
  assert.match(source, /void watchQueuedPlan\(previousFingerprint, source\)/);
  assert.match(backgroundRebuildHandler, /refreshSeasonPlan\(\)/);
  assert.match(backgroundRebuildHandler, /verifySession\(request\)/);
  assert.match(backgroundRebuildHandler, /assertSameOrigin\(request\)/);
  assert.match(refreshHandler, /input\.action === "rebuild-plan"/);
  assert.match(refreshHandler, /return json\(await refreshSeasonPlan\(\)\)/);
  assert.match(aiHandler, /verifySession\(request\)/);
  assert.match(aiHandler, /assertSameOrigin\(request\)/);
  assert.match(aiHandler, /analyzeCurrentSeasonSectionWithAi/);
  assert.match(backgroundAiHandler, /runCurrentSeasonSectionWithAiInBackground/);
  assert.match(backgroundAiHandler, /background: true/);
  assert.match(backgroundAiHandler, /verifySession\(request\)/);
  assert.match(netlify, /\/api\/thunder-bowl\/season\/ai-advice/);
  assert.match(netlify, /\/api\/thunder-bowl\/season\/ai-advice-background/);
  assert.match(netlify, /\/api\/thunder-bowl\/season\/trade-analysis/);
  assert.match(seasonService, /readSeasonAiAdviceForPlan\(safeSection, plan\.sourceFingerprint\)/);
  assert.match(seasonService, /if \(existing\) return \{ advice: existing, cached: true, stale: false \}/);
  assert.match(seasonService, /const configured = String\(process\.env\.OPEN_API_KEY \|\| ""\)\.trim\(\)/);
  assert.match(seasonService, /configured\.match\(\/sk-\[A-Za-z0-9_-\]\{20,\}\//);
  assert.match(seasonService, /apiKey: configuredOpenAiKey\(\)/);
  assert.doesNotMatch(seasonService, /process\.env\.OPENAI_API_KEY/);
  assert.match(seasonService, /model: process\.env\.OPENAI_MODEL \|\| "gpt-5\.6-sol"/);
  assert.match(seasonStore, /ai-advice\/v1\/history\/\$\{advice\.section\}\/\$\{advice\.sourceFingerprint\}/);
  assert.match(seasonStore, /ai-advice\/v1\/latest\/\$\{advice\.section\}/);
  assert.match(seasonStore, /ai-advice\/v1\/jobs\/latest\/\$\{safeSection\}/);
  assert.match(source, /AI_ADVICE_BACKGROUND_URL = "\/api\/thunder-bowl\/season\/ai-advice-background"/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /index\.jobsBySection\?\.\[section\]/);
  assert.match(source, /still running safely in the background/);
  assert.match(source, /CBS was saved successfully/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /JSON\.stringify\(value/);
  assert.doesNotMatch(source, /metric\("Salary"/);
  assert.match(source, /buildEvidenceExplanation/);
  assert.match(source, /collectLatestPlayerNews/);
  assert.match(source, /buildTeamNewsFeed/);
  assert.match(source, /NEWS_STORED_URL = "\/api\/thunder-bowl\/news\?stored=1"/);
  assert.match(source, /RESEARCH_STORED_URL = "\/api\/thunder-bowl\/research\?stored=1"/);
  assert.match(source, /loadSavedPlayerNewsFromServer/);
  assert.match(source, /const STATUS_REFRESH_URL = "\/api\/thunder-bowl\/status\?force=1"/);
  assert.match(source, /const NEWS_REFRESH_URL = "\/api\/thunder-bowl\/news\?force=1"/);
  assert.match(source, /const RESEARCH_REFRESH_URL = "\/api\/thunder-bowl\/research\?force=1"/);
  assert.match(source, /PLAYER_NEWS_CACHE_KEY = "seasonAllPlayerNewsV1"/);
  assert.match(source, /refreshInjuriesAndAllPlayerNews/);
  assert.match(source, /privateJson\(STATUS_REFRESH_URL\)/);
  assert.match(source, /privateJson\(NEWS_REFRESH_URL\)/);
  assert.match(source, /privateJson\(RESEARCH_REFRESH_URL\)/);
  assert.match(source, /const rebuilt = await rebuildAfterSourceSave\("Injuries\/news"\)/);
  assert.match(source, /injuryNews: \{/);
  assert.match(source, /collectLatestPlayerNews\(player\.name, cached\.newsSnapshot, cached\.researchSnapshot\)/);
  assert.match(refreshHandler, /\["status", "research", "news"\]/);
  assert.match(refreshHandler, /newsSnapshot: publicSources\.newsSnapshot/);
  assert.match(seasonService, /currentNewsSnapshot\(\{ force: true \}\)/);
  assert.match(seasonService, /news: \{ ok: !newsRefreshError/);
  assert.match(source, /Latest news for \$\{player\.name\}/);
  assert.match(source, /Run AI analysis/);
  assert.match(source, /View saved advice/);
  assert.match(source, /Copy advice/);
  assert.match(source, /sortTradeProposals/);
  assert.match(source, /"trade-finder": "League-wide trade finder"/);
  assert.match(source, /"stash-watch": "Stash Watch"/);
  assert.match(source, /Find IR gems with AI/);
  assert.match(source, /2027 salary-cap trade leverage/);
  assert.match(source, /data\.cached/);
  assert.match(source, /recommendationNewsButtons\(\[row\.add, row\.drop\]\)/);
  assert.match(source, /recommendationNewsButtons\(\[\.\.\.row\.sends, \.\.\.row\.receives\]\)/);
  assert.match(source, /News: \$\{player\.name\}/);
  assert.match(source, /Recommended blind bid/);
  assert.match(source, /Do not exceed/);
  assert.match(source, /Remaining after a win/);
  for (const kind of ["starter", "bench", "free-agent", "swap", "waiver", "trade", "move", "injury", "ir"]) assert.match(source, new RegExp(`"${kind}"`));
  assert.match(source, /thunder-bowl-season-setup-required/);
  assert.match(source, /Too many recent access checks/);
  assert.match(source, /openCachedPlanWhileRefreshing/);
  assert.match(source, /saved plan is ready now; checking for the current weekly plan in the background/i);
  assert.match(source, /method: "GET", credentials: "same-origin", cache: "no-store", signal: AbortSignal\.timeout\(5_000\)/);
  assert.match(source, /update controls remain active/);
  assert.match(html, /maxlength="100"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /clientX < rect\.left/);
  assert.match(css, /@media \(max-width:620px\)/);
  assert.match(css, /\.source-update-button \{[^}]*min-height:44px/);
  assert.match(source, /register\("\.\/service-worker\.js", \{ scope: "\.\/" \}\)/);
  assert.match(worker, /\/thunder-bowl\/season\/index\.html/);
  assert.match(worker, /thunder-bowl-season-v53/);
  assert.doesNotMatch(worker, /auctioneer|draft-board|sample-draft-pack/);
  assert.match(worker, /season\.css\?v=20260912b/);
  assert.match(worker, /season\.mjs\?v=20260915e/);
  assert.match(worker, /season-kickoff\.mjs\?v=20260910a/);
  assert.match(worker, /season-news\.mjs\?v=20260901b/);
  assert.match(worker, /fbg-session-capture\.mjs\?v=20260912c/);
  assert.match(worker, /supplemental-session-capture\.mjs\?v=20260912c/);
  assert.match(worker, /season-evidence\.mjs\?v=20260914a/);
  assert.match(worker, /cbs-roster-snapshot\.mjs\?v=20260915a/);
  assert.match(source, /season-management-ui\.mjs\?v=20260915a/);
  assert.match(managementUi, /const checkpointState = m\.checkpoints \|\| \{\}/);
  assert.match(worker, /season-trade-ranking\.mjs\?v=20260901a/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(rootWorker, /thunder-bowl-shell-v140/);
  assert.doesNotMatch(rootWorker, /\/thunder-bowl\/season\/index\.html/);
  assert.equal(JSON.parse(manifest).scope, "/thunder-bowl/season/");
  assert.match(netlify, /from = "\/api\/thunder-bowl\/season\/snapshot"/);
  assert.match(netlify, /from = "\/api\/thunder-bowl\/season\/refresh"/);
  assert.match(netlify, /from = "\/api\/thunder-bowl\/season\/rebuild-background"/);
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
