import {
  assertSameOrigin,
  clearSessionCookie,
  configurationError,
  displayBoardUrl,
  issueSession,
  json,
  sessionCookie,
  verifyAccessCode,
  verifySession,
} from "./_lib/auth.mjs";

export default async function handler(request) {
  try {
    if (request.method === "GET") {
      const session = verifySession(request);
      return session
        ? json({ authenticated: true, expiresAt: new Date(session.exp * 1000).toISOString(), displayBoardUrl: displayBoardUrl(request) })
        : json({ authenticated: false }, 401);
    }

    if (request.method === "POST") {
      assertSameOrigin(request);
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > 4096) return json({ error: "Request is too large." }, 413);
      const body = await request.json().catch(() => null);
      if (!body || typeof body.code !== "string" || Object.keys(body).length !== 1) {
        return json({ error: "A single access code is required." }, 400);
      }
      if (!verifyAccessCode(body.code)) return json({ error: "Access denied." }, 401);
      const token = issueSession();
      return json(
        { authenticated: true, displayBoardUrl: displayBoardUrl(request) },
        200,
        { "Set-Cookie": sessionCookie(request, token) },
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
