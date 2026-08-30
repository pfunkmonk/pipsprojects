import { createHash } from "node:crypto";
import { validateCbsRosterSnapshot } from "../../../public/thunder-bowl/cbs-roster-snapshot.mjs";
import { canonicalPlayerIdentity, replayDraft } from "../../../public/thunder-bowl/state-engine.mjs";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function packIndexes(pack) {
  const exact = new Map();
  const loose = new Map();
  for (const player of pack.players || []) {
    const identity = canonicalPlayerIdentity(player.name, player.position, player.nflTeam);
    if (exact.has(identity)) throw new Error(`The protected pack repeats player identity ${identity}.`);
    exact.set(identity, player);
    const looseKey = identity.split("|").slice(0, 2).join("|");
    const rows = loose.get(looseKey) || [];
    rows.push(player);
    loose.set(looseKey, rows);
  }
  return { exact, loose };
}

function resolvePlayer(player, indexes) {
  const identity = canonicalPlayerIdentity(player.name, player.position, player.nflTeam);
  const exact = indexes.exact.get(identity);
  if (exact) return { player: exact, resolution: "exact" };
  const loose = indexes.loose.get(identity.split("|").slice(0, 2).join("|")) || [];
  if (loose.length === 1) return { player: loose[0], resolution: "unique_name_position_team_drift" };
  if (loose.length > 1) throw new Error(`${player.name} is ambiguous after CBS NFL-team drift.`);
  throw new Error(`${player.name} (${player.position}, ${player.nflTeam}) is not in the governed player catalog.`);
}

export function canonicalizeCbsLeagueSnapshot(input, pack) {
  const snapshot = validateCbsRosterSnapshot(input, { expectedSeason: pack.season });
  if (Date.parse(snapshot.capturedAt) > Date.now() + 15 * 60_000) throw new Error("CBS roster capture timestamp is unexpectedly in the future.");
  const indexes = packIndexes(pack);
  const seenPlayerIds = new Set();
  const cbsIds = new Set();
  const teamDrift = [];
  const teams = snapshot.teams.map((team) => ({
    teamId: team.teamId,
    teamName: team.name,
    cbsTeamId: team.cbsTeamId,
    roster: team.players.map((row) => {
      const resolved = resolvePlayer(row, indexes);
      if (seenPlayerIds.has(resolved.player.id)) throw new Error(`${resolved.player.name} resolves to more than one CBS roster row.`);
      if (cbsIds.has(row.cbsPlayerId)) throw new Error(`CBS player ${row.cbsPlayerId} appears more than once.`);
      seenPlayerIds.add(resolved.player.id);
      cbsIds.add(row.cbsPlayerId);
      if (resolved.resolution !== "exact") teamDrift.push({ playerId: resolved.player.id, cbsNflTeam: row.nflTeam, packNflTeam: resolved.player.nflTeam });
      return {
        playerId: resolved.player.id,
        cbsPlayerId: row.cbsPlayerId,
        name: resolved.player.name,
        position: resolved.player.position,
        nflTeam: row.nflTeam,
        salary: row.salary,
        contractYear: row.contractYear,
        opponent: row.opponent,
        gameTime: row.gameTime,
        bye: row.bye,
        projectedPoints: row.projectedPoints,
        newsTitles: [...row.newsTitles],
        markerClasses: [...row.markerClasses],
      };
    }),
  }));
  const availablePlayerIds = pack.players.map((player) => player.id).filter((id) => !seenPlayerIds.has(id));
  return {
    schemaVersion: 1,
    season: pack.season,
    source: "CBS Sports authenticated Thunder Bowl all-team roster report",
    authority: "authenticated league roster and availability authority",
    capturedAt: snapshot.capturedAt,
    providerAsOf: snapshot.capturedAt,
    reportId: new URL(snapshot.pageUrl).pathname,
    rawSha256: sha256(snapshot),
    teamCount: teams.length,
    rosteredPlayerCount: seenPlayerIds.size,
    availablePlayerCount: availablePlayerIds.length,
    teamDrift,
    teams,
    rosteredPlayerIds: [...seenPlayerIds],
    availablePlayerIds,
  };
}

export function validateCanonicalCbsLeagueState(value, pack) {
  if (!value || value.schemaVersion !== 1 || value.season !== pack.season || value.authority !== "authenticated league roster and availability authority") throw new Error("CBS league state failed its source contract.");
  if (!Number.isFinite(Date.parse(value.capturedAt)) || Date.parse(value.capturedAt) > Date.now() + 15 * 60_000 || !/^[a-f0-9]{64}$/.test(value.rawSha256 || "")) throw new Error("CBS league provenance is invalid.");
  if (!Array.isArray(value.teams) || value.teams.length !== 12 || value.teamCount !== 12) throw new Error("CBS league state must contain all 12 teams.");
  const knownIds = new Set(pack.players.map((player) => player.id));
  const rostered = value.teams.flatMap((team) => team.roster || []);
  if (rostered.length !== value.rosteredPlayerCount || new Set(rostered.map((player) => player.playerId)).size !== rostered.length) throw new Error("CBS league roster coverage does not reconcile.");
  if (rostered.some((player) => !knownIds.has(player.playerId) || !Number.isSafeInteger(player.salary) || !Number.isSafeInteger(player.contractYear))) throw new Error("CBS league state contains an invalid roster row.");
  if (!Array.isArray(value.availablePlayerIds) || value.availablePlayerIds.length !== value.availablePlayerCount || value.availablePlayerIds.some((id) => !knownIds.has(id))) throw new Error("CBS availability coverage is invalid.");
  const available = new Set(value.availablePlayerIds);
  if (rostered.some((player) => available.has(player.playerId)) || rostered.length + available.size !== knownIds.size) throw new Error("CBS rostered and available players do not partition the governed catalog.");
  return value;
}

export function leagueStateFromFinalLedger({ ledger, pack }) {
  const document = ledger?.document || ledger;
  const state = replayDraft(document?.events || []);
  const teams = Object.values(state.teams).map((team) => ({
    teamId: team.id,
    teamName: team.name,
    roster: team.roster.map((row) => ({
      playerId: row.playerId,
      name: row.playerName,
      position: row.position,
      nflTeam: row.nflTeam,
      salary: row.price,
      contractYear: row.keeperYear ?? null,
      opponent: null,
      gameTime: null,
      bye: pack.players.find((player) => player.id === row.playerId)?.weeklyProjection?.byeWeek ?? null,
      projectedPoints: null,
      newsTitles: [],
      markerClasses: [],
    })),
  }));
  const rosteredPlayerIds = teams.flatMap((team) => team.roster.map((player) => player.playerId));
  if (teams.length !== 12 || rosteredPlayerIds.length !== 168 || new Set(rosteredPlayerIds).size !== 168) {
    throw new Error("The locked final ledger does not yet contain 12 complete 14-player rosters.");
  }
  return {
    schemaVersion: 1,
    season: pack.season,
    source: "Thunder Bowl production-locked final auction ledger",
    authority: "week-one roster baseline only; not current CBS availability",
    capturedAt: document.updatedAt,
    providerAsOf: document.updatedAt,
    reportId: `ledger-generation-${document.generation}`,
    rawSha256: sha256(document.events),
    teamCount: teams.length,
    rosteredPlayerCount: rosteredPlayerIds.length,
    availablePlayerCount: null,
    teamDrift: [],
    teams,
    rosteredPlayerIds,
    availablePlayerIds: null,
  };
}
