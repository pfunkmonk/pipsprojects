import test from "node:test";
import assert from "node:assert/strict";
import { assertAuctioneerKeeperSetupUnchanged } from "../netlify/functions/_lib/ledger-store.mjs";
import { DEFAULT_CONFIG, EVENT_TYPES, createEvent } from "../public/thunder-bowl/state-engine.mjs";

const options = (id, minute) => ({
  id,
  deviceId: "keeper-authority-test",
  createdAt: `2026-08-28T18:${String(minute).padStart(2, "0")}:00.000Z`,
});

test("the storage boundary preserves final keeper setup while allowing auction sales", () => {
  const config = createEvent(EVENT_TYPES.DRAFT_CONFIGURED, DEFAULT_CONFIG, options("authority-config", 0));
  const finalization = createEvent(
    EVENT_TYPES.KEEPERS_FINALIZED,
    { season: 2026, keeperCount: 0, reason: "Organizer lock boundary test" },
    options("authority-finalized", 1),
  );
  const current = [config, finalization];
  const sale = createEvent(EVENT_TYPES.PLAYER_SOLD, {
    playerId: "authority-sale-player",
    playerName: "Authority Sale Player",
    position: "QB",
    nflTeam: "DEN",
    teamId: "dogs-of-war",
    amount: 1,
    nominatorTeamId: "orange-crush",
  }, options("authority-sale", 2));
  assert.equal(assertAuctioneerKeeperSetupUnchanged(current, [...current, sale]), true);

  const keeper = createEvent(EVENT_TYPES.KEEPER_ASSIGNED, {
    playerId: "authority-keeper-player",
    playerName: "Authority Keeper Player",
    position: "WR",
    nflTeam: "DEN",
    teamId: "orange-crush",
    salary: 2,
    keeperYear: 2,
    selectionRound: 1,
    source: "Organizer authority test",
  }, options("authority-keeper", 3));
  assert.throws(
    () => assertAuctioneerKeeperSetupUnchanged(current, [...current, keeper]),
    (error) => error.code === "KEEPERS_FINALIZED" && error.status === 403,
  );
});
