import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { auditDraftPack, renderAuditMarkdown } from "./pack-release-gate.mjs";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const activePath = resolve(root, "netlify/functions/_data/draft-pack-2026-provisional.json");
const reportDirectory = resolve(root, "reports/thunder-bowl");
const archiveDirectory = resolve(root, "artifacts/thunder-bowl/pack-archive");

const args = process.argv.slice(2);
const promote = args.includes("--promote");
const candidateArgument = args.find((argument) => argument !== "--promote");
if (!candidateArgument) {
  console.error("Usage: npm run stage:thunder-pack -- <candidate-pack.json> [--promote]");
  process.exit(2);
}

const candidatePath = resolve(candidateArgument);
const [candidateText, currentText] = await Promise.all([readFile(candidatePath, "utf8"), readFile(activePath, "utf8")]);
const candidate = JSON.parse(candidateText);
const current = JSON.parse(currentText);
const audit = auditDraftPack(candidate, current);

await mkdir(reportDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(reportDirectory, "latest-pack-refresh-audit.json"), `${JSON.stringify(audit, null, 2)}\n`, "utf8"),
  writeFile(resolve(reportDirectory, "latest-pack-refresh-audit.md"), renderAuditMarkdown(audit), "utf8"),
]);

if (!audit.approved) {
  console.error(`BLOCKED ${candidate.packId}: ${audit.blockingIssues.join(" | ")}`);
  process.exit(1);
}

if (!promote) {
  console.log(`PASS ${candidate.packId}: audit reports written; active pack unchanged.`);
  process.exit(0);
}

if (!audit.contentChanged) {
  console.log(`PASS ${candidate.packId}: candidate is byte-equivalent in normalized content; no promotion needed.`);
  process.exit(0);
}

await mkdir(archiveDirectory, { recursive: true });
const archiveName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${basename(activePath)}`;
await writeFile(resolve(archiveDirectory, archiveName), currentText, "utf8");
const temporaryPath = resolve(dirname(activePath), `.draft-pack-${Date.now()}.tmp`);
await writeFile(temporaryPath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
await rename(temporaryPath, activePath);
console.log(`PROMOTED ${candidate.packId}: prior pack archived as ${archiveName}.`);
