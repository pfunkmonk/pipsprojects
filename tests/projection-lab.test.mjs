import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectionLabPreview, PROJECTION_LAB_MODEL } from "../public/thunder-bowl/projection-lab.mjs";

function gibbs() {
  const points = [20, 20, 20, 20, 20, null, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 19.6, 20];
  return {
    name: "Jahmyr Gibbs",
    position: "RB",
    projectedPoints: 339.6,
    projectionSources: [
      { source: "Footballguys", points: 339.6, modelEffect: "primary_projection", role: "primary", asOf: "2026-08-03T20:42:15Z" },
      { source: "CBS", points: 386.5, modelEffect: "none", role: "cross-check", asOf: "2026-08-03T20:46:57Z" },
      { source: "FantasyPros", points: 372.2, modelEffect: "none", role: "supplemental", asOf: "2026-08-03T23:31:50Z" },
    ],
    weeklyProjection: { points },
  };
}

test("three-source consensus uses the registered accuracy weights and exposes its authority", () => {
  const preview = buildProjectionLabPreview(gibbs(), { divisionWeeks: [1, 3, 11, 12], playoffWeeks: [15, 16, 17] });
  assert.equal(preview.status, "complete_three_source");
  assert.equal(preview.consensus, 365.9);
  assert.equal(preview.modified, 365.9);
  assert.equal(preview.automaticCorrectionDelta, 0);
  assert.deepEqual(preview.sourceRange, { low: 339.6, high: 386.5 });
  assert.equal(Math.round(preview.sources.reduce((sum, source) => sum + source.weight, 0) * 1000), 1000);
  assert.equal(preview.weekly.seasonTotal, preview.modified);
  assert.equal(preview.weekly.effectOnSeasonTotal, 0);
  assert.equal(preview.valueEffect, "candidate_ready");
  assert.equal(PROJECTION_LAB_MODEL.livePromotionEligible, true);
});

test("partial and missing source coverage fail soft without inventing projections", () => {
  const partial = gibbs();
  partial.projectionSources = partial.projectionSources.slice(0, 2);
  assert.equal(buildProjectionLabPreview(partial).status, "partial_consensus");

  const missing = gibbs();
  missing.projectionSources = [];
  const fallback = buildProjectionLabPreview(missing);
  assert.equal(fallback.status, "fallback_current_primary");
  assert.equal(fallback.modified, 339.6);
  assert.equal(fallback.sourceRange, null);
  assert.equal(fallback.valueEffect, "fallback");
});

test("small projections preserve weekly totals without negative rounding artifacts", () => {
  const kicker = gibbs();
  kicker.name = "Small Sample Kicker";
  kicker.position = "K";
  kicker.projectedPoints = 1.9;
  kicker.projectionSources = [
    { source: "Footballguys", points: 1.9, modelEffect: "primary_projection", role: "primary" },
    { source: "CBS", points: 0, modelEffect: "none", role: "cross-check" },
  ];
  kicker.weeklyProjection.points = Array.from({ length: 18 }, (_, index) => index === 5 ? null : index === 17 ? 0.3 : 0.1);
  const preview = buildProjectionLabPreview(kicker);
  assert.equal(preview.modified, 1);
  assert.equal(preview.weekly.seasonTotal, 1);
  assert.equal(preview.weekly.points.every((value) => value === null || value >= 0), true);
});
