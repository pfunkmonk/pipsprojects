import test from "node:test";
import assert from "node:assert/strict";
import { NFL_TEAMS_2026, NFL_TEAM_SCHEDULE_SOURCE, nflTeamDetails } from "../public/draft-day/nfl-teams.mjs";

const EXPECTED_BYES = {
  ARI: 14, ATL: 11, BAL: 13, BUF: 7, CAR: 5, CHI: 10, CIN: 6, CLE: 11,
  DAL: 14, DEN: 10, DET: 6, GB: 11, HOU: 8, IND: 13, JAX: 7, KC: 5,
  LAC: 7, LAR: 11, LV: 13, MIA: 6, MIN: 6, NE: 11, NO: 8, NYG: 8,
  NYJ: 13, PHI: 10, PIT: 9, SEA: 11, SF: 8, TB: 10, TEN: 9, WAS: 7,
};

test("2026 schedule map covers every NFL team with the official bye week", () => {
  assert.equal(NFL_TEAM_SCHEDULE_SOURCE.season, 2026);
  assert.match(NFL_TEAM_SCHEDULE_SOURCE.url, /^https:\/\/www\.nfl\.com\//);
  assert.equal(Object.keys(NFL_TEAMS_2026).length, 32);
  assert.deepEqual(Object.fromEntries(Object.entries(NFL_TEAMS_2026).map(([code, team]) => [code, team.byeWeek])), EXPECTED_BYES);
});

test("team lookup accepts league-feed aliases, full names, and nicknames", () => {
  assert.deepEqual(nflTeamDetails("JAC"), { code: "JAX", name: "Jacksonville Jaguars", shortName: "Jaguars", byeWeek: 7 });
  assert.deepEqual(nflTeamDetails("Washington Commanders"), { code: "WAS", name: "Washington Commanders", shortName: "Commanders", byeWeek: 7 });
  assert.deepEqual(nflTeamDetails("Broncos"), { code: "DEN", name: "Denver Broncos", shortName: "Broncos", byeWeek: 10 });
  assert.deepEqual(nflTeamDetails("FA"), { code: "FA", name: "Free Agent", shortName: "Free Agent", byeWeek: null });
});
