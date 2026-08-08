import test from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_LEDGER_GENERATION,
  assertExpectedLedgerGeneration,
  nextLedgerGeneration,
  normalizeLedgerGeneration,
} from "../netlify/functions/_lib/ledger-generation.mjs";

test("legacy clients are accepted only before the first archive", () => {
  assert.equal(assertExpectedLedgerGeneration(INITIAL_LEDGER_GENERATION, null), 1);
  assert.throws(
    () => assertExpectedLedgerGeneration(2, null),
    (error) => error.code === "LEDGER_GENERATION_MISMATCH" && error.currentGeneration === 2,
  );
});

test("the matching generation is accepted and stale or future clients are rejected", () => {
  assert.equal(assertExpectedLedgerGeneration(7, 7), 7);
  for (const expected of [6, 8]) {
    assert.throws(
      () => assertExpectedLedgerGeneration(7, expected),
      (error) => error.code === "LEDGER_GENERATION_MISMATCH" && error.currentGeneration === 7,
    );
  }
});

test("generations remain positive safe integers and increment exactly once", () => {
  assert.equal(normalizeLedgerGeneration(1), 1);
  assert.equal(nextLedgerGeneration(41), 42);
  for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "2", null]) {
    assert.throws(() => normalizeLedgerGeneration(invalid), (error) => error.code === "INVALID_LEDGER_GENERATION");
  }
  assert.throws(
    () => nextLedgerGeneration(Number.MAX_SAFE_INTEGER),
    (error) => error.code === "LEDGER_GENERATION_EXHAUSTED",
  );
});
