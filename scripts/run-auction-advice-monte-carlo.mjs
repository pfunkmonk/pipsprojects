import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateAuctionDemandMarket } from "../public/thunder-bowl/auction-demand.mjs";
import { forecastAuctionPrice } from "../public/thunder-bowl/auction-intelligence.mjs";
import { buildAuctionValueAdvice, buildDecisionContext } from "../public/thunder-bowl/decision-context.mjs";
import { analyzeRosterSafety } from "../public/thunder-bowl/roster-safety.mjs";
import { replayDraft } from "../public/thunder-bowl/state-engine.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pack = JSON.parse(await readFile(resolve(root, "netlify/functions/_data/draft-pack-2026-provisional.json"), "utf8"));
const state = replayDraft([]);
const market = calculateAuctionDemandMarket(pack, state);
const available = pack.players.filter((player) => !state.draftedPlayers[player.id]);
const candidates = [...available]
  .sort((left, right) => market.valuesByPlayerId[right.id] - market.valuesByPlayerId[left.id] || left.id.localeCompare(right.id))
  .slice(0, 36);
const rows = [];
const timings = [];

for (const player of candidates) {
  const started = performance.now();
  const maximum = market.bidCeilingsByPlayerId[player.id];
  const context = buildDecisionContext({
    selectedPlayer: player,
    availablePlayers: available,
    valueFor: (candidate) => market.bidCeilingsByPlayerId[candidate.id],
  });
  const forecast = forecastAuctionPrice({
    profiles: pack.managerProfiles,
    state,
    player,
    liveMarketValue: market.valuesByPlayerId[player.id],
    packPlayers: pack.players,
    baselineValuesByPlayerId: market.baselineValuesByPlayerId,
    marketValuesByPlayerId: market.valuesByPlayerId,
    dogsBidLimit: maximum,
    samples: 384,
    seed: `auction-advice-qa|${player.id}`,
  });
  const likelyPrice = Math.max(1, Math.min(maximum, forecast.naturalSale.point));
  const safety = analyzeRosterSafety({
    state,
    players: pack.players,
    marketValueFor: (candidate) => market.valuesByPlayerId[candidate.id],
    bidLimitFor: (candidate) => market.bidCeilingsByPlayerId[candidate.id],
    utilityFor: (candidate) => candidate.projectedPoints,
    hypotheticalPurchase: { player, price: likelyPrice },
    samples: 128,
    seed: `auction-advice-safety|${player.id}`,
  });
  const advice = buildAuctionValueAdvice({
    selectedPlayer: player,
    intrinsicValue: player.intrinsicValue,
    liveMarketValue: market.valuesByPlayerId[player.id],
    personalMaximum: maximum,
    sameTierRemaining: context.sameTierRemaining,
    nextAlternative: context.nextAlternative,
    rosterSafety: safety,
  });
  timings.push(performance.now() - started);
  if (advice.label === "BARGAIN") assert.ok(player.intrinsicValue > market.valuesByPlayerId[player.id]);
  if (advice.label === "TIER SAVE") {
    assert.ok(context.sameTierRemaining <= 1);
    assert.ok(safety.completionProbability >= 95);
    assert.ok(safety.strongPathProbability >= 60);
    assert.ok(maximum >= market.valuesByPlayerId[player.id]);
  }
  if (advice.label === "WAIT") assert.ok(market.valuesByPlayerId[player.id] >= player.intrinsicValue);
  assert.ok(forecast.dogsParticipation.winProbability >= 0 && forecast.dogsParticipation.winProbability <= 100);
  rows.push({
    player: player.name,
    position: player.position,
    intrinsic: player.intrinsicValue,
    market: market.valuesByPlayerId[player.id],
    maximum,
    naturalSale: forecast.naturalSale.point,
    winChanceAtMaximum: forecast.dogsParticipation.winProbability,
    tierSupply: context.sameTierRemaining,
    legalCompletionProbability: safety.completionProbability,
    strongPathProbability: safety.strongPathProbability,
    advice: advice.label,
  });
}

const sortedTimings = [...timings].sort((left, right) => left - right);
const percentile = (value) => sortedTimings[Math.min(sortedTimings.length - 1, Math.ceil(sortedTimings.length * value) - 1)];
const adviceCounts = Object.fromEntries([...new Set(rows.map((row) => row.advice))].sort().map((label) => [label, rows.filter((row) => row.advice === label).length]));
assert.ok(rows.some((row) => row.advice === "BARGAIN"));
assert.ok(rows.some((row) => row.advice === "FAIR" || row.advice === "WAIT"));
assert.ok(percentile(0.95) < 250, `P95 nomination advice took ${percentile(0.95).toFixed(1)} ms`);

const report = {
  schemaVersion: 1,
  modelVersion: "auction-value-advice-v1",
  generatedAt: new Date().toISOString(),
  packId: pack.packId,
  playersTested: rows.length,
  forecastSamplesPerPlayer: 384,
  remainingAuctionRolloutsPerPlayer: 96,
  rosterSafetyPathsPerPlayer: 128,
  adviceCounts,
  timingMs: {
    median: Number(percentile(0.5).toFixed(3)),
    p95: Number(percentile(0.95).toFixed(3)),
    maximum: Number(Math.max(...timings).toFixed(3)),
  },
  rows,
};
await writeFile(resolve(root, "reports/thunder-bowl/auction-advice-monte-carlo.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`Auction-advice Monte Carlo PASS: ${rows.length} players; ${384 + 96 + 128} stochastic paths/rollouts each; p95 ${report.timingMs.p95} ms; ${JSON.stringify(adviceCounts)}.`);
