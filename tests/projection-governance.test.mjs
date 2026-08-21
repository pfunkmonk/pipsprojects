import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROJECTION_LAB_MODEL, PROJECTION_SOURCE_ACCURACY } from "../public/thunder-bowl/projection-lab.mjs";

const root = new URL("../", import.meta.url);
const report = JSON.parse(await readFile(new URL("reports/thunder-bowl/projection-ensemble-surrogate-backtest-20260809.json", root), "utf8"));
const plan = await readFile(new URL("THUNDER-BOWL-2026-PRODUCT-PLAN.md", root), "utf8");
const handoff = await readFile(new URL("artifacts/thunder-bowl/projection-handoff-2026/thunder-bowl-2026-projection-handoff-template.csv", root), "utf8");
const projectionBacktest = await readFile(new URL("scripts/backtest-projection-ensemble.py", root), "utf8");
const projectionRunner = await readFile(new URL("scripts/run-projection-backtest.mjs", root), "utf8");

test("the old mean-reversion surrogate remains blocked while the simpler blend is registered", () => {
  assert.equal(report.scope.rows, 1153);
  assert.equal(report.decision.lowest_mae_variant, "lean_mean_reversion");
  assert.equal(report.decision.surrogateGatePassed, true);
  assert.equal(report.decision.livePromotionEligible, false);
  assert.ok(report.metrics.raw_equal_blend.overall.mae < report.metrics.raw_primary.overall.mae);
  assert.ok(report.metrics.lean_mean_reversion.overall.mae < report.metrics.raw_equal_blend.overall.mae);
  for (const position of ["QB", "RB", "WR", "TE"]) {
    assert.ok(report.decision.position_mae_delta_vs_reference[position] <= 0);
  }
  assert.equal(PROJECTION_LAB_MODEL.livePromotionEligible, true);
  assert.equal(PROJECTION_LAB_MODEL.pairedRows, 412);
  assert.ok(PROJECTION_LAB_MODEL.pairedConsensusMae < PROJECTION_LAB_MODEL.bestSinglePairedMae);
  assert.equal(PROJECTION_SOURCE_ACCURACY.FantasyPros.direct, false);
  assert.equal(PROJECTION_SOURCE_ACCURACY.PFF.direct, false);
});

test("rejected sauce layers remain documented and outside automatic value authority", () => {
  const best = report.metrics.lean_mean_reversion.overall.mae;
  for (const challenger of ["within_position", "context_only", "durability", "full_model"]) {
    assert.ok(report.metrics[challenger].overall.mae > best, challenger);
  }
  assert.match(plan, /schedule total-point corrections remain at exactly zero/i);
  assert.match(plan, /may not manufacture extra season points/i);
  assert.match(plan, /accuracy-weighted consensus/i);
  assert.match(plan, /8–14 final players allowed/);
});

test("the checked-in handoff template covers the exact pack and carries no downstream dollar authority", () => {
  const lines = handoff.trim().split(/\r?\n/);
  assert.equal(lines.length - 1, 716);
  assert.match(lines[0], /pack_player_id,player_name,position,nfl_team,fbg_id,cbs_id,fantasypros_id,pff_id,gsis_id/);
  assert.doesNotMatch(lines[0], /vbd|market|max_bid|keeper|auction/i);
});

test("projection challenger rebuilds lag evidence and has a portable dependency-aware entrypoint", () => {
  assert.match(projectionBacktest, /grouped\["fp_over_expected"\]\.shift\(1\)/);
  assert.match(projectionBacktest, /grouped\["tb_ppg"\]\.shift\(1\)/);
  assert.match(projectionBacktest, /Historical model is missing required columns/);
  assert.match(projectionRunner, /THUNDER_BOWL_PYTHON/);
  assert.match(projectionRunner, /requirements-backtests\.txt/);
});
