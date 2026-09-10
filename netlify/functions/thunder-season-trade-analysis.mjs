import { assertSameOrigin, configurationError, json, verifySession } from "./_lib/auth.mjs";
import { hasExactKeys, isJsonRequest, requestBodyExceeds } from "./_lib/http-security.mjs";
import { analyzeProposedSeasonTrade } from "./_lib/season-service.mjs";

const MAX_BODY_BYTES = 12_288;

async function requestJson(request) {
  if (!isJsonRequest(request)) {
    const error = new Error("Trade analysis requests must use JSON.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  if (requestBodyExceeds(request, MAX_BODY_BYTES)) {
    const error = new Error("Trade analysis request is too large.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    const error = new Error("Trade analysis request is too large.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Trade analysis request must be valid JSON.");
    error.code = "INVALID_INPUT";
    throw error;
  }
}

export default async function handler(request) {
  try {
    if (!verifySession(request)) return json({ error: "Authentication required." }, 401);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    assertSameOrigin(request);
    const input = await requestJson(request);
    if (!hasExactKeys(input, ["transfers"])) {
      const error = new Error("Trade analysis request contains unsupported fields.");
      error.code = "INVALID_INPUT";
      throw error;
    }
    return json(await analyzeProposedSeasonTrade(input.transfers), 200, { "Cache-Control": "no-store" });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    const diagnostic = error instanceof Error ? error.message : String(error);
    console.error(`Thunder Bowl proposed trade analysis failed: ${diagnostic}`);
    const clientError = error?.code === "INVALID_INPUT" || /Choose|proposal|package|roster|currently roster|would no longer/i.test(diagnostic);
    return json({ error: diagnostic }, clientError ? 400 : 503);
  }
}
