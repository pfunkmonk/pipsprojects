const CBS_ORIGIN = "https://berrymvp.football.cbssports.com";
const HEAD_TO_HEAD_PERIODS = Object.freeze(Array.from({ length: 13 }, (_, index) => index + 1));

function normalizedPath(value) {
  const path = value.replace(/\/+$/, "");
  return path || "/";
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function periodNumber(headers) {
  const match = clean((headers || []).join(" ")).match(/\bPeriod\s+(1[0-3]|[1-9])\b/i);
  return match ? Number(match[1]) : null;
}

function teamsIn(value, teamNames) {
  const text = clean(value).toLowerCase();
  return teamNames.filter((name) => text.includes(name.toLowerCase()));
}

export function cbsScheduleUrlMatches(currentUrl, expectedUrl) {
  try {
    const current = new URL(currentUrl);
    const expected = new URL(expectedUrl);
    if (current.origin !== CBS_ORIGIN || expected.origin !== CBS_ORIGIN) return false;
    if (normalizedPath(current.pathname) !== normalizedPath(expected.pathname)) return false;
    return [...expected.searchParams].every(([key, value]) => current.searchParams.get(key) === value);
  } catch {
    return false;
  }
}

export function renderedCbsScheduleReady(captured, currentUrl, expectedUrl, teamNames) {
  if (!cbsScheduleUrlMatches(currentUrl, expectedUrl) || captured?.teamHits < 2) return false;
  const expected = new URL(expectedUrl);
  if (!/^\/schedule\/full\/?$/i.test(expected.pathname)) return true;
  // The catalog can contain historical aliases for renamed CBS teams. Require
  // all 12 currently rendered teams, but do not mistake an extra alias for a
  // thirteenth franchise or require the obsolete display name to be present.
  if (!Array.isArray(teamNames) || teamNames.length < 12) return false;
  const coverage = new Map();
  for (const table of captured?.page?.tables || []) {
    const period = periodNumber(table.headers);
    if (!HEAD_TO_HEAD_PERIODS.includes(period)) continue;
    const matchupRows = (table.rows || []).filter((row) => teamsIn(row.join(" "), teamNames).length === 2);
    const periodTeams = new Set(matchupRows.flatMap((row) => teamsIn(row.join(" "), teamNames)));
    coverage.set(period, { matchupCount: matchupRows.length, teamCount: periodTeams.size });
  }
  return HEAD_TO_HEAD_PERIODS.every((period) => coverage.get(period)?.matchupCount === 6 && coverage.get(period)?.teamCount === 12);
}
