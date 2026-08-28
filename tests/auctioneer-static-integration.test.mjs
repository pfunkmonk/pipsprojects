import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const netlifyConfig = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
const environmentExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../public/thunder-bowl/service-worker.js", import.meta.url), "utf8");
const auctioneerSource = await readFile(new URL("../public/thunder-bowl/auctioneer/auctioneer.mjs", import.meta.url), "utf8");
const boardSource = await readFile(new URL("../public/thunder-bowl/board/board.mjs", import.meta.url), "utf8");
const auctioneerHtmlUrl = new URL("../public/thunder-bowl/auctioneer/index.html", import.meta.url);
const draftBoardHtmlUrl = new URL("../public/thunder-bowl/draft-board/index.html", import.meta.url);
const boardHtmlUrl = new URL("../public/thunder-bowl/board.html", import.meta.url);
const guidesHtmlUrl = new URL("../public/thunder-bowl/guides/index.html", import.meta.url);
const homeHtmlUrl = new URL("../public/index.html", import.meta.url);
const shellSafetyCssUrl = new URL("../public/thunder-bowl/shared/shell-safety.css", import.meta.url);

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
  await assertLocalAssetsExist(guidesHtmlUrl);
});

test("operations guide matches the released keeper, failover, and readiness workflows", async () => {
  const guide = await readFile(guidesHtmlUrl, "utf8");
  assert.match(guide, /Prediction sandbox/);
  assert.match(guide, /Official ledger/);
  assert.match(guide, /Auctioneer feed/);
  assert.match(guide, /Manual backup/);
  assert.match(guide, /Promote &amp; lock this final pack/i);
  assert.match(guide, /practice pack remains unchanged/i);
  assert.match(guide, /only writable offline authority/i);
  assert.match(guide, /CBS Auction Import CSV/);
  assert.match(guide, /player_name,nfl_team,position,fantasy_team,auction_price,player_id/);
  assert.doesNotMatch(guide, /Run the real app server on its LAN interface/);
});

test("an unchanged successful auctioneer refresh clears stale offline or rejection indicators", () => {
  assert.match(auctioneerSource, /else\s*\{\s*renderCloudStatus\(\);\s*updateRecordAvailability\(\);\s*\}/);
});

test("auctioneer disables an illegal pending sale before the server backstop", () => {
  assert.match(auctioneerSource, /function pendingSaleState\(\)/);
  assert.match(auctioneerSource, /pending\.inputReady && pending\.legality\?\.legal/);
  assert.match(auctioneerSource, /`Blocked · max \$\$\{pending\.legality\.legalMaxBid\}`/);
  assert.match(auctioneerSource, /if \(!legality\.legal\) \{[\s\S]*flashIllegal\(legality\.message\);[\s\S]*return;/);
});

test("auctioneer treats the final keeper set as view-only while preserving sale corrections", async () => {
  const html = await readFile(auctioneerHtmlUrl, "utf8");
  assert.match(html, /id="keeper-lock-notice"/);
  assert.match(auctioneerSource, /function keeperAssignmentLocked/);
  assert.match(auctioneerSource, /OWNER LOCKED/);
  assert.match(auctioneerSource, /private Command Center for keeper corrections/);
  assert.match(auctioneerSource, /assignment\.status === "active" && !keeperAssignmentLocked\(assignment\)/);
});

test("an unchanged successful projector refresh clears stale connection state", () => {
  assert.match(boardSource, /else if \(snapshot\) \{\s*renderLiveStatus\(\);\s*\}/);
});

test("role-specific surfaces obey hidden state under the strict content-security policy", async () => {
  const shellSafetyCss = await readFile(shellSafetyCssUrl, "utf8");
  assert.match(shellSafetyCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;/);
  for (const htmlUrl of [auctioneerHtmlUrl, draftBoardHtmlUrl, boardHtmlUrl, new URL("../public/thunder-bowl/board/index.html", import.meta.url)]) {
    const html = await readFile(htmlUrl, "utf8");
    assert.doesNotMatch(html, /<style\b/i, `${htmlUrl.pathname} cannot rely on inline CSS blocked by the site CSP.`);
    assert.match(html, /shell-safety\.css/, `${htmlUrl.pathname} must load the external hidden-state safety rule.`);
  }
});

test("the project card offers separate private, auctioneer, and Draft Board entrances", async () => {
  const homeHtml = await readFile(homeHtmlUrl, "utf8");
  assert.match(homeHtml, /href="\/thunder-bowl\/">Pip's Access/);
  assert.match(homeHtml, /href="\/thunder-bowl\/auctioneer\/">Auctioneer Access/);
  assert.match(homeHtml, /href="\/thunder-bowl\/draft-board\/">Draft Board/);
});

test("offline shell caches both auctioneer and projector experiences", () => {
  assert.match(serviceWorker, /"\/thunder-bowl\/auctioneer\/"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/auctioneer\/auctioneer\.mjs(?:\?v=[^"]+)?"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/draft-board\/"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/draft-board\/draft-board\.mjs"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/guides\/index\.html"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/guides\/guides\.css"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/shared\/shell-safety\.css"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/board\.html"/);
  assert.match(serviceWorker, /"\/thunder-bowl\/board\/board\.mjs"/);
  assert.match(serviceWorker, /pathname\.startsWith\("\/thunder-bowl\/board"\)/);
  assert.match(serviceWorker, /pathname\.startsWith\("\/thunder-bowl\/auctioneer"\)/);
  assert.match(serviceWorker, /pathname\.startsWith\("\/thunder-bowl\/draft-board"\)/);
  assert.match(serviceWorker, /pathname\.startsWith\("\/thunder-bowl\/guides"\)/);
});

test("repository configuration contains placeholders rather than deployable access codes", () => {
  assert.match(environmentExample, /^THUNDER_BOWL_ACCESS_CODE=replace-with-private-code$/m);
  assert.match(environmentExample, /^THUNDER_BOWL_AUCTIONEER_ACCESS_CODE=replace-with-separate-six-digit-code$/m);
  assert.match(environmentExample, /^THUNDER_BOWL_DRAFT_BOARD_ACCESS_CODE=replace-with-separate-draft-board-code$/m);
  for (const line of environmentExample.split(/\r?\n/).filter((entry) => /ACCESS_CODE=/.test(entry))) {
    assert.match(line, /=replace-with-/);
  }
});
