import test from "node:test";
import assert from "node:assert/strict";
import { buildNominationAssistant, NOMINATION_PLAYS } from "../public/thunder-bowl/nomination-assistant.mjs";

const players = [
  { id: "chalk", name: "Expensive Chalk", position: "RB", marketValue: 32, maxBid: 15, sourceRank: 1 },
  { id: "target", name: "Dogs Target", position: "WR", marketValue: 14, maxBid: 24, sourceRank: 2 },
  { id: "middle", name: "Middle Player", position: "TE", marketValue: 18, maxBid: 8, sourceRank: 3 },
];
const state = {
  draftedPlayers: {},
  config: { starterRequirements: { RB: 2, WR: 2, TE: 1 } },
  teams: { "dogs-of-war": { id: "dogs-of-war", positionCounts: { RB: 2, WR: 0, TE: 1 } } },
};
const forecasts = {
  chalk: { naturalSale: { point: 38 }, opponents: [
    { meanWtp: 40, need: { starterNeeded: true, expectedAdditional: 1 } },
    { meanWtp: 39, need: { starterNeeded: true, expectedAdditional: 1 } },
  ], nominationTiming: { deltaVersusNow: 0 } },
  target: { naturalSale: { point: 13 }, opponents: [], nominationTiming: { deltaVersusNow: -1 } },
  middle: { naturalSale: { point: 18 }, opponents: [], nominationTiming: { deltaVersusNow: 0 } },
};

test("the assistant protects targets from drain plays and returns distinct advisory plays", () => {
  const rows = buildNominationAssistant({
    players,
    state,
    annotationFor: (id) => id === "target" ? { tag: "target" } : id === "chalk" ? { tag: "avoid" } : null,
    forecastFor: (player) => forecasts[player.id],
  });
  assert.ok(rows.some((row) => row.player.id === "target" && row.play === NOMINATION_PLAYS.SECURE));
  assert.ok(rows.some((row) => row.player.id === "chalk" && row.play !== NOMINATION_PLAYS.SECURE));
  assert.equal(rows.every((row) => row.modelEffect === "advisory_only"), true);
  assert.equal(new Set(rows.map((row) => row.player.id)).size, rows.length);
});

test("the assistant punts explicitly when no safe candidate clears the floor", () => {
  const [row] = buildNominationAssistant({ players: [], state, forecastFor: () => null });
  assert.equal(row.play, NOMINATION_PLAYS.PUNT);
  assert.equal(row.player, null);
  assert.equal(row.modelEffect, "advisory_only");
});
