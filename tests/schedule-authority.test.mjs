import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { calculateAuctionDemandMarket } from "../public/thunder-bowl/auction-demand.mjs";
import { calculateKeeperScenarioValues } from "../public/thunder-bowl/keeper-scenario.mjs";
import {
  DEFAULT_PRIORITY_SCENARIO,
  applyPriorityVbdOverlay,
  buildPriorityVbdOverlay,
} from "../public/thunder-bowl/priority-weights.mjs";
import { replayDraft } from "../public/thunder-bowl/state-engine.mjs";

const pack = JSON.parse(await readFile(
  new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url),
  "utf8",
));
const weeklyContext = { divisionWeeks: [1, 2, 12, 13], playoffWeeks: [15, 16, 17] };

test("validated schedule authority changes the runtime curve without mutating or creating room dollars", () => {
  const overlay = buildPriorityVbdOverlay(pack.players, DEFAULT_PRIORITY_SCENARIO, weeklyContext);
  const adjustedPack = applyPriorityVbdOverlay(pack, overlay);
  const state = replayDraft([]);
  const baseline = calculateAuctionDemandMarket(pack, state);
  const adjusted = calculateAuctionDemandMarket(adjustedPack, state);

  assert.equal(pack.weeklyContext.priorityDefaultStatus, "validated_live_bounded");
  assert.equal(pack.weeklyContext.suggestedScenario.playoffs, 1.5);
  assert.equal(pack.players.every((player) => Math.abs(overlay[player.id].vbdDelta) <= 3), true);
  assert.equal(pack.players.every((player, index) => adjustedPack.players[index].projectedPoints
    === Math.round((player.projectedPoints + overlay[player.id].vbdDelta) * 10) / 10), true);
  for (const [position, starters] of Object.entries(pack.leagueConfig.starterRequirements)) {
    const rows = adjustedPack.players
      .filter((player) => player.position === position)
      .sort((left, right) => right.projectedPoints - left.projectedPoints || left.id.localeCompare(right.id));
    const replacement = rows[pack.leagueConfig.teams.length * starters - 1].projectedPoints;
    assert.equal(rows.every((player) => Math.abs(player.vbd - (player.projectedPoints - replacement)) <= 0.11), true);
  }
  assert.ok(pack.players.some((player) => baseline.valuesByPlayerId[player.id] !== adjusted.valuesByPlayerId[player.id]));
  assert.ok(pack.players.some((player) => baseline.bidCeilingsByPlayerId[player.id] !== adjusted.bidCeilingsByPlayerId[player.id]));
  assert.equal(adjusted.demandAllocatedRoomDollars, baseline.demandAllocatedRoomDollars);
  assert.equal(adjusted.remainingRoomDollars, baseline.remainingRoomDollars);

  const keeper = calculateKeeperScenarioValues(adjustedPack, state);
  assert.deepEqual(keeper.valuesByPlayerId, adjusted.valuesByPlayerId);
});
