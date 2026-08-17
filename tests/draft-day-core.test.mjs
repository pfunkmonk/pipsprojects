import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  normalizeLeagueConfig,
  publicSnapshot,
  saleLegality,
  snapshotFromDocument,
} from "../public/draft-day/core.mjs";

function config(overrides = {}) {
  return normalizeLeagueConfig({
    leagueName: "Test Auction",
    season: 2026,
    minimumBid: 1,
    bidIncrement: 1,
    rosterMinimum: 2,
    rosterMaximum: 4,
    budgetMode: "current-cash",
    nominationMode: "snake",
    positionRules: [
      { id: "QB", label: "Quarterback", minimum: 1, maximum: 2 },
      { id: "RB", label: "Running back", minimum: 1, maximum: 3 },
    ],
    teams: [
      { id: "alpha", name: "Alpha", enteredPool: 20 },
      { id: "bravo", name: "Bravo", enteredPool: 20 },
    ],
    keepersEnabled: false,
    keepers: [],
    nominationOrder: ["alpha", "bravo"],
    ...overrides,
  });
}

function document(configValue = config()) {
  return {
    schemaVersion: 1,
    leagueCode: "TEST-CODE",
    revision: 0,
    nominationStep: 0,
    createdAt: "2026-08-16T12:00:00.000Z",
    updatedAt: "2026-08-16T12:00:00.000Z",
    config: configValue,
    events: [],
    completedIdempotencyKeys: [],
    access: { admin: { salt: "a", hash: "a" }, auctioneer: { salt: "b", hash: "b" }, board: { salt: "c", hash: "c" } },
  };
}

const qb = { id: "player-qb", name: "Quarter Back", position: "QB", nflTeam: "DEN" };
const rb = { id: "player-rb", name: "Runner One", position: "RB", nflTeam: "GB" };

test("current-cash and pre-keeper modes never deduct keeper salaries twice", () => {
  const base = {
    leagueName: "Keeper League", season: 2026, minimumBid: 1, bidIncrement: 1, rosterMinimum: 1, rosterMaximum: 3,
    nominationMode: "linear", positionRules: [{ id: "QB", label: "QB", minimum: 1, maximum: 2 }],
    teams: [{ id: "alpha", name: "Alpha", enteredPool: 20 }, { id: "bravo", name: "Bravo", enteredPool: 20 }],
    keepersEnabled: true, keepers: [{ id: "keeper-one", player: qb, teamId: "alpha", salary: 5 }], nominationOrder: ["alpha", "bravo"],
  };
  assert.equal(normalizeLeagueConfig({ ...base, budgetMode: "current-cash" }).teams[0].auctionBudget, 20);
  assert.equal(normalizeLeagueConfig({ ...base, budgetMode: "pre-keeper" }).teams[0].auctionBudget, 15);
});

test("legal maximum preserves enough cash to complete roster and position minimums", () => {
  const snapshot = snapshotFromDocument(document());
  assert.equal(snapshot.teams[0].legalMaxBid, 19);
  assert.equal(saleLegality(snapshot, { player: rb, teamId: "alpha", price: 19 }).legal, true);
  assert.equal(saleLegality(snapshot, { player: rb, teamId: "alpha", price: 20 }).legal, false);
});

test("record, correction, undo, and restore remain append-only", () => {
  let state = document();
  state = applyCommand(state, { type: "record-sale", eventId: "sale-one", idempotencyKey: "record-one", expectedRevision: 0, player: rb, teamId: "alpha", price: 10 });
  state = applyCommand(state, { type: "correct-sale", eventId: "correct-one", idempotencyKey: "correct-key", expectedRevision: 1, targetId: "sale-one", player: rb, teamId: "bravo", price: 7 });
  state = applyCommand(state, { type: "void-sale", eventId: "void-one", idempotencyKey: "void-key", expectedRevision: 2, targetId: "sale-one" });
  state = applyCommand(state, { type: "restore-sale", eventId: "restore-one", idempotencyKey: "restore-key", expectedRevision: 3, targetId: "sale-one" });
  const snapshot = snapshotFromDocument(state);
  assert.equal(state.events.length, 4);
  assert.equal(snapshot.assignments[0].teamId, "bravo");
  assert.equal(snapshot.assignments[0].price, 7);
  assert.equal(snapshot.assignments[0].status, "active");
  assert.equal(snapshot.revision, 4);
});

test("duplicate players are rejected even when a correction supplies a different id", () => {
  let state = document();
  state = applyCommand(state, { type: "record-sale", eventId: "sale-one", idempotencyKey: "record-one", expectedRevision: 0, player: rb, teamId: "alpha", price: 3 });
  assert.throws(() => applyCommand(state, { type: "record-sale", eventId: "sale-two", idempotencyKey: "record-two", expectedRevision: 1, player: { ...rb, id: "fake-second-id" }, teamId: "bravo", price: 3 }), /already assigned/i);
});

test("public board snapshot strips event history and setup-only data", () => {
  const full = snapshotFromDocument(document());
  const board = publicSnapshot(full);
  assert.equal(board.config.teams[0].enteredPool, undefined);
  assert.equal(board.events, undefined);
  assert.equal(board.customPlayers, undefined);
  assert.deepEqual(Object.keys(board.config.teams[0]).sort(), ["id", "name"]);
});

test("setup validates flexible team counts, positions, and impossible roster rules", () => {
  const valid = config({ teams: Array.from({ length: 16 }, (_, index) => ({ id: `team-${index + 1}`, name: `Club ${index + 1}`, enteredPool: 100 })), nominationOrder: Array.from({ length: 16 }, (_, index) => `team-${index + 1}`) });
  assert.equal(valid.teams.length, 16);
  assert.throws(() => config({ rosterMinimum: 5, rosterMaximum: 5, positionRules: [{ id: "QB", label: "QB", minimum: 0, maximum: 2 }] }), /cannot accommodate/i);
});

test("organizer can replace setup only before the first auction sale", () => {
  let state = document();
  const replacement = config({ leagueName: "Renamed Auction" });
  state = applyCommand(state, { type: "replace-setup", config: replacement, idempotencyKey: "replace-one", expectedRevision: 0 }, { role: "admin" });
  assert.equal(state.config.leagueName, "Renamed Auction");
  state = applyCommand(state, { type: "record-sale", eventId: "sale-one", idempotencyKey: "record-one", expectedRevision: 1, player: rb, teamId: "alpha", price: 3 });
  assert.throws(() => applyCommand(state, { type: "replace-setup", config: config(), idempotencyKey: "replace-two", expectedRevision: 2 }, { role: "admin" }), /locked after the first auction sale/i);
  assert.throws(() => applyCommand(document(), { type: "replace-setup", config: replacement, idempotencyKey: "replace-three", expectedRevision: 0 }, { role: "auctioneer" }), /only the organizer/i);
});
