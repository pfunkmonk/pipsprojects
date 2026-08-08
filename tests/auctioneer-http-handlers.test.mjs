import test from "node:test";
import assert from "node:assert/strict";
import { createHttpHandlers } from "../netlify/functions/_auctioneer/http-handlers.mjs";

const env = {
  THUNDER_BOWL_AUCTIONEER_ACCESS_CODE: "123456",
  THUNDER_BOWL_SESSION_SECRET: "a-secure-test-secret-with-more-than-32-characters",
};
const publicSnapshot = {
  season: 2026, revision: 1, updatedAt: "2026-08-07T18:00:00.000Z", rosterSize: 14, keeperSlots: 2,
  teams: [], assignments: [], availablePlayers: [{ id: "p", name: "Player", position: "QB", nflTeam: "DEN", vbd: 99, privateNote: "never return" }],
  finishedTeamIds: [], stagedNomination: { id: "p", name: "Player", position: "QB", nflTeam: "DEN", updatedAt: "2026-08-07T18:00:00.000Z", vbd: 99 },
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

  const board = await handlers.boardSnapshot(new Request("https://pipsprojects.com/api/thunder-bowl/board/snapshot", { headers: { Cookie: cookie } }));
  assert.equal(board.status, 200);
  const body = await board.json();
  assert.equal("availablePlayers" in body, false);
  assert.equal("privateStrategy" in body, false);
  assert.equal("auditEvents" in body, false);
  assert.equal(body.stagedNomination.vbd, undefined);
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
  assert.deepEqual(Object.keys(body.availablePlayers[0]), ["id", "name", "position", "nflTeam"]);
});

test("rejects an unauthenticated auctioneer snapshot", async () => {
  const handlers = createHttpHandlers({ env, service: { async snapshot() { return publicSnapshot; }, async command() { return publicSnapshot; } } });
  const response = await handlers.auctioneerSnapshot(new Request("https://pipsprojects.com/api/thunder-bowl/auctioneer/snapshot"));
  assert.equal(response.status, 401);
});
