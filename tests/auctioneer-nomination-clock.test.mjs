import test from "node:test";
import assert from "node:assert/strict";
import { formatNominationClock, pauseNominationClock, readNominationClock, resetNominationClock, resumeNominationClock, setNominationClockDuration, startNominationClock } from "../public/thunder-bowl/shared/nomination-clock.mjs";

function withStorage(run) {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try { run(); } finally { delete globalThis.localStorage; }
}

test("formats nomination-clock durations", () => {
  assert.equal(formatNominationClock(120_000), "2:00");
  assert.equal(formatNominationClock(60_001), "1:01");
  assert.equal(formatNominationClock(0), "0:00");
});

test("starts after a sale and remains fully pauseable and resettable", () => withStorage(() => {
  resetNominationClock();
  assert.equal(readNominationClock().status, "paused");
  startNominationClock();
  assert.equal(readNominationClock().status, "running");
  pauseNominationClock();
  assert.equal(readNominationClock().status, "paused");
  resumeNominationClock();
  assert.equal(readNominationClock().status, "running");
  resetNominationClock();
  assert.deepEqual({ status: readNominationClock().status, remainingMs: readNominationClock().remainingMs }, { status: "paused", remainingMs: 120_000 });
}));

test("a shorter auctioneer duration persists across start, reset, pause, and resume", () => withStorage(() => {
  setNominationClockDuration(60_000);
  assert.deepEqual({ status: readNominationClock().status, durationMs: readNominationClock().durationMs, remainingMs: readNominationClock().remainingMs }, { status: "paused", durationMs: 60_000, remainingMs: 60_000 });
  startNominationClock();
  assert.equal(readNominationClock().durationMs, 60_000);
  pauseNominationClock();
  resumeNominationClock();
  assert.equal(readNominationClock().durationMs, 60_000);
  resetNominationClock();
  assert.deepEqual({ status: readNominationClock().status, remainingMs: readNominationClock().remainingMs }, { status: "paused", remainingMs: 60_000 });
}));

test("changing duration restarts the current countdown without changing run state", () => withStorage(() => {
  startNominationClock();
  setNominationClockDuration(30_000);
  const running = readNominationClock();
  assert.equal(running.status, "running");
  assert.equal(running.durationMs, 30_000);
  assert.ok(running.remainingMs > 29_000 && running.remainingMs <= 30_000);
  pauseNominationClock();
  setNominationClockDuration(90_000);
  assert.deepEqual({ status: readNominationClock().status, remainingMs: readNominationClock().remainingMs }, { status: "paused", remainingMs: 90_000 });
}));
