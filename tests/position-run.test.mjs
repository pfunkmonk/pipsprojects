import test from "node:test";
import assert from "node:assert/strict";
import { detectPositionRun } from "../public/thunder-bowl/position-run.mjs";

function state() {
  return {
    config: { starterRequirements: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 } },
    teams: Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
      const id = index === 0 ? "dogs-of-war" : `rival-${index}`;
      return [id, { id, cash: 70, openSlots: 10, positionCounts: { RB: index !== 0 && index % 3 === 0 ? 2 : 0, WR: 0 } }];
    })),
  };
}

test("a position run cannot fire on one sale or before the four-sale evidence floor", () => {
  for (const sales of [
    [{ position: "RB", amount: 40, expectedPrice: 10 }],
    [
      { position: "RB", amount: 20, expectedPrice: 10 },
      { position: "RB", amount: 20, expectedPrice: 10 },
      { position: "RB", amount: 20, expectedPrice: 10 },
    ],
  ]) {
    const result = detectPositionRun({ sales, position: "RB", state: state(), referencePrice: 12, tierSupply: 5, tierCliff: 4 });
    assert.equal(result.active, false);
    assert.equal(result.status, "COOLING");
    assert.equal(result.dollarImpact, 0);
    assert.match(result.note, /single sale never triggers/i);
  }
});

test("frequency and overpay signals combine into a capped HOT run", () => {
  const sales = [
    { position: "WR", amount: 10, expectedPrice: 10 },
    { position: "RB", amount: 15, expectedPrice: 10 },
    { position: "RB", amount: 14, expectedPrice: 10 },
    { position: "RB", amount: 13, expectedPrice: 10 },
  ];
  const result = detectPositionRun({ sales, position: "RB", state: state(), referencePrice: 12, tierSupply: 4, tierCliff: 6 });
  assert.equal(result.active, true);
  assert.equal(result.frequencyRun, true);
  assert.equal(result.priceRun, true);
  assert.equal(result.status, "HOT");
  assert.equal(result.needByDogs, true);
  assert.ok(result.pContinue > 0 && result.pContinue <= 1);
  assert.ok(result.dollarImpact >= 1 && result.dollarImpact <= 3);
  assert.ok(result.vbdDelta >= 0 && result.vbdDelta <= 3);
});

test("ordinary mixed sales stay COOLING and cannot change auction thresholds", () => {
  const sales = [
    { position: "RB", amount: 10, expectedPrice: 10 },
    { position: "WR", amount: 12, expectedPrice: 12 },
    { position: "QB", amount: 8, expectedPrice: 8 },
    { position: "TE", amount: 7, expectedPrice: 7 },
    { position: "RB", amount: 9, expectedPrice: 10 },
    { position: "WR", amount: 11, expectedPrice: 12 },
  ];
  const result = detectPositionRun({ sales, position: "RB", state: state(), referencePrice: 10, tierSupply: 8, tierCliff: 1 });
  assert.equal(result.active, false);
  assert.equal(result.dollarImpact, 0);
  assert.equal(result.vbdDelta, 0);
});
