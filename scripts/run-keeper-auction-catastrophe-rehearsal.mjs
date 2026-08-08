import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVENT_TYPES,
  POSITIONS,
  RuleViolation,
  createEvent,
  createRecoveryBundle,
  mergeEventStreams,
  replayDraft,
  toPublicSnapshot,
  validateDraftPack,
  validateRecoveryBundle,
} from "../public/thunder-bowl/state-engine.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const reportDirectory = resolve(root, "reports", "thunder-bowl");
const packPath = resolve(root, "netlify", "functions", "_data", "draft-pack-2026-provisional.json");
const enginePath = resolve(root, "public", "thunder-bowl", "state-engine.mjs");
const [packBytes, engineBytes, scriptBytes] = await Promise.all([
  readFile(packPath),
  readFile(enginePath),
  readFile(scriptPath),
]);
const pack = validateDraftPack(JSON.parse(packBytes.toString("utf8")));
const playerById = new Map(pack.players.map((player) => [player.id, player]));
const teamById = new Map(pack.leagueConfig.teams.map((team) => [team.id, team]));
const deviceId = "device-catastrophe-rehearsal";
const eventTime = (index) => new Date(Date.UTC(2026, 7, 29, 17, 30, index)).toISOString();
const forbiddenPublicFields = ["projectedPoints", "projectionSources", "weeklyProjection", "weeklyContext", "managerProfiles", "pressureIndex", "opponentPressure", "vbd", "intrinsicValue", "marketValue", "maxBid", "notes", "injury", "sos", "evidenceStatus", "surplus"];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value) {
  return sha256(JSON.stringify(value));
}

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

function publicSnapshotIsSafe(state, revision) {
  const snapshot = toPublicSnapshot(state, { revision, updatedAt: eventTime(eventIndex) });
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of forbiddenPublicFields) {
    assert.equal(serialized.includes(forbidden), false, `Public snapshot leaked ${forbidden}.`);
  }
  return snapshot;
}

function eligibleCandidates(teamId, excludedIds = new Set()) {
  return pack.keeperCandidates
    .filter((candidate) => candidate.teamId === teamId && candidate.keeperYear <= 3 && !excludedIds.has(candidate.playerId))
    .sort((left, right) => left.keeperSalary - right.keeperSalary || right.surplus - left.surplus || left.playerName.localeCompare(right.playerName));
}

function plannedAuctionPositions(team) {
  const positions = [];
  for (const position of POSITIONS) {
    const missing = Math.max(0, pack.leagueConfig.starterRequirements[position] - team.positionCounts[position]);
    for (let index = 0; index < missing; index += 1) positions.push(position);
  }
  const filler = ["RB", "WR", "RB", "WR", "QB", "TE"];
  let fillerIndex = 0;
  while (positions.length < team.openSlots) {
    positions.push(filler[fillerIndex % filler.length]);
    fillerIndex += 1;
  }
  return positions;
}

let eventIndex = 0;
function makeEvent(type, payload, device = deviceId) {
  const index = eventIndex;
  eventIndex += 1;
  return createEvent(type, payload, {
    id: `catastrophe-event-${String(index).padStart(4, "0")}`,
    deviceId: device,
    createdAt: eventTime(index),
  });
}

const events = [makeEvent(EVENT_TYPES.DRAFT_CONFIGURED, pack.leagueConfig)];
let state = replayDraft(events);
const setupReplayTimings = [];
const saleReplayTimings = [];
const publicSnapshotTimings = [];

function appendAndReplay(event, timings = setupReplayTimings) {
  events.push(event);
  const started = performance.now();
  state = replayDraft(events);
  timings.push(performance.now() - started);
  return state;
}

const capTransfer = makeEvent(EVENT_TYPES.CAP_TRANSFERRED, {
  fromTeamId: "goon-skwad",
  toTeamId: "dogs-of-war",
  amount: 2,
  reason: "Justin Herbert rights catastrophe rehearsal",
});
appendAndReplay(capTransfer);
assert.equal(state.teams["goon-skwad"].startingCap, 104);
assert.equal(state.teams["dogs-of-war"].startingCap, 106);

const herbertCandidate = pack.keeperCandidates.find((candidate) => candidate.playerName === "Justin Herbert" && candidate.teamId === "dogs-of-war");
assert.ok(herbertCandidate, "Justin Herbert must exist in the Dogs of War keeper evidence.");
assert.ok(herbertCandidate.keeperYear <= 3, "Justin Herbert must remain legally keepable in 2026.");
const herbertPlayer = playerById.get(herbertCandidate.playerId);
assert.ok(herbertPlayer, "Justin Herbert keeper evidence must resolve to the player pool.");
const herbertPayload = {
  playerId: herbertPlayer.id,
  playerName: herbertPlayer.name,
  position: herbertPlayer.position,
  nflTeam: herbertPlayer.nflTeam,
  salary: herbertCandidate.keeperSalary,
  keeperYear: herbertCandidate.keeperYear,
  source: "Authenticated 2026 keeper candidate",
};

const mistakenKeeper = makeEvent(EVENT_TYPES.KEEPER_ASSIGNED, { ...herbertPayload, teamId: "dogs-of-war" });
appendAndReplay(mistakenKeeper);
assert.equal(state.draftedPlayers[herbertPlayer.id].teamId, "dogs-of-war");
const keeperCorrection = makeEvent(EVENT_TYPES.EVENT_VOIDED, {
  targetEventId: mistakenKeeper.id,
  reason: "Correct traded keeper destination",
});
appendAndReplay(keeperCorrection);
assert.equal(state.draftedPlayers[herbertPlayer.id], undefined);
assert.equal(state.teams["dogs-of-war"].roster.length, 0);

const correctedKeeper = makeEvent(EVENT_TYPES.KEEPER_ASSIGNED, { ...herbertPayload, teamId: "goon-skwad" });
appendAndReplay(correctedKeeper);
assert.equal(state.draftedPlayers[herbertPlayer.id].teamId, "goon-skwad");

const selectedKeeperIds = new Set([herbertPlayer.id]);
for (const configuredTeam of pack.leagueConfig.teams) {
  const alreadyAssigned = configuredTeam.id === "goon-skwad" ? 1 : 0;
  const excluded = new Set(selectedKeeperIds);
  if (configuredTeam.id === "dogs-of-war") excluded.add(herbertPlayer.id);
  const choices = eligibleCandidates(configuredTeam.id, excluded).slice(0, 2 - alreadyAssigned);
  assert.equal(choices.length, 2 - alreadyAssigned, `${configuredTeam.name} needs two legal rehearsal keepers.`);
  for (const candidate of choices) {
    const player = playerById.get(candidate.playerId);
    assert.ok(player, `${candidate.playerName} must resolve to the 2026 player pool.`);
    appendAndReplay(makeEvent(EVENT_TYPES.KEEPER_ASSIGNED, {
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      teamId: configuredTeam.id,
      salary: candidate.keeperSalary,
      keeperYear: candidate.keeperYear,
      source: "Authenticated 2026 keeper candidate",
    }));
    selectedKeeperIds.add(player.id);
  }
}

assert.equal(state.totalPlayers, 24);
assert.equal(state.saleCount, 0);
for (const configuredTeam of pack.leagueConfig.teams) {
  const keepers = state.teams[configuredTeam.id].roster.filter((player) => player.acquisitionType === "keeper");
  assert.equal(keepers.length, 2, `${configuredTeam.name} should have two rehearsal keepers.`);
  assert.ok(keepers.every((player) => player.keeperYear <= 3));
}
const setupSnapshotStarted = performance.now();
const setupSnapshot = publicSnapshotIsSafe(state, "setup-complete");
publicSnapshotTimings.push(performance.now() - setupSnapshotStarted);
assert.equal(setupSnapshot.totalPlayers, 24);

const draftedIds = new Set(Object.keys(state.draftedPlayers));
const poolsByPosition = Object.fromEntries(POSITIONS.map((position) => [
  position,
  pack.players
    .filter((player) => player.position === position && !draftedIds.has(player.id))
    .sort((left, right) => right.marketValue - left.marketValue || right.vbd - left.vbd || left.name.localeCompare(right.name)),
]));
const auctionPlans = new Map(pack.leagueConfig.teams.map((team) => [team.id, plannedAuctionPositions(state.teams[team.id])]));
const priceByRound = [8, 7, 6, 5, 4, 3, 2, 2, 1, 1, 1, 1];
let activeSaleOrdinal = 0;
let illegalBidCheck = null;
let saleCorrection = null;

for (let round = 0; round < 12; round += 1) {
  for (const configuredTeam of pack.leagueConfig.teams) {
    activeSaleOrdinal += 1;
    const position = auctionPlans.get(configuredTeam.id)[round];
    let player = poolsByPosition[position].shift();
    while (player && state.draftedPlayers[player.id]) player = poolsByPosition[position].shift();
    assert.ok(player, `The rehearsal player pool needs another ${position}.`);
    const amount = priceByRound[round];
    const payload = {
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      teamId: configuredTeam.id,
      amount,
      nominatorTeamId: state.currentNominatorTeamId,
    };

    if (activeSaleOrdinal === 111) {
      const illegalAmount = state.teams[configuredTeam.id].legalMaxBid + 1;
      const illegal = makeEvent(EVENT_TYPES.PLAYER_SOLD, { ...payload, amount: illegalAmount }, "device-offline-invalid");
      assert.throws(
        () => replayDraft([...events, illegal]),
        (error) => error instanceof RuleViolation && error.code === "ILLEGAL_BID",
      );
      illegalBidCheck = { activeSaleOrdinal, teamId: configuredTeam.id, rejectedAmount: illegalAmount };
    }

    if (activeSaleOrdinal === 73) {
      const wrong = makeEvent(EVENT_TYPES.PLAYER_SOLD, { ...payload, amount: amount + 1 }, "device-offline-primary");
      appendAndReplay(wrong, saleReplayTimings);
      const voidEvent = makeEvent(EVENT_TYPES.EVENT_VOIDED, {
        targetEventId: wrong.id,
        reason: "Correct offline winning price",
      }, "device-offline-primary");
      appendAndReplay(voidEvent, saleReplayTimings);
      saleCorrection = { activeSaleOrdinal, wrongEventId: wrong.id, voidEventId: voidEvent.id, correctedAmount: amount };
      payload.nominatorTeamId = state.currentNominatorTeamId;
    }

    appendAndReplay(makeEvent(EVENT_TYPES.PLAYER_SOLD, payload, activeSaleOrdinal > 72 ? "device-offline-primary" : deviceId), saleReplayTimings);
    if (activeSaleOrdinal % 24 === 0) {
      const publicStarted = performance.now();
      publicSnapshotIsSafe(state, `sale-${activeSaleOrdinal}`);
      publicSnapshotTimings.push(performance.now() - publicStarted);
    }
  }
}

assert.equal(activeSaleOrdinal, 144);
assert.equal(state.saleCount, 144);
assert.equal(state.totalPlayers, 168);
assert.equal(state.currentNominatorTeamId, null);
assert.ok(illegalBidCheck);
assert.ok(saleCorrection);
for (const configuredTeam of pack.leagueConfig.teams) {
  const team = state.teams[configuredTeam.id];
  assert.equal(team.roster.length, 14, `${team.name} must finish with 14 players.`);
  assert.equal(team.openSlots, 0);
  assert.equal(team.legalMaxBid, 0);
  assert.equal(team.missingStarterSlots, 0);
  assert.equal(team.roster.filter((player) => player.acquisitionType === "keeper").length, 2);
}
const finalHerbert = state.teams["goon-skwad"].roster.find((player) => player.playerId === herbertPlayer.id);
assert.deepEqual(
  { teamId: state.draftedPlayers[herbertPlayer.id].teamId, price: finalHerbert.price, keeperYear: finalHerbert.keeperYear },
  { teamId: "goon-skwad", price: 4, keeperYear: 2 },
);

let disconnectIndex = 1;
for (let index = 1; index <= events.length; index += 1) {
  if (replayDraft(events.slice(0, index)).saleCount === 72) {
    disconnectIndex = index;
    break;
  }
}
const canonicalBeforeOutage = events.slice(0, disconnectIndex);
const offlineSnapshot = replayDraft(canonicalBeforeOutage);
assert.equal(offlineSnapshot.saleCount, 72);
const reconnectStarted = performance.now();
const mergedEvents = mergeEventStreams(canonicalBeforeOutage, events);
const reconnectMs = performance.now() - reconnectStarted;
assert.equal(mergedEvents.length, events.length);
assert.equal(hashJson(mergedEvents), hashJson(events));
assert.deepEqual(replayDraft(mergedEvents), state);
const secondMerge = mergeEventStreams(mergedEvents, events);
assert.equal(hashJson(secondMerge), hashJson(events));

const recoveryStarted = performance.now();
const recovery = createRecoveryBundle(pack, events, eventTime(eventIndex));
const restored = validateRecoveryBundle(JSON.parse(JSON.stringify(recovery)));
const recoveryMs = performance.now() - recoveryStarted;
assert.equal(restored.pack.packId, pack.packId);
assert.equal(hashJson(restored.events), hashJson(events));
assert.deepEqual(replayDraft(restored.events), state);

const finalPublicStarted = performance.now();
const finalPublic = publicSnapshotIsSafe(state, "catastrophe-final");
publicSnapshotTimings.push(performance.now() - finalPublicStarted);
assert.equal(finalPublic.status, "complete");
assert.equal(finalPublic.totalPlayers, 168);
assert.equal(finalPublic.totalCash, state.totalCash);

const replayPerformance = timingSummary([...setupReplayTimings, ...saleReplayTimings]);
const publicPerformance = timingSummary(publicSnapshotTimings);
const checks = {
  realValidated2026PackUsed: pack.status === "practice" && pack.players.length === 716,
  capTransferDirectionCorrect: state.teams["goon-skwad"].startingCap === 104 && state.teams["dogs-of-war"].startingCap === 106,
  tradedKeeperPreservesSalaryAndYear: finalHerbert.price === 4 && finalHerbert.keeperYear === 2,
  keeperCorrectionIsAppendOnly: events.some((event) => event.type === EVENT_TYPES.EVENT_VOIDED && event.payload.targetEventId === mistakenKeeper.id),
  twentyFourLegalKeepers: pack.leagueConfig.teams.every((team) => state.teams[team.id].roster.filter((player) => player.acquisitionType === "keeper").length === 2),
  oneHundredFortyFourSales: state.saleCount === 144,
  completeLegalRosters: pack.leagueConfig.teams.every((team) => state.teams[team.id].roster.length === 14 && state.teams[team.id].missingStarterSlots === 0),
  illegalBidRejected: Boolean(illegalBidCheck),
  offlinePriceCorrectionReplayed: Boolean(saleCorrection),
  offlineMergeExactAndIdempotent: hashJson(mergedEvents) === hashJson(events) && hashJson(secondMerge) === hashJson(events),
  recoveryRoundTripExact: hashJson(restored.events) === hashJson(events),
  projectorFieldIsolationThroughout: true,
  replayP95Under50Ms: replayPerformance.p95Ms < 50,
  publicSnapshotP95Under50Ms: publicPerformance.p95Ms < 50,
  reconnectUnder250Ms: reconnectMs < 250,
  recoveryUnder1000Ms: recoveryMs < 1000,
};
const passed = Object.values(checks).every(Boolean);
const report = {
  schemaVersion: 1,
  kind: "thunder-bowl-keeper-auction-catastrophe-rehearsal",
  generatedAt: new Date().toISOString(),
  scope: "Deterministic full-system keeper, cap-trade, auction, offline divergence, reconnect, recovery, public-boundary, and latency gate; not a substitute for the final human-paced usability rehearsal.",
  passed,
  pins: {
    packSha256: sha256(packBytes),
    engineSha256: sha256(engineBytes),
    scriptSha256: sha256(scriptBytes),
  },
  pack: {
    id: pack.packId,
    players: pack.players.length,
    keeperCandidates: pack.keeperCandidates.length,
    teams: pack.leagueConfig.teams.length,
  },
  ledger: {
    physicalEvents: events.length,
    activeEvents: state.activeEventCount,
    activeKeepers: 24,
    activeSales: state.saleCount,
    capTransferEventId: capTransfer.id,
    keeperCorrection: { mistakenEventId: mistakenKeeper.id, voidEventId: keeperCorrection.id, correctedEventId: correctedKeeper.id },
    saleCorrection,
    illegalBidCheck,
    sha256: hashJson(events),
  },
  outage: {
    disconnectAtActiveSales: 72,
    canonicalPhysicalEvents: canonicalBeforeOutage.length,
    offlinePhysicalEvents: events.length - canonicalBeforeOutage.length,
    mergedPhysicalEvents: mergedEvents.length,
    reconnectMs: Number(reconnectMs.toFixed(4)),
    exact: hashJson(mergedEvents) === hashJson(events),
    idempotent: hashJson(secondMerge) === hashJson(events),
  },
  recovery: {
    durationMs: Number(recoveryMs.toFixed(4)),
    eventCount: restored.events.length,
    exact: hashJson(restored.events) === hashJson(events),
  },
  performance: {
    eventReplay: replayPerformance,
    publicSnapshot: publicPerformance,
  },
  finalState: {
    totalPlayers: state.totalPlayers,
    totalCash: state.totalCash,
    teams: pack.leagueConfig.teams.map((team) => ({
      id: team.id,
      name: team.name,
      startingCap: state.teams[team.id].startingCap,
      cash: state.teams[team.id].cash,
      roster: state.teams[team.id].roster.length,
      keepers: state.teams[team.id].roster.filter((player) => player.acquisitionType === "keeper").length,
      positionCounts: state.teams[team.id].positionCounts,
    })),
  },
  checks,
};

const checkLines = Object.entries(checks).map(([name, value]) => `| ${name} | ${value ? "PASS" : "FAIL"} |`).join("\n");
const teamLines = report.finalState.teams.map((team) => `| ${team.name} | $${team.startingCap} | ${team.keepers} | ${team.roster} | $${team.cash} | ${Object.entries(team.positionCounts).map(([position, count]) => `${position} ${count}`).join(", ")} |`).join("\n");
const markdown = `# Thunder Bowl 2026 — Keeper-to-Auction Catastrophe Rehearsal

Generated: ${report.generatedAt}

Result: **${passed ? "PASS" : "FAIL"}**

This deterministic gate uses the active validated 716-player practice pack. It records the Herbert cap trade, corrects a mistaken keeper destination with an append-only void, assigns 24 legal keepers, completes the other 144 purchases, rejects an illegal maximum bid, corrects an offline price, merges a 72-sale outage exactly and idempotently, round-trips the full private recovery bundle, and tests the public/private boundary throughout. It does not replace the final human-paced usability rehearsal.

## Workload

- ${pack.players.length} current practice players and ${pack.keeperCandidates.length} authenticated keeper candidates
- 12 teams × 2 keepers + 144 auction purchases = 168 final rostered players
- ${events.length} physical audit events; ${state.activeEventCount} active events
- Event replay p95: ${replayPerformance.p95Ms} ms; maximum: ${replayPerformance.maximumMs} ms
- Public snapshot p95: ${publicPerformance.p95Ms} ms; maximum: ${publicPerformance.maximumMs} ms
- Offline reconnect merge: ${report.outage.reconnectMs} ms
- Recovery validation/replay: ${report.recovery.durationMs} ms

## Gate checks

| Check | Result |
|---|---|
${checkLines}

## Final rosters

| Team | Cap after trade | Keepers | Players | Cash left | Positions |
|---|---:|---:|---:|---:|---|
${teamLines}

Pack SHA-256: \`${report.pins.packSha256}\`

Engine SHA-256: \`${report.pins.engineSha256}\`

Ledger SHA-256: \`${report.ledger.sha256}\`
`;

await mkdir(reportDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(reportDirectory, "keeper-auction-catastrophe-rehearsal.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(resolve(reportDirectory, "keeper-auction-catastrophe-rehearsal.md"), markdown, "utf8"),
]);

if (!passed) throw new Error("Keeper-to-auction catastrophe rehearsal did not pass every gate.");
console.log(`Keeper-to-auction catastrophe rehearsal PASS: 24 keepers, 144 sales, replay p95 ${replayPerformance.p95Ms} ms, reconnect ${report.outage.reconnectMs} ms, recovery ${report.recovery.durationMs} ms.`);
