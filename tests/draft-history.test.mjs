import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftHistoryRows, draftHistoryCsv } from "../public/thunder-bowl/draft-history.mjs";
import { DEFAULT_CONFIG, EVENT_TYPES, createEvent } from "../public/thunder-bowl/state-engine.mjs";

const pack = { season: 2026, packId: "tb26-history-test", asOf: "2026-08-04T18:00:00.000Z" };
const options = (index) => ({
  id: `history-event-${index}`,
  deviceId: "history-device-test",
  createdAt: `2026-08-29T18:${String(index).padStart(2, "0")}:00.000Z`,
});
const event = (type, payload, index) => createEvent(type, payload, options(index));

test("draft history exports active cap, pass, keeper, and corrected sale rows in order", () => {
  const configured = event(EVENT_TYPES.DRAFT_CONFIGURED, DEFAULT_CONFIG, 0);
  const transfer = event(
    EVENT_TYPES.CAP_TRANSFERRED,
    { fromTeamId: "dogs-of-war", toTeamId: "goon-skwad", amount: 2, reason: '=HYPERLINK("bad")' },
    1,
  );
  const pass = event(
    EVENT_TYPES.KEEPER_PASSED,
    { teamId: "orange-crush", round: 1, reason: "No keeper selected for this turn" },
    2,
  );
  const keeper = event(
    EVENT_TYPES.KEEPER_ASSIGNED,
    {
      playerId: "keeper-history-player",
      playerName: "History Keeper",
      position: "RB",
      nflTeam: "DET",
      teamId: "the-hobbits",
      salary: 6,
      keeperYear: 2,
      selectionRound: 1,
      source: "authenticated test candidate",
    },
    3,
  );
  const wrongSale = event(
    EVENT_TYPES.PLAYER_SOLD,
    {
      playerId: "sale-history-player",
      playerName: "History Sale",
      position: "WR",
      nflTeam: "BUF",
      teamId: "dogs-of-war",
      amount: 9,
      nominatorTeamId: "orange-crush",
      openingBid: 1,
    },
    4,
  );
  const undo = event(EVENT_TYPES.EVENT_VOIDED, { targetEventId: wrongSale.id, reason: "Corrected winning price" }, 5);
  const correctedSale = event(
    EVENT_TYPES.PLAYER_SOLD,
    {
      ...wrongSale.payload,
      amount: 8,
    },
    6,
  );
  const rows = buildDraftHistoryRows({ events: [configured, transfer, pass, keeper, wrongSale, undo, correctedSale], pack });

  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.eventType), [
    EVENT_TYPES.CAP_TRANSFERRED,
    EVENT_TYPES.KEEPER_PASSED,
    EVENT_TYPES.KEEPER_ASSIGNED,
    EVENT_TYPES.PLAYER_SOLD,
  ]);
  assert.equal(rows[0].teamName, "Dogs of War");
  assert.equal(rows[0].otherTeamName, "Goon Skwad");
  assert.equal(rows[1].selectionRound, 1);
  assert.equal(rows[1].selectionPick, 1);
  assert.equal(rows[2].teamName, "The Hobbits");
  assert.equal(rows[2].selectionPick, 2);
  assert.equal(rows[3].amount, 8);
  assert.equal(rows[3].saleNumber, 1);
  assert.equal(rows[3].nominatorTeamName, "Orange Crush");
  assert.ok(!rows.some((row) => row.eventId === wrongSale.id));

  const csv = draftHistoryCsv(rows);
  assert.match(csv, /Event Type/);
  assert.match(csv, /PLAYER_SOLD/);
  assert.match(csv, /History Sale/);
  assert.doesNotMatch(csv, /,9,/);
  assert.match(csv, /'=""?HYPERLINK|"'=HYPERLINK/);
});

test("draft history can export a header-only clean ledger", () => {
  const configured = event(EVENT_TYPES.DRAFT_CONFIGURED, DEFAULT_CONFIG, 0);
  const rows = buildDraftHistoryRows({ events: [configured], pack });
  assert.deepEqual(rows, []);
  const csv = draftHistoryCsv(rows);
  assert.equal(csv.split("\r\n").filter(Boolean).length, 1);
  assert.match(csv, /^Season,Pack ID,/);
});

test("draft history preserves every player and dollar in an atomic multi-player rights trade", () => {
  const configured = event(EVENT_TYPES.DRAFT_CONFIGURED, DEFAULT_CONFIG, 0);
  const trade = event(
    EVENT_TYPES.KEEPER_RIGHTS_TRADED,
    {
      teamAId: "the-hobbits",
      teamBId: "t-dogs",
      amountFromAToB: 4,
      teamASends: [{ playerId: "hobbits-one", playerName: "Hobbits One" }],
      teamBSends: [
        { playerId: "tdogs-one", playerName: "T-Dogs One" },
        { playerId: "tdogs-two", playerName: "T-Dogs Two" },
      ],
    },
    1,
  );
  const [row] = buildDraftHistoryRows({ events: [configured, trade], pack });
  assert.equal(row.eventType, EVENT_TYPES.KEEPER_RIGHTS_TRADED);
  assert.equal(row.teamName, "The Hobbits");
  assert.equal(row.otherTeamName, "T-Dogs");
  assert.equal(row.amount, 4);
  assert.match(row.playerName, /Hobbits One A→B/);
  assert.match(row.playerName, /T-Dogs One B→A/);
  assert.match(row.playerName, /T-Dogs Two B→A/);
});
