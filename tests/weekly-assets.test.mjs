import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createWeeklyAssetsCandidatePack,
  SEASON_ASSET_COLUMNS,
  WEEKLY_ASSET_COLUMNS,
} from "../scripts/weekly-assets-core.mjs";

const pack = JSON.parse(await readFile(new URL("../public/thunder-bowl/sample-draft-pack.json", import.meta.url), "utf8"));
const metadata = {
  schema_version: 1,
  season: 2026,
  source_name: "Thunder Bowl weekly assets",
  model_id: "tb-weekly-assets-test-v1",
  source_as_of: "2026-08-09T20:37:13-06:00",
  exported_at: "2026-08-10T03:22:58Z",
  scoring_fingerprint: "tb26-ppr-6pt-pass-td-minus2-int-2pt-sack-50fg-v1",
  authority: "candidate_only",
};
const assetColumns = WEEKLY_ASSET_COLUMNS.slice(WEEKLY_ASSET_COLUMNS.indexOf("pass_att"));

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(columns, rows) {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bundle() {
  const seasonRows = [];
  const weeklyRows = [];
  for (const player of pack.players) {
    const common = {
      ...metadata,
      source_player_id: player.id,
      pack_player_id: player.id,
      player_name: player.name,
      position: player.position,
      nfl_team: player.nflTeam,
      season_asset_source: "FBG",
      weekly_shape_source: "FBG",
    };
    seasonRows.push({ ...common, bye: 7, ...Object.fromEntries(assetColumns.map((column) => [column, column === "rush_yds" ? 170 : 0])) });
    for (let week = 1; week <= 18; week += 1) {
      const bye = week === 7;
      weeklyRows.push({
        ...common,
        week,
        is_bye: Number(bye),
        weekly_share: bye ? 0 : 1 / 17,
        ...Object.fromEntries(assetColumns.map((column) => [column, !bye && column === "rush_yds" ? 10 : 0])),
      });
    }
  }
  const weeklyText = csv(WEEKLY_ASSET_COLUMNS, weeklyRows);
  const seasonText = csv(SEASON_ASSET_COLUMNS, seasonRows);
  const manifest = {
    kind: "thunder-bowl-weekly-assets-v1",
    schema_version: 1,
    season: 2026,
    source_name: "Thunder Bowl weekly assets",
    model_id: metadata.model_id,
    source_as_of: metadata.source_as_of,
    exported_at: metadata.exported_at,
    authority: "candidate_only",
    scoring_fingerprint: metadata.scoring_fingerprint,
    coverage: {
      total: pack.players.length,
      season_fbg: pack.players.length,
      season_cbs: 0,
      season_fp: 0,
      season_none: 0,
      shape_fbg: pack.players.length,
      shape_cbs: 0,
      shape_team: 0,
      shape_flat: 0,
    },
    reconciliation_failures: 0,
    season_rows: pack.players.length,
    weekly_rows: pack.players.length * 18,
    files: {
      "2026_WEEKLY_ASSETS.csv": { rows: pack.players.length * 18, sha256: digest(weeklyText) },
      "2026_SEASON_ASSETS.csv": { rows: pack.players.length, sha256: digest(seasonText) },
    },
  };
  return { manifest, weeklyText, seasonText };
}

test("weekly-asset intake covers every player while preserving every season projection and value", () => {
  const { candidate, audit } = createWeeklyAssetsCandidatePack(pack, bundle());
  assert.equal(candidate.players.every((player) => player.weeklyProjection?.source === "Thunder Bowl weekly assets v1"), true);
  assert.equal(candidate.weeklyContext.coveredPlayers, pack.players.length);
  assert.equal(candidate.weeklyContext.top168Coverage, 1);
  for (let index = 0; index < pack.players.length; index += 1) {
    const before = pack.players[index];
    const after = candidate.players[index];
    assert.equal(after.projectedPoints, before.projectedPoints);
    assert.equal(after.vbd, before.vbd);
    assert.equal(after.intrinsicValue, before.intrinsicValue);
    assert.equal(after.marketValue, before.marketValue);
    assert.equal(after.maxBid, before.maxBid);
    assert.ok(Math.abs(after.weeklyProjection.points.reduce((sum, value) => sum + (value ?? 0), 0) - before.projectedPoints) <= 0.11);
  }
  assert.equal(audit.seasonProjectionChanges, 0);
  assert.equal(audit.valueFieldsAccepted, 0);
});

test("weekly-asset intake fails closed on hash drift and forbidden value columns", () => {
  const hashDrift = bundle();
  hashDrift.weeklyText += "\n";
  assert.throws(() => createWeeklyAssetsCandidatePack(pack, hashDrift), (error) => error.code === "WEEKLY_ASSET_HASH");

  const forbidden = bundle();
  forbidden.weeklyText = forbidden.weeklyText.replace("weekly_share", "projected_points");
  forbidden.manifest.files["2026_WEEKLY_ASSETS.csv"].sha256 = digest(forbidden.weeklyText);
  assert.throws(() => createWeeklyAssetsCandidatePack(pack, forbidden), (error) => error.code === "WEEKLY_ASSET_VALUE_AUTHORITY");
});

test("weekly-asset intake fails closed when a source identity changes between season and week rows", () => {
  const identityDrift = bundle();
  const lines = identityDrift.weeklyText.trimEnd().split("\n");
  const header = lines[0].split(",");
  const sourcePlayerIdIndex = header.indexOf("source_player_id");
  const firstRow = lines[1].split(",");
  firstRow[sourcePlayerIdIndex] = "wrong-source-player";
  lines[1] = firstRow.join(",");
  identityDrift.weeklyText = `${lines.join("\n")}\n`;
  identityDrift.manifest.files["2026_WEEKLY_ASSETS.csv"].sha256 = digest(identityDrift.weeklyText);
  assert.throws(() => createWeeklyAssetsCandidatePack(pack, identityDrift), (error) => error.code === "WEEKLY_ASSET_IDENTITY");
});
