import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { configurationError, json, verifySession } from "./_lib/auth.mjs";
import { readDraftPackRelease, releasedPackText } from "./_lib/pack-release-store.mjs";

const PACK_PATH = new URL("./_data/draft-pack-2026-provisional.json", import.meta.url);
let cachedPack = null;

async function readPack() {
  if (!cachedPack) {
    const text = await readFile(PACK_PATH, "utf8");
    JSON.parse(text);
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
    const responseText = releasedPackText(pack.text, await readDraftPackRelease());
    const responseEtag = `"${createHash("sha256").update(responseText).digest("hex")}"`;
    if (request.headers.get("if-none-match") === responseEtag) {
      return new Response(null, { status: 304, headers: { "Cache-Control": "no-store", ETag: responseEtag } });
    }
    return new Response(responseText, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        ETag: responseEtag,
      },
    });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    return json({ error: "The private draft pack could not be loaded safely." }, 500);
  }
}
