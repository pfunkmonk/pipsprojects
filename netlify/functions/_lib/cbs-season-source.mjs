import { createHash } from "node:crypto";
import {
  CBS_ROSTER_MAXIMUM_SIZE,
  cbsLeagueRosterReadiness,
  validateCbsRosterSnapshot,
} from "../../../public/thunder-bowl/cbs-roster-snapshot.mjs";
import { canonicalPlayerIdentity } from "../../../public/thunder-bowl/state-engine.mjs";
import { scoreThunderBowlProjectedStats, THUNDER_BOWL_SCORING_FINGERPRINT } from "./thunder-bowl-scoring.mjs";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalNflTeam(value) {
  return canonicalPlayerIdentity("team", "DST", value).split("|").at(-1);
}

function packIndexes(pack) {
  const exact = new Map();
  const loose = new Map();
  const defenseByTeam = new Map();
  for (const player of pack.players || []) {
    const identity = canonicalPlayerIdentity(player.name, player.position, player.nflTeam);
    if (exact.has(identity)) throw new Error(`The protected pack repeats player identity ${identity}.`);
    exact.set(identity, player);
    const looseKey = identity.split("|").slice(0, 2).join("|");
    const rows = loose.get(looseKey) || [];
    rows.push(player);
    loose.set(looseKey, rows);
    if (player.position === "DST") {
      const nflTeam = canonicalNflTeam(player.nflTeam);
      if (defenseByTeam.has(nflTeam)) throw new Error(`The protected pack repeats the ${nflTeam} defense.`);
      defenseByTeam.set(nflTeam, player);
    }
  }
  return { exact, loose, defenseByTeam };
}

function resolvePlayer(player, indexes) {
  const identity = canonicalPlayerIdentity(player.name, player.position, player.nflTeam);
  const exact = indexes.exact.get(identity);
  if (exact) return { player: exact, resolution: "exact" };
  if (player.position === "DST") {
    const defense = indexes.defenseByTeam.get(canonicalNflTeam(player.nflTeam));
    if (defense) return { player: defense, resolution: "dst_team_alias" };
  }
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
      if (resolved.resolution === "unique_name_position_team_drift") teamDrift.push({ playerId: resolved.player.id, cbsNflTeam: row.nflTeam, packNflTeam: resolved.player.nflTeam });
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
  const readiness = cbsLeagueRosterReadiness(teams);
  const projectedIds = new Set();
  let unmatchedProjectionCount = 0;
  const weeklyProjections = [];
  for (const row of snapshot.weeklyProjections || []) {
    let resolved;
    try {
      resolved = resolvePlayer(row, indexes).player;
    } catch {
      unmatchedProjectionCount += 1;
      continue;
    }
    if (projectedIds.has(resolved.id)) continue;
    projectedIds.add(resolved.id);
    weeklyProjections.push({
      playerId: resolved.id,
      playerName: resolved.name,
      position: resolved.position,
      nflTeam: row.nflTeam,
      week: row.week,
      points: scoreThunderBowlProjectedStats(row.projectedStats, resolved.position),
      providerPoints: row.providerPoints,
      projectedStats: { ...row.projectedStats },
      opponent: row.opponent,
      providerAsOf: snapshot.capturedAt,
      source: "CBS Sports authenticated weekly component projections",
      scoringFingerprint: THUNDER_BOWL_SCORING_FINGERPRINT,
      scoringCaveats: resolved.position === "DST"
        ? ["CBS standard projections do not expose blocked-kick or return-touchdown components."]
        : ["QB", "RB", "WR", "TE"].includes(resolved.position)
          ? ["CBS standard projections do not expose two-point-conversion components."]
          : [],
    });
  }
  weeklyProjections.sort((left, right) => left.playerId.localeCompare(right.playerId));
  const fabState = snapshot.fabState ? {
    schemaVersion: snapshot.fabState.schemaVersion,
    source: snapshot.fabState.source,
    capturedAt: snapshot.fabState.capturedAt,
    week: snapshot.fabState.week,
    status: snapshot.fabState.status,
    rules: structuredClone(snapshot.fabState.rules),
    coverage: structuredClone(snapshot.fabState.coverage),
    teams: snapshot.fabState.teams.map((team) => ({
      teamId: team.teamId,
      teamName: team.name,
      cbsTeamId: team.cbsTeamId,
      remainingBudget: team.remainingBudget,
      fabOrder: team.fabOrder,
      record: team.record ? { ...team.record } : null,
      weeklySuccessfulPickups: team.weeklySuccessfulPickups,
    })),
    pageUrls: [...snapshot.fabState.pageUrls],
  } : null;
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
    rosterMinimum: readiness.rosterMinimum,
    rosterMaximum: readiness.rosterMaximum,
    legalTeamCount: readiness.legalTeamCount,
    rostersReady: readiness.rostersReady,
    teamStatuses: readiness.teamStatuses,
    // Legacy aliases retained while cached clients and stored plans migrate.
    rosterTarget: readiness.rosterMaximum,
    completeTeamCount: readiness.legalTeamCount,
    rostersComplete: readiness.rostersReady,
    rosteredPlayerCount: seenPlayerIds.size,
    availablePlayerCount: availablePlayerIds.length,
    teamDrift,
    teams,
    rosteredPlayerIds: [...seenPlayerIds],
    availablePlayerIds,
    projectionWeek: snapshot.projectionWeek ?? null,
    projectionCount: weeklyProjections.length,
    unmatchedProjectionCount,
    weeklyProjections,
    fabState,
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
  if (value.teams.some((team) => !Array.isArray(team.roster) || team.roster.length < 1 || team.roster.length > CBS_ROSTER_MAXIMUM_SIZE)) throw new Error("CBS league state contains an invalid roster size.");
  const readiness = cbsLeagueRosterReadiness(value.teams);
  const weeklyProjections = Array.isArray(value.weeklyProjections) ? value.weeklyProjections : [];
  const projectionIds = new Set();
  for (const row of weeklyProjections) {
    if (!knownIds.has(row.playerId) || !Number.isSafeInteger(row.week) || row.week < 1 || row.week > 18 || !Number.isFinite(row.points) || row.points < -100 || row.points > 100 || !row.projectedStats || typeof row.projectedStats !== "object") throw new Error("CBS weekly projection state contains an invalid row.");
    if (projectionIds.has(row.playerId)) throw new Error("CBS weekly projection state repeats a player.");
    projectionIds.add(row.playerId);
  }
  const fabState = value.fabState ?? null;
  if (fabState !== null) {
    if (fabState.schemaVersion !== 1 || !["COMPLETE", "PARTIAL"].includes(fabState.status) || !Array.isArray(fabState.teams) || fabState.teams.length !== 12) throw new Error("CBS FAB state failed its source contract.");
    const ids = new Set(value.teams.map((team) => team.teamId));
    const orders = new Set();
    for (const team of fabState.teams) {
      if (!ids.has(team.teamId) || (team.remainingBudget !== null && (!Number.isSafeInteger(team.remainingBudget) || team.remainingBudget < 0 || team.remainingBudget > 50)) || (team.fabOrder !== null && (!Number.isSafeInteger(team.fabOrder) || team.fabOrder < 1 || team.fabOrder > 12))) throw new Error("CBS FAB state contains an invalid team row.");
      if (team.fabOrder !== null) {
        if (orders.has(team.fabOrder)) throw new Error("CBS FAB state repeats an order position.");
        orders.add(team.fabOrder);
      }
    }
  }
  return {
    ...value,
    rosterMinimum: readiness.rosterMinimum,
    rosterMaximum: readiness.rosterMaximum,
    legalTeamCount: readiness.legalTeamCount,
    rostersReady: readiness.rostersReady,
    teamStatuses: readiness.teamStatuses,
    rosterTarget: readiness.rosterMaximum,
    completeTeamCount: readiness.legalTeamCount,
    rostersComplete: readiness.rostersReady,
    projectionWeek: Number.isSafeInteger(value.projectionWeek) ? value.projectionWeek : null,
    projectionCount: weeklyProjections.length,
    weeklyProjections,
    fabState,
  };
}
