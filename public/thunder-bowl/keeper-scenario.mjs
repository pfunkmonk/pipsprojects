import { POSITIONS } from "./state-engine.mjs?v=20260808g";
import { calculateAuctionDemandMarket } from "./auction-demand.mjs?v=20260809a";

function activeKeeperRows(state) {
  return Object.values(state.teams)
    .flatMap((team) => team.roster)
    .filter((player) => player.acquisitionType === "keeper");
}

export function calculateKeeperScenarioValues(pack, state) {
  const market = calculateAuctionDemandMarket(pack, state);
  const playersById = new Map(pack.players.map((player) => [player.id, player]));
  const keepers = activeKeeperRows(state);
  const keeperCountByPosition = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  const keeperSurplusByPosition = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  for (const keeper of keepers) {
    const player = playersById.get(keeper.playerId);
    if (!player) continue;
    keeperCountByPosition[player.position] += 1;
    keeperSurplusByPosition[player.position] += Math.max(0, market.valuesByPlayerId[player.id] - keeper.price);
  }
  const positionImpacts = Object.fromEntries(POSITIONS.map((position) => [position, {
    ...market.positionImpacts[position],
    keepers: keeperCountByPosition[position],
    keeperSurplus: Math.round(keeperSurplusByPosition[position]),
  }]));
  return {
    ...market,
    modelEffect: "validated_historical_auction_market_only",
    activeKeeperCount: keepers.length,
    remainingOpenSlots: market.expectedRemainingPurchases,
    positionalScarcityShare: null,
    positionImpacts,
  };
}
