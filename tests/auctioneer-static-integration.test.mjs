import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const netlifyConfig = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
const environmentExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../public/thunder-bowl/service-worker.js", import.meta.url), "utf8");
const auctioneerHtmlUrl = new URL("../public/thunder-bowl/auctioneer/index.html", import.meta.url);
const draftBoardHtmlUrl = new URL("../public/thunder-bowl/draft-board/index.html", import.meta.url);
const boardHtmlUrl = new URL("../public/thunder-bowl/board.html", import.meta.url);
const homeHtmlUrl = new URL("../public/index.html", import.meta.url);

function redirectBlock(from, to) {
  return new RegExp(`\\[\\[redirects\\]\\][\\s\\S]*?from = "${from.replaceAll("/", "\\/")}"[\\s\\S]*?to = "${to.replaceAll("/", "\\/")}"[\\s\\S]*?status = 200`);
}

async function assertLocalAssetsExist(htmlUrl) {
  const html = await readFile(htmlUrl, "utf8");
  const references = [...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => !reference.startsWith("http") && !reference.startsWith("data:"));
  assert.ok(references.length > 0, `${htmlUrl.pathname} should load local assets`);
  for (const reference of references) {
    const cleanReference = reference.split("?")[0].split("#")[0];
    await assert.doesNotReject(access(new URL(cleanReference, htmlUrl)), `Missing local asset: ${reference}`);
  }
}

test("Netlify exposes the separate auctioneer and tokenized board APIs", () => {
  const routes = [
    ["/api/thunder-bowl/auctioneer/auth", "/.netlify/functions/thunder-bowl-auctioneer-auth"],
    ["/api/thunder-bowl/draft-board/auth", "/.netlify/functions/thunder-bowl-draft-board-auth"],
    ["/api/thunder-bowl/auctioneer/snapshot", "/.netlify/functions/thunder-bowl-auctioneer-snapshot"],
    ["/api/thunder-bowl/auctioneer/commands", "/.netlify/functions/thunder-bowl-auctioneer-commands"],
    ["/api/thunder-bowl/board/snapshot", "/.netlify/functions/thunder-bowl-board-snapshot"],
    ["/thunder-bowl/board", "/thunder-bowl/board.html"],
  ];
  for (const [from, to] of routes) assert.match(netlifyConfig, redirectBlock(from, to));
});

test("auctioneer and flat projector shells have no missing local assets", async () => {
  await assertLocalAssetsExist(auctioneerHtmlUrl);
  await assertLocalAssetsExist(draftBoardHtmlUrl);
  await assertLocalAssetsExist(boardHtmlUrl);
});

test("the project card offers separate private, auctioneer, and Draft Board entrances", async () => {
  const homeHtml = await readFile(homeHtmlUrl, "utf8");
  assert.match(homeHtml, /href="\/thunder-bowl\/">Pip's Access/);
  assert.match(homeHtml, /href="\/thunder-bowl\/auctioneer\/">Auctioneer Access/);
  assert.match(homeHtml, /href="\/thunder-bowl\/draft-board\/">Draft Board/);
});

test("offline shell caches both auctioneer and projector experiences", () => {
  assert.match(serviceWorker, /"\/thunder-bowl\/auctioneer\/"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/auctioneer\/auctioneer\.mjs"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/draft-board\/"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/draft-board\/draft-board\.mjs"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/board\.html"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/board\/board\.mjs"/);
  assert.match(serviceWorker, /pathname\.startsWith\("\/thunder-bowl\/board"\)/);
  assert.match(serviceWorker, /pathname\.startsWith\("\/thunder-bowl\/auctioneer"\)/);
  assert.match(serviceWorker, /pathname\.startsWith\("\/thunder-bowl\/draft-board"\)/);
});

test("repository configuration documents only an auctioneer-code placeholder", () => {
  assert.match(environmentExample, /^THUNDER_BOWL_AUCTIONEER_ACCESS_CODE=replace-with-separate-six-digit-code$/m);
  assert.match(environmentExample, /^THUNDER_BOWL_DRAFT_BOARD_ACCESS_CODE=replace-with-separate-draft-board-code$/m);
  assert.doesNotMatch(environmentExample, /^THUNDER_BOWL_AUCTIONEER_ACCESS_CODE=\d{6}$/m);
  assert.doesNotMatch(environmentExample, /Barry#1/);
});
