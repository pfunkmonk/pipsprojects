import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SOURCE_WEEKLY_ASSET_COLUMNS,
  createSourceWeeklyAssetsCandidate,
} from "../scripts/source-weekly-assets-core.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows) {
  return `${SOURCE_WEEKLY_ASSET_COLUMNS.join(",")}\n${rows.map((row) => SOURCE_WEEKLY_ASSET_COLUMNS.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

function sourceRows(source, player, byeWeek) {
  const csvSource = source === "Footballguys" ? "FBG" : source;
  const maxWeek = source === "CBS" ? 17 : 18;
  return Array.from({ length: maxWeek }, (_, index) => {
    const week = index + 1;
    const bye = week === byeWeek;
    const deliberatelyMissing = source === "CBS" && week === (byeWeek === 2 ? 3 : 2);
    const row = {
      pack_player_id: player.id,
      player_name: player.name,
      position: player.position,
      nfl_team: player.nflTeam,
      source: csvSource,
      week,
      is_bye: Number(bye),
      data_status: bye ? "bye" : source === "CBS" ? deliberatelyMissing ? "missing" : "native" : "season_curve",
      ...Object.fromEntries(SOURCE_WEEKLY_ASSET_COLUMNS.slice(8).map((column) => [column, ""])),
    };
    if (!bye && !deliberatelyMissing) {
      row.rush_yds = { Footballguys: 100, CBS: 40, FantasyPros: 80, PFF: 60 }[source];
    }
    return row;
  });
}

function bundle() {
  const player = pack.players.find((row) => row.position === "RB" && row.weeklyProjection);
  const byeWeek = player.weeklyProjection.byeWeek;
  return {
    player,
    files: Object.fromEntries(["Footballguys", "CBS", "FantasyPros", "PFF"].map((source) => [source, csv(sourceRows(source, player, byeWeek))])),
  };
}

const options = {
  sourceAsOf: "2026-08-21T08:07:20-06:00",
  exportedAt: "2026-08-21T15:00:00Z",
  modelId: "tb-weekly-source-consensus-test-v1",
  coverageThresholds: Object.fromEntries(["Footballguys", "CBS", "FantasyPros", "PFF"].map((source) => [source, { players: 1, usableRows: 1 }])),
};

test("per-source weekly assets drive an availability-aware four-source projection", () => {
  const { player, files } = bundle();
  const { candidate, audit } = createSourceWeeklyAssetsCandidate(pack, files, options);
  const updated = candidate.players.find((row) => row.id === player.id);
  const pff = updated.projectionSources.find((row) => row.source === "PFF");
  const cbs = updated.projectionSources.find((row) => row.source === "CBS");
  assert.ok(pff);
  assert.ok(cbs.points > 40 * 0.1 * 15, "CBS missing week should be imputed from available sources, not scored as zero");
  assert.equal(updated.projectionSources.filter((row) => row.modelEffect === "primary_projection").length, 1);
  assert.ok(Math.abs(updated.weeklyProjection.points.reduce((sum, value) => sum + (value ?? 0), 0) - updated.projectedPoints) <= 0.11);
  assert.equal(updated.weeklyProjection.points[updated.weeklyProjection.byeWeek - 1], null);
  assert.equal(audit.missingRowsTreatedAsZero, 0);
  assert.equal(audit.sourceCoverage.PFF.players, 1);
});

test("missing or bye source rows cannot smuggle nonzero assets into the consensus", () => {
  const { files } = bundle();
  files.CBS = files.CBS.replace(",missing,,,,", ",missing,10,,,");
  assert.throws(
    () => createSourceWeeklyAssetsCandidate(pack, files, options),
    (error) => error.code === "SOURCE_ASSET_EMPTY_STATUS",
  );
});

test("every source must label authoritative bye rows explicitly", () => {
  const { player, files } = bundle();
  const rows = sourceRows("Footballguys", player, player.weeklyProjection.byeWeek);
  const bye = rows.find((row) => row.is_bye === 1);
  bye.data_status = "season_curve";
  bye.rush_yds = 10;
  files.Footballguys = csv(rows);
  assert.throws(
    () => createSourceWeeklyAssetsCandidate(pack, files, options),
    (error) => error.code === "SOURCE_ASSET_BYE",
  );
});
