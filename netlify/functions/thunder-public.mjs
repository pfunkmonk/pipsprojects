import { configurationError, json, verifyDisplayToken } from "./_lib/auth.mjs";
import { publicSnapshot, readLedger } from "./_lib/ledger-store.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    const token = new URL(request.url).searchParams.get("token") || "";
    if (!verifyDisplayToken(token)) return json({ error: "Display token required." }, 403);
    const requestedEtag = request.headers.get("if-none-match") || undefined;
    const current = await readLedger({ etag: requestedEtag });
    if (current.notModified) {
      return new Response(null, {
        status: 304,
        headers: { "Cache-Control": "no-store", ETag: current.etag },
      });
    }
    return json(publicSnapshot(current.document, current.etag), 200, { ETag: current.etag });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    return json({ error: "Public board is temporarily unavailable." }, 500);
  }
}
