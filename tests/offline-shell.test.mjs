import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const indexHtml = await readFile(new URL("../public/thunder-bowl/index.html", import.meta.url), "utf8");
const publicHtml = await readFile(new URL("../public/thunder-bowl/public.html", import.meta.url), "utf8");
const boardHtml = await readFile(new URL("../public/thunder-bowl/board.html", import.meta.url), "utf8");
const auctioneerHtml = await readFile(new URL("../public/thunder-bowl/auctioneer/index.html", import.meta.url), "utf8");
const boardIndexHtml = await readFile(new URL("../public/thunder-bowl/board/index.html", import.meta.url), "utf8");
const guidesHtml = await readFile(new URL("../public/thunder-bowl/guides/index.html", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../public/thunder-bowl/manifest.webmanifest", import.meta.url), "utf8"));
const favicon = await readFile(new URL("../public/thunder-bowl/favicon.svg", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../public/thunder-bowl/service-worker.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/thunder-bowl/app.mjs", import.meta.url), "utf8");
const appCss = await readFile(new URL("../public/thunder-bowl/app.css", import.meta.url), "utf8");
const readinessSource = await readFile(new URL("../public/thunder-bowl/draft-readiness.mjs", import.meta.url), "utf8");
const publicBoardSource = await readFile(new URL("../public/thunder-bowl/public-board.mjs", import.meta.url), "utf8");
const fbgConfigurationSource = await readFile(new URL("../public/thunder-bowl/fbg-configuration.mjs", import.meta.url), "utf8");
const intelligenceCollectorSource = await readFile(new URL("../netlify/functions/thunder-intelligence-collector.mjs", import.meta.url), "utf8");

test("release assets are versioned across private, public, and offline shells", () => {
  assert.match(indexHtml, /app\.mjs\?v=\d{8}[a-z]/);
  assert.match(indexHtml, /app\.css\?v=\d{8}[a-z]/);
  assert.match(publicHtml, /public-board\.mjs\?v=\d{8}[a-z]/);
  assert.match(serviceWorker, /app\.mjs\?v=\d{8}[a-z]/);
});

test("every Thunder Bowl surface uses the blue and silver-white number 20 favicon", () => {
  assert.match(favicon, /fill="#0076b6"/i);
  assert.match(favicon, /fill="#f7f8fa"/i);
  assert.match(favicon, /stroke="#9ea7b1"/i);
  assert.match(favicon, />20<\/text>/);
  for (const html of [indexHtml, publicHtml, boardHtml, auctioneerHtml, boardIndexHtml, guidesHtml]) {
    assert.match(html, /rel="icon"[^>]+favicon\.svg\?v=20260808h/);
  }
  assert.equal(manifest.icons[0].src, "/thunder-bowl/favicon.svg?v=20260808h");
  assert.equal(manifest.icons[0].purpose, "any maskable");
  assert.match(serviceWorker, /favicon\.svg\?v=20260808h/);
});

test("desktop draft controls remain pinned above the fold", () => {
  const wideDraftRule = appCss.slice(
    appCss.indexOf("@media (min-width: 901px) and (min-height: 700px)"),
    appCss.indexOf(".section-intro"),
  );
  assert.match(wideDraftRule, /#view-draft \{ padding-bottom: 9rem; \}/);
  assert.match(wideDraftRule, /#view-draft \.sale-bar \{[\s\S]*position: fixed;/);
  assert.match(wideDraftRule, /bottom: 0\.75rem;/);
  assert.match(wideDraftRule, /left: clamp\(1rem, 2vw, 2rem\);/);
});

test("wide draft columns share one viewport height and keep secondary content internally scrollable", () => {
  assert.match(indexHtml, /class="nomination-section"/);
  const draftMarkup = indexHtml.slice(indexHtml.indexOf('id="view-draft"'), indexHtml.indexOf('id="view-keepers"'));
  const adminMarkup = indexHtml.slice(indexHtml.indexOf('id="view-settings"'));
  assert.doesNotMatch(draftMarkup, /class="[^"]*safety-section/);
  assert.match(adminMarkup, /class="[^"]*settings-card safety-section/);
  assert.match(adminMarkup, /<h3 id="safety-rails-title">Safety rails<\/h3>/);
  const balancedColumns = appCss.slice(
    appCss.indexOf("/* Three-column draft desk"),
    appCss.indexOf(".need-grid"),
  );
  assert.match(balancedColumns, /@media \(min-width: 1251px\) and \(min-height: 700px\)/);
  assert.match(balancedColumns, /height: max\(36rem, calc\(100dvh - 21\.5rem\)\)/);
  assert.match(balancedColumns, /grid-template-rows: auto auto auto minmax\(0, 1fr\) auto/);
  assert.match(balancedColumns, /\.decision-panel \{[\s\S]*overflow-y: auto/);
  assert.match(balancedColumns, /\.decision-coach \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(balancedColumns, /\.opponent-pressure-section \{[\s\S]*overflow-y: auto/);
  assert.match(balancedColumns, /grid-template-rows: auto auto minmax\(0, 1fr\)/);
  assert.match(appSource, /classList\.toggle\("is-auctioneer-feed", policy\.auctioneer/);
});

test("the private draft room can safely switch between auctioneer feed and manual backup", () => {
  for (const id of ["sales-entry-control", "sales-entry-title", "sales-entry-detail", "sales-entry-health", "sales-mode-auctioneer", "sales-mode-manual"]) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(indexHtml, /Auctioneer feed/);
  assert.match(indexHtml, /Manual backup/);
  assert.match(indexHtml, /<div class="app-navigation">[\s\S]*<nav class="app-tabs"[\s\S]*<section id="sales-entry-control"/);
  assert.doesNotMatch(indexHtml, /<form id="sale-form"[^>]*>[\s\S]{0,200}id="sales-entry-control"/);
  assert.match(appSource, /normalizeSalesEntryMode\(await getMeta\("salesEntryMode"/);
  assert.match(appSource, /setMeta\("salesEntryMode", salesEntryMode\)/);
  assert.match(appSource, /salesEntryMode !== SALES_ENTRY_MODES\.MANUAL/);
  assert.match(appSource, /Pulling the latest confirmed auctioneer sale before manual takeover/);
  assert.match(appSource, /currentSalesEntryPolicy\(\)\.pollIntervalMs/);
  assert.match(appCss, /\.sale-bar\.is-auctioneer-mode \.manual-sale-control \{ display: none; \}/);
  assert.match(appCss, /\.sale-bar\.is-auctioneer-mode \{ display: none; \}/);
  assert.match(serviceWorker, /sales-entry-mode\.mjs\?v=/);
});

test("private command-center source has no visible UTF-8 decoding artifacts", () => {
  for (const source of [indexHtml, appSource]) {
    assert.doesNotMatch(source, /â€|â€¦|Â·|Ã—|ï¿½|�/u);
  }
});

test("background auctioneer polling never flashes a syncing label", () => {
  assert.doesNotMatch(appSource, /chip\.textContent = "Syncing/);
  assert.match(appSource, /chip\.setAttribute\("aria-busy", "true"\)/);
  assert.match(appSource, /chip\.removeAttribute\("aria-busy"\)/);
});

test("selected-player scarcity and source confidence are dynamic display-only evidence", () => {
  for (const id of ["selected-tier-supply", "selected-next-alternative", "selected-tier-cliff", "selected-source-spread", "selected-context-detail"]) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(indexHtml, /Scarcity &amp; confidence/);
  assert.match(indexHtml, /DISPLAY ONLY/);
  assert.match(appSource, /buildDecisionContext\(\{/);
  assert.match(appSource, /availablePlayers: availablePlayers\(\)/);
  assert.match(appSource, /valueFor: \(candidate\) => effectivePlayerBidLimit\(candidate\)/);
  assert.match(appSource, /No value authority/);
  assert.match(serviceWorker, /decision-context\.mjs\?v=/);
});

test("draft-pressure helpers share the live player, roster, legal-max, and nomination state", () => {
  for (const id of [
    "decision-coach",
    "decision-coach-verdict",
    "decision-win-chance",
    "decision-forecast-sale",
    "decision-current-bid",
    "decision-comparables",
    "decision-tier-warning",
    "decision-tier-warning-title",
    "decision-tier-warning-message",
    "decision-cash-leverage",
    "decision-budget-runway",
    "decision-best-alternative",
    "decision-position-run",
    "selected-bye-warning",
    "open-tier-dialog",
    "tier-dialog",
    "tier-dialog-rows",
    "nomination-coach",
    "nomination-recommendations",
  ]) assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  assert.match(indexHtml, /id="decision-coach-verdict">WAIT<\/span>/);
  assert.match(indexHtml, /<th>NFL team<\/th><th>Player<\/th><th class="number">Bye<\/th><th class="number">Projected<\/th><th>Status<\/th>/);
  assert.match(appSource, /buildBidRecommendation\(\{/);
  assert.match(appSource, /buildTierDeadlineWarning\(\{/);
  assert.match(indexHtml, /Win at next bid/);
  assert.match(appSource, /const legalNextBid = Number\.isSafeInteger\(recommendation\.nextBid\)/);
  assert.match(appSource, /recommendation\.nextBid <= personalMaximum/);
  assert.match(appSource, /dogsBidLimit: recommendation\.nextBid/);
  assert.match(appSource, /byeWeekConflicts\(\{/);
  assert.match(appSource, /buildTierSnapshot\(\{/);
  assert.match(appSource, /buildNominationAssistant\(\{/);
  assert.match(appSource, /draftState\.currentNominatorTeamId === USER_TEAM_ID/);
  assert.match(appSource, /legalMaximumBid\(team, draftState\.config, position\)/);
  assert.doesNotMatch(publicBoardSource, /decision-coach|nomination-recommendations|personalMaximum/i);
});

test("the Thunder projection exposes its live consensus and rejected corrections", () => {
  for (const id of [
    "selected-projection-lab",
    "projection-lab-summary",
    "projection-lab-primary",
    "projection-lab-consensus",
    "projection-lab-modified",
    "projection-lab-range",
    "projection-lab-breakdown",
    "projection-lab-evidence",
  ]) assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  assert.match(indexHtml, /id="projection-lab-authority"/);
  assert.match(indexHtml, /Consensus blend/);
  assert.match(appSource, /buildProjectionLabPreview\(player/);
  assert.match(appSource, /QA-approved automatic correction/);
  assert.match(appSource, /Failed mean-reversion, durability, weather, analog, and schedule total-point corrections remain value-neutral/);
  assert.match(serviceWorker, /projection-lab\.mjs\?v=20260809c/);
  assert.doesNotMatch(publicBoardSource, /projection-lab|Thunder candidate/i);
});

test("auction intelligence stays private, optional, fast to capture, and offline cached", () => {
  for (const id of [
    "auction-forecast",
    "auction-natural-price",
    "auction-price-range",
    "auction-dogs-price",
    "runner-up-prompt",
    "runner-up-team",
    "runner-up-skip",
    "auction-telemetry-rows",
  ]) assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  assert.match(appSource, /RUNNER_UP_PROMPT_MS/);
  assert.match(appSource, /setTimeout\(\(\) => void saveRunnerUpUnknown/);
  assert.match(appSource, /forecastAuctionPrice\(\{/);
  assert.match(appSource, /bidAuthority: "none"|advisory only/);
  assert.match(appSource, /private runner-up learning log/i);
  assert.match(serviceWorker, /auction-intelligence\.mjs\?v=20260810b/);
  assert.match(serviceWorker, /auction-telemetry\.mjs\?v=20260809a/);
  assert.doesNotMatch(publicBoardSource, /runnerUp|runner-up/i);
});

test("the public board is one standings-ordered row with budget headers and acquisition cards", () => {
  assert.match(publicHtml, /class="team-board-viewport"/);
  assert.match(appCss, /grid-template-columns: repeat\(12, minmax\(168px, 1fr\)\)/);
  assert.match(appCss, /\.team-board-viewport \{[^}]*overflow-x: auto/);
  assert.match(publicBoardSource, /team\.startingCap/);
  assert.match(publicBoardSource, /PUBLIC_TEAM_ORDER/);
  assert.match(publicBoardSource, /CURRENT/);
  assert.match(publicBoardSource, /player\.acquisitionType === "keeper"/);
  assert.match(publicBoardSource, /Waiting for keepers/);
});

test("primary pages implement keyboard-roving tabs and reduced-motion safety", () => {
  assert.match(indexHtml, /id="tab-draft"[\s\S]*tabindex="0"/);
  assert.match(indexHtml, /id="tab-keepers"[\s\S]*tabindex="-1"/);
  assert.match(indexHtml, /id="tab-settings"[\s\S]*tabindex="-1"/);
  assert.match(appSource, /function navigateAppTabs/);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) assert.match(appSource, new RegExp(key));
  assert.match(appSource, /tab\.tabIndex = active \? 0 : -1/);
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the Admin screen exposes annual schedule setup and bounded live schedule VBD", () => {
  assert.match(indexHtml, /Schedule and division gate/);
  assert.match(indexHtml, /id="schedule-division-weeks"/);
  assert.match(indexHtml, /id="league-setup-form"/);
  assert.match(indexHtml, /All-play · no H2H/);
  assert.match(indexHtml, /Download setup backup/);
  assert.match(indexHtml, /Schedule-adjusted VBD/);
  assert.match(indexHtml, /id="priority-experimental-mode"/);
  assert.match(indexHtml, /Use validated 1\.20 \/ 1\.50/);
  assert.match(indexHtml, /only 35% of the replacement-relative edge receives authority/);
  assert.match(indexHtml, /hard ±3 VBD cap/);
  assert.match(indexHtml, /150,000 league simulations/);
  assert.match(appSource, /effectiveScheduleContext\(\)/);
  assert.match(appSource, /validateLeagueSetup/);
  assert.match(appSource, /setMeta\("leagueSetup", leagueSetup\)/);
  assert.match(appSource, /setMeta\("priorityWeightScenario", priorityScenario\)/);
  assert.match(appSource, /buildPriorityVbdOverlay/);
  assert.match(appSource, /calculateAuctionDemandMarket\(valuationPack \|\| draftPack, draftState\)/);
  assert.match(appSource, /applyPriorityVbdOverlay/);
  assert.match(appSource, /Validated 1\.20.* division and 1\.50.* playoff timing is live/);
  assert.match(appSource, /live schedule adjustment/);
  assert.doesNotMatch(appSource, /stays display-only until it passes the historical promotion gate/);
  assert.match(appSource, /if \(!priorityControlsDirty\) syncPriorityControls\(\)/);
  assert.match(appSource, /priorityControlsDirty = false/);
  assert.match(serviceWorker, /priority-weights\.mjs\?v=/);
  assert.match(serviceWorker, /league-setup\.mjs\?v=/);
});

test("the CBS bridge is user-triggered, locally persisted, and offline code remains cached", () => {
  assert.match(indexHtml, /id="capture-cbs-rosters"/);
  assert.match(indexHtml, /id="export-cbs-rosters"/);
  assert.match(appSource, /requestCbsRosterCapture\(\)/);
  assert.match(appSource, /setMeta\("cbsRosterSnapshot", snapshot\)/);
  assert.match(serviceWorker, /cbs-roster-snapshot\.mjs\?v=/);
});

test("static shell refreshes from the network before falling back to cache", () => {
  const staticHandler = serviceWorker.slice(
    serviceWorker.indexOf("async function staticResponse"),
    serviceWorker.indexOf('self.addEventListener("fetch"'),
  );
  assert.ok(staticHandler.indexOf("await fetch(request)") < staticHandler.indexOf("await caches.match(request)"));
});

test("unreachable online access falls back to the saved local verifier quickly", () => {
  assert.match(appSource, /AbortSignal\.timeout\(ACCESS_CHECK_TIMEOUT_MS\)/);
  assert.match(appSource, /hasOfflineVerifier\(\)/);
  assert.match(appSource, /verifyOfflineCode\(code\)/);
  assert.doesNotMatch(appSource, /Turn off Wi/);
});

test("the evidence pack is fetched through the authenticated API and never precached publicly", () => {
  assert.match(appSource, /\/api\/thunder-bowl\/pack/);
  assert.doesNotMatch(appSource, /fetch\("\.\/draft-pack-2026-provisional\.json/);
  assert.doesNotMatch(serviceWorker, /draft-pack-2026-provisional\.json/);
});

test("background pack refresh is conditional, infrequent, and reconnect-aware", () => {
  assert.match(appSource, /PACK_REFRESH_INTERVAL_MS = 30 \* 60 \* 1000/);
  assert.match(appSource, /"If-None-Match": priorEtag/);
  assert.match(appSource, /response\.status === 304/);
  assert.match(appSource, /schedulePackRefresh\(1000\)/);
  assert.match(appSource, /latestPack\.packId !== draftPack\.packId/);
  assert.doesNotMatch(appSource, /recordSale[\s\S]{0,500}refreshPackInBackground/);
});

test("live injury status refresh is hourly, offline-persistent, and value-isolated", () => {
  assert.match(appSource, /STATUS_REFRESH_INTERVAL_MS = 60 \* 60 \* 1000/);
  assert.match(appSource, /\/api\/thunder-bowl\/status/);
  assert.match(appSource, /setMeta\("liveStatusSnapshot", snapshot\)/);
  assert.match(appSource, /14 \* 86_400_000/);
  assert.match(appSource, /forbidden of \["projectedPoints", "projectionSources", "weeklyProjection", "assetProjection", "weeklyContext", "managerProfiles", "pressureIndex", "opponentPressure", "vbd", "intrinsicValue", "marketValue", "maxBid", "keeperValue"\]/);
  assert.match(appSource, /response\.status === 304 && !liveStatusSnapshot/);
  assert.match(appSource, /setMeta\("liveStatusEtag", null\)/);
  assert.match(appSource, /Unavailable — \$\{liveStatusError\}/);
  assert.doesNotMatch(appSource, /recordSale[\s\S]{0,500}refreshLiveStatus/);
});

test("player intelligence exposes value-neutral live depth and availability details", () => {
  assert.match(indexHtml, /id="intel-injury-detail"/);
  assert.match(appSource, /Sleeper depth chart:/);
  assert.match(appSource, /live\.practiceParticipation/);
  assert.match(appSource, /live\.injuryBodyPart/);
  assert.match(appSource, /supplemental, no value effect/);
  assert.match(appSource, /schemaVersion !== 2/);
});

test("private personal decisions have a validated same-season Mac transfer path with no value or ledger authority", () => {
  for (const id of ["personal-board-title", "personal-board-total", "personal-board-targets", "personal-board-avoids", "personal-board-prices", "personal-board-notes", "personal-board-backup-state", "export-personal-board", "export-personal-board-csv", "personal-board-file", "personal-board-status"]) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(indexHtml, /New JSON restores the complete board exactly, including deletions/i);
  assert.match(indexHtml, /schema-v1 files merge without deleting local decisions/i);
  assert.match(indexHtml, /can(?:not| change) projections, VBD, model prices, or the auction ledger/i);
  assert.match(appSource, /createPersonalBoardBundle/);
  assert.match(appSource, /validatePersonalBoardBundle/);
  assert.match(appSource, /mergePersonalBoardAnnotations/);
  assert.match(appSource, /personalBoardCsv/);
  assert.match(appSource, /createPersonalBoardEvidence/);
  assert.match(appSource, /personalBoardFingerprint/);
  assert.match(appSource, /setMeta\("personalBoardBackupEvidence"/);
  assert.match(appSource, /event\.key !== PLAYER_ANNOTATIONS_KEY[\s\S]{0,160}personalBoardBackupEvidence = null/);
  assert.match(appSource, /Personal board changed\. Download a new private JSON/);
  assert.match(appSource, /Personal board changed in another Thunder Bowl tab/);
  assert.match(readinessSource, /"personal-board-backup"/);
  assert.match(appSource, /replacePersonalBoardAnnotations/);
  assert.match(appSource, /Restored the complete personal board/);
  assert.match(appSource, /Imported legacy schema-v1 decisions/);
  assert.match(appSource, /Import failed safely; the previous personal board was restored/);
  assert.match(serviceWorker, /personal-board-exchange\.mjs\?v=/);
  const importFunction = appSource.slice(appSource.indexOf("async function importPersonalBoard"), appSource.indexOf("function exportRecovery"));
  assert.doesNotMatch(importFunction, /commitLocalEvents|appendEvents|replaceEvents|events\s*=|draftPack\s*=|vbd\s*=|marketValue\s*=|maxBid\s*=/);
  assert.match(importFunction, /bundle\.scope === "full-board"/);
  assert.match(importFunction, /priorSerialized/);
  assert.match(importFunction, /localStorage\.setItem\(PLAYER_ANNOTATIONS_KEY, priorSerialized\)/);
  assert.match(importFunction, /setMeta\("personalBoardBackupEvidence", priorEvidence\)/);
});

test("player intelligence embeds source-linked news with a separate offline-safe value firewall", () => {
  assert.match(indexHtml, /id="intel-news-list"/);
  assert.match(indexHtml, /RotoWire, CBS, and Footballguys headlines and summaries/);
  assert.match(indexHtml, /<button id="intel-news-link"[^>]*type="button"[^>]*>Refresh latest news<\/button>/);
  assert.doesNotMatch(indexHtml, /<a id="intel-news-link"/);
  assert.match(appSource, /NEWS_REFRESH_INTERVAL_MS = 10 \* 60 \* 1000/);
  assert.match(appSource, /\/api\/thunder-bowl\/news/);
  assert.match(appSource, /setMeta\("liveNewsSnapshot", snapshot\)/);
  assert.match(appSource, /playerNewsItems\(player\)/);
  assert.match(appSource, /refreshPlayerNewsInApp/);
  assert.match(appSource, /You stayed inside Thunder Bowl/);
  assert.match(appSource, /forbidden of \["projectedPoints", "weeklyProjection", "assetProjection", "weeklyContext", "vbd", "intrinsicValue", "marketValue", "maxBid", "keeperValue", "recommendedBid"\]/);
  assert.doesNotMatch(appSource, /recordSale[\s\S]{0,500}refreshLiveNews/);
});

test("player intelligence uses an explicit full-screen dismiss layer around the interactive card", () => {
  assert.match(indexHtml, /id="player-intel-backdrop" class="player-intel-backdrop"[\s\S]*id="player-intel-backdrop-hitbox"/);
  assert.match(appSource, /function closePlayerIntelFromBackdrop\(event\)/);
  assert.match(appSource, /!playerIntelDialog\.open/);
  assert.match(appSource, /event\.currentTarget === byId\("player-intel-backdrop"\)/);
  assert.match(appSource, /byId\("player-intel-backdrop"\)\.addEventListener\("click", closePlayerIntelFromBackdrop\)/);
  assert.match(appCss, /\.player-intel-dialog \{[\s\S]*inset: 0;[\s\S]*width: 100vw;[\s\S]*height: 100vh;[\s\S]*background: transparent;/);
  assert.match(appCss, /\.player-intel-backdrop \{[\s\S]*position: absolute;[\s\S]*inset: 0;[\s\S]*background: transparent;/);
  assert.match(appCss, /\.player-intel-backdrop > span \{[\s\S]*inset: 0 auto 0 0;[\s\S]*width: max\(1rem,/);
  assert.match(appCss, /\.player-intel-dialog > form \{[\s\S]*width: min\(1180px,[\s\S]*overflow: auto;[\s\S]*background: var\(--navy-800\);/);
});

test("Footballguys news/depth charts and CBS news refresh and render internally without Google search", () => {
  for (const id of ["intel-cbs-news-list", "intel-cbs-news-freshness", "intel-fbg-news-list", "intel-fbg-news-freshness", "intel-fbg-depth", "intel-fbg-depth-freshness"]) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(indexHtml, /<button id="intel-cbs-link"[^>]*>Refresh CBS news<\/button>/);
  assert.match(indexHtml, /<button id="intel-fbg-link"[^>]*>Refresh FBG news &amp; depth<\/button>/);
  assert.doesNotMatch(indexHtml, /<a id="intel-(?:cbs|fbg)-link"/);
  assert.match(appSource, /\/api\/thunder-bowl\/research/);
  assert.match(appSource, /validateResearchSnapshot/);
  assert.match(appSource, /renderIntelCbsNews/);
  assert.match(appSource, /renderIntelFbgDepth/);
  assert.match(appSource, /setMeta\("liveResearchSnapshot", snapshot\)/);
  assert.doesNotMatch(appSource, /google\.com\/search/);
});

test("draft morning can force, scan, seal, restore, and export every-player intelligence", () => {
  for (const id of ["capture-morning-intelligence", "export-morning-intelligence", "morning-intelligence-time", "morning-intelligence-players", "morning-intelligence-status-coverage", "morning-intelligence-depth", "morning-intelligence-news", "morning-intelligence-action-status"]) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(appSource, /captureMorningIntelligence/);
  assert.match(appSource, /morningPlayerCoverage/);
  assert.match(appSource, /force: true/);
  assert.match(appSource, /setMeta\("morningIntelligenceSnapshot", morningIntelligenceSnapshot\)/);
  assert.match(appSource, /getMeta\("morningIntelligenceSnapshot"\)/);
  assert.match(appSource, /playersScanned: rows\.length/);
  assert.match(appSource, /sourceSnapshots:/);
  assert.match(indexHtml, /Download intelligence backup/);
  assert.match(readinessSource, /morning-intelligence/);
  assert.match(intelligenceCollectorSource, /schedule: "@hourly"/);
  assert.match(intelligenceCollectorSource, /currentResearchSnapshot\(\{ force: true \}\)/);
  assert.match(intelligenceCollectorSource, /modelEffect: "none"/);
});

test("draft-morning readiness and the printable local fallback are offline-cached and read-only", () => {
  for (const id of ["run-readiness", "readiness-overall", "readiness-checks", "open-emergency-board", "readiness-action-status", "emergency-board-dialog", "emergency-board-frame", "print-emergency-board", "close-emergency-board"]) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(appSource, /buildDraftReadinessReport/);
  assert.match(appSource, /buildEmergencyBoardHtml/);
  assert.match(appSource, /emergency-board-frame["']\)\.srcdoc = html/);
  const emergencyFunction = appSource.slice(appSource.indexOf("function openEmergencyBoard"), appSource.indexOf("function printEmergencyBoard"));
  assert.doesNotMatch(emergencyFunction, /window\.open/);
  assert.match(readinessSource, /modelEffect:\s*"none"/);
  assert.match(readinessSource, /ledgerEffect:\s*"none"/);
  assert.match(serviceWorker, /draft-readiness\.mjs\?v=/);
  assert.match(serviceWorker, /player-search\.mjs\?v=/);
  assert.match(serviceWorker, /emergency-print\.css\?v=/);
});

test("automatic rehearsal is pack-pinned while the physical checklist remains optional", () => {
  for (const id of ["human-rehearsal-title", "human-rehearsal-progress", "seal-human-rehearsal", "clear-human-rehearsal", "human-rehearsal-status"]) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
  for (const item of ["full-auction", "second-screen", "wifi-loss", "offline-actions", "reconnect", "recovery-import", "noisy-room"]) {
    assert.match(indexHtml, new RegExp(`data-human-rehearsal=["']${item}["']`));
  }
  assert.match(indexHtml, /Optional human-attested evidence/);
  assert.match(indexHtml, /pack-pinned automatic full-system rehearsal/);
  assert.match(appSource, /createHumanRehearsalEvidence/);
  assert.match(appSource, /setMeta\("humanRehearsalEvidence", humanRehearsalEvidence\)/);
  assert.match(appSource, /humanRehearsalEvidence,/);
  assert.match(appSource, /if \(status\.current\) input\.checked = true;\s*else if \(humanRehearsalEvidence\) input\.checked = false;/);
  assert.match(appSource, /addEventListener\("change", refreshHumanRehearsalControls\)/);
  assert.match(readinessSource, /"rehearsal"/);
  assert.match(readinessSource, /AUTOMATED_REHEARSAL_EVIDENCE/);
  assert.match(serviceWorker, /human-rehearsal\.mjs\?v=/);
  assert.match(serviceWorker, /automated-rehearsal-evidence\.mjs\?v=/);
});

test("validated Footballguys, CBS, or RotoWire news adds a dynamic evidence-only player warning badge", () => {
  assert.match(indexHtml, /id="selected-player-name" class="selected-player-name-line"/);
  assert.match(appCss, /\.player-news-alert \{[\s\S]*background: #c52d27;[\s\S]*color: #fff;/);
  assert.match(appSource, /function rebuildPlayerNewsSignals\(\)/);
  assert.match(appSource, /if \(playerNewsItems\(player\)\.length\) sources\.push\("RotoWire"\)/);
  assert.match(appSource, /if \(playerCbsNewsItems\(player\)\.length\) sources\.push\("CBS"\)/);
  assert.match(appSource, /if \(playerFbgNewsItems\(player\)\.length\) sources\.push\("Footballguys"\)/);
  assert.match(appSource, /saved news available, right-click for the full player record/);
  assert.match(appSource, /function applyLiveNewsSnapshot[\s\S]*rebuildPlayerNewsSignals\(\);[\s\S]*renderPlayerNewsSignalSurfaces\(\);/);
  assert.match(appSource, /function applyLiveResearchSnapshot[\s\S]*rebuildPlayerNewsSignals\(\);[\s\S]*renderPlayerNewsSignalSurfaces\(\);/);
  assert.doesNotMatch(appSource, /playerNewsSignals\.(?:set|get)[^\n]*(?:vbd|marketValue|maxBid|projectedPoints)/i);
});

test("practice reset requires an exact phrase and sends the current ledger generation", () => {
  assert.match(indexHtml, /ARCHIVE AND START NEW/);
  assert.match(appSource, /generation: ledgerGeneration/);
  assert.match(appSource, /ledgerStale/);
  assert.match(appSource, /exportRecovery\(\)/);
  assert.match(indexHtml, /Load current cloud rehearsal/);
  assert.match(appSource, /loadCurrentCloudLedger/);
});

test("keeper declarations and cap trades use the offline-first audited ledger", () => {
  for (const id of [
    "keeper-assignment-form",
    "keeper-player-search",
    "keeper-player",
    "keeper-team",
    "keeper-selection-timeline",
    "pass-keeper-turn",
    "cap-transfer-form",
    "cap-from-team",
    "cap-to-team",
    "cap-transfer-amount",
    "cap-transfer-player-status",
    "cap-transfer-player",
    "add-cap-transfer-player",
    "cap-transfer-player-list",
    "cap-return-player-status",
    "cap-return-player",
    "add-cap-return-player",
    "cap-return-player-list",
    "keeper-evidence-pass",
    "undo-keeper-action",
  ]) {
    assert.match(indexHtml, new RegExp(`id="${id}"`));
  }
  assert.match(appSource, /EVENT_TYPES\.KEEPER_ASSIGNED/);
  assert.match(appSource, /EVENT_TYPES\.KEEPER_PASSED/);
  assert.match(appSource, /EVENT_TYPES\.CAP_TRANSFERRED/);
  assert.match(appSource, /EVENT_TYPES\.KEEPER_RIGHTS_TRADED/);
  assert.match(appSource, /keeperMeta\.textContent = `\$\{slot\.position\} · \$\{slot\.nflTeam\} · \$\{currency\(slot\.salary\)\}`/);
  assert.match(appCss, /\.keeper-turn-card \.keeper-turn-meta/);
  assert.match(appSource, /commitKeeperWorkspaceEvents\(\s*\[keeper\]/);
  assert.match(appSource, /commitKeeperWorkspaceEvents\(\s*\[pass\]/);
  assert.match(appSource, /commitKeeperWorkspaceEvents\(\s*\[transfer\]/);
  assert.match(appSource, /lastUndoableEvent\(keeperWorkspaceEventList\(\), KEEPER_SETUP_EVENT_TYPES\)/);
  assert.match(indexHtml, /Prediction-sandbox actions stay private on this laptop; only actions deliberately entered in Official ledger mode can sync to the public board/);
  assert.match(indexHtml, /Official 1–12 \/ 1–12 order/);
  assert.match(indexHtml, /Cap dollars Team A pays Team B/);
  assert.match(indexHtml, /min="0" max="200"/);
});

test("keeper strategy exports a complete advisory board without granting model or ledger authority", () => {
  for (const id of ["export-keeper-board", "keeper-export-status"]) assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  assert.match(appSource, /buildKeeperBoard/);
  assert.match(appSource, /keeperBoardCsv/);
  assert.match(appSource, /text\/csv;charset=utf-8/);
  assert.match(appSource, /Trade ranges are advisory and use current practice values/);
  assert.match(serviceWorker, /keeper-board\.mjs\?v=/);
});

test("league-wide candidate evidence has a remembered team selector and accessible disclosure", () => {
  for (const id of ["keeper-evidence-details", "keeper-evidence-title", "keeper-evidence-toggle-label", "keeper-evidence-team-label", "keeper-evidence-team", "keeper-count", "keeper-rows"]) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(indexHtml, /<details id="keeper-evidence-details">[\s\S]*<summary class="panel-header keeper-evidence-summary">/);
  assert.doesNotMatch(indexHtml, /<details id="keeper-evidence-details" open>/);
  assert.match(appSource, /getMeta\("keeperEvidenceExpanded", false\)/);
  assert.match(appSource, /setMeta\("keeperEvidenceExpanded", event\.currentTarget\.open\)/);
  assert.match(appSource, /details\.open \? "Hide table" : "Show table"/);
  assert.match(appSource, /keeperCandidatesForTeam\(selectedKeeperEvidenceTeamId\)/);
  assert.match(appSource, /dynamicKeeperSurplus\(right\) - dynamicKeeperSurplus\(left\)/);
  assert.match(indexHtml, /aria-sort="descending">Surplus ↓<\/th>/);
  assert.match(appSource, /getMeta\("keeperEvidenceTeamId", "dogs-of-war"\)/);
  assert.match(appSource, /setMeta\("keeperEvidenceTeamId", teamId\)/);
  assert.match(appSource, /renderKeeperScenarios\(keeperCandidatesForTeam\("dogs-of-war"\)\)/);
  assert.match(appCss, /\.keeper-evidence-summary:focus-visible/);
  assert.match(appCss, /\.keeper-evidence-team-picker select:focus-visible/);
  assert.match(appCss, /details\[open\] \.keeper-evidence-chevron/);
});

test("keeper prediction sandbox recalculates scarcity without leaking into the official public ledger", () => {
  for (const id of [
    "keeper-mode-sandbox",
    "keeper-mode-official",
    "keeper-sandbox-copy-official",
    "keeper-sandbox-reset",
    "keeper-scenario-impact",
    "keeper-fbg-coverage",
  ]) assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  assert.match(appSource, /calculateKeeperScenarioValues\(valuationPack \|\| draftPack, keeperWorkspaceState\(\)\)/);
  assert.match(appSource, /keeperWorkspaceMode === "sandbox"/);
  assert.match(appSource, /keeperPredictionSandboxEvents/);
  assert.match(appSource, /Private prediction only; public board unchanged/);
  assert.match(appSource, /row\.addEventListener\("dblclick"/);
  assert.match(appSource, /FBG comparison loaded/);
  assert.match(indexHtml, /Estimated price if this player were available in the current auction pool/);
  assert.match(indexHtml, />Auction value<\/th><th class="number">FBG value<\/th>/);
  assert.match(serviceWorker, /keeper-scenario\.mjs\?v=/);
  assert.match(serviceWorker, /auction-demand\.mjs\?v=/);
  assert.match(serviceWorker, /fbg-configuration\.mjs\?v=/);
  assert.match(appSource, /marketValue: demandValue \?\? player\.marketValue/);
  assert.match(appSource, /maxBid: liveMarket\.bidCeilingsByPlayerId\[player\.id\] \?\? player\.maxBid/);
  assert.match(fbgConfigurationSource, /status: "incompatible_with_thunder_bowl"/);
  assert.match(fbgConfigurationSource, /modelEffect: "none"/);
  assert.match(fbgConfigurationSource, /raw dollars are not Thunder Bowl-compatible/);
});

test("keeper strategy exposes ranked trade-for and trade-away proposals without auto-recording them", () => {
  for (const id of [
    "keeper-market-title",
    "keeper-market-team",
    "keeper-market-note",
    "keeper-market-summary",
    "keeper-market-evidence",
    "keeper-acquire-list",
    "keeper-sell-list",
    "keeper-market-status",
  ]) assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  assert.match(appSource, /buildKeeperTradeMarket\(keeperScenarioPack\(\), \{ teamId: selectedKeeperMarketTeamId, declaredKeeperIds \}\)/);
  assert.match(appSource, /function activeDeclaredKeeperIds\(\)[\s\S]*acquisitionType === "keeper"/);
  assert.match(appSource, /buildKeeperBoard\(keeperScenarioPack\(\), \{ declaredKeeperIds: activeDeclaredKeeperIds\(\) \}\)/);
  assert.match(appSource, /declared keeper\$\{declaredKeeperIds\.length === 1 \? " is" : "s are"\} locked out of the trade market/);
  assert.match(appSource, /selectedKeeperMarketTeamId = "dogs-of-war"/);
  assert.match(appSource, /byId\("keeper-market-team"\)\.addEventListener\("change"/);
  assert.match(appSource, /keeperTradeScenario\(opportunity, amount\)/);
  assert.match(appSource, /addKeeperTradeFact\(facts, "Contract", `\$\{opportunity\.contractYearLabel\} · \$\{opportunity\.contractYearsLeft\} left`\)/);
  assert.match(appCss, /\.keeper-market-facts \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(appSource, /loadKeeperTradeProposal/);
  assert.match(appSource, /function ownerKeeperStatusRationale\(opportunity\)/);
  assert.match(appSource, /has already declared both keepers/);
  assert.match(appSource, /has declared one keeper/);
  assert.match(appSource, /has not declared any keepers/);
  assert.match(appSource, /ownerDeclaredKeeperNames\.join\(" and "\)/);
  assert.doesNotMatch(appSource, /This is currently in the owner’s top two/);
  assert.doesNotMatch(appSource, /The owner currently has at least two stronger keeper values/);
  assert.match(appSource, /Review it, negotiate, and record the atomic rights trade only after both teams agree/);
  assert.doesNotMatch(appSource, /loadKeeperTradeProposal[\s\S]{0,1200}commitLocalEvents/);
  assert.match(appSource, /KEEPER_TRADE_RESULT_LIMIT = 20/);
  assert.match(appSource, /KEEPER_TRADE_VISIBLE_CARDS = 5/);
  assert.match(appSource, /market\.acquire\.slice\(0, KEEPER_TRADE_RESULT_LIMIT\)/);
  assert.match(appSource, /market\.tradeAway\.slice\(0, KEEPER_TRADE_RESULT_LIMIT\)/);
  assert.match(appSource, /cards\.slice\(0, KEEPER_TRADE_VISIBLE_CARDS\)/);
  assert.match(appSource, /requestAnimationFrame\(sizeKeeperTradeResultWindows\)/);
  assert.match(appSource, /top \$\{shown\} shown/);
  assert.match(indexHtml, /id="keeper-acquire-list"[^>]+tabindex="0"[^>]+up to 20 results with five visible at a time/);
  assert.match(indexHtml, /id="keeper-sell-list"[^>]+tabindex="0"[^>]+up to 20 results with five visible at a time/);
  assert.match(appCss, /\.keeper-market-list \{[^}]*max-height: var\(--keeper-market-window-height, none\);[^}]*overflow-y: auto;/);
  assert.match(appCss, /\.keeper-market-list:not\(\.is-scrollable\)/);
  assert.match(appCss, /\.keeper-market-list:focus-visible/);
});

test("data setup exports a clean chronological draft history for CBS entry and future modeling", () => {
  for (const id of ["export-draft-history", "draft-history-status"]) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(appSource, /buildDraftHistoryRows\(\{ events, pack: draftPack \}\)/);
  assert.match(appSource, /draftHistoryCsv\(rows\)/);
  assert.match(indexHtml, /active cap trade, keeper decision, nomination skip, and auction purchase/i);
});
