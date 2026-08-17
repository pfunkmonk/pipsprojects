import { normalizeLeagueCode } from "../../../public/draft-day/core.mjs";
import { createRoleCookie, verifyRoleCookie } from "./security.mjs";

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function errorResponse(error) {
  const status = Number(error?.status) || (error?.code === "REVISION_CONFLICT" ? 409 : 400);
  return json({ error: error?.message || "Draft Day request failed.", code: error?.code || "DRAFT_DAY_REQUEST_FAILED" }, status);
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

function requestedLeague(request, body = null) {
  return normalizeLeagueCode(body?.leagueCode || new URL(request.url).searchParams.get("league"));
}

export function createDraftDayHttpHandlers({ service, env = process.env }) {
  if (!service?.createLeague || !service?.authenticate || !service?.snapshot || !service?.command) throw new Error("Draft Day service is required.");

  function authorized(request, role, leagueCode) {
    return sameOrigin(request) && verifyRoleCookie(request.headers.get("Cookie"), {
      role,
      leagueCode,
      secret: env.DRAFT_DAY_SESSION_SECRET,
    });
  }

  return {
    async leagues(request) {
      if (request.method !== "POST" || !sameOrigin(request)) return json({ error: "Method not allowed" }, 405);
      try {
        const body = await request.json();
        const snapshot = await service.createLeague(body);
        const cookie = createRoleCookie({ role: "admin", leagueCode: snapshot.leagueCode, secret: env.DRAFT_DAY_SESSION_SECRET, secure: new URL(request.url).protocol === "https:" });
        return json(snapshot, 201, { "Set-Cookie": cookie });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async auth(request) {
      if (request.method !== "POST" || !sameOrigin(request)) return json({ error: "Method not allowed" }, 405);
      try {
        const body = await request.json();
        const session = await service.authenticate(body);
        const cookie = createRoleCookie({ role: session.role, leagueCode: session.leagueCode, secret: env.DRAFT_DAY_SESSION_SECRET, secure: new URL(request.url).protocol === "https:" });
        return json(session, 200, { "Set-Cookie": cookie });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async snapshot(request) {
      if (request.method !== "GET" || !sameOrigin(request)) return json({ error: "Method not allowed" }, 405);
      try {
        const leagueCode = requestedLeague(request);
        const role = new URL(request.url).searchParams.get("role") === "board" ? "board" : "auctioneer";
        const permitted = role === "board"
          ? authorized(request, "board", leagueCode) || authorized(request, "auctioneer", leagueCode) || authorized(request, "admin", leagueCode)
          : authorized(request, "auctioneer", leagueCode) || authorized(request, "admin", leagueCode);
        if (!permitted) return json({ error: "Sign in to this league first." }, 401);
        return json(await service.snapshot(leagueCode, role));
      } catch (error) {
        return errorResponse(error);
      }
    },

    async commands(request) {
      if (request.method !== "POST" || !sameOrigin(request)) return json({ error: "Method not allowed" }, 405);
      try {
        const body = await request.json();
        const leagueCode = requestedLeague(request, body);
        const role = authorized(request, "admin", leagueCode) ? "admin" : authorized(request, "auctioneer", leagueCode) ? "auctioneer" : null;
        if (!role) return json({ error: "Auctioneer or organizer access is required." }, 401);
        return json(await service.command(leagueCode, body, role));
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
