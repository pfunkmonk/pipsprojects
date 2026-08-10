export const PRIORITY_WEIGHT_MIN = 0.5;
export const PRIORITY_WEIGHT_MAX = 2;
export const PRIORITY_SCENARIO_MODES = Object.freeze(["baseline", "live"]);
export const BASELINE_PRIORITY_SCENARIO = Object.freeze({
  mode: "baseline",
  baseline: 1,
  division: 1,
  playoffs: 1,
});
export const DEFAULT_PRIORITY_SCENARIO = Object.freeze({
  mode: "live",
  baseline: 1,
  division: 1.2,
  playoffs: 1.5,
});
export const RECOMMENDED_PRIORITY_SCENARIO = Object.freeze({
  mode: "live",
  baseline: 1,
  division: 1.2,
  playoffs: 1.5,
});
export const PRIORITY_EDGE_POLICY = Object.freeze({
  forecastAuthority: 0.35,
  maxVbdDelta: 3,
  rationale: "2015/2017/2018/2023 timing calibration supports 35% forecast authority; schedule remains a replacement-relative, capped tie-breaker.",
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
  if (!PRIORITY_SCENARIO_MODES.includes(mode)) throw new RangeError("Priority mode must be baseline or live.");
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
  const activeGames = points.filter((value) => value != null).length;
  if (activeGames !== 17) {
    return Object.freeze({ available: false, projectedPoints: baseline, delta: 0, scenario });
  }
  let weightedPoints = 0;
  let totalWeights = 0;
  // Thunder Bowl ends in Week 17. Week 18 has no league utility, while a bye in
  // Weeks 1-17 must count as zero instead of being normalized away.
  for (let week = 1; week <= 17; week += 1) {
    const weight = priorityWeightForWeek(week, scenario, weeklyContext);
    weightedPoints += Number(points[week - 1] ?? 0) * weight;
    totalWeights += weight;
  }
  if (totalWeights <= 0) {
    return Object.freeze({ available: false, projectedPoints: baseline, delta: 0, scenario });
  }
  const projectedPoints = weightedPoints / totalWeights * 17;
  return Object.freeze({
    available: true,
    projectedPoints,
    delta: projectedPoints - baseline,
    scenario,
  });
}

function validateEdgePolicy(input = PRIORITY_EDGE_POLICY) {
  const forecastAuthority = Number(input.forecastAuthority);
  const maxVbdDelta = Number(input.maxVbdDelta);
  if (!Number.isFinite(forecastAuthority) || forecastAuthority < 0 || forecastAuthority > 1) {
    throw new RangeError("Schedule forecast authority must be from 0 through 1.");
  }
  if (!Number.isFinite(maxVbdDelta) || maxVbdDelta < 0 || maxVbdDelta > 10) {
    throw new RangeError("Schedule VBD cap must be from 0 through 10 points.");
  }
  return { forecastAuthority, maxVbdDelta };
}

export function buildPriorityVbdOverlay(players, scenarioInput, weeklyContext, policyInput = PRIORITY_EDGE_POLICY) {
  if (!Array.isArray(players)) throw new TypeError("Players must be an array.");
  const scenario = validatePriorityScenario(scenarioInput);
  const policy = validateEdgePolicy(policyInput);
  const rows = players.map((player) => {
    const vbd = Number(player?.vbd);
    if (!Number.isFinite(vbd)) throw new TypeError("Every player must have numeric VBD.");
    const priority = priorityProjection(player, scenario, weeklyContext);
    const authorizedDelta = scenario.mode === "live" && priority.available
      ? priority.delta * policy.forecastAuthority
      : 0;
    return { player, vbd, priority, authorizedDelta };
  });
  const replacementByPosition = new Map();
  for (const position of new Set(rows.map((row) => row.player.position))) {
    const positionRows = rows.filter((row) => row.player.position === position);
    const replacementRank = Math.max(1, positionRows.filter((row) => row.vbd >= 0).length);
    const baseOrdered = [...positionRows].sort((left, right) =>
      Number(right.player.projectedPoints) - Number(left.player.projectedPoints)
      || left.player.id.localeCompare(right.player.id));
    const boundedVbd = (row, center) => row.vbd + Math.max(
      -policy.maxVbdDelta,
      Math.min(policy.maxVbdDelta, row.authorizedDelta - center),
    );
    const replacementVbdAt = (center) => [...positionRows]
      .map((row) => boundedVbd(row, center))
      .sort((left, right) => right - left)[replacementRank - 1];
    const deltas = positionRows.map((row) => row.authorizedDelta);
    let low = Math.min(...deltas) - policy.maxVbdDelta - 1;
    let high = Math.max(...deltas) + policy.maxVbdDelta + 1;
    // Solve for the positional correction at which the live replacement player
    // remains exactly VBD 0. This fixed point prevents capped schedule deltas
    // from silently moving the replacement line or creating positional value.
    for (let step = 0; step < 80; step += 1) {
      const middle = (low + high) / 2;
      if (replacementVbdAt(middle) > 0) low = middle;
      else high = middle;
    }
    const scheduleCenter = (low + high) / 2;
    replacementByPosition.set(position, {
      rank: replacementRank,
      basePoints: Number(baseOrdered[replacementRank - 1]?.player.projectedPoints) || 0,
      scheduleCenter,
    });
  }
  return Object.fromEntries(rows.map(({ player, vbd, priority, authorizedDelta }) => {
    const replacement = replacementByPosition.get(player.position) || { basePoints: 0, scheduleCenter: 0 };
    const rawRelativeDelta = authorizedDelta - replacement.scheduleCenter;
    const boundedDelta = Math.max(-policy.maxVbdDelta, Math.min(policy.maxVbdDelta, rawRelativeDelta));
    const vbdDelta = scenario.mode === "live" ? Math.round(boundedDelta * 10) / 10 : 0;
    const adjustedVbd = Math.round((vbd + vbdDelta) * 10) / 10;
    const adjustedProjectedPoints = scenario.mode === "live"
      ? Math.round((replacement.basePoints + adjustedVbd) * 10) / 10
      : Number(player.projectedPoints);
    return [player.id, Object.freeze({
      available: priority.available,
      applied: scenario.mode === "live",
      baseVbd: vbd,
      adjustedVbd,
      vbdDelta,
      adjustedProjectedPoints,
      rawPriorityDelta: Math.round(priority.delta * 10) / 10,
      replacementPriorityDelta: Math.round(replacement.scheduleCenter * 10) / 10,
      scenario,
      policy,
    })];
  }));
}

export function applyPriorityVbdOverlay(pack, overlay) {
  if (!pack?.players || !Array.isArray(pack.players)) throw new TypeError("Draft pack players are required.");
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) throw new TypeError("Priority VBD overlay is required.");
  return {
    ...pack,
    players: pack.players.map((player) => {
      const adjustment = overlay[player.id];
      if (!adjustment?.applied || adjustment.scenario?.mode !== "live") return player;
      return {
        ...player,
        projectedPoints: adjustment.adjustedProjectedPoints,
        vbd: adjustment.adjustedVbd,
      };
    }),
  };
}
