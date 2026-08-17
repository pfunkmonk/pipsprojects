import { createHash } from "node:crypto";
import { validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";

export const WEEKLY_ASSET_KIND = "thunder-bowl-weekly-assets-v1";
export const WEEKLY_ASSET_SCHEMA_VERSION = 1;
export const WEEKLY_ASSET_SOURCE = "Thunder Bowl weekly assets v1";
export const WEEKLY_ASSET_AUTHORITY = "candidate_only";
export const WEEKLY_ASSET_SCORING_FINGERPRINT = "tb26-ppr-6pt-pass-td-minus2-int-2pt-sack-50fg-v1";
export const PRIORITY_POLICY_RELEASE = "priority-v1-assets-v1";

const METADATA_COLUMNS = [
  "schema_version", "season", "source_name", "model_id", "source_as_of", "exported_at",
  "scoring_fingerprint", "authority", "source_player_id",
];
const ASSET_COLUMNS = [
  "pass_att", "pass_cmp", "pass_yds", "pass_td", "pass_int",
  "rush_att", "rush_yds", "rush_td", "rec", "rec_yds", "rec_td", "fumbles_lost",
  "fg_made", "fg_att", "xp_made", "xp_att", "dst_sacks", "dst_int", "dst_fum_rec",
  "dst_ff", "dst_td", "dst_safety", "dst_pts_allowed", "dst_yds_allowed",
  "kick_ret_yds", "kick_ret_td", "punt_ret_yds", "punt_ret_td",
];
export const WEEKLY_ASSET_COLUMNS = [
  ...METADATA_COLUMNS, "pack_player_id", "player_name", "position", "nfl_team", "week", "is_bye",
  "season_asset_source", "weekly_shape_source", "weekly_share", ...ASSET_COLUMNS,
];
export const SEASON_ASSET_COLUMNS = [
  ...METADATA_COLUMNS, "pack_player_id", "player_name", "position", "nfl_team", "bye",
  "season_asset_source", "weekly_shape_source", ...ASSET_COLUMNS,
];
const FORBIDDEN_VALUE_PATTERN = /(?:^|_)(?:point|points|projected_points|vbd|intrinsic|auction|market|keeper|price|max_bid|recommended_bid)(?:$|_)/i;
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);
const SEASON_SOURCES = new Set(["FBG", "CBS", "FP", "PFF", "BLEND", "NONE"]);
const SHAPE_SOURCES = new Set(["FBG", "CBS", "TEAM", "FLAT"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
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
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else value += character;
  }
  if (quoted) fail("WEEKLY_ASSET_CSV_QUOTE", "Weekly-asset CSV contains an unterminated quoted cell.");
  cells.push(value);
  return cells;
}

function parseCsv(input, expectedColumns, label) {
  const lines = String(input || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length);
  if (lines.length < 2) fail("WEEKLY_ASSET_EMPTY", `${label} must contain a header and data rows.`);
  const header = parseCsvLine(lines[0]);
  if (header.some((column) => FORBIDDEN_VALUE_PATTERN.test(column))) {
    fail("WEEKLY_ASSET_VALUE_AUTHORITY", `${label} attempted to supply a forbidden point or value field.`);
  }
  if (header.join("|") !== expectedColumns.join("|")) {
    fail("WEEKLY_ASSET_COLUMNS", `${label} columns changed or are out of order.`);
  }
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    if (cells.length !== header.length) fail("WEEKLY_ASSET_ROW", `${label} row ${index + 2} has the wrong number of cells.`);
    return Object.fromEntries(header.map((column, cellIndex) => [column, cells[cellIndex]]));
  });
}

function number(value, label, { integer = false, minimum = 0, maximum = 100000 } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum || (integer && !Number.isSafeInteger(result))) {
    fail("WEEKLY_ASSET_NUMBER", `${label} is outside its allowed numeric range.`);
  }
  return result;
}

function timestamp(value, label) {
  const result = String(value || "").trim();
  if (!Number.isFinite(Date.parse(result)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(result)) {
    fail("WEEKLY_ASSET_TIMESTAMP", `${label} must be a timezone-qualified timestamp.`);
  }
  return new Date(result).toISOString();
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizedTeam(team) {
  const upper = String(team || "").trim().toUpperCase();
  return ({ ARZ: "ARI", JAC: "JAX", LA: "LAR" })[upper] || upper;
}

function validateManifest(input, weeklyText, seasonText, playerCount) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("WEEKLY_ASSET_MANIFEST", "Weekly-asset manifest must be an object.");
  if (input.kind !== WEEKLY_ASSET_KIND || input.schema_version !== WEEKLY_ASSET_SCHEMA_VERSION || input.season !== 2026) {
    fail("WEEKLY_ASSET_MANIFEST", "Weekly-asset kind, schema, or season is unsupported.");
  }
  if (input.source_name !== "Thunder Bowl weekly assets" || input.authority !== WEEKLY_ASSET_AUTHORITY
      || input.scoring_fingerprint !== WEEKLY_ASSET_SCORING_FINGERPRINT) {
    fail("WEEKLY_ASSET_AUTHORITY", "Weekly-asset provenance or authority is incompatible with Thunder Bowl.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{5,79}$/i.test(input.model_id || "")) fail("WEEKLY_ASSET_MODEL", "Weekly-asset model id is not immutable-safe.");
  const sourceAsOf = timestamp(input.source_as_of, "weekly-asset source_as_of");
  const exportedAt = timestamp(input.exported_at, "weekly-asset exported_at");
  if (Date.parse(exportedAt) < Date.parse(sourceAsOf)) fail("WEEKLY_ASSET_TIME", "Weekly assets were exported before their source snapshot.");
  if (input.reconciliation_failures !== 0 || input.season_rows !== playerCount || input.weekly_rows !== playerCount * 18) {
    fail("WEEKLY_ASSET_COVERAGE", "Weekly-asset manifest does not certify complete, reconciled coverage.");
  }
  const expectedFiles = {
    "2026_WEEKLY_ASSETS.csv": { rows: playerCount * 18, sha256: sha256(weeklyText) },
    "2026_SEASON_ASSETS.csv": { rows: playerCount, sha256: sha256(seasonText) },
  };
  for (const [name, expected] of Object.entries(expectedFiles)) {
    const supplied = input.files?.[name];
    if (supplied?.rows !== expected.rows || supplied?.sha256 !== expected.sha256) {
      fail("WEEKLY_ASSET_HASH", `${name} does not match its pinned manifest hash and row count.`);
    }
  }
  return { sourceAsOf, exportedAt, modelId: input.model_id };
}

function validateRowMetadata(row, metadata, label) {
  if (row.schema_version !== "1" || row.season !== "2026" || row.source_name !== "Thunder Bowl weekly assets"
      || row.model_id !== metadata.modelId || timestamp(row.source_as_of, `${label} source_as_of`) !== metadata.sourceAsOf
      || timestamp(row.exported_at, `${label} exported_at`) !== metadata.exportedAt
      || row.scoring_fingerprint !== WEEKLY_ASSET_SCORING_FINGERPRINT || row.authority !== WEEKLY_ASSET_AUTHORITY) {
    fail("WEEKLY_ASSET_ROW_METADATA", `${label} provenance does not match the manifest.`);
  }
}

function validateCoverage(supplied, observed) {
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) {
    fail("WEEKLY_ASSET_COVERAGE", "Weekly-asset manifest coverage must be an object.");
  }
  const expectedKeys = new Set(Object.keys(observed));
  const unsupportedKeys = Object.keys(supplied).filter((key) => !expectedKeys.has(key));
  if (unsupportedKeys.length) {
    fail("WEEKLY_ASSET_COVERAGE", `Weekly-asset manifest contains unsupported coverage field(s): ${unsupportedKeys.join(", ")}.`);
  }
  for (const [key, observedValue] of Object.entries(observed)) {
    const suppliedValue = supplied[key] ?? 0;
    if (!Number.isSafeInteger(suppliedValue) || suppliedValue < 0 || suppliedValue !== observedValue) {
      fail("WEEKLY_ASSET_COVERAGE", `Weekly-asset manifest coverage '${key}' expected ${observedValue} but supplied ${String(suppliedValue)}.`);
    }
  }
}

function pointsAllowedScore(value) {
  if (value <= 0) return 10;
  if (value <= 6) return 8;
  if (value <= 13) return 6;
  if (value <= 20) return 4;
  if (value <= 34) return 0;
  if (value <= 44) return -4;
  return -6;
}

export function thunderScoreWeeklyAssets(row) {
  if (Number(row.is_bye) === 1) return 0;
  const n = (key) => Number(row[key]) || 0;
  const offense = n("pass_yds") * 0.04 + n("pass_td") * 6 - n("pass_int") * 2
    + n("rush_yds") * 0.1 + n("rush_td") * 6
    + n("rec") + n("rec_yds") * 0.1 + n("rec_td") * 6 - n("fumbles_lost") * 2;
  const kicking = n("fg_made") * 3 + n("xp_made");
  const defense = n("dst_sacks") * 2 + n("dst_int") * 2 + n("dst_fum_rec") * 2
    + n("dst_td") * 6 + n("dst_safety") * 2
    + (row.position === "DST" ? pointsAllowedScore(n("dst_pts_allowed")) : 0);
  const returns = (n("kick_ret_td") + n("punt_ret_td")) * 6;
  return Math.max(0, offense + kicking + defense + returns);
}

function allocateTenths(shares, total) {
  const target = Math.round(total * 10);
  const exact = shares.map((share, index) => ({ index, tenths: Math.floor(share * target), fraction: share * target % 1 }));
  let remaining = target - exact.reduce((sum, row) => sum + row.tenths, 0);
  const priority = [...exact].sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) priority[index % priority.length].tenths += 1;
  return exact.map((row) => row.tenths / 10);
}

export function validateWeeklyAssetBundle({ manifest, manifestText = "", weeklyText, seasonText }, packInput) {
  const pack = validateDraftPack(packInput);
  const metadata = validateManifest(manifest, weeklyText, seasonText, pack.players.length);
  const weeklyRows = parseCsv(weeklyText, WEEKLY_ASSET_COLUMNS, "weekly assets");
  const seasonRows = parseCsv(seasonText, SEASON_ASSET_COLUMNS, "season assets");
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  const seasonById = new Map();
  const weeklyById = new Map();
  const coverage = { total: pack.players.length, season_fbg: 0, season_cbs: 0, season_fp: 0, season_pff: 0, season_blend: 0, season_none: 0, shape_fbg: 0, shape_cbs: 0, shape_team: 0, shape_flat: 0 };

  for (const row of seasonRows) {
    validateRowMetadata(row, metadata, `season row ${row.pack_player_id}`);
    const player = playerById.get(row.pack_player_id);
    if (!player || seasonById.has(row.pack_player_id)) fail("WEEKLY_ASSET_IDENTITY", `Season assets contain an unknown or duplicate player id ${row.pack_player_id}.`);
    if (row.player_name !== player.name || row.position !== player.position || normalizedTeam(row.nfl_team) !== normalizedTeam(player.nflTeam)) {
      fail("WEEKLY_ASSET_IDENTITY", `${player.name}'s season-asset identity does not match the active pack.`);
    }
    if (!POSITIONS.has(row.position) || !SEASON_SOURCES.has(row.season_asset_source) || !SHAPE_SOURCES.has(row.weekly_shape_source)) {
      fail("WEEKLY_ASSET_ENUM", `${player.name}'s season source or position is unsupported.`);
    }
    const parsed = { ...row, bye: number(row.bye, `${player.name} bye`, { integer: true, minimum: 1, maximum: 18 }) };
    for (const column of ASSET_COLUMNS) parsed[column] = number(row[column], `${player.name} ${column}`);
    seasonById.set(player.id, parsed);
    coverage[`season_${row.season_asset_source.toLowerCase()}`] += 1;
    coverage[`shape_${row.weekly_shape_source.toLowerCase()}`] += 1;
  }

  const duplicateWeeks = new Set();
  for (const row of weeklyRows) {
    validateRowMetadata(row, metadata, `weekly row ${row.pack_player_id}/${row.week}`);
    const season = seasonById.get(row.pack_player_id);
    if (!season) fail("WEEKLY_ASSET_IDENTITY", `Weekly assets reference unknown player ${row.pack_player_id}.`);
    const week = number(row.week, `${season.player_name} week`, { integer: true, minimum: 1, maximum: 18 });
    const key = `${row.pack_player_id}|${week}`;
    if (duplicateWeeks.has(key)) fail("WEEKLY_ASSET_DUPLICATE", `${season.player_name} repeats week ${week}.`);
    duplicateWeeks.add(key);
    if (row.source_player_id !== season.source_player_id
        || row.player_name !== season.player_name || row.position !== season.position || normalizedTeam(row.nfl_team) !== normalizedTeam(season.nfl_team)
        || row.season_asset_source !== season.season_asset_source || row.weekly_shape_source !== season.weekly_shape_source) {
      fail("WEEKLY_ASSET_IDENTITY", `${season.player_name}'s weekly identity or source changed.`);
    }
    const isBye = number(row.is_bye, `${season.player_name} week ${week} bye`, { integer: true, maximum: 1 });
    if (isBye !== Number(week === season.bye)) fail("WEEKLY_ASSET_BYE", `${season.player_name}'s week ${week} bye flag is wrong.`);
    const parsed = { ...row, week, is_bye: isBye, weekly_share: number(row.weekly_share, `${season.player_name} week ${week} share`, { maximum: 1 }) };
    for (const column of ASSET_COLUMNS) parsed[column] = number(row[column], `${season.player_name} week ${week} ${column}`);
    if (isBye && (parsed.weekly_share !== 0 || ASSET_COLUMNS.some((column) => parsed[column] !== 0))) {
      fail("WEEKLY_ASSET_BYE", `${season.player_name}'s bye week must contain zero share and zero assets.`);
    }
    if (!weeklyById.has(row.pack_player_id)) weeklyById.set(row.pack_player_id, []);
    weeklyById.get(row.pack_player_id).push(parsed);
  }

  let zeroAssetFallbackPlayers = 0;
  let maximumReconciliationDelta = 0;
  const projections = new Map();
  const assetProjections = new Map();
  for (const player of pack.players) {
    const season = seasonById.get(player.id);
    const weeks = (weeklyById.get(player.id) || []).sort((left, right) => left.week - right.week);
    if (!season || weeks.length !== 18 || weeks.some((row, index) => row.week !== index + 1)) {
      fail("WEEKLY_ASSET_COVERAGE", `${player.name} does not have one row for every week.`);
    }
    const suppliedShareTotal = weeks.reduce((sum, row) => sum + row.weekly_share, 0);
    if (Math.abs(suppliedShareTotal - 1) > 0.000001) fail("WEEKLY_ASSET_SHARE", `${player.name}'s weekly shares do not sum to one.`);
    for (const column of ASSET_COLUMNS) {
      const weeklyTotal = weeks.reduce((sum, row) => sum + row[column], 0);
      const delta = Math.abs(weeklyTotal - season[column]);
      maximumReconciliationDelta = Math.max(maximumReconciliationDelta, delta);
      if (delta > 0.05) fail("WEEKLY_ASSET_RECONCILIATION", `${player.name}'s ${column} weekly total does not reconcile to season.`);
    }
    const scores = weeks.map((row) => thunderScoreWeeklyAssets(row));
    const scoreTotal = scores.reduce((sum, value) => sum + value, 0);
    const shares = scoreTotal > 0 ? scores.map((value) => value / scoreTotal) : weeks.map((row) => row.weekly_share);
    if (scoreTotal <= 0) zeroAssetFallbackPlayers += 1;
    const allocated = allocateTenths(shares, player.projectedPoints);
    const points = allocated.map((value, index) => index + 1 === season.bye ? null : value);
    projections.set(player.id, {
      source: WEEKLY_ASSET_SOURCE,
      asOf: metadata.sourceAsOf,
      modelEffect: "none",
      games: 17,
      byeWeek: season.bye,
      points,
      sourceSeasonTotal: player.projectedPoints,
    });
    assetProjections.set(player.id, {
      source: WEEKLY_ASSET_SOURCE,
      asOf: metadata.sourceAsOf,
      modelEffect: "none",
      seasonSource: season.season_asset_source,
      shapeSource: season.weekly_shape_source,
      passYds: season.pass_yds,
      passTd: season.pass_td,
      passInt: season.pass_int,
      rushYds: season.rush_yds,
      rushTd: season.rush_td,
      receptions: season.rec,
      recYds: season.rec_yds,
      recTd: season.rec_td,
      fumblesLost: season.fumbles_lost,
      fgMade: season.fg_made,
      xpMade: season.xp_made,
      dstSacks: season.dst_sacks,
      dstInt: season.dst_int,
      dstFumRec: season.dst_fum_rec,
      dstTd: season.dst_td,
      dstSafety: season.dst_safety,
      dstPtsAllowed: season.dst_pts_allowed,
    });
  }
  validateCoverage(manifest.coverage, coverage);
  return {
    metadata,
    manifestHash: sha256(manifestText || `${JSON.stringify(manifest, null, 2)}\n`),
    coverage,
    projections,
    assetProjections,
    audit: {
      players: pack.players.length,
      weeklyRows: weeklyRows.length,
      seasonRows: seasonRows.length,
      zeroAssetFallbackPlayers,
      maximumReconciliationDelta: Math.round(maximumReconciliationDelta * 10000) / 10000,
      valueFieldsAccepted: 0,
      seasonProjectionChanges: 0,
      scoringCaveats: [
        "Field goals are scored as three points for weekly shape because distance bands are unavailable; authoritative season totals are preserved.",
        "DST points allowed is bucketed from expected weekly points allowed; authoritative season totals are preserved.",
      ],
    },
  };
}

export function createWeeklyAssetsCandidatePack(currentInput, bundle) {
  const current = validateDraftPack(currentInput);
  const validated = validateWeeklyAssetBundle(bundle, current);
  const candidate = structuredClone(current);
  const releaseStamp = validated.metadata.exportedAt.replace(/\D/g, "").slice(0, 14);
  const packBase = current.packId.replace(/-weekly-assets-\d+.*$/, "");
  const releaseSuffix = `-weekly-assets-${releaseStamp}-${PRIORITY_POLICY_RELEASE}`;
  candidate.packId = `${packBase.slice(0, Math.max(1, 100 - releaseSuffix.length))}${releaseSuffix}`;
  candidate.asOf = validated.metadata.exportedAt;
  const source = {
    name: "Thunder Bowl weekly assets",
    asOf: validated.metadata.sourceAsOf,
    authority: "weekly shape only; season projection unchanged",
    scoringFingerprint: WEEKLY_ASSET_SCORING_FINGERPRINT,
  };
  const sourceIndex = candidate.sources.findIndex((row) => ["Thunder Bowl weekly context v3", "Thunder Bowl weekly assets"].includes(row.name));
  if (sourceIndex >= 0) candidate.sources[sourceIndex] = source;
  else candidate.sources.push(source);
  for (const player of candidate.players) {
    player.weeklyProjection = validated.projections.get(player.id);
    player.assetProjection = validated.assetProjections.get(player.id);
  }
  candidate.weeklyContext = {
    status: "loaded_validated_schedule_weighting",
    asOf: validated.metadata.sourceAsOf,
    source: WEEKLY_ASSET_SOURCE,
    modelEffect: "bounded_replacement_relative_schedule_vbd",
    engineBacktestStatus: "league_structure_calibrated_48_team_seasons_150000_trials",
    priorityDefaultStatus: "validated_live_bounded",
    defaultWeights: { baseline: 1, division: 1.2, playoffs: 1.5 },
    suggestedScenario: { division: 1.2, playoffs: 1.5, status: "validated_live_bounded" },
    divisionWeeks: [1, 2, 12, 13],
    playoffWeeks: [15, 16, 17],
    coveredPlayers: candidate.players.length,
    top168Coverage: 1,
    contextFactors: ["source_weekly_shape", "team_schedule_shape", "bye", "matchup", "weather", "short_week"],
    sourceManifestSha256: validated.manifestHash,
  };
  return { candidate: validateDraftPack(candidate), audit: validated.audit };
}
