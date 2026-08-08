import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionContext, projectionDisagreement } from "../public/thunder-bowl/decision-context.mjs";

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
