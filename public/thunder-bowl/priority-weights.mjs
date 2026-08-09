export const PRIORITY_WEIGHT_MIN = 0.5;
export const PRIORITY_WEIGHT_MAX = 2;
export const PRIORITY_SCENARIO_MODES = Object.freeze(["baseline", "experimental"]);
export const DEFAULT_PRIORITY_SCENARIO = Object.freeze({
  mode: "baseline",
  baseline: 1,
  division: 1,
  playoffs: 1,
});
export const RECOMMENDED_PRIORITY_SCENARIO = Object.freeze({
  mode: "experimental",
  baseline: 1,
  division: 1.2,
  playoffs: 1.4,
});
export const PRIORITY_EDGE_POLICY = Object.freeze({
  forecastAuthority: 0.25,
  maxVbdDelta: 3,
  replacementSampleSize: 5,
  rationale: "Preseason schedule forecasts are noisy; use schedule as a bounded tie-breaker, not a primary projection.",
});

function finiteWeight(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < PRIORITY_WEIGHT_MIN || number > PRIORITY_WEIGHT_MAX) {
    throw new RangeError(`${label} weight must be from 0.50 through 2.00.`);
  }
  return Math.round(number * 100) / 100;
}

export function validatePriorityScenario(input = DEFAULT_PRIORITY_SCENARIO) {
  const mode = String(input?.mode || "");
  if (!PRIORITY_SCENARIO_MODES.includes(mode)) throw new RangeError("Priority mode must be baseline or experimental.");
  return Object.freeze({
    mode,
    baseline: finiteWeight(input.baseline, "Ordinary-week"),
    division: finiteWeight(input.division, "Division-week"),
    playoffs: finiteWeight(input.playoffs, "Playoff-week"),
  });
}

export function priorityWeightForWeek(week, scenario, weeklyContext) {
  if (weeklyContext.playoffWeeks.includes(week)) return scenario.playoffs;
  if (weeklyContext.divisionWeeks.includes(week)) return scenario.division;
  return scenario.baseline;
}

export function priorityProjection(player, scenarioInput, weeklyContext) {
  const scenario = validatePriorityScenario(scenarioInput);
  const baseline = Number(player?.projectedPoints);
  if (!Number.isFinite(baseline)) throw new TypeError("Player projectedPoints must be numeric.");
  if (scenario.mode === "baseline") {
    return Object.freeze({ available: Boolean(player?.weeklyProjection), projectedPoints: baseline, delta: 0, scenario });
  }
  const points = player?.weeklyProjection?.points;
  if (!weeklyContext || !Array.isArray(points) || points.length !== 18) {
    return Object.freeze({ available: false, projectedPoints: baseline, delta: 0, scenario });
  }
  let weightedPoints = 0;
  let totalWeights = 0;
  let games = 0;
  points.forEach((pointsForWeek, index) => {
    if (pointsForWeek == null) return;
    const weight = priorityWeightForWeek(index + 1, scenario, weeklyContext);
    weightedPoints += Number(pointsForWeek) * weight;
    totalWeights += weight;
    games += 1;
  });
  if (games !== 17 || totalWeights <= 0) {
    return Object.freeze({ available: false, projectedPoints: baseline, delta: 0, scenario });
  }
  const projectedPoints = weightedPoints / totalWeights * games;
  return Object.freeze({
    available: true,
    projectedPoints,
    delta: projectedPoints - baseline,
    scenario,
  });
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validateEdgePolicy(input = PRIORITY_EDGE_POLICY) {
  const forecastAuthority = Number(input.forecastAuthority);
  const maxVbdDelta = Number(input.maxVbdDelta);
  const replacementSampleSize = Number(input.replacementSampleSize);
  if (!Number.isFinite(forecastAuthority) || forecastAuthority < 0 || forecastAuthority > 1) {
    throw new RangeError("Schedule forecast authority must be from 0 through 1.");
  }
  if (!Number.isFinite(maxVbdDelta) || maxVbdDelta < 0 || maxVbdDelta > 10) {
    throw new RangeError("Schedule VBD cap must be from 0 through 10 points.");
  }
  if (!Number.isSafeInteger(replacementSampleSize) || replacementSampleSize < 1 || replacementSampleSize > 20) {
    throw new RangeError("Replacement sample size must be a whole number from 1 through 20.");
  }
  return { forecastAuthority, maxVbdDelta, replacementSampleSize };
}

export function buildPriorityVbdOverlay(players, scenarioInput, weeklyContext, policyInput = PRIORITY_EDGE_POLICY) {
  if (!Array.isArray(players)) throw new TypeError("Players must be an array.");
  const scenario = validatePriorityScenario(scenarioInput);
  const policy = validateEdgePolicy(policyInput);
  const rows = players.map((player) => {
    const vbd = Number(player?.vbd);
    if (!Number.isFinite(vbd)) throw new TypeError("Every player must have numeric VBD.");
    const priority = priorityProjection(player, scenario, weeklyContext);
    return { player, vbd, priority };
  });
  const replacementDeltaByPosition = new Map();
  for (const position of new Set(rows.map((row) => row.player.position))) {
    const ordered = rows
      .filter((row) => row.player.position === position && row.priority.available)
      .sort((left, right) => Math.abs(left.vbd) - Math.abs(right.vbd) || left.player.id.localeCompare(right.player.id));
    const closestReplacementDistance = Math.abs(ordered[0]?.vbd ?? 0);
    const replacementSample = ordered
      .filter((row) => Math.abs(row.vbd) <= closestReplacementDistance + 5)
      .slice(0, policy.replacementSampleSize);
    replacementDeltaByPosition.set(position, median(replacementSample.map((row) => row.priority.delta)));
  }
  return Object.fromEntries(rows.map(({ player, vbd, priority }) => {
    const replacementDelta = replacementDeltaByPosition.get(player.position) || 0;
    const rawRelativeDelta = priority.available ? priority.delta - replacementDelta : 0;
    const boundedDelta = Math.max(-policy.maxVbdDelta, Math.min(policy.maxVbdDelta, rawRelativeDelta * policy.forecastAuthority));
    const vbdDelta = scenario.mode === "experimental" ? Math.round(boundedDelta * 10) / 10 : 0;
    return [player.id, Object.freeze({
      available: priority.available,
      baseVbd: vbd,
      adjustedVbd: Math.round((vbd + vbdDelta) * 10) / 10,
      vbdDelta,
      adjustedProjectedPoints: Math.round((Number(player.projectedPoints) + vbdDelta) * 10) / 10,
      rawPriorityDelta: Math.round(priority.delta * 10) / 10,
      replacementPriorityDelta: Math.round(replacementDelta * 10) / 10,
      scenario,
      policy,
    })];
  }));
}
