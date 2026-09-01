import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { replayDraft, toPublicSnapshot, validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));

async function listTextFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listTextFiles(path));
    else if (/\.(?:html|css|mjs|js|json|webmanifest)$/.test(entry.name)) files.push(path);
  }
  return files;
}
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
  "public/thunder-bowl/fbg-session-capture.mjs",
  "public/thunder-bowl/supplemental-session-capture.mjs",
  "public/thunder-bowl/helper/thunder-bowl-data-helper-v0.7.0.zip",
  "public/thunder-bowl/personal-board-exchange.mjs",
  "public/thunder-bowl/storage.mjs",
  "public/thunder-bowl/season/index.html",
  "public/thunder-bowl/season/season.css",
  "public/thunder-bowl/season/season.mjs",
  "public/thunder-bowl/season/service-worker.js",
  "public/thunder-bowl/season/manifest.webmanifest",
  "public/thunder-bowl/season/favicon.svg",
  "public/thunder-bowl/sample-draft-pack.json",
  "netlify/functions/_data/draft-pack-2026-provisional.json",
  "public/thunder-bowl/service-worker.js",
  "public/thunder-bowl/manifest.webmanifest",
  "public/thunder-bowl/thunder-bowl-social.png",
  "public/draft-day/index.html",
  "public/draft-day/app.css",
  "public/draft-day/core.mjs",
  "public/draft-day/nfl-teams.mjs",
  "public/draft-day/setup.mjs",
  "public/draft-day/service-worker.js",
  "public/draft-day/manifest.webmanifest",
  "public/draft-day/favicon.svg",
  "public/draft-day/player-pool.json",
  "public/draft-day/guide/index.html",
  "public/draft-day/auctioneer/index.html",
  "public/draft-day/auctioneer/auctioneer.mjs",
  "public/draft-day/board/index.html",
  "public/draft-day/board/board.mjs",
  "netlify/functions/draft-day-leagues.mjs",
  "netlify/functions/draft-day-auth.mjs",
  "netlify/functions/draft-day-snapshot.mjs",
  "netlify/functions/draft-day-commands.mjs",
  "netlify/functions/_draft-day/security.mjs",
  "netlify/functions/_draft-day/store.mjs",
  "netlify/functions/_draft-day/service.mjs",
  "netlify/functions/_draft-day/http-handlers.mjs",
  "netlify/functions/thunder-auth.mjs",
  "netlify/functions/thunder-admin.mjs",
  "netlify/functions/thunder-ledger.mjs",
  "netlify/functions/thunder-pack.mjs",
  "netlify/functions/thunder-status.mjs",
  "netlify/functions/thunder-news.mjs",
  "netlify/functions/thunder-research.mjs",
  "netlify/functions/thunder-intelligence-collector.mjs",
  "netlify/functions/thunder-season-snapshot.mjs",
  "netlify/functions/thunder-season-refresh.mjs",
  "netlify/functions/thunder-season-tuesday-collector.mjs",
  "netlify/functions/thunder-season-watch-collector.mjs",
  "netlify/functions/thunder-public.mjs",
  "netlify/functions/_lib/auth.mjs",
  "netlify/functions/_lib/ledger-generation.mjs",
  "netlify/functions/_lib/ledger-store.mjs",
  "netlify/functions/_lib/status-store.mjs",
  "netlify/functions/_lib/news-store.mjs",
  "netlify/functions/_lib/research-store.mjs",
  "netlify/functions/_lib/cbs-season-source.mjs",
  "netlify/functions/_lib/fbg-season-source.mjs",
  "netlify/functions/_lib/season-pack.mjs",
  "netlify/functions/_lib/season-recommendations.mjs",
  "netlify/functions/_lib/season-service.mjs",
  "netlify/functions/_lib/season-store.mjs",
  "netlify/functions/_lib/season-time.mjs",
  "tools/cbs-chrome-helper/manifest.json",
  "tools/cbs-chrome-helper/page-bridge.js",
  "tools/cbs-chrome-helper/service-worker.mjs",
  "tools/cbs-chrome-helper/cbs-normalize.mjs",
  "tools/cbs-chrome-helper/cbs-fab-normalize.mjs",
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
if (!hub.includes('href="/thunder-bowl/"') || !hub.includes('href="/thunder-bowl/auctioneer/"') || !hub.includes('href="/thunder-bowl/season/"') || !hub.includes("Thunder Bowl 2026")) {
  throw new Error("Pip's Projects hub is missing one or more Thunder Bowl access links.");
}
if (!hub.includes('href="/draft-day/"') || !hub.includes('href="/draft-day/auctioneer/"') || !hub.includes('href="/draft-day/board/"') || !hub.includes("Pip's Draft Day Tool")) {
  throw new Error("Pip's Projects hub is missing one or more Draft Day Tool access links.");
}

const pack = validateDraftPack(JSON.parse(await readFile(resolve(root, "public/thunder-bowl/sample-draft-pack.json"), "utf8")));
const currentPack = validateDraftPack(JSON.parse(await readFile(resolve(root, "netlify/functions/_data/draft-pack-2026-provisional.json"), "utf8")));
const draftDayPlayers = JSON.parse(await readFile(resolve(root, "public/draft-day/player-pool.json"), "utf8"));
const state = replayDraft([]);
const publicPayload = JSON.stringify(toPublicSnapshot(state));
for (const forbidden of ["projectedPoints", "weeklyProjection", "assetProjection", "weeklyContext", "vbd", "intrinsicValue", "marketValue", "maxBid", "notes", "managerProfile", "pressureIndex", "opponentPressure", "targetTag"]) {
  if (publicPayload.includes(forbidden)) throw new Error(`Public snapshot includes forbidden field ${forbidden}.`);
}
if (pack.players.length < 10) throw new Error("Practice pack is too small for rapid-search QA.");
if (currentPack.status !== "practice" || currentPack.players.length < 650 || currentPack.keeperCandidates.length < 1) {
  throw new Error("The bundled 2026 practice pack is missing its evidence-approved minimum content.");
}
if (!Array.isArray(draftDayPlayers) || draftDayPlayers.length !== currentPack.players.length || draftDayPlayers.some((player) => Object.keys(player).sort().join(",") !== "byeWeek,id,name,nflTeam,nflTeamName,nflTeamShortName,position")) {
  throw new Error("The Draft Day player pool must contain public identity fields only and match the current player universe.");
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
const userFacingFiles = [
  ...await listTextFiles(resolve(root, "public/thunder-bowl")),
  ...await listTextFiles(resolve(root, "netlify/functions")),
];
const commonMojibakeMarkers = ["â€", "â€¦", "Â·", "Ã—", "ï¿½", "�"];
for (const file of userFacingFiles) {
  const contents = await readFile(file, "utf8");
  const marker = commonMojibakeMarkers.find((candidate) => contents.includes(candidate));
  if (marker) throw new Error(`User-facing source contains a likely UTF-8 decoding artifact (${JSON.stringify(marker)}): ${file}`);
}
for (const variable of ["THUNDER_BOWL_ACCESS_CODE", "THUNDER_BOWL_AUCTIONEER_ACCESS_CODE", "THUNDER_BOWL_DRAFT_BOARD_ACCESS_CODE", "THUNDER_BOWL_SESSION_SECRET", "THUNDER_BOWL_DISPLAY_TOKEN", "DRAFT_DAY_SESSION_SECRET"]) {
  const secret = process.env[variable];
  if (secret && secret.length >= 6 && committedText.some((text) => text.includes(secret))) {
    throw new Error(`${variable} must never be committed into public or function source.`);
  }
}

console.log(`Validated Thunder Bowl and Draft Day shells: ${currentPack.players.length} public player identities, ${state.config.teams.length} Thunder Bowl teams, private/public field isolation intact.`);
