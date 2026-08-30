import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { optimizeExactLineup, recommendWaivers } from "../netlify/functions/_lib/season-recommendations.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
const rosterShape = { QB: 2, RB: 4, WR: 4, TE: 2, K: 1, DST: 1 };
const week = 1;

function points(player) {
  return Number(player.weeklyProjection?.points?.[week - 1]) || -1;
}

function selectRoster(direction = "desc") {
  return Object.entries(rosterShape).flatMap(([position, count]) => pack.players
    .filter((player) => player.position === position && points(player) >= 0)
    .sort((left, right) => direction === "desc" ? points(right) - points(left) : points(left) - points(right))
    .slice(0, count));
}

function rosterRows(players) {
  return players.map((player, index) => ({ playerId: player.id, salary: index + 1, contractYear: 1, opponent: null, gameTime: null, bye: player.weeklyProjection?.byeWeek ?? null }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const strongRoster = selectRoster("desc");
const strongById = new Map(strongRoster.map((player) => [player.id, player]));
const baseline = optimizeExactLineup(rosterRows(strongRoster), { week, playerById: strongById });
assert(baseline.starters.length === 8 && baseline.bench.length === 6 && baseline.missingSlots.length === 0, "Exact lineup invariant failed.");

const benchRb = baseline.bench.find((row) => row.player.position === "RB");
const fbgRows = new Map([[`${benchRb.playerId}|${week}`, {
  playerId: benchRb.playerId,
  week,
  points: Math.max(...baseline.starters.filter((row) => row.player.position === "RB").map((row) => row.projection.points)) + 5,
  floor: null,
  ceiling: null,
  providerAsOf: "2026-09-08T11:00:00.000Z",
}]]);
const projectionPerturbation = optimizeExactLineup(rosterRows(strongRoster), { week, playerById: strongById, fbgRows });
assert(projectionPerturbation.starters.some((row) => row.playerId === benchRb.playerId), "A registered weekly projection change did not alter the lineup.");

const topRb = baseline.starters.find((row) => row.player.position === "RB");
const injured = optimizeExactLineup(rosterRows(strongRoster), {
  week,
  playerById: strongById,
  statuses: new Map([[topRb.playerId, { playerId: topRb.playerId, severity: "critical", injuryStatus: "Out" }]]),
});
assert(!injured.starters.some((row) => row.playerId === topRb.playerId), "A critical injury remained in the starting lineup.");

const missingPlayers = structuredClone(strongRoster);
const missingTarget = missingPlayers.find((player) => player.id === topRb.playerId);
missingTarget.weeklyProjection.points[week - 1] = null;
const missing = optimizeExactLineup(rosterRows(missingPlayers), { week, playerById: new Map(missingPlayers.map((player) => [player.id, player])) });
assert(!missing.starters.some((row) => row.playerId === topRb.playerId), "A missing projection was treated as a usable zero.");

const weakRoster = selectRoster("asc");
const freeAgent = pack.players
  .filter((player) => player.position === "RB" && !weakRoster.some((rostered) => rostered.id === player.id) && points(player) >= 0)
  .sort((left, right) => points(right) - points(left))[0];
const waivers = recommendWaivers({
  pack,
  leagueState: {
    authority: "authenticated league roster and availability authority",
    capturedAt: "2026-09-08T12:00:00.000Z",
    teams: [{ teamId: "dogs-of-war", teamName: "Dogs of War", roster: rosterRows(weakRoster) }],
    availablePlayerIds: [freeAgent.id],
  },
  week,
});
assert(waivers.recommendations.every((row) => row.add.playerId === freeAgent.id), "Waiver advice escaped the CBS-confirmed availability set.");
assert(waivers.recommendations.every((row) => weakRoster.some((player) => player.id === row.drop.playerId)), "Waiver advice did not pair a rostered drop.");

const result = {
  schemaVersion: 1,
  kind: "thunder-bowl-season-advice-preseason-backtest",
  season: 2026,
  testedAt: new Date().toISOString(),
  packId: pack.packId,
  playerCount: pack.players.length,
  scope: "preseason engineering invariants and perturbation sensitivity; no completed 2026 weekly outcomes exist",
  outcomeCalibration: "BLOCKED_UNTIL_COMPLETED_WEEKS",
  checks: {
    exactLineupShape: "PASS",
    benchExcluded: baseline.starters.length === 8 && baseline.bench.length === 6 ? "PASS" : "FAIL",
    registeredProjectionChangesDecision: "PASS",
    criticalInjuryRemovesStarter: "PASS",
    missingProjectionExcludedNotZero: "PASS",
    waiversRestrictedToCbsAvailability: "PASS",
    waiversPairLegalRosterDrop: "PASS",
  },
  baselineWeekOneTotal: baseline.total,
  perturbedWeekOneTotal: projectionPerturbation.total,
};
const { testedAt: _testedAt, ...deterministicResult } = result;
result.resultSha256 = createHash("sha256").update(JSON.stringify(deterministicResult)).digest("hex");
console.log(JSON.stringify(result, null, 2));
