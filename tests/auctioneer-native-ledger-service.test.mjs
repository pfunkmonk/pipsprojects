import test from "node:test";
import assert from "node:assert/strict";
import { createNativeLedgerService } from "../netlify/functions/_auctioneer/native-ledger-service.mjs";

const EVENT_TYPES = {
  PLAYER_SOLD: "PLAYER_SOLD", KEEPER_ASSIGNED: "KEEPER_ASSIGNED", EVENT_VOIDED: "EVENT_VOIDED",
  NOMINATION_SKIPPED: "NOMINATION_SKIPPED", KEEPER_PASSED: "KEEPER_PASSED",
};
let eventNumber = 10;
const teams = [{ id: "alpha", name: "Alpha", startingCap: 100 }, { id: "beta", name: "Beta", startingCap: 100 }];

const stateEngine = {
  EVENT_TYPES,
  createEvent(type, payload, options = {}) {
    eventNumber += 1;
    return { id: `event-${eventNumber}`, type, payload, createdAt: options.createdAt || new Date().toISOString(), deviceId: options.deviceId || "test-device" };
  },
  replayDraft(events) {
    const voided = new Set(events.filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED).map((event) => event.payload.targetEventId));
    const operational = events.filter((event) => event.type !== EVENT_TYPES.EVENT_VOIDED && !voided.has(event.id));
    const stateTeams = Object.fromEntries(teams.map((team) => [team.id, { ...team, roster: [] }]));
    const playerIds = new Set();
    for (const event of operational.filter((event) => [EVENT_TYPES.PLAYER_SOLD, EVENT_TYPES.KEEPER_ASSIGNED].includes(event.type))) {
      if (playerIds.has(event.payload.playerId)) throw new Error("duplicate player");
      playerIds.add(event.payload.playerId);
      stateTeams[event.payload.teamId].roster.push(event.payload);
    }
    const positions = operational.filter((event) => [EVENT_TYPES.PLAYER_SOLD, EVENT_TYPES.NOMINATION_SKIPPED].includes(event.type)).length;
    return {
      config: { season: 2026, rosterSize: 14, minimumRosterSize: 1, starterRequirements: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 }, nominationOrder: ["alpha", "beta"], teams },
      teams: stateTeams,
      nominationStep: positions,
      currentNominatorTeamId: Math.floor(positions / 2) % 2 === 0 ? teams[positions % 2].id : teams[1 - (positions % 2)].id,
      updatedAt: events.at(-1)?.createdAt || null,
    };
  },
};

test("reconciles multiple native assignments in one canonical commit", async () => {
  const players = [
    { id: "player-one", name: "Player One", position: "QB", nflTeam: "DEN" },
    { id: "player-two", name: "Player Two", position: "RB", nflTeam: "MIN" },
  ];
  const first = stateEngine.createEvent(EVENT_TYPES.PLAYER_SOLD, { playerId: "player-one", playerName: "Player One", position: "QB", nflTeam: "DEN", teamId: "alpha", amount: 5, nominatorTeamId: "alpha" });
  const second = stateEngine.createEvent(EVENT_TYPES.PLAYER_SOLD, { playerId: "player-two", playerName: "Player Two", position: "RB", nflTeam: "MIN", teamId: "beta", amount: 6, nominatorTeamId: "beta" });
  let context = { events: [first, second], generation: 1, draftPack: { players } };
  let commits = 0;
  const service = createNativeLedgerService({
    stateEngine,
    adapter: {
      async load() { return structuredClone(context); },
      async commitCanonical({ events, expectedGeneration }) {
        commits += 1;
        assert.equal(expectedGeneration, context.generation);
        context = { ...context, events: structuredClone(events), generation: context.generation + 1 };
        return structuredClone(context);
      },
    },
  });

  const snapshot = await service.command({
    type: "reconcile-assignments", idempotencyKey: "reconcile-test",
    changes: [
      { assignmentId: first.id, playerId: "player-two", teamId: "alpha", price: 7, contractYear: null },
      { assignmentId: second.id, playerId: "player-one", teamId: "beta", price: 8, contractYear: null },
    ],
  });
  assert.equal(commits, 1);
  assert.equal(snapshot.assignments.filter((assignment) => assignment.status === "active").length, 2);
  assert.ok(snapshot.assignments.some((assignment) => assignment.status === "active" && assignment.playerId === "player-two" && assignment.teamId === "alpha" && assignment.price === 7));
  assert.ok(snapshot.assignments.some((assignment) => assignment.status === "active" && assignment.playerId === "player-one" && assignment.teamId === "beta" && assignment.price === 8));
});

test("generation checks allow only one simultaneous auctioneer write", async () => {
  const players = [
    { id: "concurrent-one", name: "Concurrent One", position: "QB", nflTeam: "DEN" },
    { id: "concurrent-two", name: "Concurrent Two", position: "RB", nflTeam: "MIN" },
  ];
  let context = { events: [], generation: 1, draftPack: { players } };
  const service = createNativeLedgerService({
    stateEngine,
    adapter: {
      async load() { return structuredClone(context); },
      async commitCanonical({ events, expectedGeneration }) {
        if (expectedGeneration !== context.generation) throw new Error("Stale ledger generation.");
        context = { ...context, events: structuredClone(events), generation: context.generation + 1 };
        return structuredClone(context);
      },
    },
  });
  const results = await Promise.allSettled([
    service.command({ type: "record-sale", idempotencyKey: "device-a", playerId: "concurrent-one", teamId: "alpha", price: 4 }),
    service.command({ type: "record-sale", idempotencyKey: "device-b", playerId: "concurrent-two", teamId: "beta", price: 5 }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(context.events.filter((event) => event.type === EVENT_TYPES.PLAYER_SOLD).length, 1);
});

test("an idempotency retry cannot create a second sale", async () => {
  const players = [{ id: "retry-player", name: "Retry Player", position: "WR", nflTeam: "BUF" }];
  let context = { events: [], generation: 1, draftPack: { players }, completedIdempotencyKeys: [] };
  const service = createNativeLedgerService({
    stateEngine,
    adapter: {
      async load() { return structuredClone(context); },
      async commitCanonical({ events, expectedGeneration, idempotencyKey }) {
        if (expectedGeneration !== context.generation) throw new Error("Stale ledger generation.");
        context = { ...context, events: structuredClone(events), generation: context.generation + 1, completedIdempotencyKeys: [...context.completedIdempotencyKeys, idempotencyKey] };
        return structuredClone(context);
      },
    },
  });
  const command = { type: "record-sale", idempotencyKey: "same-retry", playerId: "retry-player", teamId: "alpha", price: 6 };
  await service.command(command);
  const retried = await service.command(command);
  assert.equal(context.events.filter((event) => event.type === EVENT_TYPES.PLAYER_SOLD).length, 1);
  assert.equal(retried.assignments.filter((assignment) => assignment.status === "active").length, 1);
});

test("public assignments derive bye weeks from the current draft pack, including legacy events", async () => {
  const players = [{
    id: "bye-player",
    name: "Bye Player",
    position: "WR",
    nflTeam: "BUF",
    weeklyProjection: { byeWeek: 7 },
  }];
  const sale = stateEngine.createEvent(EVENT_TYPES.PLAYER_SOLD, {
    playerId: "bye-player",
    playerName: "Bye Player",
    position: "WR",
    nflTeam: "BUF",
    teamId: "alpha",
    amount: 6,
    nominatorTeamId: "alpha",
  });
  const context = { events: [sale], generation: 1, draftPack: { players } };
  const service = createNativeLedgerService({
    stateEngine,
    adapter: {
      async load() { return structuredClone(context); },
      async commitCanonical() { throw new Error("Read-only fixture"); },
    },
  });

  const snapshot = await service.snapshot();
  assert.equal(snapshot.assignments[0].byeWeek, 7);
  assert.equal(snapshot.availablePlayers[0].byeWeek, 7);
});

test("finished teams are audited and skipped until explicitly reopened", async () => {
  const players = [
    { id: "beta-keeper", name: "Beta Keeper", position: "RB", nflTeam: "MIN" },
    { id: "alpha-sale", name: "Alpha Sale", position: "WR", nflTeam: "BUF" },
    { id: "alpha-sale-two", name: "Alpha Sale Two", position: "TE", nflTeam: "DEN" },
  ];
  const keeper = stateEngine.createEvent(EVENT_TYPES.KEEPER_ASSIGNED, { playerId: "beta-keeper", playerName: "Beta Keeper", position: "RB", nflTeam: "MIN", teamId: "beta", salary: 1, keeperYear: 1, selectionRound: 1 });
  let context = { events: [keeper], operationalEvents: [], generation: 1, draftPack: { players } };
  const service = createNativeLedgerService({
    stateEngine,
    adapter: {
      async load() { return structuredClone(context); },
      async commitCanonical({ events, operationalEvents, expectedGeneration }) {
        assert.equal(expectedGeneration, context.generation);
        context = { ...context, events: structuredClone(events), operationalEvents: structuredClone(operationalEvents), generation: context.generation + 1 };
        return structuredClone(context);
      },
    },
  });
  let snapshot = await service.command({ type: "mark-team-finished", teamId: "beta", idempotencyKey: "finish-beta" });
  assert.deepEqual(snapshot.finishedTeamIds, ["beta"]);
  await service.command({ type: "record-sale", playerId: "alpha-sale", teamId: "alpha", price: 2, idempotencyKey: "sell-alpha" });
  await service.command({ type: "record-sale", playerId: "alpha-sale-two", teamId: "alpha", price: 2, idempotencyKey: "sell-alpha-two" });
  assert.equal(context.events.filter((event) => event.type === EVENT_TYPES.NOMINATION_SKIPPED).length, 2);
  snapshot = await service.command({ type: "reopen-team", teamId: "beta", idempotencyKey: "reopen-beta" });
  assert.deepEqual(snapshot.finishedTeamIds, []);
  assert.ok(snapshot.auditEvents.some((event) => event.action === "Marked team finished"));
  assert.ok(snapshot.auditEvents.some((event) => event.action === "Reopened team"));
});

test("staged nominations can be replaced and cleared without creating ledger assignments", async () => {
  const players = [
    { id: "nominee-one", name: "Nominee <One>", position: "QB", nflTeam: "DEN" },
    { id: "nominee-two", name: "Nominee Two", position: "RB", nflTeam: "MIN" },
  ];
  let context = { events: [], operationalEvents: [], generation: 1, draftPack: { players } };
  const service = createNativeLedgerService({
    stateEngine,
    adapter: {
      async load() { return structuredClone(context); },
      async commitCanonical({ events, operationalEvents, expectedGeneration, idempotencyKey }) {
        assert.equal(expectedGeneration, context.generation);
        context = {
          ...context,
          events: structuredClone(events),
          operationalEvents: structuredClone(operationalEvents),
          completedIdempotencyKeys: [...(context.completedIdempotencyKeys || []), idempotencyKey],
          generation: context.generation + 1,
        };
        return structuredClone(context);
      },
    },
  });

  let snapshot = await service.command({ type: "stage-nomination", playerId: "nominee-one", idempotencyKey: "stage-one" });
  assert.equal(snapshot.stagedNomination.name, "Nominee <One>");
  snapshot = await service.command({ type: "stage-nomination", playerId: "nominee-two", idempotencyKey: "stage-two" });
  assert.equal(snapshot.stagedNomination.id, "nominee-two");
  snapshot = await service.command({ type: "clear-nomination", idempotencyKey: "clear-stage" });
  assert.equal(snapshot.stagedNomination, null);
  assert.equal(snapshot.assignments.length, 0);
  assert.equal(context.events.length, 0);
  assert.deepEqual(context.operationalEvents.map((event) => event.type), ["NOMINATION_STAGED", "CLOCK_UPDATED", "NOMINATION_STAGED", "CLOCK_UPDATED", "NOMINATION_CLEARED"]);
});

test("nomination clock state is committed, survives reload, and restarts after a sale", async () => {
  const players = [{ id: "clock-player", name: "Clock Player", position: "QB", nflTeam: "DEN" }];
  let context = { events: [], operationalEvents: [], generation: 1, draftPack: { players }, completedIdempotencyKeys: [] };
  const service = createNativeLedgerService({
    stateEngine,
    adapter: {
      async load() { return structuredClone(context); },
      async commitCanonical({ events, operationalEvents, expectedGeneration, idempotencyKey }) {
        assert.equal(expectedGeneration, context.generation);
        context = {
          ...context,
          events: structuredClone(events),
          operationalEvents: structuredClone(operationalEvents),
          completedIdempotencyKeys: [...context.completedIdempotencyKeys, idempotencyKey],
          generation: context.generation + 1,
        };
        return structuredClone(context);
      },
    },
  });
  let snapshot = await service.command({ type: "update-clock", action: "set-duration", durationMs: 30_000, idempotencyKey: "clock-duration" });
  assert.equal(snapshot.clock.durationMs, 30_000);
  assert.equal(snapshot.clock.status, "paused");
  snapshot = await service.command({ type: "update-clock", action: "resume", idempotencyKey: "clock-resume" });
  assert.equal(snapshot.clock.status, "running");
  snapshot = await service.command({ type: "record-sale", playerId: "clock-player", teamId: "alpha", price: 1, idempotencyKey: "clock-sale" });
  assert.equal(snapshot.clock.status, "running");
  assert.equal(snapshot.clock.durationMs, 30_000);
  assert.ok(snapshot.clock.remainingMs > 29_000);
  assert.equal((await service.snapshot()).clock.durationMs, 30_000);
});
