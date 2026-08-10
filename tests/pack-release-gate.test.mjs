import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditDraftPack, renderAuditMarkdown } from "../scripts/pack-release-gate.mjs";

const current = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
const clone = (value) => structuredClone(value);
const afterCurrent = (hours = 1) => new Date(Date.parse(current.asOf) + hours * 60 * 60 * 1000).toISOString();

test("the active private practice pack clears every release invariant", () => {
  const audit = auditDraftPack(current, current);
  assert.equal(audit.approved, true);
  assert.equal(audit.contentChanged, false);
  assert.equal(audit.candidate.players, 716);
  assert.equal(audit.candidate.keeperTeams, 12);
  assert.equal(audit.candidate.allocatedMarketDollars, 1212);
  assert.equal(audit.candidate.expectedCap, 1212);
  assert.match(renderAuditMarkdown(audit), /Decision: \*\*PASS\*\*/);
});

test("the read-only candidate audit CLI returns machine-readable approval", () => {
  const script = fileURLToPath(new URL("../scripts/audit-thunder-pack-candidate.mjs", import.meta.url));
  const pack = fileURLToPath(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url));
  const completed = spawnSync(process.execPath, [script, pack, pack], { encoding: "utf8" });
  assert.equal(completed.status, 0, completed.stderr);
  const audit = JSON.parse(completed.stdout);
  assert.equal(audit.approved, true);
  assert.equal(audit.contentChanged, false);
});

test("changed content cannot masquerade under the active pack id", () => {
  const candidate = clone(current);
  candidate.players[0].notes += " Updated.";
  const audit = auditDraftPack(candidate, current);
  assert.equal(audit.approved, false);
  assert.ok(audit.blockingIssues.some((issue) => issue.includes("without a new packId")));
});

test("the gate accepts only the pinned final-order and El Guapo confirmation update", () => {
  const candidate = clone(current);
  candidate.packId = "tb26-evidence-backed-config-test";
  if (!candidate.sources.some((source) => source.name === "User-confirmed prior-season league order and 2026 bonus caps")) {
    candidate.sources.push({
      name: "User-confirmed prior-season league order and 2026 bonus caps",
      asOf: "2026-08-04T00:00:00-06:00",
      authority: "league configuration only; no player value effect",
      scoringFingerprint: candidate.sources[0].scoringFingerprint,
    });
  }
  candidate.leagueConfig.nominationOrder = [
    "orange-crush", "the-hobbits", "crime-and-punishment", "t-dogs",
    "super-suckers", "angry-face", "goon-skwad", "dogs-of-war",
    "el-guapo", "the-bungles", "big-head", "three-amigos",
  ];
  candidate.leagueConfig.nominationOrderStatus = "verified";
  candidate.leagueConfig.verifiedPrefixCount = 12;
  candidate.leagueConfig.teams.find((team) => team.id === "el-guapo").capStatus = "confirmed";

  const prior = clone(candidate);
  prior.packId = "tb26-before-user-confirmation";
  prior.leagueConfig.nominationOrder = prior.leagueConfig.teams.map((team) => team.id);
  prior.leagueConfig.nominationOrderStatus = "verified-prefix-only";
  prior.leagueConfig.verifiedPrefixCount = 3;
  prior.leagueConfig.teams.find((team) => team.id === "el-guapo").capStatus = "provisional";
  const audit = auditDraftPack(candidate, prior);
  assert.equal(audit.approved, true);
  assert.equal(audit.changes.exactStrategyValueChangeCount, 0);
  assert.ok(audit.warnings.some((warning) => warning.includes("El Guapo")));

  const arbitrary = clone(candidate);
  arbitrary.packId = "tb26-arbitrary-config-test";
  arbitrary.leagueConfig.teams.find((team) => team.id === "big-head").startingCap = 101;
  assert.ok(auditDraftPack(arbitrary, prior).blockingIssues.some((issue) => issue.includes("League configuration changed")));
});

test("the release gate blocks scoring drift, holdout leakage, and incomplete keeper coverage", () => {
  const candidate = clone(current);
  candidate.packId = "tb26-deliberately-invalid-refresh";
  candidate.asOf = "2026-08-04T00:00:00.000Z";
  candidate.sources[0].scoringFingerprint = "wrong-scoring-system";
  candidate.sources[1].name = "2025 final actual outcomes";
  const removedTeam = candidate.keeperCandidates[0].teamId;
  candidate.keeperCandidates = candidate.keeperCandidates.filter((keeper) => keeper.teamId !== removedTeam);
  const audit = auditDraftPack(candidate, current);
  assert.equal(audit.approved, false);
  assert.ok(audit.blockingIssues.some((issue) => issue.includes("fingerprints disagree")));
  assert.ok(audit.blockingIssues.some((issue) => issue.includes("sealed 2025 outcome")));
  assert.ok(audit.blockingIssues.some((issue) => issue.includes("Keeper evidence covers 11 teams")));
});

test("the release gate blocks silent loss of a league auction dollar", () => {
  const candidate = clone(current);
  candidate.packId = "tb26-deliberately-broken-dollar-refresh";
  candidate.asOf = "2026-08-04T00:00:00.000Z";
  const highest = [...candidate.players].sort((left, right) => right.marketValue - left.marketValue)[0];
  highest.marketValue += 1;
  const audit = auditDraftPack(candidate, current);
  assert.equal(audit.approved, false);
  assert.ok(audit.blockingIssues.some((issue) => issue.includes("not the $1212 league cap")));
});

test("schedule evidence remains paired with context and value neutral", () => {
  const candidate = structuredClone(current);
  candidate.packId = "tb26-schedule-context-test";
  candidate.asOf = current.asOf;
  if (!candidate.sources.some((source) => /Thunder Bowl 2026 schedule/i.test(source.name))) {
    candidate.sources.push({
      name: "CBS Thunder Bowl 2026 schedule and divisions",
      asOf: "2026-08-04T02:36:00Z",
      authority: "authenticated league context; no value effect",
      scoringFingerprint: candidate.sources[0].scoringFingerprint,
    });
  }
  candidate.scheduleContext = {
    status: "loaded_value_neutral",
    asOf: "2026-08-04T02:36:00Z",
    source: "CBS Sports authenticated Thunder Bowl pages",
    modelEffect: "none",
    weightingStatus: "disabled_historical_gate_failed_2018_2025",
    cbsTeamId: 4,
    division: "West",
    divisionRivals: ["T-Dogs", "Three Amigos"],
    divisionWeeks: [
      { week: 1, opponent: "Three Amigos" },
      { week: 2, opponent: "T-Dogs" },
      { week: 12, opponent: "Three Amigos" },
      { week: 13, opponent: "T-Dogs" },
    ],
    randomWeek14Opponent: "All-play (no head-to-head opponent)",
    playoffWeeks: [15, 16, 17],
  };
  assert.equal(auditDraftPack(candidate, current).approved, true);

  const changedValue = structuredClone(candidate);
  changedValue.players[0].maxBid += 1;
  assert.ok(auditDraftPack(changedValue, current).blockingIssues.some((issue) => issue.includes("schedule-context release changed")));

  const missingContext = structuredClone(candidate);
  delete missingContext.scheduleContext;
  assert.ok(auditDraftPack(missingContext, current).blockingIssues.some((issue) => issue.includes("must appear together")));
});

test("weekly context is paired, scale preserving, and forbidden from changing strategy values", () => {
  const candidate = clone(current);
  candidate.packId = "tb26-weekly-context-test";
  assert.equal(auditDraftPack(candidate, current).approved, true);
  assert.equal(candidate.weeklyContext.coveredPlayers, current.players.length);
  assert.equal(candidate.players.filter((player) => player.weeklyProjection).length, current.players.length);
  for (const player of candidate.players.filter((row) => row.weeklyProjection)) {
    assert.ok(Math.abs(player.weeklyProjection.points.reduce((sum, value) => sum + (value ?? 0), 0) - player.projectedPoints) <= 0.11);
  }

  const changedValue = clone(candidate);
  changedValue.players[0].maxBid += 1;
  assert.ok(auditDraftPack(changedValue, current).blockingIssues.some((issue) => issue.includes("weekly-context release changed")));

  const missingContext = clone(candidate);
  delete missingContext.weeklyContext;
  assert.ok(auditDraftPack(missingContext, current).blockingIssues.some((issue) => issue.includes("must appear together")));
});

test("a supplemental projection release cannot alter any strategy value", () => {
  const candidate = clone(current);
  candidate.packId = "tb26-supplemental-projection-invalid";
  candidate.asOf = "2026-08-04T00:00:00.000Z";
  candidate.sources.push({
    name: "Example supplemental projections",
    asOf: "2026-08-04T00:00:00.000Z",
    authority: "supplemental projection; no value effect",
    scoringFingerprint: candidate.sources[0].scoringFingerprint,
  });
  candidate.players[0].projectionSources = [{
    source: "Example",
    points: candidate.players[0].projectedPoints,
    asOf: "2026-08-04T00:00:00.000Z",
    role: "primary",
    modelEffect: "primary_projection",
    note: "Existing primary projection",
  }, {
    source: "Second opinion",
    points: candidate.players[0].projectedPoints + 10,
    asOf: "2026-08-04T00:00:00.000Z",
    role: "supplemental",
    modelEffect: "none",
    note: "No value effect",
  }];
  candidate.players[0].maxBid += 1;
  const audit = auditDraftPack(candidate, current);
  assert.equal(audit.approved, false);
  assert.equal(audit.changes.exactStrategyValueChangeCount, 1);
  assert.ok(audit.blockingIssues.some((issue) => issue.includes("value-neutral supplemental projection")));
});

test("an advisory manager-profile release cannot alter any strategy value", () => {
  const candidate = clone(current);
  candidate.packId = "tb26-manager-profile-invalid";
  candidate.asOf = "2026-08-04T00:30:00.000Z";
  candidate.sources[4] = {
    ...candidate.sources[4],
    name: "Thunder Bowl manager profiles",
    authority: "low-confidence advisory; no value effect",
  };
  candidate.managerProfiles = candidate.leagueConfig.teams.map((team) => ({
    teamId: team.id,
    teamName: team.name,
    sampleSeasons: 4,
    samplePurchases: 30,
    observedSpend: 300,
    reliability: 0.5,
    confidence: "low_advisory_only",
    positionMultipliers: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 },
    topNflAffinity: "DET",
    topNflAffinityMultiplier: 1.2,
    modelEffect: "advisory_only",
    note: "Winning purchases only; no losing bids.",
  }));
  candidate.players[0].maxBid += 1;
  const audit = auditDraftPack(candidate, current);
  assert.equal(audit.approved, false);
  assert.ok(audit.blockingIssues.some((issue) => issue.includes("advisory-only manager-profile release")));
});

test("Footballguys top-400 auction values remain a comparison-only source", () => {
  const candidate = clone(current);
  candidate.packId = "tb26-fbg-comparison-refresh";
  candidate.asOf = afterCurrent();
  candidate.fbgAuctionValues.values[0].value = 2;
  const accepted = auditDraftPack(candidate, current);
  assert.equal(accepted.approved, true);
  assert.equal(accepted.changes.exactStrategyValueChangeCount, 0);

  const forged = clone(candidate);
  forged.packId = "tb26-fbg-comparison-forged";
  forged.players[0].marketValue += 1;
  const rejected = auditDraftPack(forged, current);
  assert.equal(rejected.approved, false);
  assert.ok(rejected.blockingIssues.some((issue) => issue.includes("value-neutral Footballguys auction comparison")));

  const unpaired = clone(candidate);
  delete unpaired.fbgAuctionValues;
  assert.equal(auditDraftPack(unpaired, current).approved, false);
});

test("a declared primary projection source may change values only through the classic champion", () => {
  const candidate = clone(current);
  candidate.packId = "tb26-candidate-projection-lab-test";
  const sourceAsOf = afterCurrent();
  candidate.asOf = afterCurrent(2);
  const primarySourceIndex = candidate.sources.findIndex((source) => source.authority === "primary projection; Thunder Bowl computes value");
  const primarySourceName = candidate.sources[primarySourceIndex].name;
  candidate.sources[primarySourceIndex] = { ...candidate.sources[primarySourceIndex], asOf: sourceAsOf };
  for (const position of Object.keys(candidate.leagueConfig.starterRequirements)) {
    const group = candidate.players.filter((player) => player.position === position)
      .sort((left, right) => right.projectedPoints - left.projectedPoints || left.id.localeCompare(right.id));
    const replacementRank = candidate.leagueConfig.teams.length * candidate.leagueConfig.starterRequirements[position];
    const baseline = group[Math.min(group.length, replacementRank) - 1].projectedPoints;
    for (const player of group) player.vbd = Number((player.projectedPoints - baseline).toFixed(1));
    const marketCurve = current.players.filter((player) => player.position === position)
      .map((player) => player.marketValue)
      .sort((left, right) => right - left);
    group.sort((left, right) => right.vbd - left.vbd || left.id.localeCompare(right.id));
    group.forEach((player, index) => {
      player.marketValue = marketCurve[index];
      player.maxBid = marketCurve[index];
    });
  }
  const values = new Map(candidate.players.map((player) => [player.id, player.marketValue]));
  for (const keeper of candidate.keeperCandidates) {
    keeper.marketValue = values.get(keeper.playerId);
    keeper.surplus = keeper.keeperYear <= 3 ? keeper.marketValue - keeper.keeperSalary : 0;
  }
  for (const player of candidate.players) {
    player.projectionSources = (player.projectionSources || [])
      .filter((source) => source.source !== primarySourceName)
      .map((source) => ({
      ...source,
      role: source.role === "primary" ? "cross-check" : source.role,
      modelEffect: "none",
      }));
    player.projectionSources.push({
      source: primarySourceName,
      points: player.projectedPoints,
      asOf: sourceAsOf,
      role: "primary",
      modelEffect: "primary_projection",
      note: "Candidate forecast from immutable model projection-lab-test",
    });
  }

  const accepted = auditDraftPack(candidate, current);
  assert.equal(accepted.approved, true);
  assert.equal(accepted.candidate.primaryProjectionSource, primarySourceName);
  assert.equal(accepted.candidate.primaryProjectionUpdate, true);
  assert.ok(accepted.warnings.some((warning) => warning.includes("recomputed every strategy value")));

  const forged = clone(candidate);
  forged.packId = "tb26-candidate-projection-lab-forged";
  forged.players[0].maxBid += 1;
  const rejected = auditDraftPack(forged, current);
  assert.equal(rejected.approved, false);
  assert.ok(rejected.blockingIssues.some((issue) => issue.includes("Champion VBD recomputation failed")));
});
