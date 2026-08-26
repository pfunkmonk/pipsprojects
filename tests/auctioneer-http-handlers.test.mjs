import test from "node:test";
import assert from "node:assert/strict";
import { createHttpHandlers } from "../netlify/functions/_auctioneer/http-handlers.mjs";
import { PERSISTENT_SESSION_SECONDS } from "../netlify/functions/_lib/session-policy.mjs";

const env = {
  THUNDER_BOWL_AUCTIONEER_ACCESS_CODE: "123456",
  THUNDER_BOWL_DRAFT_BOARD_ACCESS_CODE: "shared-code",
  THUNDER_BOWL_SESSION_SECRET: "a-secure-test-secret-with-more-than-32-characters",
};
const publicSnapshot = {
  season: 2026, revision: 1, updatedAt: "2026-08-07T18:00:00.000Z", rosterSize: 14, keeperSlots: 2,
  teams: [], assignments: [], availablePlayers: [{ id: "p", name: "Player", position: "QB", nflTeam: "DEN", byeWeek: 10, vbd: 99, privateNote: "never return" }],
  finishedTeamIds: [], stagedNomination: { id: "p", name: "Player", position: "QB", nflTeam: "DEN", byeWeek: 10, updatedAt: "2026-08-07T18:00:00.000Z", vbd: 99 },
  auditEvents: [{ id: "audit-1", action: "Nominated", playerName: "Player", createdAt: "2026-08-07T18:00:00.000Z", actorLabel: "Auctioneer", privateNote: "never return" }],
  privateStrategy: { targets: ["p"] },
};

test("authenticates the auctioneer and permits public-only board access", async () => {
  const handlers = createHttpHandlers({
    env,
    service: { async snapshot() { return structuredClone(publicSnapshot); }, async command() { return structuredClone(publicSnapshot); } },
    async authorizeDisplay() { return false; },
  });
  const auth = await handlers.auth(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/auth", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://pipsprojects.com" }, body: JSON.stringify({ code: "123456" }),
  }));
  assert.equal(auth.status, 204);
  const cookie = auth.headers.get("set-cookie");
  assert.match(cookie, /tb_auctioneer_session=/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Priority=High/);

  const refreshed = await handlers.auth(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/auth", { headers: { Cookie: cookie } }));
  assert.equal(refreshed.status, 200);
  assert.match(refreshed.headers.get("set-cookie"), new RegExp(`Max-Age=${PERSISTENT_SESSION_SECONDS}`));

  const board = await handlers.boardSnapshot(new Request("https://pipsprojects.com/api/thunder-bowl/board/snapshot", { headers: { Cookie: cookie } }));
  assert.equal(board.status, 200);
  const body = await board.json();
  assert.equal("availablePlayers" in body, false);
  assert.equal("privateStrategy" in body, false);
  assert.equal("auditEvents" in body, false);
  assert.equal(body.stagedNomination.vbd, undefined);
  assert.equal(body.stagedNomination.byeWeek, 10);
});

test("the HTTP boundary strips private fields even if an internal service regresses", async () => {
  const handlers = createHttpHandlers({
    env,
    service: { async snapshot() { return structuredClone(publicSnapshot); }, async command() { return structuredClone(publicSnapshot); } },
  });
  const auth = await handlers.auth(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/auth", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://pipsprojects.com" }, body: JSON.stringify({ code: "123456" }),
  }));
  const cookie = auth.headers.get("set-cookie");
  const response = await handlers.auctioneerSnapshot(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/snapshot", { headers: { Cookie: cookie } }));
  const body = await response.json();
  assert.equal(body.availablePlayers[0].vbd, undefined);
  assert.equal(body.availablePlayers[0].privateNote, undefined);
  assert.equal(body.privateStrategy, undefined);
  assert.equal(body.auditEvents[0].privateNote, undefined);
  assert.deepEqual(Object.keys(body.availablePlayers[0]), ["id", "name", "position", "nflTeam", "byeWeek"]);
  assert.equal(body.availablePlayers[0].byeWeek, 10);
});

test("rejects an unauthenticated auctioneer snapshot", async () => {
  const handlers = createHttpHandlers({ env, service: { async snapshot() { return publicSnapshot; }, async command() { return publicSnapshot; } } });
  const response = await handlers.auctioneerSnapshot(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/snapshot"));
  assert.equal(response.status, 401);
});

test("Draft Board sign-in grants only the sanitized live board", async () => {
  let commandCalls = 0;
  const handlers = createHttpHandlers({
    env,
    service: {
      async snapshot() { return structuredClone(publicSnapshot); },
      async command() { commandCalls += 1; return structuredClone(publicSnapshot); },
    },
    async authorizeDisplay() { return false; },
  });
  const auth = await handlers.draftBoardAuth(new Request("https://pipsprojects.com/api/thunder-bowl/draft-board/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://pipsprojects.com" },
    body: JSON.stringify({ code: "shared-code" }),
  }));
  assert.equal(auth.status, 204);
  const cookie = auth.headers.get("set-cookie");
  assert.match(cookie, /tb_draft_board_session=/);

  const refreshed = await handlers.draftBoardAuth(new Request("https://pipsprojects.com/api/thunder-bowl/draft-board/auth", { headers: { Cookie: cookie } }));
  assert.equal(refreshed.status, 200);
  assert.match(refreshed.headers.get("set-cookie"), new RegExp(`Max-Age=${PERSISTENT_SESSION_SECONDS}`));

  const board = await handlers.boardSnapshot(new Request("https://pipsprojects.com/api/thunder-bowl/board/snapshot", { headers: { Cookie: cookie } }));
  assert.equal(board.status, 200);
  const boardBody = await board.json();
  assert.equal("availablePlayers" in boardBody, false);
  assert.equal("auditEvents" in boardBody, false);
  assert.equal("privateStrategy" in boardBody, false);

  const auctioneer = await handlers.auctioneerSnapshot(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/snapshot", { headers: { Cookie: cookie } }));
  assert.equal(auctioneer.status, 401);
  const command = await handlers.commands(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/commands", {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ type: "record-sale" }),
  }));
  assert.equal(command.status, 401);
  assert.equal(commandCalls, 0);
});

test("Draft Board sign-in rejects an incorrect code", async () => {
  const handlers = createHttpHandlers({ env, service: { async snapshot() { return publicSnapshot; }, async command() { return publicSnapshot; } } });
  const response = await handlers.draftBoardAuth(new Request("https://pipsprojects.com/api/thunder-bowl/draft-board/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://pipsprojects.com" },
    body: JSON.stringify({ code: "not-it" }),
  }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("role authentication and commands reject ambiguous or oversized request bodies", async () => {
  let commandCalls = 0;
  const handlers = createHttpHandlers({
    env,
    service: {
      async snapshot() { return structuredClone(publicSnapshot); },
      async command() { commandCalls += 1; return structuredClone(publicSnapshot); },
    },
  });
  const wrongType = await handlers.auth(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/auth", {
    method: "POST", headers: { Origin: "https://pipsprojects.com", "Content-Type": "text/plain" }, body: "123456",
  }));
  assert.equal(wrongType.status, 415);

  const extraField = await handlers.draftBoardAuth(new Request("https://pipsprojects.com/api/thunder-bowl/draft-board/auth", {
    method: "POST", headers: { Origin: "https://pipsprojects.com", "Content-Type": "application/json" }, body: JSON.stringify({ code: "shared-code", role: "auctioneer" }),
  }));
  assert.equal(extraField.status, 400);
  assert.equal(extraField.headers.get("set-cookie"), null);

  const auth = await handlers.auth(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/auth", {
    method: "POST", headers: { Origin: "https://pipsprojects.com", "Content-Type": "application/json" }, body: JSON.stringify({ code: "123456" }),
  }));
  const oversized = await handlers.commands(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/commands", {
    method: "POST",
    headers: { Cookie: auth.headers.get("set-cookie"), Origin: "https://pipsprojects.com", "Content-Type": "application/json", "Content-Length": String(64 * 1024 + 1) },
    body: JSON.stringify({ type: "record-sale" }),
  }));
  assert.equal(oversized.status, 413);
  assert.equal(commandCalls, 0);
});
