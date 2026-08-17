export const NFL_TEAM_SCHEDULE_SOURCE = Object.freeze({
  season: 2026,
  name: "NFL 2026 schedule release",
  url: "https://www.nfl.com/_amp/2026-nfl-schedule-release-every-team-bye-week",
});

export const NFL_TEAMS_2026 = Object.freeze({
  ARI: { name: "Arizona Cardinals", shortName: "Cardinals", byeWeek: 14 },
  ATL: { name: "Atlanta Falcons", shortName: "Falcons", byeWeek: 11 },
  BAL: { name: "Baltimore Ravens", shortName: "Ravens", byeWeek: 13 },
  BUF: { name: "Buffalo Bills", shortName: "Bills", byeWeek: 7 },
  CAR: { name: "Carolina Panthers", shortName: "Panthers", byeWeek: 5 },
  CHI: { name: "Chicago Bears", shortName: "Bears", byeWeek: 10 },
  CIN: { name: "Cincinnati Bengals", shortName: "Bengals", byeWeek: 6 },
  CLE: { name: "Cleveland Browns", shortName: "Browns", byeWeek: 11 },
  DAL: { name: "Dallas Cowboys", shortName: "Cowboys", byeWeek: 14 },
  DEN: { name: "Denver Broncos", shortName: "Broncos", byeWeek: 10 },
  DET: { name: "Detroit Lions", shortName: "Lions", byeWeek: 6 },
  GB: { name: "Green Bay Packers", shortName: "Packers", byeWeek: 11 },
  HOU: { name: "Houston Texans", shortName: "Texans", byeWeek: 8 },
  IND: { name: "Indianapolis Colts", shortName: "Colts", byeWeek: 13 },
  JAX: { name: "Jacksonville Jaguars", shortName: "Jaguars", byeWeek: 7 },
  KC: { name: "Kansas City Chiefs", shortName: "Chiefs", byeWeek: 5 },
  LAC: { name: "Los Angeles Chargers", shortName: "Chargers", byeWeek: 7 },
  LAR: { name: "Los Angeles Rams", shortName: "Rams", byeWeek: 11 },
  LV: { name: "Las Vegas Raiders", shortName: "Raiders", byeWeek: 13 },
  MIA: { name: "Miami Dolphins", shortName: "Dolphins", byeWeek: 6 },
  MIN: { name: "Minnesota Vikings", shortName: "Vikings", byeWeek: 6 },
  NE: { name: "New England Patriots", shortName: "Patriots", byeWeek: 11 },
  NO: { name: "New Orleans Saints", shortName: "Saints", byeWeek: 8 },
  NYG: { name: "New York Giants", shortName: "Giants", byeWeek: 8 },
  NYJ: { name: "New York Jets", shortName: "Jets", byeWeek: 13 },
  PHI: { name: "Philadelphia Eagles", shortName: "Eagles", byeWeek: 10 },
  PIT: { name: "Pittsburgh Steelers", shortName: "Steelers", byeWeek: 9 },
  SEA: { name: "Seattle Seahawks", shortName: "Seahawks", byeWeek: 11 },
  SF: { name: "San Francisco 49ers", shortName: "49ers", byeWeek: 8 },
  TB: { name: "Tampa Bay Buccaneers", shortName: "Buccaneers", byeWeek: 10 },
  TEN: { name: "Tennessee Titans", shortName: "Titans", byeWeek: 9 },
  WAS: { name: "Washington Commanders", shortName: "Commanders", byeWeek: 7 },
});

const TEAM_ALIASES = Object.freeze({ AZ: "ARI", JAC: "JAX", WSH: "WAS" });

export function nflTeamDetails(value) {
  const supplied = String(value ?? "").trim();
  const upper = supplied.toUpperCase();
  const code = TEAM_ALIASES[upper] || upper;
  if (NFL_TEAMS_2026[code]) return { code, ...NFL_TEAMS_2026[code] };
  const named = Object.entries(NFL_TEAMS_2026).find(([, team]) => team.name.toUpperCase() === upper || team.shortName.toUpperCase() === upper);
  if (named) return { code: named[0], ...named[1] };
  if (!supplied || upper === "FA") return { code: "FA", name: "Free Agent", shortName: "Free Agent", byeWeek: null };
  return { code: upper.slice(0, 12), name: supplied, shortName: supplied, byeWeek: null };
}
