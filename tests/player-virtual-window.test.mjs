import assert from "node:assert/strict";
import test from "node:test";

import { calculatePlayerWindow } from "../public/thunder-bowl/player-virtual-window.mjs";

test("player window keeps the initial DOM bounded while preserving full scroll height", () => {
  const window = calculatePlayerWindow({ itemCount: 716, viewportHeight: 580, rowHeight: 92, overscan: 6 });
  assert.deepEqual(window, {
    start: 0,
    end: 13,
    topSpacerHeight: 0,
    bottomSpacerHeight: 64676,
    renderedCount: 13,
  });
});

test("player window follows the middle of a long player list", () => {
  const window = calculatePlayerWindow({ itemCount: 716, scrollTop: 92 * 300, viewportHeight: 580, rowHeight: 92, overscan: 6 });
  assert.equal(window.start, 294);
  assert.equal(window.end, 313);
  assert.equal(window.renderedCount, 19);
  assert.equal(window.topSpacerHeight + window.bottomSpacerHeight + window.renderedCount * 92, 716 * 92);
});

test("player window clamps safely at the end and with an empty result", () => {
  const end = calculatePlayerWindow({ itemCount: 12, scrollTop: 99999, viewportHeight: 580 });
  assert.equal(end.end, 12);
  assert.ok(end.start <= end.end);
  assert.deepEqual(calculatePlayerWindow({ itemCount: 0 }), {
    start: 0,
    end: 0,
    topSpacerHeight: 0,
    bottomSpacerHeight: 0,
    renderedCount: 0,
  });
});
