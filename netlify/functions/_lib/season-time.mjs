export const SEASON_SCHEMA_VERSION = 1;
export const SEASON_TIME_ZONE = "America/Denver";
export const SEASON_YEAR = 2026;
export const WEEK_ONE_TUESDAY = "2026-09-08";

const denverFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SEASON_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Season time requires a valid date.");
  return date;
}

export function denverDateParts(value = new Date()) {
  const parts = Object.fromEntries(denverFormatter.formatToParts(validDate(value))
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function localDayNumber(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

export function seasonWeekForDate(value = new Date()) {
  const parts = denverDateParts(value);
  const [year, month, day] = WEEK_ONE_TUESDAY.split("-").map(Number);
  const elapsedDays = localDayNumber(parts) - localDayNumber({ year, month, day });
  return Math.max(1, Math.min(18, Math.floor(elapsedDays / 7) + 1));
}

export function isDenverTuesdayRefresh(value = new Date()) {
  const parts = denverDateParts(value);
  return parts.weekday === "Tue" && parts.hour === 6 && parts.minute < 15;
}

export function seasonIdempotencyKey({ date = new Date(), source, schemaVersion = SEASON_SCHEMA_VERSION } = {}) {
  const normalizedSource = String(source || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  if (!normalizedSource) throw new Error("Season idempotency requires a source.");
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new Error("Season idempotency requires a schema version.");
  return `${SEASON_YEAR}/week-${seasonWeekForDate(date)}/${normalizedSource}/v${schemaVersion}`;
}

export function ageMinutes(timestamp, now = new Date()) {
  const captured = Date.parse(timestamp || "");
  const current = validDate(now).getTime();
  return Number.isFinite(captured) ? Math.max(0, Math.floor((current - captured) / 60_000)) : null;
}

