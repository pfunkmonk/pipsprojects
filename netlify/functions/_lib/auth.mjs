import { createHmac, timingSafeEqual } from "node:crypto";
import { secureResponseHeaders } from "./http-security.mjs";
import { PERSISTENT_SESSION_SECONDS } from "./session-policy.mjs";

const COOKIE_NAME = "tb26_session";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) {
    const padded = Buffer.alloc(Math.max(leftBuffer.length, rightBuffer.length, 1));
    timingSafeEqual(padded, padded);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`Server configuration '${name}' is missing.`);
    error.code = "SERVER_NOT_CONFIGURED";
    throw error;
  }
  return value;
}

function sessionSecret() {
  const value = requiredEnvironment("THUNDER_BOWL_SESSION_SECRET");
  if (value.length < 32) {
    const error = new Error("THUNDER_BOWL_SESSION_SECRET must contain at least 32 characters.");
    error.code = "SERVER_NOT_CONFIGURED";
    throw error;
  }
  return value;
}

function signPayload(encodedPayload) {
  return createHmac("sha256", sessionSecret()).update(encodedPayload).digest("base64url");
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const cookies = {};
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function verifyAccessCode(code) {
  return safeEqual(code, requiredEnvironment("THUNDER_BOWL_ACCESS_CODE"));
}

export function issueSession(now = Math.floor(Date.now() / 1000)) {
  const payload = base64url(JSON.stringify({ sub: "dogs-of-war", aud: "thunder-bowl-2026", iat: now, exp: now + PERSISTENT_SESSION_SECONDS }));
  return `${payload}.${signPayload(payload)}`;
}

export function createPersistentSession(request) {
  const now = Math.floor(Date.now() / 1000);
  const token = issueSession(now);
  return {
    expiresAt: new Date((now + PERSISTENT_SESSION_SECONDS) * 1000).toISOString(),
    cookie: sessionCookie(request, token),
  };
}

export function verifySession(request) {
  try {
    const token = parseCookies(request)[COOKIE_NAME];
    if (!token) return null;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra || !safeEqual(signature, signPayload(payload))) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (decoded.aud !== "thunder-bowl-2026" || decoded.sub !== "dogs-of-war" || !Number.isInteger(decoded.exp) || decoded.exp <= now) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function sessionCookie(request, token) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${PERSISTENT_SESSION_SECONDS}${secure}; Priority=High`;
}

export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}; Priority=High`;
}

export function verifyDisplayToken(token) {
  return safeEqual(token, requiredEnvironment("THUNDER_BOWL_DISPLAY_TOKEN"));
}

export function displayBoardUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/thunder-bowl/board?token=${encodeURIComponent(requiredEnvironment("THUNDER_BOWL_DISPLAY_TOKEN"))}`;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin !== new URL(request.url).origin) {
    const error = new Error("Cross-origin write rejected.");
    error.code = "ORIGIN_REJECTED";
    throw error;
  }
}

export function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: secureResponseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    }),
  });
}

export function configurationError(error) {
  if (error?.code !== "SERVER_NOT_CONFIGURED") return null;
  return json({ error: "Thunder Bowl server secrets have not been configured." }, 503);
}
