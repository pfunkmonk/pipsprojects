import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { configurationError, json, verifySession } from "./_lib/auth.mjs";
import { currentStatusSnapshot } from "./_lib/status-store.mjs";

const PACK_PATH = new URL("./_data/draft-pack-2026-provisional.json", import.meta.url);
let cachedPack = null;

async function readPack() {
  if (!cachedPack) cachedPack = JSON.parse(await readFile(PACK_PATH, "utf8"));
  return cachedPack;
}

export default async function handler(request) {
  try {
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    if (!verifySession(request)) return json({ error: "Authentication required." }, 401);
    const force = new URL(request.url).searchParams.get("force") === "1";
    const snapshot = await currentStatusSnapshot(await readPack(), { force });
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
    console.error(`Thunder Bowl live-status refresh failed: ${diagnostic}`);
    const configured = configurationError(error);
    if (configured) return configured;
    return json({
      error: "Live status refresh failed safely; the saved status snapshot remains active.",
      diagnostic,
    }, 503);
  }
}
