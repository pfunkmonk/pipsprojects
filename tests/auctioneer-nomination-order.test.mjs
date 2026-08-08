import test from "node:test";
import assert from "node:assert/strict";
import { snakeNominationSequence } from "../public/thunder-bowl/shared/nomination-order.mjs";

test("nomination order is exactly 1 through 12, then 12 through 1", () => {
  const order = Array.from({ length: 12 }, (_, index) => index + 1);
  assert.deepEqual(snakeNominationSequence(order, 24), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});
