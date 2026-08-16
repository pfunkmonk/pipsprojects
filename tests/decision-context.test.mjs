import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBidRecommendation,
  buildAuctionValueAdvice,
  buildDecisionContext,
  buildTierDeadlineWarning,
  buildNominationRecommendations,
  buildTierSnapshot,
  budgetRunway,
  byeWeekConflicts,
  cashLeverage,
  playerSurplusHeat,
  projectionDisagreement,
} from "../public/thunder-bowl/decision-context.mjs";

const players = [
  { id: "rb1", name: "Alpha", position: "RB", tier: 1, sourceRank: 1, marketValue: 40, maxBid: 42, projectionSources: [
    { source: "Primary", points: 340 },
    { source: "Second", points: 370 },
    { source: "Third", points: 352 },
  ] },
  { id: "rb2", name: "Beta", position: "RB", tier: 1, sourceRank: 2, marketValue: 35, maxBid: 36 },
  { id: "rb3", name: "Gamma", position: "RB", tier: 2, sourceRank: 3, marketValue: 29, maxBid: 30 },
  { id: "rb4", name: "Delta", position: "RB", tier: 2, sourceRank: 4, marketValue: 25, maxBid: 26 },
  { id: "wr1", name: "Other position", position: "WR", tier: 2, sourceRank: 1, marketValue: 39, maxBid: 41 },
];

test("dynamic context counts current tier supply and finds the next lower-tier alternative", () => {
  const result = buildDecisionContext({ selectedPlayer: players[0], availablePlayers: players, valueFor: (player) => player.maxBid });
  assert.equal(result.sameTierRemaining, 2);
  assert.equal(result.nextAlternative.id, "rb3");
  assert.equal(result.nextTierAlternative.id, "rb3");
  assert.equal(result.alternativeValue, 30);
  assert.equal(result.maxBidCliff, 12);
  assert.equal(result.marketCliff, 11);
  assert.equal(result.modelEffect, "none");
});

test("sold players disappear from tier supply and alternative selection", () => {
  const remaining = players.filter((player) => player.id !== "rb2" && player.id !== "rb3");
  const result = buildDecisionContext({ selectedPlayer: players[0], availablePlayers: remaining, valueFor: (player) => player.maxBid });
  assert.equal(result.sameTierRemaining, 1);
  assert.equal(result.nextAlternative.id, "rb4");
  assert.equal(result.maxBidCliff, 16);
});

test("tier deadline warning escalates at two and one available players without changing value authority", () => {
  const context = buildDecisionContext({ selectedPlayer: players[0], availablePlayers: players, valueFor: (player) => player.maxBid });
  const closing = buildTierDeadlineWarning({ selectedPlayer: players[0], available: true, ...context });
  assert.equal(closing.active, true);
  assert.equal(closing.urgency, "closing");
  assert.match(closing.title, /2 RB OPTIONS LEFT/);
  assert.match(closing.message, /Gamma/);
  assert.match(closing.message, /\$12 max-bid drop/);

  const lastContext = buildDecisionContext({ selectedPlayer: players[0], availablePlayers: players.filter((player) => player.id !== "rb2"), valueFor: (player) => player.maxBid });
  const last = buildTierDeadlineWarning({ selectedPlayer: players[0], available: true, ...lastContext });
  assert.equal(last.urgency, "last");
  assert.match(last.title, /LAST RB IN TIER 1/);
  assert.match(last.message, /final available player/);

  assert.equal(buildTierDeadlineWarning({ selectedPlayer: players[0], ...context, available: false }).active, false);
  assert.equal(buildTierDeadlineWarning({ selectedPlayer: players[2], available: true, sameTierRemaining: 3 }).active, false);

  const bottomTier = { id: "te-last", name: "Final TE", position: "TE", tier: 13, sourceRank: 500, maxBid: 1 };
  const betterTier = { id: "te-best", name: "Elite TE", position: "TE", tier: 1, sourceRank: 1, maxBid: 30 };
  const bottomContext = buildDecisionContext({ selectedPlayer: bottomTier, availablePlayers: [bottomTier, betterTier], valueFor: (player) => player.maxBid });
  assert.equal(bottomContext.nextAlternative.id, "te-best");
  assert.equal(bottomContext.nextTierAlternative, null);
  const bottomWarning = buildTierDeadlineWarning({ selectedPlayer: bottomTier, available: true, ...bottomContext });
  assert.match(bottomWarning.message, /No lower-tier alternative/);
  assert.doesNotMatch(bottomWarning.message, /Elite TE/);
});

test("projection disagreement reports exact range without changing values", () => {
  const result = projectionDisagreement(players[0]);
  assert.deepEqual(result, {
    available: true,
    spread: 30,
    level: "high",
    highSource: "Second",
    lowSource: "Primary",
    sourceCount: 3,
  });
  assert.equal(players[0].maxBid, 42);
});

test("missing alternatives and sources fail soft with explicit unknown evidence", () => {
  const selected = { id: "k1", name: "Only kicker", position: "K", tier: 1, sourceRank: 1, marketValue: 1, maxBid: 1 };
  const context = buildDecisionContext({ selectedPlayer: selected, availablePlayers: [selected] });
  assert.equal(context.nextAlternative, null);
  assert.equal(context.maxBidCliff, 1);
  assert.equal(context.disagreement.level, "unknown");
});

test("tier detail keeps assigned players visible with team, bye, and projection evidence", () => {
  const tierPlayers = players.slice(0, 3).map((player, index) => ({
    ...player,
    weeklyProjection: { byeWeek: index === 2 ? 9 : 7 },
    projectedPoints: 320 - index * 20,
  }));
  const state = {
    draftedPlayers: { rb2: { teamId: "other" } },
    teams: { other: { id: "other", name: "Other Team" } },
  };
  const rows = buildTierSnapshot({ selectedPlayer: tierPlayers[0], players: tierPlayers, state });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.name, row.byeWeek, row.status]), [
    ["Alpha", 7, "Available"],
    ["Beta", 7, "On Other Team"],
  ]);
});

test("bye warning finds every current Dogs player with the same week", () => {
  const selected = { ...players[0], weeklyProjection: { byeWeek: 7 } };
  const teammate = { ...players[1], weeklyProjection: { byeWeek: 7 } };
  const otherWeek = { ...players[2], weeklyProjection: { byeWeek: 9 } };
  const result = byeWeekConflicts({
    selectedPlayer: selected,
    players: [selected, teammate, otherWeek],
    state: { teams: { "dogs-of-war": { roster: [
      { playerId: teammate.id, playerName: teammate.name, position: teammate.position, nflTeam: "DET" },
      { playerId: otherWeek.id, playerName: otherWeek.name, position: otherWeek.position, nflTeam: "CHI" },
    ] } } },
  });
  assert.equal(result.byeWeek, 7);
  assert.deepEqual(result.conflicts.map((row) => row.playerName), ["Beta"]);
});

test("bid strip distinguishes bid, hold, and pass without overriding hard stops", () => {
  const base = { selectedPlayer: players[0], currentBid: 20, personalMaximum: 30, liveMarketValue: 25, sameTierRemaining: 2, nextAlternative: players[1] };
  assert.equal(buildBidRecommendation(base).verdict, "BID");
  assert.equal(buildBidRecommendation({ ...base, currentBid: 27, liveMarketValue: 25 }).verdict, "HOLD");
  const hardStop = buildBidRecommendation({ ...base, currentBid: 30 });
  assert.equal(hardStop.verdict, "PASS");
  assert.equal(hardStop.reason, "STOP. Do not bid $31. Your hard stop is $30.");
  assert.equal(buildBidRecommendation({ ...base, annotation: { tag: "avoid" } }).verdict, "PASS");
  assert.equal(buildBidRecommendation({ ...base, dogsLeading: true }).verdict, "HOLD");
});

test("auction value advice keeps intrinsic, market, and tier-rescue logic separate", () => {
  const base = {
    selectedPlayer: players[0],
    available: true,
    personalMaximum: 50,
    sameTierRemaining: 3,
    rosterSafety: { completionProbability: 100, strongPathProbability: 90 },
  };
  assert.equal(buildAuctionValueAdvice({ ...base, intrinsicValue: 45, liveMarketValue: 35 }).label, "BARGAIN");
  assert.equal(buildAuctionValueAdvice({ ...base, intrinsicValue: 28, liveMarketValue: 35 }).label, "WAIT");
  assert.equal(buildAuctionValueAdvice({ ...base, intrinsicValue: 35, liveMarketValue: 35 }).label, "FAIR");
  assert.equal(buildAuctionValueAdvice({ ...base, intrinsicValue: 35, liveMarketValue: 40, sameTierRemaining: 1 }).label, "TIER SAVE");
  assert.equal(buildAuctionValueAdvice({ ...base, intrinsicValue: 35, liveMarketValue: 40, sameTierRemaining: 1, personalMaximum: 39 }).label, "WAIT");
  assert.equal(buildAuctionValueAdvice({ ...base, intrinsicValue: 45, liveMarketValue: 35, annotation: { tag: "avoid" } }).label, "AVOID");
});

test("cash leverage compares candidate-position legal maximums against the strongest opponent", () => {
  const state = { teams: {
    "dogs-of-war": { id: "dogs-of-war", legalMaxBid: 40, openSlots: 5 },
    alpha: { id: "alpha", legalMaxBid: 35, openSlots: 4 },
    beta: { id: "beta", legalMaxBid: 37, openSlots: 3 },
  } };
  const result = cashLeverage({ state, position: "RB" });
  assert.equal(result.delta, 3);
  assert.equal(result.label, "You +$3");
});

test("budget runway preserves the one-dollar completion reserve and counts affordable premium alternatives", () => {
  const state = {
    draftedPlayers: {},
    teams: { "dogs-of-war": { id: "dogs-of-war", cash: 40, openSlots: 5 } },
  };
  const result = budgetRunway({ state, players, purchasePrice: 12, valueFor: (player) => player.marketValue });
  assert.equal(result.cashAfter, 28);
  assert.equal(result.openSlotsAfter, 4);
  assert.equal(result.completionReserve, 4);
  assert.equal(result.futureLegalMax, 25);
  assert.equal(result.premiumOptions, 1);
});

test("surplus heat never promotes a bid above a personal maximum or an Avoid tag", () => {
  assert.equal(playerSurplusHeat({ currentBid: 10, liveMarketValue: 20, personalMaximum: 25 }).level, "value");
  assert.equal(playerSurplusHeat({ currentBid: 25, liveMarketValue: 20, personalMaximum: 25 }).level, "stop");
  assert.equal(playerSurplusHeat({ currentBid: 1, liveMarketValue: 20, personalMaximum: 25, avoid: true }).level, "stop");
});

test("nomination recommendations exclude targets and prefer high-price avoids or over-market players", () => {
  const candidates = [
    { ...players[0], marketValue: 30, maxBid: 35 },
    { ...players[1], marketValue: 27, maxBid: 20 },
    { ...players[2], marketValue: 24, maxBid: 25 },
    { ...players[4], marketValue: 22, maxBid: 22 },
    { ...players[4], id: "wr2", name: "Strong bench bargain", marketValue: 20, maxBid: 25 },
  ];
  const annotations = {
    rb1: { tag: "target" },
    rb3: { tag: "avoid" },
  };
  const state = {
    draftedPlayers: {},
    config: { starterRequirements: { RB: 2, WR: 2 } },
    teams: { "dogs-of-war": { id: "dogs-of-war", positionCounts: { RB: 0, WR: 2 } } },
  };
  const result = buildNominationRecommendations({
    players: candidates,
    state,
    annotationFor: (id) => annotations[id] || null,
    marketValueFor: (player) => player.marketValue,
    bidLimitFor: (player) => player.maxBid,
    limit: 3,
  });
  assert.equal(result.some((row) => row.player.id === "rb1"), false);
  assert.equal(result[0].player.id, "rb2");
  assert.equal(result.some((row) => row.player.id === "rb3"), true);
  assert.equal(result.some((row) => row.player.id === "wr1"), true);
  assert.equal(result.some((row) => row.player.id === "wr2"), false);
});
