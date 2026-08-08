import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { replayDraft, toPublicSnapshot, validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const required = [
  "public/index.html",
  "public/thunder-bowl/index.html",
  "public/thunder-bowl/public.html",
  "public/thunder-bowl/app.css",
  "public/thunder-bowl/app.mjs",
  "public/thunder-bowl/public-board.mjs",
  "public/thunder-bowl/state-engine.mjs",
  "public/thunder-bowl/priority-weights.mjs",
  "public/thunder-bowl/cbs-roster-snapshot.mjs",
  "public/thunder-bowl/personal-board-exchange.mjs",
  "public/thunder-bowl/storage.mjs",
  "public/thunder-bowl/sample-draft-pack.json",
  "netlify/functions/_data/draft-pack-2026-provisional.json",
  "public/thunder-bowl/service-worker.js",
  "public/thunder-bowl/manifest.webmanifest",
  "public/thunder-bowl/thunder-bowl-social.png",
  "netlify/functions/thunder-auth.mjs",
  "netlify/functions/thunder-admin.mjs",
  "netlify/functions/thunder-ledger.mjs",
  "netlify/functions/thunder-pack.mjs",
  "netlify/functions/thunder-status.mjs",
  "netlify/functions/thunder-news.mjs",
  "netlify/functions/thunder-research.mjs",
  "netlify/functions/thunder-intelligence-collector.mjs",
  "netlify/functions/thunder-public.mjs",
  "netlify/functions/_lib/auth.mjs",
  "netlify/functions/_lib/ledger-generation.mjs",
  "netlify/functions/_lib/ledger-store.mjs",
  "netlify/functions/_lib/status-store.mjs",
  "netlify/functions/_lib/news-store.mjs",
  "netlify/functions/_lib/research-store.mjs",
  "tools/cbs-chrome-helper/manifest.json",
  "tools/cbs-chrome-helper/page-bridge.js",
  "tools/cbs-chrome-helper/service-worker.mjs",
  "tools/cbs-chrome-helper/cbs-normalize.mjs",
];

for (const relative of required) await stat(resolve(root, relative));

let publicPackExists = true;
try {
  await stat(resolve(root, "public/thunder-bowl/draft-pack-2026-provisional.json"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  publicPackExists = false;
}
if (publicPackExists) throw new Error("The private Thunder Bowl evidence pack must never be published as a static asset.");

const hub = await readFile(resolve(root, "public/index.html"), "utf8");
if (!hub.includes('href="/thunder-bowl/"') || !hub.includes('href="/thunder-bowl/auctioneer/"') || !hub.includes("Thunder Bowl 2026")) {
  throw new Error("Pip's Projects hub is missing one or more Thunder Bowl access links.");
}

const pack = validateDraftPack(JSON.parse(await readFile(resolve(root, "public/thunder-bowl/sample-draft-pack.json"), "utf8")));
const currentPack = validateDraftPack(JSON.parse(await readFile(resolve(root, "netlify/functions/_data/draft-pack-2026-provisional.json"), "utf8")));
const state = replayDraft([]);
const publicPayload = JSON.stringify(toPublicSnapshot(state));
for (const forbidden of ["projectedPoints", "weeklyProjection", "weeklyContext", "vbd", "intrinsicValue", "marketValue", "maxBid", "notes", "managerProfile", "pressureIndex", "opponentPressure", "targetTag"]) {
  if (publicPayload.includes(forbidden)) throw new Error(`Public snapshot includes forbidden field ${forbidden}.`);
}
if (pack.players.length < 10) throw new Error("Practice pack is too small for rapid-search QA.");
if (currentPack.status !== "practice" || currentPack.players.length < 650 || currentPack.keeperCandidates.length < 1) {
  throw new Error("The bundled 2026 practice pack is missing its evidence-approved minimum content.");
}

const sourceFiles = required.filter((file) => file.endsWith(".mjs") || file.endsWith(".js"));
for (const relative of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", resolve(root, relative)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Syntax check failed for ${relative}:\n${result.stderr}`);
}

const committedText = await Promise.all(
  required
    .filter((file) => /\.(?:html|css|mjs|js|webmanifest)$/.test(file))
    .map((file) => readFile(resolve(root, file), "utf8")),
);
if (committedText.some((text) => text.includes("431743"))) {
  throw new Error("The private access code must never be committed into public or function source.");
}

console.log(`Validated Thunder Bowl shell: ${currentPack.players.length} current practice players, ${state.config.teams.length} teams, private/public field isolation intact.`);
