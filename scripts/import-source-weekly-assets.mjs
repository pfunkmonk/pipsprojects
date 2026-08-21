import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditDraftPack, renderAuditMarkdown } from "./pack-release-gate.mjs";
import { createSourceWeeklyAssetsCandidate } from "./source-weekly-assets-core.mjs";

const [sourceDirectoryArgument, outputArgument] = process.argv.slice(2);
if (!sourceDirectoryArgument || !outputArgument) {
  console.error("Usage: node scripts/import-source-weekly-assets.mjs <by_source-directory> <candidate-pack.json>");
  process.exit(2);
}

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const currentPath = resolve(root, "netlify/functions/_data/draft-pack-2026-provisional.json");
const sourceDirectory = resolve(sourceDirectoryArgument);
const sourceFiles = {
  Footballguys: "2026_WEEKLY_ASSETS_FBG.csv",
  CBS: "2026_WEEKLY_ASSETS_CBS.csv",
  FantasyPros: "2026_WEEKLY_ASSETS_FantasyPros.csv",
  PFF: "2026_WEEKLY_ASSETS_PFF.csv",
};
const sourcePaths = Object.fromEntries(Object.entries(sourceFiles).map(([source, filename]) => [source, resolve(sourceDirectory, filename)]));
const [currentText, ...fileTexts] = await Promise.all([
  readFile(currentPath, "utf8"),
  ...Object.values(sourcePaths).map((path) => readFile(path, "utf8")),
]);
const fileStats = await Promise.all(Object.values(sourcePaths).map((path) => stat(path)));
const sourceAsOf = new Date(Math.min(...fileStats.map((row) => row.mtimeMs))).toISOString();
const exportedAt = new Date().toISOString();
const sourceDate = sourceAsOf.slice(0, 10).replaceAll("-", "");
const modelId = `tb-weekly-source-consensus-${sourceDate}-v1`;
const files = Object.fromEntries(Object.keys(sourcePaths).map((source, index) => [source, fileTexts[index]]));
const current = JSON.parse(currentText);
const { candidate, audit: sourceAssetAudit } = createSourceWeeklyAssetsCandidate(current, files, {
  sourceAsOf,
  exportedAt,
  modelId,
});
const releaseAudit = auditDraftPack(candidate, current);
const combinedAudit = { ...releaseAudit, sourceWeeklyAssets: sourceAssetAudit };

await Promise.all([
  writeFile(resolve(outputArgument), `${JSON.stringify(candidate, null, 2)}\n`, "utf8"),
  writeFile(resolve(root, "reports/thunder-bowl/latest-source-weekly-assets-audit.json"), `${JSON.stringify(combinedAudit, null, 2)}\n`, "utf8"),
  writeFile(resolve(root, "reports/thunder-bowl/latest-source-weekly-assets-audit.md"), `${renderAuditMarkdown(releaseAudit)}\n## Per-source weekly asset intake\n\n\`\`\`json\n${JSON.stringify(sourceAssetAudit, null, 2)}\n\`\`\`\n`, "utf8"),
]);

if (!releaseAudit.approved) {
  console.error(`BLOCKED ${candidate.packId}: ${releaseAudit.blockingIssues.join(" | ")}`);
  process.exit(1);
}
console.log(`PASS ${candidate.packId}: ${sourceAssetAudit.playersWithFreshRows}/${sourceAssetAudit.players} players received fresh source evidence.`);
console.log(`Changed projections: ${sourceAssetAudit.changedPlayers}; missing source rows treated as zero: ${sourceAssetAudit.missingRowsTreatedAsZero}.`);
console.log("Candidate written; active pack unchanged until the separate promotion step.");
