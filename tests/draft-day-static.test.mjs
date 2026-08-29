import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const hub = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const config = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
const worker = await readFile(new URL("../public/draft-day/service-worker.js", import.meta.url), "utf8");
const auctioneerSource = await readFile(new URL("../public/draft-day/auctioneer/auctioneer.mjs", import.meta.url), "utf8");
const boardSource = await readFile(new URL("../public/draft-day/board/board.mjs", import.meta.url), "utf8");
const appCss = await readFile(new URL("../public/draft-day/app.css", import.meta.url), "utf8");
const playerPool = JSON.parse(await readFile(new URL("../public/draft-day/player-pool.json", import.meta.url), "utf8"));
const setupSource = await readFile(new URL("../public/draft-day/setup.mjs", import.meta.url), "utf8");
const sessionSource = await readFile(new URL("../public/draft-day/session-storage.mjs", import.meta.url), "utf8");
const setupPage = await readFile(new URL("../public/draft-day/index.html", import.meta.url), "utf8");
const auctioneerPage = await readFile(new URL("../public/draft-day/auctioneer/index.html", import.meta.url), "utf8");
const boardPage = await readFile(new URL("../public/draft-day/board/index.html", import.meta.url), "utf8");
const guidePage = await readFile(new URL("../public/draft-day/guide/index.html", import.meta.url), "utf8");
const draftDayDocumentation = await readFile(new URL("../DRAFT-DAY-TOOL.md", import.meta.url), "utf8");
const environment = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const pages = [new URL("../public/draft-day/index.html", import.meta.url), new URL("../public/draft-day/auctioneer/index.html", import.meta.url), new URL("../public/draft-day/board/index.html", import.meta.url), new URL("../public/draft-day/guide/index.html", import.meta.url)];

test("Pip's Projects card exposes setup, auctioneer, and Draft Board routes", () => {
  assert.match(hub, /Pip's Draft Day Tool/);
  assert.match(hub, /href="\/draft-day\/">Create \/ Manage/);
  assert.match(hub, /href="\/draft-day\/auctioneer\/">Auctioneer/);
  assert.match(hub, /href="\/draft-day\/board\/">Draft Board/);
});

test("Netlify routes all Draft Day APIs and applies a strict app policy", () => {
  for (const route of ["leagues", "auth", "snapshot", "commands"]) assert.match(config, new RegExp(`from = "\\/api\\/draft-day\\/${route}"`));
  assert.match(config, /for = "\/draft-day\/\*"[\s\S]*Content-Security-Policy/);
  assert.match(config, /for = "\/api\/draft-day\/\*"[\s\S]*Cache-Control = "no-store"/);
});

test("Draft Day pages use external assets and every local asset exists", async () => {
  for (const page of pages) {
    const html = await readFile(page, "utf8");
    assert.doesNotMatch(html, /<style\b/i);
    assert.match(html, /shell-safety\.css/);
    for (const match of html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g)) {
      const reference = match[1]; if (reference.startsWith("http") || reference.startsWith("data:")) continue;
      await assert.doesNotReject(access(new URL(reference.split("?")[0], page)), `Missing asset ${reference}`);
    }
  }
});

test("offline shell includes setup, auctioneer, board, team schedule, and public player identities", () => {
  for (const path of ["/draft-day/", "/draft-day/auctioneer/", "/draft-day/board/", "/draft-day/guide/", "/draft-day/nfl-teams.mjs", "/draft-day/session-storage.mjs", "/draft-day/player-pool.json"]) assert.ok(worker.includes(`"${path}"`));
  assert.match(worker, /pathname\.startsWith\("\/draft-day\/"\)/);
});

test("repository contains only a Draft Day secret placeholder", () => {
  assert.match(environment, /^DRAFT_DAY_SESSION_SECRET=replace-with-a-separate-long-random-secret$/m);
});

test("offline role access requires a verifier saved after successful online sign-in", () => {
  for (const source of [auctioneerSource, boardSource]) {
    assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
    assert.match(source, /saveVerifier\(localStorage/);
    assert.match(source, /savedVerifier\(localStorage/);
  }
});

test("every Draft Day page and offline asset uses one release version", () => {
  const release = worker.match(/pips-draft-day-shell-([0-9a-z]+)/)?.[1];
  assert.ok(release);
  for (const page of [setupPage, auctioneerPage, boardPage, guidePage]) assert.match(page, new RegExp(`app\\.css\\?v=${release}`));
  for (const asset of ["setup.mjs", "auctioneer.mjs", "board.mjs"]) assert.match(worker, new RegExp(`${asset.replace(".", "\\.")}\\?v=${release}`));
});

test("position maximums are optional, persistent, and fast to clear", () => {
  assert.match(setupPage, /Maximum \(optional\)/);
  assert.match(setupPage, /leave one blank to allow any number at that position/i);
  assert.match(setupPage, /id="allow-any-mix"[^>]*>Allow any mix of backups/);
  assert.match(setupSource, /placeholder: "No positional limit"/);
  assert.match(setupSource, /rule\.maximum/);
  assert.doesNotMatch(setupSource, /"data-position-max": "true", required/);
});

test("league-code guidance explains the automatic name-based code", () => {
  assert.match(setupPage, /first eight letters or numbers in the league name/i);
  assert.match(setupSource, /displayLeagueCode/);
});

test("keeper setup lives in the auctioneer cockpit with predictive search and CSV export", () => {
  assert.doesNotMatch(setupPage, /id="keeper-editor"|id="keepers-enabled"/);
  assert.match(setupPage, /id="keeper-maximum"/);
  assert.match(setupPage, /Auctioneer records keepers, winners, and prices/);
  for (const id of ["keeper-setup", "keeper-toggle-label", "keeper-player-search", "keeper-player-results", "keeper-team", "keeper-salary", "keeper-contract-year", "keeper-round", "record-keeper", "toggle-keeper-lock", "export-csv", "clock-enabled", "copy-board-link"]) {
    assert.match(auctioneerPage, new RegExp(`id="${id}"`));
  }
  assert.match(auctioneerSource, /keeperLegality/);
  assert.match(auctioneerSource, /record-keeper/);
  assert.match(auctioneerSource, /auction-results\.csv/);
  assert.match(boardSource, /board-heartbeat/);
  assert.match(auctioneerPage, /class="keeper-expand-icon"/);
  assert.match(appCss, /\.keeper-expand-icon/);
  assert.doesNotMatch(auctioneerSource, /no separate limit/i);
});

test("setup controls preserve touch-sized wizard navigation", () => {
  assert.match(appCss, /\.step-pill \{ min-height: 2\.75rem;/);
  assert.doesNotMatch(appCss, /\.step-pill \{ min-height: auto/);
});

test("every Draft Day role restores its authenticated session after refresh", () => {
  assert.match(auctioneerSource, /async function restoreAuctioneerSession/);
  assert.match(auctioneerSource, /void restoreAuctioneerSession\(initialLeague\)/);
  assert.match(auctioneerSource, /rememberedLeague\(localStorage, "auctioneer"\)/);
  assert.match(boardSource, /async function restoreBoardSession/);
  assert.match(boardSource, /void restoreBoardSession\(initialLeague\)/);
  assert.match(boardSource, /rememberedLeague\(localStorage, "board"\)/);
  assert.match(setupSource, /async function restoreOrganizerSession/);
  assert.match(setupSource, /void restoreOrganizerSession\(initialOrganizerLeague\)/);
  assert.match(setupSource, /rememberedLeague\(localStorage, "organizer"\)/);
  for (const role of ["organizer", "auctioneer", "board"]) assert.match(sessionSource, new RegExp(`pips-draft-day-last-${role}-league`));
});

test("logout is explicit and separate from automatic refresh restoration", () => {
  for (const page of [setupPage, auctioneerPage, boardPage]) assert.match(page, /id="logout"[^>]*>Log out<\/button>/);
  for (const source of [setupSource, auctioneerSource, boardSource]) {
    assert.match(source, /\/api\/draft-day\/auth", \{ method: "DELETE" \}/);
    assert.match(source, /location\.reload\(\)/);
    assert.match(source, /Could not log out securely/);
  }
  assert.match(auctioneerSource, /void restoreAuctioneerSession\(initialLeague\)/);
  assert.match(boardSource, /void restoreBoardSession\(initialLeague\)/);
  assert.match(setupSource, /void restoreOrganizerSession\(initialOrganizerLeague\)/);
});

test("the user guide and engineering handoff cover the released workflows", () => {
  for (const phrase of ["Allow any mix of backups", "Lock keepers", "nomination card", "Correct", "Undo", "Restore", "Finish draft", "Export", "Refresh stays signed in", "persistent browser cookie", "Log out", "connection drops"]) assert.match(guidePage, new RegExp(phrase, "i"));
  for (const phrase of ["session-storage.mjs", "audit:draft-day-live", "Stage Two", "717-player", "persistent cookies", "Engineering handoff"]) assert.match(draftDayDocumentation, new RegExp(phrase, "i"));
  assert.doesNotMatch(`${guidePage}\n${draftDayDocumentation}`, /current-cash mode|no separate limit/i);
});

test("session expiry preserves queued auction work and owns every repeating timer", () => {
  const flushQueue = auctioneerSource.slice(auctioneerSource.indexOf("async function flushQueue()"), auctioneerSource.indexOf("async function runCommand"));
  assert.match(flushQueue, /if \(error\.status === 401\) \{\s*requireAuctioneerSignIn\(\);\s*return;\s*\}/);
  assert.match(auctioneerSource, /function requireAuctioneerSignIn/);
  assert.match(auctioneerSource, /function stopConsoleResources/);
  assert.match(auctioneerSource, /boardStateTimer = window\.setInterval/);
  assert.match(boardSource, /function requireBoardSignIn/);
  assert.match(boardSource, /function stopBoardResources/);
  assert.match(boardSource, /refreshTimer = window\.setInterval/);
  assert.match(boardSource, /heartbeatTimer = window\.setInterval/);
  assert.equal(boardSource.match(/window\.setInterval/g)?.length, 2);
  assert.match(auctioneerSource, /if \(!navigator\.onLine\) \{ renderSync\("OFFLINE", true\); return; \}/);
  assert.match(boardSource, /if \(!navigator\.onLine\) \{ byId\("connection-state"\)\.textContent = "OFFLINE"/);
});

test("setup makes keeper salary deduction automatic instead of exposing a budget mode", () => {
  assert.doesNotMatch(setupPage, /id="budget-mode"/);
  assert.match(setupPage, /Keeper salaries deduct automatically/);
  assert.match(setupPage, /Starting pool before keepers/);
  assert.match(setupSource, /budgetMode: "pre-keeper"/);
});

test("selected auction player drives a large public nomination overlay", () => {
  for (const id of ["nomination-overlay", "nomination-card", "nomination-player", "nomination-team"]) assert.match(boardPage, new RegExp(`id="${id}"`));
  assert.match(auctioneerSource, /type: "nominate-player"/);
  assert.match(auctioneerSource, /type: "clear-nomination"/);
  assert.match(boardSource, /snapshot\.nominatedPlayer/);
  assert.match(appCss, /\.nomination-overlay/);
  assert.match(appCss, /font-size: clamp\(3rem, 9vw, 8\.5rem\)/);
});

test("auction history stays with the compact winning-assignment column", () => {
  const saleColumn = auctioneerPage.match(/<div class="sale-column">([\s\S]*?)<div>\s*<details id="clock-panel"/)?.[1] || "";
  assert.match(saleColumn, /<h1>Winning assignment<\/h1>/);
  assert.match(saleColumn, /<h2>Assignment history<\/h2>/);
  assert.match(saleColumn, /id="history-rows"/);
  assert.equal(auctioneerPage.match(/id="history-rows"/g)?.length, 1);
  assert.match(appCss, /\.sale-panel > h1 \{ font-size: clamp\(2rem, 3vw, 3\.1rem\)/);
  assert.match(appCss, /\.sale-column > \.panel \{ min-width: 0; \}/);
  assert.match(appCss, /\.history-panel \.history-table tr \{ display: grid/);
  assert.doesNotMatch(appCss, /\.sale-panel \{ position: sticky/);
});

test("Draft Board stickers expose position color, NFL team, bye week, and an explicit keeper marker", () => {
  for (const className of ["position-qb", "position-rb", "position-wr", "position-te", "position-k", "position-dst"]) assert.match(appCss, new RegExp(`\\.${className}`));
  for (const token of ["positionClass", "nfl-team", "bye-week", "keeper-flag", 'flag.textContent = "KEEPER"']) assert.ok(boardSource.includes(token));
  assert.match(boardSource, /nflTeamShortName/);
  assert.match(boardSource, /nflTeamName/);
  assert.match(boardSource, /aria-label/);
});

test("public player pool carries only sticker-ready identity and schedule fields", () => {
  const expectedKeys = "byeWeek,id,name,nflTeam,nflTeamName,nflTeamShortName,position";
  assert.ok(playerPool.length >= 650);
  assert.ok(playerPool.every((player) => Object.keys(player).sort().join(",") === expectedKeys));
  assert.ok(playerPool.every((player) => player.nflTeam === "FA" || (player.nflTeamName && player.nflTeamShortName && Number.isInteger(player.byeWeek))));
});
