export const INITIAL_LEDGER_GENERATION = 1;

export function normalizeLedgerGeneration(value) {
  if (!Number.isSafeInteger(value) || value < INITIAL_LEDGER_GENERATION) {
    const error = new Error("Ledger generation must be a positive integer.");
    error.code = "INVALID_LEDGER_GENERATION";
    throw error;
  }
  return value;
}

export function assertExpectedLedgerGeneration(currentGeneration, expectedGeneration) {
  const current = normalizeLedgerGeneration(currentGeneration);
  const legacyClient = expectedGeneration === null || expectedGeneration === undefined;
  if (legacyClient && current === INITIAL_LEDGER_GENERATION) return current;
  if (!legacyClient && normalizeLedgerGeneration(expectedGeneration) === current) return current;

  const error = new Error(
    "This browser is connected to an archived rehearsal. Use Load current cloud rehearsal in Data & Setup before recording more draft actions.",
  );
  error.code = "LEDGER_GENERATION_MISMATCH";
  error.currentGeneration = current;
  throw error;
}

export function nextLedgerGeneration(currentGeneration) {
  const current = normalizeLedgerGeneration(currentGeneration);
  if (current === Number.MAX_SAFE_INTEGER) {
    const error = new Error("Ledger generation has reached its safe limit.");
    error.code = "LEDGER_GENERATION_EXHAUSTED";
    throw error;
  }
  return current + 1;
}
