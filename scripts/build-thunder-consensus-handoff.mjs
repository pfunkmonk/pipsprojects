import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createProjectionHandoffTemplateRows,
  projectionRowsToCsv,
} from "./projection-refresh-core.mjs";
import { PROJECTION_LAB_MODEL } from "../public/thunder-bowl/projection-lab.mjs";

const [outputArgument] = process.argv.slice(2);
if (!outputArgument) {
  console.error("Usage: node scripts/build-thunder-consensus-handoff.mjs <output.csv>");
  process.exit(2);
}

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const packPath = resolve(root, "netlify/functions/_data/draft-pack-2026-provisional.json");
const pack = JSON.parse(await readFile(packPath, "utf8"));
const premiumNames = new Set(["Footballguys", "CBS", "FantasyPros"]);
const sourceDates = pack.players.flatMap((player) => (player.projectionSources || [])
  .filter((source) => premiumNames.has(source.source) && Number.isFinite(Date.parse(source.asOf)))
  .map((source) => Date.parse(source.asOf)));
if (!sourceDates.length) throw new Error("The active pack has no dated premium projection evidence.");
const sourceAsOf = new Date(Math.max(...sourceDates)).toISOString();
const exportedAt = new Date().toISOString();

const rows = createProjectionHandoffTemplateRows(pack, {
  modelId: PROJECTION_LAB_MODEL.id,
  sourceAsOf,
  exportedAt,
}).map((row) => {
  const sourcePoints = [row.fbg_points, row.cbs_points, row.fantasypros_points]
    .filter((value) => value !== "")
    .map(Number);
  const consensus = Number(row.raw_consensus_points);
  return {
    ...row,
    mean_reversion_delta: 0,
    within_position_delta: 0,
    season_context_delta: 0,
    durability_delta: 0,
    availability_delta: 0,
    modified_projection_points: consensus,
    uncertainty_low: sourcePoints.length ? Math.min(...sourcePoints) : consensus,
    uncertainty_high: sourcePoints.length ? Math.max(...sourcePoints) : consensus,
    fallback_reason: sourcePoints.length >= 2
      ? ""
      : "Single-source pass-through; no second premium projection matched this player",
  };
});

const outputPath = resolve(outputArgument);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, projectionRowsToCsv(rows), "utf8");
console.log(`Wrote ${rows.length} accuracy-weighted consensus rows to ${outputPath}.`);
console.log(`Model ${PROJECTION_LAB_MODEL.id}; source evidence through ${sourceAsOf}.`);
