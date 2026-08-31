import { assertSameOrigin, configurationError, json, verifySession } from "./_lib/auth.mjs";
import { importCbsLeagueSnapshot, importFbgWeeklyCsv, refreshSeasonPlan, updateSeasonEverything } from "./_lib/season-service.mjs";

const MAX_BODY_BYTES = 2_100_000;

function exactKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Refresh payload must be an object.");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Refresh payload contains unsupported field '${key}'.`);
}

async function body(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error("Refresh payload exceeds 2 MB.");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new Error("Refresh payload exceeds 2 MB.");
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Refresh payload must be valid JSON.");
    error.code = "INVALID_INPUT";
    throw error;
  }
}

export default async function handler(request) {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    if (!verifySession(request)) return json({ error: "Authentication required." }, 401);
    assertSameOrigin(request);
    const input = await body(request);
    if (input.action === "refresh-public") {
      exactKeys(input, ["action"]);
      return json(await refreshSeasonPlan({ forcePublic: true, refreshFootballguys: true }));
    }
    if (input.action === "update-everything") {
      exactKeys(input, ["action", "snapshot"]);
      return json(await updateSeasonEverything(input.snapshot));
    }
    if (input.action === "sync-cbs") {
      exactKeys(input, ["action", "snapshot"]);
      return json(await importCbsLeagueSnapshot(input.snapshot));
    }
    if (input.action === "sync-fbg") {
      exactKeys(input, ["action", "csv"]);
      if (typeof input.csv !== "string") throw new Error("Footballguys import must be CSV text.");
      return json(await importFbgWeeklyCsv(input.csv));
    }
    return json({ error: "Refresh action is invalid." }, 400);
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    const diagnostic = error instanceof Error ? error.message : String(error);
    console.error(`Thunder Bowl season refresh failed: ${diagnostic}`);
    return json({ error: diagnostic }, error?.code === "INVALID_INPUT" || /invalid|must|missing|unsupported|exceed|import|snapshot|week/i.test(diagnostic) ? 400 : 503);
  }
}
