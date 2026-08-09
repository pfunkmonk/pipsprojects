import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const report = JSON.parse(await readFile(new URL("reports/thunder-bowl/projection-ensemble-surrogate-backtest-20260809.json", root), "utf8"));
const plan = await readFile(new URL("THUNDER-BOWL-2026-PRODUCT-PLAN.md", root), "utf8");
const handoff = await readFile(new URL("artifacts/thunder-bowl/projection-handoff-2026/thunder-bowl-2026-projection-handoff-template.csv", root), "utf8");

test("projection promotion remains blocked despite a successful surrogate mechanics test", () => {
  assert.equal(report.scope.rows, 1153);
  assert.equal(report.decision.lowest_mae_variant, "lean_mean_reversion");
  assert.equal(report.decision.surrogateGatePassed, true);
  assert.equal(report.decision.livePromotionEligible, false);
  assert.ok(report.metrics.raw_equal_blend.overall.mae < report.metrics.raw_primary.overall.mae);
  assert.ok(report.metrics.lean_mean_reversion.overall.mae < report.metrics.raw_equal_blend.overall.mae);
  for (const position of ["QB", "RB", "WR", "TE"]) {
    assert.ok(report.decision.position_mae_delta_vs_reference[position] <= 0);
  }
});

test("rejected sauce layers remain documented and outside automatic value authority", () => {
  const best = report.metrics.lean_mean_reversion.overall.mae;
  for (const challenger of ["within_position", "context_only", "durability", "full_model"]) {
    assert.ok(report.metrics[challenger].overall.mae > best, challenger);
  }
  assert.match(plan, /candidate only \/ no value effect/i);
  assert.match(plan, /may not manufacture extra season points/i);
  assert.match(plan, /active pack remains unchanged/i);
  assert.match(plan, /8–14 final players allowed/);
});

test("the checked-in handoff template covers the exact pack and carries no downstream dollar authority", () => {
  const lines = handoff.trim().split(/\r?\n/);
  assert.equal(lines.length - 1, 716);
  assert.match(lines[0], /pack_player_id,player_name,position,nfl_team,fbg_id,cbs_id,fantasypros_id,gsis_id/);
  assert.doesNotMatch(lines[0], /vbd|market|max_bid|keeper|auction/i);
});
