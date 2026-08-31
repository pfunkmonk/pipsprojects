export const CBS_CAPTURE_PROTOCOL_VERSION = 1;
export const CBS_CAPTURE_REQUEST = "THUNDER_BOWL_CBS_CAPTURE_REQUEST";
export const CBS_CAPTURE_RESPONSE = "THUNDER_BOWL_CBS_CAPTURE_RESPONSE";
export const CBS_APP_SOURCE = "thunder-bowl-app";
export const CBS_HELPER_SOURCE = "thunder-bowl-cbs-helper";
export const CBS_SNAPSHOT_SOURCE = "CBS Sports authenticated Thunder Bowl all-team roster report";
export const CBS_SNAPSHOT_MODEL_EFFECT = "none";
export const CBS_STARTER_REQUIREMENTS = Object.freeze({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 });
export const CBS_ROSTER_MINIMUM_SIZE = Object.values(CBS_STARTER_REQUIREMENTS).reduce((sum, value) => sum + value, 0);
export const CBS_ROSTER_MAXIMUM_SIZE = 14;
// Backward-compatible name retained for older consumers. Fourteen is a cap,
// not the number a team must carry after the draft.
export const CBS_BASE_ROSTER_SIZE = CBS_ROSTER_MAXIMUM_SIZE;

export const CBS_TEAM_CATALOG = Object.freeze([
  { teamId: "angry-face", cbsTeamId: 1, name: "Angry Face" },
  { teamId: "orange-crush", cbsTeamId: 2, name: "Orange Crush" },
  { teamId: "big-head", cbsTeamId: 3, name: "Big Head" },
  { teamId: "dogs-of-war", cbsTeamId: 4, name: "Dogs of War" },
  { teamId: "t-dogs", cbsTeamId: 5, name: "T-Dogs" },
  { teamId: "super-suckers", cbsTeamId: 6, name: "Super Suckers" },
  { teamId: "three-amigos", cbsTeamId: 7, name: "Three Amigos" },
  { teamId: "goon-skwad", cbsTeamId: 8, name: "Goon Skwad" },
  { teamId: "el-guapo", cbsTeamId: 9, name: "El Guapo" },
  { teamId: "crime-and-punishment", cbsTeamId: 10, name: "Crime and Punishment" },
  { teamId: "the-hobbits", cbsTeamId: 11, name: "The Hobbits" },
  { teamId: "the-bungles", cbsTeamId: 12, name: "The Bungles" },
]);

const TEAM_BY_NAME = new Map(CBS_TEAM_CATALOG.map((team) => [team.name, team]));
const VALID_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);

export function cbsTeamRosterReadiness(players = []) {
  const counts = Object.fromEntries(Object.keys(CBS_STARTER_REQUIREMENTS).map((position) => [position, 0]));
  for (const player of players) if (counts[player?.position] !== undefined) counts[player.position] += 1;
  const missingSlots = Object.entries(CBS_STARTER_REQUIREMENTS)
    .flatMap(([position, required]) => Array.from({ length: Math.max(0, required - counts[position]) }, () => position));
  const rosterSize = players.length;
  return {
    rosterSize,
    counts,
    missingSlots,
    belowMinimum: rosterSize < CBS_ROSTER_MINIMUM_SIZE,
    aboveMaximum: rosterSize > CBS_ROSTER_MAXIMUM_SIZE,
    legal: missingSlots.length === 0 && rosterSize >= CBS_ROSTER_MINIMUM_SIZE && rosterSize <= CBS_ROSTER_MAXIMUM_SIZE,
  };
}

export function cbsLeagueRosterReadiness(teams = []) {
  const teamStatuses = teams.map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName || team.name,
    ...cbsTeamRosterReadiness(team.roster || team.players || []),
  }));
  const legalTeamCount = teamStatuses.filter((team) => team.legal).length;
  return {
    rosterMinimum: CBS_ROSTER_MINIMUM_SIZE,
    rosterMaximum: CBS_ROSTER_MAXIMUM_SIZE,
    legalTeamCount,
    rostersReady: teamStatuses.length === CBS_TEAM_CATALOG.length && legalTeamCount === teamStatuses.length,
    teamStatuses,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteOrNull(value, field) {
  if (value === null) return null;
  assert(Number.isFinite(value), `${field} must be a number or null.`);
  return value;
}

function validatePlayer(player, teamName) {
  assert(isPlainObject(player), `${teamName} contains a malformed player row.`);
  assert(/^\d{1,10}$/.test(player.cbsPlayerId || ""), `${teamName} has an invalid CBS player ID.`);
  assert(typeof player.name === "string" && player.name.trim().length >= 2 && player.name.length <= 80, `${teamName} has an invalid player name.`);
  assert(VALID_POSITIONS.has(player.position), `${player.name} has an unsupported position.`);
  assert(/^[A-Z]{2,3}$/.test(player.nflTeam || ""), `${player.name} has an invalid NFL team.`);
  assert(Number.isSafeInteger(player.salary) && player.salary >= 0 && player.salary <= 200, `${player.name} has an invalid salary.`);
  assert(Number.isSafeInteger(player.contractYear) && player.contractYear >= 1 && player.contractYear <= 3, `${player.name} has an invalid contract year.`);
  finiteOrNull(player.priorSeasonPoints, `${player.name} prior-season points`);
  finiteOrNull(player.threeYearAverage, `${player.name} three-year average`);
  finiteOrNull(player.projectedPoints, `${player.name} projection`);
  for (const optional of ["overUnder", "positionRank", "opponentVsPosition", "rosteredPercent", "startedPercent"]) {
    finiteOrNull(player[optional], `${player.name} ${optional}`);
  }
  assert(player.opponent === null || typeof player.opponent === "string", `${player.name} has an invalid opponent.`);
  assert(player.gameTime === null || typeof player.gameTime === "string", `${player.name} has an invalid game time.`);
  assert(player.bye === null || Number.isSafeInteger(player.bye), `${player.name} has an invalid bye week.`);
  assert(Array.isArray(player.newsTitles) && player.newsTitles.length <= 10 && player.newsTitles.every((value) => typeof value === "string" && value.length <= 240), `${player.name} has invalid news markers.`);
  assert(Array.isArray(player.markerClasses) && player.markerClasses.length <= 20 && player.markerClasses.every((value) => typeof value === "string" && value.length <= 100), `${player.name} has invalid icon markers.`);
}

function validateProjectionRow(row, week) {
  assert(isPlainObject(row), "CBS weekly projections contain a malformed player row.");
  assert(/^\d{1,10}$/.test(row.cbsPlayerId || ""), "CBS weekly projections contain an invalid player ID.");
  assert(typeof row.name === "string" && row.name.trim().length >= 2 && row.name.length <= 80, "CBS weekly projections contain an invalid player name.");
  assert(VALID_POSITIONS.has(row.position), `${row.name} has an unsupported projection position.`);
  assert(/^[A-Z]{2,3}$/.test(row.nflTeam || ""), `${row.name} has an invalid projection NFL team.`);
  assert(row.week === week, `${row.name} has a projection for the wrong week.`);
  assert(isPlainObject(row.projectedStats), `${row.name} has malformed projected stats.`);
  for (const [key, value] of Object.entries(row.projectedStats)) {
    assert(/^[a-z][A-Za-z0-9]+$/.test(key) && (value === null || (Number.isFinite(value) && value >= -1000 && value <= 100000)), `${row.name} has an invalid ${key} projection.`);
  }
  finiteOrNull(row.providerPoints, `${row.name} CBS projected points`);
  assert(row.opponent === null || typeof row.opponent === "string", `${row.name} has an invalid projection opponent.`);
}

export function validateCbsRosterSnapshot(input, { expectedSeason = 2026 } = {}) {
  assert(isPlainObject(input), "CBS roster capture is not an object.");
  assert(input.schemaVersion === 1, "CBS roster capture has an unsupported schema.");
  assert(input.source === CBS_SNAPSHOT_SOURCE, "CBS roster capture has an unexpected source.");
  assert(input.modelEffect === CBS_SNAPSHOT_MODEL_EFFECT, "CBS roster capture attempted to gain model authority.");
  assert(Number.isFinite(Date.parse(input.capturedAt)), "CBS roster capture has an invalid timestamp.");
  assert(input.season === expectedSeason, `CBS roster capture is for ${input.season || "an unknown season"}, not ${expectedSeason}.`);
  const pageUrl = new URL(input.pageUrl);
  assert(pageUrl.origin === "https://berrymvp.football.cbssports.com", "CBS roster capture came from the wrong origin.");
  assert(pageUrl.pathname === "/teams/all" || pageUrl.pathname === `/teams/roster-report/all/${expectedSeason}/`, "CBS roster capture came from an unexpected report.");
  assert(Array.isArray(input.teams) && input.teams.length === CBS_TEAM_CATALOG.length, "CBS roster capture must contain all 12 teams.");

  const seenTeams = new Set();
  const seenPlayers = new Set();
  let playerCount = 0;
  for (const team of input.teams) {
    assert(isPlainObject(team), "CBS roster capture contains a malformed team.");
    const expected = TEAM_BY_NAME.get(team.name);
    assert(expected && expected.teamId === team.teamId && expected.cbsTeamId === team.cbsTeamId, `CBS roster capture contains an unknown team mapping: ${team.name || "unnamed"}.`);
    assert(!seenTeams.has(team.teamId), `CBS roster capture repeats ${team.name}.`);
    seenTeams.add(team.teamId);
    assert(Array.isArray(team.players) && team.players.length >= 1 && team.players.length <= CBS_ROSTER_MAXIMUM_SIZE, `${team.name} must have 1 to ${CBS_ROSTER_MAXIMUM_SIZE} rostered players.`);
    for (const player of team.players) {
      validatePlayer(player, team.name);
      assert(!seenPlayers.has(player.cbsPlayerId), `CBS player ${player.cbsPlayerId} appears on more than one team.`);
      seenPlayers.add(player.cbsPlayerId);
      playerCount += 1;
    }
  }
  assert(seenTeams.size === CBS_TEAM_CATALOG.length, "CBS roster capture is missing a known team.");
  assert(input.teamCount === CBS_TEAM_CATALOG.length, "CBS roster capture team count does not match its rows.");
  assert(input.playerCount === playerCount, "CBS roster capture player count does not match its rows.");
  if (input.weeklyProjections !== undefined) {
    assert(Number.isSafeInteger(input.projectionWeek) && input.projectionWeek >= 1 && input.projectionWeek <= 18, "CBS weekly projections require a valid week.");
    assert(Array.isArray(input.weeklyProjections) && input.weeklyProjections.length === input.projectionCount && input.weeklyProjections.length >= 100 && input.weeklyProjections.length <= 600, "CBS weekly projection coverage is unsafe.");
    const seenProjectionIds = new Set();
    for (const row of input.weeklyProjections) {
      validateProjectionRow(row, input.projectionWeek);
      assert(!seenProjectionIds.has(row.cbsPlayerId), `CBS weekly projections repeat ${row.cbsPlayerId}.`);
      seenProjectionIds.add(row.cbsPlayerId);
    }
  }
  return input;
}

function playerIndex(snapshot) {
  return new Map(snapshot.teams.flatMap((team) => team.players.map((player) => [player.cbsPlayerId, { ...player, teamId: team.teamId, teamName: team.name }])));
}

export function compareCbsRosterSnapshots(previous, current) {
  validateCbsRosterSnapshot(current, { expectedSeason: current.season });
  if (!previous) return { baseline: true, added: current.playerCount, removed: 0, moved: 0, contractChanges: 0, totalChanges: current.playerCount };
  validateCbsRosterSnapshot(previous, { expectedSeason: current.season });
  const before = playerIndex(previous);
  const after = playerIndex(current);
  let added = 0;
  let removed = 0;
  let moved = 0;
  let contractChanges = 0;
  for (const [id, player] of after) {
    const prior = before.get(id);
    if (!prior) added += 1;
    else {
      if (prior.teamId !== player.teamId) moved += 1;
      if (prior.salary !== player.salary || prior.contractYear !== player.contractYear) contractChanges += 1;
    }
  }
  for (const id of before.keys()) if (!after.has(id)) removed += 1;
  return { baseline: false, added, removed, moved, contractChanges, totalChanges: added + removed + moved + contractChanges };
}

export function requestCbsRosterCapture({ targetWindow = window, origin = window.location.origin, timeoutMs = 45000, week = 1 } = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      targetWindow.removeEventListener("message", onMessage);
      reject(new Error("The one-click helper did not answer. Install or enable the Thunder Bowl Data Helper, then try again."));
    }, timeoutMs);
    function onMessage(event) {
      const data = event.data;
      if (event.source !== targetWindow || event.origin !== origin || !isPlainObject(data)) return;
      if (data.source !== CBS_HELPER_SOURCE || data.type !== CBS_CAPTURE_RESPONSE || data.protocolVersion !== CBS_CAPTURE_PROTOCOL_VERSION || data.requestId !== requestId) return;
      clearTimeout(timeout);
      targetWindow.removeEventListener("message", onMessage);
      if (!data.ok) reject(new Error(typeof data.error === "string" ? data.error : "CBS helper could not capture the roster report."));
      else resolve(validateCbsRosterSnapshot(data.snapshot));
    }
    targetWindow.addEventListener("message", onMessage);
    targetWindow.postMessage({
      source: CBS_APP_SOURCE,
      type: CBS_CAPTURE_REQUEST,
      protocolVersion: CBS_CAPTURE_PROTOCOL_VERSION,
      requestId,
      week,
    }, origin);
  });
}
