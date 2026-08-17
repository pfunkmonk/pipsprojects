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
const setupPage = await readFile(new URL("../public/draft-day/index.html", import.meta.url), "utf8");
const auctioneerPage = await readFile(new URL("../public/draft-day/auctioneer/index.html", import.meta.url), "utf8");
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
  for (const path of ["/draft-day/", "/draft-day/auctioneer/", "/draft-day/board/", "/draft-day/guide/", "/draft-day/nfl-teams.mjs", "/draft-day/player-pool.json"]) assert.ok(worker.includes(`"${path}"`));
  assert.match(worker, /pathname\.startsWith\("\/draft-day\/"\)/);
});

test("repository contains only a Draft Day secret placeholder", () => {
  assert.match(environment, /^DRAFT_DAY_SESSION_SECRET=replace-with-a-separate-long-random-secret$/m);
});

test("offline role access requires a verifier saved after successful online sign-in", () => {
  for (const source of [auctioneerSource, boardSource]) {
    assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
    assert.match(source, /localStorage\.setItem\(verifierKey\(code\), await accessVerifier/);
    assert.match(source, /localStorage\.getItem\(verifierKey\(code\)\) === await accessVerifier/);
  }
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
  for (const id of ["keeper-setup", "keeper-player-search", "keeper-player-results", "keeper-team", "keeper-salary", "keeper-contract-year", "keeper-round", "record-keeper", "export-csv", "clock-enabled", "copy-board-link"]) {
    assert.match(auctioneerPage, new RegExp(`id="${id}"`));
  }
  assert.match(auctioneerSource, /keeperLegality/);
  assert.match(auctioneerSource, /record-keeper/);
  assert.match(auctioneerSource, /auction-results\.csv/);
  assert.match(boardSource, /board-heartbeat/);
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
