import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { calculateAuctionDemandMarket } from "../public/thunder-bowl/auction-demand.mjs";
import { analyzeRosterSafety } from "../public/thunder-bowl/roster-safety.mjs";
import { replayDraft } from "../public/thunder-bowl/state-engine.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
const baseState = replayDraft([]);
const market = calculateAuctionDemandMarket(pack, baseState);

function safety(state, { priceInflation = 0, hypotheticalPurchase = null, seed = "rehearsal" } = {}) {
  return analyzeRosterSafety({
    state,
    players: pack.players,
    marketValueFor: (player) => market.valuesByPlayerId[player.id] ?? player.marketValue,
    bidLimitFor: (player) => player.maxBid,
    hypotheticalPurchase,
    samples: 192,
    priceInflation,
    seed,
  });
}

safety(baseState, { seed: "warmup" });
const started = performance.now();
const baseline = safety(baseState, { seed: "baseline" });
const elapsedMs = performance.now() - started;
const inflation = safety(baseState, { priceInflation: 0.2, seed: "inflation" });

const scarceIds = pack.players
  .filter((player) => ["RB", "WR"].includes(player.position))
  .sort((left, right) => right.vbd - left.vbd || left.id.localeCompare(right.id))
  .slice(0, 36)
  .map((player) => player.id);
const scarcityState = {
  ...baseState,
  activeEventCount: scarceIds.length,
  draftedPlayers: {
    ...baseState.draftedPlayers,
    ...Object.fromEntries(scarceIds.map((playerId) => [playerId, { teamId: "stress-rival" }])),
  },
};
const scarcity = safety(scarcityState, { seed: "rb-wr-scarcity" });

const eliteTarget = pack.players
  .filter((player) => ["RB", "WR"].includes(player.position))
  .sort((left, right) => right.maxBid - left.maxBid || left.id.localeCompare(right.id))[0];
const afterEliteWin = safety(baseState, {
  hypotheticalPurchase: { player: eliteTarget, price: eliteTarget.maxBid },
  seed: "elite-max-win",
});

const assertions = [
  [baseline.completionProbability >= 90, "Opening roster must retain a high-probability legal path."],
  [inflation.completionProbability <= baseline.completionProbability, "A 20% room shock cannot improve legal completion."],
  [inflation.strongPathProbability <= baseline.strongPathProbability, "A 20% room shock cannot improve strong-lineup access."],
  [scarcity.plannedStarterUtility <= baseline.plannedStarterUtility, "Removing the top RB/WR supply cannot improve the attainable starter portfolio."],
  [afterEliteWin.cash === baseState.teams["dogs-of-war"].cash - eliteTarget.maxBid, "What-if purchase must spend the exact winning price."],
  [afterEliteWin.missingStarters === 7, "An elite RB/WR win must fill exactly one required starter slot."],
  [elapsedMs < 100, `Opening 192-rollout safety pass exceeded 100 ms (${elapsedMs.toFixed(1)} ms).`],
  [baseline.bidAuthority === "none" && inflation.bidAuthority === "none", "Monte Carlo rehearsal must never acquire bid authority."],
];

const failures = assertions.filter(([passed]) => !passed).map(([, message]) => message);
const report = {
  schemaVersion: 1,
  kind: "thunder-bowl-foolproof-auction-rehearsal",
  packId: pack.packId,
  generatedAt: new Date().toISOString(),
  passed: failures.length === 0,
  speedMs: Math.round(elapsedMs * 10) / 10,
  scenarios: {
    baseline: { legal: baseline.completionProbability, strong: baseline.strongPathProbability, status: baseline.status.label },
    inflation20: { legal: inflation.completionProbability, strong: inflation.strongPathProbability, status: inflation.status.label },
    topRbWrRemoved: { legal: scarcity.completionProbability, strong: scarcity.strongPathProbability, status: scarcity.status.label },
    eliteMaxWin: { player: eliteTarget.name, price: eliteTarget.maxBid, legal: afterEliteWin.completionProbability, strong: afterEliteWin.strongPathProbability },
  },
  failures,
  modelEffect: "advisory_only",
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
