import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditDraftPack } from "./pack-release-gate.mjs";

const [candidateArgument, currentArgument] = process.argv.slice(2);
if (!candidateArgument || !currentArgument) {
  console.error("Usage: node scripts/audit-thunder-pack-candidate.mjs <candidate.json> <current.json>");
  process.exit(2);
}

try {
  const [candidateText, currentText] = await Promise.all([
    readFile(resolve(candidateArgument), "utf8"),
    readFile(resolve(currentArgument), "utf8"),
  ]);
  const audit = auditDraftPack(JSON.parse(candidateText), JSON.parse(currentText));
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  if (!audit.approved) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(2);
}
