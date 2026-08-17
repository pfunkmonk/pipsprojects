import test from "node:test";
import assert from "node:assert/strict";

import {
  CBS_AUCTION_IMPORT_COLUMNS,
  buildCbsAuctionImportRows,
  cbsAuctionImportCsv,
  validateCbsAuctionImportRows,
} from "../public/thunder-bowl/cbs-auction-export.mjs";
import { DEFAULT_CONFIG, EVENT_TYPES, createEvent } from "../public/thunder-bowl/state-engine.mjs";

const eventOptions = (index) => ({
  id: `cbs-export-event-${index}`,
  deviceId: "cbs-export-test-device",
  createdAt: `2026-08-29T18:${String(index).padStart(2, "0")}:00.000Z`,
});
const event = (type, payload, index) => createEvent(type, payload, eventOptions(index));
const keeperPlayer = { id: "fbg:KeepTe00", name: "Keeper Test", position: "TE", nflTeam: "DET" };
const salePlayer = { id: "fbg:ChasJa00", name: "Ja'Marr Chase", position: "WR", nflTeam: "CIN" };
const pack = {
  season: 2026,
  packId: "tb26-cbs-export-test",
  asOf: "2026-08-29T15:00:00.000Z",
  players: [keeperPlayer, salePlayer],
};

function correctedSaleLedger() {
  const configured = event(EVENT_TYPES.DRAFT_CONFIGURED, DEFAULT_CONFIG, 0);
  const keeper = event(EVENT_TYPES.KEEPER_ASSIGNED, {
    playerId: keeperPlayer.id,
    playerName: keeperPlayer.name,
    position: keeperPlayer.position,
    nflTeam: keeperPlayer.nflTeam,
    teamId: "orange-crush",
    salary: 4,
    keeperYear: 2,
    source: "authenticated keeper test",
    selectionRound: 1,
  }, 1);
  const wrongSale = event(EVENT_TYPES.PLAYER_SOLD, {
    playerId: salePlayer.id,
    playerName: salePlayer.name,
    position: salePlayer.position,
    nflTeam: salePlayer.nflTeam,
    teamId: "dogs-of-war",
    amount: 32,
    nominatorTeamId: "orange-crush",
    openingBid: 1,
  }, 2);
  const undo = event(EVENT_TYPES.EVENT_VOIDED, { targetEventId: wrongSale.id, reason: "Corrected auction price" }, 3);
  const correctedSale = event(EVENT_TYPES.PLAYER_SOLD, {
    ...wrongSale.payload,
    amount: 31,
  }, 4);
  return [configured, keeper, wrongSale, undo, correctedSale];
}

test("CBS auction import exports exactly one active row per sale and excludes keepers and voided prices", () => {
  const rows = buildCbsAuctionImportRows({ events: correctedSaleLedger(), pack });
  assert.deepEqual(rows, [{
    player_name: "Ja'Marr Chase",
    nfl_team: "CIN",
    position: "WR",
    fantasy_team: "Dogs of War",
    auction_price: 31,
    player_id: "fbg:ChasJa00",
  }]);

  const csv = cbsAuctionImportCsv(rows);
  assert.equal(csv.split("\r\n")[0], CBS_AUCTION_IMPORT_COLUMNS.join(","));
  assert.equal(csv, "player_name,nfl_team,position,fantasy_team,auction_price,player_id\r\nJa'Marr Chase,CIN,WR,Dogs of War,31,fbg:ChasJa00\r\n");
  assert.doesNotMatch(csv, /Keeper Test|,32,/);
  assert.equal(csv.split("\r\n").filter(Boolean).length, 2);
});

test("CBS auction CSV applies standard quoting without changing raw values", () => {
  const csv = cbsAuctionImportCsv([{
    player_name: 'Smith, "CJ" Jr.',
    nfl_team: "FA",
    position: "RB",
    fantasy_team: "Crime and Punishment",
    auction_price: 0,
    player_id: "internal:smith-cj",
  }]);
  assert.match(csv, /^player_name,nfl_team,position,fantasy_team,auction_price,player_id\r\n/);
  assert.match(csv, /"Smith, ""CJ"" Jr\.",FA,RB,Crime and Punishment,0,internal:smith-cj/);
  assert.doesNotMatch(csv, /\$0/);
});

test("CBS auction CSV reports every invalid row and duplicate identifier instead of omitting data", () => {
  const rows = [
    { player_name: "First Player", nfl_team: "", position: "WR/RB", fantasy_team: "Dogs of War", auction_price: 1.5, player_id: "duplicate-id" },
    { player_name: "Second Player", nfl_team: "BUF", position: "QB", fantasy_team: "The Hobbits", auction_price: 2, player_id: "duplicate-id", notes: "not allowed" },
  ];
  assert.throws(
    () => validateCbsAuctionImportRows(rows),
    (error) => {
      assert.match(error.message, /row 2 \(First Player\): nfl_team is blank/);
      assert.match(error.message, /position 'WR\/RB'/);
      assert.match(error.message, /auction_price must be an integer/);
      assert.match(error.message, /row 3 \(Second Player\): unsupported field\(s\): notes/);
      assert.match(error.message, /duplicates row 2/);
      assert.ok(error.issues.length >= 5);
      return true;
    },
  );
});

test("CBS auction export fails closed on active-pack identity drift with the exact player named", () => {
  const changedPack = structuredClone(pack);
  changedPack.players[1].nflTeam = "BUF";
  assert.throws(
    () => buildCbsAuctionImportRows({ events: correctedSaleLedger(), pack: changedPack }),
    /sale 1 \(Ja'Marr Chase\): NFL team 'CIN' does not match active-pack team 'BUF'/,
  );
});

test("CBS auction export blocks an empty handoff file", () => {
  const configured = event(EVENT_TYPES.DRAFT_CONFIGURED, DEFAULT_CONFIG, 0);
  assert.throws(
    () => buildCbsAuctionImportRows({ events: [configured], pack }),
    /No active auction purchases are available/,
  );
});
