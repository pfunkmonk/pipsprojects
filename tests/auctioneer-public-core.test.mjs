import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicSnapshot, currentAuditCsv, currentBoardCsv, evaluateDraftCompletion, evaluatePurchase, orderedTeamAssignments, publicPlayerSearch, teamSummary } from "../public/thunder-bowl/shared/public-core.mjs";

function fixture() {
  return {
    season: 2026, revision: 1, updatedAt: "2026-08-07T18:00:00.000Z", rosterSize: 4, minimumRosterSize: 4, keeperSlots: 1,
    starterRequirements: { QB: 0, RB: 1, WR: 1, TE: 0, K: 0, DST: 0 },
    teams: [
      { id: "first", name: "First Team", startingCap: 100, capAdjustment: 5 },
      { id: "second", name: "Second Team", startingCap: 100, capAdjustment: 0 },
    ],
    availablePlayers: [],
    assignments: [
      { id: "sale", playerId: "p2", playerName: "Auction Player", position: "WR", nflTeam: "MIN", teamId: "first", price: 20, acquisitionType: "auction", contractYear: null, status: "active", createdAt: "2026-08-07T18:02:00.000Z", updatedAt: "2026-08-07T18:02:00.000Z" },
      { id: "keeper", playerId: "p1", playerName: "Keeper Player", position: "RB", nflTeam: "DET", teamId: "first", price: 10, acquisitionType: "keeper", contractYear: 2, status: "active", createdAt: "2026-08-07T18:01:00.000Z", updatedAt: "2026-08-07T18:01:00.000Z" },
      { id: "voided", playerId: "p3", playerName: "Voided Player", position: "QB", nflTeam: "BUF", teamId: "first", price: 9, acquisitionType: "auction", contractYear: null, status: "voided", createdAt: "2026-08-07T18:03:00.000Z", updatedAt: "2026-08-07T18:04:00.000Z" },
    ],
  };
}

test("validates the public snapshot and preserves nomination order", () => {
  const snapshot = fixture();
  assert.equal(assertPublicSnapshot(snapshot), snapshot);
  assert.deepEqual(snapshot.teams.map((team) => team.id), ["first", "second"]);
});

test("pins keepers before auction purchases", () => {
  assert.deepEqual(orderedTeamAssignments(fixture(), "first").map((row) => row.id), ["keeper", "sale"]);
});

test("calculates cap, slots, and legal max from active corrected state", () => {
  assert.deepEqual(teamSummary(fixture(), "first"), {
    team: fixture().teams[0], assignments: orderedTeamAssignments(fixture(), "first"), spent: 30,
    adjustedCap: 105, remainingCap: 75, openSlots: 2, legalMaxBid: 74,
    minimumPlayersNeeded: 2, minimumRequiredAdditions: 2, missingStarters: [], isFinished: false,
  });
});

test("exports only active assignments with keeper contract year", () => {
  const csv = currentBoardCsv(fixture());
  assert.match(csv, /"First Team","Keeper Player","10","Year 2"/);
  assert.match(csv, /"First Team","Auction Player","20",""/);
  assert.doesNotMatch(csv, /Voided Player/);
});

test("exports assignment and operational audit history without strategy data", () => {
  const snapshot = fixture();
  snapshot.auditEvents = [{ id: "finish", action: "Marked team finished", teamId: "first", createdAt: "2026-08-07T19:00:00.000Z", actorLabel: "Auctioneer" }];
  const csv = currentAuditCsv(snapshot);
  assert.match(csv, /"Marked team finished"/);
  assert.match(csv, /"Voided Player"/);
  assert.doesNotMatch(csv, /vbd|projection|private note/i);
});

test("rejects duplicate active player assignments", () => {
  const snapshot = fixture();
  snapshot.assignments.push({ ...snapshot.assignments[0], id: "duplicate", teamId: "second" });
  assert.throws(() => assertPublicSnapshot(snapshot), /Duplicate active player/);
});

test("rejects malformed shared catalog and league-rule state before any feature consumes it", () => {
  const duplicateAssignment = fixture();
  duplicateAssignment.assignments.push({ ...duplicateAssignment.assignments[0], playerId: "different-player", id: "sale" });
  assert.throws(() => assertPublicSnapshot(duplicateAssignment), /Duplicate assignment/);

  const invalidKeeper = fixture();
  invalidKeeper.assignments.find((assignment) => assignment.acquisitionType === "keeper").contractYear = 4;
  assert.throws(() => assertPublicSnapshot(invalidKeeper), /Year 1, Year 2, or Year 3/);

  const invalidCatalog = fixture();
  invalidCatalog.availablePlayers = [{ id: "candidate", name: "Candidate", position: "PUNTER", nflTeam: "DEN" }];
  assert.throws(() => assertPublicSnapshot(invalidCatalog), /available-player record/);

  const invalidRequirements = fixture();
  invalidRequirements.starterRequirements.PUNTER = 1;
  assert.throws(() => assertPublicSnapshot(invalidRequirements), /Starter requirement/);
});

test("blocks a purchase that would violate the cap reserve", () => {
  const snapshot = fixture();
  snapshot.availablePlayers = [{ id: "candidate", name: "Candidate Player", position: "QB", nflTeam: "DEN" }];
  const result = evaluatePurchase(snapshot, { playerId: "candidate", teamId: "first", price: 75 });
  assert.equal(result.legal, false);
  assert.match(result.message, /must remain|open roster spot/i);
  assert.equal(result.legalMaxBid, 74);
});

test("blocks a purchase that destroys the remaining starter path", () => {
  const snapshot = fixture();
  snapshot.rosterSize = 3;
  snapshot.minimumRosterSize = 3;
  snapshot.starterRequirements = { QB: 1, RB: 1, WR: 1, TE: 0, K: 0, DST: 0 };
  snapshot.availablePlayers = [{ id: "candidate", name: "Extra Runner", position: "RB", nflTeam: "DEN" }];
  const result = evaluatePurchase(snapshot, { playerId: "candidate", teamId: "first", price: 1 });
  assert.equal(result.legal, false);
  assert.match(result.message, /still need QB/i);
});

test("reserves money for the 8-player legal minimum, not all 14 available slots", () => {
  const snapshot = fixture();
  snapshot.rosterSize = 14;
  snapshot.minimumRosterSize = 3;
  snapshot.availablePlayers = [{ id: "candidate", name: "Candidate", position: "QB", nflTeam: "DEN" }];
  const result = evaluatePurchase(snapshot, { playerId: "candidate", teamId: "first", price: 75 });
  assert.equal(result.legal, true);
});

test("draft completion accepts legal rosters below the 14-player maximum", () => {
  const snapshot = fixture();
  snapshot.rosterSize = 14;
  snapshot.minimumRosterSize = 2;
  const completion = evaluateDraftCompletion(snapshot);
  assert.equal(completion.teams.find((team) => team.teamId === "first").complete, true);
  assert.equal(completion.teams.find((team) => team.teamId === "second").complete, false);
});

test("auctioneer player search shares the typo-tolerant ranked matcher", () => {
  const players = [
    { id: "gibbs", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET" },
    { id: "other", name: "Jimmy Garoppolo", position: "QB", nflTeam: "LAR" },
  ];
  assert.equal(publicPlayerSearch(players, "Jamy Gbbs")[0]?.id, "gibbs");
  assert.deepEqual(publicPlayerSearch(players, "DET").map((player) => player.id), ["gibbs"]);
});
