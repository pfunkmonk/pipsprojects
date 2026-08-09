export const PREMIUM_PROJECTION_SOURCES = Object.freeze(["Footballguys", "CBS", "FantasyPros"]);

// Comparable preseason point accuracy is limited to one clean, paired FBG/CBS
// season. FantasyPros has no like-for-like archive, so it receives the neutral
// midpoint error rather than an invented advantage. Inverse-MAE weighting makes
// the requested accuracy tilt explicit while keeping it appropriately small.
export const PROJECTION_SOURCE_ACCURACY = Object.freeze({
  Footballguys: Object.freeze({ mae: 45.33767, evidence: "2023 paired Thunder-scored preseason audit", direct: true }),
  CBS: Object.freeze({ mae: 46.376408, evidence: "2023 paired Thunder-scored preseason audit", direct: true }),
  FantasyPros: Object.freeze({ mae: 45.857039, evidence: "neutral midpoint pending comparable archive", direct: false }),
});

export const PROJECTION_LAB_MODEL = Object.freeze({
  id: "tb-accuracy-consensus-20260809-v1",
  authority: "primary_projection",
  sourceHistory: "FBG/CBS 2023 paired audit plus 2022-2025 time-forward ensemble surrogate",
  pairedRows: 412,
  surrogateRows: 1153,
  bestSinglePairedMae: 45.3377,
  pairedConsensusMae: 44.6527,
  rawPrimarySurrogateMae: 41.748,
  equalBlendSurrogateMae: 41.041,
  livePromotionEligible: true,
  automaticCorrectionPolicy: "Only corrections that clear the production gate may alter points; none currently qualify.",
});

function finite(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function sourceRows(player) {
  const rows = Array.isArray(player?.projectionSources) ? player.projectionSources : [];
  return PREMIUM_PROJECTION_SOURCES.map((source) => {
    const row = rows.find((candidate) => candidate?.source === source);
    const points = finite(row?.points);
    return points === null || points < 0 ? null : { source, points, asOf: row.asOf, role: row.role };
  }).filter(Boolean);
}

export function projectionSourceWeights(sources = PREMIUM_PROJECTION_SOURCES) {
  const available = [...new Set(sources)].filter((source) => PROJECTION_SOURCE_ACCURACY[source]);
  if (!available.length) return {};
  const inverse = Object.fromEntries(available.map((source) => [source, 1 / PROJECTION_SOURCE_ACCURACY[source].mae]));
  const total = Object.values(inverse).reduce((sum, value) => sum + value, 0);
  return Object.freeze(Object.fromEntries(available.map((source) => [source, inverse[source] / total])));
}

export function weightedProjectionConsensus(sourcePoints) {
  const supplied = Object.entries(sourcePoints || {})
    .map(([source, value]) => [source, finite(value)])
    .filter(([source, value]) => PROJECTION_SOURCE_ACCURACY[source] && value !== null && value >= 0);
  if (!supplied.length) return null;
  const weights = projectionSourceWeights(supplied.map(([source]) => source));
  return supplied.reduce((sum, [source, value]) => sum + value * weights[source], 0);
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
  const primary = (player.projectionSources || []).find((source) => source.modelEffect === "primary_projection");
  const currentPoints = finite(primary?.points) ?? finite(player.projectedPoints) ?? 0;
  if (!rows.length) {
    return {
      model: PROJECTION_LAB_MODEL,
      status: "fallback_current_primary",
      sourceCoverage: 0,
      requiredSources: PREMIUM_PROJECTION_SOURCES.length,
      sources: [],
      currentPrimary: { source: primary?.source || "Current pack", points: round1(currentPoints) },
      consensus: round1(currentPoints),
      modified: round1(currentPoints),
      automaticCorrectionDelta: 0,
      sourceRange: null,
      weekly: null,
      warning: "No premium source is available; the current validated projection is preserved.",
      valueEffect: primary?.source === "Thunder Bowl Consensus" ? "primary_projection" : "fallback",
    };
  }

  const pointsBySource = Object.fromEntries(rows.map((row) => [row.source, row.points]));
  const weights = projectionSourceWeights(rows.map((row) => row.source));
  const consensus = weightedProjectionConsensus(pointsBySource);
  const modified = consensus;
  const weeklyPoints = player.weeklyProjection?.points;
  const weekly = scaledWeekly(weeklyPoints, currentPoints, modified);
  const weekTotal = (weeks) => round1(weeks.reduce((sum, week) => sum + (weekly?.[week - 1] ?? 0), 0));
  const isLive = primary?.source === "Thunder Bowl Consensus";
  return {
    model: PROJECTION_LAB_MODEL,
    status: rows.length === PREMIUM_PROJECTION_SOURCES.length ? "complete_three_source" : rows.length >= 2 ? "partial_consensus" : "single_source",
    sourceCoverage: rows.length,
    requiredSources: PREMIUM_PROJECTION_SOURCES.length,
    sources: rows.map((row) => ({ ...row, points: round1(row.points), weight: weights[row.source] })),
    currentPrimary: { source: primary?.source || "Current pack", points: round1(currentPoints) },
    consensus: round1(consensus),
    modified: round1(modified),
    automaticCorrectionDelta: 0,
    sourceRange: {
      low: round1(Math.min(...rows.map((row) => row.points))),
      high: round1(Math.max(...rows.map((row) => row.points))),
    },
    weekly: weekly ? {
      points: weekly,
      seasonTotal: round1(weekly.reduce((sum, value) => sum + (value ?? 0), 0)),
      divisionTotal: weekTotal(divisionWeeks),
      playoffTotal: weekTotal(playoffWeeks),
      effectOnSeasonTotal: 0,
      note: "Weekly evidence redistributes the consensus total; it does not manufacture points.",
    } : null,
    rejectedAutomaticAdjustments: ["mean reversion", "durability", "weather", "schedule total-point boost", "case-based analog"],
    warning: "Accuracy weights are deliberately near equal. Every tested automatic correction that failed its production gate remains value-neutral.",
    valueEffect: isLive ? "primary_projection" : "candidate_ready",
  };
}
