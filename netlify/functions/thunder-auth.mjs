import {
  assertSameOrigin,
  clearSessionCookie,
  configurationError,
  createPersistentSession,
  displayBoardUrl,
  json,
  verifyAccessCode,
  verifySession,
} from "./_lib/auth.mjs";
import { hasExactKeys, isJsonRequest, requestBodyExceeds } from "./_lib/http-security.mjs";

export default async function handler(request) {
  try {
    if (request.method === "GET") {
      const session = verifySession(request);
      if (!session) return json({ authenticated: false }, 401);
      const renewed = createPersistentSession(request);
      return json(
        { authenticated: true, expiresAt: renewed.expiresAt, displayBoardUrl: displayBoardUrl(request) },
        200,
        { "Set-Cookie": renewed.cookie },
      );
    }

    if (request.method === "POST") {
      assertSameOrigin(request);
      if (requestBodyExceeds(request, 4096)) return json({ error: "Request is too large." }, 413);
      if (!isJsonRequest(request)) return json({ error: "Authentication requires JSON." }, 415);
      const body = await request.json().catch(() => null);
      if (!hasExactKeys(body, ["code"]) || typeof body.code !== "string") {
        return json({ error: "A single access code is required." }, 400);
      }
      if (!verifyAccessCode(body.code)) return json({ error: "Access denied." }, 401);
      const session = createPersistentSession(request);
      return json(
        { authenticated: true, expiresAt: session.expiresAt, displayBoardUrl: displayBoardUrl(request) },
        200,
        { "Set-Cookie": session.cookie },
      );
    }

    if (request.method === "DELETE") {
      assertSameOrigin(request);
      return json({ authenticated: false }, 200, { "Set-Cookie": clearSessionCookie(request) });
    }
    return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST, DELETE" });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    if (error?.code === "ORIGIN_REJECTED") return json({ error: error.message }, 403);
    return json({ error: "Access service failed safely." }, 500);
  }
}

export const config = {
  path: ["/api/thunder-bowl/auth", "/.netlify/functions/thunder-auth"],
  rateLimit: {
    windowLimit: 8,
    windowSize: 180,
    aggregateBy: ["ip", "domain"],
  },
};
