const PREMIUM_SOURCES = ["Footballguys", "CBS", "FantasyPros"];

export const PROJECTION_LAB_MODEL = Object.freeze({
  id: "tb-projection-surrogate-20260809",
  authority: "candidate_only",
  sourceHistory: "Sleeper and ESPN 2021-2025 time-forward surrogate",
  rows: 1153,
  rawPrimaryMae: 41.748,
  equalBlendMae: 41.041,
  leanMeanReversionMae: 39.456,
  livePromotionEligible: false,
});

const POSITION_CALIBRATION = Object.freeze({
  QB: Object.freeze({ n: 198, intercept: 12.866451, slope: 0.860639, p10: -101.297, p90: 104.933 }),
  RB: Object.freeze({ n: 357, intercept: -2.157168, slope: 0.909122, p10: -55.132, p90: 82.676 }),
  WR: Object.freeze({ n: 556, intercept: 9.94545, slope: 0.781309, p10: -59.545, p90: 69.196 }),
  TE: Object.freeze({ n: 318, intercept: 8.751286, slope: 0.836951, p10: -32.295, p90: 54.089 }),
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function quantile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function sourceRows(player) {
  const rows = Array.isArray(player?.projectionSources) ? player.projectionSources : [];
  return PREMIUM_SOURCES.map((source) => {
    const row = rows.find((candidate) => candidate?.source === source);
    const points = finite(row?.points);
    return points === null || points < 0 ? null : { source, points, asOf: row.asOf, role: row.role };
  }).filter(Boolean);
}

function scaledWeekly(points, oldTotal, newTotal) {
  if (!Array.isArray(points) || points.length !== 18 || oldTotal <= 0 || newTotal < 0) return null;
  const targetTenths = Math.round(newTotal * 10);
  const allocations = points.map((value, index) => {
    if (value === null) return null;
    const exactTenths = Number(value) / oldTotal * targetTenths;
    return { index, tenths: Math.floor(exactTenths), fraction: exactTenths - Math.floor(exactTenths) };
  });
  const live = allocations.filter(Boolean).sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  if (!live.length) return null;
  const remaining = targetTenths - live.reduce((sum, row) => sum + row.tenths, 0);
  for (let index = 0; index < remaining; index += 1) live[index % live.length].tenths += 1;
  return points.map((value, index) => value === null ? null : allocations[index].tenths / 10);
}

export function buildProjectionLabPreview(player, {
  divisionWeeks = [],
  playoffWeeks = [15, 16, 17],
} = {}) {
  if (!player || typeof player !== "object") return null;
  const rows = sourceRows(player);
  const values = rows.map((row) => row.points);
  const primary = (player.projectionSources || []).find((source) => source.modelEffect === "primary_projection");
  const currentPoints = finite(primary?.points) ?? finite(player.projectedPoints) ?? 0;
  if (!values.length) {
    return {
      model: PROJECTION_LAB_MODEL,
      status: "fallback_current_primary",
      sourceCoverage: 0,
      requiredSources: PREMIUM_SOURCES.length,
      sources: [],
      currentPrimary: { source: primary?.source || "Current pack", points: round1(currentPoints) },
      consensus: round1(currentPoints),
      median: round1(currentPoints),
      modified: round1(currentPoints),
      meanReversionDelta: 0,
      interval80: null,
      weekly: null,
      warning: "No premium-source consensus is available; the candidate preserves the current primary projection.",
      valueEffect: "none",
    };
  }

  const consensus = values.reduce((sum, value) => sum + value, 0) / values.length;
  const median = quantile(values, 0.5);
  const calibration = POSITION_CALIBRATION[player.position];
  const canCalibrate = Boolean(calibration && values.length >= 2);
  const modified = canCalibrate
    ? Math.max(0, calibration.intercept + calibration.slope * consensus)
    : consensus;
  const interval80 = canCalibrate ? {
    low: round1(Math.max(0, modified + calibration.p10)),
    high: round1(Math.max(0, modified + calibration.p90)),
    method: "surrogate time-forward residual deciles",
  } : null;

  const weeklyPoints = player.weeklyProjection?.points;
  const weekly = scaledWeekly(weeklyPoints, currentPoints, modified);
  const weekTotal = (weeks) => round1(weeks.reduce((sum, week) => sum + (weekly?.[week - 1] ?? 0), 0));
  return {
    model: PROJECTION_LAB_MODEL,
    status: rows.length === PREMIUM_SOURCES.length ? "complete_three_source" : rows.length >= 2 ? "partial_consensus" : "single_source",
    sourceCoverage: rows.length,
    requiredSources: PREMIUM_SOURCES.length,
    sources: rows.map((row) => ({ ...row, points: round1(row.points) })),
    currentPrimary: { source: primary?.source || "Current pack", points: round1(currentPoints) },
    consensus: round1(consensus),
    median: round1(median),
    sourceRange: round1(Math.max(...values) - Math.min(...values)),
    modified: round1(modified),
    meanReversionDelta: round1(modified - consensus),
    interval80,
    weekly: weekly ? {
      points: weekly,
      seasonTotal: round1(weekly.reduce((sum, value) => sum + (value ?? 0), 0)),
      divisionTotal: weekTotal(divisionWeeks),
      playoffTotal: weekTotal(playoffWeeks),
      effectOnSeasonTotal: 0,
      note: "Matchup, venue, cold climatology, home/away, and short-week evidence redistributes the candidate total; it does not manufacture season points.",
    } : null,
    rejectedAutomaticAdjustments: ["within-position shrink", "season-total context", "second durability haircut", "full feature pile"],
    warning: canCalibrate
      ? "Mean reversion passed a surrogate time-forward gate, but exact FBG/CBS/FantasyPros outcomes do not yet exist. Candidate only."
      : "Insufficient position/source evidence for a calibrated modification; candidate preserves the available consensus.",
    valueEffect: "none",
  };
}
