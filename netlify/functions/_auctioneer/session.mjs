import { Buffer } from "node:buffer";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const AUCTIONEER_COOKIE = "tb_auctioneer_session";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function secureEqual(left, right) {
  const leftDigest = createHmac("sha256", "tb-code-compare").update(String(left)).digest();
  const rightDigest = createHmac("sha256", "tb-code-compare").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function verifyAuctioneerCode(input, expected) {
  return typeof expected === "string" && expected.length >= 6 && secureEqual(input, expected);
}

export function createAuctioneerCookie(secret, options = {}) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("THUNDER_BOWL_SESSION_SECRET must contain at least 32 characters.");
  const maxAgeSeconds = Number(options.maxAgeSeconds) || 12 * 60 * 60;
  const payload = base64url(JSON.stringify({ role: "auctioneer", exp: Date.now() + maxAgeSeconds * 1000, nonce: randomUUID() }));
  const token = `${payload}.${signature(payload, secret)}`;
  const path = options.path || "/";
  const secure = options.secure === false ? "" : "; Secure";
  return `${AUCTIONEER_COOKIE}=${token}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly${secure}; SameSite=Strict`;
}

function cookieValue(cookieHeader, name) {
  for (const part of String(cookieHeader || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export function verifyAuctioneerSession(cookieHeader, secret) {
  if (typeof secret !== "string" || secret.length < 32) return false;
  const token = cookieValue(cookieHeader, AUCTIONEER_COOKIE);
  if (!token) return false;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return false;
  const expectedSignature = signature(payload, secret);
  const left = Buffer.from(suppliedSignature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const session = JSON.parse(decodeBase64url(payload));
    return session.role === "auctioneer" && Number.isFinite(session.exp) && session.exp > Date.now();
  } catch {
    return false;
  }
}
