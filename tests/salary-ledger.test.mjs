import test from "node:test";
import assert from "node:assert/strict";

import { buildSalaryLedgers } from "../netlify/functions/_auctioneer/native-ledger-service.mjs";
import { createEvent, EVENT_TYPES, replayDraft } from "../public/thunder-bowl/state-engine.mjs";

function event(type, payload, id, minute) {
  return createEvent(type, payload, {
    id,
    deviceId: "salary-ledger-test",
    createdAt: `2026-08-26T18:${String(minute).padStart(2, "0")}:00.000Z`,
  });
}

test("salary ledgers reconstruct bonuses, rights trades, keepers, and running balances from active canonical events", () => {
  const rightsTrade = event(EVENT_TYPES.KEEPER_RIGHTS_TRADED, {
    teamAId: "dogs-of-war",
    teamBId: "big-head",
    amountFromAToB: 3,
    teamASends: [],
    teamBSends: [{ playerId: "zay-flowers-rights", playerName: "Zay Flowers" }],
  }, "salary-rights-trade", 1);
  const voidedTransfer = event(EVENT_TYPES.CAP_TRANSFERRED, {
    fromTeamId: "el-guapo",
    toTeamId: "big-head",
    amount: 1,
    reason: "Mistaken entry",
  }, "salary-voided-transfer", 2);
  const undoTransfer = event(EVENT_TYPES.EVENT_VOIDED, {
    targetEventId: voidedTransfer.id,
    reason: "Corrected before auction",
  }, "salary-void-transfer-undo", 3);
  const zayKeeper = event(EVENT_TYPES.KEEPER_ASSIGNED, {
    playerId: "zay-flowers-rights",
    playerName: "Zay Flowers",
    position: "WR",
    nflTeam: "BAL",
    teamId: "dogs-of-war",
    salary: 3,
    keeperYear: 2,
    source: "Official keeper ledger",
  }, "salary-zay-keeper", 4);
  const chaseKeeper = event(EVENT_TYPES.KEEPER_ASSIGNED, {
    playerId: "chase-brown-keeper",
    playerName: "Chase Brown",
    position: "RB",
    nflTeam: "CIN",
    teamId: "dogs-of-war",
    salary: 4,
    keeperYear: 2,
    source: "Official keeper ledger",
  }, "salary-chase-keeper", 5);
  const events = [rightsTrade, voidedTransfer, undoTransfer, zayKeeper, chaseKeeper];
  const state = replayDraft(events);
  const ledgers = buildSalaryLedgers({ events, eventTypes: EVENT_TYPES, config: state.config, state });

  assert.deepEqual(ledgers["dogs-of-war"].map(({ label, delta, balance }) => ({ label, delta, balance })), [
    { label: "Starting salary cap", delta: 100, balance: 100 },
    { label: "2nd Place Loser's Bracket", delta: 4, balance: 104 },
    { label: "To Big Head for Zay Flowers", delta: -3, balance: 101 },
    { label: "Keep Zay Flowers", delta: -3, balance: 98 },
    { label: "Keep Chase Brown", delta: -4, balance: 94 },
  ]);
  assert.deepEqual(ledgers["big-head"].map(({ label, delta, balance }) => ({ label, delta, balance })), [
    { label: "Starting salary cap", delta: 100, balance: 100 },
    { label: "From Dogs of War for Zay Flowers", delta: 3, balance: 103 },
  ]);
  assert.equal(ledgers["el-guapo"].some((entry) => entry.label.includes("Mistaken")), false);
  assert.equal(ledgers["dogs-of-war"].at(-1).balance, state.teams["dogs-of-war"].cash);
});

test("salary-ledger generation fails closed if display arithmetic diverges from authoritative cash", () => {
  const state = replayDraft([]);
  state.teams["dogs-of-war"].cash -= 1;
  assert.throws(
    () => buildSalaryLedgers({ events: [], eventTypes: EVENT_TYPES, config: state.config, state }),
    /does not reconcile/i,
  );
});
