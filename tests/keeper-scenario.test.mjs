import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EVENT_TYPES, createEvent, replayDraft } from "../public/thunder-bowl/state-engine.mjs";
import { calculateKeeperScenarioValues } from "../public/thunder-bowl/keeper-scenario.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));

test("keeper sandbox starts neutral and preserves every player at baseline value", () => {
  const scenario = calculateKeeperScenarioValues(pack, replayDraft([]));
  assert.equal(scenario.modelEffect, "sandbox_only");
  assert.equal(scenario.activeKeeperCount, 0);
  assert.equal(scenario.globalInflationPercent, 0);
  for (const player of pack.players.slice(0, 100)) assert.equal(scenario.valuesByPlayerId[player.id], player.marketValue);
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
  assert.ok(scenario.positionImpacts.RB.displayPercent > scenario.positionImpacts.WR.displayPercent);
  assert.ok(scenario.valuesByPlayerId[bestRemainingRunningBack.id] > baseline.valuesByPlayerId[bestRemainingRunningBack.id]);
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
