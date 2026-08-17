import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  draftCsv,
  keeperLegality,
  normalizeLeagueCode,
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

test("league codes accept the friendly whole name code up to eight characters", () => {
  assert.equal(normalizeLeagueCode("Test League"), "TEST-LEAG");
  assert.equal(normalizeLeagueCode("NFL"), "NFL");
  assert.equal(normalizeLeagueCode("NineChars"), "NINE-CHAR");
  assert.throws(() => normalizeLeagueCode("A"), /at least two/i);
});

test("current-cash and pre-keeper modes never deduct keeper salaries twice", () => {
  const base = {
    leagueName: "Keeper League", season: 2026, minimumBid: 1, bidIncrement: 1, rosterMinimum: 1, rosterMaximum: 3,
    nominationMode: "linear", positionRules: [{ id: "QB", label: "QB", minimum: 1, maximum: 2 }],
    teams: [{ id: "alpha", name: "Alpha", enteredPool: 20 }, { id: "bravo", name: "Bravo", enteredPool: 20 }],
    keepersEnabled: true, keepers: [{ id: "keeper-one", player: qb, teamId: "alpha", salary: 5 }], nominationOrder: ["alpha", "bravo"],
  };
  const currentCash = snapshotFromDocument(document(normalizeLeagueConfig({ ...base, budgetMode: "current-cash" }))).teams[0];
  const preKeeper = snapshotFromDocument(document(normalizeLeagueConfig({ ...base, budgetMode: "pre-keeper" }))).teams[0];
  assert.equal(currentCash.auctionBudget, 20);
  assert.equal(currentCash.remainingBudget, 20);
  assert.equal(preKeeper.auctionBudget, 15);
  assert.equal(preKeeper.remainingBudget, 15);
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

test("sale correction and restore use the same legality rules as a new sale", () => {
  let state = document();
  state = applyCommand(state, { type: "record-sale", eventId: "sale-one", idempotencyKey: "record-one", expectedRevision: 0, player: rb, teamId: "alpha", price: 3 });
  assert.throws(() => applyCommand(state, { type: "correct-sale", eventId: "illegal-correction", idempotencyKey: "illegal-correction-key", expectedRevision: 1, targetId: "sale-one", player: rb, teamId: "alpha", price: 20 }), /bid at most/i);
  state = applyCommand(state, { type: "void-sale", eventId: "void-one", idempotencyKey: "void-one-key", expectedRevision: 1, targetId: "sale-one" });
  state = applyCommand(state, { type: "record-sale", eventId: "replacement-sale", idempotencyKey: "replacement-sale-key", expectedRevision: 2, player: rb, teamId: "bravo", price: 3 });
  assert.throws(() => applyCommand(state, { type: "restore-sale", eventId: "illegal-restore", idempotencyKey: "illegal-restore-key", expectedRevision: 3, targetId: "sale-one" }), /already assigned/i);
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

test("blank position maximums remain unlimited through save, reload, keepers, and auction sales", () => {
  const unlimited = config({
    rosterMinimum: 1,
    rosterMaximum: 3,
    positionRules: [{ id: "QB", label: "Quarterback", minimum: 0, maximum: "" }],
  });
  assert.equal(unlimited.positionRules[0].maximum, null);
  assert.equal(normalizeLeagueConfig({ ...unlimited, keepersEnabled: true }).positionRules[0].maximum, null);

  const withKeepers = config({
    rosterMinimum: 1,
    rosterMaximum: 3,
    positionRules: [{ id: "QB", label: "Quarterback", minimum: 0, maximum: null }],
    keepersEnabled: true,
    keepers: [
      { id: "keeper-one", player: { id: "keeper-qb-one", name: "Keeper One", position: "QB", nflTeam: "DEN" }, teamId: "alpha", salary: 0 },
      { id: "keeper-two", player: { id: "keeper-qb-two", name: "Keeper Two", position: "QB", nflTeam: "GB" }, teamId: "alpha", salary: 0 },
      { id: "keeper-three", player: { id: "keeper-qb-three", name: "Keeper Three", position: "QB", nflTeam: "NYJ" }, teamId: "alpha", salary: 0 },
    ],
  });
  assert.equal(withKeepers.keepers.length, 3);

  let state = document(unlimited);
  for (let index = 1; index <= 3; index += 1) {
    state = applyCommand(state, {
      type: "record-sale",
      eventId: `sale-qb-${index}`,
      idempotencyKey: `record-qb-${index}`,
      expectedRevision: index - 1,
      player: { id: `qb-${index}`, name: `Quarterback ${index}`, position: "QB", nflTeam: "FA" },
      teamId: "alpha",
      price: 1,
    });
  }
  assert.equal(snapshotFromDocument(state).teams[0].positionCounts.QB, 3);
  assert.throws(() => applyCommand(state, {
    type: "record-sale",
    eventId: "sale-qb-four",
    idempotencyKey: "record-qb-four",
    expectedRevision: 3,
    player: { id: "qb-four", name: "Quarterback Four", position: "QB", nflTeam: "FA" },
    teamId: "alpha",
    price: 1,
  }), /roster maximum/i);
});

test("an explicit numeric position maximum is still enforced", () => {
  const capped = config({
    rosterMinimum: 1,
    rosterMaximum: 4,
    positionRules: [{ id: "QB", label: "Quarterback", minimum: 0, maximum: 2 }],
  });
  let state = document(capped);
  for (let index = 1; index <= 2; index += 1) {
    state = applyCommand(state, {
      type: "record-sale",
      eventId: `capped-sale-${index}`,
      idempotencyKey: `capped-record-${index}`,
      expectedRevision: index - 1,
      player: { id: `capped-qb-${index}`, name: `Capped Quarterback ${index}`, position: "QB", nflTeam: "FA" },
      teamId: "alpha",
      price: 1,
    });
  }
  assert.throws(() => applyCommand(state, {
    type: "record-sale",
    eventId: "capped-sale-three",
    idempotencyKey: "capped-record-three",
    expectedRevision: 2,
    player: { id: "capped-qb-three", name: "Capped Quarterback Three", position: "QB", nflTeam: "FA" },
    teamId: "alpha",
    price: 1,
  }), /Quarterback maximum/i);
});

test("auctioneer keeper events preserve details, enforce limits, lock new entry, and remain repairable", () => {
  const keeperConfig = config({
    budgetMode: "pre-keeper",
    rosterMinimum: 1,
    rosterMaximum: 4,
    keeperMaximum: 1,
    positionRules: [{ id: "QB", label: "Quarterback", minimum: 0, maximum: null }],
  });
  let state = document(keeperConfig);
  const firstKeeper = { player: qb, teamId: "alpha", salary: 5, contractYear: 2, keeperRound: 8 };
  assert.equal(keeperLegality(snapshotFromDocument(state), firstKeeper).legal, true);
  state = applyCommand(state, { type: "record-keeper", eventId: "keeper-event-one", idempotencyKey: "keeper-record-one", expectedRevision: 0, ...firstKeeper });
  let snapshot = snapshotFromDocument(state);
  assert.equal(snapshot.teams[0].remainingBudget, 15);
  assert.equal(snapshot.teams[0].keeperCount, 1);
  assert.equal(snapshot.assignments[0].contractYear, 2);
  assert.equal(snapshot.assignments[0].keeperRound, 8);
  assert.equal(keeperLegality(snapshot, { player: { ...rb, id: "second-keeper" }, teamId: "alpha", salary: 1 }).legal, false);

  state = applyCommand(state, { type: "record-sale", eventId: "sale-after-keeper", idempotencyKey: "sale-after-keeper-key", expectedRevision: 1, player: { id: "auction-qb", name: "Auction Quarterback", position: "QB", nflTeam: "FA" }, teamId: "alpha", price: 1 });
  assert.throws(() => applyCommand(state, { type: "record-keeper", eventId: "late-keeper", idempotencyKey: "late-keeper-key", expectedRevision: 2, player: { id: "late-player", name: "Late Player", position: "QB", nflTeam: "FA" }, teamId: "bravo", salary: 1 }), /locked/i);
  state = applyCommand(state, { type: "correct-keeper", eventId: "keeper-correction", idempotencyKey: "keeper-correction-key", expectedRevision: 2, targetId: "keeper-event-one", ...firstKeeper, salary: 6, contractYear: 3, keeperRound: 7 });
  state = applyCommand(state, { type: "void-keeper", eventId: "keeper-void", idempotencyKey: "keeper-void-key", expectedRevision: 3, targetId: "keeper-event-one" });
  state = applyCommand(state, { type: "restore-keeper", eventId: "keeper-restore", idempotencyKey: "keeper-restore-key", expectedRevision: 4, targetId: "keeper-event-one" });
  snapshot = snapshotFromDocument(state);
  const keeper = snapshot.assignments.find((assignment) => assignment.id === "keeper-event-one");
  assert.equal(keeper.price, 6);
  assert.equal(keeper.contractYear, 3);
  assert.equal(keeper.keeperRound, 7);
  assert.equal(keeper.status, "active");
  assert.equal(snapshot.auctionStarted, true);
  assert.equal(state.events.length, 5);
});

test("a voided keeper cannot be restored over a later active assignment", () => {
  let state = document(config({ keeperMaximum: null }));
  state = applyCommand(state, { type: "record-keeper", eventId: "keeper-one", idempotencyKey: "keeper-one-key", expectedRevision: 0, player: qb, teamId: "alpha", salary: 4 });
  state = applyCommand(state, { type: "void-keeper", eventId: "keeper-void", idempotencyKey: "keeper-void-key", expectedRevision: 1, targetId: "keeper-one" });
  state = applyCommand(state, { type: "record-sale", eventId: "later-sale", idempotencyKey: "later-sale-key", expectedRevision: 2, player: qb, teamId: "bravo", price: 3 });
  assert.throws(() => applyCommand(state, { type: "restore-keeper", eventId: "keeper-restore", idempotencyKey: "keeper-restore-key", expectedRevision: 3, targetId: "keeper-one" }), /already assigned/i);
});

test("organizer setup edits preserve auctioneer-recorded keepers before the first sale", () => {
  let state = document(config({ keeperMaximum: 2 }));
  state = applyCommand(state, { type: "record-keeper", eventId: "keeper-before-edit", idempotencyKey: "keeper-before-edit-key", expectedRevision: 0, player: qb, teamId: "alpha", salary: 4, contractYear: 1, keeperRound: 6 });
  state = applyCommand(state, { type: "replace-setup", idempotencyKey: "setup-after-keeper", expectedRevision: 1, config: config({ leagueName: "Keeper Edit Preserved", keeperMaximum: 2 }) }, { role: "admin" });
  const snapshot = snapshotFromDocument(state);
  assert.equal(snapshot.config.leagueName, "Keeper Edit Preserved");
  assert.equal(snapshot.assignments.find((assignment) => assignment.id === "keeper-before-edit")?.playerName, qb.name);
});

test("CSV export includes keeper contract and round fields and remains spreadsheet safe", () => {
  let state = document(config({ keeperMaximum: null }));
  state = applyCommand(state, { type: "record-keeper", eventId: "keeper-csv", idempotencyKey: "keeper-csv-key", expectedRevision: 0, player: { ...qb, name: "=Unsafe Keeper" }, teamId: "alpha", salary: 4, contractYear: 2, keeperRound: 9 });
  const csv = draftCsv(snapshotFromDocument(state));
  assert.match(csv, /"Contract Year","Keeper Round"/);
  assert.match(csv, /"'=Unsafe Keeper"/);
  assert.match(csv, /"keeper","2","9","active"/);
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
