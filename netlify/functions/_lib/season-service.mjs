import { createHash } from "node:crypto";
import { canonicalizeCbsLeagueSnapshot, leagueStateFromFinalLedger } from "./cbs-season-source.mjs";
import { parseFbgWeeklyCsv } from "./fbg-season-source.mjs";
import { readLedger } from "./ledger-store.mjs";
import { currentResearchSnapshot } from "./research-store.mjs";
import { buildSeasonRecommendationSnapshot } from "./season-recommendations.mjs";
import { readSeasonPack } from "./season-pack.mjs";
import {
  readLatestCbsLeagueState,
  readLatestFbgWeeklySnapshot,
  readLatestSeasonPlan,
  readLeagueMoves,
  saveCbsLeagueState,
  saveFbgWeeklySnapshot,
  saveSeasonPlan,
} from "./season-store.mjs";
import { seasonIdempotencyKey, seasonWeekForDate } from "./season-time.mjs";
import { currentStatusSnapshot } from "./status-store.mjs";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceFingerprint({ pack, week, leagueState, fbgSnapshot, researchSnapshot, statusSnapshot }) {
  return sha256({
    schemaVersion: 1,
    season: pack.season,
    week,
    packId: pack.packId,
    cbs: leagueState.rawSha256,
    fbg: fbgSnapshot?.rawSha256 || null,
    research: researchSnapshot?.capturedAt || null,
    status: statusSnapshot?.rawSha256 || statusSnapshot?.capturedAt || null,
  });
}

async function liveLeagueState(pack) {
  const cbs = await readLatestCbsLeagueState(pack);
  if (cbs) return cbs.snapshot;
  return leagueStateFromFinalLedger({ ledger: await readLedger(), pack });
}

export async function refreshSeasonPlan({
  now = new Date(),
  forcePublic = false,
  archiveTuesday = false,
} = {}) {
  const generatedAt = new Date(now).toISOString();
  const week = seasonWeekForDate(now);
  const pack = await readSeasonPack();
  const leagueState = await liveLeagueState(pack);
  const [fbgSnapshot, statusResult, researchResult, leagueMoves] = await Promise.all([
    readLatestFbgWeeklySnapshot(pack, week),
    currentStatusSnapshot(pack, { force: forcePublic }).then((value) => ({ value })).catch((error) => ({ error })),
    currentResearchSnapshot({ force: forcePublic }).then((value) => ({ value })).catch((error) => ({ error })),
    readLeagueMoves(week),
  ]);
  const statusSnapshot = statusResult.value || null;
  const researchSnapshot = researchResult.value || null;
  const plan = buildSeasonRecommendationSnapshot({
    pack,
    leagueState,
    week,
    fbgSnapshot,
    researchSnapshot,
    statusSnapshot,
    leagueMoves,
    generatedAt,
  });
  plan.sourceFingerprint = sourceFingerprint({ pack, week, leagueState, fbgSnapshot, researchSnapshot, statusSnapshot });
  plan.idempotencyKey = seasonIdempotencyKey({ date: now, source: archiveTuesday ? "tuesday-plan" : "live-watch" });
  if (statusResult.error) plan.alerts.push(`Injury refresh failed; no current status snapshot is available (${statusResult.error.message}).`);
  if (researchResult.error) plan.alerts.push(`Depth/news refresh failed; no current research snapshot is available (${researchResult.error.message}).`);
  if (statusResult.error || researchResult.error) plan.state = plan.state === "READY" ? "PARTIAL" : plan.state;
  const saved = await saveSeasonPlan(plan, { archiveTuesday });
  return { ...saved, week };
}

export async function getOrCreateCurrentSeasonPlan({ now = new Date() } = {}) {
  const latest = await readLatestSeasonPlan();
  const week = seasonWeekForDate(now);
  if (latest?.week === week) return latest;
  return (await refreshSeasonPlan({ now })).plan;
}

export function buildSeasonSetupSnapshot({ pack, now = new Date() }) {
  const generatedAt = new Date(now).toISOString();
  const week = seasonWeekForDate(now);
  const syncMessage = "The final auction ledger does not yet contain all 12 complete rosters. Sync private CBS league data to establish the in-season baseline.";
  return {
    schemaVersion: 1,
    kind: "thunder-bowl-season-setup-required",
    season: pack.season,
    week,
    generatedAt,
    state: "PARTIAL",
    requiresLeagueSync: true,
    alerts: [syncMessage],
    refreshBehavior: "CBS league sync is required before recommendations can be generated. Authentication remains active so the private source can be supplied safely.",
    sources: [
      { label: "CBS league", asOf: null, ageMinutes: null, required: true },
      { label: "CBS stats", asOf: null, ageMinutes: null, required: false },
      { label: "FBG projections", asOf: null, ageMinutes: null, required: true },
      { label: "injury / news", asOf: null, ageMinutes: null, required: false },
    ],
    baseline: { authority: "season setup required", source: "authenticated CBS all-team roster snapshot", asOf: null },
    lineup: { legal: false, total: null, requiredSlots: {}, missingSlots: [], starters: [], bench: [], swaps: [] },
    waivers: { recommendations: [], blockedReason: syncMessage },
    trades: { recommendations: [], blockedReason: syncMessage },
    watch: { leagueMoves: [], injuries: [], irTargets: [] },
    model: { deterministic: true, missingPolicy: "recommendations remain blocked until the private league baseline exists" },
    sourceFingerprint: sha256({ schemaVersion: 1, kind: "thunder-bowl-season-setup-required", packId: pack.packId, week }),
  };
}

export async function getCurrentSeasonSnapshot({ now = new Date() } = {}) {
  try {
    return await getOrCreateCurrentSeasonPlan({ now });
  } catch (error) {
    if (error?.code !== "SEASON_BASELINE_UNAVAILABLE") throw error;
    return buildSeasonSetupSnapshot({ pack: await readSeasonPack(), now });
  }
}

export async function importCbsLeagueSnapshot(input, { now = new Date() } = {}) {
  const pack = await readSeasonPack();
  const week = seasonWeekForDate(now);
  const snapshot = canonicalizeCbsLeagueSnapshot(input, pack);
  const saved = await saveCbsLeagueState(snapshot, pack, { week });
  const refreshed = await refreshSeasonPlan({ now });
  return { plan: refreshed.plan, source: { changed: saved.changed, capturedAt: snapshot.capturedAt, leagueMoves: saved.leagueMoves } };
}

export async function importFbgWeeklyCsv(text, { now = new Date() } = {}) {
  const pack = await readSeasonPack();
  const currentWeek = seasonWeekForDate(now);
  const snapshot = parseFbgWeeklyCsv(text, pack);
  if (snapshot.week !== currentWeek) throw new Error(`The import is for Week ${snapshot.week}; this dashboard is currently on Week ${currentWeek}.`);
  await saveFbgWeeklySnapshot(snapshot, pack);
  const refreshed = await refreshSeasonPlan({ now });
  return { plan: refreshed.plan, source: { week: snapshot.week, capturedAt: snapshot.capturedAt, rows: snapshot.itemCount } };
}
