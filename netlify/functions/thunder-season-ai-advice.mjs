import { assertSameOrigin, configurationError, json, verifySession } from "./_lib/auth.mjs";
import { hasExactKeys, isJsonRequest, requestBodyExceeds } from "./_lib/http-security.mjs";
import { analyzeCurrentSeasonSectionWithAi, getSavedSeasonAiAdvice } from "./_lib/season-service.mjs";
import { validateAiSection } from "./_lib/season-ai-advice.mjs";

const MAX_BODY_BYTES = 512;

async function requestJson(request) {
  if (!isJsonRequest(request)) {
    const error = new Error("AI advice requests must use JSON.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  if (requestBodyExceeds(request, MAX_BODY_BYTES)) {
    const error = new Error("AI advice request is too large.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    const error = new Error("AI advice request is too large.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("AI advice request must be valid JSON.");
    error.code = "INVALID_INPUT";
    throw error;
  }
}

export default async function handler(request) {
  try {
    if (!verifySession(request)) return json({ error: "Authentication required." }, 401);
    if (request.method === "GET") return json(await getSavedSeasonAiAdvice(), 200, { "Cache-Control": "no-store" });
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
    assertSameOrigin(request);
    const input = await requestJson(request);
    if (!hasExactKeys(input, ["section"])) {
      const error = new Error("AI advice request contains unsupported fields.");
      error.code = "INVALID_INPUT";
      throw error;
    }
    return json(await analyzeCurrentSeasonSectionWithAi(validateAiSection(input.section)), 200, { "Cache-Control": "no-store" });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    const diagnostic = error instanceof Error ? error.message : String(error);
    console.error(`Thunder Bowl AI advice failed: ${diagnostic}`);
    const clientError = error?.code === "INVALID_INPUT";
    return json({ error: diagnostic }, clientError ? 400 : 503);
  }
}
