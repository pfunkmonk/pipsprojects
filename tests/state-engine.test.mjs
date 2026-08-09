import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_CONFIG,
  EVENT_TYPES,
  RuleViolation,
  applyLiveMarketMultiplier,
  canReplaceUnstartedConfiguration,
  calculateLiveMarketState,
  createEvent,
  createRecoveryBundle,
  keeperSelectionTimeline,
  lastUndoableEvent,
  lastUndoableSale,
  mergeEventStreams,
  nominationOrderEvidence,
  rankOpponentPressure,
  replayDraft,
  snakeTeamId,
  toPublicSnapshot,
  validateDraftPack,
  validateRecoveryBundle,
} from "../public/thunder-bowl/state-engine.mjs";

const deviceId = "device-test-001";
const at = (index) => `2026-08-29T18:${String(index).padStart(2, "0")}:00.000Z`;
const make = (type, payload, index) => createEvent(type, payload, { id: `event-${String(index).padStart(3, "0")}`, deviceId, createdAt: at(index) });
const configEvent = (config = DEFAULT_CONFIG) => make(EVENT_TYPES.DRAFT_CONFIGURED, config, 0);

function sale(index, overrides = {}) {
  const order = DEFAULT_CONFIG.nominationOrder;
  return make(
    EVENT_TYPES.PLAYER_SOLD,
    {
      playerId: `player-${index}`,
      playerName: `Player ${index}`,
      position: "RB",
      nflTeam: "DET",
      teamId: "dogs-of-war",
      amount: 1,
      nominatorTeamId: snakeTeamId(order, index - 1),
      ...overrides,
    },
    index,
  );
}

test("confirmed 2026 caps and complete final-ranking order are preserved", () => {
  const state = replayDraft([configEvent()]);
  assert.equal(state.teams["goon-skwad"].cash, 106);
  assert.equal(state.teams["dogs-of-war"].cash, 104);
  assert.equal(state.teams["el-guapo"].cash, 102);
  assert.equal(state.teams["dogs-of-war"].legalMaxBid, 97);
  assert.equal(state.currentNominatorTeamId, "orange-crush");
  assert.equal(state.config.verifiedPrefixCount, 12);
  assert.equal(state.config.nominationOrder[8], "el-guapo");
  assert.equal(state.config.nominationOrderStatus, "verified");
});

test("nomination evidence never counts a provisional position as verified", () => {
  const partial = { ...DEFAULT_CONFIG, nominationOrderStatus: "verified-prefix-only", verifiedPrefixCount: 2 };
  assert.equal(nominationOrderEvidence(partial, 0), "verified");
  assert.equal(nominationOrderEvidence(partial, 1), "verified");
  assert.equal(nominationOrderEvidence(partial, 2), "provisional");
  assert.equal(nominationOrderEvidence(partial, 3), "unverified");
  assert.equal(nominationOrderEvidence(DEFAULT_CONFIG, 11), "verified");
});

test("only a pristine configuration ledger can rebind to new league evidence", () => {
  const configured = configEvent();
  const purchase = sale(1);
  const purchaseUndo = make(EVENT_TYPES.EVENT_VOIDED, { targetEventId: purchase.id, reason: "Corrected practice action" }, 2);
  assert.equal(canReplaceUnstartedConfiguration([]), true);
  assert.equal(canReplaceUnstartedConfiguration([configured]), true);
  assert.equal(canReplaceUnstartedConfiguration([configured, purchase]), false);
  assert.equal(canReplaceUnstartedConfiguration([configured, purchase, purchaseUndo]), true);
});

test("opponent pressure is dynamic, capped, deterministic, and excludes Dogs of War", () => {
  const state = replayDraft([configEvent()]);
  state.teams["big-head"].legalMaxBid = 5;
  const profile = (teamId, overrides = {}) => ({
    teamId,
    teamName: state.teams[teamId].name,
    sampleSeasons: 4,
    samplePurchases: 40,
    observedSpend: 320,
    reliability: 0.5,
    confidence: "low_advisory_only",
    positionMultipliers: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1, ...(overrides.positionMultipliers || {}) },
    topNflAffinity: overrides.topNflAffinity || "KC",
    topNflAffinityMultiplier: overrides.topNflAffinityMultiplier || 1.1,
    modelEffect: "advisory_only",
    note: "Winning purchases only.",
  });
  const profiles = [
    profile("dogs-of-war", { positionMultipliers: { RB: 2 } }),
    profile("goon-skwad", { positionMultipliers: { RB: 1.6 }, topNflAffinity: "DET", topNflAffinityMultiplier: 2 }),
    profile("el-guapo", { positionMultipliers: { RB: 1.1 } }),
    profile("big-head", { positionMultipliers: { RB: 2.1 } }),
  ];
  const ranked = rankOpponentPressure({
    profiles,
    state,
    player: { position: "RB", nflTeam: "DET" },
    liveMarketValue: 40,
  });
  assert.deepEqual(ranked.map((row) => row.teamId), ["goon-skwad", "el-guapo"]);
  assert.equal(ranked[0].affinityMultiplierApplied, 1.25);
  assert.equal(ranked[0].starterNeeded, true);
  assert.equal(ranked[0].label, "HIGH");
  assert.equal(ranked[0].modelEffect, "advisory_only");
});

test("snake nominations repeat both turn endpoints", () => {
  const order = DEFAULT_CONFIG.nominationOrder;
  assert.equal(snakeTeamId(order, 0), order[0]);
  assert.equal(snakeTeamId(order, 11), order[11]);
  assert.equal(snakeTeamId(order, 12), order[11]);
  assert.equal(snakeTeamId(order, 23), order[0]);
  assert.equal(snakeTeamId(order, 24), order[0]);
});

test("sale updates cash, roster, player ownership, and nomination", () => {
  const event = sale(1, { playerName: "Amon-Ra St. Brown", playerId: "sample-amon-ra", position: "WR", amount: 32 });
  const state = replayDraft([configEvent(), event]);
  assert.equal(state.teams["dogs-of-war"].cash, 72);
  assert.equal(state.teams["dogs-of-war"].roster.length, 1);
  assert.equal(state.teams["dogs-of-war"].positionCounts.WR, 1);
  assert.equal(state.draftedPlayers["sample-amon-ra"].teamId, "dogs-of-war");
  assert.equal(state.currentNominatorTeamId, "the-hobbits");
  assert.equal(state.lastSale.amount, 32);
});

test("legal maximum reserves only the additions needed for a legal 8-player lineup", () => {
  const illegal = sale(1, { amount: 98 });
  assert.throws(
    () => replayDraft([configEvent(), illegal]),
    (error) => error instanceof RuleViolation && error.code === "ILLEGAL_BID" && error.details.maximum === 97,
  );
});

test("a team may stop at eight legal starters while retaining six optional roster slots", () => {
  const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DST"];
  const events = positions.map((position, index) => sale(index + 1, {
    playerId: `minimum-roster-${index + 1}`,
    playerName: `Minimum Roster ${index + 1}`,
    position,
    amount: index === 0 ? 97 : 1,
  }));
  const state = replayDraft([configEvent(), ...events]);
  const dogs = state.teams["dogs-of-war"];
  assert.equal(dogs.roster.length, 8);
  assert.equal(dogs.cash, 0);
  assert.equal(dogs.requiredAdditions, 0);
  assert.equal(dogs.openSlots, 6);
  assert.equal(dogs.legalMaxBid, 0);
});

test("live market state preserves the $1 floor and damps room inflation", () => {
  const neutral = calculateLiveMarketState({ remainingRoomDollars: 10, remainingOpenSlots: 4, remainingMarketValues: [4, 3, 2, 1, 1] });
  assert.equal(neutral.baselineDiscretionary, 6);
  assert.equal(neutral.cashDiscretionary, 6);
  assert.equal(neutral.dampedMultiplier, 1);
  const inflated = calculateLiveMarketState({ remainingRoomDollars: 13, remainingOpenSlots: 4, remainingMarketValues: [4, 3, 2, 1, 1] });
  assert.equal(inflated.rawMultiplier, 1.5);
  assert.equal(inflated.dampedMultiplier, 1.325);
  assert.equal(applyLiveMarketMultiplier(9, inflated.dampedMultiplier), 12);
  assert.equal(applyLiveMarketMultiplier(1, inflated.dampedMultiplier), 1);
});

test("duplicate player purchases are rejected", () => {
  const first = sale(1, { playerId: "same-player", teamId: "dogs-of-war" });
  const second = sale(2, { playerId: "same-player", teamId: "goon-skwad" });
  assert.throws(
    () => replayDraft([configEvent(), first, second]),
    (error) => error instanceof RuleViolation && error.code === "PLAYER_UNAVAILABLE",
  );
});

test("roster construction cannot consume slots required for missing starters", () => {
  const events = [configEvent()];
  for (let index = 1; index <= 8; index += 1) events.push(sale(index, { position: "RB" }));
  const legalState = replayDraft(events);
  assert.equal(legalState.teams["dogs-of-war"].roster.length, 8);
  assert.equal(legalState.teams["dogs-of-war"].missingStarterSlots, 6);
  assert.throws(
    () => replayDraft([...events, sale(9, { position: "RB" })]),
    (error) => error instanceof RuleViolation && error.code === "STARTER_PATH_BLOCKED",
  );
});

test("undo is append-only and restores the exact prior state", () => {
  const purchase = sale(1, { playerId: "undo-player", amount: 17 });
  const undo = make(EVENT_TYPES.EVENT_VOIDED, { targetEventId: purchase.id, reason: "Auctioneer correction" }, 2);
  const before = replayDraft([configEvent()]);
  const after = replayDraft([configEvent(), purchase, undo]);
  assert.equal(after.teams["dogs-of-war"].cash, before.teams["dogs-of-war"].cash);
  assert.equal(after.teams["dogs-of-war"].roster.length, 0);
  assert.equal(after.lastSale, null);
  assert.equal(lastUndoableSale([configEvent(), purchase, undo]), null);
});

test("cap transfer and keeper reproduce the $2 plus $4 Herbert example", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.teams = config.teams.map((team) => ({ ...team, startingCap: 100, capStatus: "test" }));
  const configured = configEvent(config);
  const transfer = make(
    EVENT_TYPES.CAP_TRANSFERRED,
    { fromTeamId: "goon-skwad", toTeamId: "dogs-of-war", amount: 2, reason: "Justin Herbert rights" },
    1,
  );
  const keeper = make(
    EVENT_TYPES.KEEPER_ASSIGNED,
    {
      playerId: "justin-herbert-example",
      playerName: "Justin Herbert",
      position: "QB",
      nflTeam: "LAC",
      teamId: "goon-skwad",
      salary: 4,
      keeperYear: 3,
      source: "user example",
    },
    2,
  );
  const state = replayDraft([configured, transfer, keeper]);
  assert.equal(state.teams["dogs-of-war"].cash, 102);
  assert.equal(state.teams["goon-skwad"].cash, 94);
  assert.equal(state.teams["goon-skwad"].roster[0].price, 4);
  assert.equal(state.teams["goon-skwad"].roster[0].keeperYear, 3);
});

test("keeper-rights trade moves the player and cap atomically and undo restores both", () => {
  const trade = make(
    EVENT_TYPES.KEEPER_RIGHTS_TRADED,
    {
      teamAId: "the-hobbits",
      teamBId: "t-dogs",
      amountFromAToB: 4,
      teamASends: [],
      teamBSends: [{ playerId: "jonathan-taylor-rights", playerName: "Jonathan Taylor" }],
    },
    1,
  );
  const traded = replayDraft([configEvent(), trade]);
  assert.equal(traded.teams["the-hobbits"].cash, 96);
  assert.equal(traded.teams["t-dogs"].cash, 104);
  assert.equal(traded.keeperRightsOwners["jonathan-taylor-rights"].teamId, "the-hobbits");

  const orangePass = make(
    EVENT_TYPES.KEEPER_PASSED,
    { teamId: "orange-crush", round: 1, reason: "No keeper selected for this turn" },
    2,
  );
  const keeper = make(
    EVENT_TYPES.KEEPER_ASSIGNED,
    {
      playerId: "jonathan-taylor-rights",
      playerName: "Jonathan Taylor",
      position: "RB",
      nflTeam: "IND",
      teamId: "the-hobbits",
      salary: 27,
      keeperYear: 2,
      selectionRound: 1,
      source: "authenticated test candidate",
    },
    3,
  );
  const kept = replayDraft([configEvent(), trade, orangePass, keeper]);
  assert.equal(kept.teams["the-hobbits"].cash, 69);
  assert.equal(kept.teams["the-hobbits"].roster[0].playerName, "Jonathan Taylor");

  const undo = make(EVENT_TYPES.EVENT_VOIDED, { targetEventId: trade.id, reason: "Trade correction" }, 4);
  const restored = replayDraft([configEvent(), trade, undo]);
  const baseline = replayDraft([configEvent()]);
  assert.equal(restored.teams["the-hobbits"].cash, baseline.teams["the-hobbits"].cash);
  assert.equal(restored.teams["t-dogs"].cash, baseline.teams["t-dogs"].cash);
  assert.deepEqual(restored.keeperRightsOwners, {});
});

test("a transferred player can only be kept or resold by the current rights owner", () => {
  const trade = make(
    EVENT_TYPES.KEEPER_RIGHTS_TRADED,
    {
      teamAId: "the-hobbits",
      teamBId: "t-dogs",
      amountFromAToB: 2,
      teamASends: [],
      teamBSends: [{ playerId: "rights-owner-check", playerName: "Rights Owner Check" }],
    },
    1,
  );
  const invalidResale = make(
    EVENT_TYPES.KEEPER_RIGHTS_TRADED,
    {
      teamAId: "dogs-of-war",
      teamBId: "t-dogs",
      amountFromAToB: 1,
      teamASends: [],
      teamBSends: [{ playerId: "rights-owner-check", playerName: "Rights Owner Check" }],
    },
    2,
  );
  assert.throws(
    () => replayDraft([configEvent(), trade, invalidResale]),
    (error) => error instanceof RuleViolation && error.code === "RIGHTS_SELLER_MISMATCH",
  );
});

test("one atomic package supports two-for-one rights and a zero-dollar player swap", () => {
  const swap = make(
    EVENT_TYPES.KEEPER_RIGHTS_TRADED,
    {
      teamAId: "the-hobbits",
      teamBId: "t-dogs",
      amountFromAToB: 0,
      teamASends: [{ playerId: "hobbits-player-one", playerName: "Hobbits Player" }],
      teamBSends: [
        { playerId: "tdogs-player-one", playerName: "T-Dogs Player One" },
        { playerId: "tdogs-player-two", playerName: "T-Dogs Player Two" },
      ],
    },
    1,
  );
  const state = replayDraft([configEvent(), swap]);
  assert.equal(state.keeperRightsOwners["hobbits-player-one"].teamId, "t-dogs");
  assert.equal(state.keeperRightsOwners["tdogs-player-one"].teamId, "the-hobbits");
  assert.equal(state.keeperRightsOwners["tdogs-player-two"].teamId, "the-hobbits");
  assert.equal(state.teams["the-hobbits"].cash, DEFAULT_CONFIG.teams.find((team) => team.id === "the-hobbits").startingCap);
  assert.equal(state.teams["t-dogs"].cash, DEFAULT_CONFIG.teams.find((team) => team.id === "t-dogs").startingCap);
});

test("keeper selection follows 1-12 and then repeats 1-12 with explicit passes", () => {
  const initial = keeperSelectionTimeline([configEvent()], DEFAULT_CONFIG);
  assert.equal(initial.totalSlots, 24);
  assert.deepEqual(
    initial.slots.map((slot) => slot.teamId),
    [...DEFAULT_CONFIG.nominationOrder, ...DEFAULT_CONFIG.nominationOrder],
  );
  assert.deepEqual(initial.nextSlot, initial.slots[0]);

  const orangePass = make(
    EVENT_TYPES.KEEPER_PASSED,
    { teamId: "orange-crush", round: 1, reason: "No keeper selected for this turn" },
    1,
  );
  const hobbitsKeeper = make(
    EVENT_TYPES.KEEPER_ASSIGNED,
    {
      playerId: "keeper-timeline-hobbits",
      playerName: "Timeline Keeper",
      position: "RB",
      nflTeam: "DET",
      teamId: "the-hobbits",
      salary: 6,
      keeperYear: 2,
      selectionRound: 1,
      source: "authenticated test candidate",
    },
    2,
  );
  const state = replayDraft([configEvent(), orangePass, hobbitsKeeper]);
  assert.equal(state.keeperSelection.completedCount, 2);
  assert.equal(state.keeperSelection.slots[0].status, "passed");
  assert.equal(state.keeperSelection.slots[1].status, "kept");
  assert.equal(state.keeperSelection.nextSlot.teamId, "crime-and-punishment");
  assert.equal(state.keeperSelection.nextSlot.round, 1);
});

test("keeper selection rejects out-of-order turns and undo reopens the exact slot", () => {
  const wrongPass = make(
    EVENT_TYPES.KEEPER_PASSED,
    { teamId: "dogs-of-war", round: 1, reason: "No keeper selected for this turn" },
    1,
  );
  assert.throws(
    () => replayDraft([configEvent(), wrongPass]),
    (error) => error instanceof RuleViolation && error.code === "WRONG_KEEPER_TURN",
  );

  const orangePass = make(
    EVENT_TYPES.KEEPER_PASSED,
    { teamId: "orange-crush", round: 1, reason: "No keeper selected for this turn" },
    2,
  );
  const undo = make(EVENT_TYPES.EVENT_VOIDED, { targetEventId: orangePass.id, reason: "Keeper turn correction" }, 3);
  const restored = replayDraft([configEvent(), orangePass, undo]);
  assert.equal(restored.keeperSelection.completedCount, 0);
  assert.equal(restored.keeperSelection.nextSlot.teamId, "orange-crush");
  assert.equal(
    lastUndoableEvent([configEvent(), orangePass, undo], [EVENT_TYPES.KEEPER_PASSED]),
    null,
  );
});

test("keeper setup undo targets the latest active setup action and restores exact state", () => {
  const transfer = make(
    EVENT_TYPES.CAP_TRANSFERRED,
    { fromTeamId: "goon-skwad", toTeamId: "dogs-of-war", amount: 2, reason: "Justin Herbert rights" },
    1,
  );
  const keeper = make(
    EVENT_TYPES.KEEPER_ASSIGNED,
    {
      playerId: "justin-herbert-undo",
      playerName: "Justin Herbert",
      position: "QB",
      nflTeam: "LAC",
      teamId: "goon-skwad",
      salary: 4,
      keeperYear: 3,
      source: "authenticated test candidate",
    },
    2,
  );
  const keeperUndo = make(EVENT_TYPES.EVENT_VOIDED, { targetEventId: keeper.id, reason: "Keeper correction" }, 3);
  const afterKeeperUndo = replayDraft([configEvent(), transfer, keeper, keeperUndo]);
  assert.equal(lastUndoableEvent([configEvent(), transfer, keeper, keeperUndo], [EVENT_TYPES.CAP_TRANSFERRED, EVENT_TYPES.KEEPER_ASSIGNED]).id, transfer.id);
  assert.equal(afterKeeperUndo.teams["goon-skwad"].roster.length, 0);
  assert.equal(afterKeeperUndo.teams["goon-skwad"].cash, 104);
  assert.equal(afterKeeperUndo.teams["dogs-of-war"].cash, 106);

  const transferUndo = make(EVENT_TYPES.EVENT_VOIDED, { targetEventId: transfer.id, reason: "Trade correction" }, 4);
  const restored = replayDraft([configEvent(), transfer, keeper, keeperUndo, transferUndo]);
  const baseline = replayDraft([configEvent()]);
  assert.deepEqual(restored.teams, baseline.teams);
  assert.equal(lastUndoableEvent([configEvent(), transfer, keeper, keeperUndo, transferUndo], [EVENT_TYPES.CAP_TRANSFERRED, EVENT_TYPES.KEEPER_ASSIGNED]), null);
});

test("public snapshot immediately reflects keeper salary and cap transfer", () => {
  const transfer = make(
    EVENT_TYPES.CAP_TRANSFERRED,
    { fromTeamId: "goon-skwad", toTeamId: "dogs-of-war", amount: 2, reason: "Keeper rights" },
    1,
  );
  const keeper = make(
    EVENT_TYPES.KEEPER_ASSIGNED,
    {
      playerId: "keeper-public-board",
      playerName: "Keeper Board Player",
      position: "WR",
      nflTeam: "DET",
      teamId: "goon-skwad",
      salary: 4,
      keeperYear: 2,
      source: "authenticated test candidate",
    },
    2,
  );
  const snapshot = toPublicSnapshot(replayDraft([configEvent(), transfer, keeper]));
  const payer = snapshot.teams.find((team) => team.id === "goon-skwad");
  const receiver = snapshot.teams.find((team) => team.id === "dogs-of-war");
  assert.equal(payer.cash, 100);
  assert.equal(receiver.cash, 106);
  assert.equal(snapshot.teams[0].id, "orange-crush");
  assert.equal(snapshot.teams[11].id, "three-amigos");
  assert.equal(payer.startingCap, 104);
  assert.deepEqual(payer.players[0], {
    playerId: "keeper-public-board",
    playerName: "Keeper Board Player",
    position: "WR",
    price: 4,
    acquisitionType: "keeper",
    keeperYear: 2,
  });
});

test("public snapshot contains only public board fields", () => {
  const state = replayDraft([configEvent(), sale(1, { playerName: "Private Test Player", position: "WR", amount: 22 })]);
  const publicState = toPublicSnapshot(state, { revision: "rev-1" });
  assert.equal(publicState.teams.length, 12);
  assert.equal(publicState.teams.find((team) => team.id === "dogs-of-war").players[0].price, 22);
  const serialized = JSON.stringify(publicState);
  for (const forbidden of ["projectedPoints", "projectionSources", "weeklyProjection", "weeklyContext", "managerProfiles", "pressureIndex", "opponentPressure", "vbd", "intrinsicValue", "marketValue", "maxBid", "notes", "managerProfile", "targetTag"]) {
    assert.equal(serialized.includes(forbidden), false, `public payload leaked ${forbidden}`);
  }
});

test("event merge is idempotent and rejects conflicting ids", () => {
  const configured = configEvent();
  const purchase = sale(1);
  assert.equal(mergeEventStreams([configured, purchase], [configured, purchase]).length, 2);
  const collision = { ...purchase, payload: { ...purchase.payload, amount: 2 } };
  assert.throws(
    () => mergeEventStreams([configured, purchase], [collision]),
    (error) => error instanceof RuleViolation && error.code === "EVENT_ID_COLLISION",
  );
});

test("equivalent active configuration events coalesce across devices", () => {
  const first = createEvent(EVENT_TYPES.DRAFT_CONFIGURED, DEFAULT_CONFIG, {
    id: "config-device-one",
    deviceId: "device-one",
    createdAt: "2026-08-03T18:00:00.000Z",
  });
  const second = createEvent(EVENT_TYPES.DRAFT_CONFIGURED, DEFAULT_CONFIG, {
    id: "config-device-two",
    deviceId: "device-two",
    createdAt: "2026-08-03T18:00:01.000Z",
  });
  const merged = mergeEventStreams([first], [second]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, first.id);
  assert.equal(replayDraft(merged).config.teams.length, 12);
});

test("bundled draft pack and recovery format validate end to end", async () => {
  const pack = validateDraftPack(JSON.parse(await readFile(new URL("../public/thunder-bowl/sample-draft-pack.json", import.meta.url), "utf8")));
  assert.equal(pack.players.length, 12);
  assert.equal(pack.status, "illustrative");
  const stream = [configEvent(pack.leagueConfig), sale(1)];
  const recovery = createRecoveryBundle(pack, stream, "2026-08-29T22:00:00.000Z");
  const restored = validateRecoveryBundle(recovery);
  assert.equal(restored.events.length, 2);
  assert.equal(restored.pack.packId, pack.packId);
});

test("protected Footballguys auction values are complete for the supplied partial PDF and value neutral", async () => {
  const raw = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
  const pack = validateDraftPack(raw);
  assert.equal(pack.fbgAuctionValues.modelEffect, "none");
  assert.equal(pack.fbgAuctionValues.rankStart, 301);
  assert.equal(pack.fbgAuctionValues.rankEnd, 400);
  assert.equal(pack.fbgAuctionValues.reportedRows, 100);
  assert.equal(pack.fbgAuctionValues.matchedRows, 100);
  assert.equal(new Set(pack.fbgAuctionValues.values.map((row) => row.playerId)).size, 100);
  const unauthorized = structuredClone(raw);
  unauthorized.fbgAuctionValues.modelEffect = "market_value";
  assert.throws(() => validateDraftPack(unauthorized), (error) => error.code === "FBG_VALUE_AUTHORITY");
});

test("dated projection evidence is validated and supplemental sources stay value neutral", async () => {
  const raw = JSON.parse(await readFile(new URL("../public/thunder-bowl/sample-draft-pack.json", import.meta.url), "utf8"));
  const player = raw.players[0];
  player.projectionSources = [{
    source: "Footballguys",
    points: player.projectedPoints,
    asOf: "2026-08-03T20:42:15.061Z",
    role: "primary",
    modelEffect: "primary_projection",
    note: "Primary offensive projection",
  }, {
    source: "FantasyPros",
    points: player.projectedPoints + 12,
    asOf: "2026-08-03T23:31:50.459Z",
    role: "supplemental",
    modelEffect: "none",
    note: "Consensus second opinion; no value effect",
  }];
  const pack = validateDraftPack(raw);
  assert.equal(pack.players[0].projectionSources[1].modelEffect, "none");
  assert.equal(pack.players[0].projectionSources[1].points, player.projectedPoints + 12);

  raw.players[0].projectionSources[1].modelEffect = "primary_projection";
  assert.throws(
    () => validateDraftPack(raw),
    (error) => error instanceof RuleViolation && error.code === "SUPPLEMENTAL_SOURCE_EFFECT",
  );
});

test("manager profiles require complete low-confidence advisory coverage", async () => {
  const raw = JSON.parse(await readFile(new URL("../public/thunder-bowl/sample-draft-pack.json", import.meta.url), "utf8"));
  raw.managerProfiles = raw.leagueConfig.teams.map((team) => ({
    teamId: team.id,
    teamName: team.name,
    sampleSeasons: 4,
    samplePurchases: 30,
    observedSpend: 300,
    reliability: 0.5,
    confidence: "low_advisory_only",
    positionMultipliers: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 },
    topNflAffinity: "DET",
    topNflAffinityMultiplier: 1.2,
    modelEffect: "advisory_only",
    note: "Winning purchases only; no losing bids.",
  }));
  assert.equal(validateDraftPack(raw).managerProfiles.length, 12);
  const excessive = structuredClone(raw);
  excessive.managerProfiles[0].reliability = 0.75;
  assert.throws(() => validateDraftPack(excessive), (error) => error.code === "MANAGER_PROFILE_RELIABILITY");
  const incomplete = structuredClone(raw);
  incomplete.managerProfiles.pop();
  assert.throws(() => validateDraftPack(incomplete), (error) => error.code === "INCOMPLETE_MANAGER_PROFILE_COVERAGE");
  const unauthorized = structuredClone(raw);
  unauthorized.managerProfiles[0].modelEffect = "market_value";
  assert.throws(() => validateDraftPack(unauthorized), (error) => error.code === "MANAGER_PROFILE_AUTHORITY");
});

test("schedule context is complete and cannot acquire value authority", async () => {
  const raw = JSON.parse(await readFile(new URL("../public/thunder-bowl/sample-draft-pack.json", import.meta.url), "utf8"));
  raw.scheduleContext = {
    status: "loaded_value_neutral",
    asOf: "2026-08-04T02:36:00Z",
    source: "CBS Sports authenticated Thunder Bowl pages",
    modelEffect: "none",
    weightingStatus: "disabled_pending_preregistered_historical_gate",
    cbsTeamId: 4,
    division: "North",
    divisionRivals: ["Crime and Punishment", "The Hobbits"],
    divisionWeeks: [
      { week: 1, opponent: "Crime and Punishment" },
      { week: 3, opponent: "The Hobbits" },
      { week: 11, opponent: "The Hobbits" },
      { week: 12, opponent: "Crime and Punishment" },
    ],
    randomWeek14Opponent: "Crime and Punishment",
    playoffWeeks: [15, 16, 17],
  };
  assert.equal(validateDraftPack(raw).scheduleContext.modelEffect, "none");

  const unauthorized = structuredClone(raw);
  unauthorized.scheduleContext.modelEffect = "market_value";
  assert.throws(() => validateDraftPack(unauthorized), (error) => error.code === "SCHEDULE_CONTEXT_AUTHORITY");

  const incomplete = structuredClone(raw);
  incomplete.scheduleContext.divisionWeeks.pop();
  assert.throws(() => validateDraftPack(incomplete), (error) => error.code === "SCHEDULE_CONTEXT_WEEKS");
});

test("weekly context preserves every source projection and cannot acquire value authority", async () => {
  const raw = JSON.parse(await readFile(new URL("../public/thunder-bowl/sample-draft-pack.json", import.meta.url), "utf8"));
  raw.players.forEach((player) => {
    const game = Number((player.projectedPoints / 17).toFixed(2));
    const points = Array(18).fill(game);
    points[6] = null;
    const last = points.findLastIndex((value) => value !== null);
    points[last] = Number((points[last] + player.projectedPoints - points.reduce((sum, value) => sum + (value ?? 0), 0)).toFixed(2));
    player.weeklyProjection = {
      source: "Thunder Bowl weekly context v3",
      asOf: "2026-08-04T18:22:04.000Z",
      modelEffect: "none",
      games: 17,
      byeWeek: 7,
      points,
      sourceSeasonTotal: player.projectedPoints + 10,
    };
  });
  raw.weeklyContext = {
    status: "loaded_experimental_scenario_only",
    asOf: "2026-08-04T18:22:04.000Z",
    source: "Thunder Bowl weekly context v3",
    modelEffect: "none",
    engineBacktestStatus: "pending_historical_context_engine_backtest",
    priorityDefaultStatus: "baseline_only_user_candidate_held",
    defaultWeights: { baseline: 1, division: 1, playoffs: 1 },
    suggestedScenario: { division: 1.2, playoffs: 1.4, status: "experimental_preview_only" },
    divisionWeeks: [1, 3, 11, 12],
    playoffWeeks: [15, 16, 17],
    coveredPlayers: raw.players.length,
    top168Coverage: 1,
    contextFactors: ["matchup", "venue", "cold_climatology", "home_away", "short_week"],
    sourceManifestSha256: "a".repeat(64),
  };
  const pack = validateDraftPack(raw);
  assert.equal(pack.weeklyContext.modelEffect, "none");
  assert.equal(pack.players[0].weeklyProjection.points.reduce((sum, value) => sum + (value ?? 0), 0), pack.players[0].projectedPoints);

  const authority = structuredClone(raw);
  authority.weeklyContext.modelEffect = "vbd";
  assert.throws(() => validateDraftPack(authority), (error) => error.code === "WEEKLY_CONTEXT_AUTHORITY");

  const totalDrift = structuredClone(raw);
  totalDrift.players[0].weeklyProjection.points[0] += 1;
  assert.throws(() => validateDraftPack(totalDrift), (error) => error.code === "WEEKLY_PROJECTION_TOTAL");

  const coverageDrift = structuredClone(raw);
  delete coverageDrift.players[0].weeklyProjection;
  assert.throws(() => validateDraftPack(coverageDrift), (error) => error.code === "WEEKLY_CONTEXT_COVERAGE");
});

test("draft-pack validation rejects duplicate real players hidden behind aliases", async () => {
  const pack = JSON.parse(await readFile(new URL("../public/thunder-bowl/sample-draft-pack.json", import.meta.url), "utf8"));
  pack.players[0] = { ...pack.players[0], id: "ken-walker-alias-one", name: "Ken Walker III", position: "RB", nflTeam: "KC" };
  pack.players[1] = { ...pack.players[1], id: "ken-walker-alias-two", name: "Kenneth Walker III", position: "RB", nflTeam: "KC" };
  assert.throws(
    () => validateDraftPack(pack),
    (error) => error instanceof RuleViolation && error.code === "DUPLICATE_PLAYER_IDENTITY",
  );
});
