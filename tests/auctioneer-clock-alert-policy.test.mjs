import test from "node:test";
import assert from "node:assert/strict";
import { nextClockAlert } from "../public/thunder-bowl/shared/clock-alert-policy.mjs";

test("ticks once per second from ten through one and buzzes only once at zero", () => {
  let tracker = { second: null, buzzed: false };
  assert.equal(nextClockAlert({ status: "running", remainingMs: 10_000 }, tracker).alert, "tick");
  ({ tracker } = nextClockAlert({ status: "running", remainingMs: 10_000 }, tracker));
  assert.equal(nextClockAlert({ status: "running", remainingMs: 9_800 }, tracker).alert, null);
  ({ tracker } = nextClockAlert({ status: "running", remainingMs: 9_000 }, tracker));
  const zero = nextClockAlert({ status: "running", remainingMs: 0 }, tracker);
  assert.equal(zero.alert, "buzzer");
  assert.equal(nextClockAlert({ status: "running", remainingMs: 0 }, zero.tracker).alert, null);
});

test("paused clocks are silent and a reset rearms the alerts", () => {
  const prior = { second: 4, buzzed: false };
  assert.equal(nextClockAlert({ status: "paused", remainingMs: 4_000 }, prior).alert, null);
  assert.deepEqual(nextClockAlert({ status: "paused", remainingMs: 120_000 }, prior).tracker, { second: null, buzzed: false });
});
