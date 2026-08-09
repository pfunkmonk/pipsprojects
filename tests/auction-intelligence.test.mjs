import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { replayDraft } from "../public/thunder-bowl/state-engine.mjs";
import { calculateAuctionDemandMarket } from "../public/thunder-bowl/auction-demand.mjs";
import {
  empiricalBayesWeight,
  estimateTeamWillingnessToPay,
  forecastAuctionPrice,
  shrinkMultiplier,
  simulateRemainingAuctionForTarget,
  simulateSecondPriceAuction,
  teamBudgetPressure,
} from "../public/thunder-bowl/auction-intelligence.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));

test("manager tendencies are empirically shrunk toward the league before affecting WTP", () => {
  assert.equal(empiricalBayesWeight(0), 0);
  assert.equal(empiricalBayesWeight(40), 0.5);
  assert.equal(shrinkMultiplier(1.5, 0), 1);
  assert.equal(shrinkMultiplier(1.5, 40), 1.25);
  assert.ok(empiricalBayesWeight(10_000) <= 0.65);
});

test("budget pressure reserves only the legal eight-player starting lineup, not fourteen forced purchases", () => {
  const state = replayDraft([]);
  const dogs = teamBudgetPressure(state.teams["dogs-of-war"], state);
  assert.equal(dogs.cash, 104);
  assert.equal(dogs.completionReserve, 8);
  assert.equal(dogs.discretionaryDollars, 96);
  assert.ok(dogs.roomAverageDiscretionary > 90);
});

test("team WTP is capped by the actual legal bid and exposes every auditable factor", () => {
  const state = replayDraft([]);
  const market = calculateAuctionDemandMarket(pack, state);
  const player = pack.players.find((candidate) => candidate.name === "Jahmyr Gibbs");
  const profile = pack.managerProfiles.find((candidate) => candidate.teamId === "big-head");
  const estimate = estimateTeamWillingnessToPay({
    profile,
    state,
    player,
    liveMarketValue: market.valuesByPlayerId[player.id],
    packPlayers: pack.players,
    baselineValuesByPlayerId: market.valuesByPlayerId,
  });
  assert.equal(estimate.eligible, true);
  assert.ok(estimate.meanWtp <= estimate.legalMaxBid);
  assert.deepEqual(Object.keys(estimate.factors), ["position", "affinity", "budget", "need", "substitutes", "liveTelemetry"]);
  assert.ok(estimate.empiricalBayesWeight <= 0.65);
});

test("the simulated closing price is centered on second-highest WTP plus one", () => {
  const bidders = [
    { teamId: "a", teamName: "A", meanWtp: 20, legalMaxBid: 50, uncertaintyDollars: 3 },
    { teamId: "b", teamName: "B", meanWtp: 17, legalMaxBid: 50, uncertaintyDollars: 3 },
    { teamId: "c", teamName: "C", meanWtp: 9, legalMaxBid: 50, uncertaintyDollars: 3 },
  ];
  const forecast = simulateSecondPriceAuction(bidders, { samples: 384, seed: "second-price-test" });
  assert.equal(forecast.medianPrice, 18);
  assert.ok(forecast.range80.low <= forecast.medianPrice);
  assert.ok(forecast.range80.high >= forecast.medianPrice);
});

test("auction forecast remains advisory and separates natural price from Dogs participation", () => {
  const state = replayDraft([]);
  const market = calculateAuctionDemandMarket(pack, state);
  const player = pack.players.find((candidate) => candidate.name === "David Montgomery");
  const forecast = forecastAuctionPrice({
    profiles: pack.managerProfiles,
    state,
    player,
    liveMarketValue: market.valuesByPlayerId[player.id],
    packPlayers: pack.players,
    baselineValuesByPlayerId: market.valuesByPlayerId,
    dogsBidLimit: 7,
    seed: "montgomery-system-check",
  });
  assert.equal(forecast.modelEffect, "advisory_only_experimental");
  assert.equal(forecast.bidAuthority, "none");
  assert.equal(forecast.priceMechanism, "second-highest simulated willingness-to-pay plus one dollar");
  assert.ok(forecast.naturalSale.point >= 1);
  assert.equal(forecast.dogsParticipation.bidLimit, 7);
  assert.equal(forecast.calibration.status, "coarse_baseline_proxy_only");
  assert.equal(forecast.calibration.observedBaselineCoverage, 0.794);
  assert.ok(forecast.opponents.every((opponent) => opponent.teamId !== "dogs-of-war"));
  assert.equal(forecast.fullAuctionSimulation.samples, 96);
  assert.ok(forecast.fullAuctionSimulation.simulatedPlayers > 100);
  assert.equal(forecast.fullAuctionSimulation.modelEffect, "advisory_only_experimental");
});

test("remaining-auction rollouts are deterministic, cash-aware, and stay inside the draft-day speed gate", () => {
  const state = replayDraft([]);
  const market = calculateAuctionDemandMarket(pack, state);
  const player = pack.players.find((candidate) => candidate.name === "Jahmyr Gibbs");
  const input = {
    profiles: pack.managerProfiles,
    state,
    targetPlayer: player,
    packPlayers: pack.players,
    marketValuesByPlayerId: market.valuesByPlayerId,
    dogsBidLimit: 40,
    samples: 96,
    seed: "deterministic-room",
  };
  simulateRemainingAuctionForTarget(input);
  const started = performance.now();
  const first = simulateRemainingAuctionForTarget(input);
  const elapsed = performance.now() - started;
  const second = simulateRemainingAuctionForTarget(input);
  assert.deepEqual(first, second);
  assert.ok(first.natural.low >= 1);
  assert.ok(first.natural.high <= 106);
  assert.ok(elapsed < 100, `selected-player remaining-auction simulation took ${elapsed.toFixed(1)} ms`);
});
