import { createHash } from "node:crypto";
import { canonicalPlayerIdentity } from "../../../public/thunder-bowl/state-engine.mjs";
import { SUPPLEMENTAL_PROVIDERS, validateSupplementalSessionCapture } from "../../../public/thunder-bowl/supplemental-session-capture.mjs";
import { scoreThunderBowlProjectedStats, THUNDER_BOWL_SCORING_FINGERPRINT } from "./thunder-bowl-scoring.mjs";

const FP_HEADERS = Object.freeze({
  QB: ["PLAYER", "ATT", "CMP", "YDS", "TDS", "INTS", "ATT", "YDS", "TDS", "FL", "FPTS"],
  RB: ["PLAYER", "ATT", "YDS", "TDS", "REC", "YDS", "TDS", "FL", "FPTS"],
  WR: ["PLAYER", "REC", "YDS", "TDS", "ATT", "YDS", "TDS", "FL", "FPTS"],
  TE: ["PLAYER", "REC", "YDS", "TDS", "FL", "FPTS"],
  K: ["PLAYER", "FG", "FGA", "XPT", "FPTS"],
  DST: ["PLAYER", "SACK", "INT", "FR", "FF", "TD", "SAFETY", "PA", "YDS AGN", "FPTS"],
});
const PFF_OFFENSE_HEADERS = Object.freeze(["TEAM", "POS", "BYE", "OPP", "PTS", "PASS_YDS", "PASS_TD", "PASS_INT", "RUSH_YDS", "RUSH_TD", "REC", "REC_YDS", "REC_TD", "FG", "XP"]);
const PFF_DST_HEADERS = Object.freeze(["TEAM", "POS", "BYE", "OPP", "PTS", "SACK", "SFT", "INT", "FF", "FR", "TD", "RETURN_YDS", "RETURN_TD", "PA_0", "PA_1_6", "PA_7_13", "PA_14_20", "PA_21_27", "PA_28_34", "PA_35_PLUS"]);

function normalizeTeam(value) {
  const team = String(value || "").trim().toUpperCase();
  return ({ ARZ: "ARI", JAC: "JAX", LA: "LAR", BLT: "BAL", CLV: "CLE", HST: "HOU" })[team] || team;
}

function number(value, label) {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000) throw new Error(`${label} is not a safe nonnegative projection.`);
  return parsed;
}

function positionIndexes(pack) {
  const byIdentity = new Map();
  const dstByTeam = new Map();
  for (const player of pack.players) {
    byIdentity.set(canonicalPlayerIdentity(player.name, player.position, normalizeTeam(player.nflTeam)), player);
    if (player.position === "DST") dstByTeam.set(normalizeTeam(player.nflTeam), player);
  }
  return { byIdentity, dstByTeam };
}

function resolvePlayer(indexes, row, position, team) {
  if (position === "DST" && team) return indexes.dstByTeam.get(normalizeTeam(team)) || null;
  return indexes.byIdentity.get(canonicalPlayerIdentity(row.playerName, position, normalizeTeam(team))) || null;
}

function baseStats() {
  return {
    passingAttempts: 0, passingCompletions: 0, passingYards: 0, passingTouchdowns: 0, interceptionsThrown: 0, passingTwoPointConversions: 0,
    rushingAttempts: 0, rushingYards: 0, rushingTouchdowns: 0, rushingTwoPointConversions: 0,
    targets: 0, receptions: 0, receivingYards: 0, receivingTouchdowns: 0, receivingTwoPointConversions: 0, fumblesLost: 0,
    fieldGoalAttempts: 0, fieldGoalsMade: 0, fieldGoalsMade50Plus: 0, extraPointsMade: 0,
    defensiveSacks: 0, defensiveInterceptions: 0, defensiveFumblesRecovered: 0, defensiveTouchdowns: 0, defensiveSafeties: 0, blockedKicks: 0,
    defensivePointsAllowed: null, defensiveYardsAllowed: null, defensiveGameProjected: false,
    kickReturnTouchdowns: 0, puntReturnTouchdowns: 0,
  };
}

function item(player, capture, projectedStats, providerPoints, scoringCaveats = [], pointsOverride = null) {
  return {
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    nflTeam: player.nflTeam,
    week: capture.week,
    points: pointsOverride ?? scoreThunderBowlProjectedStats(projectedStats, player.position),
    floor: null,
    ceiling: null,
    providerAsOf: capture.providerAsOf,
    projectedStats,
    providerPoints,
    scoringCaveats,
  };
}

function snapshot(capture, pack, provider, items, unmatchedRowCount) {
  return validateSupplementalWeeklySnapshot({
    schemaVersion: 1,
    season: pack.season,
    week: capture.week,
    provider,
    source: SUPPLEMENTAL_PROVIDERS[provider].source,
    authority: `registered projection input; authenticated ${provider === "fantasyPros" ? "FantasyPros" : "PFF"} browser-session component-stat capture`,
    capturedAt: capture.capturedAt,
    providerAsOf: capture.providerAsOf,
    rawSha256: createHash("sha256").update(JSON.stringify(capture)).digest("hex"),
    itemCount: items.length,
    capturedRowCount: capture.rows.length,
    unmatchedRowCount,
    scoringFingerprint: THUNDER_BOWL_SCORING_FINGERPRINT,
    items: items.sort((left, right) => left.playerId.localeCompare(right.playerId)),
  }, pack, provider);
}

function fantasyProsStats(row, position) {
  const c = row.cells;
  const n = (index, label) => number(c[index], `FantasyPros ${row.playerName} ${label}`);
  const stats = baseStats();
  let providerPoints;
  if (position === "QB") Object.assign(stats, { passingAttempts: n(0, "pass attempts"), passingCompletions: n(1, "completions"), passingYards: n(2, "pass yards"), passingTouchdowns: n(3, "pass TDs"), interceptionsThrown: n(4, "interceptions"), rushingAttempts: n(5, "rush attempts"), rushingYards: n(6, "rush yards"), rushingTouchdowns: n(7, "rush TDs"), fumblesLost: n(8, "fumbles lost") }), providerPoints = n(9, "provider points");
  if (position === "RB") Object.assign(stats, { rushingAttempts: n(0, "rush attempts"), rushingYards: n(1, "rush yards"), rushingTouchdowns: n(2, "rush TDs"), receptions: n(3, "receptions"), receivingYards: n(4, "receiving yards"), receivingTouchdowns: n(5, "receiving TDs"), fumblesLost: n(6, "fumbles lost") }), providerPoints = n(7, "provider points");
  if (position === "WR") Object.assign(stats, { receptions: n(0, "receptions"), receivingYards: n(1, "receiving yards"), receivingTouchdowns: n(2, "receiving TDs"), rushingAttempts: n(3, "rush attempts"), rushingYards: n(4, "rush yards"), rushingTouchdowns: n(5, "rush TDs"), fumblesLost: n(6, "fumbles lost") }), providerPoints = n(7, "provider points");
  if (position === "TE") Object.assign(stats, { receptions: n(0, "receptions"), receivingYards: n(1, "receiving yards"), receivingTouchdowns: n(2, "receiving TDs"), fumblesLost: n(3, "fumbles lost") }), providerPoints = n(4, "provider points");
  if (position === "K") Object.assign(stats, { fieldGoalsMade: n(0, "field goals"), fieldGoalAttempts: n(1, "field-goal attempts"), extraPointsMade: n(2, "extra points") }), providerPoints = n(3, "provider points");
  if (position === "DST") Object.assign(stats, { defensiveSacks: n(0, "sacks"), defensiveInterceptions: n(1, "interceptions"), defensiveFumblesRecovered: n(2, "fumble recoveries"), defensiveTouchdowns: n(4, "touchdowns"), defensiveSafeties: n(5, "safeties"), defensivePointsAllowed: n(6, "points allowed"), defensiveYardsAllowed: n(7, "yards allowed"), defensiveGameProjected: true }), providerPoints = n(8, "provider points");
  return { stats, providerPoints };
}

export function parseFantasyProsAuthenticatedCapture(input, pack) {
  const capture = validateSupplementalSessionCapture(input, { provider: "fantasyPros", expectedSeason: pack.season });
  if (!Array.isArray(capture.tables) || capture.tables.length !== 6) throw new Error("FantasyPros table coverage is incomplete.");
  const tableMap = new Map(capture.tables.map((table) => [table.position, table]));
  for (const [position, headers] of Object.entries(FP_HEADERS)) {
    const table = tableMap.get(position);
    if (!table || table.headers?.join("|") !== headers.join("|") || table.rowCount !== capture.rows.filter((row) => row.position === position).length) throw new Error(`FantasyPros ${position} columns or row count changed; capture stopped safely.`);
  }
  const indexes = positionIndexes(pack);
  const items = [];
  const seen = new Set();
  let unmatched = 0;
  for (const row of capture.rows) {
    const position = String(row.position || "").toUpperCase();
    if (!FP_HEADERS[position] || !Array.isArray(row.cells) || row.cells.length !== FP_HEADERS[position].length - 1) throw new Error("FantasyPros capture contains a malformed component-stat row.");
    const player = position === "DST"
      ? [...indexes.dstByTeam.values()].find((candidate) => canonicalPlayerIdentity(candidate.name, "DST", candidate.nflTeam).split("|")[0] === canonicalPlayerIdentity(row.playerName, "DST", candidate.nflTeam).split("|")[0]) || null
      : resolvePlayer(indexes, row, position, row.nflTeam);
    if (!player) { unmatched += 1; continue; }
    if (seen.has(player.id)) throw new Error(`FantasyPros capture repeats ${player.name}.`);
    seen.add(player.id);
    const { stats, providerPoints } = fantasyProsStats(row, position);
    const caveats = [];
    if (["QB", "RB", "WR", "TE"].includes(position)) caveats.push("FantasyPros does not publish two-point-conversion projections in this weekly table, so that Thunder Bowl category contributes no points for this source.");
    if (position === "K") caveats.push("FantasyPros does not split 50+ yard field goals in this weekly table, so Thunder Bowl's +2 long-field-goal bonus is omitted for this source.");
    if (position === "DST") caveats.push("FantasyPros does not publish blocked-kick or separate return-touchdown projections in this weekly table, so those Thunder Bowl categories contribute no points for this source.");
    items.push(item(player, capture, stats, providerPoints, caveats));
  }
  if (items.length < 400) throw new Error(`FantasyPros automatic projection coverage is unsafe (${items.length} matched rows; ${unmatched} unmatched).`);
  return snapshot(capture, pack, "fantasyPros", items, unmatched);
}

function pffOffenseStats(row) {
  const c = row.cells;
  const n = (index, label) => number(c[index], `PFF ${row.playerName} ${label}`);
  const stats = baseStats();
  Object.assign(stats, { passingYards: n(5, "pass yards"), passingTouchdowns: n(6, "pass TDs"), interceptionsThrown: n(7, "interceptions"), rushingYards: n(8, "rush yards"), rushingTouchdowns: n(9, "rush TDs"), receptions: n(10, "receptions"), receivingYards: n(11, "receiving yards"), receivingTouchdowns: n(12, "receiving TDs"), fieldGoalsMade: n(13, "field goals"), extraPointsMade: n(14, "extra points") });
  return { stats, providerPoints: n(4, "provider points") };
}

function pffDstStats(row) {
  const c = row.cells;
  const n = (index, label) => number(c[index], `PFF ${row.playerName} ${label}`);
  const stats = baseStats();
  Object.assign(stats, { defensiveSacks: n(5, "sacks"), defensiveSafeties: n(6, "safeties"), defensiveInterceptions: n(7, "interceptions"), defensiveFumblesRecovered: n(9, "fumble recoveries"), defensiveTouchdowns: n(10, "touchdowns"), kickReturnTouchdowns: n(12, "return touchdowns") });
  const expectedPointsAllowed = 10 * n(13, "0 PA probability") + 8 * n(14, "1-6 PA probability") + 6 * n(15, "7-13 PA probability") + 4 * n(16, "14-20 PA probability") - 4 * n(19, "35+ PA probability");
  return { stats, providerPoints: n(4, "provider points"), expectedPointsAllowed };
}

export function parsePffAuthenticatedCapture(input, pack) {
  const capture = validateSupplementalSessionCapture(input, { provider: "pff", expectedSeason: pack.season });
  if (capture.offenseHeaders?.join("|") !== PFF_OFFENSE_HEADERS.join("|") || capture.dstHeaders?.join("|") !== PFF_DST_HEADERS.join("|")) throw new Error("PFF changed its component-stat columns; capture stopped safely.");
  const indexes = positionIndexes(pack);
  const items = [];
  const seen = new Set();
  let unmatched = 0;
  for (const row of capture.rows) {
    const offense = row.kind === "offense";
    const expectedLength = offense ? PFF_OFFENSE_HEADERS.length : PFF_DST_HEADERS.length;
    if (!Array.isArray(row.cells) || row.cells.length !== expectedLength) throw new Error("PFF capture contains a malformed component-stat row.");
    const position = offense ? String(row.cells[1] || "").toUpperCase() : "DST";
    if (!FP_HEADERS[position]) { unmatched += 1; continue; }
    const team = normalizeTeam(row.cells[0]);
    const player = resolvePlayer(indexes, row, position, team);
    if (!player) { unmatched += 1; continue; }
    if (seen.has(player.id)) throw new Error(`PFF capture repeats ${player.name}.`);
    seen.add(player.id);
    if (offense) {
      const { stats, providerPoints } = pffOffenseStats(row);
      const caveats = ["PFF does not publish fumbles or two-point conversions in this weekly table, so those Thunder Bowl categories contribute no points for this source."];
      if (position === "K") caveats.push("PFF does not split 50+ yard field goals in this weekly table, so Thunder Bowl's +2 long-field-goal bonus is omitted for this source.");
      items.push(item(player, capture, stats, providerPoints, caveats));
    } else {
      const { stats, providerPoints, expectedPointsAllowed } = pffDstStats(row);
      const points = Math.round((scoreThunderBowlProjectedStats(stats, "") + expectedPointsAllowed) * 100) / 100;
      items.push(item(player, capture, stats, providerPoints, ["PFF publishes points-allowed probabilities rather than one total. Thunder Bowl tier points are probability-weighted; PFF's combined 35+ bucket receives the conservative -4 tier because 45+ is not separated.", "PFF does not publish blocked-kick projections in this table, so that Thunder Bowl category contributes no points for this source."], points));
    }
  }
  if (items.length < 200) throw new Error(`PFF automatic projection coverage is unsafe (${items.length} matched rows; ${unmatched} unmatched).`);
  return snapshot(capture, pack, "pff", items, unmatched);
}

export function validateSupplementalWeeklySnapshot(value, pack, expectedProvider = null) {
  if (!value || value.schemaVersion !== 1 || value.season !== pack.season || !SUPPLEMENTAL_PROVIDERS[value.provider] || (expectedProvider && value.provider !== expectedProvider)) throw new Error("Premium weekly snapshot failed its source contract.");
  if (!Number.isSafeInteger(value.week) || value.week < 1 || value.week > 18 || !Number.isFinite(Date.parse(value.capturedAt)) || !Number.isFinite(Date.parse(value.providerAsOf)) || Date.parse(value.providerAsOf) > Date.now() + 86_400_000 || !/^[a-f0-9]{64}$/.test(value.rawSha256 || "")) throw new Error("Premium weekly projection provenance is invalid.");
  if (!Array.isArray(value.items) || value.items.length !== value.itemCount) throw new Error("Premium weekly projection coverage does not reconcile.");
  const known = new Set(pack.players.map((player) => player.id));
  const ids = new Set();
  for (const row of value.items) {
    if (!known.has(row.playerId) || row.week !== value.week || !Number.isFinite(row.points) || row.points < -100 || row.points > 100 || !row.projectedStats || typeof row.projectedStats !== "object" || Array.isArray(row.projectedStats)) throw new Error("Premium weekly projection snapshot contains an invalid row.");
    if (ids.has(row.playerId)) throw new Error("Premium weekly projection snapshot repeats a player.");
    ids.add(row.playerId);
  }
  return value;
}
