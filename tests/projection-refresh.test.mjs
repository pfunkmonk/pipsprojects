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

function completedRows() {
  return createProjectionHandoffTemplateRows(current, {
    modelId: "projection-lab-test-v1",
    sourceAsOf: "2026-08-09T16:00:00-06:00",
    exportedAt: "2026-08-09T16:05:00-06:00",
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
  const candidate = createProjectionCandidatePack(current, completedRows());
  const audit = auditDraftPack(candidate, current);
  assert.equal(audit.approved, true, audit.blockingIssues.join(" | "));
  assert.equal(audit.candidate.primaryProjectionSource, "Thunder Projection Lab");
  assert.equal(candidate.players.length, current.players.length);
  assert.deepEqual(candidate.leagueConfig, current.leagueConfig);
  assert.equal(candidate.players.every((player) => player.projectionSources.filter((source) => source.modelEffect === "primary_projection").length === 1), true);
  assert.equal(candidate.players.filter((player) => player.weeklyProjection).every((player) => Math.abs(player.weeklyProjection.points.reduce((sum, value) => sum + (value ?? 0), 0) - player.projectedPoints) <= 0.11), true);
});

test("missing rows, a forged consensus, or an unreconciled adjustment fail closed", () => {
  assert.throws(() => createProjectionCandidatePack(current, completedRows().slice(1)), /not all 716/);
  const consensus = completedRows();
  consensus[0].raw_consensus_points = Number(consensus[0].raw_consensus_points) + 10;
  assert.throws(() => createProjectionCandidatePack(current, consensus), /not the equal average/);
  const adjusted = completedRows();
  adjusted[0].mean_reversion_delta = -10;
  assert.throws(() => createProjectionCandidatePack(current, adjusted), /do not reconcile/);
});
