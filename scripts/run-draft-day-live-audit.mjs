import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const baseArgument = process.argv.find((value) => value.startsWith("--base="));
const baseUrl = new URL(baseArgument?.slice("--base=".length) || "http://localhost:8888");
const production = process.argv.includes("--production");
if (baseUrl.hostname === "pipsprojects.com" && !production) throw new Error("Pass --production to create an isolated live QA league.");

const timings = [];
async function call(path, { method = "GET", body, cookie } = {}) {
  const started = performance.now();
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      Origin: baseUrl.origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  timings.push({ path, method, status: response.status, milliseconds: Number((performance.now() - started).toFixed(1)) });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
    cookies: response.headers.getSetCookie(),
  };
}

function sessionCookie(response) {
  assert.equal(response.cookies.length, 1, "A successful role sign-in must issue exactly one cookie.");
  return response.cookies[0].split(";", 1)[0];
}

async function command(cookie, leagueCode, snapshot, type, fields = {}) {
  return call("/api/draft-day/commands", {
    method: "POST",
    cookie,
    body: {
      type,
      leagueCode,
      expectedRevision: snapshot.revision,
      idempotencyKey: `live-audit-${randomUUID()}`,
      eventId: `live-audit-${randomUUID()}`,
      ...fields,
    },
  });
}

const suffix = randomBytes(3).toString("hex").toUpperCase();
const access = {
  adminCode: `ADMIN-${randomBytes(10).toString("base64url")}`,
  auctioneerCode: `AUCT-${randomBytes(10).toString("base64url")}`,
  boardCode: `BOARD-${randomBytes(10).toString("base64url")}`,
};
const config = {
  leagueName: `QA${suffix} Live Audit`,
  season: 2026,
  minimumBid: 1,
  bidIncrement: 1,
  rosterMinimum: 2,
  rosterMaximum: 3,
  keeperMaximum: null,
  nominationMode: "snake",
  positionRules: [
    { id: "QB", label: "Quarterback", minimum: 0, maximum: null },
    { id: "RB", label: "Running back", minimum: 0, maximum: null },
  ],
  teams: [
    { id: "qa-alpha", name: "QA Alpha", enteredPool: 20 },
    { id: "qa-beta", name: "QA Beta", enteredPool: 25 },
  ],
  keepersEnabled: true,
  keepers: [],
  nominationOrder: ["qa-alpha", "qa-beta"],
};
const players = {
  alphaKeeper: { id: "qa-josh-allen", name: "Josh Allen", position: "QB", nflTeam: "BUF" },
  betaKeeper: { id: "qa-bijan-robinson", name: "Bijan Robinson", position: "RB", nflTeam: "ATL" },
  alphaSale: { id: "qa-lamar-jackson", name: "Lamar Jackson", position: "QB", nflTeam: "BAL" },
  betaSale: { id: "qa-jahmyr-gibbs", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET" },
  conflictOne: { id: "qa-jalen-hurts", name: "Jalen Hurts", position: "QB", nflTeam: "PHI" },
  conflictTwo: { id: "qa-saquon-barkley", name: "Saquon Barkley", position: "RB", nflTeam: "PHI" },
};

const created = await call("/api/draft-day/leagues", { method: "POST", body: { config, access } });
assert.equal(created.status, 201, created.body.error);
const leagueCode = created.body.leagueCode;
const adminCookie = sessionCookie(created);

const auctionAuth = await call("/api/draft-day/auth", { method: "POST", body: { leagueCode, role: "auctioneer", code: access.auctioneerCode } });
assert.equal(auctionAuth.status, 200, auctionAuth.body.error);
const auctioneerCookie = sessionCookie(auctionAuth);
const boardAuth = await call("/api/draft-day/auth", { method: "POST", body: { leagueCode, role: "board", code: access.boardCode } });
assert.equal(boardAuth.status, 200, boardAuth.body.error);
const boardCookie = sessionCookie(boardAuth);

const wrongCode = await call("/api/draft-day/auth", { method: "POST", body: { leagueCode, role: "auctioneer", code: "DELIBERATELY-WRONG" } });
assert.equal(wrongCode.status, 401);

let snapshot = (await call(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(leagueCode)}`, { cookie: auctioneerCookie })).body;
assert.equal(snapshot.revision, 0);
const refreshed = await call(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(leagueCode)}`, { cookie: auctioneerCookie });
assert.equal(refreshed.status, 200, "The issued session must survive a separate refresh request.");

let result = await command(auctioneerCookie, leagueCode, snapshot, "record-keeper", { player: players.alphaKeeper, teamId: "qa-alpha", salary: 5, contractYear: 2, keeperRound: 4 });
assert.equal(result.status, 200, result.body.error); snapshot = result.body;
assert.equal(snapshot.teams.find((team) => team.id === "qa-alpha").remainingBudget, 15);

result = await command(auctioneerCookie, leagueCode, snapshot, "record-keeper", { player: players.betaKeeper, teamId: "qa-beta", salary: 3 });
assert.equal(result.status, 200, result.body.error); snapshot = result.body;
assert.equal(snapshot.teams.find((team) => team.id === "qa-beta").remainingBudget, 22);

result = await command(auctioneerCookie, leagueCode, snapshot, "lock-keepers");
assert.equal(result.status, 200, result.body.error); snapshot = result.body; assert.equal(snapshot.keepersLocked, true);
result = await command(auctioneerCookie, leagueCode, snapshot, "unlock-keepers");
assert.equal(result.status, 200, result.body.error); snapshot = result.body; assert.equal(snapshot.keepersLocked, false);

result = await command(auctioneerCookie, leagueCode, snapshot, "nominate-player", { player: players.alphaSale });
assert.equal(result.status, 200, result.body.error); snapshot = result.body;
const nominatedBoard = await call(`/api/draft-day/snapshot?role=board&league=${encodeURIComponent(leagueCode)}`, { cookie: boardCookie });
assert.equal(nominatedBoard.body.nominatedPlayer.name, players.alphaSale.name);
assert.equal(nominatedBoard.body.events, undefined);
assert.equal(nominatedBoard.body.customPlayers, undefined);
assert.equal(nominatedBoard.body.config.teams[0].enteredPool, undefined);

const alphaSaleKey = `live-audit-${randomUUID()}`;
const alphaSaleEvent = `live-audit-${randomUUID()}`;
result = await call("/api/draft-day/commands", { method: "POST", cookie: auctioneerCookie, body: { type: "record-sale", leagueCode, expectedRevision: snapshot.revision, idempotencyKey: alphaSaleKey, eventId: alphaSaleEvent, player: players.alphaSale, teamId: "qa-alpha", price: 4 } });
assert.equal(result.status, 200, result.body.error); snapshot = result.body;
assert.equal(snapshot.nominatedPlayer, null); assert.equal(snapshot.keepersLocked, true);
const idempotentRetry = await call("/api/draft-day/commands", { method: "POST", cookie: auctioneerCookie, body: { type: "record-sale", leagueCode, expectedRevision: snapshot.revision - 1, idempotencyKey: alphaSaleKey, eventId: alphaSaleEvent, player: players.alphaSale, teamId: "qa-alpha", price: 4 } });
assert.equal(idempotentRetry.status, 200); assert.equal(idempotentRetry.body.revision, snapshot.revision);

const duplicate = await command(auctioneerCookie, leagueCode, snapshot, "record-sale", { player: players.alphaSale, teamId: "qa-beta", price: 1 });
assert.equal(duplicate.status, 400); assert.match(duplicate.body.error, /already assigned/i);
const overspend = await command(auctioneerCookie, leagueCode, snapshot, "record-sale", { player: players.conflictOne, teamId: "qa-alpha", price: 100 });
assert.equal(overspend.status, 400); assert.match(overspend.body.error, /bid at most/i);

result = await command(auctioneerCookie, leagueCode, snapshot, "record-sale", { player: players.betaSale, teamId: "qa-beta", price: 5 });
assert.equal(result.status, 200, result.body.error); snapshot = result.body;
result = await command(auctioneerCookie, leagueCode, snapshot, "correct-sale", { targetId: alphaSaleEvent, player: players.alphaSale, teamId: "qa-alpha", price: 6 });
assert.equal(result.status, 200, result.body.error); snapshot = result.body;
assert.equal(snapshot.assignments.find((assignment) => assignment.id === alphaSaleEvent).price, 6);
result = await command(auctioneerCookie, leagueCode, snapshot, "void-sale", { targetId: alphaSaleEvent });
assert.equal(result.status, 200, result.body.error); snapshot = result.body;
assert.equal(snapshot.assignments.find((assignment) => assignment.id === alphaSaleEvent).status, "voided");
result = await command(auctioneerCookie, leagueCode, snapshot, "restore-sale", { targetId: alphaSaleEvent });
assert.equal(result.status, 200, result.body.error); snapshot = result.body;

result = await command(auctioneerCookie, leagueCode, snapshot, "finish-draft");
assert.equal(result.status, 200, result.body.error); snapshot = result.body; assert.equal(snapshot.draftStatus, "complete");
const closedNomination = await command(auctioneerCookie, leagueCode, snapshot, "nominate-player", { player: players.conflictOne });
assert.equal(closedNomination.status, 400); assert.match(closedNomination.body.error, /reopen/i);
result = await command(auctioneerCookie, leagueCode, snapshot, "reopen-draft");
assert.equal(result.status, 200, result.body.error); snapshot = result.body;

const setupAfterSale = await call("/api/draft-day/commands", { method: "POST", cookie: adminCookie, body: { type: "replace-setup", leagueCode, expectedRevision: snapshot.revision, idempotencyKey: `live-audit-${randomUUID()}`, config } });
assert.equal(setupAfterSale.status, 400); assert.match(setupAfterSale.body.error, /locked after the first auction sale/i);
const boardWrite = await command(boardCookie, leagueCode, snapshot, "nominate-player", { player: players.conflictOne });
assert.equal(boardWrite.status, 401);

const concurrentRevision = snapshot.revision;
const concurrent = await Promise.all([players.conflictOne, players.conflictTwo].map((player) => call("/api/draft-day/commands", {
  method: "POST",
  cookie: auctioneerCookie,
  body: { type: "nominate-player", leagueCode, expectedRevision: concurrentRevision, idempotencyKey: `live-audit-${randomUUID()}`, eventId: `live-audit-${randomUUID()}`, player },
})));
assert.deepEqual(concurrent.map((value) => value.status).sort((left, right) => left - right), [200, 409]);
assert.equal(concurrent.find((value) => value.status === 409).body.code, "REVISION_CONFLICT");

const logout = await call("/api/draft-day/auth", { method: "DELETE" });
assert.equal(logout.status, 200); assert.equal(logout.cookies.length, 3);
for (const cookie of logout.cookies) { assert.match(cookie, /Max-Age=0/); assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/); }

const summary = {
  passed: true,
  target: baseUrl.origin,
  leagueCode,
  finalRevision: Math.max(...concurrent.filter((value) => value.status === 200).map((value) => value.body.revision)),
  checks: 28,
  requests: timings.length,
  slowestRequestMs: Math.max(...timings.map((value) => value.milliseconds)),
  statusCounts: Object.fromEntries([...new Set(timings.map((value) => value.status))].sort().map((status) => [status, timings.filter((value) => value.status === status).length])),
};
console.log(JSON.stringify(summary, null, 2));
