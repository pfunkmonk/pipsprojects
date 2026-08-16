import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { THUNDER_AUCTION_PRICE_PROFILE } from "../public/thunder-bowl/auction-price-profile.mjs";

const report = JSON.parse(await readFile(
  new URL("../reports/thunder-bowl/auction-price-curve-backtest.json", import.meta.url),
  "utf8",
));

test("the promoted Thunder Bowl price curve matches its governed time-forward report", () => {
  assert.equal(THUNDER_AUCTION_PRICE_PROFILE.modelVersion, report.modelVersion);
  assert.deepEqual(THUNDER_AUCTION_PRICE_PROFILE.seasons, report.includedSeasons);
  assert.equal(THUNDER_AUCTION_PRICE_PROFILE.purchaseRows, 1252);
  assert.equal(THUNDER_AUCTION_PRICE_PROFILE.recencyHalfLifeSeasons, report.selectedHalfLife);
  assert.equal(THUNDER_AUCTION_PRICE_PROFILE.historicalCurveWeight, report.selectedHistoricalCurveWeight);
  assert.equal(report.selectedHistoricalCurveWeight, 0.6);
  assert.ok(Object.isFrozen(THUNDER_AUCTION_PRICE_PROFILE));
  assert.ok(Object.isFrozen(THUNDER_AUCTION_PRICE_PROFILE.seasons));
  assert.ok(Object.isFrozen(THUNDER_AUCTION_PRICE_PROFILE.priceCurves));
  assert.ok(report.selectedMetrics.blendedMae < report.selectedMetrics.sourceMae);
  assert.ok(report.selectedMetrics.premiumBlendedMae < 5.1143);
});

test("every positional price curve is bounded and non-increasing", () => {
  for (const [position, rows] of Object.entries(THUNDER_AUCTION_PRICE_PROFILE.priceCurves)) {
    assert.ok(Object.isFrozen(rows));
    assert.ok(rows.every(Object.isFrozen));
    assert.ok(rows.length >= 8, `${position} must have useful rank depth`);
    let previous = Number.POSITIVE_INFINITY;
    rows.forEach((row, index) => {
      assert.equal(row.rank, index + 1, `${position} ranks must be contiguous`);
      assert.ok(row.mean >= 1 && row.mean <= previous, `${position}${row.rank} mean must be bounded and monotone`);
      assert.ok(row.low >= 1 && row.low <= row.mean, `${position}${row.rank} low bound must be valid`);
      assert.ok(row.high >= row.mean, `${position}${row.rank} high bound must be valid`);
      assert.ok(row.seasons >= 1, `${position}${row.rank} must retain evidence count`);
      previous = row.mean;
    });
  }
});
