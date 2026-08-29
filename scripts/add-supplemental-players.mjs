import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { addApprovedSupplementalPlayers } from "./supplemental-player-catalog.mjs";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  console.error("Usage: node scripts/add-supplemental-players.mjs <current-pack.json> <candidate-pack.json>");
  process.exit(2);
}

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const current = JSON.parse(await readFile(inputPath, "utf8"));
const { candidate, added } = addApprovedSupplementalPlayers(current);
if (!added.length) {
  console.log("PASS: every approved supplemental player is already present; no candidate written.");
  process.exit(0);
}
await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
console.log(`PASS: added ${added.length} approved supplemental player identity: ${added.join(", ")}.`);
console.log(`Candidate ${candidate.packId} written; active pack unchanged.`);
