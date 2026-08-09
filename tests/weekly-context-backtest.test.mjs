import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [report, script, appSource] = await Promise.all([
  readFile(new URL("../reports/weekly-context-time-forward-backtest.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../scripts/backtest-weekly-context.py", import.meta.url), "utf8"),
  readFile(new URL("../public/thunder-bowl/app.mjs", import.meta.url), "utf8"),
]);

test("weekly context is scored in strict time-forward folds on a large historical sample", () => {
  assert.deepEqual(report.targetSeasons, [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  assert.equal(report.models.full_context.rows, 31486);
  assert.match(report.method, /preseason-available prior-season\/prior-career context/);
  assert.match(script, /row\["season"\] < season/);
  assert.match(script, /defense_factors\(training, season - 1\)/);
});

test("failed schedule challengers remain visible but cannot alter live draft authority", () => {
  assert.equal(report.promotionGate.passed, false);
  assert.equal(report.champion, "matchup_only");
  assert.ok(report.models.matchup_only.contextMae > report.models.matchup_only.flatMae);
  assert.equal(report.models.full_context.seasonWins, 0);
  assert.equal(report.models.full_context.positionWins, 0);
  assert.match(appSource, /buildPriorityVbdOverlay/);
  assert.match(appSource, /calculateAuctionDemandMarket\(draftPack, draftState\)/);
  assert.match(appSource, /calculateKeeperScenarioValues\(draftPack, keeperWorkspaceState\(\)\)/);
  assert.doesNotMatch(appSource, /projectedPoints:\s*priorityVbdOverlay/);
});
