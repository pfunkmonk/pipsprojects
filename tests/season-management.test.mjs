import test from "node:test";
import assert from "node:assert/strict";
import { buildGameDay, buildManagement, buildProjectionCalibration, checkpointSchedule, decisionCheckpoint, kickoffAt, outcomeReport, rosterFit, sourceAudit, stashComparison, waiverMarket, weeklyProjectionArchive, workloadTrends } from "../netlify/functions/_lib/season-management.mjs";
import { archiveManagementCheckpoint, archiveWeeklyProjections, mergeManagementRecords, readManagementState, saveManagementRecords, validateManagementRecords } from "../netlify/functions/_lib/season-management-store.mjs";
import { evidenceFromCsv, parseEvidenceCsv } from "../public/thunder-bowl/season/season-management-ui.mjs";

const now = "2026-09-08T12:00:00.000Z";
function fixture() {
  const starters = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DST"].map((position, i) => ({ playerId: `p${i}`, name: `Player ${i}`, position, points: 10 + i, nflTeam: "DEN", bye: 10, gameTime: "Sun 11:00am MT", sources: [{ source: "CBS", points: 10 + i, basis: "DIRECT_WEEKLY" }] }));
  const bench = [{ ...starters[0], playerId: "b", name: "Backup", points: 8, gameTime: "Thurs 6:35pm MT" }];
  return { season: 2026, week: 1, generatedAt: now, sourceFingerprint: "a".repeat(64), viewing: { mode: "CURRENT" },
    sourceAudit: [{ source: "CBS", retrievedAt: now, status: "RECENT_CAPTURE" }],
    lineup: { teamId: "dogs-of-war", teamName: "Dogs of War", starters, bench },
    scoringPreview: { status: "COMPLETE", week: 1, asOf: now, teams: [{ teamId: "dogs-of-war", starters }] },
    playerStats: [...starters, ...bench].map((p) => ({ ...p, leagueStatus: "DOGS OF WAR" })),
    league: { userTeamId: "dogs-of-war", teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster: [...starters, ...bench] }] },
    waivers: { recommendations: [], fab: { budget: 50, spendable: 40, plannedReserve: 10 } }, trades: { recommendations: [] }, watch: { irTargets: [] } };
}

test("source audit does not mistake a legacy capture timestamp for publication or accept the wrong week", () => {
  const audit = sourceAudit({ week: 1, now, leagueState: { capturedAt: now, projectionWeek: 1, projectionCount: 110 }, fbgSnapshot: { capturedAt: now, providerAsOf: now, week: 2, items: [{}] }, pffSnapshot: { capturedAt: "2026-08-31T12:00:00Z", week: 1, items: [{}] } });
  assert.equal(audit[0].status, "RECENT_CAPTURE"); assert.equal(audit[0].publishedAt, null);
  assert.equal(audit[1].status, "WRONG_WEEK"); assert.equal(audit[2].status, "MISSING"); assert.equal(audit[3].status, "STALE");
});
test("kickoff conversion respects Denver daylight and standard time, and rejects ambiguous times", () => {
  assert.equal(kickoffAt("Sun 2:25pm MT", 1), "2026-09-13T20:25:00.000Z");
  assert.equal(kickoffAt("Sun 2:25pm MT", 9), "2026-11-08T21:25:00.000Z");
  assert.equal(kickoffAt("Wed 6:20pm MT", 1), "2026-09-10T00:20:00.000Z");
  assert.equal(kickoffAt("Sun 11:00am", 1), null); assert.equal(kickoffAt("Sun 25:00pm MT", 1), null);
});
test("a backup that plays earlier creates an earlier decision deadline and locks after kickoff", () => {
  const plan = fixture();
  let day = buildGameDay(plan, now);
  assert.equal(day.verdict, "KEEP"); assert.equal(day.rows[0].backups[0].earlyDecision, true);
  assert.equal(day.rows[0].backups[0].decideBy, "2026-09-11T00:35:00.000Z");
  day = buildGameDay(plan, "2026-09-11T01:00:00Z"); assert.equal(day.rows[0].backups[0].status, "LOCKED");
});
test("submitted lineup mismatch is not called KEEP and missing times do not authorize a swap", () => {
  const plan = fixture(); plan.scoringPreview.teams[0].starters = [plan.lineup.bench[0], ...plan.lineup.starters.slice(1)];
  assert.equal(buildGameDay(plan, now).verdict, "REVIEW");
  plan.lineup.starters[0].gameTime = null;
  assert.equal(buildGameDay(plan, now).changes[0].status, "VERIFY_LOCK");
  plan.scoringPreview = null; assert.equal(buildGameDay(plan, now).verdict, "VERIFY_CBS");
});
test("workload trend needs observations, keeps missing fields unknown and cannot use future weeks", () => {
  const p = fixture().playerStats[0];
  const records = [{ kind: "usage", playerId: p.playerId, week: 1, snapShare: 30, targets: 2 }, { kind: "usage", playerId: p.playerId, week: 2, snapShare: 60, targets: 6 }, { kind: "usage", playerId: p.playerId, week: 3, snapShare: 0, targets: 0 }];
  assert.deepEqual(workloadTrends(records, [p], 2), []);
  const trend = workloadTrends(records, [p], 3)[0]; assert.equal(trend.signal, "BREAKOUT_WATCH"); assert.equal(trend.games, 2); assert.equal(trend.changes.length, 2);
  assert.equal(trend.changes[0].delta, 30);
});
test("fallback claims never spend above reserve, and a chain has only one possible success", () => {
  const plan = fixture(); plan.waivers.fab.spendable = 3;
  plan.waivers.recommendations = [1, 2].map((i) => ({ add: { playerId: `a${i}`, name: `Add ${i}`, position: "QB" }, drop: { playerId: "b", name: "Backup" }, fab: { recommended: 5, maximum: 8 } }));
  const market = waiverMarket(plan, []); assert.equal(market.chain.length, 2); assert.equal(market.maximumChainSpend, 3);
  assert.equal(market.chain[0].recommended, 3); assert.match(market.chain[1].condition, /earlier claim fails/);
  plan.waivers.fab.spendable = 0; assert.equal(waiverMarket(plan, []).chain.length, 0);
});
test("position bid history exposes sample size and does not infer losing bids", () => {
  const plan = fixture(); const p = plan.playerStats[0];
  plan.waivers.recommendations = [{ add: p, drop: null, fab: { recommended: 2, maximum: 8 } }];
  const records = Array.from({ length: 5 }, (_, i) => ({ kind: "bid", playerId: p.playerId, week: 1, outcome: "WON", amount: i + 3 }));
  const market = waiverMarket(plan, records); assert.equal(market.losingBids, 0); assert.equal(market.pricing[0].sampleCount, 5); assert.equal(market.pricing[0].recommended, 5);
});
test("trade fit shows new no-flex coverage gaps, without projecting current injury across the season", () => {
  const plan = fixture(); const players = new Map(plan.playerStats.map((p) => [p.playerId, p]));
  players.get("p1").injury = { status: "Out" };
  const fit = rosterFit(plan.league.teams[0].roster, players, 1);
  assert.ok(fit.byeGaps.some((r) => r.week === 1 && r.position === "RB"));
  assert.equal(fit.byeGaps.some((r) => r.week === 2 && r.position === "RB"), false);
});
test("IR comparison requires explicit fresh slot, eligibility, return and cost evidence", () => {
  const plan = fixture(); plan.watch.irTargets = [{ playerId: "p0", name: "Gem", leagueStatus: "AVAILABLE", position: "QB" }];
  assert.equal(stashComparison(plan, []).occupancy, "VERIFY_CBS");
  const records = [{ kind: "ir-slot", playerId: null, observedAt: now }, { kind: "stash", playerId: "p0", observedAt: now, eligible: true, returnEvidence: "Official return window reported", keeperCost: 3, nextYearValue: 15 }];
  assert.equal(stashComparison(plan, records).candidates[0].estimatedSurplus, 12);
  records[1].eligible = false; assert.equal(stashComparison(plan, records).candidates[0].estimatedSurplus, null);
  records[0].observedAt = "2026-09-01T00:00:00Z"; assert.equal(stashComparison(plan, records).occupancy, "VERIFY_CBS");
});
test("checkpoints reject future outlooks and retrospective freezes; actuals never fill missing with zero", () => {
  const plan = fixture(); const c = decisionCheckpoint(plan, now); assert.ok(c);
  assert.equal(c.checkpointType, "EARLY");
  assert.equal(c.roster[0].injury, null);
  assert.equal(c.roster[0].kickoffAt, "2026-09-13T17:00:00.000Z");
  assert.equal(decisionCheckpoint(plan, "2026-09-14T00:00:00Z"), null);
  plan.viewing.mode = "FORECAST"; assert.equal(decisionCheckpoint(plan, now), null);
  const report = outcomeReport([c], [{ kind: "result", week: 1, playerId: "p0", points: 0, final: true }]);
  assert.equal(report.weeks[0].observedPlayers, 1); assert.equal(report.weeks[0].meanAbsoluteError, 10);
  assert.equal(report.weeks[0].recommendedActualTotal, null); assert.equal(report.weeks[0].hindsightGap, null);
});
test("outcome scorecard selects latest eligible pregame checkpoint and compares exact legal lineup", () => {
  const plan = fixture(); const c = decisionCheckpoint(plan, now);
  const results = c.roster.map((p) => ({ kind: "result", week: 1, playerId: p.playerId, points: p.playerId === "b" ? 20 : 10, final: true }));
  const late = { ...c, capturedAt: "2026-09-14T00:00:00Z", roster: [] };
  const report = outcomeReport([c, late], results); assert.equal(report.weeks[0].recommendedActualTotal, 80); assert.equal(report.weeks[0].hindsightGap, 10); assert.equal(report.providers[0].sampleCount, 9);
  assert.deepEqual(report.lineupRegrets.map((row) => [row.position, row.sit, row.start, row.pointsGained]), [["QB", "Player 0", "Backup", 10]]);
});
test("the second checkpoint freezes Sunday-morning evidence without rewriting the early checkpoint", () => {
  const plan = fixture();
  const early = decisionCheckpoint(plan, now, "EARLY");
  plan.lineup.starters[0].injury = { status: "Questionable", updatedAt: "2026-09-12T15:00:00Z" };
  const final = decisionCheckpoint(plan, "2026-09-13T12:00:00Z", "FINAL");
  assert.ok(early && final);
  assert.equal(final.checkpointType, "FINAL");
  assert.equal(early.roster[0].injury, null);
  assert.equal(final.roster[0].injury.status, "Questionable");
  const schedule = checkpointSchedule(plan, [early, final], "2026-09-13T12:30:00Z");
  assert.equal(schedule.early.status, "CAPTURED");
  assert.equal(schedule.final.status, "CAPTURED");
});
test("weekly projection archive freezes every projected player and ranks direct providers against final actuals", () => {
  const plan = fixture();
  plan.playerStats[0].sources.push({ source: "PFF", points: 14, basis: "DIRECT_WEEKLY" });
  const archive = weeklyProjectionArchive(plan, now);
  assert.equal(archive.auditEligible, true);
  assert.equal(archive.players.length, plan.playerStats.length);
  assert.equal(archive.players[0].leagueStatus, "DOGS OF WAR");
  assert.equal(archive.players[0].auditEligible, true);
  const results = archive.players.map((player) => ({ kind: "result", season: 2026, week: 1, playerId: player.playerId, points: player.points, final: true }));
  const report = outcomeReport([], results, [archive]);
  assert.equal(report.projectionWeeks[0].projectedPlayers, plan.playerStats.length);
  assert.equal(report.projectionWeeks[0].meanAbsoluteError, 0);
  assert.equal(report.providers[0].source, "CBS");
  assert.equal(report.providers[0].rank, 1);
  assert.ok(report.providers.find((provider) => provider.source === "PFF").meanAbsoluteError > 0);
  assert.equal(weeklyProjectionArchive(plan, "2026-09-14T00:00:00Z").auditEligible, false);
});
test("provider scorecard measures same-roster pairwise accuracy and decision regret", () => {
  const plan = fixture();
  for (const player of plan.playerStats) player.ownerTeamId = "dogs-of-war";
  plan.playerStats.find((player) => player.playerId === "b").sources = [{ source: "CBS", points: 8, basis: "DIRECT_WEEKLY" }];
  const archive = weeklyProjectionArchive(plan, now);
  const results = archive.players.map((player) => ({ kind: "result", season: 2026, week: 1, playerId: player.playerId,
    points: player.playerId === "b" ? 30 : player.playerId === "p0" ? 5 : player.points, final: true }));
  const report = outcomeReport([], results, [archive]);
  const cbs = report.providers.find((row) => row.source === "CBS");
  assert.ok(cbs.decisionCount > 0);
  assert.ok(cbs.meanDecisionRegret > 0);
  assert.ok(cbs.decisionAccuracy < 1);
});
test("adaptive calibration is position-specific, conservative, and cannot see target-week results", () => {
  const archives = [1, 2].map((week) => ({
    season: 2026, week, auditEligible: true,
    players: Array.from({ length: 40 }, (_, index) => ({ playerId: `w${week}-qb${index}`, position: "QB", points: 20,
      sources: [
        { source: "CBS", points: 21, basis: "DIRECT_WEEKLY" }, { source: "Footballguys", points: 23, basis: "DIRECT_WEEKLY" },
        { source: "FantasyPros", points: 24, basis: "DIRECT_WEEKLY" }, { source: "PFF", points: 26, basis: "DIRECT_WEEKLY" },
      ] })),
  }));
  const records = archives.flatMap((archive) => archive.players.map((player) => ({ kind: "result", final: true, week: archive.week, playerId: player.playerId, points: 20 })));
  const calibration = buildProjectionCalibration(archives, records, 3);
  assert.equal(calibration.active, true);
  assert.equal(calibration.positions.QB.active, true);
  assert.ok(calibration.positions.QB.weights.CBS > calibration.positions.QB.sources.find((row) => row.source === "CBS").baselineWeight);
  assert.ok(calibration.positions.QB.weights.PFF < calibration.positions.QB.sources.find((row) => row.source === "PFF").baselineWeight);
  assert.ok(Math.abs(calibration.positions.QB.sources.find((row) => row.source === "CBS").change) <= 0.05);
  assert.equal(calibration.positions.RB.active, false);
  assert.equal(calibration.positions.QB.uncertainty.active, true);
  assert.equal(calibration.positions.QB.uncertainty.halfWidth, 0);
  const targetWeekArchive = { ...structuredClone(archives[0]), week: 3, players: archives[0].players.map((player) => ({ ...player, playerId: `leak-${player.playerId}` })) };
  const targetWeekResults = targetWeekArchive.players.map((player) => ({ kind: "result", final: true, week: 3, playerId: player.playerId, points: 26 }));
  assert.deepEqual(buildProjectionCalibration([...archives, targetWeekArchive], [...records, ...targetWeekResults], 3), calibration);
});
test("CSV supports quoted commas/newlines and rejects ambiguous or malformed input", () => {
  assert.deepEqual(parseEvidenceCsv('a,b\r\n"x,y","two\nlines"'), [["a", "b"], ["x,y", "two\nlines"]]);
  assert.throws(() => parseEvidenceCsv('a\n"broken'), /unclosed/);
  const options = { kind: "usage", week: 1, season: 2026, observedAt: "2026-09-15T12:00:00Z", sourceUrl: "https://example.com/report", players: fixture().playerStats };
  const r = evidenceFromCsv("player,targets\nPlayer 0,0", options)[0]; assert.equal(r.targets, 0); assert.equal(r.playerId, "p0"); assert.equal(r.snapShare, undefined);
  assert.throws(() => evidenceFromCsv("player,targets\nWrong,3", options), /unambiguous/);
  assert.throws(() => evidenceFromCsv("player,targets\nPlayer 0,Infinity", options), /numeric/);
});
test("evidence validation enforces identities, completed weeks, finite numbers, explicit outcomes and source links", () => {
  const p = fixture(); const pack = { season: 2026, players: p.playerStats.map((p) => ({ id: p.playerId })) };
  const r = { kind: "usage", playerId: "p0", season: 2026, week: 1, observedAt: "2026-09-15T12:00:00Z", sourceUrl: "https://example.com/report", targets: 3 };
  const validate = (r) => validateManagementRecords([r], pack, p.league.teams, "2026-09-16T12:00:00Z");
  assert.equal(validate(r)[0].targets, 3);
  for (const wrong of [{ targets: NaN }, { playerId: "missing" }, { season: 2025 }, { observedAt: now }, { sourceUrl: "javascript:alert(1)" }, { kind: "result", targets: undefined, points: 10, final: false }]) assert.throws(() => validate({ ...r, ...wrong }));
});
function fakeStore() {
  const entries = new Map(); let version = 0;
  return { get: async (k) => structuredClone(entries.get(k)?.data ?? null), getWithMetadata: async (k) => structuredClone(entries.get(k) ?? null),
    setJSON: async (k, data, options = {}) => { const old = entries.get(k); if (options.onlyIfNew && old || options.onlyIfMatch && old?.etag !== options.onlyIfMatch) return { modified: false }; entries.set(k, { data: structuredClone(data), etag: String(++version) }); return { modified: true, etag: String(version) }; }, entries };
}
test("private history survives reopening, repeated captures, and concurrent imports", async () => {
  const db = fakeStore(); const p = fixture();
  const rows = [1, 2].map((i) => ({ id: `r${i}`, kind: "bid", observedAt: now, amount: i }));
  await Promise.all(rows.map((r) => saveManagementRecords([r], db)));
  let state = await readManagementState(db); assert.equal(state.records.length, 2);
  await archiveManagementCheckpoint(p, now, db); await archiveManagementCheckpoint(p, now, db);
  state = await readManagementState(db); assert.equal(state.checkpoints.length, 1); assert.equal(state.records.length, 2);
  assert.equal(mergeManagementRecords(rows, [{ ...rows[0], observedAt: "2026-01-01T00:00:00Z", amount: 20 }])[0].amount, 1);
});
test("weekly projection storage is write-once and survives reopening", async () => {
  const db = fakeStore(); const plan = fixture();
  const first = await archiveWeeklyProjections(plan, now, db);
  plan.playerStats[0].points = 99;
  const repeated = await archiveWeeklyProjections(plan, "2026-09-08T13:00:00.000Z", db);
  assert.equal(repeated.capturedAt, first.capturedAt);
  const state = await readManagementState(db);
  assert.equal(state.projectionArchives.length, 1);
  assert.notEqual(state.projectionArchives[0].players[0].points, 99);
  await db.setJSON("management/v1/projection-archives/2026/week-2", { ...first, week: 2 });
  const firstWeekOnly = await readManagementState(db, { throughWeek: 1 });
  assert.deepEqual(firstWeekOnly.projectionArchives.map((archive) => archive.week), [1]);
});
test("management checklist does not say no changes when source freshness has expired", () => {
  const p = fixture(); const m = buildManagement(p, { now: "2026-09-11T12:00:00Z" });
  assert.equal(m.sourceAudit[0].status, "STALE"); assert.match(m.actions[0].title, /Refresh/);
});
