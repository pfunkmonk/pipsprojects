import test from "node:test";
import assert from "node:assert/strict";
import {
  clearRememberedAccess,
  rememberLeague,
  rememberedLeague,
  savedVerifier,
  saveVerifier,
  verifierKey,
} from "../public/draft-day/session-storage.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

test("role-specific remembered leagues override the shared convenience value", () => {
  const storage = memoryStorage();
  rememberLeague(storage, "auctioneer", "AUCT-IONE");
  rememberLeague(storage, "board", "BOAR-DONE");
  assert.equal(rememberedLeague(storage, "auctioneer"), "AUCT-IONE");
  assert.equal(rememberedLeague(storage, "board"), "BOAR-DONE");
  assert.equal(rememberedLeague(storage, "organizer"), "BOAR-DONE");
});

test("one explicit logout clears every remembered role and both offline verifiers", () => {
  const storage = memoryStorage();
  const leagueCode = "TEST-LEAG";
  for (const role of ["organizer", "auctioneer", "board"]) rememberLeague(storage, role, leagueCode);
  saveVerifier(storage, "auctioneer", leagueCode, "auctioneer-proof");
  saveVerifier(storage, "board", leagueCode, "board-proof");
  clearRememberedAccess(storage, leagueCode);
  for (const role of ["organizer", "auctioneer", "board"]) assert.equal(rememberedLeague(storage, role), "");
  assert.equal(savedVerifier(storage, "auctioneer", leagueCode), null);
  assert.equal(savedVerifier(storage, "board", leagueCode), null);
  assert.equal(storage.values.size, 0);
});

test("browser persistence failures never break the live authenticated workflow", () => {
  const unavailable = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => rememberLeague(unavailable, "board", "TEST-LEAG"));
  assert.equal(rememberedLeague(unavailable, "board"), "");
  assert.doesNotThrow(() => saveVerifier(unavailable, "board", "TEST-LEAG", "proof"));
  assert.equal(savedVerifier(unavailable, "board", "TEST-LEAG"), null);
  assert.doesNotThrow(() => clearRememberedAccess(unavailable, "TEST-LEAG"));
  assert.equal(verifierKey("board", "TEST-LEAG"), "pips-draft-day-board-verifier-TEST-LEAG");
});
