const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;
const DEFAULT_POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "K", "DST"]);

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite.`);
  return number;
}

function wholeNumber(value, label, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`${label} must be a whole number of at least ${minimum}.`);
  return number;
}

function matrix(rows, columns) {
  return Array.from({ length: rows }, () => {
    const values = new Float64Array(columns);
    values.fill(NEGATIVE_INFINITY);
    return values;
  });
}

function normalizedInputs({ players, candidateId, cash, openSlots, positionCounts, starterRequirements }) {
  if (!Array.isArray(players) || !players.length) throw new Error("Thunder Value requires an available player pool.");
  if (typeof candidateId !== "string" || !candidateId.trim()) throw new Error("Thunder Value requires a candidate player id.");
  const normalizedCash = wholeNumber(cash, "Cash", 1);
  const normalizedSlots = wholeNumber(openSlots, "Open slots", 1);
  if (normalizedCash < normalizedSlots) throw new Error("Cash must preserve at least $1 for every open slot.");
  const positions = Object.keys(starterRequirements || {});
  if (!positions.length || positions.some((position) => !DEFAULT_POSITIONS.includes(position))) {
    throw new Error("Thunder Value requires the supported starter positions.");
  }
  const ids = new Set();
  const normalizedPlayers = players.map((player, index) => {
    if (!player || typeof player !== "object" || Array.isArray(player)) throw new Error(`Player ${index + 1} must be an object.`);
    const id = String(player.id || "").trim();
    if (!id) throw new Error(`Player ${index + 1} requires an id.`);
    if (ids.has(id)) throw new Error(`Thunder Value player id '${id}' is duplicated.`);
    ids.add(id);
    const position = String(player.position || "").toUpperCase();
    if (!positions.includes(position)) throw new Error(`${id} has unsupported position '${position}'.`);
    return {
      id,
      position,
      price: wholeNumber(player.price, `${id} expected price`, 1),
      utility: Math.max(0, finiteNumber(player.utility, `${id} utility`)),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const candidate = normalizedPlayers.find((player) => player.id === candidateId);
  if (!candidate) throw new Error("Thunder Value candidate is not in the available player pool.");
  const needs = {};
  for (const position of positions) {
    const required = wholeNumber(starterRequirements[position], `${position} starter requirement`, 0);
    const filled = wholeNumber(positionCounts?.[position] ?? 0, `${position} roster count`, 0);
    needs[position] = Math.max(0, required - filled);
  }
  if (Object.values(needs).reduce((sum, value) => sum + value, 0) > normalizedSlots) {
    throw new Error("Open slots cannot satisfy the remaining starter requirements.");
  }
  return {
    players: normalizedPlayers,
    candidate,
    cash: normalizedCash,
    openSlots: normalizedSlots,
    positions,
    needs,
  };
}

function positionFrontiers(players, positions, maxSlots, budget) {
  const grouped = new Map(positions.map((position) => [position, []]));
  for (const player of players) grouped.get(player.position).push(player);
  const frontiers = new Map();
  for (const position of positions) {
    const dp = matrix(maxSlots + 1, budget + 1);
    dp[0][0] = 0;
    for (const player of grouped.get(position)) {
      if (player.price > budget) continue;
      for (let count = maxSlots; count >= 1; count -= 1) {
        const current = dp[count];
        const previous = dp[count - 1];
        for (let spent = budget; spent >= player.price; spent -= 1) {
          const prior = previous[spent - player.price];
          if (prior === NEGATIVE_INFINITY) continue;
          const utility = prior + player.utility;
          if (utility > current[spent]) current[spent] = utility;
        }
      }
    }
    frontiers.set(position, dp);
  }
  return frontiers;
}

function completionUtilityByBudget(frontiers, positions, slots, needs, budget) {
  if (slots < 0 || budget < 0) return null;
  let combined = matrix(slots + 1, budget + 1);
  combined[0][0] = 0;
  let processedMinimum = 0;
  for (const position of positions) {
    const required = needs[position] || 0;
    processedMinimum += required;
    const positionDp = frontiers.get(position);
    const next = matrix(slots + 1, budget + 1);
    for (let priorSlots = 0; priorSlots <= slots; priorSlots += 1) {
      const priorRow = combined[priorSlots];
      for (let priorSpent = 0; priorSpent <= budget; priorSpent += 1) {
        const priorUtility = priorRow[priorSpent];
        if (priorUtility === NEGATIVE_INFINITY) continue;
        const maxPositionSlots = slots - priorSlots;
        for (let positionSlots = required; positionSlots <= maxPositionSlots; positionSlots += 1) {
          const positionRow = positionDp[positionSlots];
          for (let positionSpent = 0; positionSpent + priorSpent <= budget; positionSpent += 1) {
            const positionUtility = positionRow[positionSpent];
            if (positionUtility === NEGATIVE_INFINITY) continue;
            const totalSlots = priorSlots + positionSlots;
            const totalSpent = priorSpent + positionSpent;
            const utility = priorUtility + positionUtility;
            if (utility > next[totalSlots][totalSpent]) next[totalSlots][totalSpent] = utility;
          }
        }
      }
    }
    combined = next;
    if (processedMinimum > slots) return null;
  }
  const exact = combined[slots];
  const withinBudget = new Float64Array(budget + 1);
  withinBudget.fill(NEGATIVE_INFINITY);
  let best = NEGATIVE_INFINITY;
  for (let available = 0; available <= budget; available += 1) {
    best = Math.max(best, exact[available]);
    withinBudget[available] = best;
  }
  return withinBudget;
}

function rounded(value) {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}

export function calculateThunderValue(input) {
  const { players, candidate, cash, openSlots, positions, needs } = normalizedInputs(input);
  const alternatives = players.filter((player) => player.id !== candidate.id);
  const frontiers = positionFrontiers(alternatives, positions, openSlots, cash);
  const withoutByBudget = completionUtilityByBudget(frontiers, positions, openSlots, needs, cash);
  const bestWithout = withoutByBudget?.[cash] ?? NEGATIVE_INFINITY;
  const forcedNeeds = { ...needs, [candidate.position]: Math.max(0, needs[candidate.position] - 1) };
  const forcedByBudget = completionUtilityByBudget(frontiers, positions, openSlots - 1, forcedNeeds, cash);
  const legalMaximum = cash - (openSlots - 1);
  let thunderCeiling = 0;
  for (let bid = 1; bid <= legalMaximum; bid += 1) {
    const completion = forcedByBudget?.[cash - bid] ?? NEGATIVE_INFINITY;
    if (completion === NEGATIVE_INFINITY) continue;
    const forcedUtility = candidate.utility + completion;
    if (bestWithout === NEGATIVE_INFINITY || forcedUtility + 1e-9 >= bestWithout) thunderCeiling = bid;
  }
  const expectedPrice = candidate.price;
  const expectedCompletion = expectedPrice <= legalMaximum
    ? forcedByBudget?.[cash - expectedPrice] ?? NEGATIVE_INFINITY
    : NEGATIVE_INFINITY;
  const forcedAtExpected = expectedCompletion === NEGATIVE_INFINITY
    ? NEGATIVE_INFINITY
    : candidate.utility + expectedCompletion;
  const edgeAtExpected = bestWithout === NEGATIVE_INFINITY || forcedAtExpected === NEGATIVE_INFINITY
    ? null
    : forcedAtExpected - bestWithout;
  const requiredToComplete = bestWithout === NEGATIVE_INFINITY && thunderCeiling > 0;
  return {
    candidateId: candidate.id,
    position: candidate.position,
    expectedPrice,
    candidatePositiveVbd: rounded(candidate.utility),
    bestWithoutUtility: rounded(bestWithout),
    forcedAtExpectedUtility: rounded(forcedAtExpected),
    edgeAtExpected: rounded(edgeAtExpected),
    thunderCeiling,
    dollarEdge: thunderCeiling > 0 ? thunderCeiling - expectedPrice : null,
    legalMaximum,
    expectedPriceFeasible: expectedCompletion !== NEGATIVE_INFINITY,
    requiredToComplete,
    authority: "experimental_no_bid_effect",
  };
}
