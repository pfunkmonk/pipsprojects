import { assertSameOrigin, configurationError, json, verifySession } from "./_lib/auth.mjs";
import { hasExactKeys, isJsonRequest, requestBodyExceeds } from "./_lib/http-security.mjs";
import { runCurrentSeasonSectionWithAiInBackground } from "./_lib/season-service.mjs";
import { validateAiSection } from "./_lib/season-ai-advice.mjs";

const MAX_BODY_BYTES = 512;

async function requestJson(request) {
  if (!isJsonRequest(request)) {
    const error = new Error("Background AI requests must use JSON.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  if (requestBodyExceeds(request, MAX_BODY_BYTES)) {
    const error = new Error("Background AI request is too large.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    const error = new Error("Background AI request is too large.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Background AI request must be valid JSON.");
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
    if (!hasExactKeys(input, ["jobId", "section"])) {
      const error = new Error("Background AI request contains unsupported fields.");
      error.code = "INVALID_INPUT";
      throw error;
    }
    const section = validateAiSection(input.section);
    if (!/^[a-f0-9-]{20,64}$/i.test(input.jobId || "")) {
      const error = new Error("Background AI job identity is invalid.");
      error.code = "INVALID_INPUT";
      throw error;
    }
    if (!["trade-finder", "stash-watch"].includes(section)) {
      const error = new Error("Only deep AI searches may use the background endpoint.");
      error.code = "INVALID_INPUT";
      throw error;
    }
    await runCurrentSeasonSectionWithAiInBackground(section, { jobId: input.jobId });
    return json({ accepted: true }, 202, { "Cache-Control": "no-store" });
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    const diagnostic = error instanceof Error ? error.message : String(error);
    console.error(`Thunder Bowl background AI advice failed: ${diagnostic}`);
    return json({ error: diagnostic }, error?.code === "INVALID_INPUT" ? 400 : 503);
  }
}

export const config = {
  background: true,
  rateLimit: { windowLimit: 8, windowSize: 180, aggregateBy: ["ip", "domain"] },
};
