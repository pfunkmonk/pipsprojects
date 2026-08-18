import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuctioneerCookie,
  createDraftBoardCookie,
  verifyAuctioneerCode,
  verifyAuctioneerSession,
  verifyDraftBoardCode,
  verifyDraftBoardSession,
} from "../netlify/functions/_auctioneer/session.mjs";
import { PERSISTENT_SESSION_SECONDS } from "../netlify/functions/_lib/session-policy.mjs";

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
  assert.match(cookie, new RegExp(`Max-Age=${PERSISTENT_SESSION_SECONDS}`));
  assert.equal(verifyAuctioneerSession(cookie, secret), true);
  assert.equal(verifyAuctioneerSession(cookie, `${secret}-wrong`), false);
});

test("creates a distinct read-only Draft Board session", () => {
  assert.equal(verifyDraftBoardCode("shared-code", "shared-code"), true);
  assert.equal(verifyDraftBoardCode("wrong-code", "shared-code"), false);
  const cookie = createDraftBoardCookie(secret, { path: "/thunder-bowl" });
  assert.match(cookie, /tb_draft_board_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(verifyDraftBoardSession(cookie, secret), true);
  assert.equal(verifyAuctioneerSession(cookie, secret), false);
});
