import test from "node:test";
import assert from "node:assert/strict";
import { createDraftDayService } from "../netlify/functions/_draft-day/service.mjs";

function memoryRepository() {
  const rows = new Map();
  return {
    async create(document) { if (rows.has(document.leagueCode)) { const error = new Error("conflict"); error.code = "LEAGUE_CODE_CONFLICT"; throw error; } rows.set(document.leagueCode, structuredClone(document)); return { document: structuredClone(document), etag: "1" }; },
    async read(code) { const value = rows.get(code); if (!value) { const error = new Error("missing"); error.status = 404; throw error; } return { document: structuredClone(value), etag: String(value.revision + 1) }; },
    async commit(document, etag) { assert.equal(etag, String(document.revision)); rows.set(document.leagueCode, structuredClone(document)); return { document: structuredClone(document), etag: String(document.revision + 1) }; },
  };
}

const input = {
  config: {
    leagueName: "Service League", season: 2026, minimumBid: 1, bidIncrement: 1, rosterMinimum: 1, rosterMaximum: 3,
    budgetMode: "current-cash", nominationMode: "manual", positionRules: [{ id: "QB", label: "QB", minimum: 1, maximum: 2 }],
    teams: [{ id: "one", name: "One", enteredPool: 20 }, { id: "two", name: "Two", enteredPool: 20 }], keepersEnabled: false, keepers: [], nominationOrder: ["one", "two"],
  },
  access: { adminCode: "ORGANIZER-123", auctioneerCode: "AUCTION-123", boardCode: "BOARD-123" },
};

test("service creates a league, authenticates separate roles, and sanitizes the board", async () => {
  const service = createDraftDayService({ repository: memoryRepository(), leagueCode: () => "ABCD-EFGH", now: () => "2026-08-16T12:00:00.000Z" });
  const created = await service.createLeague(input);
  assert.equal(created.leagueCode, "ABCD-EFGH");
  await assert.doesNotReject(service.authenticate({ leagueCode: "ABCD-EFGH", role: "auctioneer", code: "AUCTION-123" }));
  await assert.rejects(service.authenticate({ leagueCode: "ABCD-EFGH", role: "board", code: "AUCTION-123" }), /not correct/i);
  const board = await service.snapshot("ABCD-EFGH", "board");
  assert.equal(board.events, undefined);
  assert.equal(board.config.teams[0].auctionBudget, undefined);
});

test("service enforces revision checks and idempotent auction commands", async () => {
  const service = createDraftDayService({ repository: memoryRepository(), leagueCode: () => "ABCD-EFGH", now: () => "2026-08-16T12:00:00.000Z" });
  await service.createLeague(input);
  const command = { type: "record-sale", eventId: "sale-one", idempotencyKey: "same-command", expectedRevision: 0, player: { id: "player-one", name: "Player One", position: "QB", nflTeam: "DEN" }, teamId: "one", price: 10 };
  const first = await service.command("ABCD-EFGH", command, "auctioneer");
  assert.equal(first.assignments.length, 1);
  const retry = await service.command("ABCD-EFGH", { ...command, expectedRevision: 1 }, "auctioneer");
  assert.equal(retry.assignments.length, 1);
  await assert.rejects(service.command("ABCD-EFGH", { ...command, idempotencyKey: "stale", eventId: "sale-two", expectedRevision: 0 }, "auctioneer"), /saved first/i);
});

