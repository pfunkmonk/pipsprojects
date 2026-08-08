import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { calculateThunderValue } from "../public/thunder-bowl/thunder-value.mjs";

const requirements = { QB: 1, RB: 1 };
const emptyCounts = { QB: 0, RB: 0 };

test("Thunder Value finds the exact roster-aware break-even bid", () => {
  const result = calculateThunderValue({
    players: [
      { id: "qb-a", position: "QB", price: 4, utility: 10 },
      { id: "qb-b", position: "QB", price: 2, utility: 8 },
      { id: "target", position: "RB", price: 6, utility: 10 },
      { id: "rb-alt", position: "RB", price: 2, utility: 5 },
    ],
    candidateId: "target",
    cash: 10,
    openSlots: 2,
    positionCounts: emptyCounts,
    starterRequirements: requirements,
  });
  assert.equal(result.bestWithoutUtility, 15);
  assert.equal(result.forcedAtExpectedUtility, 20);
  assert.equal(result.edgeAtExpected, 5);
  assert.equal(result.thunderCeiling, 8);
  assert.equal(result.dollarEdge, 2);
  assert.equal(result.authority, "experimental_no_bid_effect");
});

test("candidate inclusion reduces the outstanding starter requirement exactly once", () => {
  const result = calculateThunderValue({
    players: [
      { id: "target", position: "RB", price: 3, utility: 7 },
      { id: "rb-alt", position: "RB", price: 1, utility: 1 },
      { id: "wr-a", position: "WR", price: 2, utility: 5 },
    ],
    candidateId: "target",
    cash: 5,
    openSlots: 2,
    positionCounts: { RB: 0, WR: 0 },
    starterRequirements: { RB: 1, WR: 1 },
  });
  assert.equal(result.expectedPriceFeasible, true);
  assert.equal(result.forcedAtExpectedUtility, 12);
});

test("malformed, duplicate, and impossible pools fail closed", () => {
  assert.throws(() => calculateThunderValue({ players: [], candidateId: "x", cash: 10, openSlots: 2, positionCounts: emptyCounts, starterRequirements: requirements }), /player pool/);
  assert.throws(() => calculateThunderValue({
    players: [
      { id: "x", position: "QB", price: 1, utility: 1 },
      { id: "x", position: "RB", price: 1, utility: 1 },
    ],
    candidateId: "x",
    cash: 10,
    openSlots: 2,
    positionCounts: emptyCounts,
    starterRequirements: requirements,
  }), /duplicated/);
  assert.throws(() => calculateThunderValue({
    players: [{ id: "x", position: "QB", price: 1, utility: 1 }],
    candidateId: "x",
    cash: 1,
    openSlots: 1,
    positionCounts: emptyCounts,
    starterRequirements: requirements,
  }), /cannot satisfy/);
});

test("target-size selected-player calculation stays below the 100 ms product gate after warm-up", async () => {
  const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
  const players = pack.players.map((player) => ({
    id: player.id,
    position: player.position,
    price: player.marketValue,
    utility: Math.max(0, player.vbd),
  }));
  const input = {
    players,
    candidateId: players.find((player) => player.position === "RB").id,
    cash: 104,
    openSlots: 14,
    positionCounts: Object.fromEntries(Object.keys(pack.leagueConfig.starterRequirements).map((position) => [position, 0])),
    starterRequirements: pack.leagueConfig.starterRequirements,
  };
  calculateThunderValue(input);
  const durations = [];
  for (let index = 0; index < 8; index += 1) {
    const started = performance.now();
    const result = calculateThunderValue(input);
    durations.push(performance.now() - started);
    assert.ok(result.thunderCeiling >= 1);
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  assert.ok(p95 < 100, `Thunder Value p95 ${p95.toFixed(2)} ms exceeded 100 ms`);
});

test("the killed challenger has no live application or offline-shell authority", async () => {
  const [appSource, serviceWorker] = await Promise.all([
    readFile(new URL("../public/thunder-bowl/app.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/service-worker.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(appSource, /from ["'].+thunder-value\.mjs/);
  assert.doesNotMatch(serviceWorker, /thunder-value\.mjs/);
});
