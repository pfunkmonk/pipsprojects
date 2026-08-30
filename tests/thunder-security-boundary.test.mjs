import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createAuctioneerCookie, createDraftBoardCookie, verifyAuctioneerSession, verifyDraftBoardSession } from "../netlify/functions/_auctioneer/session.mjs";
import { issueSession, verifySession } from "../netlify/functions/_lib/auth.mjs";
import adminHandler from "../netlify/functions/thunder-admin.mjs";
import authHandler, { config as privateAuthConfig } from "../netlify/functions/thunder-auth.mjs";
import auctioneerAuthHandler, { config as auctioneerAuthConfig } from "../netlify/functions/thunder-bowl-auctioneer-auth.mjs";
import boardAuthHandler, { config as boardAuthConfig } from "../netlify/functions/thunder-bowl-draft-board-auth.mjs";
import ledgerHandler from "../netlify/functions/thunder-ledger.mjs";
import newsHandler from "../netlify/functions/thunder-news.mjs";
import packHandler from "../netlify/functions/thunder-pack.mjs";
import promoteHandler from "../netlify/functions/thunder-pack-promote.mjs";
import replayHandler from "../netlify/functions/thunder-replay-2025-pack.mjs";
import researchHandler from "../netlify/functions/thunder-research.mjs";
import statusHandler from "../netlify/functions/thunder-status.mjs";
import seasonRefreshHandler from "../netlify/functions/thunder-season-refresh.mjs";
import seasonSnapshotHandler from "../netlify/functions/thunder-season-snapshot.mjs";

const secret = "boundary-test-secret-that-is-longer-than-thirty-two-characters";
process.env.THUNDER_BOWL_ACCESS_CODE = "private-test-code";
process.env.THUNDER_BOWL_SESSION_SECRET = secret;
process.env.THUNDER_BOWL_DISPLAY_TOKEN = "boundary-display-token";
process.env.THUNDER_BOWL_AUCTIONEER_ACCESS_CODE = "auctioneer-test-code";
process.env.THUNDER_BOWL_DRAFT_BOARD_ACCESS_CODE = "board-test-code";

function cookiePair(setCookie) {
  return setCookie.split(";", 1)[0];
}

const roleCookies = {
  auctioneer: cookiePair(createAuctioneerCookie(secret)),
  board: cookiePair(createDraftBoardCookie(secret)),
};

const privateEndpoints = [
  ["auth", authHandler, "GET"],
  ["admin", adminHandler, "POST"],
  ["ledger", ledgerHandler, "GET"],
  ["news", newsHandler, "GET"],
  ["pack", packHandler, "GET"],
  ["pack promotion", promoteHandler, "POST"],
  ["2025 replay", replayHandler, "GET"],
  ["research", researchHandler, "GET"],
  ["status", statusHandler, "GET"],
  ["season refresh", seasonRefreshHandler, "POST"],
  ["season snapshot", seasonSnapshotHandler, "GET"],
];

test("Auctioneer and Draft Board role cookies cannot open any private analytics endpoint", async () => {
  for (const [role, cookie] of Object.entries(roleCookies)) {
    for (const [name, handler, method] of privateEndpoints) {
      const response = await handler(new Request(`https://pipsprojects.com/api/thunder-bowl/${name.replaceAll(" ", "-")}`, {
        method,
        headers: { Cookie: cookie, Origin: "https://pipsprojects.com", "Content-Type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      }));
      assert.equal(response.status, 401, `${role} unexpectedly reached private ${name}`);
    }
  }
});

test("renaming a signed role token cannot turn it into a private session", () => {
  for (const cookie of Object.values(roleCookies)) {
    const token = cookie.slice(cookie.indexOf("=") + 1);
    const request = new Request("https://pipsprojects.com/api/thunder-bowl/pack", { headers: { Cookie: `tb26_session=${token}` } });
    assert.equal(verifySession(request), null);
  }
});

test("renaming the private token cannot elevate it into either shared role", () => {
  const token = issueSession();
  assert.equal(verifyAuctioneerSession(`tb_auctioneer_session=${token}`, secret), false);
  assert.equal(verifyDraftBoardSession(`tb_draft_board_session=${token}`, secret), false);
});

test("all three authentication surfaces have per-IP rate limits on friendly and direct paths", () => {
  const expectations = [
    [privateAuthConfig, "/api/thunder-bowl/auth", "/.netlify/functions/thunder-auth", 8],
    [auctioneerAuthConfig, "/api/thunder-bowl/auctioneer/auth", "/.netlify/functions/thunder-bowl-auctioneer-auth", 15],
    [boardAuthConfig, "/api/thunder-bowl/draft-board/auth", "/.netlify/functions/thunder-bowl-draft-board-auth", 60],
  ];
  for (const [config, friendlyPath, directPath, limit] of expectations) {
    assert.deepEqual(config.path, [friendlyPath, directPath]);
    assert.equal(config.rateLimit.windowLimit, limit);
    assert.equal(config.rateLimit.windowSize, 180);
    assert.deepEqual(config.rateLimit.aggregateBy, ["ip", "domain"]);
  }
});

test("the endpoint inventory fails closed when a new Thunder Bowl function is added", async () => {
  const expected = [
    "thunder-admin.mjs",
    "thunder-auth.mjs",
    "thunder-bowl-auctioneer-auth.mjs",
    "thunder-bowl-auctioneer-commands.mjs",
    "thunder-bowl-auctioneer-snapshot.mjs",
    "thunder-bowl-board-snapshot.mjs",
    "thunder-bowl-draft-board-auth.mjs",
    "thunder-intelligence-collector.mjs",
    "thunder-ledger.mjs",
    "thunder-news.mjs",
    "thunder-pack-promote.mjs",
    "thunder-pack.mjs",
    "thunder-public.mjs",
    "thunder-replay-2025-pack.mjs",
    "thunder-research.mjs",
    "thunder-season-refresh.mjs",
    "thunder-season-snapshot.mjs",
    "thunder-season-tuesday-collector.mjs",
    "thunder-season-watch-collector.mjs",
    "thunder-status.mjs",
  ];
  const actual = (await readdir(new URL("../netlify/functions/", import.meta.url)))
    .filter((name) => /^thunder.*\.mjs$/.test(name))
    .sort();
  assert.deepEqual(actual, expected);

  const privateFiles = ["thunder-admin.mjs", "thunder-ledger.mjs", "thunder-news.mjs", "thunder-pack-promote.mjs", "thunder-pack.mjs", "thunder-replay-2025-pack.mjs", "thunder-research.mjs", "thunder-season-refresh.mjs", "thunder-season-snapshot.mjs", "thunder-status.mjs"];
  for (const name of privateFiles) {
    const source = await readFile(new URL(`../netlify/functions/${name}`, import.meta.url), "utf8");
    assert.match(source, /verifySession\(request\)/, `${name} must enforce the private session at the server boundary`);
  }
});

test("authentication failures carry explicit no-store and browser-isolation headers", async () => {
  const response = await authHandler(new Request("https://pipsprojects.com/api/thunder-bowl/auth"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("role handlers retain their own authentication entry points", async () => {
  const auctioneer = await auctioneerAuthHandler(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/auth"));
  const board = await boardAuthHandler(new Request("https://pipsprojects.com/api/thunder-bowl/draft-board/auth"));
  assert.equal(auctioneer.status, 401);
  assert.equal(board.status, 401);
});
