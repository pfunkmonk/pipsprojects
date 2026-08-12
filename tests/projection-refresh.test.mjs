import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditDraftPack } from "../scripts/pack-release-gate.mjs";
import {
  PROJECTION_HANDOFF_COLUMNS,
  createProjectionCandidatePack,
  createProjectionHandoffTemplateRows,
  parseProjectionHandoffCsv,
  projectionRowsToCsv,
} from "../scripts/projection-refresh-core.mjs";

const current = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
const afterCurrent = (minutes) => new Date(Date.parse(current.asOf) + minutes * 60 * 1000).toISOString();

function completedRows() {
  return createProjectionHandoffTemplateRows(current, {
    modelId: "projection-lab-test-v1",
    sourceAsOf: afterCurrent(1),
    exportedAt: afterCurrent(2),
  }).map((row) => {
    const sourcePoints = [row.fbg_points, row.cbs_points, row.fantasypros_points].filter((value) => value !== "").map(Number);
    const consensus = Number(row.raw_consensus_points);
    return {
      ...row,
      mean_reversion_delta: 0,
      within_position_delta: 0,
      season_context_delta: 0,
      durability_delta: 0,
      availability_delta: 0,
      modified_projection_points: consensus,
      uncertainty_low: Math.max(0, consensus - 50),
      uncertainty_high: consensus + 50,
      fallback_reason: sourcePoints.length >= 2 ? "" : "Current primary pass-through because fewer than two premium sources were supplied",
    };
  });
}

test("the projection handoff is an exact strict 716-player contract", () => {
  const rows = completedRows();
  assert.equal(rows.length, 716);
  const csv = projectionRowsToCsv(rows);
  assert.equal(csv.split("\n")[0], PROJECTION_HANDOFF_COLUMNS.join(","));
  assert.equal(parseProjectionHandoffCsv(csv).length, 716);
  assert.doesNotMatch(csv.split("\n")[0], /vbd|market|max_bid|keeper|auction/i);
  const fbgPlayer = rows.find((row) => row.pack_player_id.startsWith("fbg:"));
  const cbsPlayer = rows.find((row) => row.pack_player_id.startsWith("cbs:"));
  assert.equal(fbgPlayer.fbg_id, fbgPlayer.pack_player_id.slice(4));
  assert.equal(fbgPlayer.cbs_id, "");
  assert.equal(cbsPlayer.cbs_id, cbsPlayer.pack_player_id.slice(4));
  assert.equal(cbsPlayer.fbg_id, "");
});

test("a complete candidate recomputes values through the classic champion without changing the player universe", () => {
  const rows = completedRows();
  const first = rows[0];
  for (const column of ["fbg_points", "cbs_points", "fantasypros_points"]) {
    if (first[column] !== "") first[column] = 200;
  }
  const sourcePoints = [first.fbg_points, first.cbs_points, first.fantasypros_points].filter((value) => value !== "").map(Number);
  first.raw_consensus_points = 200;
  first.modified_projection_points = first.raw_consensus_points;
  first.uncertainty_low = Math.min(...sourcePoints);
  first.uncertainty_high = Math.max(...sourcePoints);
  const candidate = createProjectionCandidatePack(current, rows);
  const audit = auditDraftPack(candidate, current);
  assert.equal(audit.approved, true, audit.blockingIssues.join(" | "));
  assert.equal(audit.candidate.primaryProjectionSource, "Thunder Bowl Consensus");
  assert.equal(candidate.players.length, current.players.length);
  assert.deepEqual(candidate.leagueConfig, current.leagueConfig);
  assert.equal(candidate.players.every((player) => player.projectionSources.filter((source) => source.modelEffect === "primary_projection").length === 1), true);
  assert.equal(candidate.players.filter((player) => player.weeklyProjection).every((player) => Math.abs(player.weeklyProjection.points.reduce((sum, value) => sum + (value ?? 0), 0) - player.projectedPoints) <= 0.11), true);
  const refreshed = candidate.players.find((player) => player.id === first.pack_player_id);
  assert.equal(refreshed.projectionSources.find((source) => source.source === "Footballguys").points, Number(first.fbg_points));
  assert.equal(refreshed.projectionSources.find((source) => source.source === "Footballguys").asOf, new Date(first.source_as_of).toISOString());
});

test("a legitimate zero projection preserves weekly coverage and can later be rebased above zero", () => {
  const rows = completedRows();
  const target = rows.find((row) => current.players.find((player) => player.id === row.pack_player_id)?.weeklyProjection);
  target.fbg_points = 0;
  target.cbs_points = 0;
  target.fantasypros_points = "";
  target.raw_consensus_points = 0;
  target.modified_projection_points = 0;
  target.uncertainty_low = 0;
  target.uncertainty_high = 0;
  target.fallback_reason = "";
  const zeroCandidate = createProjectionCandidatePack(current, rows);
  const zeroPlayer = zeroCandidate.players.find((player) => player.id === target.pack_player_id);
  assert.equal(zeroPlayer.weeklyProjection.sourceSeasonTotal, 0);
  assert.equal(zeroPlayer.weeklyProjection.points.reduce((sum, value) => sum + (value ?? 0), 0), 0);

  const reboundRows = createProjectionHandoffTemplateRows(zeroCandidate, {
    modelId: "projection-lab-rebound-v1",
    sourceAsOf: afterCurrent(3),
    exportedAt: afterCurrent(4),
  }).map((row) => ({
    ...row,
    mean_reversion_delta: 0,
    within_position_delta: 0,
    season_context_delta: 0,
    durability_delta: 0,
    availability_delta: 0,
    modified_projection_points: row.pack_player_id === target.pack_player_id ? 17 : row.raw_consensus_points,
    raw_consensus_points: row.pack_player_id === target.pack_player_id ? 17 : row.raw_consensus_points,
    fbg_points: row.pack_player_id === target.pack_player_id ? 17 : row.fbg_points,
    cbs_points: row.pack_player_id === target.pack_player_id ? 17 : row.cbs_points,
    uncertainty_low: row.pack_player_id === target.pack_player_id ? 17 : Math.max(0, Number(row.raw_consensus_points) - 50),
    uncertainty_high: row.pack_player_id === target.pack_player_id ? 17 : Number(row.raw_consensus_points) + 50,
    fallback_reason: [row.fbg_points, row.cbs_points, row.fantasypros_points].filter((value) => value !== "").length >= 2 ? "" : "Current primary pass-through because fewer than two premium sources were supplied",
  }));
  const rebound = createProjectionCandidatePack(zeroCandidate, reboundRows);
  const reboundPlayer = rebound.players.find((player) => player.id === target.pack_player_id);
  assert.equal(reboundPlayer.weeklyProjection.points.reduce((sum, value) => sum + (value ?? 0), 0), 17);
});

test("missing rows, a forged consensus, or an unreconciled adjustment fail closed", () => {
  assert.throws(() => createProjectionCandidatePack(current, completedRows().slice(1)), /not all 716/);
  const consensus = completedRows();
  consensus[0].raw_consensus_points = Number(consensus[0].raw_consensus_points) + 10;
  assert.throws(() => createProjectionCandidatePack(current, consensus), /does not match the registered consensus source model/);
  const adjusted = completedRows();
  adjusted[0].mean_reversion_delta = -10;
  assert.throws(() => createProjectionCandidatePack(current, adjusted), /do not reconcile/);
});

test("a projection refresh preserves a newer overall pack timestamp from weekly evidence", () => {
  const rows = completedRows().map((row) => ({
    ...row,
    source_as_of: new Date(Date.parse(current.asOf) - 2 * 60 * 1000).toISOString(),
    exported_at: new Date(Date.parse(current.asOf) - 1 * 60 * 1000).toISOString(),
  }));
  const candidate = createProjectionCandidatePack(current, rows);
  assert.equal(candidate.asOf, current.asOf);
});

test("the frozen market curve remains monotone below replacement instead of sorting zero-VBD ties by id", () => {
  const candidate = createProjectionCandidatePack(current, completedRows());
  for (const position of ["QB", "RB", "WR", "TE", "K", "DST"]) {
    const rows = candidate.players
      .filter((player) => player.position === position)
      .sort((left, right) => right.projectedPoints - left.projectedPoints || left.id.localeCompare(right.id));
    for (let index = 1; index < rows.length; index += 1) {
      assert.ok(rows[index - 1].marketValue >= rows[index].marketValue,
        `${position}: ${rows[index - 1].name} cannot be cheaper than lower-projected ${rows[index].name}`);
    }
  }
});
