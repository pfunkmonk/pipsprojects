import test from "node:test";
import assert from "node:assert/strict";
import {
  displayBoardUrl,
  issueSession,
  sessionCookie,
  verifyAccessCode,
  verifyDisplayToken,
  verifySession,
} from "../netlify/functions/_lib/auth.mjs";
import packHandler from "../netlify/functions/thunder-pack.mjs";

process.env.THUNDER_BOWL_ACCESS_CODE = "test-access-code";
process.env.THUNDER_BOWL_SESSION_SECRET = "test-session-secret-that-is-long-enough-for-unit-tests";
process.env.THUNDER_BOWL_DISPLAY_TOKEN = "test-display-token";

test("access and display comparisons reject wrong values", () => {
  assert.equal(verifyAccessCode("test-access-code"), true);
  assert.equal(verifyAccessCode("test-access-codf"), false);
  assert.equal(verifyDisplayToken("test-display-token"), true);
  assert.equal(verifyDisplayToken("wrong-display-token"), false);
});

test("issued session round-trips through the HttpOnly cookie", () => {
  const loginRequest = new Request("https://pipsprojects.com/api/thunder-bowl/auth");
  const token = issueSession();
  const cookie = sessionCookie(loginRequest, token);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  const request = new Request("https://pipsprojects.com/api/thunder-bowl/ledger", {
    headers: { cookie: cookie.split(";")[0] },
  });
  assert.equal(verifySession(request)?.sub, "dogs-of-war");
});

test("tampered sessions fail closed", () => {
  const token = issueSession();
  const request = new Request("https://pipsprojects.com/api/thunder-bowl/ledger", {
    headers: { cookie: `tb26_session=${token.slice(0, -1)}x` },
  });
  assert.equal(verifySession(request), null);
});

test("display board link is same-origin and contains only the display token", () => {
  const request = new Request("https://pipsprojects.com/api/thunder-bowl/auth");
  const url = new URL(displayBoardUrl(request));
  assert.equal(url.origin, "https://pipsprojects.com");
  assert.equal(url.pathname, "/thunder-bowl/board");
  assert.equal(url.searchParams.get("token"), "test-display-token");
});

test("the private practice pack requires an authenticated session", async () => {
  const denied = await packHandler(new Request("https://pipsprojects.com/api/thunder-bowl/pack"));
  assert.equal(denied.status, 401);

  const loginRequest = new Request("https://pipsprojects.com/api/thunder-bowl/auth");
  const cookie = sessionCookie(loginRequest, issueSession()).split(";")[0];
  const allowed = await packHandler(new Request("https://pipsprojects.com/api/thunder-bowl/pack", { headers: { cookie } }));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "no-store");
  const etag = allowed.headers.get("etag");
  assert.match(etag, /^"[a-f0-9]{64}"$/);
  const pack = await allowed.json();
  assert.equal(pack.status, "practice");
  assert.ok(pack.players.length >= 650);
  assert.ok(pack.keeperCandidates.length >= 1);

  const unchanged = await packHandler(new Request("https://pipsprojects.com/api/thunder-bowl/pack", {
    headers: { cookie, "if-none-match": etag },
  }));
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get("etag"), etag);
});
