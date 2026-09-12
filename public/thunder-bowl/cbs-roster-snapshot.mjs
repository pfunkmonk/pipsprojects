export const CBS_CAPTURE_PROTOCOL_VERSION = 2;
export const CBS_REQUIRED_HELPER_VERSION = "0.10.6";
export const CBS_COMPATIBLE_HELPER_VERSIONS = Object.freeze([CBS_REQUIRED_HELPER_VERSION, "0.10.5"]);
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
const VALID_FAB_NIGHTS = ["TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const CBS_SCHEDULE_SOURCE = "CBS Sports authenticated Thunder Bowl league schedule";
const CBS_SCORING_PREVIEW_SOURCE = "CBS Sports authenticated Thunder Bowl scoring preview";
const CBS_HEAD_TO_HEAD_WEEKS = Array.from({ length: 13 }, (_, index) => index + 1);
const CBS_SCORING_PREVIEW_MAX_ERRORS = 40;

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

function materializeRawCbsEvidence(input) {
  if (!isPlainObject(input?.rawLeagueSchedule)) return input;
  const rawSchedule = input.rawLeagueSchedule;
  assert(rawSchedule.schemaVersion === 1 && Number.isFinite(Date.parse(rawSchedule.capturedAt)), "Raw CBS schedule capture has invalid timing.");
  assert(Array.isArray(rawSchedule.pages) && rawSchedule.pages.length >= 1 && rawSchedule.pages.length <= 30, "Raw CBS schedule capture has invalid page coverage.");
  for (const page of rawSchedule.pages) {
    assert(isPlainObject(page) && new URL(page.url).origin === "https://berrymvp.football.cbssports.com", "Raw CBS schedule capture came from the wrong origin.");
    assert(typeof page.title === "string" && page.title.length <= 300 && typeof page.text === "string" && page.text.length <= 5_000, "Raw CBS schedule capture contains oversized page text.");
    assert(Array.isArray(page.tables) && page.tables.length <= 30 && Array.isArray(page.blocks) && page.blocks.length <= 500, "Raw CBS schedule capture contains malformed page sections.");
  }
  const leagueSchedule = normalizeCbsSchedulePages(rawSchedule.pages, rawSchedule.capturedAt);
  let scoringPreview = input.scoringPreview;
  if (isPlainObject(input.rawScoringPreview)) {
    const rawPreview = input.rawScoringPreview;
    assert(rawPreview.schemaVersion === 1 && rawPreview.week === input.projectionWeek && Number.isFinite(Date.parse(rawPreview.capturedAt)), "Raw CBS scoring preview has invalid timing.");
    assert(Array.isArray(rawPreview.rows) && rawPreview.rows.length <= 1_000, "Raw CBS scoring preview has invalid player coverage.");
    scoringPreview = normalizeCbsScoringPreviewRows({
      rows: rawPreview.rows,
      teams: input.teams,
      leagueSchedule,
      week: rawPreview.week,
      capturedAt: rawPreview.capturedAt,
      pageUrl: rawPreview.pageUrl,
      pageTitle: rawPreview.pageTitle,
      captureError: rawPreview.captureError,
      allMatchups: rawPreview.allMatchups === true,
    });
  }
  const { rawLeagueSchedule: _rawLeagueSchedule, rawScoringPreview: _rawScoringPreview, ...rest } = input;
  return { ...rest, leagueSchedule, ...(scoringPreview ? { scoringPreview } : {}) };
}

function validateFabState(value, week) {
  assert(isPlainObject(value) && value.schemaVersion === 1, "CBS FAB capture has an unsupported schema.");
  assert(value.source === "CBS Sports authenticated Thunder Bowl FAB, standings, and transaction pages", "CBS FAB capture has an unexpected source.");
  assert(Number.isFinite(Date.parse(value.capturedAt)) && value.week === week, "CBS FAB capture has invalid timing.");
  assert(["COMPLETE", "PARTIAL"].includes(value.status), "CBS FAB capture has an invalid status.");
  const rules = value.rules;
  assert(isPlainObject(rules) && rules.startingBudget === 50 && rules.minimumBid === 1 && rules.zeroDollarBidsAllowed === false && rules.allPlayersUseFab === true, "CBS FAB capture does not match the current $50 blind-auction rules.");
  assert(JSON.stringify(rules.processingNights) === JSON.stringify(VALID_FAB_NIGHTS), "CBS FAB capture has the wrong processing nights.");
  assert(rules.weeklyPriorityReset === "REVERSE_STANDINGS" && JSON.stringify(rules.equalBidTieBreakers) === JSON.stringify(["WORST_RECORD", "FEWEST_WEEKLY_PICKUPS", "FAB_ORDER"]) && rules.sequentialWinsLowerPriority === true, "CBS FAB capture has the wrong tie rules.");
  assert(rules.winningBidBecomesSalary === true && rules.dropPeriodDays === 1, "CBS FAB capture has the wrong acquisition rules.");
  assert(Array.isArray(value.teams) && value.teams.length === CBS_TEAM_CATALOG.length, "CBS FAB capture must cover all 12 teams.");
  const seenOrders = new Set();
  for (const team of value.teams) {
    const expected = CBS_TEAM_CATALOG.find((candidate) => candidate.teamId === team.teamId);
    assert(expected && expected.cbsTeamId === team.cbsTeamId && expected.name === team.name, "CBS FAB capture contains an unknown team.");
    assert(team.remainingBudget === null || (Number.isSafeInteger(team.remainingBudget) && team.remainingBudget >= 0 && team.remainingBudget <= 50), `${team.name} has an invalid FAB balance.`);
    assert(team.fabOrder === null || (Number.isSafeInteger(team.fabOrder) && team.fabOrder >= 1 && team.fabOrder <= 12), `${team.name} has an invalid FAB order.`);
    if (team.fabOrder !== null) {
      assert(!seenOrders.has(team.fabOrder), "CBS FAB capture repeats a FAB-order position.");
      seenOrders.add(team.fabOrder);
    }
    assert(team.weeklySuccessfulPickups === null || (Number.isSafeInteger(team.weeklySuccessfulPickups) && team.weeklySuccessfulPickups >= 0 && team.weeklySuccessfulPickups <= 50), `${team.name} has an invalid weekly pickup count.`);
    assert(team.record === null || (Number.isSafeInteger(team.record.wins) && Number.isSafeInteger(team.record.losses) && Number.isSafeInteger(team.record.ties) && team.record.wins >= 0 && team.record.losses >= 0 && team.record.ties >= 0), `${team.name} has an invalid record.`);
  }
  assert(Array.isArray(value.pageUrls) && value.pageUrls.every((pageUrl) => new URL(pageUrl).origin === "https://berrymvp.football.cbssports.com"), "CBS FAB capture contains an invalid source page.");
}

function validateLeagueSchedule(value, season) {
  assert(isPlainObject(value) && value.schemaVersion === 1, "CBS league schedule has an unsupported schema.");
  assert(value.source === CBS_SCHEDULE_SOURCE && value.modelEffect === "opponent_identification_only", "CBS league schedule has an unexpected authority boundary.");
  assert(value.season === season && Number.isFinite(Date.parse(value.capturedAt)), "CBS league schedule has invalid timing or season data.");
  assert(JSON.stringify(value.headToHeadWeeks) === JSON.stringify(CBS_HEAD_TO_HEAD_WEEKS) && JSON.stringify(value.allPlayWeeks) === JSON.stringify([14]), "CBS league schedule has the wrong scoring periods.");
  assert(Array.isArray(value.matchups) && value.matchups.length === 78 && value.matchupCount === value.matchups.length, "CBS league schedule must contain six matchups for Weeks 1–13.");
  const knownTeams = new Map(CBS_TEAM_CATALOG.map((team) => [team.teamId, team]));
  for (const week of CBS_HEAD_TO_HEAD_WEEKS) {
    const rows = value.matchups.filter((row) => row.week === week);
    const seen = new Set();
    assert(rows.length === 6, `CBS league schedule Week ${week} must contain six matchups.`);
    for (const row of rows) {
      const left = knownTeams.get(row.teamAId);
      const right = knownTeams.get(row.teamBId);
      assert(left && right && left.teamId !== right.teamId && row.teamAName === left.name && row.teamBName === right.name, `CBS league schedule Week ${week} contains an unknown matchup.`);
      assert(!seen.has(left.teamId) && !seen.has(right.teamId), `CBS league schedule Week ${week} repeats a team.`);
      seen.add(left.teamId);
      seen.add(right.teamId);
    }
    assert(seen.size === CBS_TEAM_CATALOG.length, `CBS league schedule Week ${week} does not cover all teams.`);
  }
  assert(Array.isArray(value.pageUrls) && value.pageUrls.length >= 1 && value.pageUrls.every((pageUrl) => new URL(pageUrl).origin === "https://berrymvp.football.cbssports.com"), "CBS league schedule contains an invalid source page.");
}

function validateScoringPreview(value, snapshot, season) {
  assert(isPlainObject(value) && value.schemaVersion === 1, "CBS scoring preview has an unsupported schema.");
  assert(value.source === CBS_SCORING_PREVIEW_SOURCE && ["submitted_lineup_authority_only", "submitted_lineup_and_actual_score_authority"].includes(value.modelEffect), "CBS scoring preview has an unexpected authority boundary.");
  assert(value.season === season && value.week === snapshot.projectionWeek && Number.isFinite(Date.parse(value.capturedAt)), "CBS scoring preview has invalid timing or season data.");
  assert(["COMPLETE", "PARTIAL"].includes(value.status), "CBS scoring preview has an invalid status.");
  assert(value.pageUrl === null || new URL(value.pageUrl).origin === "https://berrymvp.football.cbssports.com", "CBS scoring preview came from the wrong origin.");
  const coverageScope = value.coverageScope || "MATCHUP";
  assert(["MATCHUP", "LEAGUE"].includes(coverageScope), "CBS scoring preview has an invalid coverage scope.");
  assert(Array.isArray(value.teams) && value.teams.length <= CBS_TEAM_CATALOG.length, "CBS scoring preview contains too many teams.");
  // A league-wide capture can legitimately report two coverage diagnostics for
  // each of the 12 teams, plus page-level diagnostics. Keep the strings tightly
  // bounded, but allow the complete league audit to reach the validator.
  assert(Array.isArray(value.errors) && value.errors.length <= CBS_SCORING_PREVIEW_MAX_ERRORS && value.errors.every((error) => typeof error === "string" && error.length <= 500), "CBS scoring preview contains invalid capture diagnostics.");
  const rosterByTeam = new Map(snapshot.teams.map((team) => [team.teamId, new Map(team.players.map((player) => [player.cbsPlayerId, player]))]));
  const seenTeams = new Set();
  for (const team of value.teams) {
    const expected = CBS_TEAM_CATALOG.find((candidate) => candidate.teamId === team.teamId);
    assert(expected && expected.name === team.teamName && expected.cbsTeamId === team.cbsTeamId && !seenTeams.has(team.teamId), "CBS scoring preview contains an unknown or repeated team.");
    seenTeams.add(team.teamId);
    const roster = rosterByTeam.get(team.teamId);
    const rows = [...(team.starters || []), ...(team.bench || [])];
    const seenPlayers = new Set();
    for (const player of rows) {
      const rosterPlayer = roster?.get(player.cbsPlayerId);
      assert(rosterPlayer && rosterPlayer.name === player.name && rosterPlayer.position === player.position && rosterPlayer.nflTeam === player.nflTeam, `${player.name || "A scoring-preview player"} does not reconcile with the CBS roster report.`);
      assert(!seenPlayers.has(player.cbsPlayerId), `${player.name} appears more than once in the CBS scoring preview.`);
      seenPlayers.add(player.cbsPlayerId);
      const actualPoints = player.actualPoints ?? null;
      const scoreStatus = player.scoreStatus || "NOT_STARTED";
      assert(actualPoints === null || (Number.isFinite(actualPoints) && actualPoints >= -100 && actualPoints <= 200), `${player.name} has an invalid CBS actual score.`);
      assert(["NOT_STARTED", "LIVE", "FINAL"].includes(scoreStatus), `${player.name} has an invalid CBS scoring status.`);
      assert(scoreStatus === "NOT_STARTED" ? actualPoints === null : Number.isFinite(actualPoints), `${player.name} has inconsistent CBS scoring evidence.`);
      assert(player.cbsLiveProjection == null || (Number.isFinite(player.cbsLiveProjection) && player.cbsLiveProjection >= -100 && player.cbsLiveProjection <= 200), `${player.name} has an invalid CBS live projection.`);
      assert(player.gameText == null || (typeof player.gameText === "string" && player.gameText.length <= 300), `${player.name} has invalid CBS game text.`);
      assert(player.statsText == null || (typeof player.statsText === "string" && player.statsText.length <= 500), `${player.name} has invalid CBS live statistics.`);
    }
    assert(isPlainObject(team.coverage), `${team.teamName} has invalid scoring-preview coverage.`);
    if (value.status === "COMPLETE") {
      assert(team.starters.length === CBS_ROSTER_MINIMUM_SIZE && rows.length === roster.size && team.coverage.exactStarters === true && team.coverage.completeRoster === true, `${team.teamName} has incomplete CBS scoring-preview coverage.`);
      const counts = Object.fromEntries(Object.keys(CBS_STARTER_REQUIREMENTS).map((position) => [position, team.starters.filter((player) => player.position === position).length]));
      assert(JSON.stringify(counts) === JSON.stringify(CBS_STARTER_REQUIREMENTS), `${team.teamName} has an invalid submitted CBS lineup.`);
    }
  }
  if (value.status === "COMPLETE") {
    const expectedTeams = coverageScope === "LEAGUE" ? CBS_TEAM_CATALOG.length : 2;
    assert(value.teams.length === expectedTeams && value.errors.length === 0, `A complete CBS scoring preview must contain all ${expectedTeams} expected teams without capture errors.`);
  }
}

export function validateCbsRosterSnapshot(input, { expectedSeason = 2026 } = {}) {
  input = materializeRawCbsEvidence(input);
  assert(isPlainObject(input), "CBS roster capture is not an object.");
  assert(input.schemaVersion === 1, "CBS roster capture has an unsupported schema.");
  assert(input.source === CBS_SNAPSHOT_SOURCE, "CBS roster capture has an unexpected source.");
  assert(input.modelEffect === CBS_SNAPSHOT_MODEL_EFFECT, "CBS roster capture attempted to gain model authority.");
  assert(Number.isFinite(Date.parse(input.capturedAt)), "CBS roster capture has an invalid timestamp.");
  assert(input.season === expectedSeason, `CBS roster capture is for ${input.season || "an unknown season"}, not ${expectedSeason}.`);
  const pageUrl = new URL(input.pageUrl);
  assert(pageUrl.origin === "https://berrymvp.football.cbssports.com", "CBS roster capture came from the wrong origin.");
  assert(["/teams/all", "/teams/all/", `/teams/roster-report/all/${expectedSeason}`, `/teams/roster-report/all/${expectedSeason}/`].includes(pageUrl.pathname), "CBS roster capture came from an unexpected report.");
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
  assert(input.leagueSchedule !== undefined, "CBS league schedule is missing. Install the current Thunder Bowl Data Helper, reload the site, and update CBS again.");
  validateLeagueSchedule(input.leagueSchedule, expectedSeason);
  if (input.scoringPreview !== undefined) validateScoringPreview(input.scoringPreview, input, expectedSeason);
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
  if (input.fabState !== undefined) validateFabState(input.fabState, input.projectionWeek ?? 1);
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
      if (data.source !== CBS_HELPER_SOURCE || data.type !== CBS_CAPTURE_RESPONSE || data.protocolVersion !== CBS_CAPTURE_PROTOCOL_VERSION || !CBS_COMPATIBLE_HELPER_VERSIONS.includes(data.helperVersion) || data.requestId !== requestId) return;
      clearTimeout(timeout);
      targetWindow.removeEventListener("message", onMessage);
      if (!data.ok) {
        reject(new Error(typeof data.error === "string" ? data.error : "CBS helper could not capture the roster report."));
        return;
      }
      try {
        resolve(validateCbsRosterSnapshot(data.snapshot));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("CBS returned an unreadable roster snapshot."));
      }
    }
    targetWindow.addEventListener("message", onMessage);
    for (const expectedHelperVersion of CBS_COMPATIBLE_HELPER_VERSIONS) {
      targetWindow.postMessage({
        source: CBS_APP_SOURCE,
        type: CBS_CAPTURE_REQUEST,
        protocolVersion: CBS_CAPTURE_PROTOCOL_VERSION,
        expectedHelperVersion,
        requestId,
        week,
      }, origin);
    }
  });
}
import { normalizeCbsSchedulePages } from "./cbs-schedule-normalize.mjs";
import { normalizeCbsScoringPreviewRows } from "./cbs-scoring-preview-normalize.mjs";
