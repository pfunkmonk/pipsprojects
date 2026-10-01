const DENVER_TIME_ZONE = "America/Denver";
const RUN_WEEKDAYS = new Set(["Tue", "Wed", "Thu", "Fri", "Sat"]);

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DENVER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(instant) {
  return Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
}

function addCalendarDays({ year, month, day }, count) {
  const value = new Date(Date.UTC(year, month - 1, day + count));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function denverLocalToInstant({ year, month, day, hour, minute = 0, second = 0 }) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(new Date(candidate));
    const represented = Date.UTC(
      Number(actual.year),
      Number(actual.month) - 1,
      Number(actual.day),
      Number(actual.hour),
      Number(actual.minute),
      Number(actual.second),
    );
    candidate += desired - represented;
  }
  return new Date(candidate);
}

export function nextBackgroundRefreshAt(now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  const denver = zonedParts(current);
  const calendar = { year: Number(denver.year), month: Number(denver.month), day: Number(denver.day) };
  for (let offset = 0; offset <= 8; offset += 1) {
    const date = addCalendarDays(calendar, offset);
    const candidate = denverLocalToInstant({ ...date, hour: 14 });
    const parts = zonedParts(candidate);
    if (RUN_WEEKDAYS.has(parts.weekday) && candidate.getTime() > current.getTime() + 1_000) return candidate;
  }
  throw new Error("The next Tuesday-through-Saturday background refresh could not be scheduled.");
}

export function backgroundRefreshScheduleLabel() {
  return "Tuesday-Saturday at 2:00 PM America/Denver";
}
