import { POSITIONS, applyLiveMarketMultiplier, calculateLiveMarketState } from "./state-engine.mjs?v=20260808b";

const POSITIONAL_SCARCITY_SHARE = 0.35;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function activeKeeperRows(state) {
  return Object.values(state.teams)
    .flatMap((team) => team.roster)
    .filter((player) => player.acquisitionType === "keeper");
}

export function calculateKeeperScenarioValues(pack, state, { positionalScarcityShare = POSITIONAL_SCARCITY_SHARE } = {}) {
  if (!pack?.players?.length || !pack?.leagueConfig?.starterRequirements || !state?.teams) {
    throw new Error("Keeper scenario pricing requires a draft pack and replayed keeper state.");
  }
  if (!Number.isFinite(positionalScarcityShare) || positionalScarcityShare < 0 || positionalScarcityShare > 0.75) {
    throw new Error("Keeper positional-scarcity share must be between 0 and 0.75.");
  }

  const remainingPlayers = pack.players.filter((player) => !state.draftedPlayers[player.id]);
  const remainingOpenSlots = Object.values(state.teams).reduce((sum, team) => sum + team.openSlots, 0);
  const remainingMarketValues = remainingPlayers.map((player) => player.marketValue);
  while (remainingMarketValues.length < remainingOpenSlots) remainingMarketValues.push(1);
  const global = calculateLiveMarketState({
    remainingRoomDollars: state.totalCash,
    remainingOpenSlots,
    remainingMarketValues,
  });

  const playersById = new Map(pack.players.map((player) => [player.id, player]));
  const keepers = activeKeeperRows(state);
  const keeperSurplusByPosition = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  const keeperCountByPosition = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  for (const keeper of keepers) {
    const player = playersById.get(keeper.playerId);
    if (!player) continue;
    keeperCountByPosition[player.position] += 1;
    keeperSurplusByPosition[player.position] += Math.max(0, player.marketValue - keeper.price);
  }

  const remainingDiscretionaryByPosition = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  for (const player of remainingPlayers) {
    remainingDiscretionaryByPosition[player.position] += Math.max(0, player.marketValue - 1);
  }
  const pressureByPosition = Object.fromEntries(POSITIONS.map((position) => {
    const denominator = Math.max(1, remainingDiscretionaryByPosition[position]);
    return [position, keeperSurplusByPosition[position] / denominator];
  }));
  const pressureWeight = POSITIONS.reduce((sum, position) => sum + remainingDiscretionaryByPosition[position], 0);
  const weightedPressure = pressureWeight > 0
    ? POSITIONS.reduce((sum, position) => sum + pressureByPosition[position] * remainingDiscretionaryByPosition[position], 0) / pressureWeight
    : 0;

  const positionImpacts = {};
  for (const position of POSITIONS) {
    const centeredPressure = pressureByPosition[position] - weightedPressure;
    const multiplier = clamp(global.dampedMultiplier * (1 + positionalScarcityShare * centeredPressure), 0.5, 2);
    positionImpacts[position] = {
      position,
      keepers: keeperCountByPosition[position],
      keeperSurplus: Math.round(keeperSurplusByPosition[position]),
      multiplier,
      displayPercent: Math.round((multiplier - 1) * 1000) / 10,
    };
  }

  const valuesByPlayerId = {};
  for (const player of remainingPlayers) {
    valuesByPlayerId[player.id] = applyLiveMarketMultiplier(player.marketValue, positionImpacts[player.position].multiplier);
  }
  for (const keeper of keepers) valuesByPlayerId[keeper.playerId] = playersById.get(keeper.playerId)?.marketValue || keeper.price;

  return {
    modelEffect: "sandbox_only",
    activeKeeperCount: keepers.length,
    remainingRoomDollars: state.totalCash,
    remainingOpenSlots,
    globalInflationPercent: global.displayPercent,
    globalMultiplier: global.dampedMultiplier,
    positionalScarcityShare,
    positionImpacts,
    valuesByPlayerId,
  };
}
