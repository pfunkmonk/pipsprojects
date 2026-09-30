import { getStore } from "@netlify/blobs";

const db = () => getStore({ name: "thunder-bowl-2026-season", consistency: "strong" });
const key = "preferences/v1/roster-keep";

export const DEFAULT_KEEP_PLAYER_NAMES = Object.freeze([
  "Pittsburgh Steelers",
  "Jason Myers",
  "Harold Fannin Jr.",
]);

function fail(message) {
  const error = new Error(message);
  error.code = "INVALID_INPUT";
  throw error;
}

function normalizeIds(input) {
  if (!Array.isArray(input) || input.length > 20) fail("Keep preferences must contain at most 20 player IDs.");
  const ids = [...new Set(input.map((value) => String(value || "").trim()))];
  if (ids.some((value) => !/^[A-Za-z0-9._:-]{1,120}$/.test(value))) fail("Keep preferences contain an invalid player ID.");
  return ids.sort();
}

export async function readRosterKeepPreferences(store = db()) {
  const value = await store.get(key, { type: "json" });
  if (!value) return { schemaVersion: 1, initialized: false, keepPlayerIds: [], updatedAt: null };
  return {
    schemaVersion: 1,
    initialized: value.initialized === true,
    keepPlayerIds: normalizeIds(value.keepPlayerIds || []),
    updatedAt: Number.isFinite(Date.parse(value.updatedAt || "")) ? new Date(value.updatedAt).toISOString() : null,
  };
}

export async function saveRosterKeepPreferences(keepPlayerIds, { now = new Date(), store = db() } = {}) {
  const value = {
    schemaVersion: 1,
    initialized: true,
    keepPlayerIds: normalizeIds(keepPlayerIds),
    updatedAt: new Date(now).toISOString(),
  };
  await store.setJSON(key, value);
  return value;
}

export function resolveRosterKeepPreferences(stored, pack, leagueState, userTeamId = "dogs-of-war") {
  const team = (leagueState?.teams || []).find((candidate) => candidate.teamId === userTeamId);
  const rosterIds = new Set((team?.roster || []).map((entry) => entry.playerId));
  const playerById = new Map((pack?.players || []).map((player) => [player.id, player]));
  const defaultIds = (team?.roster || [])
    .filter((entry) => DEFAULT_KEEP_PLAYER_NAMES.includes(playerById.get(entry.playerId)?.name || entry.name))
    .map((entry) => entry.playerId);
  const requested = stored?.initialized ? stored.keepPlayerIds || [] : defaultIds;
  const keepPlayerIds = normalizeIds(requested).filter((playerId) => rosterIds.has(playerId) && playerById.has(playerId));
  return {
    schemaVersion: 1,
    initialized: stored?.initialized === true,
    keepPlayerIds,
    keepPlayers: keepPlayerIds.map((playerId) => {
      const player = playerById.get(playerId);
      return { playerId, name: player.name, position: player.position, nflTeam: player.nflTeam };
    }),
    updatedAt: stored?.updatedAt || null,
  };
}
