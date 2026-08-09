import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditDraftPack, renderAuditMarkdown } from "./pack-release-gate.mjs";
import { createProjectionCandidatePack, parseProjectionHandoffCsv } from "./projection-refresh-core.mjs";

const [handoffArgument, outputArgument] = process.argv.slice(2);
if (!handoffArgument || !outputArgument) {
  console.error("Usage: node scripts/run-projection-refresh.mjs <completed-handoff.csv> <candidate-pack.json>");
  process.exit(2);
}

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const currentPath = resolve(root, "netlify/functions/_data/draft-pack-2026-provisional.json");
const [currentText, handoffText] = await Promise.all([
  readFile(currentPath, "utf8"),
  readFile(resolve(handoffArgument), "utf8"),
]);
const current = JSON.parse(currentText);
const candidate = createProjectionCandidatePack(current, parseProjectionHandoffCsv(handoffText));
const audit = auditDraftPack(candidate, current);
await Promise.all([
  writeFile(resolve(outputArgument), `${JSON.stringify(candidate, null, 2)}\n`, "utf8"),
  writeFile(resolve(root, "reports/thunder-bowl/latest-projection-refresh-audit.json"), `${JSON.stringify(audit, null, 2)}\n`, "utf8"),
  writeFile(resolve(root, "reports/thunder-bowl/latest-projection-refresh-audit.md"), renderAuditMarkdown(audit), "utf8"),
]);
if (!audit.approved) {
  console.error(`BLOCKED ${candidate.packId}: ${audit.blockingIssues.join(" | ")}`);
  process.exit(1);
}
console.log(`PASS ${candidate.packId}: candidate and audit written; active pack unchanged.`);
console.log("PROMOTION BLOCKED: exact historical FBG/CBS/FantasyPros outcome testing is not yet available.");
