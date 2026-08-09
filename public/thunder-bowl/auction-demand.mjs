import { POSITIONS } from "./state-engine.mjs?v=20260808g";

export const HISTORICAL_AUCTION_DEMAND = Object.freeze({
  schemaVersion: 1,
  seasons: Object.freeze([2021, 2022, 2023, 2025]),
  excludedSeasons: Object.freeze({ 2024: "Incomplete auction-roster snapshot" }),
  teamSeasons: 48,
  source: "Thunder Bowl normalized auction rosters",
  marketBlend: Object.freeze({
    historicalDemandWeight: 0.75,
    roomCurveWeight: 0.25,
    developmentFolds: Object.freeze([2023, 2024]),
    sourceAuctionPurchases: 241,
    evaluatedAuctionPurchases: 141,
    classicPriceMae: 5.887,
    globalDemandPriceMae: 4.837,
    positionBudgetPriceMae: 4.489,
    blendedPriceMae: 4.191,
    outcomeHoldoutExcluded: 2025,
  }),
  historicalPositionSpend: Object.freeze({
    seasons: Object.freeze([2021, 2022, 2023, 2025]),
    totalSpend: 4769,
    byPosition: Object.freeze({ QB: 420, RB: 2090, WR: 1618, TE: 431, K: 87, DST: 123 }),
  }),
  finalRosterCountHistograms: Object.freeze({
    QB: Object.freeze({ 1: 25, 2: 23 }),
    RB: Object.freeze({ 2: 7, 3: 15, 4: 15, 5: 6, 6: 5 }),
    WR: Object.freeze({ 2: 9, 3: 15, 4: 18, 5: 5, 6: 1 }),
    TE: Object.freeze({ 1: 34, 2: 14 }),
    K: Object.freeze({ 1: 47, 2: 1 }),
    DST: Object.freeze({ 1: 48 }),
  }),
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail("INVALID_AUCTION_DEMAND_NUMBER", `${label} must be finite.`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    fail("INVALID_AUCTION_DEMAND_COUNT", `${label} must be a non-negative whole number.`);
  }
  return number;
}

function normalizedHistogram(profile, position) {
  const histogram = profile?.finalRosterCountHistograms?.[position];
  if (!histogram || typeof histogram !== "object" || Array.isArray(histogram)) {
    fail("MISSING_AUCTION_DEMAND_POSITION", `Historical auction demand is missing ${position}.`);
  }
  const rows = Object.entries(histogram).map(([count, observations]) => ({
    count: nonNegativeInteger(Number(count), `${position} final roster count`),
    observations: nonNegativeInteger(observations, `${position} observation count`),
  })).filter((row) => row.observations > 0);
  const total = rows.reduce((sum, row) => sum + row.observations, 0);
  if (!rows.length || total !== profile.teamSeasons) {
    fail("INVALID_AUCTION_DEMAND_SAMPLE", `${position} historical demand must cover all ${profile.teamSeasons} team-seasons.`);
  }
  return { rows, total };
}

export function expectedAdditionalPlayers(profile, position, currentCount) {
  const current = nonNegativeInteger(currentCount, `${position} current roster count`);
  const { rows, total } = normalizedHistogram(profile, position);
  return rows.reduce(
    (sum, row) => sum + Math.max(0, row.count - current) * row.observations,
    0,
  ) / total;
}

function pristineState(pack) {
  const positionCounts = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  const teams = Object.fromEntries(pack.leagueConfig.teams.map((team) => [team.id, {
    cash: team.startingCap,
    openSlots: pack.leagueConfig.rosterSize,
    positionCounts: { ...positionCounts },
  }]));
  return {
    config: pack.leagueConfig,
    teams,
    draftedPlayers: {},
    totalCash: pack.leagueConfig.teams.reduce((sum, team) => sum + team.startingCap, 0),
  };
}

function teamExpectedDemand(team, config, profile) {
  const maximumAdditions = Math.min(
    nonNegativeInteger(team.openSlots, "Team open slots"),
    nonNegativeInteger(team.cash, "Team cash"),
  );
  const legal = {};
  const expected = {};
  for (const position of POSITIONS) {
    const current = nonNegativeInteger(team.positionCounts?.[position] ?? 0, `${position} current roster count`);
    legal[position] = Math.max(0, config.starterRequirements[position] - current);
    expected[position] = Math.max(legal[position], expectedAdditionalPlayers(profile, position, current));
  }
  const legalTotal = POSITIONS.reduce((sum, position) => sum + legal[position], 0);
  if (legalTotal > maximumAdditions) {
    fail("ILLEGAL_AUCTION_DEMAND_STATE", "The remaining roster capacity cannot satisfy the required starting lineup.");
  }
  const extraTotal = POSITIONS.reduce((sum, position) => sum + Math.max(0, expected[position] - legal[position]), 0);
  const availableExtras = Math.max(0, maximumAdditions - legalTotal);
  const extraScale = extraTotal > 0 ? Math.min(1, availableExtras / extraTotal) : 0;
  return Object.fromEntries(POSITIONS.map((position) => [
    position,
    legal[position] + Math.max(0, expected[position] - legal[position]) * extraScale,
  ]));
}

function apportionDemand(exactDemand, maximumSlots) {
  const ranks = Object.fromEntries(POSITIONS.map((position) => [position, Math.floor(exactDemand[position])]));
  const exactTotal = POSITIONS.reduce((sum, position) => sum + exactDemand[position], 0);
  const target = Math.min(maximumSlots, Math.round(exactTotal));
  let remaining = target - POSITIONS.reduce((sum, position) => sum + ranks[position], 0);
  const remainderOrder = [...POSITIONS].sort((left, right) =>
    (exactDemand[right] - Math.floor(exactDemand[right])) - (exactDemand[left] - Math.floor(exactDemand[left]))
    || POSITIONS.indexOf(left) - POSITIONS.indexOf(right));
  for (const position of remainderOrder) {
    if (remaining <= 0) break;
    ranks[position] += 1;
    remaining -= 1;
  }
  return ranks;
}

function largestRemainderValues(rows, availableCash) {
  const exactValues = rows.map((row) => row.exactValue);
  const rounded = exactValues.map((value) => Math.floor(value));
  let dollarsLeft = availableCash - rounded.reduce((sum, value) => sum + value, 0);
  const order = rows.map((row, index) => ({ row, index }))
    .sort((left, right) =>
      (right.row.exactValue - Math.floor(right.row.exactValue)) - (left.row.exactValue - Math.floor(left.row.exactValue))
      || right.row.auctionVorp - left.row.auctionVorp
      || left.row.id.localeCompare(right.row.id));
  for (const { index } of order) {
    if (dollarsLeft <= 0) break;
    rounded[index] += 1;
    dollarsLeft -= 1;
  }
  return rounded;
}

function positionSpendShares(profile) {
  const spend = profile?.historicalPositionSpend?.byPosition;
  if (!spend || typeof spend !== "object" || Array.isArray(spend)) {
    fail("MISSING_POSITION_SPEND", "Historical auction demand is missing position spend evidence.");
  }
  const normalized = Object.fromEntries(POSITIONS.map((position) => [
    position,
    finite(spend[position], `${position} historical spend`),
  ]));
  const total = POSITIONS.reduce((sum, position) => sum + normalized[position], 0);
  if (total <= 0 || Math.abs(total - finite(profile.historicalPositionSpend.totalSpend, "Historical total spend")) > 0.01) {
    fail("INVALID_POSITION_SPEND", "Historical position spend does not reconcile to its total.");
  }
  return Object.fromEntries(POSITIONS.map((position) => [position, normalized[position] / total]));
}

function apportionBudgets(exactBudgets, totalBudget, minimumBudgets) {
  const rounded = Object.fromEntries(POSITIONS.map((position) => [position, Math.floor(exactBudgets[position])]));
  let remaining = totalBudget - POSITIONS.reduce((sum, position) => sum + rounded[position], 0);
  const order = [...POSITIONS].sort((left, right) =>
    (exactBudgets[right] - Math.floor(exactBudgets[right])) - (exactBudgets[left] - Math.floor(exactBudgets[left]))
    || POSITIONS.indexOf(left) - POSITIONS.indexOf(right));
  for (const position of order) {
    if (remaining <= 0) break;
    rounded[position] += 1;
    remaining -= 1;
  }
  for (const position of POSITIONS) {
    if (rounded[position] < minimumBudgets[position]) {
      fail("INVALID_POSITION_BUDGET", `${position} cannot fund its expected remaining purchases.`);
    }
  }
  return rounded;
}

function remainingPositionBudgets(pack, state, ranks, profile) {
  const shares = positionSpendShares(profile);
  const initialCash = pack.leagueConfig.teams.reduce((sum, team) => sum + team.startingCap, 0);
  const spent = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  for (const team of Object.values(state.teams)) {
    for (const player of team.roster || []) spent[player.position] += finite(player.price, `${player.playerName} price`);
  }
  const remainingCash = nonNegativeInteger(state.totalCash, "Remaining room cash");
  const reserve = POSITIONS.reduce((sum, position) => sum + ranks[position], 0);
  if (remainingCash < reserve) fail("INSUFFICIENT_POSITION_BUDGET", "Room cash cannot fund the expected positional purchases.");
  const targetDiscretionary = Object.fromEntries(POSITIONS.map((position) => [
    position,
    Math.max(0, initialCash * shares[position] - spent[position] - ranks[position]),
  ]));
  const targetTotal = POSITIONS.reduce((sum, position) => sum + targetDiscretionary[position], 0);
  const remainingDiscretionary = remainingCash - reserve;
  const exact = Object.fromEntries(POSITIONS.map((position) => [
    position,
    ranks[position] + (targetTotal > 0
      ? remainingDiscretionary * targetDiscretionary[position] / targetTotal
      : remainingDiscretionary * shares[position]),
  ]));
  return {
    shares,
    spent,
    budgets: apportionBudgets(exact, remainingCash, ranks),
  };
}

function calculateCore(pack, state, profile) {
  const players = pack.players.map((player) => ({
    ...player,
    projectedPoints: finite(player.projectedPoints, `${player.name} projected points`),
  }));
  const available = players.filter((player) => !state.draftedPlayers?.[player.id]);
  const maximumSlots = Object.values(state.teams).reduce(
    (sum, team) => sum + Math.min(nonNegativeInteger(team.openSlots, "Team open slots"), nonNegativeInteger(team.cash, "Team cash")),
    0,
  );
  const exactDemand = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  for (const team of Object.values(state.teams)) {
    const teamDemand = teamExpectedDemand(team, state.config, profile);
    for (const position of POSITIONS) exactDemand[position] += teamDemand[position];
  }
  const ranks = apportionDemand(exactDemand, maximumSlots);
  const grouped = new Map(POSITIONS.map((position) => [position, []]));
  for (const player of available) grouped.get(player.position)?.push(player);
  for (const rows of grouped.values()) rows.sort((left, right) => right.projectedPoints - left.projectedPoints || left.id.localeCompare(right.id));

  const replacementPoints = {};
  const purchasable = [];
  for (const position of POSITIONS) {
    const rows = grouped.get(position);
    ranks[position] = Math.min(ranks[position], rows.length);
    replacementPoints[position] = ranks[position] > 0 ? rows[ranks[position] - 1].projectedPoints : null;
    purchasable.push(...rows.slice(0, ranks[position]));
  }
  const reserveSlots = purchasable.length;
  const availableCash = nonNegativeInteger(state.totalCash, "Remaining room cash");
  if (availableCash < reserveSlots) {
    fail("INSUFFICIENT_AUCTION_DEMAND_CASH", "Room cash cannot fund the historically expected remaining purchases.");
  }
  const positionBudget = remainingPositionBudgets(pack, state, ranks, profile);
  const auctionVorp = (player) => replacementPoints[player.position] === null
    ? 0
    : Math.max(0, player.projectedPoints - replacementPoints[player.position]);
  const discretionaryCash = availableCash - reserveSlots;
  const valuesByPlayerId = Object.fromEntries(players.map((player) => [player.id, 1]));
  const auctionVorpByPlayerId = Object.fromEntries(players.map((player) => [player.id, auctionVorp(player)]));
  const positionDollarPerVorp = {};
  const purchasablePlayerIds = [];
  let totalPositiveVorp = 0;
  for (const position of POSITIONS) {
    const positionPlayers = (grouped.get(position) || []).slice(0, ranks[position]);
    const weighted = positionPlayers.map((player) => ({ ...player, auctionVorp: auctionVorp(player) }));
    const positionPositiveVorp = weighted.reduce((sum, player) => sum + player.auctionVorp, 0);
    const positionDiscretionary = positionBudget.budgets[position] - weighted.length;
    const dollarPerVorp = positionPositiveVorp > 0 ? positionDiscretionary / positionPositiveVorp : 0;
    positionDollarPerVorp[position] = dollarPerVorp;
    totalPositiveVorp += positionPositiveVorp;
    const exact = weighted.map((player) => ({
      ...player,
      exactValue: 1 + (positionPositiveVorp > 0
        ? player.auctionVorp * dollarPerVorp
        : positionDiscretionary / Math.max(1, weighted.length)),
    }));
    const rounded = largestRemainderValues(exact, positionBudget.budgets[position]);
    exact.forEach((player, index) => {
      valuesByPlayerId[player.id] = rounded[index];
      purchasablePlayerIds.push(player.id);
    });
  }
  const diagnosticDollarPerVorp = totalPositiveVorp > 0 ? discretionaryCash / totalPositiveVorp : 0;

  // Drafted players retain a counterfactual auction value for keeper/trade decisions.
  // They use the same current replacement line and dollar rate without consuming room cash twice.
  for (const player of players) {
    if (!state.draftedPlayers?.[player.id]) continue;
    valuesByPlayerId[player.id] = Math.max(1, Math.round(
      1 + auctionVorpByPlayerId[player.id] * positionDollarPerVorp[player.position],
    ));
  }
  return {
    exactDemand,
    ranks,
    replacementPoints,
    reserveSlots,
    availableCash,
    discretionaryCash,
    dollarPerVorp: diagnosticDollarPerVorp,
    positionDollarPerVorp,
    positionBudgets: positionBudget.budgets,
    positionSpendShares: positionBudget.shares,
    positionSpent: positionBudget.spent,
    totalPositiveVorp,
    valuesByPlayerId,
    auctionVorpByPlayerId,
    purchasablePlayerIds,
  };
}

function percentChange(current, baseline) {
  if (baseline <= 0) return 0;
  return Math.round((current / baseline - 1) * 1000) / 10;
}

function monotoneRoomCurve(pack, field) {
  const result = Object.fromEntries(pack.players.map((player) => [player.id, 1]));
  for (const position of POSITIONS) {
    const players = pack.players
      .filter((player) => player.position === position)
      .sort((left, right) => right.projectedPoints - left.projectedPoints || left.id.localeCompare(right.id));
    const curve = players.map((player) => nonNegativeInteger(player[field], `${player.name} ${field}`))
      .sort((left, right) => right - left);
    players.forEach((player, index) => { result[player.id] = Math.max(1, curve[index] ?? 1); });
  }
  return result;
}

function blendedMarketValues(pack, core, multiplier, profile, roomCurve) {
  const demandWeight = finite(profile.marketBlend?.historicalDemandWeight ?? 1, "Historical-demand market weight");
  if (demandWeight < 0 || demandWeight > 1) {
    fail("INVALID_AUCTION_DEMAND_WEIGHT", "Historical-demand market weight must be between zero and one.");
  }
  const classicWeight = 1 - demandWeight;
  const safeMultiplier = Math.max(0.5, Math.min(2, multiplier));
  return Object.fromEntries(pack.players.map((player) => {
    const classicBase = Math.max(1, nonNegativeInteger(roomCurve[player.id], `${player.name} monotone room-curve value`));
    const classicLive = 1 + (classicBase - 1) * safeMultiplier;
    const demandLive = core.valuesByPlayerId[player.id];
    return [player.id, Math.max(1, Math.round(classicWeight * classicLive + demandWeight * demandLive))];
  }));
}

export function calculateAuctionDemandMarket(pack, state, { profile = HISTORICAL_AUCTION_DEMAND } = {}) {
  if (!pack?.players?.length || !pack?.leagueConfig?.starterRequirements || !state?.teams || !state?.config) {
    fail("INVALID_AUCTION_DEMAND_INPUT", "Auction-demand pricing requires a draft pack and replayed draft state.");
  }
  const baseline = calculateCore(pack, pristineState(pack), profile);
  const current = calculateCore(pack, state, profile);
  const globalMultiplier = baseline.dollarPerVorp > 0 ? current.dollarPerVorp / baseline.dollarPerVorp : 1;
  const marketRoomCurve = monotoneRoomCurve(pack, "marketValue");
  const maxBidRoomCurve = monotoneRoomCurve(pack, "maxBid");
  const baselineValues = blendedMarketValues(pack, baseline, 1, profile, marketRoomCurve);
  const currentValues = blendedMarketValues(pack, current, globalMultiplier, profile, marketRoomCurve);
  const safeGlobalMultiplier = Math.max(0.5, Math.min(2, globalMultiplier));
  const bidCeilingsByPlayerId = Object.fromEntries(pack.players.map((player) => [
    player.id,
    Math.max(1, Math.round(1 + (maxBidRoomCurve[player.id] - 1) * safeGlobalMultiplier)),
  ]));
  const positionImpacts = {};
  for (const position of POSITIONS) {
    const positionPlayers = pack.players.filter((player) => player.position === position);
    const baselineDiscretionary = positionPlayers.reduce(
      (sum, player) => sum + Math.max(0, baselineValues[player.id] - 1),
      0,
    );
    const currentDiscretionary = positionPlayers.reduce(
      (sum, player) => sum + Math.max(0, currentValues[player.id] - 1),
      0,
    );
    positionImpacts[position] = {
      position,
      expectedRemainingDemand: Math.round(current.exactDemand[position] * 10) / 10,
      replacementRank: current.ranks[position],
      replacementPoints: current.replacementPoints[position],
      displayPercent: percentChange(currentDiscretionary, baselineDiscretionary),
      remainingBudget: current.positionBudgets[position],
      historicalSpendShare: current.positionSpendShares[position],
      spent: current.positionSpent[position],
    };
  }
  const displayPercent = percentChange(current.dollarPerVorp, baseline.dollarPerVorp);
  return {
    modelEffect: "validated_historical_auction_market_only",
    bidAuthority: "classic_starter_vbd_control",
    evidence: {
      source: profile.source,
      seasons: [...profile.seasons],
      teamSeasons: profile.teamSeasons,
      excludedSeasons: { ...profile.excludedSeasons },
      marketBlend: { ...profile.marketBlend },
    },
    expectedRemainingPurchases: current.reserveSlots,
    remainingRoomDollars: current.availableCash,
    remainingDiscretionaryDollars: current.discretionaryCash,
    dollarPerVorp: current.dollarPerVorp,
    positionDollarPerVorp: current.positionDollarPerVorp,
    positionBudgets: current.positionBudgets,
    baselineDollarPerVorp: baseline.dollarPerVorp,
    displayPercent,
    globalInflationPercent: displayPercent,
    globalMultiplier,
    positionImpacts,
    valuesByPlayerId: currentValues,
    bidCeilingsByPlayerId,
    roomCurveValuesByPlayerId: marketRoomCurve,
    demandOnlyValuesByPlayerId: current.valuesByPlayerId,
    demandAllocatedRoomDollars: current.purchasablePlayerIds.reduce(
      (sum, playerId) => sum + current.valuesByPlayerId[playerId],
      0,
    ),
    auctionVorpByPlayerId: current.auctionVorpByPlayerId,
    purchasablePlayerIds: current.purchasablePlayerIds,
  };
}
