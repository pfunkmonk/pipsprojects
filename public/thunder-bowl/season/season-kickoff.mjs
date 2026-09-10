const ZONES = Object.freeze({
  MT: "America/Denver",
  ET: "America/New_York",
  CT: "America/Chicago",
  PT: "America/Los_Angeles",
});

export function normalizedKickoffAt(value, week, season = 2026) {
  if (typeof value !== "string" || !Number.isInteger(week) || week < 1 || week > 18) return null;
  if (/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  }
  const match = value.match(/^(Tue(?:s)?|Wed|Thu(?:rs?)?|Fri|Sat|Sun|Mon)\s+(\d{1,2}):(\d{2})\s*(am|pm)\s+(MT|ET|CT|PT)$/i);
  if (!match || season !== 2026) return null;
  let [, day, hour, minute, ampm, zone] = match;
  if (+hour < 1 || +hour > 12 || +minute > 59) return null;
  const offset = ["tue", "wed", "thu", "fri", "sat", "sun", "mon"].indexOf(day.slice(0, 3).toLowerCase());
  const local = Date.UTC(2026, 8, 8 + (week - 1) * 7 + offset, (+hour % 12) + (/pm/i.test(ampm) ? 12 : 0), +minute);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONES[zone.toUpperCase()],
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let utc = local;
  for (let index = 0; index < 3; index += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
    utc += local - Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  }
  return new Date(utc).toISOString();
}

export function formatDenverKickoff(row, week, season = 2026) {
  const normalized = normalizedKickoffAt(row?.kickoffAt || row?.gameTime, week, season);
  if (!normalized) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(normalized));
}
