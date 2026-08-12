import { validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";
import { projectionSourceWeights, weightedProjectionConsensus } from "../public/thunder-bowl/projection-lab.mjs";

export const PROJECTION_HANDOFF_KIND = "thunder-bowl-projection-handoff-v1";
export const PROJECTION_HANDOFF_AUTHORITY = "candidate_only";
export const PROJECTION_PRIMARY_SOURCE = "Thunder Bowl Consensus";
export const PROJECTION_SCORING_FINGERPRINT = "tb26-ppr-6pt-pass-td-minus2-int-2pt-sack-50fg-v1";
export const PREMIUM_PROJECTION_SOURCES = ["Footballguys", "CBS", "FantasyPros"];
export const WEEK_COLUMNS = Array.from({ length: 18 }, (_, index) => `wk${index + 1}`);
export const PROJECTION_HANDOFF_COLUMNS = [
  "pack_player_id", "player_name", "position", "nfl_team", "fbg_id", "cbs_id",
  "fantasypros_id", "gsis_id",
  "model_id", "source_as_of", "exported_at", "scoring_fingerprint", "authority",
  "fbg_points", "cbs_points", "fantasypros_points", "raw_consensus_points",
  "mean_reversion_delta", "within_position_delta", "season_context_delta",
  "durability_delta", "availability_delta", "modified_projection_points",
  "uncertainty_low", "uncertainty_high", "fallback_reason", ...WEEK_COLUMNS,
];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function finite(value, label, { nullable = false, minimum = 0, maximum = 1000 } = {}) {
  if (nullable && (value === "" || value == null)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) fail("INVALID_PROJECTION_NUMBER", `${label} must be from ${minimum} through ${maximum}.`);
  return number;
}

function text(value, label, { minimum = 1, maximum = 160, nullable = false } = {}) {
  if (nullable && (value === "" || value == null)) return "";
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) fail("INVALID_PROJECTION_TEXT", `${label} must be ${minimum}-${maximum} characters.`);
  return result;
}

function timestamp(value, label) {
  const result = text(value, label, { minimum: 10, maximum: 40 });
  if (!Number.isFinite(Date.parse(result)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(result)) fail("INVALID_PROJECTION_TIMESTAMP", `${label} must include a timezone.`);
  return new Date(result).toISOString();
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function normalizedTeam(team) {
  return ({ ARZ: "ARI", JAC: "JAX", LA: "LAR" })[team] || team;
}

function csvCell(value) {
  const string = value == null ? "" : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value);
  return cells;
}

export function projectionRowsToCsv(rows) {
  return `${PROJECTION_HANDOFF_COLUMNS.join(",")}\n${rows.map((row) => PROJECTION_HANDOFF_COLUMNS.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

export function parseProjectionHandoffCsv(input) {
  const lines = String(input || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length);
  if (lines.length < 2) fail("EMPTY_PROJECTION_HANDOFF", "Projection handoff must contain a header and player rows.");
  const header = parseCsvLine(lines[0]);
  if (header.join("|") !== PROJECTION_HANDOFF_COLUMNS.join("|")) fail("PROJECTION_HANDOFF_COLUMNS", "Projection handoff columns changed or are out of order.");
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    if (cells.length !== header.length) fail("PROJECTION_HANDOFF_ROW", `Projection handoff row ${index + 2} has ${cells.length} cells, not ${header.length}.`);
    return Object.fromEntries(header.map((column, cellIndex) => [column, cells[cellIndex]]));
  });
}

function sourcePoint(player, source) {
  return player.projectionSources?.find((row) => row.source === source)?.points ?? "";
}

export function createProjectionHandoffTemplateRows(packInput, {
  modelId = "replace-with-immutable-model-id",
  sourceAsOf = "",
  exportedAt = "",
  sourceIdsByPlayerId = {},
} = {}) {
  const pack = validateDraftPack(packInput);
  return pack.players.map((player) => {
    const values = PREMIUM_PROJECTION_SOURCES.map((source) => sourcePoint(player, source)).filter((value) => value !== "");
    const consensus = values.length ? round1(weightedProjectionConsensus({
      Footballguys: sourcePoint(player, "Footballguys"),
      CBS: sourcePoint(player, "CBS"),
      FantasyPros: sourcePoint(player, "FantasyPros"),
    })) : player.projectedPoints;
    const ids = sourceIdsByPlayerId[player.id] || {};
    return {
      pack_player_id: player.id,
      player_name: player.name,
      position: player.position,
      nfl_team: player.nflTeam,
      fbg_id: ids.fbgId || (player.id.startsWith("fbg:") ? player.id.slice(4) : ""),
      cbs_id: ids.cbsId || (player.id.startsWith("cbs:") ? player.id.slice(4) : ""),
      fantasypros_id: ids.fantasyProsId || "",
      gsis_id: ids.gsisId || "",
      model_id: modelId,
      source_as_of: sourceAsOf,
      exported_at: exportedAt,
      scoring_fingerprint: PROJECTION_SCORING_FINGERPRINT,
      authority: PROJECTION_HANDOFF_AUTHORITY,
      fbg_points: sourcePoint(player, "Footballguys"),
      cbs_points: sourcePoint(player, "CBS"),
      fantasypros_points: sourcePoint(player, "FantasyPros"),
      raw_consensus_points: consensus,
      mean_reversion_delta: "",
      within_position_delta: "",
      season_context_delta: "",
      durability_delta: "",
      availability_delta: "",
      modified_projection_points: "",
      uncertainty_low: "",
      uncertainty_high: "",
      fallback_reason: values.length >= 2 ? "" : "Document the explicit fallback used",
      ...Object.fromEntries(WEEK_COLUMNS.map((column) => [column, ""])),
    };
  });
}

function validateWeekly(row, modifiedPoints) {
  const raw = WEEK_COLUMNS.map((column) => row[column]);
  if (raw.every((value) => value === "" || value == null)) return null;
  const points = raw.map((value, index) => value === "" || value == null
    ? null
    : finite(value, `${row.player_name} week ${index + 1}`, { maximum: 100 }));
  if (points.filter((value) => value === null).length !== 1) fail("PROJECTION_HANDOFF_WEEKS", `${row.player_name} must have exactly one blank bye week.`);
  const total = points.reduce((sum, value) => sum + (value ?? 0), 0);
  if (Math.abs(total - modifiedPoints) > 0.11) fail("PROJECTION_HANDOFF_WEEK_TOTAL", `${row.player_name}'s weekly points total ${total.toFixed(1)}, not ${modifiedPoints.toFixed(1)}.`);
  return points;
}

export function validateProjectionHandoffRows(rows, packInput) {
  const pack = validateDraftPack(packInput);
  if (!Array.isArray(rows) || rows.length !== pack.players.length) fail("PROJECTION_HANDOFF_COVERAGE", `Projection handoff contains ${rows?.length || 0} rows, not all ${pack.players.length} pack players.`);
  const packById = new Map(pack.players.map((player) => [player.id, player]));
  const seen = new Set();
  const metadata = new Set();
  const validated = rows.map((row, index) => {
    const label = `projection row ${index + 1}`;
    const playerId = text(row.pack_player_id, `${label} pack player id`, { maximum: 100 });
    if (seen.has(playerId)) fail("DUPLICATE_PROJECTION_PLAYER", `${playerId} appears more than once.`);
    seen.add(playerId);
    const player = packById.get(playerId);
    if (!player) fail("UNKNOWN_PROJECTION_PLAYER", `${playerId} does not exist in the active pack.`);
    if (text(row.player_name, `${label} player name`, { maximum: 80 }) !== player.name
      || text(row.position, `${label} position`, { maximum: 3 }) !== player.position
      || normalizedTeam(text(row.nfl_team, `${label} NFL team`, { maximum: 10 }).toUpperCase()) !== normalizedTeam(player.nflTeam)) {
      fail("PROJECTION_PLAYER_IDENTITY", `${player.name}'s handoff identity does not match the active pack.`);
    }
    for (const [column, source] of [["fbg_id", "FBG"], ["cbs_id", "CBS"], ["fantasypros_id", "FantasyPros"], ["gsis_id", "GSIS"]]) {
      const sourceId = text(row[column], `${label} ${source} id`, { minimum: 0, maximum: 80, nullable: true });
      if (sourceId && !/^[a-z0-9:._-]+$/i.test(sourceId)) fail("PROJECTION_SOURCE_ID", `${player.name}'s ${source} id contains unsupported characters.`);
    }
    const modelId = text(row.model_id, `${label} model id`, { minimum: 6, maximum: 80 });
    if (!/^[a-z0-9][a-z0-9._-]+$/i.test(modelId)) fail("PROJECTION_MODEL_ID", `${modelId} is not an immutable-safe model id.`);
    const sourceAsOf = timestamp(row.source_as_of, `${label} source asOf`);
    const exportedAt = timestamp(row.exported_at, `${label} exportedAt`);
    if (Date.parse(exportedAt) < Date.parse(sourceAsOf)) fail("PROJECTION_HANDOFF_TIME", `${player.name} was exported before its source snapshot.`);
    if (row.scoring_fingerprint !== PROJECTION_SCORING_FINGERPRINT || row.authority !== PROJECTION_HANDOFF_AUTHORITY) {
      fail("PROJECTION_HANDOFF_AUTHORITY", `${player.name} has the wrong scoring fingerprint or exceeds candidate-only authority.`);
    }
    metadata.add(`${modelId}|${sourceAsOf}|${exportedAt}`);
    const sourcePoints = {
      Footballguys: finite(row.fbg_points, `${player.name} FBG points`, { nullable: true }),
      CBS: finite(row.cbs_points, `${player.name} CBS points`, { nullable: true }),
      FantasyPros: finite(row.fantasypros_points, `${player.name} FantasyPros points`, { nullable: true }),
    };
    const supplied = Object.values(sourcePoints).filter((value) => value !== null);
    const consensus = finite(row.raw_consensus_points, `${player.name} consensus points`);
    const expectedConsensus = weightedProjectionConsensus(sourcePoints);
    if (supplied.length && Math.abs(consensus - expectedConsensus) > 0.11) {
      fail("PROJECTION_CONSENSUS_MISMATCH", `${player.name}'s raw consensus does not match the registered consensus source model.`);
    }
    const adjustments = {
      meanReversion: finite(row.mean_reversion_delta, `${player.name} mean-reversion delta`, { minimum: -300, maximum: 300 }),
      withinPosition: finite(row.within_position_delta, `${player.name} within-position delta`, { minimum: -300, maximum: 300 }),
      seasonContext: finite(row.season_context_delta, `${player.name} season-context delta`, { minimum: -300, maximum: 300 }),
      durability: finite(row.durability_delta, `${player.name} durability delta`, { minimum: -300, maximum: 300 }),
      availability: finite(row.availability_delta, `${player.name} availability delta`, { minimum: -300, maximum: 300 }),
    };
    const modifiedPoints = finite(row.modified_projection_points, `${player.name} modified projection`);
    const reconciled = consensus + Object.values(adjustments).reduce((sum, value) => sum + value, 0);
    if (Math.abs(modifiedPoints - reconciled) > 0.11) fail("PROJECTION_ADJUSTMENT_MISMATCH", `${player.name}'s adjustments do not reconcile to the modified projection.`);
    const uncertaintyLow = finite(row.uncertainty_low, `${player.name} uncertainty low`);
    const uncertaintyHigh = finite(row.uncertainty_high, `${player.name} uncertainty high`);
    if (uncertaintyLow > modifiedPoints || uncertaintyHigh < modifiedPoints) fail("PROJECTION_INTERVAL", `${player.name}'s uncertainty interval does not contain the projection.`);
    const fallbackReason = text(row.fallback_reason, `${player.name} fallback reason`, { minimum: 0, maximum: 160, nullable: true });
    if (supplied.length < 2 && !fallbackReason) fail("PROJECTION_FALLBACK", `${player.name} needs an explicit fallback reason.`);
    return {
      playerId,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      modelId,
      sourceAsOf,
      exportedAt,
      sourcePoints,
      consensus: round1(consensus),
      adjustments: Object.fromEntries(Object.entries(adjustments).map(([key, value]) => [key, round1(value)])),
      modifiedPoints: round1(modifiedPoints),
      uncertaintyLow: round1(uncertaintyLow),
      uncertaintyHigh: round1(uncertaintyHigh),
      fallbackReason,
      weeklyPoints: validateWeekly(row, modifiedPoints),
    };
  });
  if (metadata.size !== 1) fail("PROJECTION_HANDOFF_METADATA", "Every row must use the same immutable model id and timestamps.");
  return validated;
}

function scaleWeeklyProjection(existing, newTotal) {
  if (!existing) return null;
  const oldTotal = existing.points.reduce((sum, value) => sum + (value ?? 0), 0);
  const targetTenths = Math.round(newTotal * 10);
  const allocations = existing.points.map((value, index) => {
    if (value === null) return null;
    const exactTenths = oldTotal > 0
      ? value / oldTotal * targetTenths
      : targetTenths / Math.max(1, existing.points.filter((point) => point !== null).length);
    return { index, tenths: Math.floor(exactTenths), fraction: exactTenths - Math.floor(exactTenths) };
  });
  let remaining = targetTenths - allocations.reduce((sum, row) => sum + (row?.tenths ?? 0), 0);
  const priority = allocations.filter(Boolean).sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) priority[index % priority.length].tenths += 1;
  const points = existing.points.map((value, index) => value === null ? null : allocations[index].tenths / 10);
  return { ...existing, points, sourceSeasonTotal: newTotal };
}

function recomputeClassicValues(candidate, current) {
  const teamCount = candidate.leagueConfig.teams.length;
  const slots = teamCount * candidate.leagueConfig.rosterSize;
  const totalCap = candidate.leagueConfig.teams.reduce((sum, team) => sum + team.startingCap, 0);
  const baseline = {};
  for (const [position, starters] of Object.entries(candidate.leagueConfig.starterRequirements)) {
    const group = candidate.players.filter((player) => player.position === position)
      .sort((left, right) => right.projectedPoints - left.projectedPoints || left.id.localeCompare(right.id));
    baseline[position] = group[Math.min(group.length, teamCount * starters) - 1]?.projectedPoints ?? 0;
  }
  for (const player of candidate.players) player.vbd = round1(player.projectedPoints - baseline[player.position]);
  const ranked = [...candidate.players].sort((left, right) => Math.max(0, right.vbd) - Math.max(0, left.vbd) || left.id.localeCompare(right.id));
  const purchasable = ranked.slice(0, slots);
  const totalPositive = purchasable.reduce((sum, player) => sum + Math.max(0, player.vbd), 0);
  const exact = purchasable.map((player) => ({ player, value: 1 + (totalPositive ? (totalCap - slots) * Math.max(0, player.vbd) / totalPositive : 0) }));
  const rounded = exact.map((row) => Math.floor(row.value));
  const remainders = exact.map((row, index) => ({ index, fraction: row.value - Math.floor(row.value), id: row.player.id }))
    .sort((left, right) => right.fraction - left.fraction || left.id.localeCompare(right.id));
  for (const { index } of remainders.slice(0, totalCap - rounded.reduce((sum, value) => sum + value, 0))) rounded[index] += 1;
  for (const player of candidate.players) player.intrinsicValue = 1;
  exact.forEach((row, index) => { row.player.intrinsicValue = rounded[index]; });

  const marketById = new Map(candidate.players.map((player) => [player.id, 1]));
  for (const position of Object.keys(candidate.leagueConfig.starterRequirements)) {
    const positiveCandidateCount = candidate.players.filter((player) => player.position === position && player.marketValue > 0).length;
    const curve = current.players
      .filter((player) => player.position === position && player.marketValue > 0)
      .map((player) => player.marketValue)
      .sort((left, right) => right - left)
      .slice(0, positiveCandidateCount);
    const group = candidate.players.filter((player) => player.position === position)
      .sort((left, right) => right.vbd - left.vbd || left.id.localeCompare(right.id));
    group.slice(0, curve.length).forEach((player, index) => marketById.set(player.id, curve[index]));
  }
  for (const player of candidate.players) {
    player.marketValue = marketById.get(player.id) ?? 1;
    player.maxBid = player.marketValue;
  }
  for (const keeper of candidate.keeperCandidates) {
    keeper.marketValue = marketById.get(keeper.playerId) ?? 1;
    keeper.surplus = keeper.keeperYear <= 3 ? keeper.marketValue - keeper.keeperSalary : 0;
  }
}

export function createProjectionCandidatePack(currentInput, handoffRows) {
  const current = validateDraftPack(currentInput);
  const rows = validateProjectionHandoffRows(handoffRows, current);
  const first = rows[0];
  const candidate = structuredClone(current);
  const rowsById = new Map(rows.map((row) => [row.playerId, row]));
  const releaseStamp = first.exportedAt.replace(/\D/g, "").slice(0, 14);
  candidate.packId = `tb26-${first.modelId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "")}-${releaseStamp}`.slice(0, 100);
  candidate.asOf = Date.parse(first.exportedAt) > Date.parse(current.asOf) ? first.exportedAt : current.asOf;
  const primarySource = {
    name: PROJECTION_PRIMARY_SOURCE,
    asOf: first.sourceAsOf,
    authority: "primary projection; Thunder Bowl computes value",
    scoringFingerprint: current.sources[0].scoringFingerprint,
  };
  const existingPrimarySourceIndex = candidate.sources.findIndex((source) => source.name === PROJECTION_PRIMARY_SOURCE);
  if (existingPrimarySourceIndex >= 0) candidate.sources[existingPrimarySourceIndex] = primarySource;
  else candidate.sources.push(primarySource);
  for (const player of candidate.players) {
    const row = rowsById.get(player.id);
    player.projectedPoints = row.modifiedPoints;
    const priorSourcesByName = new Map((player.projectionSources || []).map((source) => [source.source, source]));
    const premiumRows = PREMIUM_PROJECTION_SOURCES
      .filter((source) => row.sourcePoints[source] !== null)
      .map((source) => ({
        ...(priorSourcesByName.get(source) || {}),
        source,
        points: row.sourcePoints[source],
        asOf: first.sourceAsOf,
        role: priorSourcesByName.get(source)?.role || (source === "FantasyPros" ? "supplemental" : "cross-check"),
        modelEffect: "none",
      }));
    const premiumWeights = projectionSourceWeights(premiumRows.map((source) => source.source));
    player.projectionSources = (player.projectionSources || [])
      .filter((source) => source.source !== PROJECTION_PRIMARY_SOURCE && !PREMIUM_PROJECTION_SOURCES.includes(source.source))
      .concat(premiumRows)
      .map((source) => ({
      ...source,
      role: source.role === "primary" ? "cross-check" : source.role,
      modelEffect: "none",
      note: premiumWeights[source.source]
        ? `Included in Thunder Bowl consensus at ${(premiumWeights[source.source] * 100).toFixed(1)}% of available-source weight`
        : source.note,
      }));
    player.projectionSources.push({
      source: PROJECTION_PRIMARY_SOURCE,
      points: row.modifiedPoints,
      asOf: first.sourceAsOf,
      role: "primary",
      modelEffect: "primary_projection",
      note: `Immutable ${first.modelId}; near-equal consensus; limited historical tilt; production-gated adjustments`,
    });
    const sourceSummary = premiumRows
      .map((source) => `${source.source} ${Number(source.points).toFixed(1)}`)
      .join("; ");
    const correction = round1(Object.values(row.adjustments).reduce((sum, value) => sum + value, 0));
    const signedCorrection = `${correction >= 0 ? "+" : ""}${correction.toFixed(1)}`;
    const priorSupplementalNote = String(player.notes || "").match(/Sleeper status is a supplemental fresh flag only; no projection or dollar adjustment applied\.?/i)?.[0] || "";
    player.notes = `${sourceSummary}. Thunder Bowl consensus ${row.modifiedPoints.toFixed(1)} drives VBD; QA-approved automatic correction ${signedCorrection}.${priorSupplementalNote ? ` ${priorSupplementalNote}` : ""}`;
    if (row.weeklyPoints) {
      const byeWeek = row.weeklyPoints.findIndex((value) => value === null) + 1;
      player.weeklyProjection = {
        source: "Thunder Bowl weekly context v3",
        asOf: first.sourceAsOf,
        modelEffect: "none",
        games: 17,
        byeWeek,
        points: row.weeklyPoints,
        sourceSeasonTotal: row.modifiedPoints,
      };
    } else if (player.weeklyProjection) {
      player.weeklyProjection = scaleWeeklyProjection(player.weeklyProjection, row.modifiedPoints);
    }
  }
  recomputeClassicValues(candidate, current);
  return validateDraftPack(candidate);
}
