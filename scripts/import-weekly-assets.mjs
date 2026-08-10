import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditDraftPack, renderAuditMarkdown } from "./pack-release-gate.mjs";
import { createWeeklyAssetsCandidatePack } from "./weekly-assets-core.mjs";

const [assetDirectoryArgument, outputArgument] = process.argv.slice(2);
if (!assetDirectoryArgument || !outputArgument) {
  console.error("Usage: node scripts/import-weekly-assets.mjs <weekly-assets-output-directory> <candidate-pack.json>");
  process.exit(2);
}

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const currentPath = resolve(root, "netlify/functions/_data/draft-pack-2026-provisional.json");
const assetDirectory = resolve(assetDirectoryArgument);
const [currentText, manifestText, weeklyText, seasonText] = await Promise.all([
  readFile(currentPath, "utf8"),
  readFile(resolve(assetDirectory, "build-manifest.json"), "utf8"),
  readFile(resolve(assetDirectory, "2026_WEEKLY_ASSETS.csv"), "utf8"),
  readFile(resolve(assetDirectory, "2026_SEASON_ASSETS.csv"), "utf8"),
]);
const current = JSON.parse(currentText);
const manifest = JSON.parse(manifestText);
const { candidate, audit: weeklyAssetAudit } = createWeeklyAssetsCandidatePack(current, { manifest, manifestText, weeklyText, seasonText });
const releaseAudit = auditDraftPack(candidate, current);
const combinedAudit = { ...releaseAudit, weeklyAssets: weeklyAssetAudit };

await Promise.all([
  writeFile(resolve(outputArgument), `${JSON.stringify(candidate, null, 2)}\n`, "utf8"),
  writeFile(resolve(root, "reports/thunder-bowl/latest-weekly-assets-audit.json"), `${JSON.stringify(combinedAudit, null, 2)}\n`, "utf8"),
  writeFile(resolve(root, "reports/thunder-bowl/latest-weekly-assets-audit.md"), `${renderAuditMarkdown(releaseAudit)}\n## Weekly-asset intake\n\n\`\`\`json\n${JSON.stringify(weeklyAssetAudit, null, 2)}\n\`\`\`\n`, "utf8"),
]);

if (!releaseAudit.approved) {
  console.error(`BLOCKED ${candidate.packId}: ${releaseAudit.blockingIssues.join(" | ")}`);
  process.exit(1);
}
console.log(`PASS ${candidate.packId}: ${weeklyAssetAudit.players} players and ${weeklyAssetAudit.weeklyRows} weekly rows validated.`);
console.log(`Season projection changes: ${weeklyAssetAudit.seasonProjectionChanges}; forbidden value fields accepted: ${weeklyAssetAudit.valueFieldsAccepted}.`);
console.log("Candidate written; active pack unchanged until the separate promotion step.");
