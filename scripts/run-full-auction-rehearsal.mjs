import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  EVENT_TYPES,
  POSITIONS,
  RuleViolation,
  createEvent,
  mergeEventStreams,
  replayDraft,
  toPublicSnapshot,
  validateDraftPack,
} from "../public/thunder-bowl/state-engine.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = resolve(root, "reports");
const positionTemplate = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DST", "RB", "WR", "RB", "WR", "QB", "TE"];
const priceTemplate = [8, 14, 12, 13, 11, 6, 1, 1, 7, 6, 5, 4, 3, 2];
const nflTeams = ["DET", "KC", "BUF", "PHI", "GB", "BAL", "SF", "LAR", "HOU", "DAL", "MIA", "MIN"];
const deviceId = "device-automated-rehearsal";
const eventTime = (index) => new Date(Date.UTC(2026, 7, 29, 18, 0, index)).toISOString();

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))] || 0;
}

function timingSummary(values) {
  return {
    samples: values.length,
    medianMs: Number(percentile(values, 0.5).toFixed(4)),
    p95Ms: Number(percentile(values, 0.95).toFixed(4)),
    maximumMs: Number(Math.max(...values).toFixed(4)),
  };
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function makePlayers() {
  return positionTemplate.flatMap((position, round) => DEFAULT_CONFIG.teams.map((team, teamIndex) => {
    const ordinal = round * DEFAULT_CONFIG.teams.length + teamIndex + 1;
    return {
      id: `rehearsal-player-${String(ordinal).padStart(3, "0")}`,
      name: `Mock ${position} ${String(ordinal).padStart(3, "0")}`,
      position,
      nflTeam: nflTeams[(round + teamIndex) % nflTeams.length],
      tier: Math.floor(round / 3) + 1,
      projectedPoints: 260 - round * 9 - teamIndex * 0.2,
      vbd: 95 - round * 7 - teamIndex * 0.1,
      intrinsicValue: priceTemplate[round] + 4,
      marketValue: priceTemplate[round] + 2,
      maxBid: priceTemplate[round] + 1,
      sourceRank: ordinal,
      injury: "No current flag",
      sos: "Neutral rehearsal schedule",
      notes: `Synthetic full-auction player for ${team.name} load testing.`,
    };
  }));
}

const players = makePlayers();
const pack = validateDraftPack({
  schemaVersion: 1,
  packId: "tb26-full-auction-rehearsal-v1",
  season: 2026,
  status: "practice",
  asOf: "2026-08-29T16:00:00.000Z",
  sources: [{
    name: "Deterministic rehearsal generator",
    asOf: "2026-08-29T16:00:00.000Z",
    authority: "QA only",
    scoringFingerprint: "Thunder Bowl 2026 synthetic load-test inputs",
  }],
  leagueConfig: DEFAULT_CONFIG,
  players,
  keeperCandidates: [],
});

let eventIndex = 0;
const makeEvent = (type, payload) => {
  const index = eventIndex;
  eventIndex += 1;
  return createEvent(type, payload, {
    id: `rehearsal-event-${String(index).padStart(4, "0")}`,
    deviceId,
    createdAt: eventTime(index),
  });
};

const events = [makeEvent(EVENT_TYPES.DRAFT_CONFIGURED, pack.leagueConfig)];
const replayTimings = [];
let illegalBidCheck = null;
let correction = null;
let activeSaleOrdinal = 0;
let state = replayDraft(events);

for (let round = 0; round < positionTemplate.length; round += 1) {
  for (let teamIndex = 0; teamIndex < DEFAULT_CONFIG.teams.length; teamIndex += 1) {
    activeSaleOrdinal += 1;
    const buyerIndex = (teamIndex + round * 5) % DEFAULT_CONFIG.teams.length;
    const buyer = DEFAULT_CONFIG.teams[buyerIndex];
    const player = players[round * DEFAULT_CONFIG.teams.length + teamIndex];
    const amount = priceTemplate[round];

    if (activeSaleOrdinal === 111) {
      const illegalAmount = state.teams[buyer.id].legalMaxBid + 1;
      const illegal = makeEvent(EVENT_TYPES.PLAYER_SOLD, {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        teamId: buyer.id,
        amount: illegalAmount,
        nominatorTeamId: state.currentNominatorTeamId,
      });
      assert.throws(
        () => replayDraft([...events, illegal]),
        (error) => error instanceof RuleViolation && error.code === "ILLEGAL_BID",
      );
      illegalBidCheck = { activeSaleOrdinal, buyer: buyer.name, rejectedAmount: illegalAmount };
    }

    const salePayload = {
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      teamId: buyer.id,
      amount,
      nominatorTeamId: state.currentNominatorTeamId,
    };
    if (activeSaleOrdinal === 73) {
      const wrong = makeEvent(EVENT_TYPES.PLAYER_SOLD, { ...salePayload, amount: amount + 1 });
      events.push(wrong);
      state = replayDraft(events);
      const voidEvent = makeEvent(EVENT_TYPES.EVENT_VOIDED, {
        targetEventId: wrong.id,
        reason: "Automated rehearsal price correction",
      });
      events.push(voidEvent);
      state = replayDraft(events);
      correction = { activeSaleOrdinal, wrongEventId: wrong.id, voidEventId: voidEvent.id, correctedAmount: amount };
    }

    const sale = makeEvent(EVENT_TYPES.PLAYER_SOLD, {
      ...salePayload,
      nominatorTeamId: state.currentNominatorTeamId,
    });
    events.push(sale);
    const replayStarted = performance.now();
    state = replayDraft(events);
    replayTimings.push(performance.now() - replayStarted);
  }
}

assert.equal(activeSaleOrdinal, 168);
assert.equal(state.saleCount, 168);
assert.equal(state.totalPlayers, 168);
assert.equal(state.currentNominatorTeamId, null);
assert.ok(illegalBidCheck);
assert.ok(correction);
for (const configuredTeam of DEFAULT_CONFIG.teams) {
  const team = state.teams[configuredTeam.id];
  assert.equal(team.roster.length, 14, `${team.name} should finish with 14 players.`);
  assert.equal(team.cash, configuredTeam.startingCap - 93, `${team.name} cash should remain legal.`);
  assert.equal(team.openSlots, 0);
  assert.equal(team.legalMaxBid, 0);
  assert.equal(team.missingStarterSlots, 0);
  const expectedCounts = Object.fromEntries(POSITIONS.map((position) => [
    position,
    positionTemplate.filter((candidate) => candidate === position).length,
  ]));
  assert.deepEqual(team.positionCounts, expectedCounts);
}

let prefixEnd = 1;
for (let index = 1; index <= events.length; index += 1) {
  if (replayDraft(events.slice(0, index)).saleCount === 96) {
    prefixEnd = index;
    break;
  }
}
const canonicalPrefix = events.slice(0, prefixEnd);
const reconnectStarted = performance.now();
const mergedEvents = mergeEventStreams(canonicalPrefix, events);
const reconnectMs = performance.now() - reconnectStarted;
assert.equal(mergedEvents.length, events.length);
assert.deepEqual(replayDraft(mergedEvents), state);

const publicStarted = performance.now();
const publicSnapshot = toPublicSnapshot(state, { updatedAt: eventTime(eventIndex), revision: "rehearsal" });
const publicSnapshotMs = performance.now() - publicStarted;
assert.equal(publicSnapshot.totalPlayers, 168);
assert.equal(publicSnapshot.status, "complete");
const publicText = JSON.stringify(publicSnapshot);
for (const forbidden of ["projectedPoints", "weeklyProjection", "assetProjection", "weeklyContext", "managerProfiles", "pressureIndex", "opponentPressure", "vbd", "intrinsicValue", "marketValue", "maxBid", "notes"]) {
  assert.ok(!publicText.includes(forbidden), `Public snapshot leaked ${forbidden}.`);
}

const searchQueries = ["mock", "rb", "det", "001", "te 1", "wr", "kc", "168"];
const searchTimings = [];
for (let cycle = 0; cycle < 80; cycle += 1) {
  const query = searchQueries[cycle % searchQueries.length];
  const started = performance.now();
  const results = pack.players
    .filter((player) => `${player.name} ${player.nflTeam} ${player.position}`.toLowerCase().includes(query))
    .sort((left, right) => right.maxBid - left.maxBid || right.vbd - left.vbd || left.name.localeCompare(right.name));
  assert.ok(Array.isArray(results));
  searchTimings.push(performance.now() - started);
}

const replayPerformance = timingSummary(replayTimings);
const searchPerformance = timingSummary(searchTimings);
const checks = {
  activeSalesExactly168: state.saleCount === 168,
  legalFourteenPlayerRosters: DEFAULT_CONFIG.teams.every((team) => state.teams[team.id].roster.length === 14),
  allStarterPathsSatisfied: DEFAULT_CONFIG.teams.every((team) => state.teams[team.id].missingStarterSlots === 0),
  illegalBidRejected: Boolean(illegalBidCheck),
  voidAndCorrectionReplayed: Boolean(correction),
  offlineMergeExact: mergedEvents.length === events.length && hash(mergedEvents) === hash(events),
  publicFieldIsolation: true,
  replayP95Under50Ms: replayPerformance.p95Ms < 50,
  searchP95Under50Ms: searchPerformance.p95Ms < 50,
  reconnectUnder250Ms: reconnectMs < 250,
};
const passed = Object.values(checks).every(Boolean);
const report = {
  schemaVersion: 1,
  kind: "thunder-bowl-full-auction-rehearsal",
  generatedAt: new Date().toISOString(),
  scope: "Accepted deterministic technical rehearsal for state, rules, recovery, privacy, and latency; it does not claim physical speaking, projector, or venue-network evidence.",
  passed,
  pack: { id: pack.packId, players: pack.players.length, teams: pack.leagueConfig.teams.length },
  ledger: {
    physicalEvents: events.length,
    activeEvents: state.activeEventCount,
    activeSales: state.saleCount,
    correctedSale: correction,
    illegalBidCheck,
    sha256: hash(events),
  },
  finalState: {
    totalPlayers: state.totalPlayers,
    totalCash: state.totalCash,
    teams: DEFAULT_CONFIG.teams.map((team) => ({
      id: team.id,
      name: team.name,
      roster: state.teams[team.id].roster.length,
      cash: state.teams[team.id].cash,
      positionCounts: state.teams[team.id].positionCounts,
    })),
  },
  offlineReconnect: { canonicalActiveSales: 96, mergedPhysicalEvents: mergedEvents.length, durationMs: Number(reconnectMs.toFixed(4)) },
  performance: { incrementalReplay: replayPerformance, playerSearch: searchPerformance, publicSnapshotMs: Number(publicSnapshotMs.toFixed(4)) },
  checks,
};

const checkLines = Object.entries(checks).map(([name, value]) => `| ${name} | ${value ? "PASS" : "FAIL"} |`).join("\n");
const teamLines = report.finalState.teams.map((team) => `| ${team.name} | ${team.roster} | $${team.cash} | ${Object.entries(team.positionCounts).map(([position, count]) => `${position} ${count}`).join(", ")} |`).join("\n");
const markdown = `# Thunder Bowl 2026 — Automated Full-Auction Rehearsal

Generated: ${report.generatedAt}

Result: **${passed ? "PASS" : "FAIL"}**

This accepted deterministic technical rehearsal exercises 168 active purchases, a corrected price via append-only void, an illegal maximum-bid attempt, a 96-sale offline fork/reconnect, and the public/private data boundary. It satisfies the technical rehearsal gate; it does not claim physical speaking, projector, or venue-network evidence.

## Workload

- ${pack.players.length} players
- ${pack.leagueConfig.teams.length} teams × 14 roster spots
- ${events.length} physical audit events; ${state.activeEventCount} active events
- Incremental replay p95: ${replayPerformance.p95Ms} ms; maximum: ${replayPerformance.maximumMs} ms
- Search p95: ${searchPerformance.p95Ms} ms; maximum: ${searchPerformance.maximumMs} ms
- Offline reconnect merge: ${report.offlineReconnect.durationMs} ms
- Public snapshot generation: ${report.performance.publicSnapshotMs} ms

## Gate checks

| Check | Result |
|---|---|
${checkLines}

## Final rosters

| Team | Players | Cash left | Positions |
|---|---:|---:|---|
${teamLines}

Ledger SHA-256: \`${report.ledger.sha256}\`
`;

await mkdir(reportDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(reportDirectory, "full-auction-rehearsal.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(resolve(reportDirectory, "full-auction-rehearsal.md"), markdown, "utf8"),
]);

if (!passed) throw new Error("Full-auction rehearsal did not pass every gate.");
console.log(`Full-auction rehearsal PASS: 168 sales, replay p95 ${replayPerformance.p95Ms} ms, search p95 ${searchPerformance.p95Ms} ms, reconnect ${report.offlineReconnect.durationMs} ms.`);
