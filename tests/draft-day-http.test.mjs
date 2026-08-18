import test from "node:test";
import assert from "node:assert/strict";
import { createDraftDayHttpHandlers } from "../netlify/functions/_draft-day/http-handlers.mjs";
import { createRoleCookie } from "../netlify/functions/_draft-day/security.mjs";
import { PERSISTENT_SESSION_SECONDS } from "../netlify/functions/_lib/session-policy.mjs";

const secret = "draft-day-http-test-secret-that-is-over-32-characters";
const baseSnapshot = {
  leagueCode: "ABCD-EFGH",
  config: { leagueName: "HTTP League", season: 2026 },
};
const calls = [];
const service = {
  async createLeague() { return baseSnapshot; },
  async authenticate(body) { calls.push(["auth", body]); if (body.code !== "RIGHT-CODE") { const error = new Error("That access code is not correct."); error.status = 401; throw error; } return { leagueCode: "ABCD-EFGH", role: body.role }; },
  async snapshot(code, role) { calls.push(["snapshot", code, role]); return { ...baseSnapshot, role }; },
  async command(code, body, role) { calls.push(["command", code, body.type, role]); return { ...baseSnapshot, revision: 1 }; },
};
const handlers = createDraftDayHttpHandlers({ service, env: { DRAFT_DAY_SESSION_SECRET: secret } });

function request(path, options = {}) {
  return new Request(`https://pipsprojects.com${path}`, { headers: { Origin: "https://pipsprojects.com", ...(options.headers || {}) }, ...options });
}

test("league creation issues only an organizer cookie", async () => {
  const response = await handlers.leagues(request("/api/draft-day/leagues", { method: "POST", body: JSON.stringify({}) }));
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /^ddt_admin_session=/);
  assert.doesNotMatch(response.headers.get("set-cookie"), /auctioneer|board/);
});

test("role authentication issues a separate HTTP-only cookie", async () => {
  const response = await handlers.auth(request("/api/draft-day/auth", { method: "POST", body: JSON.stringify({ leagueCode: "ABCD-EFGH", role: "board", code: "RIGHT-CODE" }) }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /^ddt_board_session=/);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
  assert.match(response.headers.get("set-cookie"), new RegExp(`Max-Age=${PERSISTENT_SESSION_SECONDS}`));
});

test("an issued auctioneer session remains valid on a refresh snapshot request", async () => {
  const auth = await handlers.auth(request("/api/draft-day/auth", { method: "POST", body: JSON.stringify({ leagueCode: "ABCD-EFGH", role: "auctioneer", code: "RIGHT-CODE" }) }));
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const refreshed = await handlers.snapshot(request("/api/draft-day/snapshot?role=auctioneer&league=ABCD-EFGH", { headers: { Cookie: cookie } }));
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).role, "auctioneer");
  assert.match(refreshed.headers.get("set-cookie"), /^ddt_auctioneer_session=/);
  assert.match(refreshed.headers.get("set-cookie"), new RegExp(`Max-Age=${PERSISTENT_SESSION_SECONDS}`));
});

test("explicit logout expires every Draft Day role cookie", async () => {
  const response = await handlers.auth(request("/api/draft-day/auth", { method: "DELETE" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { signedOut: true });
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 3);
  for (const name of ["ddt_admin_session", "ddt_auctioneer_session", "ddt_board_session"]) {
    const cookie = cookies.find((value) => value.startsWith(`${name}=`));
    assert.ok(cookie, `${name} must be cleared`);
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
  }
});

test("board session receives board scope and cannot submit commands", async () => {
  const cookie = createRoleCookie({ role: "board", leagueCode: "ABCD-EFGH", secret });
  const header = cookie.split(";", 1)[0];
  const board = await handlers.snapshot(request("/api/draft-day/snapshot?role=board&league=ABCD-EFGH", { headers: { Cookie: header } }));
  assert.equal(board.status, 200);
  assert.equal((await board.json()).role, "board");
  const command = await handlers.commands(request("/api/draft-day/commands", { method: "POST", headers: { Cookie: header }, body: JSON.stringify({ leagueCode: "ABCD-EFGH", type: "record-sale" }) }));
  assert.equal(command.status, 401);
});

test("cross-origin requests fail closed", async () => {
  const response = await handlers.auth(new Request("https://pipsprojects.com/api/draft-day/auth", { method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 405);
});

