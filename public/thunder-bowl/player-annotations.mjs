export const PLAYER_ANNOTATION_SCHEMA_VERSION = 1;
export const PLAYER_TAGS = Object.freeze(["neutral", "target", "avoid"]);

function integerPrice(value, label) {
  if (value === null || value === "" || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 300) throw new Error(`${label} must be a whole dollar from $1 to $300.`);
  return number;
}

export function createPlayerAnnotation(input = {}, updatedAt = new Date().toISOString()) {
  const tag = input.tag || "neutral";
  if (!PLAYER_TAGS.includes(tag)) throw new Error("Player tag must be Target, Avoid, or Neutral.");
  const note = String(input.note || "").trim();
  if (note.length > 1200) throw new Error("Personal player notes are limited to 1,200 characters.");
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error("Player annotation time is invalid.");
  const personalMax = integerPrice(input.personalMax, "Personal max price");
  const stealPrice = integerPrice(input.stealPrice, "Steal price");
  if (personalMax !== null && stealPrice !== null && stealPrice > personalMax) {
    throw new Error("Steal price cannot be higher than your personal max price.");
  }
  return Object.freeze({
    schemaVersion: PLAYER_ANNOTATION_SCHEMA_VERSION,
    tag,
    personalMax,
    stealPrice,
    note,
    updatedAt,
  });
}

export function validatePlayerAnnotation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Player annotation is invalid.");
  const expected = ["schemaVersion", "tag", "personalMax", "stealPrice", "note", "updatedAt"];
  const keys = Object.keys(input);
  if (keys.length !== expected.length || !expected.every((key) => key in input) || input.schemaVersion !== PLAYER_ANNOTATION_SCHEMA_VERSION) {
    throw new Error("Player annotation schema mismatch.");
  }
  return createPlayerAnnotation(input, input.updatedAt);
}

export function validatePlayerAnnotations(input, knownPlayerIds = null) {
  if (input === null || input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Player annotations must be a player-keyed object.");
  const known = knownPlayerIds ? new Set(knownPlayerIds) : null;
  const output = {};
  for (const [playerId, annotation] of Object.entries(input)) {
    if (!/^[A-Za-z0-9._:-]{2,120}$/.test(playerId)) throw new Error("Player annotation contains an invalid player identifier.");
    if (known && !known.has(playerId)) continue;
    output[playerId] = validatePlayerAnnotation(annotation);
  }
  return output;
}

export function isEmptyAnnotation(annotation) {
  return !annotation || (annotation.tag === "neutral" && annotation.personalMax === null && annotation.stealPrice === null && !annotation.note);
}

export function personalBidLimit({ modelMax, legalMax, annotation = null }) {
  const limits = [Math.max(0, Math.floor(Number(modelMax) || 0)), Math.max(0, Math.floor(Number(legalMax) || 0))];
  if (annotation?.personalMax !== null && annotation?.personalMax !== undefined) limits.push(annotation.personalMax);
  return Math.min(...limits);
}

export function playerTagSort(tag) {
  return tag === "target" ? 0 : tag === "avoid" ? 2 : 1;
}

export function priceSignal(currentPrice, annotation = null) {
  const price = Number(currentPrice);
  if (!Number.isFinite(price) || !annotation) return "normal";
  if (annotation.personalMax !== null && price > annotation.personalMax) return "over-max";
  if (annotation.stealPrice !== null && price <= annotation.stealPrice) return "steal";
  return "normal";
}
