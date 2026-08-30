import { refreshSeasonPlan } from "./_lib/season-service.mjs";
import { claimScheduledRun, readTuesdayArchive } from "./_lib/season-store.mjs";
import { isDenverTuesdayRefresh, seasonIdempotencyKey, seasonWeekForDate } from "./_lib/season-time.mjs";

export default async function handler() {
  const now = new Date();
  if (!isDenverTuesdayRefresh(now)) return Response.json({ skipped: true, reason: "Not the 06:00 America/Denver Tuesday refresh window." });
  const week = seasonWeekForDate(now);
  const idempotencyKey = seasonIdempotencyKey({ date: now, source: "tuesday-plan" });
  if (await readTuesdayArchive(week)) return Response.json({ skipped: true, reason: "Tuesday plan already archived.", week, idempotencyKey });
  const result = await refreshSeasonPlan({ now, archiveTuesday: true });
  await claimScheduledRun(idempotencyKey, now.toISOString());
  return Response.json({ week, idempotencyKey, archived: result.archived, sourceFingerprint: result.plan.sourceFingerprint });
}

export const config = { schedule: "0,10 12,13 * * 2" };
