const TEAM_CATALOG = Object.freeze([
  ["angry-face", 1, "Angry Face", ["Muther Humpers"]], ["orange-crush", 2, "Orange Crush"],
  ["big-head", 3, "Big Head"], ["dogs-of-war", 4, "Dogs of War"],
  ["t-dogs", 5, "T-Dogs"], ["super-suckers", 6, "Super Suckers"],
  ["three-amigos", 7, "Three Amigos"], ["goon-skwad", 8, "Goon Skwad"],
  ["el-guapo", 9, "El Guapo"], ["crime-and-punishment", 10, "Crime and Punishment"],
  ["the-hobbits", 11, "The Hobbits"], ["the-bungles", 12, "The Bungles"],
].map(([teamId, cbsTeamId, name, aliases = []]) => ({ teamId, cbsTeamId, name, aliases })));

const TEAM_BY_NAME = new Map(TEAM_CATALOG.flatMap((team) => [team.name, ...team.aliases].map((name) => [name.toLowerCase(), team])));
const HEAD_TO_HEAD_WEEKS = Object.freeze(Array.from({ length: 13 }, (_, index) => index + 1));

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function weekNumber(value) {
  const text = clean(value);
  const labeled = text.match(/\b(?:week|period)\s*#?\s*(1[0-8]|[1-9])\b/i);
  if (labeled) return Number(labeled[1]);
  return /^(1[0-8]|[1-9])$/.test(text) ? Number(text) : null;
}

function pageWeek(page) {
  try {
    const url = new URL(page.url);
    for (const key of ["week", "period", "scoring_period", "scoringPeriod"]) {
      const value = Number(url.searchParams.get(key));
      if (Number.isSafeInteger(value) && value >= 1 && value <= 18) return value;
    }
    const path = url.pathname.match(/(?:week|period)[/-](1[0-8]|[1-9])(?:\/|$)/i);
    if (path) return Number(path[1]);
  } catch {
    // Source URL validation happens at the public capture boundary.
  }
  return weekNumber(`${page.title || ""} ${clean(page.text).slice(0, 2_000)}`);
}

function teamsIn(value) {
  const text = clean(value).toLowerCase();
  return TEAM_CATALOG.filter((team) => [team.name, ...team.aliases].some((name) => text.includes(name.toLowerCase())));
}

function addMatchup(target, week, left, right) {
  if (!HEAD_TO_HEAD_WEEKS.includes(week) || !left || !right || left.teamId === right.teamId) return;
  const pair = [left, right].sort((a, b) => a.cbsTeamId - b.cbsTeamId);
  const key = `${week}|${pair[0].teamId}|${pair[1].teamId}`;
  target.set(key, {
    week,
    teamAId: pair[0].teamId,
    teamAName: pair[0].name,
    teamBId: pair[1].teamId,
    teamBName: pair[1].name,
  });
}

function gridWeekColumns(headers) {
  return headers.map((header, index) => ({ index, week: weekNumber(header) })).filter((entry) => HEAD_TO_HEAD_WEEKS.includes(entry.week));
}

export function normalizeCbsSchedulePages(pages, capturedAt = new Date().toISOString()) {
  if (!Array.isArray(pages) || !Number.isFinite(Date.parse(capturedAt))) throw new Error("CBS schedule capture is malformed.");
  const matchups = new Map();
  for (const page of pages) {
    const fallbackWeek = pageWeek(page);
    const explicitPageWeeks = new Set((page.tables || []).flatMap((table) => [
      ...(table.headers || []),
      ...(table.rows || []).flat(),
    ]).map(weekNumber).filter((week) => HEAD_TO_HEAD_WEEKS.includes(week)));
    const isMultiWeekPage = explicitPageWeeks.size > 1;
    for (const block of page.blocks || []) {
      const blockTeams = teamsIn(block);
      // On CBS /schedule/full every matchup TR is also returned as a generic
      // block. Those rows do not carry their period number, so applying the
      // page's first visible period would incorrectly manufacture 66 Week 1
      // matchups. Structured tables below retain the correct period context.
      const blockWeek = weekNumber(block) || (isMultiWeekPage ? null : fallbackWeek);
      if (blockTeams.length === 2) addMatchup(matchups, blockWeek, blockTeams[0], blockTeams[1]);
    }
    for (const table of page.tables || []) {
      const headers = (table.headers || []).map(clean);
      const gridColumns = gridWeekColumns(headers);
      const tableWeek = headers.map(weekNumber).find((week) => HEAD_TO_HEAD_WEEKS.includes(week)) || fallbackWeek;
      // CBS renders /schedule/full as one table. Period 1 is the table header,
      // while later periods are separator rows inside that same table. Carry the
      // most recent separator forward so matchup rows are assigned to the period
      // that visually contains them instead of all inheriting Period 1.
      let activeWeek = tableWeek;
      for (const rawRow of table.rows || []) {
        const row = rawRow.map(clean);
        const explicitRowWeek = row.map(weekNumber).find((week) => HEAD_TO_HEAD_WEEKS.includes(week)) || null;
        if (explicitRowWeek) activeWeek = explicitRowWeek;
        const owner = row.slice(0, 2)
          .map((cell) => teamsIn(cell))
          .find((cellTeams) => cellTeams.length === 1)?.[0] || null;
        if (owner && gridColumns.length) {
          for (const column of gridColumns) {
            const opponent = teamsIn(row[column.index] || "").find((team) => team.teamId !== owner.teamId) || null;
            addMatchup(matchups, column.week, owner, opponent);
          }
        }
        const rowWeek = explicitRowWeek || activeWeek || tableWeek;
        const rowTeams = teamsIn(row.join(" "));
        if (rowTeams.length === 2) addMatchup(matchups, rowWeek, rowTeams[0], rowTeams[1]);
      }
    }
  }

  const normalized = [...matchups.values()].sort((left, right) => left.week - right.week || left.teamAName.localeCompare(right.teamAName));
  const incomplete = [];
  for (const week of HEAD_TO_HEAD_WEEKS) {
    const weekRows = normalized.filter((row) => row.week === week);
    const teams = new Set(weekRows.flatMap((row) => [row.teamAId, row.teamBId]));
    if (weekRows.length !== 6 || teams.size !== TEAM_CATALOG.length) incomplete.push(`Week ${week}: ${weekRows.length} matchups/${teams.size} teams`);
  }
  if (incomplete.length) throw new Error(`CBS league schedule coverage is incomplete (${incomplete.join("; ")}).`);

  return {
    schemaVersion: 1,
    source: "CBS Sports authenticated Thunder Bowl league schedule",
    modelEffect: "opponent_identification_only",
    capturedAt,
    season: 2026,
    headToHeadWeeks: [...HEAD_TO_HEAD_WEEKS],
    allPlayWeeks: [14],
    matchupCount: normalized.length,
    matchups: normalized,
    pageUrls: [...new Set(pages.map((page) => page.url).filter(Boolean))].sort(),
  };
}

export function scheduleOpponent(schedule, teamId, week) {
  if (schedule?.allPlayWeeks?.includes(week)) return { teamId: null, teamName: "All-play", allPlay: true };
  const matchup = schedule?.matchups?.find((row) => row.week === week && (row.teamAId === teamId || row.teamBId === teamId));
  if (!matchup) return null;
  return matchup.teamAId === teamId
    ? { teamId: matchup.teamBId, teamName: matchup.teamBName, allPlay: false }
    : { teamId: matchup.teamAId, teamName: matchup.teamAName, allPlay: false };
}

export const CBS_SCHEDULE_TEAM_CATALOG = TEAM_BY_NAME;
