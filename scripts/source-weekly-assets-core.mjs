import { createHash } from "node:crypto";
import { canonicalPlayerIdentity, validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";
import {
  PREMIUM_PROJECTION_SOURCES,
  projectionSourceWeights,
  weightedProjectionConsensus,
} from "../public/thunder-bowl/projection-lab.mjs";
import { recomputeClassicValues } from "./projection-refresh-core.mjs";
import { thunderScoreWeeklyAssets, WEEKLY_ASSET_SCORING_FINGERPRINT } from "./weekly-assets-core.mjs";

export const SOURCE_WEEKLY_ASSET_COLUMNS = [
  "pack_player_id", "player_name", "position", "nfl_team", "source", "week", "is_bye", "data_status",
  "pass_att", "pass_cmp", "pass_yds", "pass_td", "pass_int", "rush_att", "rush_yds", "rush_td",
  "rec", "rec_yds", "rec_td", "fumbles_lost", "fg_made", "fg_att", "xp_made", "xp_att",
  "dst_sacks", "dst_int", "dst_fum_rec", "dst_ff", "dst_td", "dst_safety", "dst_pts_allowed",
  "dst_yds_allowed", "kick_ret_yds", "kick_ret_td", "punt_ret_yds", "punt_ret_td",
];

const ASSET_COLUMNS = SOURCE_WEEKLY_ASSET_COLUMNS.slice(8);
const DISPLAY_ASSETS = {
  passYds: "pass_yds",
  passTd: "pass_td",
  passInt: "pass_int",
  rushYds: "rush_yds",
  rushTd: "rush_td",
  receptions: "rec",
  recYds: "rec_yds",
  recTd: "rec_td",
  fumblesLost: "fumbles_lost",
  fgMade: "fg_made",
  xpMade: "xp_made",
  dstSacks: "dst_sacks",
  dstInt: "dst_int",
  dstFumRec: "dst_fum_rec",
  dstTd: "dst_td",
  dstSafety: "dst_safety",
  dstPtsAllowed: "dst_pts_allowed",
};
const SOURCE_CONFIG = Object.freeze({
  Footballguys: Object.freeze({ csvSource: "FBG", assetSource: "FBG", statuses: new Set(["season_curve"]), weeks: 18, role: "cross-check" }),
  CBS: Object.freeze({ csvSource: "CBS", assetSource: "CBS", statuses: new Set(["native", "missing", "bye"]), weeks: 17, role: "cross-check" }),
  FantasyPros: Object.freeze({ csvSource: "FantasyPros", assetSource: "FP", statuses: new Set(["season_curve"]), weeks: 18, role: "supplemental" }),
  PFF: Object.freeze({ csvSource: "PFF", assetSource: "PFF", statuses: new Set(["season_curve"]), weeks: 18, role: "supplemental" }),
});
const DEFAULT_COVERAGE_THRESHOLDS = Object.freeze({
  Footballguys: Object.freeze({ players: 500, usableRows: 8500 }),
  CBS: Object.freeze({ players: 200, usableRows: 3000 }),
  FantasyPros: Object.freeze({ players: 400, usableRows: 7000 }),
  PFF: Object.freeze({ players: 80, usableRows: 1400 }),
});
const TOP_LEVEL_SOURCE_NAMES = Object.freeze({
  Footballguys: "Footballguys 2026 preseason consensus raw categories",
  CBS: "CBS Thunder Bowl weekly projections",
  FantasyPros: "FantasyPros 2026 consensus component projections",
  PFF: "PFF 2026 component projections",
});
const PRIMARY_SOURCE = "Thunder Bowl Consensus";
const WEEKLY_SOURCE = "Thunder Bowl weekly assets";
const WEEKLY_PLAYER_SOURCE = "Thunder Bowl weekly assets v1";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
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
  if (quoted) fail("SOURCE_ASSET_CSV_QUOTE", "A source asset CSV contains an unterminated quoted cell.");
  cells.push(value);
  return cells;
}

function parseCsv(input, label) {
  const lines = String(input || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length);
  if (lines.length < 2) fail("SOURCE_ASSET_EMPTY", `${label} must contain a header and data rows.`);
  const header = parseCsvLine(lines[0]);
  if (header.join("|") !== SOURCE_WEEKLY_ASSET_COLUMNS.join("|")) {
    fail("SOURCE_ASSET_COLUMNS", `${label} columns changed or are out of order.`);
  }
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    if (cells.length !== header.length) fail("SOURCE_ASSET_ROW", `${label} row ${index + 2} has the wrong number of cells.`);
    return Object.fromEntries(header.map((column, cellIndex) => [column, cells[cellIndex]]));
  });
}

function finiteAsset(value, label, column) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  const minimum = column === "rush_yds" ? -1000 : 0;
  if (!Number.isFinite(number) || number < minimum || number > 100000) {
    fail("SOURCE_ASSET_NUMBER", `${label} is outside its allowed numeric range.`);
  }
  return number;
}

function timestamp(value, label) {
  const result = String(value || "").trim();
  if (!Number.isFinite(Date.parse(result)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(result)) {
    fail("SOURCE_ASSET_TIMESTAMP", `${label} must be a timezone-qualified timestamp.`);
  }
  return new Date(result).toISOString();
}

function allocateTenths(values, total, byeWeek) {
  const target = Math.round(total * 10);
  const positiveTotal = values.reduce((sum, value, index) => sum + (index + 1 === byeWeek ? 0 : Math.max(0, value)), 0);
  const liveWeeks = values.map((value, index) => {
    if (index + 1 === byeWeek) return null;
    const exact = positiveTotal > 0 ? Math.max(0, value) / positiveTotal * target : target / 17;
    return { index, tenths: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  const live = liveWeeks.filter(Boolean).sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  let remaining = target - live.reduce((sum, row) => sum + row.tenths, 0);
  for (let index = 0; index < remaining; index += 1) live[index % live.length].tenths += 1;
  return liveWeeks.map((row) => row ? row.tenths / 10 : null);
}

function priorWeek(player, week, byeWeek) {
  if (week === byeWeek) return 0;
  const supplied = Number(player.weeklyProjection?.points?.[week - 1]);
  if (Number.isFinite(supplied) && supplied >= 0) return supplied;
  return Number(player.projectedPoints) / 17;
}

function sourceSummary(rows) {
  return PREMIUM_PROJECTION_SOURCES
    .map((source) => rows.find((row) => row.source === source))
    .filter(Boolean)
    .map((row) => `${row.source} ${Number(row.points).toFixed(1)}`)
    .join("; ");
}

function governedProjectionNote(prior, rows, projectedPoints) {
  const consensus = weightedProjectionConsensus(Object.fromEntries(rows.map((row) => [row.source, row.points])));
  const correction = round1(projectedPoints - consensus);
  const signed = `${correction >= 0 ? "+" : ""}${correction.toFixed(1)}`;
  const supplemental = String(prior.notes || "").match(/Sleeper status is a supplemental fresh flag only; no projection or dollar adjustment applied\.?/i)?.[0] || "";
  return `${sourceSummary(rows)}. Thunder Bowl consensus ${projectedPoints.toFixed(1)} drives VBD; availability-aware weekly weighting and QA-approved automatic correction ${signed}.${supplemental ? ` ${supplemental}` : ""}`;
}

function sourceEvidence(source, points, sourceAsOf, weight) {
  return {
    source,
    points: round1(points),
    asOf: sourceAsOf,
    role: SOURCE_CONFIG[source].role,
    modelEffect: "none",
    note: `Included in Thunder Bowl consensus at ${(weight * 100).toFixed(1)}% of available-source weight`,
  };
}

function resolveRows(files, pack, coverageThresholds) {
  const playerById = new Map(pack.players.map((player) => [player.id, player]));
  const playerByIdentity = new Map(pack.players.map((player) => [canonicalPlayerIdentity(player.name, player.position, player.nflTeam), player]));
  const rowsByPlayer = new Map();
  const sourceAudit = {};

  for (const source of PREMIUM_PROJECTION_SOURCES) {
    const config = SOURCE_CONFIG[source];
    const text = files[source];
    if (!text) fail("SOURCE_ASSET_MISSING", `${source} weekly assets were not supplied.`);
    const rows = parseCsv(text, `${source} weekly assets`);
    const seen = new Set();
    const playerIds = new Set();
    let usableRows = 0;
    let missingRows = 0;
    let byeRows = 0;
    for (const [index, raw] of rows.entries()) {
      if (raw.source !== config.csvSource) fail("SOURCE_ASSET_LABEL", `${source} row ${index + 2} is labeled '${raw.source}'.`);
      if (!config.statuses.has(raw.data_status)) fail("SOURCE_ASSET_STATUS", `${source} row ${index + 2} has unsupported status '${raw.data_status}'.`);
      const week = Number(raw.week);
      const isBye = Number(raw.is_bye);
      if (!Number.isSafeInteger(week) || week < 1 || week > config.weeks || ![0, 1].includes(isBye)) {
        fail("SOURCE_ASSET_WEEK", `${source} row ${index + 2} has an invalid week or bye flag.`);
      }
      let player = raw.pack_player_id ? playerById.get(raw.pack_player_id) : null;
      if (raw.pack_player_id && !player) fail("SOURCE_ASSET_ID", `${source} references unknown player id '${raw.pack_player_id}'.`);
      if (!player) player = playerByIdentity.get(canonicalPlayerIdentity(raw.player_name, raw.position, raw.nfl_team));
      if (!player) fail("SOURCE_ASSET_IDENTITY", `${source} could not match ${raw.player_name} (${raw.position}-${raw.nfl_team}) to the pack.`);
      if (canonicalPlayerIdentity(raw.player_name, raw.position, raw.nfl_team) !== canonicalPlayerIdentity(player.name, player.position, player.nflTeam)) {
        fail("SOURCE_ASSET_IDENTITY", `${source} identity drifted for ${player.name}.`);
      }
      const key = `${source}|${player.id}|${week}`;
      if (seen.has(key)) fail("SOURCE_ASSET_DUPLICATE", `${source} repeats ${player.name} week ${week}.`);
      seen.add(key);
      const parsed = { ...raw, playerId: player.id, week, is_bye: isBye };
      for (const column of ASSET_COLUMNS) parsed[column] = finiteAsset(raw[column], `${source} ${player.name} week ${week} ${column}`, column);
      const hasAssets = ASSET_COLUMNS.some((column) => Number(parsed[column]) !== 0 && parsed[column] !== null);
      if (["missing", "bye"].includes(parsed.data_status) && hasAssets) {
        fail("SOURCE_ASSET_EMPTY_STATUS", `${source} ${player.name} week ${week} has assets despite '${parsed.data_status}' status.`);
      }
      if (parsed.is_bye && parsed.data_status !== "bye" && source === "CBS") {
        fail("SOURCE_ASSET_BYE", `CBS ${player.name} week ${week} has a mismatched bye status.`);
      }
      const usable = ["native", "season_curve"].includes(parsed.data_status) && !parsed.is_bye;
      if (usable) usableRows += 1;
      if (parsed.data_status === "missing") missingRows += 1;
      if (parsed.is_bye || parsed.data_status === "bye") byeRows += 1;
      playerIds.add(player.id);
      if (!rowsByPlayer.has(player.id)) rowsByPlayer.set(player.id, new Map());
      const sourceMap = rowsByPlayer.get(player.id);
      if (!sourceMap.has(source)) sourceMap.set(source, new Map());
      sourceMap.get(source).set(week, parsed);
    }
    const expectedRowsPerPlayer = config.weeks;
    for (const playerId of playerIds) {
      if (rowsByPlayer.get(playerId).get(source).size !== expectedRowsPerPlayer) {
        fail("SOURCE_ASSET_COVERAGE", `${source} does not contain ${expectedRowsPerPlayer} distinct weeks for ${playerById.get(playerId).name}.`);
      }
    }
    const threshold = coverageThresholds[source] || { players: 0, usableRows: 0 };
    if (playerIds.size < threshold.players || usableRows < threshold.usableRows) {
      fail("SOURCE_ASSET_COVERAGE", `${source} coverage fell to ${playerIds.size} players/${usableRows} usable rows; minimum is ${threshold.players}/${threshold.usableRows}.`);
    }
    sourceAudit[source] = { rows: rows.length, players: playerIds.size, usableRows, missingRows, byeRows, sha256: sha256(text) };
  }
  return { rowsByPlayer, sourceAudit };
}

function usableScore(row, position) {
  if (!row || row.is_bye || !["native", "season_curve"].includes(row.data_status)) return null;
  return thunderScoreWeeklyAssets({ ...row, position });
}

function blendedAssets(sourceMap, byeWeek) {
  const totals = Object.fromEntries(Object.keys(DISPLAY_ASSETS).map((key) => [key, 0]));
  for (let week = 1; week <= 18; week += 1) {
    if (week === byeWeek) continue;
    for (const [displayKey, assetKey] of Object.entries(DISPLAY_ASSETS)) {
      const values = [];
      for (const source of PREMIUM_PROJECTION_SOURCES) {
        const row = sourceMap?.get(source)?.get(week);
        if (!row || row.is_bye || !["native", "season_curve"].includes(row.data_status) || row[assetKey] === null) continue;
        values.push([source, row[assetKey]]);
      }
      if (!values.length) continue;
      const weights = projectionSourceWeights(values.map(([source]) => source));
      totals[displayKey] += values.reduce((sum, [source, value]) => sum + value * weights[source], 0);
    }
  }
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.max(0, round3(value))]));
}

function replaceSource(sources, name, replacement) {
  const index = sources.findIndex((source) => source.name === name);
  if (index >= 0) sources[index] = replacement;
  else sources.push(replacement);
}

export function createSourceWeeklyAssetsCandidate(currentInput, files, {
  sourceAsOf,
  exportedAt,
  modelId,
  coverageThresholds = DEFAULT_COVERAGE_THRESHOLDS,
} = {}) {
  const current = validateDraftPack(currentInput);
  const sourceTimestamp = timestamp(sourceAsOf, "source asset asOf");
  const exportTimestamp = timestamp(exportedAt, "source asset exportedAt");
  if (Date.parse(exportTimestamp) < Date.parse(sourceTimestamp)) fail("SOURCE_ASSET_TIME", "Source assets cannot be exported before their source snapshot.");
  if (!/^[a-z0-9][a-z0-9._-]{5,79}$/i.test(modelId || "")) fail("SOURCE_ASSET_MODEL", "Source asset model id is not immutable-safe.");
  const { rowsByPlayer, sourceAudit } = resolveRows(files, current, coverageThresholds);
  const candidate = structuredClone(current);
  const combinedHash = sha256(PREMIUM_PROJECTION_SOURCES.map((source) => `${source}\n${files[source]}`).join("\n"));
  const releaseStamp = exportTimestamp.replace(/\D/g, "").slice(0, 14);
  candidate.packId = `tb26-${modelId}-${releaseStamp}`.slice(0, 100);
  candidate.asOf = exportTimestamp;
  const systematicCollapseSignals = Object.fromEntries(PREMIUM_PROJECTION_SOURCES.map((source) => [source, []]));
  const sourceDisagreements = [];

  for (const player of candidate.players) {
    const prior = current.players.find((row) => row.id === player.id);
    const sourceMap = rowsByPlayer.get(player.id);
    const coverageSources = PREMIUM_PROJECTION_SOURCES.filter((source) => {
      const rows = sourceMap?.get(source);
      return rows && [...rows.values()].some((row) => usableScore(row, player.position) !== null);
    });
    const byeCandidates = new Set();
    for (const source of PREMIUM_PROJECTION_SOURCES) {
      for (const row of sourceMap?.get(source)?.values() || []) if (row.is_bye || row.data_status === "bye") byeCandidates.add(row.week);
    }
    if (byeCandidates.size > 1) fail("SOURCE_ASSET_BYE", `${player.name} has conflicting bye weeks across sources.`);
    const byeWeek = [...byeCandidates][0] || prior.weeklyProjection?.byeWeek || 18;
    const weeklyConsensus = [];
    for (let week = 1; week <= 18; week += 1) {
      if (week === byeWeek) {
        weeklyConsensus.push(0);
        continue;
      }
      const sourceScores = {};
      for (const source of coverageSources) {
        const score = usableScore(sourceMap.get(source).get(week), player.position);
        if (score !== null) sourceScores[source] = score;
      }
      weeklyConsensus.push(weightedProjectionConsensus(sourceScores) ?? priorWeek(prior, week, byeWeek));
    }

    let sourceRows;
    if (coverageSources.length) {
      const sourcePoints = Object.fromEntries(coverageSources.map((source) => {
        const points = weeklyConsensus.reduce((sum, consensus, index) => {
          const week = index + 1;
          if (week === byeWeek) return sum;
          const observed = usableScore(sourceMap.get(source).get(week), player.position);
          return sum + (observed ?? consensus);
        }, 0);
        return [source, round1(points)];
      }));
      const weights = projectionSourceWeights(coverageSources);
      sourceRows = coverageSources.map((source) => sourceEvidence(source, sourcePoints[source], sourceTimestamp, weights[source]));
      player.projectedPoints = round1(weightedProjectionConsensus(sourcePoints));
      player.weeklyProjection = {
        source: WEEKLY_PLAYER_SOURCE,
        asOf: sourceTimestamp,
        modelEffect: "none",
        games: 17,
        byeWeek,
        points: allocateTenths(weeklyConsensus, player.projectedPoints, byeWeek),
        sourceSeasonTotal: player.projectedPoints,
      };
      player.assetProjection = {
        source: WEEKLY_PLAYER_SOURCE,
        asOf: sourceTimestamp,
        modelEffect: "none",
        seasonSource: coverageSources.length > 1 ? "BLEND" : SOURCE_CONFIG[coverageSources[0]].assetSource,
        shapeSource: coverageSources.includes("CBS") ? "CBS" : coverageSources.includes("Footballguys") ? "FBG" : "TEAM",
        ...blendedAssets(sourceMap, byeWeek),
      };
    } else {
      sourceRows = (prior.projectionSources || []).filter((row) => PREMIUM_PROJECTION_SOURCES.includes(row.source));
      player.projectedPoints = round1(weightedProjectionConsensus(Object.fromEntries(sourceRows.map((row) => [row.source, row.points]))) ?? prior.projectedPoints);
      if (prior.weeklyProjection) {
        const oldValues = prior.weeklyProjection.points.map((value) => value ?? 0);
        player.weeklyProjection = {
          ...prior.weeklyProjection,
          points: allocateTenths(oldValues, player.projectedPoints, prior.weeklyProjection.byeWeek),
          sourceSeasonTotal: player.projectedPoints,
        };
      }
    }
    if (coverageSources.length >= 3) {
      const sortedPoints = sourceRows.map((row) => row.points).sort((left, right) => left - right);
      const spread = sortedPoints.at(-1) - sortedPoints[0];
      if (spread >= 75) sourceDisagreements.push({ playerId: player.id, name: player.name, position: player.position, spread: round1(spread) });
      for (const row of sourceRows) {
        const others = sourceRows.filter((candidateRow) => candidateRow !== row).map((candidateRow) => candidateRow.points).sort((left, right) => left - right);
        const midpoint = Math.floor(others.length / 2);
        const median = others.length % 2 ? others[midpoint] : (others[midpoint - 1] + others[midpoint]) / 2;
        if (row.points <= 5 && median >= 75) systematicCollapseSignals[row.source].push(player.name);
      }
    }
    const nonPremium = (prior.projectionSources || []).filter((row) => !PREMIUM_PROJECTION_SOURCES.includes(row.source) && row.source !== PRIMARY_SOURCE);
    player.projectionSources = [...nonPremium, ...sourceRows, {
      source: PRIMARY_SOURCE,
      points: player.projectedPoints,
      asOf: sourceTimestamp,
      role: "primary",
      modelEffect: "primary_projection",
      note: `Immutable ${modelId}; weekly asset consensus; gated adjustments`,
    }];
    player.notes = governedProjectionNote(prior, sourceRows, player.projectedPoints);
  }

  const systematicCollapse = Object.entries(systematicCollapseSignals).filter(([, names]) => names.length >= 5);
  if (systematicCollapse.length) {
    const summary = systematicCollapse.map(([source, names]) => `${source}: ${names.length} (${names.slice(0, 5).join(", ")})`).join(" | ");
    fail("SOURCE_ASSET_SYSTEMATIC_COLLAPSE", `A source shows repeated near-zero projections against strong peers: ${summary}.`);
  }

  recomputeClassicValues(candidate, current);
  const scoringFingerprint = current.sources[0].scoringFingerprint;
  const sourceDefinitions = {
    Footballguys: { authority: "user-paid assets; registered consensus input" },
    CBS: { authority: "native weekly assets; missing rows renormalized" },
    FantasyPros: { authority: "supplemental projection; neutral-prior weight" },
    PFF: { authority: "supplemental projection; neutral-prior weight" },
  };
  for (const source of PREMIUM_PROJECTION_SOURCES) {
    replaceSource(candidate.sources, TOP_LEVEL_SOURCE_NAMES[source], {
      name: TOP_LEVEL_SOURCE_NAMES[source],
      asOf: sourceTimestamp,
      authority: sourceDefinitions[source].authority,
      scoringFingerprint,
    });
  }
  replaceSource(candidate.sources, PRIMARY_SOURCE, {
    name: PRIMARY_SOURCE,
    asOf: sourceTimestamp,
    authority: "primary projection; Thunder Bowl computes value",
    scoringFingerprint,
  });
  replaceSource(candidate.sources, WEEKLY_SOURCE, {
    name: WEEKLY_SOURCE,
    asOf: sourceTimestamp,
    authority: "weekly assets; availability-normalized scoring",
    scoringFingerprint,
  });
  candidate.weeklyContext = {
    ...candidate.weeklyContext,
    asOf: sourceTimestamp,
    coveredPlayers: candidate.players.filter((player) => player.weeklyProjection).length,
    top168Coverage: Number((candidate.players.slice(0, 168).filter((player) => player.weeklyProjection).length / 168).toFixed(6)),
    sourceManifestSha256: combinedHash,
  };
  const validated = validateDraftPack(candidate);
  const changedPlayers = validated.players.filter((player, index) => player.projectedPoints !== current.players[index].projectedPoints).length;
  const fallbackPlayers = validated.players.length - rowsByPlayer.size;
  return {
    candidate: validated,
    audit: {
      modelId,
      sourceAsOf: sourceTimestamp,
      exportedAt: exportTimestamp,
      combinedSha256: combinedHash,
      sourceCoverage: sourceAudit,
      players: validated.players.length,
      playersWithFreshRows: rowsByPlayer.size,
      fallbackPlayers,
      changedPlayers,
      scoringFingerprint: WEEKLY_ASSET_SCORING_FINGERPRINT,
      missingRowsTreatedAsZero: 0,
      automaticCorrectionDelta: 0,
      pffWeightPolicy: "neutral midpoint pending comparable historical archive",
      systematicCollapseSignals: Object.fromEntries(Object.entries(systematicCollapseSignals).map(([source, names]) => [source, names.length])),
      sourceDisagreementCount75: sourceDisagreements.length,
      largestSourceDisagreements: sourceDisagreements.sort((left, right) => right.spread - left.spread).slice(0, 25),
    },
  };
}
