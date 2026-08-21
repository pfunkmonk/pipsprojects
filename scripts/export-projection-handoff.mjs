import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createProjectionHandoffTemplateRows, projectionRowsToCsv } from "./projection-refresh-core.mjs";

const [outputArgument, identityArgument] = process.argv.slice(2);
if (!outputArgument) {
  console.error("Usage: node scripts/export-projection-handoff.mjs <output.csv> [player-season-identity.csv]");
  process.exit(2);
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else value += character;
  }
  cells.push(value);
  return cells;
}

async function sourceIdsFromIdentityCsv(path) {
  if (!path) return {};
  const lines = (await readFile(resolve(path), "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const indexes = Object.fromEntries(header.map((column, index) => [column, index]));
  const ids = {};
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const values = {
      fbgId: cells[indexes.pfr_id] || "",
      cbsId: cells[indexes.cbs_id] || "",
      fantasyProsId: cells[indexes.fantasypros_id] || "",
      pffId: cells[indexes.pff_id] || "",
      gsisId: cells[indexes.gsis_id] || "",
    };
    if (values.fbgId) ids[`fbg:${values.fbgId}`] = { ...(ids[`fbg:${values.fbgId}`] || {}), ...values };
    if (values.cbsId) ids[`cbs:${values.cbsId}`] = { ...(ids[`cbs:${values.cbsId}`] || {}), ...values };
  }
  return ids;
}

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const packPath = resolve(root, "netlify/functions/_data/draft-pack-2026-provisional.json");
const pack = JSON.parse(await readFile(packPath, "utf8"));
const sourceIdsByPlayerId = await sourceIdsFromIdentityCsv(identityArgument);
const rows = createProjectionHandoffTemplateRows(pack, { sourceIdsByPlayerId });
const outputPath = resolve(outputArgument);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, projectionRowsToCsv(rows), "utf8");
console.log(`Wrote ${rows.length} exact pack-player rows to ${outputPath}.`);
