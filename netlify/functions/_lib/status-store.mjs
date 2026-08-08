import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const STORE_NAME = "thunder-bowl-2026-status";
const SOURCE_URL = "https://api.sleeper.app/v1/players/nfl";
const STATUS_SCHEMA_VERSION = 2;
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);
const NAME_ALIASES = new Map(Object.entries({
  andresborregales: "andyborregales",
  kenwalker: "kennethwalker",
  kennethgainwell: "kennygainwell",
  christopherbrooks: "chrisbrooks",
  chigoziemokonkwo: "chigokonkwo",
  matthewhibner: "matthibner",
  scottmiller: "scottymiller",
  mitchtrubisky: "mitchelltrubisky",
}));
const TEAM_ALIASES = new Map([["JAC", "JAX"]]);

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function canonicalPosition(value) {
  const position = String(value || "").toUpperCase();
  return ["DEF", "D/ST"].includes(position) ? "DST" : position;
}

function canonicalTeam(value) {
  const team = String(value || "").toUpperCase();
  return TEAM_ALIASES.get(team) || team;
}

function playerName(player) {
  return String(player.full_name || `${player.first_name || ""} ${player.last_name || ""}`).trim();
}

export function statusUniverseHash(pack) {
  if (!pack || typeof pack !== "object" || !Array.isArray(pack.players) || !pack.players.length) {
    throw new Error("The active draft pack is unavailable to the live-status adapter.");
  }
  const playerIds = new Set();
  const identities = pack.players.map((player) => {
    if (!player || typeof player.id !== "string" || typeof player.name !== "string" || typeof player.position !== "string" || typeof player.nflTeam !== "string") {
      throw new Error("The active draft pack contains an invalid live-status identity.");
    }
    if (playerIds.has(player.id)) throw new Error("The active draft pack contains duplicate live-status identities.");
    playerIds.add(player.id);
    return [player.id, normalizeName(player.name), canonicalPosition(player.position), canonicalTeam(player.nflTeam)].join("|");
  }).sort();
  return createHash("sha256").update(identities.join("\n")).digest("hex");
}

export function statusCacheKeys(pack, effectiveDate = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error("Live-status cache date is invalid.");
  const universeHash = statusUniverseHash(pack);
  return {
    universeHash,
    dailyKey: `sleeper/v${STATUS_SCHEMA_VERSION}/${effectiveDate}/${universeHash}`,
    latestKey: `sleeper/v${STATUS_SCHEMA_VERSION}/latest/${universeHash}`,
  };
}

function newsTimestamp(value) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : null;
}

function statusSeverity(player) {
  const evidence = [player.status, player.injury_status, player.practice_participation].filter(Boolean).join(" ").toLowerCase();
  if (["injured reserve", "out", "suspend", "physically unable", "pup"].some((term) => evidence.includes(term))) return "critical";
  if (evidence.includes("doubtful")) return "high";
  if (["questionable", "limited"].some((term) => evidence.includes(term))) return "moderate";
  if (player.active === true || evidence.includes("active")) return "clear";
  return "unknown";
}

function statusFreshness(newsUpdated, capturedAt) {
  if (!newsUpdated) return { freshness: "undated", ageDays: null };
  const ageDays = Math.max(0, (Date.parse(capturedAt) - Date.parse(newsUpdated)) / 86_400_000);
  if (!Number.isFinite(ageDays)) return { freshness: "invalid", ageDays: null };
  return { freshness: ageDays <= 14 ? "fresh" : "stale", ageDays: Number(ageDays.toFixed(2)) };
}

export function buildStatusSnapshot(pack, payload, capturedAt = new Date().toISOString()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length < 1000) {
    throw new Error("Sleeper player response did not contain the expected player map.");
  }
  const byNamePosition = new Map();
  const byTeamPosition = new Map();
  for (const [sleeperId, player] of Object.entries(payload)) {
    if (!player || typeof player !== "object" || Array.isArray(player)) continue;
    const position = canonicalPosition(player.position);
    const fantasyPositions = (player.fantasy_positions || []).map(canonicalPosition);
    const positions = new Set([position, ...fantasyPositions].filter((candidate) => POSITIONS.has(candidate)));
    const name = playerName(player);
    const normalizedName = normalizeName(name);
    const team = canonicalTeam(player.team);
    const newsUpdated = newsTimestamp(player.news_updated);
    const freshness = statusFreshness(newsUpdated, capturedAt);
    const depthChartOrder = Number(player.depth_chart_order);
    const row = {
      sleeperPlayerId: String(player.player_id || sleeperId),
      name,
      team,
      active: player.active === true,
      status: String(player.status || ""),
      injuryStatus: String(player.injury_status || ""),
      injuryBodyPart: String(player.injury_body_part || ""),
      injuryStartDate: String(player.injury_start_date || ""),
      injuryNotes: String(player.injury_notes || ""),
      practiceParticipation: String(player.practice_participation || ""),
      practiceDescription: String(player.practice_description || ""),
      depthChartPosition: String(player.depth_chart_position || ""),
      depthChartOrder: Number.isInteger(depthChartOrder) && depthChartOrder >= 1 && depthChartOrder <= 20 ? depthChartOrder : null,
      severity: statusSeverity(player),
      freshness: freshness.freshness,
      statusAgeDays: freshness.ageDays,
      newsUpdated,
    };
    for (const eligiblePosition of positions) {
      const nameKey = `${normalizedName}|${eligiblePosition}`;
      const teamKey = `${team}|${eligiblePosition}`;
      if (!byNamePosition.has(nameKey)) byNamePosition.set(nameKey, []);
      byNamePosition.get(nameKey).push(row);
      if (team) {
        if (!byTeamPosition.has(teamKey)) byTeamPosition.set(teamKey, []);
        byTeamPosition.get(teamKey).push(row);
      }
    }
  }

  const updates = [];
  let ambiguous = 0;
  for (const player of pack.players) {
    const originalName = normalizeName(player.name);
    const lookupName = NAME_ALIASES.get(originalName) || originalName;
    let candidates = byNamePosition.get(`${lookupName}|${player.position}`) || [];
    let matchMethod = lookupName === originalName ? "exact_name_position" : "name_alias_position";
    if (candidates.length > 1) {
      const sameTeam = candidates.filter((candidate) => candidate.team === canonicalTeam(player.nflTeam));
      candidates = sameTeam.length ? sameTeam : candidates;
      matchMethod = "name_position_team_tiebreak";
    }
    if (!candidates.length && player.position === "DST") {
      candidates = byTeamPosition.get(`${canonicalTeam(player.nflTeam)}|DST`) || [];
      matchMethod = "dst_team_position";
    }
    if (candidates.length !== 1) {
      if (candidates.length > 1) ambiguous += 1;
      continue;
    }
    updates.push({ playerId: player.id, matchMethod, ...candidates[0] });
  }
  updates.sort((left, right) => left.playerId.localeCompare(right.playerId));
  const rawSha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    source: "Sleeper NFL player map",
    sourceUrl: SOURCE_URL,
    authority: "supplemental status; no value effect",
    capturedAt,
    effectiveDate: capturedAt.slice(0, 10),
    packId: pack.packId,
    playerUniverseHash: statusUniverseHash(pack),
    rawPlayers: Object.keys(payload).length,
    rawSha256,
    matchedPlayers: updates.length,
    ambiguousPlayers: ambiguous,
    freshActionablePlayers: updates.filter((row) => row.freshness === "fresh" && ["critical", "high", "moderate"].includes(row.severity)).length,
    modelEffect: "none",
    updates,
  };
}

function validateSnapshot(value) {
  if (!value || value.schemaVersion !== STATUS_SCHEMA_VERSION || value.source !== "Sleeper NFL player map" || value.modelEffect !== "none" || !Array.isArray(value.updates) || !/^[a-f0-9]{64}$/.test(value.playerUniverseHash || "")) {
    throw new Error("Stored Sleeper status snapshot is invalid.");
  }
  if (value.matchedPlayers !== value.updates.length || new Set(value.updates.map((update) => update?.playerId)).size !== value.updates.length) {
    throw new Error("Stored Sleeper status snapshot contains inconsistent player identities.");
  }
  return value;
}

async function readStored(key) {
  const entry = await store().getWithMetadata(key, { consistency: "strong", type: "json" });
  return entry?.data ? validateSnapshot(entry.data) : null;
}

export function rebindStatusSnapshot(pack, value) {
  const snapshot = validateSnapshot(value);
  const universeHash = statusUniverseHash(pack);
  if (snapshot.playerUniverseHash !== universeHash) {
    throw new Error("Stored Sleeper status snapshot belongs to a different player universe.");
  }
  const knownPlayers = new Set(pack.players.map((player) => player.id));
  if (snapshot.updates.some((update) => !knownPlayers.has(update.playerId))) {
    throw new Error("Stored Sleeper status snapshot contains a player outside the active pack.");
  }
  return snapshot.packId === pack.packId ? snapshot : { ...snapshot, packId: pack.packId };
}

export async function currentStatusSnapshot(pack, { force = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const { dailyKey, latestKey } = statusCacheKeys(pack, today);
  const daily = force ? null : await readStored(dailyKey);
  if (daily) return rebindStatusSnapshot(pack, daily);
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { "User-Agent": "Thunder-Bowl-2026 private personal-use status adapter" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Sleeper returned ${response.status}.`);
    const payload = await response.json();
    const snapshot = buildStatusSnapshot(pack, payload);
    let winner = snapshot;
    if (force) {
      await store().setJSON(dailyKey, snapshot);
    } else {
      const write = await store().setJSON(dailyKey, snapshot, { onlyIfNew: true });
      winner = write.modified ? snapshot : await readStored(dailyKey);
    }
    const rebound = rebindStatusSnapshot(pack, winner);
    await store().setJSON(latestKey, rebound);
    return rebound;
  } catch (error) {
    const latest = await readStored(latestKey);
    if (latest) return { ...rebindStatusSnapshot(pack, latest), staleFallback: true, refreshError: error.message };
    throw error;
  }
}
