import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, POSITIONS, legalMaximumBid, replayDraft } from "../public/thunder-bowl/state-engine.mjs";
import {
  buildRoomTeamCards,
  orderedRoster,
  savedDepthChartForPlayer,
} from "../public/thunder-bowl/room-team-dashboard.mjs";

test("team dashboard preserves all 12 teams in official nomination order", () => {
  const state = replayDraft([]);
  const cards = buildRoomTeamCards({
    state,
    candidatePosition: "RB",
    legalMaximumFor: (team, position) => legalMaximumBid(team, state.config, position),
  });
  assert.equal(cards.length, 12);
  assert.deepEqual(cards.map((team) => team.id), DEFAULT_CONFIG.nominationOrder);
  assert.equal(cards[0].candidatePosition, "RB");
  assert.equal(cards[0].legalMaximum, state.teams[cards[0].id].cash - 7);
  assert.deepEqual(Object.keys(cards[0].positionCounts), POSITIONS);
});

test("team dashboard blocks a position that would destroy the remaining starter path", () => {
  const counts = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  counts.QB = 1;
  counts.RB = 2;
  counts.WR = 2;
  counts.TE = 1;
  counts.K = 1;
  const roster = Array.from({ length: 13 }, (_, index) => ({ playerId: `p-${index}` }));
  const team = { id: "test", name: "Test", cash: 20, roster, openSlots: 1, positionCounts: counts };
  const state = {
    config: { ...DEFAULT_CONFIG, nominationOrder: ["test"], teams: [{ id: "test", name: "Test" }] },
    teams: { test: team },
    currentNominatorTeamId: "test",
  };
  const cards = buildRoomTeamCards({ state, candidatePosition: "RB", legalMaximumFor: () => 20 });
  assert.equal(cards[0].canDraftCandidate, false);
  assert.equal(cards[0].legalMaximum, 0);
  assert.equal(cards[0].isCurrentNominator, true);
});

test("team roster puts keepers first and then sorts positions and names", () => {
  const roster = orderedRoster({
    roster: [
      { playerId: "wr-b", playerName: "Beta", position: "WR", acquisitionType: "sale" },
      { playerId: "rb-a", playerName: "Alpha", position: "RB", acquisitionType: "sale" },
      { playerId: "wr-k", playerName: "Keeper", position: "WR", acquisitionType: "keeper" },
    ],
  });
  assert.deepEqual(roster.map((player) => player.playerId), ["wr-k", "rb-a", "wr-b"]);
});

test("saved depth charts normalize NFL aliases and highlight the selected roster player", () => {
  const snapshot = {
    depthChart: {
      entries: [
        { playerName: "Starter Back", nflTeam: "LAR", position: "RB", depthOrder: 1, starter: true, status: "" },
        { playerName: "Reserve Back", nflTeam: "LAR", position: "RB", depthOrder: 2, starter: false, status: "Q" },
        { playerName: "Other Position", nflTeam: "LAR", position: "WR", depthOrder: 1, starter: true, status: "" },
      ],
    },
  };
  const depth = savedDepthChartForPlayer({ playerName: "Reserve Back", nflTeam: "LA", position: "RB" }, snapshot);
  assert.equal(depth.available, true);
  assert.equal(depth.team, "LAR");
  assert.deepEqual(depth.entries.map((entry) => entry.playerName), ["Starter Back", "Reserve Back"]);
  assert.equal(depth.selected.playerName, "Reserve Back");
});

test("DST and missing snapshots fail closed without inventing depth data", () => {
  assert.deepEqual(
    savedDepthChartForPlayer({ playerName: "Detroit Lions", nflTeam: "DET", position: "DST" }, null).entries,
    [],
  );
  assert.equal(savedDepthChartForPlayer({ playerName: "Unknown", nflTeam: "FA", position: "RB" }, null).available, false);
});
