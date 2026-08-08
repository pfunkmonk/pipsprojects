export const PRIORITY_WEIGHT_MIN = 0.5;
export const PRIORITY_WEIGHT_MAX = 2;
export const PRIORITY_SCENARIO_MODES = Object.freeze(["baseline", "experimental"]);
export const DEFAULT_PRIORITY_SCENARIO = Object.freeze({
  mode: "baseline",
  baseline: 1,
  division: 1,
  playoffs: 1,
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

