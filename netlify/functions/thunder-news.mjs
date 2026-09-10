import { createHash } from "node:crypto";
import { configurationError, json, verifySession } from "./_lib/auth.mjs";
import { currentNewsSnapshot, savedNewsSnapshot } from "./_lib/news-store.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    if (!verifySession(request)) return json({ error: "Authentication required." }, 401);
    const params = new URL(request.url).searchParams;
    const storedOnly = params.get("stored") === "1";
    const snapshot = storedOnly ? await savedNewsSnapshot() : await currentNewsSnapshot({ force: params.get("force") === "1" });
    if (!snapshot) return json({ error: "No saved player-news history is available yet." }, 404);
    const text = JSON.stringify(snapshot);
    const etag = `"${createHash("sha256").update(text).digest("hex")}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { "Cache-Control": "no-store", ETag: etag } });
    }
    return new Response(text, {
      status: 200,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", ETag: etag },
    });
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    console.error(`Thunder Bowl player-news refresh failed: ${diagnostic}`);
    const configured = configurationError(error);
    if (configured) return configured;
    return json({ error: "Player-news refresh failed safely; the saved news snapshot remains active.", diagnostic }, 503);
  }
}
