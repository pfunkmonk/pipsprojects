const JSON_CONTENT_TYPE = /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|\s*$)/i;

export const RESPONSE_SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

export function secureResponseHeaders(headers = {}) {
  return { ...RESPONSE_SECURITY_HEADERS, ...headers };
}

export function requestBodyExceeds(request, maximumBytes) {
  const value = request.headers.get("content-length");
  if (value === null) return false;
  if (!/^\d+$/.test(value.trim())) return true;
  return Number(value) > maximumBytes;
}

export function isJsonRequest(request) {
  return JSON_CONTENT_TYPE.test(request.headers.get("content-type") || "");
}

export function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
