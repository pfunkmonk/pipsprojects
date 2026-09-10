import { createHash, randomUUID } from "node:crypto";
import { canonicalizeCbsLeagueSnapshot } from "./cbs-season-source.mjs";
import { CBS_TEAM_CATALOG } from "../../../public/thunder-bowl/cbs-roster-snapshot.mjs";
import { downloadFbgWeeklySnapshot, parseFbgAuthenticatedWeeklyCapture, parseFbgWeeklyCsv, validateFbgWeeklySnapshot } from "./fbg-season-source.mjs";
import { currentNewsSnapshot } from "./news-store.mjs";
import { currentResearchSnapshot } from "./research-store.mjs";
import { analyzeTradeProposal, buildSeasonRecommendationSnapshot } from "./season-recommendations.mjs";
import { generateSeasonAiAdvice, validateAiSection } from "./season-ai-advice.mjs";
import { parseFantasyProsAuthenticatedCapture, parsePffAuthenticatedCapture } from "./supplemental-season-source.mjs";
import { readSeasonPack } from "./season-pack.mjs";
import {
  readLatestCbsLeagueState,
  readLatestFbgWeeklySnapshot,
  readLatestSeasonPlan,
  readLatestSeasonAiAdvice,
  readLatestSeasonAiJob,
  readSeasonAiAdviceForPlan,
  readLatestSupplementalWeeklySnapshot,
  readLeagueMoves,
  saveCbsLeagueState,
  saveFbgWeeklySnapshot,
  saveSeasonPlan,
  saveSeasonAiAdvice,
  saveSeasonAiJob,
  saveSupplementalWeeklySnapshot,
} from "./season-store.mjs";
import { seasonIdempotencyKey, seasonWeekForDate } from "./season-time.mjs";
import { currentStatusSnapshot } from "./status-store.mjs";
import { buildManagement } from "./season-management.mjs";
import { archiveManagementCheckpoint, readManagementState, saveManagementRecords, validateManagementRecords } from "./season-management-store.mjs";

const RECOMMENDATION_ENGINE_VERSION = 13;
const USER_TEAM_ID = "dogs-of-war";

export function normalizeSeasonViewingWeek(value, currentWeek) {
  if (!Number.isSafeInteger(currentWeek) || currentWeek < 1 || currentWeek > 18) throw new Error("Current season week is invalid.");
  if (value == null || value === "") return currentWeek;
  const week = Number(value);
  const maximum = Math.min(18, currentWeek + 2);
  if (!Number.isSafeInteger(week) || week < currentWeek || week > maximum) {
    const error = new Error(`Lineup outlook week must be between Week ${currentWeek} and Week ${maximum}.`);
    error.code = "INVALID_INPUT";
    throw error;
  }
  return week;
}

export function normalizeSeasonViewingTeam(value) {
  const teamId = String(value || USER_TEAM_ID).trim().toLowerCase();
  if (!CBS_TEAM_CATALOG.some((team) => team.teamId === teamId)) {
    const error = new Error("Lineup team must be one of the 12 CBS Thunder Bowl teams.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  return teamId;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceFingerprint({ pack, week, lineupTeamId = USER_TEAM_ID, leagueState, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, researchSnapshot, statusSnapshot }) {
  return sha256({
    schemaVersion: 1,
    recommendationEngineVersion: RECOMMENDATION_ENGINE_VERSION,
    season: pack.season,
    week,
    lineupTeamId,
    packId: pack.packId,
    cbs: leagueState.rawSha256,
    fbg: fbgSnapshot?.rawSha256 || null,
    fantasyPros: fantasyProsSnapshot?.rawSha256 || null,
    pff: pffSnapshot?.rawSha256 || null,
    research: researchSnapshot?.capturedAt || null,
    status: statusSnapshot?.rawSha256 || statusSnapshot?.capturedAt || null,
  });
}

async function liveLeagueState(pack) {
  const cbs = await readLatestCbsLeagueState(pack);
  if (cbs) return cbs.snapshot;
  const error = new Error("The authenticated CBS league snapshot is not available. Choose Update CBS or Update everything to establish the in-season roster baseline.");
  error.code = "SEASON_BASELINE_UNAVAILABLE";
  throw error;
}

export async function refreshFootballguysSource({ now = new Date() } = {}) {
  const pack = await readSeasonPack();
  const week = seasonWeekForDate(now);
  const snapshot = await downloadFbgWeeklySnapshot(pack, week);
  await saveFbgWeeklySnapshot(snapshot, pack);
  return {
    week,
    snapshot,
    sourceRefresh: {
      footballguys: {
        ok: true,
        requested: true,
        asOf: snapshot.providerAsOf,
        rows: snapshot.itemCount,
        error: null,
      },
    },
  };
}

async function captureSupplementalSource(input, provider, parse, { now = new Date() } = {}) {
  const pack = await readSeasonPack();
  const week = seasonWeekForDate(now);
  const snapshot = parse(input, pack);
  if (snapshot.week !== week) throw new Error(`${provider} capture is for Week ${snapshot.week}; the dashboard is on Week ${week}.`);
  await saveSupplementalWeeklySnapshot(snapshot, pack, provider);
  return { week, snapshot, sourceRefresh: { [provider]: { ok: true, requested: true, authenticated: true, asOf: snapshot.providerAsOf, rows: snapshot.itemCount, error: null } } };
}

export function captureFantasyProsSource(input, options = {}) {
  return captureSupplementalSource(input, "fantasyPros", parseFantasyProsAuthenticatedCapture, options);
}

export function capturePffSource(input, options = {}) {
  return captureSupplementalSource(input, "pff", parsePffAuthenticatedCapture, options);
}

export async function captureFootballguysSource(input, { now = new Date() } = {}) {
  const pack = await readSeasonPack();
  const week = seasonWeekForDate(now);
  const snapshot = parseFbgAuthenticatedWeeklyCapture(input, pack);
  if (snapshot.week !== week) throw new Error(`Footballguys member capture is for Week ${snapshot.week}; the dashboard is on Week ${week}.`);
  await saveFbgWeeklySnapshot(snapshot, pack);
  return {
    week,
    snapshot,
    sourceRefresh: {
      footballguys: {
        ok: true,
        requested: true,
        authenticated: true,
        asOf: snapshot.providerAsOf,
        rows: snapshot.itemCount,
        error: null,
      },
    },
  };
}

export async function refreshSeasonPublicSources() {
  const pack = await readSeasonPack();
  const [statusResult, researchResult, newsResult] = await Promise.all([
    currentStatusSnapshot(pack, { force: true }).then((value) => ({ value })).catch((error) => ({ error })),
    currentResearchSnapshot({ force: true }).then((value) => ({ value })).catch((error) => ({ error })),
    currentNewsSnapshot({ force: true }).then((value) => ({ value })).catch((error) => ({ error })),
  ]);
  const statusError = statusResult.error?.message || statusResult.value?.refreshError || null;
  const researchError = researchResult.error?.message || researchResult.value?.refreshError || null;
  const newsError = newsResult.error?.message || newsResult.value?.refreshError || null;
  return {
    statusSnapshot: statusResult.value || null,
    researchSnapshot: researchResult.value || null,
    newsSnapshot: newsResult.value || null,
    sourceRefresh: {
      status: { ok: !statusError, asOf: statusResult.value?.capturedAt || null, error: statusError },
      research: { ok: !researchError, asOf: researchResult.value?.capturedAt || null, error: researchError },
      news: { ok: !newsError, asOf: newsResult.value?.capturedAt || null, items: newsResult.value?.archiveItemCount || 0, error: newsError },
    },
  };
}

export async function refreshSeasonPlan({
  now = new Date(),
  forcePublic = false,
  archiveTuesday = false,
  refreshFootballguys = false,
  publicSourceOverrides = null,
  leagueStateOverride = null,
  fbgSnapshotOverride = null,
  fantasyProsSnapshotOverride = null,
  pffSnapshotOverride = null,
} = {}) {
  const generatedAt = new Date(now).toISOString();
  const week = seasonWeekForDate(now);
  const pack = await readSeasonPack();
  const leagueState = leagueStateOverride ? canonicalizeCbsLeagueSnapshot(leagueStateOverride, pack) : await liveLeagueState(pack);
  const fbgRefreshTask = refreshFootballguys
    ? downloadFbgWeeklySnapshot(pack, week)
      .then(async (value) => { await saveFbgWeeklySnapshot(value, pack); return { value }; })
      .catch((error) => ({ error }))
    : Promise.resolve({ value: null });
  const newsRequested = forcePublic || Boolean(publicSourceOverrides);
  const [fbgRefreshResult, statusResult, researchResult, newsResult, leagueMoves] = await Promise.all([
    fbgRefreshTask,
    publicSourceOverrides
      ? Promise.resolve({ value: publicSourceOverrides.statusSnapshot })
      : currentStatusSnapshot(pack, { force: forcePublic }).then((value) => ({ value })).catch((error) => ({ error })),
    publicSourceOverrides
      ? Promise.resolve({ value: publicSourceOverrides.researchSnapshot })
      : currentResearchSnapshot({ force: forcePublic }).then((value) => ({ value })).catch((error) => ({ error })),
    publicSourceOverrides?.newsSnapshot
      ? Promise.resolve({ value: publicSourceOverrides.newsSnapshot })
      : newsRequested
        ? currentNewsSnapshot({ force: forcePublic }).then((value) => ({ value })).catch((error) => ({ error }))
        : Promise.resolve({ value: null }),
    readLeagueMoves(week),
  ]);
  const refreshedFbgSnapshot = fbgRefreshResult.value || null;
  const fbgRefreshError = fbgRefreshResult.error instanceof Error ? fbgRefreshResult.error.message : fbgRefreshResult.error ? String(fbgRefreshResult.error) : null;
  const fbgSnapshot = fbgSnapshotOverride
    ? validateFbgWeeklySnapshot(fbgSnapshotOverride, pack)
    : refreshedFbgSnapshot || await readLatestFbgWeeklySnapshot(pack, week);
  if (fbgSnapshot && fbgSnapshot.week !== week) throw new Error(`Footballguys source handoff is for Week ${fbgSnapshot.week}; the dashboard is on Week ${week}.`);
  const fantasyProsSnapshot = fantasyProsSnapshotOverride || await readLatestSupplementalWeeklySnapshot(pack, week, "fantasyPros");
  const pffSnapshot = pffSnapshotOverride || await readLatestSupplementalWeeklySnapshot(pack, week, "pff");
  const statusSnapshot = statusResult.value || null;
  const researchSnapshot = researchResult.value || null;
  const statusRefreshError = statusResult.error?.message || statusSnapshot?.refreshError || null;
  const researchRefreshError = researchResult.error?.message || researchSnapshot?.refreshError || null;
  const newsSnapshot = newsResult.value || null;
  const newsRefreshError = newsResult.error?.message || newsSnapshot?.refreshError || null;
  const plan = buildSeasonRecommendationSnapshot({
    pack,
    leagueState,
    week,
    fbgSnapshot,
    fantasyProsSnapshot,
    pffSnapshot,
    researchSnapshot,
    statusSnapshot,
    leagueMoves,
    generatedAt,
  });
  plan.sourceFingerprint = sourceFingerprint({ pack, week, leagueState, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, researchSnapshot, statusSnapshot });
  plan.recommendationEngineVersion = RECOMMENDATION_ENGINE_VERSION;
  plan.idempotencyKey = seasonIdempotencyKey({ date: now, source: archiveTuesday ? "tuesday-plan" : "live-watch" });
  if (statusRefreshError) plan.alerts.push(`Injury refresh failed; last-known safe status evidence remains in use (${statusRefreshError}).`);
  if (researchRefreshError) plan.alerts.push(`Depth/news refresh failed; last-known safe research evidence remains in use (${researchRefreshError}).`);
  if (newsRefreshError) plan.alerts.push(`Player-news refresh failed; the last saved all-player news cache remains in use (${newsRefreshError}).`);
  if (fbgRefreshError) plan.alerts.push(`Footballguys raw-stat projections could not update; the last-known projection snapshot remains in use (${fbgRefreshError}).`);
  if (statusRefreshError || researchRefreshError || newsRefreshError || fbgRefreshError) plan.state = plan.state === "READY" ? "PARTIAL" : plan.state;
  if (archiveTuesday && fbgRefreshError) throw new Error(`Tuesday plan was not archived because fresh Footballguys raw-stat projections were unavailable (${fbgRefreshError}).`);
  const saved = await saveSeasonPlan(plan, { archiveTuesday });
  try {
    await archiveManagementCheckpoint(plan, generatedAt);
  } catch (error) {
    console.error("Decision checkpoint could not be archived", error.message);
    saved.plan.alerts.push("This refresh was saved, but its outcome-tracking checkpoint could not be archived.");
  }
  saved.plan = await attachManagement(saved.plan, generatedAt);
  return {
    ...saved,
    week,
    sourceRefresh: {
      footballguys: {
        ok: !fbgRefreshError,
        requested: refreshFootballguys,
        asOf: fbgSnapshot?.providerAsOf || null,
        rows: fbgSnapshot?.itemCount || 0,
        error: fbgRefreshError,
      },
      fantasyPros: { ok: Boolean(fantasyProsSnapshot), requested: false, authenticated: Boolean(fantasyProsSnapshot), asOf: fantasyProsSnapshot?.providerAsOf || null, rows: fantasyProsSnapshot?.itemCount || 0, error: null },
      pff: { ok: Boolean(pffSnapshot), requested: false, authenticated: Boolean(pffSnapshot), asOf: pffSnapshot?.providerAsOf || null, rows: pffSnapshot?.itemCount || 0, error: null },
      status: { ok: !statusRefreshError, asOf: statusSnapshot?.capturedAt || null, error: statusRefreshError },
      research: { ok: !researchRefreshError, asOf: researchSnapshot?.capturedAt || null, error: researchRefreshError },
      news: { ok: !newsRefreshError, requested: newsRequested, asOf: newsSnapshot?.capturedAt || null, items: newsSnapshot?.archiveItemCount || 0, error: newsRefreshError },
    },
  };
}

export async function getOrCreateCurrentSeasonPlan({ now = new Date() } = {}) {
  const latest = await readLatestSeasonPlan();
  const week = seasonWeekForDate(now);
  if (latest?.week === week && latest.recommendationEngineVersion === RECOMMENDATION_ENGINE_VERSION) return latest;
  return (await refreshSeasonPlan({ now })).plan;
}

export function buildSeasonSetupSnapshot({ pack, now = new Date() }) {
  const generatedAt = new Date(now).toISOString();
  const week = seasonWeekForDate(now);
  const syncMessage = "The private CBS baseline is not connected. Choose Update CBS or Update everything to capture all 12 teams; each team is valid with the required eight starters and zero to six backups.";
  return {
    schemaVersion: 1,
    recommendationEngineVersion: RECOMMENDATION_ENGINE_VERSION,
    kind: "thunder-bowl-season-setup-required",
    season: pack.season,
    week,
    generatedAt,
    state: "PARTIAL",
    viewing: { currentWeek: week, selectedWeek: week, mode: "CURRENT", maxSelectableWeek: Math.min(18, week + 2), directProjectionSources: [], baselineAsOf: pack.weeklyContext?.asOf || pack.asOf },
    requiresLeagueSync: true,
    alerts: [syncMessage],
    refreshBehavior: "Each source can be updated independently, while Update everything captures authenticated CBS, Footballguys, FantasyPros, and PFF component-stat projections, applies Thunder Bowl scoring, and refreshes current injury/news evidence. The Tuesday scheduler refreshes the sources it can access without your signed-in browser.",
    sources: [
      { label: "CBS league", asOf: null, ageMinutes: null, required: true },
      { label: "CBS stats", asOf: null, ageMinutes: null, required: false },
      { label: "FBG projections", asOf: null, ageMinutes: null, required: true },
      { label: "FantasyPros", asOf: null, ageMinutes: null, required: false },
      { label: "PFF", asOf: null, ageMinutes: null, required: false },
      { label: "injury / news", asOf: null, ageMinutes: null, required: false },
    ],
    baseline: { authority: "season setup required", source: "authenticated CBS all-team roster snapshot", asOf: null },
    lineup: { teamId: USER_TEAM_ID, teamName: "Dogs of War", opponent: null, legal: false, total: null, requiredSlots: {}, missingSlots: [], starters: [], bench: [], freeAgentAlternatives: {}, swaps: [] },
    waivers: { recommendations: [], blockedReason: syncMessage },
    trades: { recommendations: [], blockedReason: syncMessage },
    watch: { leagueMoves: [], injuries: [], irTargets: [] },
    playerStats: [],
    league: { userTeamId: "dogs-of-war", teams: [] },
    model: { deterministic: true, missingPolicy: "recommendations remain blocked until the private league baseline exists" },
    sourceFingerprint: sha256({ schemaVersion: 1, kind: "thunder-bowl-season-setup-required", packId: pack.packId, week }),
  };
}

async function buildTeamLineupOutlook({ now, currentWeek, week, lineupTeamId }) {
  const generatedAt = new Date(now).toISOString();
  const pack = await readSeasonPack();
  const [leagueState, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, statusSnapshot, researchSnapshot, leagueMoves] = await Promise.all([
    liveLeagueState(pack),
    readLatestFbgWeeklySnapshot(pack, week),
    readLatestSupplementalWeeklySnapshot(pack, week, "fantasyPros"),
    readLatestSupplementalWeeklySnapshot(pack, week, "pff"),
    currentStatusSnapshot(pack, { force: false }).catch(() => null),
    currentResearchSnapshot({ force: false }).catch(() => null),
    readLeagueMoves(week),
  ]);
  const plan = buildSeasonRecommendationSnapshot({
    pack,
    leagueState,
    week,
    currentWeek,
    fbgSnapshot,
    fantasyProsSnapshot,
    pffSnapshot,
    researchSnapshot,
    statusSnapshot,
    leagueMoves,
    generatedAt,
    lineupTeamId,
  });
  plan.sourceFingerprint = sourceFingerprint({ pack, week, lineupTeamId, leagueState, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, researchSnapshot, statusSnapshot });
  plan.recommendationEngineVersion = RECOMMENDATION_ENGINE_VERSION;
  return plan;
}

export async function getCurrentSeasonSnapshot({ now = new Date(), week: requestedWeek = null, teamId: requestedTeamId = null } = {}) {
  const currentWeek = seasonWeekForDate(now);
  const week = normalizeSeasonViewingWeek(requestedWeek, currentWeek);
  const lineupTeamId = normalizeSeasonViewingTeam(requestedTeamId);
  try {
    if (week > currentWeek || lineupTeamId !== USER_TEAM_ID) return await attachManagement(await buildTeamLineupOutlook({ now, currentWeek, week, lineupTeamId }), new Date(now).toISOString());
    const plan = await attachManagement(await getOrCreateCurrentSeasonPlan({ now }), new Date(now).toISOString());
    return {
      ...plan,
      viewing: plan.viewing || {
        currentWeek,
        selectedWeek: currentWeek,
        mode: "CURRENT",
        maxSelectableWeek: Math.min(18, currentWeek + 2),
        directProjectionSources: [],
        baselineAsOf: plan.sources?.find((source) => source.label === "FBG projections")?.asOf || null,
      },
    };
  } catch (error) {
    if (error?.code !== "SEASON_BASELINE_UNAVAILABLE") throw error;
    return buildSeasonSetupSnapshot({ pack: await readSeasonPack(), now });
  }
}

async function attachManagement(plan, now) {
  const value = structuredClone(plan);
  let state;
  try {
    state = await readManagementState();
  } catch (error) {
    console.error("Management history unavailable", error.message);
    value.alerts.push("Management history could not be loaded. Historical bids, workload and results are unavailable for this view.");
    state = { records: [], checkpoints: [] };
  }
  value.management = buildManagement(value, { ...state, now });
  const sourceNames = { "CBS stats": "CBS", "FBG projections": "Footballguys", FantasyPros: "FantasyPros", PFF: "PFF" };
  value.sources = value.sources.map((s) => {
    const audit = value.management.sourceAudit.find((a) => a.source === sourceNames[s.label]);
    const asOf = audit ? audit.retrievedAt : s.asOf;
    return { ...s, asOf, ageMinutes: Number.isFinite(Date.parse(asOf)) ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(asOf)) / 60000)) : null };
  });
  const weakSources = value.management.sourceAudit.filter((s) => s.status !== "RECENT_CAPTURE");
  if (weakSources.length) value.alerts.push(`Projection evidence needs review: ${weakSources.map((s) => `${s.source} ${s.status.toLowerCase().replaceAll("_", " ")}`).join("; ")}. See Evidence quality & provenance below.`);
  if (value.management.sourceAudit.some((s) => s.status !== "RECENT_CAPTURE") && value.state === "READY") value.state = "PARTIAL";
  const day = value.management.gameDay;
  if (value.viewing?.mode !== "FORECAST") {
    value.lineup.decisionSummary = { ...value.lineup.decisionSummary,
      verdict: day.verdict,
      headline: day.verdict === "INCOMPLETE" ? "A complete legal lineup is not available" : day.verdict === "VERIFY_CBS" ? "Verify your submitted CBS lineup" : day.verdict === "REVIEW" ? "Recommended starters differ from the submitted CBS lineup" : "Keep the captured CBS lineup; review optional close calls",
    };
  }
  // Evidence changes must invalidate saved AI advice, even if projections did not change.
  value.managementBaseFingerprint = plan.managementBaseFingerprint || plan.sourceFingerprint;
  value.sourceFingerprint = sha256({ plan: value.managementBaseFingerprint, records: state.records,
    locks: day.rows.map((p) => [p.playerId, p.status]), freshness: value.management.sourceAudit.map((s) => [s.source, s.status]) });
  return value;
}

export async function importManagementEvidence(records, { now = new Date() } = {}) {
  const pack = await readSeasonPack();
  const league = await liveLeagueState(pack);
  const normalized = validateManagementRecords(records, pack, league.teams, new Date(now).toISOString());
  await saveManagementRecords(normalized);
  return { plan: await getCurrentSeasonSnapshot({ now }), imported: normalized.length };
}

export async function analyzeProposedSeasonTrade(transfers, { now = new Date() } = {}) {
  const pack = await readSeasonPack();
  const week = seasonWeekForDate(now);
  const [leagueState, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, statusSnapshot] = await Promise.all([
    liveLeagueState(pack),
    readLatestFbgWeeklySnapshot(pack, week),
    readLatestSupplementalWeeklySnapshot(pack, week, "fantasyPros"),
    readLatestSupplementalWeeklySnapshot(pack, week, "pff"),
    currentStatusSnapshot(pack, { force: false }).catch(() => null),
  ]);
  return analyzeTradeProposal({ pack, leagueState, week, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, statusSnapshot, transfers });
}

export async function getSavedSeasonAiAdvice({ now = new Date() } = {}) {
  const plan = await getCurrentSeasonSnapshot({ now });
  const sections = ["lineup", "waivers", "trades", "trade-finder", "stash-watch"];
  const [entries, jobEntries] = await Promise.all([Promise.all(sections.map(async (section) => {
    const advice = await readLatestSeasonAiAdvice(section);
    return [section, advice ? { advice, stale: advice.sourceFingerprint !== plan.sourceFingerprint } : null];
  })), Promise.all(sections.map(async (section) => [section, await readLatestSeasonAiJob(section)]))]);
  return {
    schemaVersion: 1,
    kind: "thunder-bowl-season-ai-advice-index",
    sourceFingerprint: plan.sourceFingerprint,
    adviceBySection: Object.fromEntries(entries),
    jobsBySection: Object.fromEntries(jobEntries),
  };
}

function configuredOpenAiKey() {
  const configured = String(process.env.OPEN_API_KEY || "").trim();
  return configured.match(/sk-[A-Za-z0-9_-]{20,}/)?.[0] || configured;
}

export async function analyzeCurrentSeasonSectionWithAi(section, { now = new Date(), fetchImpl = fetch } = {}) {
  const safeSection = validateAiSection(section);
  const plan = await getCurrentSeasonSnapshot({ now });
  const existing = await readSeasonAiAdviceForPlan(safeSection, plan.sourceFingerprint);
  if (existing) return { advice: existing, cached: true, stale: false };
  const advice = await generateSeasonAiAdvice({
    plan,
    section: safeSection,
    apiKey: configuredOpenAiKey(),
    model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
    fetchImpl,
    now,
  });
  await saveSeasonAiAdvice(advice);
  return { advice, cached: false, stale: false };
}

function safeAiJobError(error) {
  const message = error instanceof Error ? error.message : "AI analysis failed before it could be saved.";
  return String(message).replace(/sk-[A-Za-z0-9_-]{10,}/g, "[redacted]").slice(0, 400);
}

export async function runCurrentSeasonSectionWithAiInBackground(section, { now = new Date(), fetchImpl = fetch, jobId = randomUUID() } = {}) {
  const safeSection = validateAiSection(section);
  if (!["trade-finder", "stash-watch"].includes(safeSection)) {
    const error = new Error("Only deep AI searches may run as background jobs.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  const plan = await getCurrentSeasonSnapshot({ now });
  const startedAt = new Date(now).toISOString();
  const job = {
    schemaVersion: 1,
    kind: "thunder-bowl-season-ai-job",
    jobId,
    section: safeSection,
    sourceFingerprint: plan.sourceFingerprint,
    status: "RUNNING",
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    error: null,
  };
  await saveSeasonAiJob(job);
  try {
    await analyzeCurrentSeasonSectionWithAi(safeSection, { now, fetchImpl });
    return await saveSeasonAiJob({ ...job, status: "COMPLETED", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
  } catch (error) {
    await saveSeasonAiJob({ ...job, status: "FAILED", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), error: safeAiJobError(error) });
    throw error;
  }
}

export async function importCbsLeagueSnapshot(input, { now = new Date() } = {}) {
  const captured = await captureCbsLeagueSource(input, { now });
  const refreshed = await refreshSeasonPlan({ now });
  return { plan: refreshed.plan, source: captured.source };
}

export function retainPriorCbsOptionalEvidence(captured, prior) {
  if (!prior) return captured;
  const snapshot = { ...captured };
  if (!captured.fabState && prior.fabState?.week === captured.projectionWeek) snapshot.fabState = prior.fabState;
  if (
    captured.projectionCount === 0
    && prior.projectionCount > 0
    && prior.projectionWeek === captured.projectionWeek
    && Array.isArray(prior.weeklyProjections)
  ) {
    snapshot.projectionCount = prior.projectionCount;
    snapshot.weeklyProjections = prior.weeklyProjections;
    snapshot.unmatchedProjectionCount = prior.unmatchedProjectionCount;
  }
  return snapshot;
}

export async function captureCbsLeagueSource(input, { now = new Date() } = {}) {
  const pack = await readSeasonPack();
  const week = seasonWeekForDate(now);
  const captured = canonicalizeCbsLeagueSnapshot(input, pack);
  const prior = await readLatestCbsLeagueState(pack);
  const snapshot = retainPriorCbsOptionalEvidence(captured, prior);
  const saved = await saveCbsLeagueState(snapshot, pack, { week });
  return { source: { changed: saved.changed, capturedAt: snapshot.capturedAt, leagueMoves: saved.leagueMoves } };
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

export async function updateSeasonEverything(input, { now = new Date() } = {}) {
  const pack = await readSeasonPack();
  const week = seasonWeekForDate(now);
  const captured = canonicalizeCbsLeagueSnapshot(input, pack);
  const prior = await readLatestCbsLeagueState(pack);
  const snapshot = retainPriorCbsOptionalEvidence(captured, prior);
  const cbsSaved = await saveCbsLeagueState(snapshot, pack, { week });
  const refreshed = await refreshSeasonPlan({ now, forcePublic: true, refreshFootballguys: true });
  const publicFailures = Object.entries(refreshed.sourceRefresh)
    .filter(([source]) => ["status", "research", "news"].includes(source))
    .filter(([, result]) => !result.ok)
    .map(([source, result]) => `${source}: ${result.error}`);
  const updateSummary = {
    capturedAt: new Date(now).toISOString(),
    cbs: {
      ok: true,
      changed: cbsSaved.changed,
      asOf: snapshot.capturedAt,
      moves: cbsSaved.leagueMoves.length,
      rosteredPlayers: snapshot.rosteredPlayerCount,
      rosterMinimum: snapshot.rosterMinimum,
      rosterMaximum: snapshot.rosterMaximum,
      legalTeams: snapshot.legalTeamCount,
      teamCount: snapshot.teamCount,
      rostersReady: snapshot.rostersReady,
      projectionWeek: snapshot.projectionWeek ?? null,
      projectionRows: snapshot.projectionCount ?? 0,
      unmatchedProjectionRows: snapshot.unmatchedProjectionCount ?? 0,
      fabStatus: snapshot.fabState?.status || "UNAVAILABLE",
      fabBudgetTeams: snapshot.fabState?.coverage?.budgetTeams || 0,
      fabOrderTeams: snapshot.fabState?.coverage?.orderTeams || 0,
      fabRecordTeams: snapshot.fabState?.coverage?.recordTeams || 0,
      scheduleCapturedAt: snapshot.leagueSchedule?.capturedAt || null,
      scheduleMatchups: snapshot.leagueSchedule?.matchupCount || 0,
      scheduleWeeks: snapshot.leagueSchedule?.headToHeadWeeks?.length || 0,
      scoringPreviewStatus: snapshot.scoringPreview?.status || "UNAVAILABLE",
      scoringPreviewCapturedAt: snapshot.scoringPreview?.capturedAt || null,
      scoringPreviewTeams: snapshot.scoringPreview?.teams?.length || 0,
      // Backward-compatible aliases for older clients.
      rosterTarget: snapshot.rosterMaximum,
      completeTeams: snapshot.legalTeamCount,
      rostersComplete: snapshot.rostersReady,
    },
    footballguys: {
      ok: refreshed.sourceRefresh.footballguys.ok,
      asOf: refreshed.sourceRefresh.footballguys.asOf,
      rows: refreshed.sourceRefresh.footballguys.rows,
      week,
      input: "provider component-stat projections",
      scoring: "Thunder Bowl rules",
      error: refreshed.sourceRefresh.footballguys.error,
    },
    injuryNews: {
      ok: publicFailures.length === 0,
      asOf: [refreshed.sourceRefresh.status.asOf, refreshed.sourceRefresh.research.asOf].filter(Boolean).sort().at(-1) || null,
      error: publicFailures.join("; ") || null,
    },
  };
  const plan = { ...refreshed.plan, updateSummary };
  return { plan, updateSummary };
}
