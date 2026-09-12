import { scheduleOpponent } from "./cbs-schedule-normalize.mjs";

const STARTER_REQUIREMENTS = Object.freeze({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 });
const USER_TEAM_ID = "dogs-of-war";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function rosterCoverage(team, rows) {
  const counts = Object.fromEntries(Object.keys(STARTER_REQUIREMENTS).map((position) => [position, 0]));
  for (const row of rows) if (counts[row.position] !== undefined) counts[row.position] += 1;
  const exactStarters = Object.entries(STARTER_REQUIREMENTS).every(([position, required]) => counts[position] === required);
  return {
    exactStarters,
    counts,
    starterCount: rows.length,
    requiredStarterCount: Object.values(STARTER_REQUIREMENTS).reduce((sum, value) => sum + value, 0),
    rosterCount: team.players.length,
  };
}

function teamOutput(team, capturedRows) {
  const byPlayerId = new Map(team.players.map((player) => [player.cbsPlayerId, player]));
  const deduplicated = new Map();
  for (const raw of capturedRows) {
    const player = byPlayerId.get(String(raw.cbsPlayerId || ""));
    if (!player) continue;
    const candidate = {
      cbsPlayerId: player.cbsPlayerId,
      name: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      role: raw.role === "BENCH" ? "BENCH" : "STARTER",
      matchupIndex: Number.isSafeInteger(raw.matchupIndex) ? raw.matchupIndex : null,
      actualPoints: Number.isFinite(raw.actualPoints) ? raw.actualPoints : null,
      scoreStatus: ["NOT_STARTED", "LIVE", "FINAL"].includes(raw.scoreStatus) ? raw.scoreStatus : "NOT_STARTED",
      cbsLiveProjection: Number.isFinite(raw.cbsLiveProjection) ? raw.cbsLiveProjection : null,
      gameText: clean(raw.gameText).slice(0, 300) || null,
      statsText: clean(raw.statsText).slice(0, 500) || null,
      top: Number.isFinite(raw.top) ? raw.top : null,
    };
    const existing = deduplicated.get(candidate.cbsPlayerId);
    if (!existing || (candidate.top ?? Number.POSITIVE_INFINITY) < (existing.top ?? Number.POSITIVE_INFINITY)) deduplicated.set(candidate.cbsPlayerId, candidate);
  }
  const order = (left, right) => (left.top ?? Number.POSITIVE_INFINITY) - (right.top ?? Number.POSITIVE_INFINITY) || left.name.localeCompare(right.name);
  const starters = [...deduplicated.values()].filter((row) => row.role === "STARTER").sort(order).map(({ top, role, ...row }) => row);
  const bench = [...deduplicated.values()].filter((row) => row.role === "BENCH").sort(order).map(({ top, role, ...row }) => row);
  const coverage = rosterCoverage(team, starters);
  const capturedPlayerCount = starters.length + bench.length;
  const finalCount = starters.filter((row) => row.scoreStatus === "FINAL").length;
  const liveCount = starters.filter((row) => row.scoreStatus === "LIVE").length;
  const actualKnownCount = starters.filter((row) => Number.isFinite(row.actualPoints)).length;
  const currentPoints = actualKnownCount ? Math.round(starters.reduce((sum, row) => sum + (Number.isFinite(row.actualPoints) ? row.actualPoints : 0), 0) * 100) / 100 : null;
  return {
    teamId: team.teamId,
    teamName: team.name,
    cbsTeamId: team.cbsTeamId,
    starters,
    bench,
    actuals: {
      currentPoints,
      knownStarters: actualKnownCount,
      finalStarters: finalCount,
      liveStarters: liveCount,
      status: finalCount === starters.length && starters.length === 8 ? "FINAL" : actualKnownCount ? "LIVE" : "PREGAME",
    },
    coverage: {
      ...coverage,
      capturedPlayerCount,
      completeRoster: capturedPlayerCount === team.players.length,
    },
  };
}

export function normalizeCbsScoringPreviewRows({ rows = [], teams = [], leagueSchedule, week, capturedAt = new Date().toISOString(), pageUrl = "", pageTitle = "", captureError = null, allMatchups = false } = {}) {
  if (!Number.isSafeInteger(week) || week < 1 || week > 18 || !Number.isFinite(Date.parse(capturedAt))) throw new Error("CBS scoring preview capture has invalid timing.");
  const dogs = teams.find((team) => team.teamId === USER_TEAM_ID) || null;
  const opponent = scheduleOpponent(leagueSchedule, USER_TEAM_ID, week);
  const rival = opponent?.teamId ? teams.find((team) => team.teamId === opponent.teamId) || null : null;
  const sourceTeams = (allMatchups ? teams : [dogs, rival].filter(Boolean)).map((team) => teamOutput(team, rows));
  const coverageErrors = [];
  if (!dogs) coverageErrors.push("Dogs of War is missing from the CBS roster report.");
  if (!opponent || opponent.allPlay) coverageErrors.push(`CBS does not identify a head-to-head Dogs of War opponent for Week ${week}.`);
  if (opponent?.teamId && !rival) coverageErrors.push(`${opponent.teamName || "The opponent"} is missing from the CBS roster report.`);
  if (allMatchups && sourceTeams.length !== teams.length) coverageErrors.push(`CBS live scoring captured ${sourceTeams.length} of ${teams.length} league teams.`);
  for (const team of sourceTeams) {
    if (!team.coverage.exactStarters) coverageErrors.push(`${team.teamName} does not have exactly 1 QB, 2 RB, 2 WR, 1 TE, 1 K, and 1 DST in the captured CBS starting lineup.`);
    if (!team.coverage.completeRoster) coverageErrors.push(`${team.teamName} has ${team.coverage.capturedPlayerCount} of ${team.coverage.rosterCount} rostered players assigned to starters or reserves on the CBS preview.`);
  }
  const safePageUrl = (() => {
    try {
      const url = new URL(pageUrl);
      return url.origin === "https://berrymvp.football.cbssports.com" ? url.href : "";
    } catch {
      return "";
    }
  })();
  if (!safePageUrl) coverageErrors.push("The CBS scoring preview source page was not available.");
  if (captureError) coverageErrors.push(clean(captureError).slice(0, 500));
  const expectedTeamCount = allMatchups ? teams.length : 2;
  const status = sourceTeams.length === expectedTeamCount && coverageErrors.length === 0 ? "COMPLETE" : "PARTIAL";
  return {
    schemaVersion: 1,
    source: "CBS Sports authenticated Thunder Bowl scoring preview",
    modelEffect: "submitted_lineup_and_actual_score_authority",
    capturedAt,
    season: 2026,
    week,
    status,
    pageUrl: safePageUrl || null,
    pageTitle: clean(pageTitle).slice(0, 200) || null,
    coverageScope: allMatchups ? "LEAGUE" : "MATCHUP",
    teams: sourceTeams,
    errors: [...new Set(coverageErrors)],
  };
}

