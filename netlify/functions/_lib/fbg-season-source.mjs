import { createHash } from "node:crypto";
import { canonicalPlayerIdentity } from "../../../public/thunder-bowl/state-engine.mjs";
import { scoreThunderBowlProjectedStats, THUNDER_BOWL_SCORING_FINGERPRINT } from "./thunder-bowl-scoring.mjs";

export const FBG_WEEKLY_COLUMNS = Object.freeze([
  "player_id", "player_name", "nfl_team", "position", "week", "projected_points", "floor", "ceiling", "provider_as_of",
]);

export const FBG_NATIVE_WEEKLY_COLUMNS = Object.freeze([
  "id", "name", "pos", "team", "set-id", "set-userid", "set-name", "ssn-gms", "ssn-ssn",
  "pass-2pt", "pass-att", "pass-cmp", "pass-1d", "pass-int", "pass-sck", "pass-td", "pass-yds",
  "rush-2pt", "rush-car", "rush-1d", "rush-td", "rush-yds",
  "rec-2pt", "rec-1d", "rec-rec", "rec-tgt", "rec-td", "rec-yds", "fum-lost",
  "kck-xpa", "kck-xpc", "kck-xpm", "kck-fga", "kck-fgc", "kck-fgm",
  "idp-2pr", "idp-ast", "idp-blk", "idp-fmr", "idp-fmf", "idp-int", "idp-pd", "idp-sck", "idp-saf", "idp-tac", "idp-tfl", "idp-td",
  "tmd-2pr", "tmd-blk", "tmd-fmf", "tmd-fmr", "tmd-int", "tmd-pa", "tmd-sck", "tmd-saf", "tmd-td", "tmd-ya",
  "pr-td", "pr-yds", "kr-td", "kr-yds",
]);

const FBG_DOWNLOAD_ORIGIN = "https://www.footballguys.com";
const FBG_CONSENSUS_SET = "Projections Consensus";
const FBG_POSITION = Object.freeze({ qb: "QB", rb: "RB", wr: "WR", te: "TE", pk: "K", td: "DST" });

function csvRows(text) {
  if (typeof text !== "string" || text.length > 2_000_000) throw new Error("Footballguys import must be a CSV under 2 MB.");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (quoted) throw new Error("Footballguys CSV contains an unterminated quoted field.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function optionalNumber(value, label) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error(`${label} must be blank or from 0 through 100.`);
  return number;
}

function nativeNumber(row, key) {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function fbgProjectedStats(row, position) {
  const n = (key) => nativeNumber(row, key);
  const hasDefenseGame = n("tmd-pa") > 0 || n("tmd-ya") > 0 || ["tmd-sck", "tmd-int", "tmd-fmr", "tmd-td", "tmd-saf"].some((key) => n(key) > 0);
  return {
    passingAttempts: n("pass-att"),
    passingCompletions: n("pass-cmp"),
    passingYards: n("pass-yds"),
    passingTouchdowns: n("pass-td"),
    interceptionsThrown: n("pass-int"),
    passingTwoPointConversions: n("pass-2pt"),
    rushingAttempts: n("rush-car"),
    rushingYards: n("rush-yds"),
    rushingTouchdowns: n("rush-td"),
    rushingTwoPointConversions: n("rush-2pt"),
    targets: n("rec-tgt"),
    receptions: n("rec-rec"),
    receivingYards: n("rec-yds"),
    receivingTouchdowns: n("rec-td"),
    receivingTwoPointConversions: n("rec-2pt"),
    fumblesLost: n("fum-lost"),
    fieldGoalAttempts: n("kck-fga"),
    fieldGoalsMade: n("kck-fgc"),
    extraPointAttempts: n("kck-xpa"),
    extraPointsMade: n("kck-xpc"),
    defensiveSacks: n("tmd-sck"),
    defensiveInterceptions: n("tmd-int"),
    defensiveFumblesRecovered: n("tmd-fmr"),
    defensiveTouchdowns: n("tmd-td"),
    defensiveSafeties: n("tmd-saf"),
    blockedKicks: n("tmd-blk"),
    defensivePointsAllowed: position === "DST" && hasDefenseGame ? n("tmd-pa") : null,
    defensiveYardsAllowed: position === "DST" && hasDefenseGame ? n("tmd-ya") : null,
    defensiveGameProjected: position === "DST" && hasDefenseGame,
    kickReturnTouchdowns: n("kr-td"),
    puntReturnTouchdowns: n("pr-td"),
  };
}

function normalizeTeam(value) {
  const team = String(value || "").trim().toUpperCase();
  return ({ ARZ: "ARI", JAC: "JAX", LA: "LAR" })[team] || team;
}

function fbgPackIndexes(pack) {
  const byFbgId = new Map();
  const byIdentity = new Map();
  for (const player of pack.players) {
    if (player.id.startsWith("fbg:")) byFbgId.set(player.id.slice(4), player);
    byIdentity.set(canonicalPlayerIdentity(player.name, player.position, player.nflTeam), player);
  }
  return { byFbgId, byIdentity };
}

function providerTimestamp(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > Date.now() + 24 * 60 * 60_000) throw new Error("Footballguys weekly download has an invalid provider timestamp.");
  return new Date(parsed).toISOString();
}

export function parseFbgNativeWeeklyCsv(text, pack, {
  week,
  providerAsOf = new Date().toISOString(),
  minimumRows = 200,
} = {}) {
  if (!Number.isSafeInteger(week) || week < 1 || week > 18) throw new Error("Footballguys weekly download requires a valid NFL week.");
  const rows = csvRows(text);
  const header = rows.shift()?.map((value) => value.toLowerCase()) || [];
  if (header.join(",") !== FBG_NATIVE_WEEKLY_COLUMNS.join(",")) throw new Error("Footballguys changed its official weekly download columns; automatic projections stopped safely.");
  const indexes = fbgPackIndexes(pack);
  const candidates = new Map();
  let consensusRows = 0;
  let unmatchedRows = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== header.length) throw new Error(`Footballguys weekly row ${index + 2} has ${cells.length} columns, not ${header.length}.`);
    const row = Object.fromEntries(header.map((column, columnIndex) => [column, cells[columnIndex]]));
    const position = FBG_POSITION[row.pos.toLowerCase()];
    if (row["set-name"] !== FBG_CONSENSUS_SET || !position) continue;
    consensusRows += 1;
    const nflTeam = normalizeTeam(row.team);
    const player = indexes.byFbgId.get(row.id)
      || indexes.byIdentity.get(canonicalPlayerIdentity(row.name, position, nflTeam));
    if (!player || player.position !== position) {
      unmatchedRows += 1;
      continue;
    }
    const projectedStats = fbgProjectedStats(row, position);
    const item = {
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      week,
      points: scoreThunderBowlProjectedStats(projectedStats, position),
      floor: null,
      ceiling: null,
      providerAsOf: providerTimestamp(providerAsOf),
      projectedStats,
      scoringCaveats: position === "K" ? ["Footballguys does not provide projected field-goal distance bands; its weekly score cannot include Thunder Bowl's +2 bonus for each 50+ yard field goal."] : [],
    };
    const prior = candidates.get(player.id);
    if (!prior || item.points > prior.points) candidates.set(player.id, item);
  }
  const items = [...candidates.values()].sort((left, right) => left.playerId.localeCompare(right.playerId));
  if (items.length < minimumRows || items.length > pack.players.length) throw new Error(`Footballguys automatic projection coverage is unsafe (${items.length} matched rows from ${consensusRows} consensus rows).`);
  const capturedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    season: pack.season,
    week,
    source: "Footballguys official weekly projections download",
    authority: "registered projection input; one-click official download",
    capturedAt,
    providerAsOf: providerTimestamp(providerAsOf),
    rawSha256: createHash("sha256").update(text).digest("hex"),
    itemCount: items.length,
    consensusRowCount: consensusRows,
    unmatchedRowCount: unmatchedRows,
    scoringFingerprint: THUNDER_BOWL_SCORING_FINGERPRINT,
    items,
  };
}

export async function downloadFbgWeeklySnapshot(pack, week, {
  fetchImpl = fetch,
  timeoutMs = 20_000,
} = {}) {
  const url = `${FBG_DOWNLOAD_ORIGIN}/projections/download/weekly/all/${pack.season}/${week}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      headers: { Accept: "text/csv,application/octet-stream;q=0.9" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Footballguys weekly download returned HTTP ${response.status}.`);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 2_000_000) throw new Error("Footballguys weekly download exceeds 2 MB.");
    const providerAsOf = response.headers.get("last-modified") || response.headers.get("date") || new Date().toISOString();
    return parseFbgNativeWeeklyCsv(text, pack, { week, providerAsOf });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Footballguys weekly download timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseFbgWeeklyCsv(text, pack, { minimumRows = 8 } = {}) {
  const rows = csvRows(text);
  const header = rows.shift()?.map((value) => value.toLowerCase()) || [];
  if (header.join(",") !== FBG_WEEKLY_COLUMNS.join(",")) throw new Error(`Footballguys CSV headers must be exactly ${FBG_WEEKLY_COLUMNS.join(",")}.`);
  const byId = new Map(pack.players.map((player) => [player.id, player]));
  const byIdentity = new Map(pack.players.map((player) => [canonicalPlayerIdentity(player.name, player.position, player.nflTeam), player]));
  const seen = new Set();
  const items = rows.map((cells, index) => {
    if (cells.length !== FBG_WEEKLY_COLUMNS.length) throw new Error(`Footballguys row ${index + 2} has ${cells.length} columns, not ${FBG_WEEKLY_COLUMNS.length}.`);
    const values = Object.fromEntries(FBG_WEEKLY_COLUMNS.map((column, columnIndex) => [column, cells[columnIndex]]));
    const suppliedId = values.player_id.trim();
    const position = values.position.toUpperCase();
    const nflTeam = values.nfl_team.toUpperCase();
    const player = (suppliedId && byId.get(suppliedId)) || byIdentity.get(canonicalPlayerIdentity(values.player_name, position, nflTeam));
    if (!player) throw new Error(`Footballguys row ${index + 2} does not resolve to the governed player catalog.`);
    if (suppliedId && suppliedId !== player.id) throw new Error(`Footballguys row ${index + 2} player id conflicts with its player identity.`);
    const week = Number(values.week);
    if (!Number.isSafeInteger(week) || week < 1 || week > 18) throw new Error(`Footballguys row ${index + 2} has an invalid week.`);
    const key = `${player.id}|${week}`;
    if (seen.has(key)) throw new Error(`Footballguys import repeats ${player.name} Week ${week}.`);
    seen.add(key);
    const points = optionalNumber(values.projected_points, `${player.name} projected points`);
    if (points === null) throw new Error(`${player.name} Week ${week} is missing projected points; omit missing rows instead of writing zero or blank.`);
    const floor = optionalNumber(values.floor, `${player.name} floor`);
    const ceiling = optionalNumber(values.ceiling, `${player.name} ceiling`);
    if (floor !== null && floor > points) throw new Error(`${player.name} floor cannot exceed its projection.`);
    if (ceiling !== null && ceiling < points) throw new Error(`${player.name} ceiling cannot be below its projection.`);
    if (!Number.isFinite(Date.parse(values.provider_as_of)) || Date.parse(values.provider_as_of) > Date.now() + 24 * 60 * 60_000) throw new Error(`Footballguys row ${index + 2} has an invalid provider timestamp.`);
    return { playerId: player.id, playerName: player.name, position: player.position, nflTeam, week, points, floor, ceiling, providerAsOf: new Date(values.provider_as_of).toISOString() };
  });
  if (items.length < minimumRows || items.length > pack.players.length * 18) throw new Error(`Footballguys import has unexpected coverage (${items.length} rows).`);
  const weeks = [...new Set(items.map((item) => item.week))];
  if (weeks.length !== 1) throw new Error("A Footballguys import must contain exactly one NFL week.");
  const capturedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    season: pack.season,
    week: weeks[0],
    source: "Footballguys owner-exported weekly projections",
    authority: "registered projection input; user-triggered import",
    capturedAt,
    providerAsOf: items.map((item) => item.providerAsOf).sort().at(-1),
    rawSha256: createHash("sha256").update(text).digest("hex"),
    itemCount: items.length,
    items,
  };
}

export function validateFbgWeeklySnapshot(value, pack) {
  if (!value || value.schemaVersion !== 1 || value.season !== pack.season || !Number.isSafeInteger(value.week) || value.week < 1 || value.week > 18) throw new Error("Footballguys weekly snapshot failed its source contract.");
  if (!Number.isFinite(Date.parse(value.capturedAt)) || !Number.isFinite(Date.parse(value.providerAsOf)) || Date.parse(value.providerAsOf) > Date.now() + 24 * 60 * 60_000 || !/^[a-f0-9]{64}$/.test(value.rawSha256 || "")) throw new Error("Footballguys weekly provenance is invalid.");
  if (!Array.isArray(value.items) || value.items.length !== value.itemCount) throw new Error("Footballguys weekly coverage does not reconcile.");
  const known = new Set(pack.players.map((player) => player.id));
  const ids = new Set();
  for (const item of value.items) {
    if (!known.has(item.playerId) || item.week !== value.week || !Number.isFinite(item.points) || item.points < -100 || item.points > 100) throw new Error("Footballguys weekly snapshot contains an invalid row.");
    if (item.projectedStats !== undefined && (!item.projectedStats || typeof item.projectedStats !== "object" || Array.isArray(item.projectedStats))) throw new Error("Footballguys weekly snapshot contains malformed projected stats.");
    if (ids.has(item.playerId)) throw new Error("Footballguys weekly snapshot repeats a player.");
    ids.add(item.playerId);
  }
  return value;
}
