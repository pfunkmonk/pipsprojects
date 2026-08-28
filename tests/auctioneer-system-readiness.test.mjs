import test from "node:test";
import assert from "node:assert/strict";
import { assertLeagueLegality, teamSummary } from "../public/thunder-bowl/shared/public-core.mjs";
import { evaluateDraftReadiness } from "../public/thunder-bowl/shared/readiness.mjs";

const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DST", "RB", "RB", "WR", "WR", "TE", "QB"];

function completeDraft() {
  const teams = Array.from({ length: 12 }, (_, index) => ({ id: `team-${index + 1}`, name: `Team ${index + 1}`, startingCap: 300, capAdjustment: 0 }));
  const players = [];
  const assignments = [];
  for (const [teamIndex, team] of teams.entries()) {
    positions.forEach((position, slotIndex) => {
      const id = `player-${teamIndex + 1}-${slotIndex + 1}`;
      const player = { id, name: `Player ${teamIndex + 1}-${slotIndex + 1}`, position, nflTeam: "NFL" };
      players.push(player);
      assignments.push({
        id: `sale-${id}`, playerId: id, playerName: player.name, position, nflTeam: player.nflTeam,
        teamId: team.id, price: 1, acquisitionType: "auction", contractYear: null, status: "active",
        createdAt: new Date(Date.UTC(2026, 7, 7, 18, teamIndex, slotIndex)).toISOString(),
        updatedAt: new Date(Date.UTC(2026, 7, 7, 18, teamIndex, slotIndex)).toISOString(), actorLabel: "Load test",
      });
    });
  }
  return {
    season: 2026, revision: 168, updatedAt: new Date().toISOString(), rosterSize: 14, minimumRosterSize: 8, keeperSlots: 2,
    keepersFinalized: true, keeperFinalizedAt: "2026-08-28T18:00:00.000Z",
    starterRequirements: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    currentNominatorTeamId: null, nextNominatorTeamId: null, teams, availablePlayers: players, assignments,
  };
}

test("validates a complete 12-team, 168-player draft as one system", () => {
  const snapshot = completeDraft();
  assert.equal(snapshot.assignments.length, 168);
  assert.equal(assertLeagueLegality(snapshot), snapshot);
  for (const team of snapshot.teams) {
    const summary = teamSummary(snapshot, team.id);
    assert.equal(summary.assignments.length, 14);
    assert.equal(summary.openSlots, 0);
  }
});

test("passes the complete draft-day readiness contract", () => {
  const snapshot = completeDraft();
  const result = evaluateDraftReadiness(snapshot, {
    lastSeen: Date.now(), dataFresh: true, revision: snapshot.revision, fullscreen: true, noOverflow: true,
    viewportWidth: 1920, viewportHeight: 1080,
  }, { cloudReady: true, expectedTeamCount: 12, audioConfirmed: true, zoomConfirmed: true });
  assert.equal(result.ready, true);
  assert.equal(result.passed, result.total);
});

test("fails readiness for stale projection or leaked private data", () => {
  const snapshot = completeDraft();
  snapshot.availablePlayers[0].vbd = 99;
  const result = evaluateDraftReadiness(snapshot, {
    lastSeen: Date.now() - 60_000, dataFresh: false, fullscreen: false, noOverflow: true,
  }, { cloudReady: true, expectedTeamCount: 12, audioConfirmed: true, zoomConfirmed: true });
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((item) => item.id === "privacy").ok, false);
  assert.equal(result.checks.find((item) => item.id === "projector").ok, false);
});
