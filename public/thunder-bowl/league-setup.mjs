export const LEAGUE_SETUP_SCHEMA_VERSION = 1;
export const LEAGUE_SETUP_KIND = "thunder-bowl-league-setup";
export const USER_TEAM_ID = "dogs-of-war";

const TEAM_IDS_2026 = Object.freeze([
  "angry-face",
  "big-head",
  "crime-and-punishment",
  "dogs-of-war",
  "el-guapo",
  "goon-skwad",
  "orange-crush",
  "super-suckers",
  "t-dogs",
  "the-bungles",
  "the-hobbits",
  "three-amigos",
]);

export const DEFAULT_LEAGUE_SETUP_2026 = Object.freeze({
  schemaVersion: LEAGUE_SETUP_SCHEMA_VERSION,
  kind: LEAGUE_SETUP_KIND,
  season: 2026,
  userTeamId: USER_TEAM_ID,
  regularSeasonWeeks: 14,
  divisions: Object.freeze([
    Object.freeze({ name: "West", teamIds: Object.freeze(["dogs-of-war", "t-dogs", "three-amigos"]) }),
    Object.freeze({ name: "East", teamIds: Object.freeze(["el-guapo", "orange-crush", "super-suckers"]) }),
    Object.freeze({ name: "North", teamIds: Object.freeze(["angry-face", "the-hobbits", "the-bungles"]) }),
    Object.freeze({ name: "South", teamIds: Object.freeze(["big-head", "goon-skwad", "crime-and-punishment"]) }),
  ]),
  userSchedule: Object.freeze([
    Object.freeze({ week: 1, format: "head_to_head", opponentTeamId: "three-amigos" }),
    Object.freeze({ week: 2, format: "head_to_head", opponentTeamId: "t-dogs" }),
    Object.freeze({ week: 3, format: "head_to_head", opponentTeamId: "el-guapo" }),
    Object.freeze({ week: 4, format: "head_to_head", opponentTeamId: "super-suckers" }),
    Object.freeze({ week: 5, format: "head_to_head", opponentTeamId: "orange-crush" }),
    Object.freeze({ week: 6, format: "head_to_head", opponentTeamId: "goon-skwad" }),
    Object.freeze({ week: 7, format: "head_to_head", opponentTeamId: "big-head" }),
    Object.freeze({ week: 8, format: "head_to_head", opponentTeamId: "crime-and-punishment" }),
    Object.freeze({ week: 9, format: "head_to_head", opponentTeamId: "the-hobbits" }),
    Object.freeze({ week: 10, format: "head_to_head", opponentTeamId: "angry-face" }),
    Object.freeze({ week: 11, format: "head_to_head", opponentTeamId: "the-bungles" }),
    Object.freeze({ week: 12, format: "head_to_head", opponentTeamId: "three-amigos" }),
    Object.freeze({ week: 13, format: "head_to_head", opponentTeamId: "t-dogs" }),
    Object.freeze({ week: 14, format: "all_play", opponentTeamId: null }),
  ]),
  playoffWeeks: Object.freeze([15, 16, 17]),
  playoffQualification: Object.freeze({ divisionWinners: 4, wildCards: 2 }),
  source: "CBS Sports 2026 divisions and schedule; Week 14 confirmed all-play by commissioner",
  asOf: "2026-08-09T00:00:00.000Z",
});

function fail(message) {
  throw new RangeError(message);
}

function integer(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    fail(`${label} must be a whole number from ${minimum} through ${maximum}.`);
  }
  return number;
}

function text(value, label, minimum = 1, maximum = 100) {
  const normalized = String(value || "").trim();
  if (normalized.length < minimum || normalized.length > maximum) fail(`${label} is invalid.`);
  return normalized;
}

function exactKeys(input, required, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(`${label} must be an object.`);
  const keys = Object.keys(input).sort();
  const expected = [...required].sort();
  if (keys.join("|") !== expected.join("|")) fail(`${label} has an unsupported field.`);
}

function knownTeamIds(teams) {
  const source = Array.isArray(teams) && teams.length ? teams.map((team) => team.id) : TEAM_IDS_2026;
  const ids = source.map((id) => text(id, "Team id", 2, 80));
  if (new Set(ids).size !== ids.length) fail("League teams must be unique.");
  return ids;
}

export function validateLeagueSetup(input, { teams, expectedSeason } = {}) {
  exactKeys(input, [
    "schemaVersion", "kind", "season", "userTeamId", "regularSeasonWeeks", "divisions", "userSchedule",
    "playoffWeeks", "playoffQualification", "source", "asOf",
  ], "League setup");
  if (input.schemaVersion !== LEAGUE_SETUP_SCHEMA_VERSION || input.kind !== LEAGUE_SETUP_KIND) {
    fail("This is not a supported Thunder Bowl league-setup file.");
  }
  const season = integer(input.season, "Season", 2020, 2100);
  if (expectedSeason !== undefined && season !== Number(expectedSeason)) {
    fail(`League setup season ${season} does not match the loaded ${expectedSeason} draft pack.`);
  }
  const teamIds = knownTeamIds(teams);
  const teamSet = new Set(teamIds);
  const userTeamId = text(input.userTeamId, "User team id", 2, 80);
  if (!teamSet.has(userTeamId)) fail("The user team is not in the loaded league.");
  const regularSeasonWeeks = integer(input.regularSeasonWeeks, "Regular-season weeks", 1, 18);

  if (!Array.isArray(input.divisions) || input.divisions.length < 2 || input.divisions.length > 12) {
    fail("League setup must contain 2-12 divisions.");
  }
  const divisionNames = new Set();
  const assignedTeams = [];
  const divisions = input.divisions.map((division, index) => {
    exactKeys(division, ["name", "teamIds"], `Division ${index + 1}`);
    const name = text(division.name, `Division ${index + 1} name`, 2, 40);
    if (divisionNames.has(name.toLowerCase())) fail("Division names must be unique.");
    divisionNames.add(name.toLowerCase());
    if (!Array.isArray(division.teamIds) || !division.teamIds.length) fail(`${name} must contain at least one team.`);
    const normalizedTeamIds = division.teamIds.map((teamId) => text(teamId, `${name} team id`, 2, 80));
    normalizedTeamIds.forEach((teamId) => {
      if (!teamSet.has(teamId)) fail(`${teamId} is not in the loaded league.`);
      assignedTeams.push(teamId);
    });
    return { name, teamIds: normalizedTeamIds };
  });
  if (assignedTeams.length !== teamIds.length || new Set(assignedTeams).size !== teamIds.length) {
    fail("Every league team must appear in exactly one division.");
  }

  if (!Array.isArray(input.userSchedule) || input.userSchedule.length !== regularSeasonWeeks) {
    fail(`Dogs of War's schedule must contain Weeks 1-${regularSeasonWeeks}.`);
  }
  const userSchedule = input.userSchedule.map((row, index) => {
    exactKeys(row, ["week", "format", "opponentTeamId"], `Schedule Week ${index + 1}`);
    const week = integer(row.week, `Schedule Week ${index + 1}`, 1, regularSeasonWeeks);
    if (week !== index + 1) fail(`Schedule must list every week once in order from 1-${regularSeasonWeeks}.`);
    const format = text(row.format, `Week ${week} format`, 3, 30);
    if (!["head_to_head", "all_play"].includes(format)) fail(`Week ${week} must be head-to-head or all-play.`);
    const opponentTeamId = row.opponentTeamId == null ? null : text(row.opponentTeamId, `Week ${week} opponent`, 2, 80);
    if (format === "head_to_head") {
      if (!opponentTeamId || !teamSet.has(opponentTeamId) || opponentTeamId === userTeamId) {
        fail(`Week ${week} requires another league team as the opponent.`);
      }
    } else if (opponentTeamId !== null) {
      fail(`Week ${week} is all-play and cannot have a head-to-head opponent.`);
    }
    return { week, format, opponentTeamId };
  });

  if (!Array.isArray(input.playoffWeeks) || !input.playoffWeeks.length || input.playoffWeeks.length > 5) {
    fail("League setup must contain 1-5 playoff weeks.");
  }
  const playoffWeeks = input.playoffWeeks.map((week, index) => integer(week, `Playoff week ${index + 1}`, regularSeasonWeeks + 1, 18));
  if (new Set(playoffWeeks).size !== playoffWeeks.length || playoffWeeks.some((week, index) => index > 0 && week <= playoffWeeks[index - 1])) {
    fail("Playoff weeks must be unique and listed in ascending order.");
  }
  exactKeys(input.playoffQualification, ["divisionWinners", "wildCards"], "Playoff qualification");
  const divisionWinners = integer(input.playoffQualification.divisionWinners, "Division winners", 0, teamIds.length);
  const wildCards = integer(input.playoffQualification.wildCards, "Wild cards", 0, teamIds.length);
  if (divisionWinners !== divisions.length) fail("Division-winner berths must equal the number of divisions.");
  if (divisionWinners + wildCards > teamIds.length) fail("Playoff berths cannot exceed the league size.");
  const asOf = text(input.asOf, "League setup timestamp", 10, 40);
  if (!Number.isFinite(Date.parse(asOf))) fail("League setup timestamp is invalid.");

  return {
    schemaVersion: LEAGUE_SETUP_SCHEMA_VERSION,
    kind: LEAGUE_SETUP_KIND,
    season,
    userTeamId,
    regularSeasonWeeks,
    divisions,
    userSchedule,
    playoffWeeks,
    playoffQualification: { divisionWinners, wildCards },
    source: text(input.source, "League setup source", 3, 160),
    asOf: new Date(asOf).toISOString(),
  };
}

export function deriveLeagueScheduleContext(setupInput, options = {}) {
  const setup = validateLeagueSetup(setupInput, options);
  const teamNames = new Map((options.teams || []).map((team) => [team.id, team.name]));
  const division = setup.divisions.find((row) => row.teamIds.includes(setup.userTeamId));
  const rivalIds = division.teamIds.filter((teamId) => teamId !== setup.userTeamId);
  const divisionWeeks = setup.userSchedule
    .filter((row) => row.format === "head_to_head" && rivalIds.includes(row.opponentTeamId))
    .map((row) => ({
      week: row.week,
      opponentTeamId: row.opponentTeamId,
      opponent: teamNames.get(row.opponentTeamId) || row.opponentTeamId,
    }));
  const allPlayWeeks = setup.userSchedule.filter((row) => row.format === "all_play").map((row) => row.week);
  return {
    season: setup.season,
    division: division.name,
    divisionRivalIds: rivalIds,
    divisionRivals: rivalIds.map((teamId) => teamNames.get(teamId) || teamId),
    divisionWeeks,
    allPlayWeeks,
    playoffWeeks: [...setup.playoffWeeks],
    playoffQualification: { ...setup.playoffQualification },
    source: setup.source,
    asOf: setup.asOf,
  };
}

export function effectiveWeeklyContext(packWeeklyContext, setupInput, options = {}) {
  if (!packWeeklyContext || !setupInput) return packWeeklyContext || null;
  const derived = deriveLeagueScheduleContext(setupInput, options);
  return {
    ...packWeeklyContext,
    divisionWeeks: derived.divisionWeeks.map((row) => row.week),
    playoffWeeks: [...derived.playoffWeeks],
  };
}

export function cloneDefaultLeagueSetup2026() {
  return JSON.parse(JSON.stringify(DEFAULT_LEAGUE_SETUP_2026));
}
