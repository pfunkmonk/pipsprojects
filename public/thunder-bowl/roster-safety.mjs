import { expectedAdditionalPlayers, HISTORICAL_AUCTION_DEMAND } from "./auction-demand.mjs?v=20260809a";

const DEFAULT_POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "K", "DST"]);
const DEFAULT_SAMPLES = 192;
const QUALITY_THRESHOLD = 0.85;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function normalRandom(random) {
  const first = Math.max(Number.EPSILON, random());
  const second = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function quantile(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function round1(value) {
  return Math.round(finite(value) * 10) / 10;
}

function combinationsForPosition(candidates, needed) {
  if (needed <= 0) return [{ cost: 0, utility: 0, players: [] }];
  if (candidates.length < needed) return [];
  if (needed === 1) {
    return candidates.map((candidate) => ({
      cost: candidate.price,
      utility: candidate.utility,
      players: [candidate],
    }));
  }
  const combinations = [];
  for (let left = 0; left < candidates.length - 1; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      combinations.push({
        cost: candidates[left].price + candidates[right].price,
        utility: candidates[left].utility + candidates[right].utility,
        players: [candidates[left], candidates[right]],
      });
    }
  }
  return combinations;
}

function paretoOptions(options, cash) {
  const bestAtCost = new Map();
  for (const option of options) {
    if (option.cost > cash) continue;
    const prior = bestAtCost.get(option.cost);
    if (!prior || option.utility > prior.utility) bestAtCost.set(option.cost, option);
  }
  const sorted = [...bestAtCost.values()].sort((left, right) => left.cost - right.cost || right.utility - left.utility);
  const frontier = [];
  let bestUtility = Number.NEGATIVE_INFINITY;
  for (const option of sorted) {
    if (option.utility <= bestUtility) continue;
    frontier.push(option);
    bestUtility = option.utility;
  }
  return frontier;
}

function solveStarterPortfolio({ candidates, needs, positions, cash }) {
  let frontier = [{ cost: 0, utility: 0, players: [] }];
  const positionOptions = {};
  for (const position of positions) {
    const needed = needs[position] || 0;
    const positionCandidates = candidates
      .filter((candidate) => candidate.position === position && candidate.attainable)
      .sort((left, right) => right.utility - left.utility || left.price - right.price || left.id.localeCompare(right.id))
      .slice(0, needed >= 2 ? 18 : 24);
    const options = paretoOptions(combinationsForPosition(positionCandidates, needed), cash);
    positionOptions[position] = options;
    if (!options.length) return { feasible: false, cost: null, utility: null, players: [], positionOptions };
    const next = [];
    for (const prior of frontier) {
      for (const option of options) {
        const cost = prior.cost + option.cost;
        if (cost > cash) continue;
        next.push({ cost, utility: prior.utility + option.utility, players: [...prior.players, ...option.players] });
      }
    }
    frontier = paretoOptions(next, cash);
    if (!frontier.length) return { feasible: false, cost: null, utility: null, players: [], positionOptions };
  }
  const best = frontier.reduce((winner, option) => !winner
    || option.utility > winner.utility
    || (option.utility === winner.utility && option.cost < winner.cost) ? option : winner, null);
  const cheapest = frontier.reduce((winner, option) => !winner || option.cost < winner.cost ? option : winner, null);
  return {
    feasible: Boolean(best),
    cost: best?.cost ?? null,
    minimumCost: cheapest?.cost ?? null,
    utility: best?.utility ?? null,
    players: best?.players || [],
    positionOptions,
  };
}

function normalizedContext({
  state,
  players,
  userTeamId,
  marketValueFor,
  bidLimitFor,
  utilityFor,
  hypotheticalPurchase,
}) {
  if (!state?.teams?.[userTeamId] || !state?.config?.starterRequirements || !Array.isArray(players)) {
    throw new Error("Roster safety requires live state, league rules, and a player pool.");
  }
  const team = state.teams[userTeamId];
  const positions = DEFAULT_POSITIONS.filter((position) => position in state.config.starterRequirements);
  const purchase = hypotheticalPurchase?.player && finite(hypotheticalPurchase.price) >= 1
    ? { player: hypotheticalPurchase.player, price: Math.round(finite(hypotheticalPurchase.price)) }
    : null;
  const counts = { ...team.positionCounts };
  let cash = Math.round(finite(team.cash));
  let openSlots = Math.round(finite(team.openSlots));
  if (purchase) {
    counts[purchase.player.position] = (counts[purchase.player.position] || 0) + 1;
    cash -= purchase.price;
    openSlots -= 1;
  }
  const needs = Object.fromEntries(positions.map((position) => [
    position,
    Math.max(0, Math.round(finite(state.config.starterRequirements[position])) - (counts[position] || 0)),
  ]));
  const missingStarters = Object.values(needs).reduce((sum, value) => sum + value, 0);
  const excludedPlayerId = purchase?.player.id || null;
  const normalizedPlayers = players
    .filter((player) => positions.includes(player.position))
    .map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      tier: Math.max(1, Math.round(finite(player.tier, 99))),
      utility: Math.max(0, finite(utilityFor(player), finite(player.projectedPoints, finite(player.vbd)))),
      market: Math.max(1, Math.round(finite(marketValueFor(player), 1))),
      cap: Math.max(0, Math.round(finite(bidLimitFor(player), 0))),
    }));
  const playerById = new Map(normalizedPlayers.map((player) => [player.id, player]));
  const committedIds = [
    ...(Array.isArray(team.roster) ? team.roster.map((entry) => entry.playerId) : []),
    ...(purchase ? [purchase.player.id] : []),
  ];
  const committedStarters = positions.flatMap((position) => {
    const limit = Math.max(0, Math.round(finite(state.config.starterRequirements[position])));
    return committedIds.map((playerId) => playerById.get(playerId))
      .filter((player) => player?.position === position)
      .sort((left, right) => right.utility - left.utility || left.id.localeCompare(right.id))
      .slice(0, limit);
  });
  const committedStarterUtility = committedStarters.reduce((sum, player) => sum + player.utility, 0);
  const available = normalizedPlayers
    .filter((player) => !state.draftedPlayers?.[player.id] && player.id !== excludedPlayerId);
  return { team, positions, purchase, counts, cash, openSlots, needs, missingStarters, available, committedStarters, committedStarterUtility };
}

function ceilingUtility(available, needs, positions) {
  return positions.reduce((total, position) => {
    const count = needs[position] || 0;
    const utilities = available.filter((player) => player.position === position)
      .map((player) => player.utility)
      .sort((left, right) => right - left);
    if (utilities.length < count) return Number.POSITIVE_INFINITY;
    return total + utilities.slice(0, count).reduce((sum, value) => sum + value, 0);
  }, 0);
}

function statusFor({ completionProbability, strongPathProbability, missingStarters, lanes, openSlots }) {
  if (missingStarters === 0) return { level: "complete", label: "LINEUP LEGAL", endgame: openSlots <= 2 };
  const tightLane = lanes.some((lane) => lane.needed > 0 && lane.viable <= lane.needed + 1);
  const endgame = openSlots <= missingStarters + 2 || tightLane;
  if (completionProbability < 70 || lanes.some((lane) => lane.needed > lane.viable)) {
    return { level: "danger", label: "ROSTER DANGER", endgame };
  }
  if (completionProbability < 92 || strongPathProbability < 60 || endgame) {
    return { level: "warning", label: endgame ? "ENDGAME WATCH" : "ROSTER WATCH", endgame };
  }
  return { level: "good", label: "ROSTER SAFE", endgame };
}

function deterministicCandidates(available, multiplier = 1) {
  return available.map((player) => ({
    ...player,
    price: Math.max(1, Math.round(player.market * multiplier)),
    attainable: Math.max(1, Math.round(player.market * multiplier)) <= player.cap,
  }));
}

function historicalTargetAdditions({ counts, needs, positions, openSlots }) {
  const additions = Object.fromEntries(positions.map((position) => [
    position,
    Math.max(needs[position] || 0, Math.round(expectedAdditionalPlayers(
      HISTORICAL_AUCTION_DEMAND,
      position,
      Math.max(0, Math.round(finite(counts[position]))),
    ))),
  ]));
  while (Object.values(additions).reduce((sum, value) => sum + value, 0) > openSlots) {
    const reducible = positions
      .filter((position) => additions[position] > (needs[position] || 0))
      .sort((left, right) => additions[right] - needs[right] - (additions[left] - needs[left]) || left.localeCompare(right))[0];
    if (!reducible) break;
    additions[reducible] -= 1;
  }
  return additions;
}

function plannedPositionBudgets({ cash, targetAdditions, positions }) {
  const totalAdds = Object.values(targetAdditions).reduce((sum, value) => sum + value, 0);
  const reserve = Math.min(cash, totalAdds);
  const discretionary = Math.max(0, cash - reserve);
  const spend = HISTORICAL_AUCTION_DEMAND.historicalPositionSpend.byPosition;
  const activeSpend = positions.reduce((sum, position) => sum + (targetAdditions[position] > 0 ? spend[position] || 0 : 0), 0);
  const rows = positions.map((position) => {
    const baseline = targetAdditions[position] || 0;
    const share = activeSpend > 0 && baseline > 0 ? (spend[position] || 0) / activeSpend : 0;
    const rawExtra = discretionary * share;
    return { position, baseline, rawExtra, dollars: baseline + Math.floor(rawExtra) };
  });
  let remainder = Math.max(0, cash - rows.reduce((sum, row) => sum + row.dollars, 0));
  for (const row of [...rows].sort((left, right) => (
    right.rawExtra - Math.floor(right.rawExtra) - (left.rawExtra - Math.floor(left.rawExtra))
    || (spend[right.position] || 0) - (spend[left.position] || 0)
    || left.position.localeCompare(right.position)
  ))) {
    if (remainder <= 0 || row.baseline <= 0) break;
    row.dollars += 1;
    remainder -= 1;
  }
  return Object.fromEntries(rows.map((row) => [row.position, row.dollars]));
}

function buildLanes({ available, needs, positions, deterministic, targetAdditions, plannedBudgets }) {
  return positions.map((position) => {
    const pool = available.filter((player) => player.position === position);
    const viable = pool.filter((player) => player.market <= player.cap);
    const selected = deterministic.players.filter((player) => player.position === position);
    const needed = needs[position] || 0;
    const nextTier = viable.sort((left, right) => left.tier - right.tier || right.utility - left.utility)[0]?.tier ?? null;
    let risk = "clear";
    if (needed > viable.length) risk = "blocked";
    else if (needed > 0 && viable.length <= needed + 1) risk = "critical";
    else if (needed > 0 && viable.length <= needed + 4) risk = "watch";
    return {
      position,
      needed,
      targetAdds: targetAdditions[position] || needed,
      available: pool.length,
      viable: viable.length,
      plannedDollars: plannedBudgets[position] || 0,
      starterPlanDollars: selected.reduce((sum, player) => sum + player.price, 0),
      plannedPlayers: selected.map((player) => player.name),
      nextTier,
      risk,
    };
  });
}

export function analyzeRosterSafety({
  state,
  players,
  userTeamId = "dogs-of-war",
  marketValueFor = (player) => player.marketValue,
  bidLimitFor = (player) => player.maxBid,
  utilityFor = (player) => player.projectedPoints,
  hypotheticalPurchase = null,
  samples = DEFAULT_SAMPLES,
  seed = "thunder-roster-safety",
  priceInflation = 0,
} = {}) {
  const context = normalizedContext({ state, players, userTeamId, marketValueFor, bidLimitFor, utilityFor, hypotheticalPurchase });
  const sampleCount = Math.max(64, Math.min(512, Math.round(finite(samples, DEFAULT_SAMPLES))));
  const baselineCandidates = deterministicCandidates(context.available, 1 + finite(priceInflation));
  const deterministic = solveStarterPortfolio({
    candidates: baselineCandidates,
    needs: context.needs,
    positions: context.positions,
    cash: Math.max(0, context.cash),
  });
  const remainingCeiling = ceilingUtility(context.available, context.needs, context.positions);
  const ceiling = Number.isFinite(remainingCeiling)
    ? context.committedStarterUtility + remainingCeiling
    : Number.POSITIVE_INFINITY;
  const targetAdditions = historicalTargetAdditions(context);
  const plannedBudgets = plannedPositionBudgets({ cash: context.cash, targetAdditions, positions: context.positions });
  const lanes = buildLanes({
    available: context.available,
    needs: context.needs,
    positions: context.positions,
    deterministic,
    targetAdditions,
    plannedBudgets,
  });
  const random = randomGenerator(`${seed}|${state.activeEventCount || 0}|${context.cash}|${context.missingStarters}|${hypotheticalPurchase?.player?.id || "base"}|${hypotheticalPurchase?.price || 0}`);
  let legalCompletions = 0;
  let strongPaths = 0;
  const cashAfterRows = [];
  const qualityRows = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const roomShock = clamp(normalRandom(random) * 0.055 + finite(priceInflation), -0.18, 0.28);
    const positionShocks = Object.fromEntries(context.positions.map((position) => [
      position,
      clamp(normalRandom(random) * 0.06, -0.16, 0.22),
    ]));
    const sampledCandidates = context.available.map((player) => {
      const playerShock = clamp(normalRandom(random) * (player.market <= 2 ? 0.18 : 0.075), -0.22, 0.28);
      const price = Math.max(1, Math.round(player.market * (1 + roomShock + positionShocks[player.position] + playerShock)));
      return { ...player, price, attainable: price <= player.cap };
    });
    const solution = solveStarterPortfolio({
      candidates: sampledCandidates,
      needs: context.needs,
      positions: context.positions,
      cash: Math.max(0, context.cash),
    });
    if (!solution.feasible) continue;
    legalCompletions += 1;
    const wholeLineupUtility = context.committedStarterUtility + solution.utility;
    const qualityRatio = ceiling > 0 && Number.isFinite(ceiling) ? wholeLineupUtility / ceiling : 1;
    qualityRows.push(qualityRatio);
    if (qualityRatio >= QUALITY_THRESHOLD) strongPaths += 1;
    cashAfterRows.push(context.cash - solution.minimumCost);
  }
  const completionProbability = round1(legalCompletions / sampleCount * 100);
  const strongPathProbability = round1(strongPaths / sampleCount * 100);
  const status = statusFor({
    completionProbability,
    strongPathProbability,
    missingStarters: context.missingStarters,
    lanes,
    historicalTargetAdditions: targetAdditions,
    openSlots: context.openSlots,
  });
  const weakestLane = [...lanes]
    .filter((lane) => lane.needed > 0)
    .sort((left, right) => {
      const leftMargin = left.viable - left.needed;
      const rightMargin = right.viable - right.needed;
      return leftMargin - rightMargin || right.plannedDollars - left.plannedDollars || left.position.localeCompare(right.position);
    })[0] || null;
  return {
    schemaVersion: 1,
    modelVersion: "roster-safety-20260811-v1",
    modelEffect: "advisory_only",
    bidAuthority: "none",
    samples: sampleCount,
    qualityThreshold: QUALITY_THRESHOLD,
    completionProbability,
    strongPathProbability,
    status,
    missingStarters: context.missingStarters,
    cash: context.cash,
    openSlots: context.openSlots,
    deterministicFeasible: deterministic.feasible,
    plannedStarterUtility: deterministic.utility === null ? null : context.committedStarterUtility + deterministic.utility,
    committedStarterUtility: context.committedStarterUtility,
    availableStarterCeiling: Number.isFinite(ceiling) ? ceiling : null,
    plannedCost: deterministic.cost,
    minimumCompletionCost: deterministic.minimumCost,
    plannedCashAfter: deterministic.feasible ? context.cash - deterministic.cost : null,
    minimumCashAfter: deterministic.feasible ? context.cash - deterministic.minimumCost : null,
    medianCashAfter: legalCompletions ? Math.round(quantile(cashAfterRows, 0.5)) : null,
    cashAfterRange80: legalCompletions ? {
      low: Math.round(quantile(cashAfterRows, 0.1)),
      high: Math.round(quantile(cashAfterRows, 0.9)),
    } : null,
    medianQualityRatio: qualityRows.length ? round1(quantile(qualityRows, 0.5) * 100) : null,
    plannedPlayers: deterministic.players.map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      price: player.price,
    })),
    lanes,
    weakestPosition: weakestLane?.position || null,
    hypotheticalPurchase: context.purchase ? {
      playerId: context.purchase.player.id,
      playerName: context.purchase.player.name,
      price: context.purchase.price,
    } : null,
    explanation: "Market and position shocks are simulated, then an exact cash-constrained starter portfolio is solved under current player caps. This never changes VBD, market prices, or hard stops.",
  };
}
