import {
  createAuctioneerCookie,
  createDraftBoardCookie,
  verifyAuctioneerCode,
  verifyAuctioneerSession,
  verifyDraftBoardCode,
  verifyDraftBoardSession,
} from "./session.mjs";
import {
  hasExactKeys,
  isJsonRequest,
  requestBodyExceeds,
  secureResponseHeaders,
} from "../_lib/http-security.mjs";

const AUTH_BODY_LIMIT = 4 * 1024;
const COMMAND_BODY_LIMIT = 64 * 1024;

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: secureResponseHeaders({ "Content-Type": "application/json; charset=utf-8", ...headers }),
  });
}

function empty(status = 204, headers = {}) {
  return new Response(null, { status, headers: secureResponseHeaders(headers) });
}

function errorResponse(error) {
  const status = Number(error?.status) || (error?.code === "LEDGER_CONFLICT" ? 409 : 400);
  return json({ error: error?.message || "Auctioneer request failed.", code: error?.code || "AUCTIONEER_REQUEST_FAILED" }, status);
}

function corsSafe(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

function sanitizePublicSnapshot(snapshot, includeAvailablePlayers = true, includeAudit = true) {
  const clean = {
    season: snapshot.season,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    rosterSize: snapshot.rosterSize,
    minimumRosterSize: snapshot.minimumRosterSize,
    keeperSlots: snapshot.keeperSlots,
    keepersFinalized: snapshot.keepersFinalized === true,
    keeperFinalizedAt: snapshot.keeperFinalizedAt || null,
    starterRequirements: snapshot.starterRequirements ? { ...snapshot.starterRequirements } : undefined,
    currentNominatorTeamId: snapshot.currentNominatorTeamId ?? null,
    nextNominatorTeamId: snapshot.nextNominatorTeamId ?? null,
    finishedTeamIds: Array.isArray(snapshot.finishedTeamIds) ? [...snapshot.finishedTeamIds] : [],
    stagedNomination: snapshot.stagedNomination ? { id: snapshot.stagedNomination.id, name: snapshot.stagedNomination.name, position: snapshot.stagedNomination.position, nflTeam: snapshot.stagedNomination.nflTeam, byeWeek: snapshot.stagedNomination.byeWeek ?? null, updatedAt: snapshot.stagedNomination.updatedAt } : null,
    clock: snapshot.clock ? { status: snapshot.clock.status, durationMs: snapshot.clock.durationMs, remainingMs: snapshot.clock.remainingMs, deadline: snapshot.clock.deadline, serverNow: snapshot.clock.serverNow } : undefined,
    teams: (snapshot.teams || []).map((team) => ({
      id: team.id,
      name: team.name,
      startingCap: team.startingCap,
      capAdjustment: Number(team.capAdjustment) || 0,
      ...(Array.isArray(team.salaryLedger) ? { salaryLedger: team.salaryLedger.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        delta: entry.delta,
        balance: entry.balance,
      })) } : {}),
      ...(typeof team.logoUrl === "string" && team.logoUrl ? { logoUrl: team.logoUrl } : {}),
    })),
    assignments: (snapshot.assignments || []).map((assignment) => ({
      id: assignment.id, playerId: assignment.playerId, playerName: assignment.playerName,
      position: assignment.position, nflTeam: assignment.nflTeam, byeWeek: assignment.byeWeek ?? null, teamId: assignment.teamId,
      price: assignment.price, acquisitionType: assignment.acquisitionType,
      contractYear: assignment.contractYear, status: assignment.status,
      createdAt: assignment.createdAt, updatedAt: assignment.updatedAt, actorLabel: assignment.actorLabel,
    })),
  };
  if (includeAvailablePlayers) {
    clean.availablePlayers = (snapshot.availablePlayers || []).map((player) => ({ id: player.id, name: player.name, position: player.position, nflTeam: player.nflTeam, byeWeek: player.byeWeek ?? null }));
  }
  if (includeAudit) {
    clean.auditEvents = (snapshot.auditEvents || []).map((event) => ({ id: event.id, action: event.action, teamId: event.teamId || null, playerName: event.playerName || null, price: Number.isInteger(event.price) ? event.price : null, status: event.status || null, createdAt: event.createdAt, actorLabel: event.actorLabel || "Auctioneer" }));
  }
  return clean;
}

export function createHttpHandlers({ service, env = process.env, authorizeDisplay, displayBoardUrl }) {
  if (!service?.snapshot || !service?.command) throw new Error("Auctioneer ledger service is required.");

  function authorized(request) {
    return corsSafe(request) && verifyAuctioneerSession(request.headers.get("Cookie"), env.THUNDER_BOWL_SESSION_SECRET);
  }

  function boardViewerAuthorized(request) {
    return corsSafe(request) && verifyDraftBoardSession(request.headers.get("Cookie"), env.THUNDER_BOWL_SESSION_SECRET);
  }

  return {
    async auth(request) {
      if (request.method === "GET") {
        if (!authorized(request)) return json({ error: "Unauthorized" }, 401);
        const cookie = createAuctioneerCookie(env.THUNDER_BOWL_SESSION_SECRET, { path: "/", secure: new URL(request.url).protocol === "https:" });
        return json({ role: "auctioneer" }, 200, { "Set-Cookie": cookie });
      }
      if (request.method !== "POST" || !corsSafe(request)) return json({ error: "Method not allowed" }, 405);
      try {
        if (requestBodyExceeds(request, AUTH_BODY_LIMIT)) return json({ error: "Authentication request is too large." }, 413);
        if (!isJsonRequest(request)) return json({ error: "Authentication requires JSON." }, 415);
        const body = await request.json().catch(() => null);
        if (!hasExactKeys(body, ["code"]) || typeof body.code !== "string") return json({ error: "A single access code is required." }, 400);
        if (!verifyAuctioneerCode(body?.code, env.THUNDER_BOWL_AUCTIONEER_ACCESS_CODE)) return json({ error: "That access number is not correct." }, 401);
        const cookie = createAuctioneerCookie(env.THUNDER_BOWL_SESSION_SECRET, { path: "/", secure: new URL(request.url).protocol === "https:" });
        return empty(204, { "Set-Cookie": cookie });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async draftBoardAuth(request) {
      if (request.method === "GET") {
        if (!boardViewerAuthorized(request)) return json({ error: "Unauthorized" }, 401);
        const cookie = createDraftBoardCookie(env.THUNDER_BOWL_SESSION_SECRET, { path: "/", secure: new URL(request.url).protocol === "https:" });
        return json({ role: "draft-board" }, 200, { "Set-Cookie": cookie });
      }
      if (request.method !== "POST" || !corsSafe(request)) return json({ error: "Method not allowed" }, 405);
      try {
        if (requestBodyExceeds(request, AUTH_BODY_LIMIT)) return json({ error: "Authentication request is too large." }, 413);
        if (!isJsonRequest(request)) return json({ error: "Authentication requires JSON." }, 415);
        const body = await request.json().catch(() => null);
        if (!hasExactKeys(body, ["code"]) || typeof body.code !== "string") return json({ error: "A single access code is required." }, 400);
        if (!verifyDraftBoardCode(body?.code, env.THUNDER_BOWL_DRAFT_BOARD_ACCESS_CODE)) return json({ error: "That Draft Board code is not correct." }, 401);
        const cookie = createDraftBoardCookie(env.THUNDER_BOWL_SESSION_SECRET, { path: "/", secure: new URL(request.url).protocol === "https:" });
        return empty(204, { "Set-Cookie": cookie });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async auctioneerSnapshot(request) {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      if (!authorized(request)) return json({ error: "Unauthorized" }, 401);
      try {
        const snapshot = sanitizePublicSnapshot(await service.snapshot());
        if (displayBoardUrl) snapshot.displayBoardUrl = await displayBoardUrl(request);
        return json(snapshot);
      } catch (error) { return errorResponse(error); }
    },

    async commands(request) {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      if (!authorized(request)) return json({ error: "Unauthorized" }, 401);
      try {
        if (requestBodyExceeds(request, COMMAND_BODY_LIMIT)) return json({ error: "Auctioneer command is too large." }, 413);
        if (!isJsonRequest(request)) return json({ error: "Auctioneer commands require JSON." }, 415);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "A valid auctioneer command is required." }, 400);
        const snapshot = sanitizePublicSnapshot(await service.command(body));
        if (displayBoardUrl) snapshot.displayBoardUrl = await displayBoardUrl(request);
        return json(snapshot);
      } catch (error) { return errorResponse(error); }
    },

    async boardSnapshot(request) {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const displayAuthorized = authorized(request) || boardViewerAuthorized(request) || (authorizeDisplay ? await authorizeDisplay(request) : false);
      if (!displayAuthorized) return json({ error: "Unauthorized display link" }, 401);
      try {
        return json(sanitizePublicSnapshot(await service.snapshot(), false, false));
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
