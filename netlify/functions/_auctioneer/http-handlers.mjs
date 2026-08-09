import {
  createAuctioneerCookie,
  createDraftBoardCookie,
  verifyAuctioneerCode,
  verifyAuctioneerSession,
  verifyDraftBoardCode,
  verifyDraftBoardSession,
} from "./session.mjs";

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
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
    starterRequirements: snapshot.starterRequirements ? { ...snapshot.starterRequirements } : undefined,
    currentNominatorTeamId: snapshot.currentNominatorTeamId ?? null,
    nextNominatorTeamId: snapshot.nextNominatorTeamId ?? null,
    finishedTeamIds: Array.isArray(snapshot.finishedTeamIds) ? [...snapshot.finishedTeamIds] : [],
    stagedNomination: snapshot.stagedNomination ? { id: snapshot.stagedNomination.id, name: snapshot.stagedNomination.name, position: snapshot.stagedNomination.position, nflTeam: snapshot.stagedNomination.nflTeam, updatedAt: snapshot.stagedNomination.updatedAt } : null,
    clock: snapshot.clock ? { status: snapshot.clock.status, durationMs: snapshot.clock.durationMs, remainingMs: snapshot.clock.remainingMs, deadline: snapshot.clock.deadline, serverNow: snapshot.clock.serverNow } : undefined,
    teams: (snapshot.teams || []).map((team) => ({ id: team.id, name: team.name, startingCap: team.startingCap, capAdjustment: Number(team.capAdjustment) || 0, ...(typeof team.logoUrl === "string" && team.logoUrl ? { logoUrl: team.logoUrl } : {}) })),
    assignments: (snapshot.assignments || []).map((assignment) => ({
      id: assignment.id, playerId: assignment.playerId, playerName: assignment.playerName,
      position: assignment.position, nflTeam: assignment.nflTeam, teamId: assignment.teamId,
      price: assignment.price, acquisitionType: assignment.acquisitionType,
      contractYear: assignment.contractYear, status: assignment.status,
      createdAt: assignment.createdAt, updatedAt: assignment.updatedAt, actorLabel: assignment.actorLabel,
    })),
  };
  if (includeAvailablePlayers) {
    clean.availablePlayers = (snapshot.availablePlayers || []).map((player) => ({ id: player.id, name: player.name, position: player.position, nflTeam: player.nflTeam }));
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
      if (request.method === "GET") return authorized(request) ? json({ role: "auctioneer" }) : json({ error: "Unauthorized" }, 401);
      if (request.method !== "POST" || !corsSafe(request)) return json({ error: "Method not allowed" }, 405);
      try {
        const body = await request.json();
        if (!verifyAuctioneerCode(body?.code, env.THUNDER_BOWL_AUCTIONEER_ACCESS_CODE)) return json({ error: "That access number is not correct." }, 401);
        const cookie = createAuctioneerCookie(env.THUNDER_BOWL_SESSION_SECRET, { path: "/", secure: new URL(request.url).protocol === "https:" });
        return new Response(null, { status: 204, headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async draftBoardAuth(request) {
      if (request.method === "GET") return boardViewerAuthorized(request) ? json({ role: "draft-board" }) : json({ error: "Unauthorized" }, 401);
      if (request.method !== "POST" || !corsSafe(request)) return json({ error: "Method not allowed" }, 405);
      try {
        const body = await request.json();
        if (!verifyDraftBoardCode(body?.code, env.THUNDER_BOWL_DRAFT_BOARD_ACCESS_CODE)) return json({ error: "That Draft Board code is not correct." }, 401);
        const cookie = createDraftBoardCookie(env.THUNDER_BOWL_SESSION_SECRET, { path: "/", secure: new URL(request.url).protocol === "https:" });
        return new Response(null, { status: 204, headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
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
        const snapshot = sanitizePublicSnapshot(await service.command(await request.json()));
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
