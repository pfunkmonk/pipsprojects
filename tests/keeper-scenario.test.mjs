import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EVENT_TYPES, createEvent, replayDraft } from "../public/thunder-bowl/state-engine.mjs";
import { calculateKeeperScenarioValues } from "../public/thunder-bowl/keeper-scenario.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));

test("keeper sandbox starts on the authoritative historical-demand curve", () => {
  const scenario = calculateKeeperScenarioValues(pack, replayDraft([]));
  assert.equal(scenario.modelEffect, "validated_historical_auction_market_only");
  assert.equal(scenario.activeKeeperCount, 0);
  assert.equal(scenario.globalInflationPercent, 0);
  assert.equal(scenario.expectedRemainingPurchases, 144);
  assert.equal(scenario.positionImpacts.RB.replacementRank, 45);
  assert.equal(scenario.positionImpacts.WR.replacementRank, 42);
});

test("six cheap first-round RB keepers dynamically raise remaining RB auction values", () => {
  const topRunningBacks = pack.players
    .filter((player) => player.position === "RB")
    .sort((left, right) => right.marketValue - left.marketValue || left.id.localeCompare(right.id))
    .slice(0, 6);
  const teams = pack.leagueConfig.nominationOrder.slice(0, 6);
  const events = topRunningBacks.map((player, index) => createEvent(
    EVENT_TYPES.KEEPER_ASSIGNED,
    {
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      teamId: teams[index],
      salary: 1,
      keeperYear: 1,
      selectionRound: 1,
      source: "scenario test candidate",
    },
    {
      id: `scenario-keeper-${index}`,
      deviceId: "scenario-test",
      createdAt: `2026-08-08T00:00:0${index}.000Z`,
    },
  ));
  const state = replayDraft(events);
  const baseline = calculateKeeperScenarioValues(pack, replayDraft([]));
  const scenario = calculateKeeperScenarioValues(pack, state);
  const bestRemainingRunningBack = pack.players
    .filter((player) => player.position === "RB" && !state.draftedPlayers[player.id])
    .sort((left, right) => right.marketValue - left.marketValue || left.id.localeCompare(right.id))[0];

  assert.equal(scenario.activeKeeperCount, 6);
  assert.ok(scenario.globalInflationPercent > 0);
  assert.ok(scenario.valuesByPlayerId[bestRemainingRunningBack.id] > baseline.valuesByPlayerId[bestRemainingRunningBack.id]);
  for (const keptRunningBack of topRunningBacks) {
    assert.ok(
      scenario.valuesByPlayerId[keptRunningBack.id] > baseline.valuesByPlayerId[keptRunningBack.id],
      `${keptRunningBack.name}'s counterfactual auction value should reflect the same RB scarcity as the remaining pool`,
    );
  }
});

test("a cheap Chase Brown keeper cannot lower his counterfactual auction value", () => {
  const chase = pack.players.find((player) => player.name === "Chase Brown");
  const candidate = pack.keeperCandidates.find((row) => row.playerId === chase.id);
  const firstTeamId = pack.leagueConfig.nominationOrder[0];
  const priorCheapRunningBack = pack.players
    .filter((player) => player.position === "RB" && player.id !== chase.id)
    .sort((left, right) => right.marketValue - left.marketValue)[0];
  const firstKeeper = createEvent(
    EVENT_TYPES.KEEPER_ASSIGNED,
    {
      playerId: priorCheapRunningBack.id,
      playerName: priorCheapRunningBack.name,
      position: priorCheapRunningBack.position,
      nflTeam: priorCheapRunningBack.nflTeam,
      teamId: firstTeamId,
      salary: 1,
      keeperYear: 1,
      selectionRound: 1,
      source: "Create existing RB scarcity for the Chase Brown regression",
    },
    { id: "scenario-chase-prior-rb", deviceId: "scenario-test", createdAt: "2026-08-08T00:00:00.000Z" },
  );
  const priorTurns = pack.leagueConfig.nominationOrder
    .slice(1, pack.leagueConfig.nominationOrder.indexOf(candidate.teamId))
    .map((teamId, index) => createEvent(
      EVENT_TYPES.KEEPER_PASSED,
      { teamId, round: 1, reason: "Advance to the Chase Brown regression turn" },
      {
        id: `scenario-chase-pass-${index}`,
        deviceId: "scenario-test",
        createdAt: `2026-08-08T00:00:${String(index).padStart(2, "0")}.000Z`,
      },
    ));
  const priorEvents = [firstKeeper, ...priorTurns];
  const baseline = calculateKeeperScenarioValues(pack, replayDraft(priorEvents));
  const keeper = createEvent(
    EVENT_TYPES.KEEPER_ASSIGNED,
    {
      playerId: chase.id,
      playerName: chase.name,
      position: chase.position,
      nflTeam: chase.nflTeam,
      teamId: candidate.teamId,
      salary: candidate.keeperSalary,
      keeperYear: candidate.keeperYear,
      selectionRound: 1,
      source: "Chase Brown regression test",
    },
    { id: "scenario-chase-brown", deviceId: "scenario-test", createdAt: "2026-08-08T00:01:00.000Z" },
  );
  const scenario = calculateKeeperScenarioValues(pack, replayDraft([...priorEvents, keeper]));

  assert.ok(scenario.positionImpacts.RB.displayPercent > 0);
  assert.ok(scenario.valuesByPlayerId[chase.id] >= baseline.valuesByPlayerId[chase.id]);
});

test("cap-only ownership redistribution is recalculated without inventing room dollars", () => {
  const candidate = pack.keeperCandidates.find((row) => row.teamId === "t-dogs" && row.keeperYear <= 3);
  const trade = createEvent(
    EVENT_TYPES.KEEPER_RIGHTS_TRADED,
    {
      teamAId: "the-hobbits",
      teamBId: "t-dogs",
      amountFromAToB: 4,
      teamASends: [],
      teamBSends: [{ playerId: candidate.playerId, playerName: candidate.playerName }],
    },
    { id: "scenario-rights-trade", deviceId: "scenario-test", createdAt: "2026-08-08T00:00:00.000Z" },
  );
  const state = replayDraft([trade]);
  const scenario = calculateKeeperScenarioValues(pack, state);
  assert.equal(state.totalCash, replayDraft([]).totalCash);
  assert.equal(scenario.activeKeeperCount, 0);
  assert.equal(scenario.globalInflationPercent, 0);
});
