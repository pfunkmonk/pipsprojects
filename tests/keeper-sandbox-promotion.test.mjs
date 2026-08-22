import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_TYPES,
  createEvent,
} from "../public/thunder-bowl/state-engine.mjs";
import { buildKeeperSandboxPromotion } from "../public/thunder-bowl/keeper-sandbox-promotion.mjs";

const keeper = () => createEvent(EVENT_TYPES.KEEPER_ASSIGNED, {
  playerId: "player-one",
  playerName: "Player One",
  position: "RB",
  nflTeam: "DET",
  teamId: "dogs-of-war",
  salary: 4,
  keeperYear: 2,
  selectionRound: 1,
  source: "Authenticated 2026 keeper candidate",
}, { deviceId: "test-device" });

const trade = () => createEvent(EVENT_TYPES.KEEPER_RIGHTS_TRADED, {
  teamAId: "dogs-of-war",
  teamBId: "big-head",
  amountFromAToB: 3,
  teamASends: [],
  teamBSends: [{ playerId: "zay-flowers", playerName: "Zay Flowers" }],
}, { deviceId: "test-device" });

test("keeper sandbox promotion preserves keepers and complete trade packages in order", () => {
  const keeperEvent = keeper();
  const tradeEvent = trade();
  const plan = buildKeeperSandboxPromotion({ sandboxEvents: [tradeEvent, keeperEvent] });
  assert.deepEqual(plan.pendingEvents.map((event) => event.id), [tradeEvent.id, keeperEvent.id]);
  assert.equal(plan.counts.keepers, 1);
  assert.equal(plan.counts.trades, 1);
  assert.equal(plan.counts.ledgerEvents, 2);
});

test("events already present officially are not duplicated and server receipt metadata is ignored", () => {
  const event = keeper();
  const official = { ...event, serverReceivedAt: "2026-08-22T12:00:00.000Z" };
  const plan = buildKeeperSandboxPromotion({ officialEvents: [official], sandboxEvents: [event] });
  assert.equal(plan.pendingEvents.length, 0);
});

test("sandbox corrections of sandbox-only actions retain audit events but publish no active action", () => {
  const event = keeper();
  const undo = createEvent(EVENT_TYPES.EVENT_VOIDED, {
    targetEventId: event.id,
    reason: "Immediate keeper setup correction",
  }, { deviceId: "test-device" });
  const plan = buildKeeperSandboxPromotion({ sandboxEvents: [event, undo] });
  assert.deepEqual(plan.pendingEvents.map((row) => row.id), [event.id, undo.id]);
  assert.equal(plan.reviewItems.length, 0);
  assert.equal(plan.counts.ledgerEvents, 2);
});

test("sandbox promotion fails closed on a non-keeper event or conflicting event ID", () => {
  const sale = createEvent(EVENT_TYPES.PLAYER_SOLD, {
    playerId: "player-one",
    playerName: "Player One",
    position: "RB",
    nflTeam: "DET",
    teamId: "dogs-of-war",
    amount: 12,
    nominatorTeamId: "dogs-of-war",
  }, { deviceId: "test-device" });
  assert.throws(() => buildKeeperSandboxPromotion({ sandboxEvents: [sale] }), /forbidden type/);

  const event = keeper();
  const conflicting = { ...event, payload: { ...event.payload, salary: 5 } };
  assert.throws(
    () => buildKeeperSandboxPromotion({ officialEvents: [event], sandboxEvents: [conflicting] }),
    /differs between/,
  );
});
