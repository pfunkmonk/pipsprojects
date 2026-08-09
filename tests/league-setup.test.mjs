import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneDefaultLeagueSetup2026,
  deriveLeagueScheduleContext,
  effectiveWeeklyContext,
  validateLeagueSetup,
} from "../public/thunder-bowl/league-setup.mjs";
import { DEFAULT_CONFIG } from "../public/thunder-bowl/state-engine.mjs";

test("2026 setup reconstructs CBS divisions and excludes the Week 14 all-play format", () => {
  const setup = validateLeagueSetup(cloneDefaultLeagueSetup2026(), {
    teams: DEFAULT_CONFIG.teams,
    expectedSeason: 2026,
  });
  const context = deriveLeagueScheduleContext(setup, { teams: DEFAULT_CONFIG.teams, expectedSeason: 2026 });
  assert.equal(context.division, "West");
  assert.deepEqual(context.divisionRivals, ["T-Dogs", "Three Amigos"]);
  assert.deepEqual(context.divisionWeeks.map((row) => row.week), [1, 2, 12, 13]);
  assert.deepEqual(context.allPlayWeeks, [14]);
  assert.deepEqual(context.playoffWeeks, [15, 16, 17]);
  assert.deepEqual(context.playoffQualification, { divisionWinners: 4, wildCards: 2 });
});

test("annual setup rejects duplicate division membership and incomplete schedules", () => {
  const duplicate = cloneDefaultLeagueSetup2026();
  duplicate.divisions[0].teamIds[0] = "angry-face";
  assert.throws(() => validateLeagueSetup(duplicate, { teams: DEFAULT_CONFIG.teams }), /exactly one division/);

  const incomplete = cloneDefaultLeagueSetup2026();
  incomplete.userSchedule.pop();
  assert.throws(() => validateLeagueSetup(incomplete, { teams: DEFAULT_CONFIG.teams }), /Weeks 1-14/);
});

test("all-play weeks cannot accidentally acquire a head-to-head opponent", () => {
  const setup = cloneDefaultLeagueSetup2026();
  setup.userSchedule[13].opponentTeamId = "three-amigos";
  assert.throws(() => validateLeagueSetup(setup, { teams: DEFAULT_CONFIG.teams }), /all-play/);
});

test("effective weekly context derives user-editable priority weeks without mutating source evidence", () => {
  const source = { divisionWeeks: [99], playoffWeeks: [98], modelEffect: "none" };
  const result = effectiveWeeklyContext(source, cloneDefaultLeagueSetup2026(), { teams: DEFAULT_CONFIG.teams });
  assert.deepEqual(result.divisionWeeks, [1, 2, 12, 13]);
  assert.deepEqual(result.playoffWeeks, [15, 16, 17]);
  assert.deepEqual(source, { divisionWeeks: [99], playoffWeeks: [98], modelEffect: "none" });
});
