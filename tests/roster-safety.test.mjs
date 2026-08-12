import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRosterSafety } from "../public/thunder-bowl/roster-safety.mjs";

const requirements = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };

function player(position, index, { market = 5, cap = 12, points = 100 } = {}) {
  return {
    id: `${position.toLowerCase()}-${index}`,
    name: `${position} Player ${index}`,
    position,
    tier: Math.ceil(index / 2),
    projectedPoints: points - index,
    marketValue: market,
    maxBid: cap,
  };
}

function pool(overrides = {}) {
  return [
    ...Array.from({ length: 4 }, (_, index) => player("QB", index + 1, overrides)),
    ...Array.from({ length: 8 }, (_, index) => player("RB", index + 1, overrides)),
    ...Array.from({ length: 8 }, (_, index) => player("WR", index + 1, overrides)),
    ...Array.from({ length: 4 }, (_, index) => player("TE", index + 1, overrides)),
    ...Array.from({ length: 4 }, (_, index) => player("K", index + 1, overrides)),
    ...Array.from({ length: 4 }, (_, index) => player("DST", index + 1, overrides)),
  ];
}

function state({ cash = 60, roster = [], counts = {} } = {}) {
  const positionCounts = Object.fromEntries(Object.keys(requirements).map((position) => [position, counts[position] || 0]));
  return {
    activeEventCount: roster.length,
    draftedPlayers: Object.fromEntries(roster.map((entry) => [entry.playerId, { teamId: "dogs-of-war" }])),
    config: { rosterSize: 14, minimumBid: 1, starterRequirements: requirements },
    teams: {
      "dogs-of-war": {
        id: "dogs-of-war",
        cash,
        roster,
        positionCounts,
        openSlots: 14 - roster.length,
        minimumRosterSize: 8,
      },
    },
  };
}

function analyze(options = {}) {
  const players = options.players || pool();
  return analyzeRosterSafety({
    state: options.state || state(),
    players,
    marketValueFor: (candidate) => candidate.marketValue,
    bidLimitFor: (candidate) => candidate.maxBid,
    samples: options.samples || 192,
    seed: options.seed || "roster-safety-test",
    hypotheticalPurchase: options.hypotheticalPurchase || null,
    priceInflation: options.priceInflation || 0,
  });
}

test("whole-roster safety separates legal completion from a strong starter path", () => {
  const result = analyze();
  assert.equal(result.modelEffect, "advisory_only");
  assert.equal(result.bidAuthority, "none");
  assert.equal(result.missingStarters, 8);
  assert.equal(result.completionProbability, 100);
  assert.ok(result.strongPathProbability >= 90);
  assert.equal(result.status.level, "good");
  assert.equal(result.lanes.length, 6);
  assert.ok(result.lanes.find((lane) => lane.position === "RB").targetAdds >= 3);
  assert.equal(result.lanes.reduce((sum, lane) => sum + lane.plannedDollars, 0), result.cash);
});

test("missing or unaffordable starter supply fails closed", () => {
  const players = pool().map((candidate) => candidate.position === "DST" ? { ...candidate, maxBid: 0 } : candidate);
  const result = analyze({ players });
  assert.equal(result.completionProbability, 0);
  assert.equal(result.deterministicFeasible, false);
  assert.equal(result.status.level, "danger");
  assert.equal(result.lanes.find((lane) => lane.position === "DST").risk, "blocked");
});

test("position and room inflation stress cannot improve roster safety", () => {
  const players = pool({ market: 7, cap: 8, points: 120 });
  const baseline = analyze({ players, seed: "same-stress-seed" });
  const stressed = analyze({ players, seed: "same-stress-seed", priceInflation: 0.2 });
  assert.ok(stressed.completionProbability <= baseline.completionProbability);
  assert.ok(stressed.strongPathProbability <= baseline.strongPathProbability);
});

test("what-if purchase recomputes cash, slots, and remaining starter needs without changing authority", () => {
  const players = pool();
  const target = players.find((candidate) => candidate.position === "RB");
  const result = analyze({ hypotheticalPurchase: { player: target, price: 15 } });
  assert.equal(result.cash, 45);
  assert.equal(result.openSlots, 13);
  assert.equal(result.missingStarters, 7);
  assert.deepEqual(result.hypotheticalPurchase, { playerId: target.id, playerName: target.name, price: 15 });
  assert.equal(result.bidAuthority, "none");
});

test("192 portfolio rollouts remain inside the draft-day interaction budget", () => {
  analyze({ samples: 192 });
  const started = performance.now();
  analyze({ samples: 192, seed: "timed-safety" });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `roster safety took ${elapsed.toFixed(1)} ms`);
});
