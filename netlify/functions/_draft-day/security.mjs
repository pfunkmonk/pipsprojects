import { Buffer } from "node:buffer";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const ROLE_COOKIES = Object.freeze({
  admin: "ddt_admin_session",
  auctioneer: "ddt_auctioneer_session",
  board: "ddt_board_session",
});

function secureEqual(left, right) {
  const leftDigest = createHmac("sha256", "pips-draft-day-constant-time").update(String(left)).digest();
  const rightDigest = createHmac("sha256", "pips-draft-day-constant-time").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function normalizeAccessCode(value) {
  const result = String(value ?? "").trim();
  if (result.length < 8 || result.length > 100) throw new Error("Access codes must contain 8 through 100 characters.");
  return result;
}

export function hashAccessCode(value, salt = randomBytes(16).toString("base64url")) {
  const code = normalizeAccessCode(value);
  return { salt, hash: scryptSync(code, salt, 32).toString("base64url") };
}

export function verifyAccessCode(value, record) {
  if (!record?.salt || !record?.hash) return false;
  try {
    const candidate = scryptSync(normalizeAccessCode(value), record.salt, 32).toString("base64url");
    return secureEqual(candidate, record.hash);
  } catch {
    return false;
  }
}

function signingSecret(value) {
  if (typeof value !== "string" || value.length < 32) throw new Error("DRAFT_DAY_SESSION_SECRET must contain at least 32 characters.");
  return value;
}

function signature(payload, secret) {
  return createHmac("sha256", signingSecret(secret)).update(payload).digest("base64url");
}

export function createRoleCookie({ role, leagueCode, secret, secure = true, maxAgeSeconds = 12 * 60 * 60 }) {
  if (!ROLE_COOKIES[role]) throw new Error("Session role is invalid.");
  const payload = Buffer.from(JSON.stringify({ role, leagueCode, exp: Date.now() + maxAgeSeconds * 1_000, nonce: randomBytes(12).toString("base64url") })).toString("base64url");
  const token = `${payload}.${signature(payload, secret)}`;
  return `${ROLE_COOKIES[role]}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly${secure ? "; Secure" : ""}; SameSite=Strict`;
}

export function clearRoleCookies({ secure = true } = {}) {
  return Object.values(ROLE_COOKIES).map((name) => `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secure ? "; Secure" : ""}; SameSite=Strict`);
}

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export function verifyRoleCookie(header, { role, leagueCode, secret }) {
  if (!ROLE_COOKIES[role] || typeof secret !== "string" || secret.length < 32) return false;
  const token = cookieValue(header, ROLE_COOKIES[role]);
  if (!token) return false;
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra || !secureEqual(supplied, signature(payload, secret))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.role === role && session.leagueCode === leagueCode && Number.isFinite(session.exp) && session.exp > Date.now();
  } catch {
    return false;
  }
}

export function accessRecords(codes) {
  return {
    admin: hashAccessCode(codes?.adminCode),
    auctioneer: hashAccessCode(codes?.auctioneerCode),
    board: hashAccessCode(codes?.boardCode),
  };
}

