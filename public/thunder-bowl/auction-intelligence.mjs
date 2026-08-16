import { legalMaximumBid, requiredRosterAdditions, validateEvent, EVENT_TYPES } from "./state-engine.mjs?v=20260810e";
import { expectedAdditionalPlayers, HISTORICAL_AUCTION_DEMAND } from "./auction-demand.mjs?v=20260816a";
import { detectPositionRun } from "./position-run.mjs?v=20260810a";

export const AUCTION_INTELLIGENCE_VERSION = "auction-intelligence-v1";
export const DEFAULT_SIMULATION_SAMPLES = 384;
export const USER_TEAM_ID = "dogs-of-war";

const MINIMUM_PROFILE_PRIOR = 40;
const MAX_PROFILE_WEIGHT = 0.65;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail("INVALID_AUCTION_INTELLIGENCE_NUMBER", `${label} must be finite.`);
  return number;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function quantile(sortedValues, probability) {
  if (!sortedValues.length) return 0;
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(probability * sortedValues.length) - 1));
  return sortedValues[index];
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed) {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalRandom(random) {
  const first = Math.max(Number.EPSILON, random());
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function activeSales(rawEvents = []) {
  if (!Array.isArray(rawEvents)) return [];
  const events = rawEvents.map(validateEvent);
  const voided = new Set(events.filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED).map((event) => event.payload.targetEventId));
  return events.filter((event) => event.type === EVENT_TYPES.PLAYER_SOLD && !voided.has(event.id));
}

function canDraftPosition(team, config, position) {
  if (!team || team.openSlots <= 0) return false;
  const nextCounts = { ...team.positionCounts, [position]: (team.positionCounts[position] || 0) + 1 };
  const openSlotsAfter = team.openSlots - 1;
  const missingStartersAfter = Object.entries(config.starterRequirements).reduce(
    (sum, [candidatePosition, requirement]) => sum + Math.max(0, requirement - (nextCounts[candidatePosition] || 0)),
    0,
  );
  return missingStartersAfter <= openSlotsAfter;
}

export function empiricalBayesWeight(samplePurchases, { priorStrength = MINIMUM_PROFILE_PRIOR, cap = MAX_PROFILE_WEIGHT } = {}) {
  const sample = Math.max(0, finite(samplePurchases ?? 0, "Profile sample purchases"));
  const prior = Math.max(1, finite(priorStrength, "Profile prior strength"));
  return clamp(sample / (sample + prior), 0, finite(cap, "Profile weight cap"));
}

export function shrinkMultiplier(rawMultiplier, samplePurchases, options = {}) {
  const raw = clamp(finite(rawMultiplier ?? 1, "Raw profile multiplier"), 0.4, 2);
  const weight = empiricalBayesWeight(samplePurchases, options);
  return 1 + weight * (raw - 1);
}

export function teamBudgetPressure(team, state) {
  if (!team || !state?.config) fail("INVALID_TEAM_BUDGET_PRESSURE_INPUT", "Budget pressure requires a team and draft state.");
  const reserve = requiredRosterAdditions(team, state.config) * state.config.minimumBid;
  const discretionary = Math.max(0, team.cash - reserve);
  const activeTeams = Object.values(state.teams).filter((candidate) => candidate.openSlots > 0);
  const average = activeTeams.reduce((sum, candidate) => {
    const candidateReserve = requiredRosterAdditions(candidate, state.config) * state.config.minimumBid;
    return sum + Math.max(0, candidate.cash - candidateReserve);
  }, 0) / Math.max(1, activeTeams.length);
  const relative = (discretionary + 1) / (average + 1);
  return {
    cash: team.cash,
    completionReserve: reserve,
    discretionaryDollars: discretionary,
    roomAverageDiscretionary: round1(average),
    relative: round1(relative),
    multiplier: clamp(1 + 0.12 * Math.tanh(Math.log(relative)), 0.88, 1.12),
  };
}

function baselineForPlayer(player, baselineValuesByPlayerId) {
  return Math.max(1, finite(baselineValuesByPlayerId?.[player.id] ?? player.marketValue ?? 1, `${player.name} baseline market value`));
}

function saleResidualEvidence({ events, playersById, baselineValuesByPlayerId, selectedPlayer, state = null, telemetryStore = null }) {
  const sales = activeSales(events);
  const comparable = [];
  const global = [];
  const runSales = [];
  for (let index = 0; index < sales.length; index += 1) {
    const sale = sales[index];
    const player = playersById.get(sale.payload.playerId);
    if (!player) continue;
    const recordedForecast = telemetryStore?.records?.[sale.id]?.forecast;
    const baseline = Math.max(1, recordedForecast?.naturalPoint ?? baselineForPlayer(player, baselineValuesByPlayerId));
    const residual = sale.payload.amount - baseline;
    runSales.push({ position: player.position, amount: sale.payload.amount, expectedPrice: baseline });
    const recency = 1 / (1 + (sales.length - 1 - index) * 0.2);
    global.push({ residual, ratio: sale.payload.amount / baseline, recency, position: player.position });
    if (player.position !== selectedPlayer.position) continue;
    const tierDistance = Math.abs(finite(player.tier ?? 99, "Comparable tier") - finite(selectedPlayer.tier ?? 99, "Selected tier"));
    const pointDistance = Math.abs(finite(player.projectedPoints ?? 0, "Comparable projection") - finite(selectedPlayer.projectedPoints ?? 0, "Selected projection"));
    const similarity = 1 / (1 + tierDistance + pointDistance / Math.max(20, finite(selectedPlayer.projectedPoints ?? 1, "Selected projection") * 0.2));
    comparable.push({
      playerId: player.id,
      playerName: player.name,
      salePrice: sale.payload.amount,
      baseline,
      residual,
      weight: recency * similarity,
    });
  }
  const weightedAverage = (rows, field) => {
    const totalWeight = rows.reduce((sum, row) => sum + (row.weight ?? row.recency), 0);
    return totalWeight ? rows.reduce((sum, row) => sum + row[field] * (row.weight ?? row.recency), 0) / totalWeight : 0;
  };
  const recentGlobal = global.slice(-8);
  const comparableResidual = weightedAverage(comparable.slice(-8), "residual");
  const globalRatio = weightedAverage(recentGlobal, "ratio") || 1;
  const base = baselineForPlayer(selectedPlayer, baselineValuesByPlayerId);
  const anchorDollars = clamp(comparableResidual * 0.35, -Math.max(2, base * 0.18), Math.max(2, base * 0.18));
  const regimeDollars = clamp(base * (globalRatio - 1) * 0.2, -Math.max(1, base * 0.08), Math.max(1, base * 0.08));
  const tierSupply = [...playersById.values()].filter((player) => (
    player.position === selectedPlayer.position
    && player.tier === selectedPlayer.tier
    && !state?.draftedPlayers?.[player.id]
  )).length;
  const positionRun = detectPositionRun({
    sales: runSales,
    position: selectedPlayer.position,
    state,
    referencePrice: base,
    tierSupply,
  });
  return {
    saleCount: sales.length,
    comparableCount: comparable.length,
    comparables: comparable.sort((left, right) => right.weight - left.weight).slice(0, 3),
    anchorDollars: round1(anchorDollars),
    roomRegimeDollars: round1(regimeDollars),
    // Historical continuation precision is not yet sufficient to grant this
    // detector pricing authority. Preserve the proposed signal for the HUD,
    // but keep rival WTP and authoritative values unchanged.
    positionRunDollars: 0,
    positionRunProposedDollars: positionRun.dollarImpact,
    positionRun,
    lastPositions: runSales.slice(-6).map((sale) => sale.position),
  };
}

function telemetryTeamSignal({ telemetryStore, teamId, position, baselineValuesByPlayerId, playersById }) {
  const evidence = [];
  for (const record of Object.values(telemetryStore?.records || {})) {
    const player = playersById.get(record.playerId);
    if (!player) continue;
    let lowerBound = null;
    if (record.winnerTeamId === teamId) lowerBound = record.salePrice;
    if (record.status === "recorded" && record.runnerUpTeamId === teamId) lowerBound = Math.max(1, record.salePrice - 1);
    if (lowerBound === null) continue;
    const baseline = baselineForPlayer(player, baselineValuesByPlayerId);
    evidence.push({ ratio: lowerBound / baseline, weight: player.position === position ? 1 : 0.35 });
  }
  const totalWeight = evidence.reduce((sum, row) => sum + row.weight, 0);
  if (!totalWeight) return { sample: 0, multiplier: 1 };
  const raw = evidence.reduce((sum, row) => sum + row.ratio * row.weight, 0) / totalWeight;
  const shrink = totalWeight / (totalWeight + 6);
  return { sample: evidence.length, multiplier: clamp(1 + shrink * (raw - 1), 0.9, 1.12) };
}

function substituteEvidence(player, packPlayers, draftedPlayers, baselineValuesByPlayerId) {
  const selectedValue = baselineForPlayer(player, baselineValuesByPlayerId);
  const alternatives = packPlayers.filter((candidate) => candidate.id !== player.id
    && candidate.position === player.position
    && !draftedPlayers[candidate.id]
    && baselineForPlayer(candidate, baselineValuesByPlayerId) >= Math.max(1, selectedValue * 0.75));
  const sameTier = alternatives.filter((candidate) => candidate.tier === player.tier).length;
  const multiplier = clamp(1 + Math.max(0, 4 - alternatives.length) * 0.025 + Math.max(0, 2 - sameTier) * 0.015, 0.96, 1.12);
  return { comparableAlternatives: alternatives.length, sameTierAlternatives: sameTier, multiplier };
}

function teamNeedEvidence(team, player, config) {
  const currentCount = team.positionCounts[player.position] || 0;
  const starterNeeded = currentCount < (config.starterRequirements[player.position] || 0);
  const expectedAdditional = expectedAdditionalPlayers(HISTORICAL_AUCTION_DEMAND, player.position, currentCount);
  const multiplier = starterNeeded ? 1.12 : expectedAdditional >= 1.5 ? 1.04 : expectedAdditional >= 0.5 ? 1 : 0.9;
  return { currentCount, starterNeeded, expectedAdditional: round1(expectedAdditional), multiplier };
}

export function estimateTeamWillingnessToPay({
  profile,
  state,
  player,
  liveMarketValue,
  packPlayers,
  baselineValuesByPlayerId,
  events = [],
  telemetryStore = null,
  marketEvidence = null,
}) {
  if (!profile || !state?.teams?.[profile.teamId] || !player || !Array.isArray(packPlayers)) {
    fail("INVALID_TEAM_WTP_INPUT", "Team willingness-to-pay requires a profile, live state, player, and player pool.");
  }
  const team = state.teams[profile.teamId];
  const market = Math.max(1, finite(liveMarketValue, "Live market value"));
  const legalMaxBid = canDraftPosition(team, state.config, player.position)
    ? legalMaximumBid(team, state.config, player.position)
    : 0;
  if (team.openSlots <= 0 || legalMaxBid < 1) {
    return { teamId: team.id, teamName: team.name, eligible: false, legalMaxBid: 0, meanWtp: 0, lowWtp: 0, highWtp: 0 };
  }
  const profileWeight = empiricalBayesWeight(profile.samplePurchases);
  const positionMultiplier = shrinkMultiplier(profile.positionMultipliers?.[player.position] ?? 1, profile.samplePurchases);
  const affinityRaw = profile.topNflAffinity === player.nflTeam ? profile.topNflAffinityMultiplier ?? 1 : 1;
  const affinityMultiplier = 1 + 0.35 * (shrinkMultiplier(affinityRaw, profile.samplePurchases, { priorStrength: 80, cap: 0.35 }) - 1);
  const budget = teamBudgetPressure(team, state);
  const need = teamNeedEvidence(team, player, state.config);
  const substitutes = substituteEvidence(player, packPlayers, state.draftedPlayers, baselineValuesByPlayerId);
  const playersById = new Map(packPlayers.map((candidate) => [candidate.id, candidate]));
  const telemetry = telemetryTeamSignal({ telemetryStore, teamId: team.id, position: player.position, baselineValuesByPlayerId, playersById });
  const room = marketEvidence || saleResidualEvidence({ events, playersById, baselineValuesByPlayerId, selectedPlayer: player, state, telemetryStore });
  const roomDollars = room.anchorDollars + room.roomRegimeDollars + room.positionRunDollars;
  const behaviorMultiplier = clamp(positionMultiplier * affinityMultiplier * budget.multiplier * need.multiplier * substitutes.multiplier * telemetry.multiplier, 0.72, 1.38);
  const uncappedMean = Math.max(1, market * behaviorMultiplier + roomDollars);
  const meanWtp = Math.min(legalMaxBid, Math.max(1, Math.round(uncappedMean)));
  const relativeUncertainty = clamp(0.24 - 0.11 * profileWeight - Math.min(0.04, telemetry.sample * 0.01), 0.1, 0.25);
  const uncertaintyDollars = Math.max(2, meanWtp * relativeUncertainty);
  return {
    teamId: team.id,
    teamName: team.name,
    eligible: true,
    legalMaxBid,
    meanWtp,
    lowWtp: Math.max(1, Math.min(legalMaxBid, Math.round(meanWtp - uncertaintyDollars))),
    highWtp: Math.max(1, Math.min(legalMaxBid, Math.round(meanWtp + uncertaintyDollars))),
    uncertaintyDollars: round1(uncertaintyDollars),
    confidence: profileWeight >= 0.45 || telemetry.sample >= 3 ? "medium" : "low",
    samplePurchases: profile.samplePurchases,
    sampleSeasons: profile.sampleSeasons,
    empiricalBayesWeight: round2(profileWeight),
    factors: {
      position: round1(positionMultiplier),
      affinity: round1(affinityMultiplier),
      budget: round1(budget.multiplier),
      need: round1(need.multiplier),
      substitutes: round1(substitutes.multiplier),
      liveTelemetry: round1(telemetry.multiplier),
    },
    budget,
    need,
    substitutes,
    telemetrySample: telemetry.sample,
    affinityMatch: profile.topNflAffinity === player.nflTeam,
  };
}

function sampledAuctionOutcome(bidders, random, { dogsBidLimit = null, userTeamId = USER_TEAM_ID } = {}) {
  const averageWtp = bidders.reduce((sum, bidder) => sum + bidder.meanWtp, 0) / Math.max(1, bidders.length);
  const sharedMarketShock = normalRandom(random) * Math.max(0.5, averageWtp * 0.05);
  const sampled = bidders.map((bidder) => ({
    ...bidder,
    sampledWtp: Math.max(0, Math.min(bidder.legalMaxBid, Math.round(
      bidder.meanWtp
      + sharedMarketShock
      + normalRandom(random) * Math.max(0.5, bidder.uncertaintyDollars * 0.38)
    ))),
  })).filter((bidder) => bidder.sampledWtp >= 1);
  if (dogsBidLimit !== null && dogsBidLimit >= 1) {
    sampled.push({ teamId: userTeamId, teamName: "Dogs of War", sampledWtp: Math.round(dogsBidLimit), legalMaxBid: Math.round(dogsBidLimit) });
  }
  sampled.sort((left, right) => right.sampledWtp - left.sampledWtp || left.teamId.localeCompare(right.teamId));
  if (!sampled.length) return { price: 1, winnerTeamId: null, secondTeamId: null };
  const winner = sampled[0];
  const second = sampled[1];
  const price = second ? Math.min(winner.sampledWtp, second.sampledWtp + 1) : 1;
  return { price: Math.max(1, price), winnerTeamId: winner.teamId, secondTeamId: second?.teamId || null };
}

export function simulateSecondPriceAuction(bidders, {
  samples = DEFAULT_SIMULATION_SAMPLES,
  seed = "thunder-bowl",
  dogsBidLimit = null,
  userTeamId = USER_TEAM_ID,
} = {}) {
  const sampleCount = Math.max(64, Math.min(4096, Math.round(finite(samples, "Simulation samples"))));
  const random = randomGenerator(seed);
  const prices = [];
  const wins = new Map();
  const secondPlaces = new Map();
  for (let index = 0; index < sampleCount; index += 1) {
    const outcome = sampledAuctionOutcome(bidders, random, { dogsBidLimit, userTeamId });
    prices.push(outcome.price);
    if (outcome.winnerTeamId) wins.set(outcome.winnerTeamId, (wins.get(outcome.winnerTeamId) || 0) + 1);
    if (outcome.secondTeamId) secondPlaces.set(outcome.secondTeamId, (secondPlaces.get(outcome.secondTeamId) || 0) + 1);
  }
  prices.sort((left, right) => left - right);
  const deterministic = bidders
    .map((bidder) => ({ ...bidder, sampledWtp: Math.min(bidder.legalMaxBid, bidder.meanWtp) }))
    .concat(dogsBidLimit !== null && dogsBidLimit >= 1
      ? [{ teamId: userTeamId, teamName: "Dogs of War", sampledWtp: Math.round(dogsBidLimit), legalMaxBid: Math.round(dogsBidLimit) }]
      : [])
    .sort((left, right) => right.sampledWtp - left.sampledWtp || left.teamId.localeCompare(right.teamId));
  const deterministicPrice = deterministic.length > 1
    ? Math.max(1, Math.min(deterministic[0].sampledWtp, deterministic[1].sampledWtp + 1))
    : 1;
  const rawMedian = quantile(prices, 0.5);
  const centeredPrices = prices.map((price) => Math.max(1, price + deterministicPrice - rawMedian)).sort((left, right) => left - right);
  const expected = centeredPrices.reduce((sum, price) => sum + price, 0) / centeredPrices.length;
  return {
    samples: sampleCount,
    expectedPrice: round1(expected),
    medianPrice: deterministicPrice,
    range80: { low: quantile(centeredPrices, 0.1), high: quantile(centeredPrices, 0.9) },
    wins: Object.fromEntries([...wins.entries()].map(([teamId, count]) => [teamId, round1(count / sampleCount * 100)])),
    secondPlaces: Object.fromEntries([...secondPlaces.entries()].map(([teamId, count]) => [teamId, round1(count / sampleCount * 100)])),
  };
}

function rationalShadowBaseline({ state, player, liveMarketValue, userTeamId }) {
  const ceilings = Object.values(state.teams)
    .filter((team) => team.id !== userTeamId && canDraftPosition(team, state.config, player.position))
    .map((team) => legalMaximumBid(team, state.config, player.position))
    .filter((value) => value >= 1)
    .sort((left, right) => right - left);
  if (!ceilings.length) return 1;
  const constrainedMarket = Math.min(Math.max(1, Math.round(liveMarketValue)), ceilings[0]);
  const secondCeiling = ceilings[1] ?? 1;
  return Math.max(1, Math.min(constrainedMarket, secondCeiling + 1));
}

function nominationTiming({ currentForecast, liveMarketValue, state, player }) {
  const activeTeams = Object.values(state.teams).filter((team) => team.openSlots > 0);
  const starterNeedTeams = activeTeams.filter((team) => (team.missingStarterSlots?.[player.position] || 0) > 0).length;
  const budgetIntensity = activeTeams.reduce((sum, team) => sum + teamBudgetPressure(team, state).relative, 0) / Math.max(1, activeTeams.length);
  const early = currentForecast.medianPrice;
  const mid = Math.max(1, Math.round(early * clamp(0.98 + 0.02 * budgetIntensity, 0.94, 1.04)));
  const late = Math.max(1, Math.round(early * clamp(0.9 + 0.025 * starterNeedTeams, 0.9, 1.05)));
  const windows = { now: early, middle: mid, late };
  const best = Object.entries(windows).sort((left, right) => left[1] - right[1] || ["now", "middle", "late"].indexOf(left[0]) - ["now", "middle", "late"].indexOf(right[0]))[0][0];
  return {
    model: "scenario heuristic derived from live room state",
    status: "advisory_only",
    now: early,
    middle: mid,
    late,
    bestWindow: best,
    deltaVersusNow: windows[best] - early,
    note: `Uses ${starterNeedTeams} active team${starterNeedTeams === 1 ? "" : "s"} still needing a ${player.position} starter; it is not a timestamp-trained survival model.`,
  };
}

function simulatedRequiredAdditions(team, config, candidatePosition = null) {
  const counts = { ...team.positionCounts };
  const rosterCount = team.rosterCount + (candidatePosition ? 1 : 0);
  if (candidatePosition) counts[candidatePosition] = (counts[candidatePosition] || 0) + 1;
  const minimumPlayersNeeded = Math.max(0, 8 - rosterCount);
  const missingStarters = Object.entries(config.starterRequirements).reduce(
    (sum, [position, requirement]) => sum + Math.max(0, requirement - (counts[position] || 0)),
    0,
  );
  return Math.max(minimumPlayersNeeded, missingStarters);
}

function simulatedLegalMaximum(team, config, position) {
  if (team.rosterCount >= config.rosterSize) return 0;
  const reserve = simulatedRequiredAdditions(team, config, position) * config.minimumBid;
  return Math.max(0, team.cash - reserve);
}

function simulatedCanDraft(team, config, position) {
  if (team.rosterCount >= config.rosterSize) return false;
  const nextCounts = { ...team.positionCounts, [position]: (team.positionCounts[position] || 0) + 1 };
  const openAfter = config.rosterSize - team.rosterCount - 1;
  const missingAfter = Object.entries(config.starterRequirements).reduce(
    (sum, [candidatePosition, requirement]) => sum + Math.max(0, requirement - (nextCounts[candidatePosition] || 0)),
    0,
  );
  return missingAfter <= openAfter;
}

function desiredPositionCounts(team, config) {
  const desired = {};
  for (const position of Object.keys(config.starterRequirements)) {
    const current = team.positionCounts[position] || 0;
    desired[position] = Math.max(
      config.starterRequirements[position],
      current + Math.round(expectedAdditionalPlayers(HISTORICAL_AUCTION_DEMAND, position, current)),
    );
  }
  while (Object.values(desired).reduce((sum, count) => sum + count, 0) > config.rosterSize) {
    const reducible = Object.keys(desired)
      .filter((position) => desired[position] > config.starterRequirements[position])
      .sort((left, right) => desired[right] - config.starterRequirements[right] - (desired[left] - config.starterRequirements[left]) || left.localeCompare(right))[0];
    if (!reducible) break;
    desired[reducible] -= 1;
  }
  return desired;
}

function outcomeFromSampledBids(bids) {
  const ranked = bids.filter((bid) => bid.amount >= 1)
    .sort((left, right) => right.amount - left.amount || left.teamId.localeCompare(right.teamId));
  if (!ranked.length) return { price: 1, winnerTeamId: null, secondTeamId: null };
  const winner = ranked[0];
  const second = ranked[1];
  return {
    price: second ? Math.max(1, Math.min(winner.amount, second.amount + 1)) : 1,
    winnerTeamId: winner.teamId,
    secondTeamId: second?.teamId || null,
  };
}

export function simulateRemainingAuctionForTarget({
  profiles = [],
  state,
  targetPlayer,
  packPlayers = [],
  marketValuesByPlayerId = {},
  dogsBidLimit = 0,
  userTeamId = USER_TEAM_ID,
  samples = 96,
  seed = "full-auction",
}) {
  if (!state?.teams || !targetPlayer || !Array.isArray(packPlayers)) fail("INVALID_FULL_AUCTION_SIMULATION_INPUT", "Remaining-auction simulation requires live state, target player, and pool.");
  const sampleCount = Math.max(32, Math.min(256, Math.round(finite(samples, "Full-auction simulation samples"))));
  const profileByTeam = new Map(profiles.map((profile) => [profile.teamId, profile]));
  const positionFactors = new Map();
  for (const team of Object.values(state.teams)) {
    const profile = profileByTeam.get(team.id);
    positionFactors.set(team.id, Object.fromEntries(Object.keys(state.config.starterRequirements).map((position) => [
      position,
      shrinkMultiplier(profile?.positionMultipliers?.[position] ?? 1, profile?.samplePurchases ?? 0),
    ])));
  }
  const available = packPlayers.filter((player) => !state.draftedPlayers[player.id]
    && (player.id === targetPlayer.id || (marketValuesByPlayerId[player.id] ?? player.marketValue ?? 1) > 1));
  const naturalRows = [];
  const participationRows = [];
  const windowRows = { early: [], middle: [], late: [] };
  let dogsWins = 0;
  const windowDogsWins = { early: 0, middle: 0, late: 0 };
  const windowTotals = { early: 0, middle: 0, late: 0 };
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const random = randomGenerator(`${seed}|${sampleIndex}`);
    const teams = Object.fromEntries(Object.values(state.teams).map((team) => [team.id, {
      id: team.id,
      cash: team.cash,
      rosterCount: team.roster.length,
      positionCounts: { ...team.positionCounts },
      desired: desiredPositionCounts({ positionCounts: team.positionCounts }, state.config),
    }]));
    const nominationOrder = available.map((player) => {
      const value = Math.max(1, marketValuesByPlayerId[player.id] ?? player.marketValue ?? 1);
      const urgency = 1 + Math.sqrt(value);
      return { player, key: -Math.log(Math.max(Number.EPSILON, random())) / urgency };
    }).sort((left, right) => left.key - right.key || left.player.id.localeCompare(right.player.id));
    for (let nominationIndex = 0; nominationIndex < nominationOrder.length; nominationIndex += 1) {
      const player = nominationOrder[nominationIndex].player;
      const base = Math.max(1, marketValuesByPlayerId[player.id] ?? player.marketValue ?? 1);
      const activeTeams = Object.values(teams).filter((team) => team.rosterCount < state.config.rosterSize);
      const averageDiscretionary = activeTeams.reduce(
        (sum, team) => sum + Math.max(0, team.cash - simulatedRequiredAdditions(team, state.config) * state.config.minimumBid),
        0,
      ) / Math.max(1, activeTeams.length);
      const bids = [];
      const sharedMarketShock = normalRandom(random) * Math.max(0.5, base * 0.05);
      for (const team of activeTeams) {
        if (!simulatedCanDraft(team, state.config, player.position)) continue;
        const starterNeeded = (team.positionCounts[player.position] || 0) < state.config.starterRequirements[player.position];
        const wantsDepth = (team.positionCounts[player.position] || 0) < team.desired[player.position];
        if (!starterNeeded && !wantsDepth) continue;
        if (player.id === targetPlayer.id && team.id === userTeamId) continue;
        const legalMax = simulatedLegalMaximum(team, state.config, player.position);
        if (legalMax < 1) continue;
        const discretionary = Math.max(0, team.cash - simulatedRequiredAdditions(team, state.config) * state.config.minimumBid);
        const budgetFactor = clamp(1 + 0.1 * Math.tanh(Math.log((discretionary + 1) / (averageDiscretionary + 1))), 0.9, 1.1);
        const profile = profileByTeam.get(team.id);
        const affinity = profile?.topNflAffinity === player.nflTeam
          ? 1 + 0.2 * (shrinkMultiplier(profile.topNflAffinityMultiplier ?? 1, profile.samplePurchases ?? 0, { priorStrength: 80, cap: 0.35 }) - 1)
          : 1;
        const needFactor = starterNeeded ? 1.1 : 1;
        const mean = base * (positionFactors.get(team.id)?.[player.position] ?? 1) * affinity * budgetFactor * needFactor;
        const teamNoise = normalRandom(random) * Math.max(0.5, mean * 0.035);
        const amount = Math.max(1, Math.min(legalMax, Math.round(mean + sharedMarketShock + teamNoise)));
        bids.push({ teamId: team.id, amount });
      }
      if (player.id === targetPlayer.id) {
        const natural = outcomeFromSampledBids(bids);
        const dogsTeam = teams[userTeamId];
        const dogsLegalMax = dogsTeam && simulatedCanDraft(dogsTeam, state.config, player.position)
          ? simulatedLegalMaximum(dogsTeam, state.config, player.position)
          : 0;
        const simulatedDogsLimit = Math.min(Math.round(dogsBidLimit), dogsLegalMax);
        const withDogs = outcomeFromSampledBids([
          ...bids,
          ...(simulatedDogsLimit >= 1 ? [{ teamId: userTeamId, amount: simulatedDogsLimit }] : []),
        ]);
        const percentile = nominationOrder.length > 1 ? nominationIndex / (nominationOrder.length - 1) : 0;
        const window = percentile < 1 / 3 ? "early" : percentile < 2 / 3 ? "middle" : "late";
        naturalRows.push(natural.price);
        participationRows.push(withDogs.price);
        windowRows[window].push(natural.price);
        windowTotals[window] += 1;
        if (withDogs.winnerTeamId === userTeamId) {
          dogsWins += 1;
          windowDogsWins[window] += 1;
        }
        break;
      }
      const outcome = outcomeFromSampledBids(bids);
      if (!outcome.winnerTeamId) continue;
      const winner = teams[outcome.winnerTeamId];
      winner.cash -= outcome.price;
      winner.rosterCount += 1;
      winner.positionCounts[player.position] = (winner.positionCounts[player.position] || 0) + 1;
    }
  }
  const summarize = (rows) => {
    const sorted = [...rows].sort((left, right) => left - right);
    return sorted.length ? { n: sorted.length, median: quantile(sorted, 0.5), low: quantile(sorted, 0.1), high: quantile(sorted, 0.9) } : null;
  };
  const windows = Object.fromEntries(Object.entries(windowRows).map(([window, rows]) => {
    const summary = summarize(rows);
    return [window, summary ? {
      ...summary,
      dogsWinProbability: round1(windowDogsWins[window] / Math.max(1, windowTotals[window]) * 100),
    } : null];
  }));
  const comparableWindows = Object.entries(windows).filter(([, row]) => row?.n >= 5);
  const bestWindow = comparableWindows.sort((left, right) => left[1].median - right[1].median || ["early", "middle", "late"].indexOf(left[0]) - ["early", "middle", "late"].indexOf(right[0]))[0]?.[0] || "early";
  return {
    samples: sampleCount,
    simulatedPlayers: available.length,
    natural: summarize(naturalRows),
    withDogs: {
      ...summarize(participationRows),
      winProbability: round1(dogsWins / sampleCount * 100),
    },
    windows,
    bestWindow,
    modelEffect: "advisory_only_experimental",
    note: "Each rollout spends team cash and fills historically expected position depth before the target nomination; nomination order remains simulated because historical timestamps do not exist.",
  };
}

export function forecastAuctionPrice({
  profiles = [],
  state,
  player,
  liveMarketValue,
  packPlayers = [],
  baselineValuesByPlayerId = {},
  marketValuesByPlayerId = baselineValuesByPlayerId,
  events = [],
  telemetryStore = null,
  dogsBidLimit = null,
  userTeamId = USER_TEAM_ID,
  samples = DEFAULT_SIMULATION_SAMPLES,
  seed = null,
  includeRemainingAuction = true,
}) {
  if (!state?.teams || !player || !Array.isArray(profiles) || !Array.isArray(packPlayers)) {
    fail("INVALID_AUCTION_FORECAST_INPUT", "Auction forecast requires profiles, live state, a player, and the player pool.");
  }
  const playersById = new Map(packPlayers.map((candidate) => [candidate.id, candidate]));
  const marketEvidence = saleResidualEvidence({ events, playersById, baselineValuesByPlayerId, selectedPlayer: player, state, telemetryStore });
  const bidders = profiles
    .filter((profile) => profile.teamId !== userTeamId)
    .map((profile) => estimateTeamWillingnessToPay({
      profile,
      state,
      player,
      liveMarketValue,
      packPlayers,
      baselineValuesByPlayerId,
      events,
      telemetryStore,
      marketEvidence,
    }))
    .filter((bidder) => bidder.eligible)
    .sort((left, right) => right.meanWtp - left.meanWtp || right.legalMaxBid - left.legalMaxBid || left.teamId.localeCompare(right.teamId));
  const simulationSeed = seed || `${AUCTION_INTELLIGENCE_VERSION}|${player.id}|${state.activeEventCount}|${Math.round(liveMarketValue)}`;
  const natural = simulateSecondPriceAuction(bidders, { samples, seed: `${simulationSeed}|natural`, userTeamId });
  const dogsLimit = Math.max(0, Math.round(dogsBidLimit ?? state.teams[userTeamId]?.legalMaxBid ?? 0));
  const participation = simulateSecondPriceAuction(bidders, { samples, seed: `${simulationSeed}|dogs`, dogsBidLimit: dogsLimit, userTeamId });
  const naturalPoint = natural.medianPrice;
  const withDogsPoint = participation.medianPrice;
  const topOpponent = bidders[0] || null;
  const secondOpponent = bidders[1] || null;
  const rationalBaseline = rationalShadowBaseline({ state, player, liveMarketValue, userTeamId });
  const timing = nominationTiming({ currentForecast: natural, liveMarketValue, state, player });
  const fullAuctionSimulation = includeRemainingAuction ? simulateRemainingAuctionForTarget({
    profiles,
    state,
    targetPlayer: player,
    packPlayers,
    marketValuesByPlayerId,
    dogsBidLimit: dogsLimit,
    userTeamId,
    samples: 96,
    seed: `${simulationSeed}|remaining-auction`,
  }) : null;
  if (fullAuctionSimulation?.windows[fullAuctionSimulation.bestWindow]) {
    const best = fullAuctionSimulation.windows[fullAuctionSimulation.bestWindow];
    timing.now = fullAuctionSimulation.windows.early?.median ?? timing.now;
    timing.middle = fullAuctionSimulation.windows.middle?.median ?? timing.middle;
    timing.late = fullAuctionSimulation.windows.late?.median ?? timing.late;
    timing.bestWindow = fullAuctionSimulation.bestWindow === "early" ? "now" : fullAuctionSimulation.bestWindow;
    timing.deltaVersusNow = best.median - timing.now;
    timing.model = "96 remaining-auction cash-and-roster rollouts";
    timing.note = `${fullAuctionSimulation.note} Waiting also risks another manager nominating the player first.`;
  }
  const baselineCalibration = HISTORICAL_AUCTION_DEMAND.marketBlend.coarseBaselineInterval;
  const baselineRadius = baselineCalibration.positionRadius[player.position] ?? baselineCalibration.globalRadius;
  const naturalSafetyRange = {
    low: Math.max(1, Math.min(natural.range80.low, naturalPoint - baselineRadius)),
    high: Math.max(natural.range80.high, naturalPoint + baselineRadius),
  };
  const participationSafetyRange = {
    low: Math.max(1, Math.min(participation.range80.low, withDogsPoint - baselineRadius)),
    high: Math.max(participation.range80.high, withDogsPoint + baselineRadius),
  };
  return {
    schemaVersion: 1,
    modelVersion: AUCTION_INTELLIGENCE_VERSION,
    modelEffect: "advisory_only_experimental",
    bidAuthority: "none",
    priceMechanism: "second-highest simulated willingness-to-pay plus one dollar",
    naturalSale: {
      point: naturalPoint,
      expected: natural.expectedPrice,
      range80: naturalSafetyRange,
      simulationRange80: natural.range80,
      samples: natural.samples,
    },
    dogsParticipation: {
      bidLimit: dogsLimit,
      point: withDogsPoint,
      range80: participationSafetyRange,
      simulationRange80: participation.range80,
      winProbability: fullAuctionSimulation?.withDogs?.winProbability ?? participation.wins[userTeamId] ?? 0,
      snapshotWinProbability: participation.wins[userTeamId] || 0,
      probabilityModel: fullAuctionSimulation ? "remaining-auction cash-and-roster rollouts" : "correlated current-bidder simulation",
      expectedExtraRoomPrice: round1(participation.expectedPrice - natural.expectedPrice),
      warning: dogsLimit > 0 && withDogsPoint > naturalPoint ? `Your participation may add about $${withDogsPoint - naturalPoint} to this sale.` : "No modeled price lift from participating at the current limit.",
    },
    topOpponent,
    secondOpponent,
    opponents: bidders,
    marketEvidence,
    rationalBaseline,
    nominationTiming: timing,
    fullAuctionSimulation,
    calibration: {
      method: "union of WTP simulation envelope and leave-one-season-out baseline-price residual radius",
      status: "coarse_baseline_proxy_only",
      targetCoverage: baselineCalibration.targetCoverage,
      observedBaselineCoverage: baselineCalibration.leaveOneSeasonOutCoverage,
      baselineRadius,
      baselineRows: baselineCalibration.developmentRows,
      reason: "The historical baseline band is real; the new per-team WTP challenger cannot be called conformal until its own timestamped 2026 forecasts have outcomes.",
    },
    arithmetic: {
      roomCash: state.totalCash,
      roomCompletionReserve: Object.values(state.teams).reduce((sum, team) => sum + requiredRosterAdditions(team, state.config) * state.config.minimumBid, 0),
      activeBidders: bidders.length,
      topOpponentWtp: topOpponent?.meanWtp ?? 0,
      secondOpponentWtp: secondOpponent?.meanWtp ?? 0,
    },
  };
}
