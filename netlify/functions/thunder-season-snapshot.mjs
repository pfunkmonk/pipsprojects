import { configurationError, json, verifySession } from "./_lib/auth.mjs";
import { getOrCreateCurrentSeasonPlan } from "./_lib/season-service.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    if (!verifySession(request)) return json({ error: "Authentication required." }, 401);
    const plan = await getOrCreateCurrentSeasonPlan();
    return json(plan, 200, { "Cache-Control": "no-store", ETag: `"${plan.sourceFingerprint}"` });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    console.error(`Thunder Bowl season snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    return json({ error: "The in-season plan could not be loaded safely. The browser may still have the last-known-good private snapshot." }, 503);
  }
}
