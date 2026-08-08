import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PRIORITY_SCENARIO,
  priorityProjection,
  validatePriorityScenario,
} from "../public/thunder-bowl/priority-weights.mjs";

const context = { divisionWeeks: [1, 3, 11, 12], playoffWeeks: [15, 16, 17] };

function player(points) {
  return {
    projectedPoints: points.reduce((sum, value) => sum + (value ?? 0), 0),
    weeklyProjection: { points },
  };
}

test("baseline mode exactly reproduces the authoritative projection", () => {
  const input = player([10, 11, 12, 13, 14, 15, null, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
  const result = priorityProjection(input, DEFAULT_PRIORITY_SCENARIO, context);
  assert.equal(result.projectedPoints, input.projectedPoints);
  assert.equal(result.delta, 0);
});

test("scale-preserving weighting leaves a flat weekly player unchanged", () => {
  const input = player([10, 10, 10, 10, 10, 10, null, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  const result = priorityProjection(input, { mode: "experimental", baseline: 1, division: 1.2, playoffs: 1.4 }, context);
  assert.ok(Math.abs(result.projectedPoints - 170) < 1e-9);
  assert.ok(Math.abs(result.delta) < 1e-9);
});

test("experimental priority rewards correlation with division and playoff output", () => {
  const points = Array(18).fill(5);
  points[6] = null;
  for (const week of [...context.divisionWeeks, ...context.playoffWeeks]) points[week - 1] = 15;
  const input = player(points);
  const result = priorityProjection(input, { mode: "experimental", baseline: 1, division: 1.2, playoffs: 1.4 }, context);
  assert.equal(result.available, true);
  assert.ok(result.delta > 0);
  assert.equal(input.projectedPoints, 155, "the source projection is not mutated");
});

test("admin weights are bounded and missing weekly context fails value-neutral", () => {
  assert.throws(() => validatePriorityScenario({ mode: "experimental", baseline: 1, division: 2.01, playoffs: 1 }), RangeError);
  const result = priorityProjection({ projectedPoints: 200 }, { mode: "experimental", baseline: 1, division: 1.2, playoffs: 1.4 }, context);
  assert.deepEqual({ available: result.available, projectedPoints: result.projectedPoints, delta: result.delta }, { available: false, projectedPoints: 200, delta: 0 });
});
