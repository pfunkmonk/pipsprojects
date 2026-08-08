import { assertSameOrigin, configurationError, displayBoardUrl, json, verifySession } from "./_lib/auth.mjs";
import { appendLedgerEvents, readLedger } from "./_lib/ledger-store.mjs";

export default async function handler(request) {
  try {
    if (!verifySession(request)) return json({ error: "Authentication required." }, 401);
    if (request.method === "GET") {
      const current = await readLedger();
      return json({
        schemaVersion: current.document.schemaVersion,
        generation: current.document.generation,
        events: current.document.events,
        revision: current.etag,
        updatedAt: current.document.updatedAt,
        displayBoardUrl: displayBoardUrl(request),
      });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
    assertSameOrigin(request);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 1024 * 1024) return json({ error: "Sync payload exceeds 1 MB." }, 413);
    const body = await request.json().catch(() => null);
    const bodyKeys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).sort() : [];
    const legacyShape = JSON.stringify(bodyKeys) === JSON.stringify(["events"]);
    const currentShape = JSON.stringify(bodyKeys) === JSON.stringify(["events", "generation"]);
    if (!body || !Array.isArray(body.events) || (!legacyShape && !currentShape)) {
      return json({ error: "Sync payload must contain only events and its ledger generation." }, 400);
    }
    const result = await appendLedgerEvents(body.events, body.generation);
    return json({
      schemaVersion: result.document.schemaVersion,
      generation: result.document.generation,
      events: result.document.events,
      revision: result.etag,
      updatedAt: result.document.updatedAt,
      changed: result.changed,
      displayBoardUrl: displayBoardUrl(request),
    });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    if (error?.name === "RuleViolation" || ["INVALID_SYNC_PAYLOAD", "INVALID_LEDGER_GENERATION"].includes(error?.code)) {
      return json({ error: error.message, code: error.code }, 400);
    }
    if (error?.code === "ORIGIN_REJECTED") return json({ error: error.message }, 403);
    if (["LEDGER_CONFLICT", "LEDGER_GENERATION_MISMATCH"].includes(error?.code)) {
      return json({ error: error.message, code: error.code, generation: error.currentGeneration || null }, 409);
    }
    return json({ error: "Ledger sync failed safely. Local events were not discarded." }, 500);
  }
}
