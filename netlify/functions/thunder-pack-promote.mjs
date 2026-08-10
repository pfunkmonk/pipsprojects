import { readFile } from "node:fs/promises";
import { assertSameOrigin, configurationError, json, verifySession } from "./_lib/auth.mjs";
import { promoteDraftPack } from "./_lib/pack-release-store.mjs";

const PACK_PATH = new URL("./_data/draft-pack-2026-provisional.json", import.meta.url);

export default async function handler(request) {
  try {
    if (!verifySession(request)) return json({ error: "Authentication required." }, 401);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    assertSameOrigin(request);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 4096) return json({ error: "Promotion request is too large." }, 413);
    const body = await request.json().catch(() => null);
    if (!body || Object.keys(body).sort().join("|") !== "action|packId" || body.action !== "promote-final" || typeof body.packId !== "string") {
      return json({ error: "A valid final-pack promotion request is required." }, 400);
    }
    const packText = await readFile(PACK_PATH, "utf8");
    const release = await promoteDraftPack({ packText, packId: body.packId });
    return json({ promoted: true, status: "production", ...release });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    if (error?.code === "ORIGIN_REJECTED") return json({ error: error.message }, 403);
    if (error?.code === "PACK_RELEASE_CONFLICT") return json({ error: error.message, code: error.code }, 409);
    if (error?.code === "PACK_RELEASE_BLOCKED") return json({ error: error.message, code: error.code }, 422);
    return json({ error: "The pack was not promoted. The current private pack remains unchanged." }, 500);
  }
}
