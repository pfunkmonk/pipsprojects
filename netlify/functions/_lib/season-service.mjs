import { createHash } from "node:crypto";
import { canonicalizeCbsLeagueSnapshot, leagueStateFromFinalLedger } from "./cbs-season-source.mjs";
import { downloadFbgWeeklySnapshot, parseFbgAuthenticatedWeeklyCapture, parseFbgWeeklyCsv, validateFbgWeeklySnapshot } from "./fbg-season-source.mjs";
import { readLedger } from "./ledger-store.mjs";
import { currentResearchSnapshot } from "./research-store.mjs";
import { buildSeasonRecommendationSnapshot } from "./season-recommendations.mjs";
import { parseFantasyProsAuthenticatedCapture, parsePffAuthenticatedCapture } from "./supplemental-season-source.mjs";
import { readSeasonPack } from "./season-pack.mjs";
import {
  readLatestCbsLeagueState,
  readLatestFbgWeeklySnapshot,
  readLatestSeasonPlan,
  readLatestSupplementalWeeklySnapshot,
  readLeagueMoves,
  saveCbsLeagueState,
  saveFbgWeeklySnapshot,
  saveSeasonPlan,
  saveSupplementalWeeklySnapshot,
} from "./season-store.mjs";
import { seasonIdempotencyKey, seasonWeekForDate } from "./season-time.mjs";
import { currentStatusSnapshot } from "./status-store.mjs";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceFingerprint({ pack, week, leagueState, fbgSnapshot, fantasyProsSnapshot, pffSnapshot, researchSnapshot, statusSnapshot }) {
  return sha256({
    schemaVersion: 1,
    season: pack.season,
    week,
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
  return leagueStateFromFinalLedger({ ledger: await readLedger(), pack });
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
  const [statusResult, researchResult] = await Promise.all([
    currentStatusSnapshot(pack, { force: true }).then((value) => ({ value })).catch((error) => ({ error })),
    currentResearchSnapshot({ force: true }).then((value) => ({ value })).catch((error) => ({ error })),
  ]);
  const statusError = statusResult.error?.message || statusResult.value?.refreshError || null;
  const researchError = researchResult.error?.message || researchResult.value?.refreshError || null;
  return {
    statusSnapshot: statusResult.value || null,
    researchSnapshot: researchResult.value || null,
    sourceRefresh: {
      status: { ok: !statusError, asOf: statusResult.value?.capturedAt || null, error: statusError },
      research: { ok: !researchError, asOf: researchResult.value?.capturedAt || null, error: researchError },
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
  const [fbgRefreshResult, statusResult, researchResult, leagueMoves] = await Promise.all([
    fbgRefreshTask,
    publicSourceOverrides
      ? Promise.resolve({ value: publicSourceOverrides.statusSnapshot })
      : currentStatusSnapshot(pack, { force: forcePublic }).then((value) => ({ value })).catch((error) => ({ error })),
    publicSourceOverrides
      ? Promise.resolve({ value: publicSourceOverrides.researchSnapshot })
      : currentResearchSnapshot({ force: forcePublic }).then((value) => ({ value })).catch((error) => ({ error })),
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
  plan.idempotencyKey = seasonIdempotencyKey({ date: now, source: archiveTuesday ? "tuesday-plan" : "live-watch" });
  if (statusRefreshError) plan.alerts.push(`Injury refresh failed; last-known safe status evidence remains in use (${statusRefreshError}).`);
  if (researchRefreshError) plan.alerts.push(`Depth/news refresh failed; last-known safe research evidence remains in use (${researchRefreshError}).`);
  if (fbgRefreshError) plan.alerts.push(`Footballguys raw-stat projections could not update; the last-known projection snapshot remains in use (${fbgRefreshError}).`);
  if (statusRefreshError || researchRefreshError || fbgRefreshError) plan.state = plan.state === "READY" ? "PARTIAL" : plan.state;
  if (archiveTuesday && fbgRefreshError) throw new Error(`Tuesday plan was not archived because fresh Footballguys raw-stat projections were unavailable (${fbgRefreshError}).`);
  const saved = await saveSeasonPlan(plan, { archiveTuesday });
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
    },
  };
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
  const syncMessage = "The private CBS baseline is not connected. Choose Update everything to capture all 12 teams; each team is valid with the required eight starters and zero to six backups.";
  return {
    schemaVersion: 1,
    kind: "thunder-bowl-season-setup-required",
    season: pack.season,
    week,
    generatedAt,
    state: "PARTIAL",
    requiresLeagueSync: true,
    alerts: [syncMessage],
    refreshBehavior: "Update everything captures authenticated CBS, Footballguys, FantasyPros, and PFF component-stat projections, applies Thunder Bowl scoring, and refreshes current injury/news evidence. The Tuesday scheduler refreshes the sources it can access without your signed-in browser.",
    sources: [
      { label: "CBS league", asOf: null, ageMinutes: null, required: true },
      { label: "CBS stats", asOf: null, ageMinutes: null, required: false },
      { label: "FBG projections", asOf: null, ageMinutes: null, required: true },
      { label: "FantasyPros", asOf: null, ageMinutes: null, required: false },
      { label: "PFF", asOf: null, ageMinutes: null, required: false },
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
  const captured = await captureCbsLeagueSource(input, { now });
  const refreshed = await refreshSeasonPlan({ now });
  return { plan: refreshed.plan, source: captured.source };
}

export async function captureCbsLeagueSource(input, { now = new Date() } = {}) {
  const pack = await readSeasonPack();
  const week = seasonWeekForDate(now);
  const snapshot = canonicalizeCbsLeagueSnapshot(input, pack);
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
  const snapshot = canonicalizeCbsLeagueSnapshot(input, pack);
  const cbsSaved = await saveCbsLeagueState(snapshot, pack, { week });
  const refreshed = await refreshSeasonPlan({ now, forcePublic: true, refreshFootballguys: true });
  const publicFailures = Object.entries(refreshed.sourceRefresh)
    .filter(([source]) => ["status", "research"].includes(source))
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
