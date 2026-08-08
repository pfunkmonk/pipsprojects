import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { configurationError, json, verifySession } from "./_lib/auth.mjs";

const PACK_PATH = new URL("./_data/draft-pack-2025-replay.json", import.meta.url);
let cachedPack = null;

async function readPack() {
  if (!cachedPack) {
    const text = await readFile(PACK_PATH, "utf8");
    const parsed = JSON.parse(text);
    if (parsed.season !== 2025 || !String(parsed.packId || "").startsWith("tb25-replay-")) {
      throw new Error("The isolated replay pack failed its season boundary.");
    }
    cachedPack = {
      text,
      etag: `"${createHash("sha256").update(text).digest("hex")}"`,
    };
  }
  return cachedPack;
}

export default async function handler(request) {
  try {
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    if (!verifySession(request)) return json({ error: "Authentication required." }, 401);
    const pack = await readPack();
    if (request.headers.get("if-none-match") === pack.etag) {
      return new Response(null, { status: 304, headers: { "Cache-Control": "no-store", ETag: pack.etag } });
    }
    return new Response(pack.text, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        ETag: pack.etag,
      },
    });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    return json({ error: "The private 2025 replay pack could not be loaded safely." }, 500);
  }
}
