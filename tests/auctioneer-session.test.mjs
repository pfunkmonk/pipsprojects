import test from "node:test";
import assert from "node:assert/strict";
import { createAuctioneerCookie, verifyAuctioneerCode, verifyAuctioneerSession } from "../netlify/functions/_auctioneer/session.mjs";

const secret = "a-secure-test-secret-with-more-than-32-characters";

test("compares the separate auctioneer access code", () => {
  assert.equal(verifyAuctioneerCode("123456", "123456"), true);
  assert.equal(verifyAuctioneerCode("123450", "123456"), false);
  assert.equal(verifyAuctioneerCode("short", "short"), false);
});

test("creates and verifies an HTTP-only auctioneer session", () => {
  const cookie = createAuctioneerCookie(secret, { path: "/thunder-bowl" });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(verifyAuctioneerSession(cookie, secret), true);
  assert.equal(verifyAuctioneerSession(cookie, `${secret}-wrong`), false);
});
