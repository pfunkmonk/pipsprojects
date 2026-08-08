import { assertSameOrigin, configurationError, json, verifySession } from "./_lib/auth.mjs";
import { archiveAndResetLedger } from "./_lib/ledger-store.mjs";

const ARCHIVE_CONFIRMATION = "ARCHIVE AND START NEW";

export default async function handler(request) {
  try {
    if (!verifySession(request)) return json({ error: "Authentication required." }, 401);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    assertSameOrigin(request);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 16 * 1024) return json({ error: "Archive request is too large." }, 413);
    const body = await request.json().catch(() => null);
    const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).sort() : [];
    if (
      JSON.stringify(keys) !== JSON.stringify(["action", "confirmation", "generation", "reason"])
      || body.action !== "archive-reset"
      || body.confirmation !== ARCHIVE_CONFIRMATION
    ) {
      return json({ error: `Type ${ARCHIVE_CONFIRMATION} to confirm a new rehearsal.` }, 400);
    }
    const result = await archiveAndResetLedger(body.reason, body.generation);
    return json({
      schemaVersion: result.document.schemaVersion,
      generation: result.document.generation,
      events: result.document.events,
      revision: result.etag,
      updatedAt: result.document.updatedAt,
      archive: {
        id: result.archiveId,
        archivedAt: result.archivedAt,
        eventCount: result.eventCount,
      },
    });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    if (error?.code === "ORIGIN_REJECTED") return json({ error: error.message }, 403);
    if (error?.code === "INVALID_ARCHIVE_REQUEST") return json({ error: error.message, code: error.code }, 400);
    if (["LEDGER_CONFLICT", "LEDGER_ARCHIVE_CONFLICT", "LEDGER_GENERATION_MISMATCH"].includes(error?.code)) {
      return json({ error: error.message, code: error.code, generation: error.currentGeneration || null }, 409);
    }
    return json({ error: "The rehearsal was not reset. The active ledger remains available." }, 500);
  }
}
