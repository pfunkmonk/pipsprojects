import {
  DEFAULT_CONFIG,
  EVENT_TYPES,
  POSITIONS,
  RuleViolation,
  canReplaceUnstartedConfiguration,
  createEvent,
  createRecoveryBundle,
  lastUndoableEvent,
  lastUndoableSale,
  mergeEventStreams,
  nominationOrderEvidence,
  rankOpponentPressure,
  replayDraft,
  toPublicSnapshot,
  validateDraftPack,
  validateRecoveryBundle,
} from "./state-engine.mjs?v=20260808g";
import {
  appendEvents,
  getMeta,
  getOrCreateDeviceId,
  hasOfflineVerifier,
  readEvents,
  registerOfflineShell,
  replaceEvents,
  saveOfflineVerifier,
  setMeta,
  verifyOfflineCode,
} from "./storage.mjs?v=20260805g";
import {
  PRACTICE_TICK_MS,
  USER_TEAM_ID,
  advanceQuietClock,
  applyPracticeBid,
  choosePracticeNominee,
  createPracticeSession,
  nextAutomatedBid,
  validatePracticeSession,
} from "./practice-engine.mjs?v=20260805g";
import {
  createPlayerAnnotation,
  isEmptyAnnotation,
  personalBidLimit,
  playerTagSort,
  priceSignal,
  validatePlayerAnnotations,
} from "./player-annotations.mjs?v=20260805g";
import {
  createPersonalBoardEvidence,
  createPersonalBoardBundle,
  mergePersonalBoardAnnotations,
  personalBoardFingerprint,
  personalBoardCsv,
  replacePersonalBoardAnnotations,
  validatePersonalBoardEvidence,
  validatePersonalBoardBundle,
} from "./personal-board-exchange.mjs?v=20260805g";
import { buildDraftReadinessReport, buildEmergencyBoardHtml } from "./draft-readiness.mjs?v=20260805g";
import { normalizePlayerSearch, playerSearchScore } from "./player-search.mjs?v=20260805g";
import { buildKeeperBoard, buildKeeperTradeMarket, keeperBoardCsv, keeperContractTenure, keeperTradeScenario } from "./keeper-board.mjs?v=20260808k";
import { calculateKeeperScenarioValues } from "./keeper-scenario.mjs?v=20260808i";
import { calculateAuctionDemandMarket } from "./auction-demand.mjs?v=20260808b";
import { fbgAuctionValueCompatibilityText } from "./fbg-configuration.mjs?v=20260808a";
import { buildDraftHistoryRows, draftHistoryCsv } from "./draft-history.mjs?v=20260808g";
import { buildDecisionContext } from "./decision-context.mjs?v=20260805g";
import {
  HUMAN_REHEARSAL_ITEMS,
  createHumanRehearsalEvidence,
  humanRehearsalStatus,
} from "./human-rehearsal.mjs?v=20260805g";
import {
  DEFAULT_PRIORITY_SCENARIO,
  priorityProjection,
  validatePriorityScenario,
} from "./priority-weights.mjs?v=20260805g";
import {
  compareCbsRosterSnapshots,
  requestCbsRosterCapture,
  validateCbsRosterSnapshot,
} from "./cbs-roster-snapshot.mjs?v=20260805g";
import { SALES_ENTRY_MODES, normalizeSalesEntryMode, salesEntryPolicy } from "./sales-entry-mode.mjs?v=20260808a";

const byId = (id) => document.getElementById(id);
const URL_PARAMETERS = new URLSearchParams(window.location.search);
const APP_MODE = URL_PARAMETERS.get("mode") || "draft-room";
const REPLAY_2025 = APP_MODE === "2025-replay";
const PRACTICE_AUCTION = APP_MODE === "practice-auction";
const LOCAL_ONLY = REPLAY_2025 || PRACTICE_AUCTION;
const ROOM_SEASON = REPLAY_2025 ? 2025 : 2026;
const UNLOCK_SESSION_KEY = REPLAY_2025 ? "tb25ReplayUnlocked" : PRACTICE_AUCTION ? "tb26PracticeUnlocked" : "tb26Unlocked";
const currency = (value) => `$${Math.round(Number(value) || 0).toLocaleString("en-US")}`;
const signed = (value) => `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}`;
const dateTime = (value) => (value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
const shortDate = (value) => (value ? new Date(value).toLocaleDateString([], { month: "short", day: "numeric" }) : "—");
const ACCESS_CHECK_TIMEOUT_MS = 1800;
const PACK_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const STATUS_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const NEWS_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const RESEARCH_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const MORNING_INTELLIGENCE_SCHEMA_VERSION = 1;
const LATEST_PACK_URL = REPLAY_2025 ? "/api/thunder-bowl/replay-2025/pack" : "/api/thunder-bowl/pack";
const LIVE_STATUS_URL = "/api/thunder-bowl/status";
const LIVE_NEWS_URL = "/api/thunder-bowl/news";
const LIVE_RESEARCH_URL = "/api/thunder-bowl/research";
const SAMPLE_PACK_URL = "./sample-draft-pack.json";

const loginView = byId("login-view");
const appView = byId("app-view");
const loginForm = byId("login-form");
const loginStatus = byId("login-status");
const accessCode = byId("access-code");
const playerRows = byId("player-rows");
const playerSearch = byId("player-search");
const positionFilter = byId("position-filter");
const saleForm = byId("sale-form");
const salePrice = byId("sale-price");
const saleTeam = byId("sale-team");
const saleStatus = byId("sale-status");
const undoSaleButton = byId("undo-sale");
const keeperAssignmentForm = byId("keeper-assignment-form");
const keeperPlayer = byId("keeper-player");
const keeperPlayerSearch = byId("keeper-player-search");
const keeperTeam = byId("keeper-team");
const keeperOperationStatus = byId("keeper-operation-status");
const undoKeeperActionButton = byId("undo-keeper-action");
const passKeeperTurnButton = byId("pass-keeper-turn");
const capTransferForm = byId("cap-transfer-form");
const capFromTeam = byId("cap-from-team");
const capToTeam = byId("cap-to-team");
const capTransferAmount = byId("cap-transfer-amount");
const capTransferPlayer = byId("cap-transfer-player");
const capReturnPlayer = byId("cap-return-player");
const practiceConsole = byId("practice-console");
const practiceStartButton = byId("practice-start");
const practiceBidButton = byId("practice-bid");
const practicePassButton = byId("practice-pass");
const practicePauseButton = byId("practice-pause");
const practiceStatus = byId("practice-status");
const playerIntelDialog = byId("player-intel-dialog");
const playerIntelForm = byId("player-intel-form");
const PLAYER_ANNOTATIONS_KEY = `thunder-bowl-${ROOM_SEASON}-player-annotations-v1`;

let deviceId;
let draftPack;
let events = [];
let draftState = replayDraft([]);
let selectedPlayerId = null;
let visiblePlayerIds = [];
let displayBoardUrl = null;
let syncInFlight = false;
let syncTimer = null;
let pollTimer = null;
let packRefreshTimer = null;
let packRefreshInFlight = false;
let statusRefreshTimer = null;
let statusRefreshInFlight = false;
let liveStatusSnapshot = null;
let liveStatusByPlayerId = new Map();
let liveStatusError = null;
let draftReadinessReport = null;
let lastRecoveryExportAt = null;
let keeperBoardRows = [];
let selectedKeeperEvidenceTeamId = "dogs-of-war";
let selectedKeeperMarketTeamId = "dogs-of-war";
let keeperWorkspaceMode = "sandbox";
let keeperSandboxEvents = [];
let keeperSandboxState = replayDraft([]);
let keeperScenario = null;
let teamASendsPlayerIds = new Set();
let teamBSendsPlayerIds = new Set();
let newsRefreshTimer = null;
let newsRefreshInFlight = false;
let liveNewsSnapshot = null;
let liveNewsError = null;
let researchRefreshTimer = null;
let researchRefreshInFlight = false;
let liveResearchSnapshot = null;
let liveResearchError = null;
let morningIntelligenceSnapshot = null;
let morningIntelligenceInFlight = false;
let toastTimer = null;
let currentView = "draft";
let selectedKeeperScenarioLabel = "Keep nobody";
let cloudReachable = true;
let ledgerGeneration = null;
let ledgerResetInFlight = false;
let ledgerStale = false;
let liveMarket = {
  displayPercent: 0,
  valuesByPlayerId: {},
  auctionVorpByPlayerId: {},
  positionImpacts: {},
};
let practiceSession = null;
let practiceTimer = null;
let practiceFinishing = false;
let practiceTickInFlight = false;
let practiceAutoStartTimer = null;
let playerAnnotations = {};
let intelPlayerId = null;
let priorityScenario = DEFAULT_PRIORITY_SCENARIO;
let priorityControlsDirty = false;
let cbsRosterSnapshot = null;
let cbsRosterChanges = null;
let humanRehearsalEvidence = null;
let personalBoardBackupEvidence = null;
let salesEntryMode = SALES_ENTRY_MODES.AUCTIONEER;
let salesEntryModeChanging = false;
const draftChannelName = REPLAY_2025 ? "thunder-bowl-2025-replay" : PRACTICE_AUCTION ? "thunder-bowl-2026-practice" : "thunder-bowl-2026";
const draftChannel = "BroadcastChannel" in window ? new BroadcastChannel(draftChannelName) : null;

function setStatus(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("is-error", error);
}

function showToast(message, error = false) {
  const toast = byId("global-status");
  toast.textContent = message;
  toast.classList.toggle("is-error", error);
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function errorMessage(error) {
  if (error instanceof RuleViolation) return error.message;
  return error?.message || "Something went wrong.";
}

function updateNetworkStatus() {
  const chip = byId("network-status");
  if (PRACTICE_AUCTION) {
    chip.textContent = navigator.onLine ? "Private practice · local ledger" : "Private practice · offline local";
    chip.classList.toggle("status-good", navigator.onLine);
    chip.classList.toggle("status-warning", !navigator.onLine);
    return;
  }
  if (REPLAY_2025) {
    chip.textContent = navigator.onLine ? "2025 replay · local ledger" : "2025 replay · offline local";
    chip.classList.toggle("status-good", navigator.onLine);
    chip.classList.toggle("status-warning", !navigator.onLine);
    return;
  }
  const online = navigator.onLine;
  chip.textContent = !online
    ? "Offline — local ledger active"
    : cloudReachable
      ? "Online"
      : "Cloud unavailable — local ledger active";
  chip.classList.toggle("status-good", online && cloudReachable);
  chip.classList.toggle("status-warning", !online || !cloudReachable);
  renderSalesEntryMode();
}

async function fetchProtectedDraftPack(conditional = true) {
  const priorEtag = conditional ? await getMeta("draftPackEtag") : null;
  const response = await fetch(LATEST_PACK_URL, {
    credentials: "same-origin",
    cache: "no-store",
    headers: priorEtag ? { "If-None-Match": priorEtag } : {},
    signal: AbortSignal.timeout(ACCESS_CHECK_TIMEOUT_MS * 2),
  });
  if (response.status === 304) return null;
  if (response.status === 401) throw new RuleViolation("SESSION_EXPIRED", "Sign in before downloading the latest private draft pack.");
  if (!response.ok) throw new Error(`The private ${ROOM_SEASON} ${REPLAY_2025 ? "replay" : PRACTICE_AUCTION ? "practice" : "draft"} pack could not be downloaded.`);
  const pack = validateDraftPack(await response.json());
  const etag = response.headers.get("etag");
  if (etag) await setMeta("draftPackEtag", etag);
  return pack;
}

async function loadPack(authenticated = false) {
  const localPack = await getMeta("draftPack");
  if (authenticated) {
    try {
      const currentPack = await fetchProtectedDraftPack(Boolean(localPack));
      if (currentPack) {
        await setMeta("draftPack", currentPack);
        return currentPack;
      }
      if (localPack) return validateDraftPack(localPack);
    } catch (error) {
      if (!localPack) throw error;
    }
  }
  if (localPack) return validateDraftPack(localPack);
  const response = await fetch(SAMPLE_PACK_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error("The offline interface sample could not be loaded.");
  const pack = validateDraftPack(await response.json());
  await setMeta("draftPack", pack);
  return pack;
}

function activeConfigEvent() {
  const voided = new Set(events.filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED).map((event) => event.payload.targetEventId));
  return events.find((event) => event.type === EVENT_TYPES.DRAFT_CONFIGURED && !voided.has(event.id)) || null;
}

async function ensureConfigurationEvent() {
  const desiredConfig = draftPack?.leagueConfig || DEFAULT_CONFIG;
  const currentConfig = activeConfigEvent();
  if (currentConfig && JSON.stringify(currentConfig.payload) === JSON.stringify(desiredConfig)) return;
  if (!canReplaceUnstartedConfiguration(events)) return;
  const replacements = [];
  if (currentConfig) {
    replacements.push(createEvent(EVENT_TYPES.EVENT_VOIDED, { targetEventId: currentConfig.id, reason: "Replaced by validated pre-draft configuration" }, { deviceId }));
  }
  replacements.push(createEvent(EVENT_TYPES.DRAFT_CONFIGURED, desiredConfig, { deviceId }));
  const candidate = [...events, ...replacements];
  replayDraft(candidate);
  events = candidate;
  await appendEvents(replacements);
}

async function ensureReplayFirstRoundKeepers() {
  if (!REPLAY_2025 || !canReplaceUnstartedConfiguration(events)) return;
  const selectionMetadata = draftPack.keeperCandidates.filter((candidate) => candidate.selectionRound !== undefined);
  if (!selectionMetadata.length) return;
  const firstRound = selectionMetadata
    .filter((candidate) => candidate.selectionRound === 1)
    .sort((left, right) => left.selectionPick.localeCompare(right.selectionPick));
  if (firstRound.length !== 12 || new Set(firstRound.map((candidate) => candidate.teamId)).size !== 12) {
    throw new RuleViolation("REPLAY_KEEPER_SEED_INVALID", "The replay pack must contain exactly one verified first-round keeper for every team.");
  }
  const playerById = new Map(draftPack.players.map((player) => [player.id, player]));
  const seedEvents = firstRound.map((candidate) => {
    const player = playerById.get(candidate.playerId);
    if (!player) throw new RuleViolation("REPLAY_KEEPER_PLAYER_MISSING", `Replay keeper ${candidate.playerName} is missing from the player pool.`);
    return createEvent(
      EVENT_TYPES.KEEPER_ASSIGNED,
      {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        teamId: candidate.teamId,
        salary: candidate.keeperSalary,
        keeperYear: candidate.keeperYear,
        selectionRound: candidate.selectionRound,
        source: `Verified 2025 first-round keeper ${candidate.selectionPick}`,
      },
      { deviceId },
    );
  });
  const candidateEvents = [...events, ...seedEvents];
  replayDraft(candidateEvents);
  events = candidateEvents;
  await appendEvents(seedEvents);
}

function teamOptions() {
  const selected = saleTeam.value || "dogs-of-war";
  let firstOpenTeamId = "";
  saleTeam.replaceChildren();
  for (const team of draftState.config.teams) {
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = `${team.name} — ${currency(draftState.teams[team.id]?.cash ?? team.startingCap)}`;
    option.disabled = (draftState.teams[team.id]?.openSlots ?? 1) <= 0;
    if (!option.disabled && !firstOpenTeamId) firstOpenTeamId = team.id;
    saleTeam.append(option);
  }
  saleTeam.value = draftState.teams[selected]?.openSlots > 0 ? selected : firstOpenTeamId;
}

function availablePlayers() {
  return draftPack.players.filter((player) => !draftState.draftedPlayers[player.id]);
}

function computeLiveMarket() {
  return calculateAuctionDemandMarket(draftPack, draftState);
}

function livePlayerValues(player) {
  const demandValue = liveMarket.valuesByPlayerId[player.id];
  return {
    marketValue: demandValue ?? player.marketValue,
    maxBid: liveMarket.bidCeilingsByPlayerId[player.id] ?? player.maxBid,
  };
}

function annotationFor(playerId) {
  return playerAnnotations[playerId] || null;
}

function loadPlayerAnnotations() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYER_ANNOTATIONS_KEY) || "{}");
    playerAnnotations = validatePlayerAnnotations(saved, draftPack.players.map((player) => player.id));
  } catch {
    playerAnnotations = {};
    localStorage.removeItem(PLAYER_ANNOTATIONS_KEY);
  }
}

function persistPlayerAnnotations({ checkReadiness = true } = {}) {
  localStorage.setItem(PLAYER_ANNOTATIONS_KEY, JSON.stringify(playerAnnotations));
  personalBoardBackupEvidence = null;
  void setMeta("personalBoardBackupEvidence", null);
  setStatus(byId("personal-board-status"), "Personal board changed. Download a new private JSON before moving it to the MacBook.");
  if (checkReadiness && draftPack) void runDraftReadinessCheck({ announce: false });
}

function renderPersonalBoardPortability() {
  const decisions = Object.values(playerAnnotations).filter((annotation) => !isEmptyAnnotation(annotation));
  byId("personal-board-total").textContent = String(decisions.length);
  byId("personal-board-targets").textContent = String(decisions.filter((annotation) => annotation.tag === "target").length);
  byId("personal-board-avoids").textContent = String(decisions.filter((annotation) => annotation.tag === "avoid").length);
  byId("personal-board-prices").textContent = String(decisions.filter((annotation) => annotation.stealPrice !== null || annotation.personalMax !== null).length);
  byId("personal-board-notes").textContent = String(decisions.filter((annotation) => annotation.note).length);
  byId("personal-board-backup-state").textContent = decisions.length === 0
    ? "No backup needed"
    : personalBoardBackupEvidence
      ? `${personalBoardBackupEvidence.action === "import" ? "Restored" : "Backed up"} ${dateTime(personalBoardBackupEvidence.recordedAt)}`
      : "Needs private JSON";
}

function effectivePlayerBidLimit(player) {
  if (!player) return 0;
  return personalBidLimit({
    modelMax: livePlayerValues(player).maxBid,
    legalMax: draftState.teams[USER_TEAM_ID]?.legalMaxBid || 0,
    annotation: annotationFor(player.id),
  });
}

function playerDecisionLabel(annotation) {
  return annotation?.tag === "target" ? "Target" : annotation?.tag === "avoid" ? "Avoid" : "Neutral";
}

function priorityForPlayer(player) {
  return priorityProjection(player, priorityScenario, draftPack?.weeklyContext);
}

function priorityScenarioFromControls() {
  return validatePriorityScenario({
    mode: byId("priority-experimental-mode").checked ? "experimental" : "baseline",
    baseline: byId("priority-baseline-weight").value,
    division: byId("priority-division-weight").value,
    playoffs: byId("priority-playoff-weight").value,
  });
}

function syncPriorityControls() {
  byId("priority-experimental-mode").checked = priorityScenario.mode === "experimental";
  byId("priority-baseline-weight").value = priorityScenario.baseline.toFixed(2);
  byId("priority-division-weight").value = priorityScenario.division.toFixed(2);
  byId("priority-playoff-weight").value = priorityScenario.playoffs.toFixed(2);
}

function renderPrioritySettings() {
  const context = draftPack?.weeklyContext;
  const controls = [
    byId("priority-experimental-mode"),
    byId("priority-baseline-weight"),
    byId("priority-division-weight"),
    byId("priority-playoff-weight"),
    byId("priority-use-suggested"),
    byId("priority-apply"),
  ];
  controls.forEach((control) => { control.disabled = !context; });
  byId("priority-context-status").textContent = context ? "Loaded · experimental only" : REPLAY_2025 ? "Not used in replay" : "Not loaded";
  byId("priority-context-coverage").textContent = context
    ? `${context.coveredPlayers}/${draftPack.players.length} players · ${(context.top168Coverage * 100).toFixed(1)}% of auction top 168`
    : "—";
  byId("priority-division-weeks").textContent = context?.divisionWeeks.map((week) => `W${week}`).join(" / ") || "—";
  byId("priority-playoff-weeks").textContent = context?.playoffWeeks.map((week) => `W${week}`).join(" / ") || "—";
  if (!priorityControlsDirty) syncPriorityControls();
}

async function savePriorityScenario(nextScenario, message) {
  priorityScenario = validatePriorityScenario(nextScenario);
  priorityControlsDirty = false;
  await setMeta("priorityWeightScenario", priorityScenario);
  renderAll();
  setStatus(byId("priority-settings-status"), message);
}

function renderCbsBridgeStatus() {
  byId("cbs-capture-time").textContent = cbsRosterSnapshot ? dateTime(cbsRosterSnapshot.capturedAt) : "Not captured";
  byId("cbs-capture-coverage").textContent = cbsRosterSnapshot
    ? `${cbsRosterSnapshot.teamCount} teams · ${cbsRosterSnapshot.playerCount} players`
    : "—";
  byId("cbs-capture-changes").textContent = !cbsRosterChanges
    ? "—"
    : cbsRosterChanges.baseline
      ? "Baseline saved"
      : `${cbsRosterChanges.added} added · ${cbsRosterChanges.removed} removed · ${cbsRosterChanges.moved} moved · ${cbsRosterChanges.contractChanges} contract`;
  byId("export-cbs-rosters").disabled = !cbsRosterSnapshot;
  byId("capture-cbs-rosters").disabled = REPLAY_2025;
}

async function captureCbsRosters() {
  const button = byId("capture-cbs-rosters");
  const status = byId("cbs-capture-status");
  button.disabled = true;
  try {
    setStatus(status, "Opening one inactive CBS tab and validating all 12 team rosters…");
    const previous = cbsRosterSnapshot;
    const snapshot = validateCbsRosterSnapshot(await requestCbsRosterCapture());
    const changes = compareCbsRosterSnapshots(previous, snapshot);
    cbsRosterSnapshot = snapshot;
    cbsRosterChanges = changes;
    await setMeta("cbsRosterSnapshot", snapshot);
    renderCbsBridgeStatus();
    const changeCopy = changes.baseline
      ? `${snapshot.playerCount} current roster rows saved as the local baseline.`
      : `${changes.totalChanges} roster/contract change signal${changes.totalChanges === 1 ? "" : "s"} detected versus the prior local capture.`;
    setStatus(status, `${changeCopy} Evidence only: no keeper, value, or ledger field changed.`);
  } catch (error) {
    setStatus(status, errorMessage(error), true);
  } finally {
    button.disabled = false;
  }
}

function exportCbsRosterSnapshot() {
  if (!cbsRosterSnapshot) return;
  const stamp = cbsRosterSnapshot.capturedAt.slice(0, 10);
  downloadJSON(`thunder-bowl-cbs-rosters-${stamp}.json`, cbsRosterSnapshot);
  setStatus(byId("cbs-capture-status"), "Downloaded the validated local CBS snapshot. No CBS or draft data was modified.");
}

function cbsBaseInjury(value) {
  const injury = String(value || "No injury evidence available");
  const marker = "; CBS: ";
  return injury.startsWith("Sleeper:") && injury.includes(marker) ? injury.slice(injury.indexOf(marker) + marker.length) : injury;
}

function freshStatusDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 14 * 86_400_000;
}

function liveInjuryEvidence(player) {
  if (!player) return "—";
  const base = cbsBaseInjury(player.injury);
  const live = liveStatusByPlayerId.get(player.id);
  if (live && live.freshness === "fresh" && ["critical", "high", "moderate"].includes(live.severity) && freshStatusDate(live.newsUpdated)) {
    const label = live.injuryStatus || live.status || "status flag";
    const bodyPart = live.injuryBodyPart ? ` â€” ${live.injuryBodyPart}` : "";
    return `Sleeper live: ${label}${bodyPart} (${live.severity}; updated ${live.newsUpdated.slice(0, 10)}); CBS: ${base}`;
  }
  if (player.injury.startsWith("Sleeper:") && /updated (\d{4}-\d{2}-\d{2})/.test(player.injury)) {
    const updated = player.injury.match(/updated (\d{4}-\d{2}-\d{2})/)?.[1];
    return freshStatusDate(updated) ? player.injury : base;
  }
  return base;
}

function liveAvailabilityDetails(player) {
  const live = player ? liveStatusByPlayerId.get(player.id) : null;
  if (!live) return "No newer practice or injury detail is mapped; use the current-news links below when online.";
  const details = [];
  if (live.practiceParticipation) details.push(`Practice: ${live.practiceParticipation}`);
  if (live.practiceDescription) details.push(live.practiceDescription);
  if (live.injuryBodyPart) details.push(`Body part: ${live.injuryBodyPart}`);
  if (live.injuryStartDate) details.push(`Start: ${live.injuryStartDate}`);
  if (live.injuryNotes) details.push(live.injuryNotes);
  return details.length ? details.join(" · ") : "No separate practice or injury-note detail in the current Sleeper record.";
}

function liveDepthRoleEvidence(player) {
  const live = player ? liveStatusByPlayerId.get(player.id) : null;
  if (live?.depthChartPosition && live.depthChartOrder) {
    return `Sleeper depth chart: ${live.depthChartPosition}${live.depthChartOrder} · supplemental, no value effect · status captured ${shortDate(liveStatusSnapshot?.capturedAt)}`;
  }
  if (live?.depthChartPosition) {
    return `Sleeper role: ${live.depthChartPosition}; numeric depth order is not supplied · supplemental, no value effect`;
  }
  return `Tier ${player.tier}, ${player.position}${player.sourceRank}; no numeric depth-chart slot is available in the saved evidence`;
}

function filteredPlayers() {
  const query = normalizePlayerSearch(playerSearch.value);
  const position = positionFilter.value;
  return availablePlayers()
    .filter((player) => position === "ALL" || player.position === position)
    .map((player) => ({ player, searchScore: playerSearchScore(player, query) }))
    .filter(({ searchScore }) => searchScore !== null)
    .sort((left, right) => {
      const searchDifference = query ? right.searchScore - left.searchScore : 0;
      const tagDifference = playerTagSort(annotationFor(left.player.id)?.tag) - playerTagSort(annotationFor(right.player.id)?.tag);
      return searchDifference || tagDifference || livePlayerValues(right.player).maxBid - livePlayerValues(left.player).maxBid || right.player.vbd - left.player.vbd || left.player.name.localeCompare(right.player.name);
    })
    .map(({ player }) => player);
}

function makePlayerCell(player) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.className = "player-select";
  button.type = "button";
  button.dataset.playerId = player.id;
  button.setAttribute("aria-label", `Select ${player.name}, ${player.position}, ${player.nflTeam}`);
  const name = document.createElement("span");
  name.className = "player-name";
  name.textContent = player.name;
  const meta = document.createElement("span");
  meta.className = "player-meta";
  meta.textContent = `${player.position} · ${player.nflTeam} · Tier ${player.tier}`;
  const personal = document.createElement("span");
  personal.className = "player-personal-line";
  const annotation = annotationFor(player.id);
  if (annotation?.tag && annotation.tag !== "neutral") {
    const chip = document.createElement("span");
    chip.className = `mini-personal-chip tag-${annotation.tag}`;
    chip.textContent = playerDecisionLabel(annotation);
    personal.append(chip);
  }
  if (annotation?.stealPrice !== null && annotation?.stealPrice !== undefined) {
    const chip = document.createElement("span");
    chip.className = "mini-personal-chip price-steal";
    chip.textContent = `Steal ≤ $${annotation.stealPrice}`;
    personal.append(chip);
  }
  if (annotation?.personalMax !== null && annotation?.personalMax !== undefined) {
    const chip = document.createElement("span");
    chip.className = "mini-personal-chip price-max";
    chip.textContent = `Max $${annotation.personalMax}`;
    personal.append(chip);
  }
  if (priorityScenario.mode === "experimental") {
    const priority = priorityForPlayer(player);
    const chip = document.createElement("span");
    if (priority.available) {
      chip.className = `mini-personal-chip ${priority.delta >= 0 ? "priority-positive" : "priority-negative"}`;
      chip.textContent = `P ${signed(priority.delta)}`;
      chip.title = `Experimental priority projection ${priority.projectedPoints.toFixed(1)}; no VBD or bid-limit effect`;
    } else {
      chip.className = "mini-personal-chip";
      chip.textContent = "P n/a";
      chip.title = "No validated weekly context for this player";
    }
    personal.append(chip);
  }
  button.append(name, meta, personal);
  cell.append(button);
  return cell;
}

function numberCell(text, className = "") {
  const cell = document.createElement("td");
  cell.className = `number ${className}`.trim();
  cell.textContent = text;
  return cell;
}

function renderPlayerPool() {
  const players = filteredPlayers();
  visiblePlayerIds = players.map((player) => player.id);
  const previousSelection = selectedPlayerId;
  if (!players.some((player) => player.id === selectedPlayerId)) {
    selectedPlayerId = players[0]?.id || null;
  }
  if (selectedPlayerId !== previousSelection) {
    salePrice.value = "";
  }
  playerRows.replaceChildren();
  for (const player of players) {
    const live = livePlayerValues(player);
    const row = document.createElement("tr");
    const annotation = annotationFor(player.id);
    row.className = `player-row${player.id === selectedPlayerId ? " is-selected" : ""}${annotation?.tag === "target" ? " is-target" : annotation?.tag === "avoid" ? " is-avoid" : ""}`;
    row.dataset.playerId = player.id;
    row.append(
      makePlayerCell(player),
      numberCell(signed(player.vbd), player.vbd > 0 ? "positive" : ""),
      numberCell(currency(live.marketValue), "gold"),
      numberCell(
        annotation?.tag === "avoid" ? "AVOID" : currency(effectivePlayerBidLimit(player)),
        annotation?.tag === "avoid" ? "avoid-price" : annotation?.personalMax !== null && annotation?.personalMax !== undefined ? "personal-price" : "",
      ),
    );
    playerRows.append(row);
  }
  byId("player-count").textContent = `${players.length} shown`;
  byId("empty-pool").hidden = players.length > 0;
}

function selectedPlayer() {
  return draftPack.players.find((player) => player.id === selectedPlayerId) || null;
}

function renderProjectionSources(player) {
  const container = byId("selected-projection-sources");
  container.replaceChildren();
  const sources = player?.projectionSources || [];
  if (!sources.length) {
    const item = document.createElement("li");
    item.className = "projection-source-empty";
    item.textContent = player ? `Current pack projection ${player.projectedPoints.toFixed(1)} · ${shortDate(draftPack.asOf)}` : "Select a player to compare sources.";
    container.append(item);
    return;
  }
  const primary = sources.find((source) => source.modelEffect === "primary_projection");
  for (const source of sources) {
    const delta = primary && source !== primary ? source.points - primary.points : null;
    const item = document.createElement("li");
    item.className = `projection-source-row projection-source-${source.role}${delta !== null && Math.abs(delta) >= 25 ? " is-disagreement" : ""}`;
    const heading = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = source.source;
    const badge = document.createElement("span");
    badge.textContent = source.role === "supplemental" ? "NO VALUE EFFECT" : source.role.toUpperCase();
    heading.append(name, badge);
    const points = document.createElement("b");
    points.textContent = source.points.toFixed(1);
    const detail = document.createElement("small");
    detail.textContent = `${shortDate(source.asOf)}${delta === null ? "" : ` · Δ ${signed(delta)}`} · ${source.note}`;
    item.append(heading, points, detail);
    container.append(item);
  }
}

function renderIntelProjectionSources(player) {
  const list = byId("intel-projection-sources");
  list.replaceChildren();
  for (const source of player.projectionSources || []) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${source.source} · ${shortDate(source.asOf)} · ${source.role}`;
    const points = document.createElement("strong");
    points.textContent = `${Number(source.points).toFixed(1)} pts`;
    const note = document.createElement("span");
    note.textContent = source.note;
    note.style.gridColumn = "1 / -1";
    item.append(label, points, note);
    list.append(item);
  }
  if (!list.childElementCount) {
    const item = document.createElement("li");
    item.textContent = "No separate source rows are available in this pack.";
    list.append(item);
  }
}

function normalizedNewsText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function playerNewsItems(player, snapshot = liveNewsSnapshot) {
  if (!player || !snapshot) return [];
  const playerName = normalizedNewsText(player.name);
  return snapshot.items
    .filter((item) => normalizedNewsText(`${item.title} ${item.description}`).includes(playerName))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, 3);
}

function renderIntelNews(player) {
  const list = byId("intel-news-list");
  const freshness = byId("intel-news-freshness");
  list.replaceChildren();
  const items = playerNewsItems(player);
  freshness.textContent = liveNewsSnapshot
    ? `RotoWire archive checked ${dateTime(liveNewsSnapshot.capturedAt)} · ${liveNewsSnapshot.archiveItemCount} saved item${liveNewsSnapshot.archiveItemCount === 1 ? "" : "s"}${liveNewsSnapshot.staleFallback ? " - saved fallback" : ""}`
    : liveNewsError
      ? "Live feed unavailable - saved research links remain"
      : "Checking source-linked feed";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "intel-news-empty";
    empty.textContent = liveNewsSnapshot
      ? `No item in the saved RotoWire archive mentions ${player.name}. Select Refresh latest news to check again inside Thunder Bowl.`
      : `No saved headline is available for ${player.name}. Research links remain available online.`;
    list.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("li");
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const published = document.createElement("time");
    published.dateTime = item.publishedAt;
    published.textContent = shortDate(item.publishedAt);
    link.append(title, published);
    const description = document.createElement("p");
    description.textContent = item.description;
    const source = document.createElement("small");
    source.textContent = "Provided by RotoWire · open source article only if you want the full story";
    row.append(link, description, source);
    list.append(row);
  }
}

function canonicalResearchTeam(value) {
  return ({ ARZ: "ARI", JAC: "JAX", LA: "LAR" })[String(value || "").toUpperCase()] || String(value || "").toUpperCase();
}

function validateResearchSnapshot(input) {
  if (!input || input.schemaVersion !== 2 || input.modelEffect !== "none" || !Number.isFinite(Date.parse(input.capturedAt)) || input.refreshMinutes !== 30) {
    throw new Error("The FBG/CBS research response failed its source contract.");
  }
  if (input.depthChart?.source !== "Footballguys Depth Charts" || input.depthChart?.teamCount !== 32 || !Array.isArray(input.depthChart?.entries) || input.depthChart.entries.length < 400) {
    throw new Error("The Footballguys depth-chart response failed coverage validation.");
  }
  if (input.cbsNews?.source !== "CBS Sports NFL Player News" || input.cbsNews?.archiveWindowDays !== 45 || !Number.isSafeInteger(input.cbsNews?.currentItemCount) || input.cbsNews.currentItemCount < 1 || !Number.isSafeInteger(input.cbsNews?.archiveItemCount) || input.cbsNews.archiveItemCount !== input.cbsNews?.items?.length || !Array.isArray(input.cbsNews?.items)) throw new Error("The CBS player-news response failed coverage validation.");
  for (const entry of input.depthChart.entries) {
    if (!entry.playerName || !entry.nflTeam || !["QB", "RB", "WR", "TE", "K"].includes(entry.position) || !Number.isSafeInteger(entry.depthOrder) || entry.depthOrder < 1 || new URL(entry.url).hostname.replace(/^www\./, "") !== "footballguys.com") {
      throw new Error("The Footballguys depth-chart response contains an invalid player entry.");
    }
  }
  for (const item of input.cbsNews.items) {
    if (!item.id || !item.playerName || !item.title || !item.description || !item.ageText || !Number.isFinite(Date.parse(item.firstSeenAt)) || !Number.isFinite(Date.parse(item.lastSeenAt)) || new URL(item.url).hostname.replace(/^www\./, "") !== "cbssports.com") throw new Error("The CBS player-news response contains an invalid item.");
  }
  for (const forbidden of ["projectedPoints", "weeklyProjection", "weeklyContext", "vbd", "intrinsicValue", "marketValue", "maxBid", "keeperValue", "recommendedBid"]) {
    if (forbidden in input || input.depthChart.entries.some((entry) => forbidden in entry) || input.cbsNews.items.some((item) => forbidden in item)) throw new Error(`The internal research response attempted to supply forbidden value field ${forbidden}.`);
  }
  return input;
}

function playerCbsNewsItems(player, snapshot = liveResearchSnapshot) {
  if (!player || !snapshot) return [];
  const name = normalizedNewsText(player.name);
  return snapshot.cbsNews.items.filter((item) => normalizedNewsText(item.playerName) === name).slice(0, 3);
}

function playerFbgDepth(player, snapshot = liveResearchSnapshot) {
  if (!player || !snapshot) return { selected: null, group: [] };
  const name = normalizedNewsText(player.name);
  const team = canonicalResearchTeam(player.nflTeam);
  const position = player.position === "PK" ? "K" : player.position;
  const group = snapshot.depthChart.entries
    .filter((entry) => canonicalResearchTeam(entry.nflTeam) === team && entry.position === position)
    .sort((left, right) => left.depthOrder - right.depthOrder);
  return { selected: group.find((entry) => normalizedNewsText(entry.playerName) === name) || null, group };
}

function renderIntelCbsNews(player) {
  const list = byId("intel-cbs-news-list");
  const freshness = byId("intel-cbs-news-freshness");
  list.replaceChildren();
  const items = playerCbsNewsItems(player);
  freshness.textContent = liveResearchSnapshot
    ? `CBS archive checked ${dateTime(liveResearchSnapshot.capturedAt)} · ${liveResearchSnapshot.cbsNews.archiveItemCount} saved item${liveResearchSnapshot.cbsNews.archiveItemCount === 1 ? "" : "s"}${liveResearchSnapshot.staleFallback ? " · saved fallback" : ""}`
    : liveResearchError ? "CBS refresh unavailable · saved evidence remains" : "CBS snapshot not downloaded";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "intel-news-empty";
    empty.textContent = liveResearchSnapshot
      ? `The saved CBS archive has no item naming ${player.name}. Select Refresh CBS news to check again inside Thunder Bowl.`
      : `No saved CBS item is available for ${player.name}.`;
    list.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("li");
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const age = document.createElement("time");
    age.textContent = item.ageText;
    link.append(title, age);
    const description = document.createElement("p");
    description.textContent = item.description;
    const source = document.createElement("small");
    source.textContent = `${item.byline} · CBS Sports source article is optional`;
    row.append(link, description, source);
    list.append(row);
  }
}

function renderIntelFbgDepth(player) {
  const container = byId("intel-fbg-depth");
  const freshness = byId("intel-fbg-depth-freshness");
  container.replaceChildren();
  freshness.textContent = liveResearchSnapshot
    ? `${liveResearchSnapshot.depthChart.updatedText || `FBG checked ${dateTime(liveResearchSnapshot.capturedAt)}`}${liveResearchSnapshot.staleFallback ? " · saved fallback" : ""}`
    : liveResearchError ? "FBG refresh unavailable · saved evidence remains" : "FBG snapshot not downloaded";
  const { selected, group } = playerFbgDepth(player);
  if (!selected) {
    container.textContent = liveResearchSnapshot
      ? `${player.name} is not matched on Footballguys' current ${canonicalResearchTeam(player.nflTeam)} ${player.position} depth chart.`
      : "Select Refresh FBG depth chart to download the current chart inside Thunder Bowl.";
    return;
  }
  const summary = document.createElement("strong");
  summary.textContent = `${selected.position}${selected.depthOrder}${selected.starter ? " · listed starter" : ""}${selected.status ? ` · ${selected.status}` : ""}`;
  const list = document.createElement("ol");
  for (const entry of group.slice(0, 8)) {
    const item = document.createElement("li");
    item.className = entry === selected ? "is-selected" : "";
    item.textContent = `${entry.playerName}${entry.starter ? " — starter" : ""}${entry.status ? ` (${entry.status})` : ""}`;
    list.append(item);
  }
  const source = document.createElement("small");
  source.textContent = `Footballguys ${canonicalResearchTeam(selected.nflTeam)} ${selected.position} order · saved for offline use · no value effect`;
  container.append(summary, list, source);
}

function intelFormAnnotation() {
  const tag = playerIntelForm.querySelector('input[name="playerTag"]:checked')?.value || "neutral";
  return createPlayerAnnotation({
    tag,
    stealPrice: byId("intel-steal-price").value,
    personalMax: byId("intel-personal-max").value,
    note: byId("intel-personal-note").value,
  });
}

function updateIntelEffectiveLimit() {
  const player = draftPack?.players.find((row) => row.id === intelPlayerId);
  if (!player) return;
  try {
    const annotation = intelFormAnnotation();
    const limit = personalBidLimit({
      modelMax: livePlayerValues(player).maxBid,
      legalMax: draftState.teams[USER_TEAM_ID]?.legalMaxBid || 0,
      annotation,
    });
    byId("intel-effective-limit").textContent = annotation.tag === "avoid"
      ? `Effective bid limit: AVOID — bidding is blocked until you change the tag`
      : `Effective bid limit right now: ${currency(limit)} (lowest of model, legal, and personal max)`;
    setStatus(byId("player-intel-status"), "");
  } catch (error) {
    byId("intel-effective-limit").textContent = "Effective bid limit: fix the highlighted personal prices";
    setStatus(byId("player-intel-status"), errorMessage(error), true);
  }
}

function renderPlayerIntel() {
  const player = draftPack?.players.find((row) => row.id === intelPlayerId);
  if (!player) return;
  const live = livePlayerValues(player);
  const update = liveStatusByPlayerId.get(player.id);
  const annotation = annotationFor(player.id) || createPlayerAnnotation();
  byId("player-intel-name").textContent = player.name;
  byId("player-intel-meta").textContent = `${player.position} · ${player.nflTeam} · Tier ${player.tier}`;
  byId("intel-model-max").textContent = currency(live.maxBid);
  byId("intel-market").textContent = currency(live.marketValue);
  byId("intel-vbd").textContent = signed(player.vbd);
  byId("intel-projected").textContent = Number(player.projectedPoints).toFixed(1);
  byId("intel-injury").textContent = liveInjuryEvidence(player);
  byId("intel-injury-detail").textContent = liveAvailabilityDetails(player);
  byId("intel-live-freshness").textContent = update?.newsUpdated
    ? `Sleeper status timestamp ${dateTime(update.newsUpdated)} · ${update.freshness}`
    : liveStatusError
      ? `Live refresh unavailable · ${liveStatusError}`
      : "Saved draft-pack evidence; no newer player status mapped";
  byId("intel-depth-role").textContent = liveDepthRoleEvidence(player);
  byId("intel-sos").textContent = player.sos || "No schedule evidence available";
  byId("intel-rank").textContent = `Tier ${player.tier} · ${player.position}${player.sourceRank}`;
  const newestSource = (player.projectionSources || []).map((source) => source.asOf).sort().at(-1);
  byId("intel-source-date").textContent = newestSource ? dateTime(newestSource) : dateTime(draftPack.asOf);
  byId("intel-pack-notes").textContent = player.notes || "No pack notes.";
  renderIntelProjectionSources(player);
  renderIntelNews(player);
  renderIntelCbsNews(player);
  renderIntelFbgDepth(player);
  playerIntelForm.querySelector(`input[name="playerTag"][value="${annotation.tag}"]`).checked = true;
  byId("intel-steal-price").value = annotation.stealPrice ?? "";
  byId("intel-personal-max").value = annotation.personalMax ?? "";
  byId("intel-personal-note").value = annotation.note;
  updateIntelEffectiveLimit();
}

function openPlayerIntel(playerId) {
  if (!draftPack?.players.some((player) => player.id === playerId)) return;
  intelPlayerId = playerId;
  selectPlayer(playerId);
  renderPlayerIntel();
  if (!playerIntelDialog.open) playerIntelDialog.showModal();
}

function closePlayerIntel() {
  if (playerIntelDialog.open) playerIntelDialog.close();
  intelPlayerId = null;
}

async function refreshPlayerNewsInApp() {
  const player = draftPack?.players.find((row) => row.id === intelPlayerId);
  const button = byId("intel-news-link");
  if (!player) return;
  if (REPLAY_2025) {
    renderIntelNews(player);
    setStatus(byId("player-intel-status"), "Historical replay keeps current-season news disabled to avoid hindsight. The button stays inside Thunder Bowl and no page was opened.");
    return;
  }
  if (!navigator.onLine) {
    renderIntelNews(player);
    setStatus(byId("player-intel-status"), "Offline: showing the last saved in-app news snapshot. No external page was opened.");
    return;
  }
  button.disabled = true;
  button.textContent = "Checking news…";
  setStatus(byId("player-intel-status"), `Checking current source-linked news for ${player.name} inside Thunder Bowl…`);
  try {
    await refreshLiveNews();
    renderPlayerIntel();
    const items = playerNewsItems(player);
    if (liveNewsError) {
      setStatus(byId("player-intel-status"), `Latest-news check failed safely: ${liveNewsError}. Saved in-app news remains visible.`, true);
    } else {
      setStatus(byId("player-intel-status"), items.length
        ? `${items.length} current source-linked item${items.length === 1 ? "" : "s"} shown above. You stayed inside Thunder Bowl.`
        : `The latest feed was checked, but it has no item naming ${player.name}. You stayed inside Thunder Bowl.`);
    }
  } finally {
    button.disabled = false;
    button.textContent = "Refresh latest news";
  }
}

async function refreshResearchInApp(kind) {
  const player = draftPack?.players.find((row) => row.id === intelPlayerId);
  const isCbs = kind === "cbs";
  const button = byId(isCbs ? "intel-cbs-link" : "intel-fbg-link");
  const idleLabel = isCbs ? "Refresh CBS news" : "Refresh FBG depth chart";
  if (!player) return;
  if (REPLAY_2025) {
    renderPlayerIntel();
    setStatus(byId("player-intel-status"), `Historical replay keeps current-season ${isCbs ? "CBS news" : "Footballguys depth charts"} disabled to avoid hindsight. No page was opened.`);
    return;
  }
  if (!navigator.onLine) {
    renderPlayerIntel();
    setStatus(byId("player-intel-status"), `Offline: showing the saved in-app ${isCbs ? "CBS news" : "Footballguys depth chart"}. No page was opened.`);
    return;
  }
  button.disabled = true;
  button.textContent = isCbs ? "Checking CBS…" : "Checking FBG…";
  setStatus(byId("player-intel-status"), `Downloading current ${isCbs ? "CBS player news" : "Footballguys depth-chart evidence"} inside Thunder Bowl…`);
  try {
    await refreshLiveResearch();
    renderPlayerIntel();
    if (liveResearchError) {
      setStatus(byId("player-intel-status"), `${isCbs ? "CBS news" : "FBG depth-chart"} refresh failed safely: ${liveResearchError}. Saved in-app evidence remains visible.`, true);
      return;
    }
    if (isCbs) {
      const count = playerCbsNewsItems(player).length;
      setStatus(byId("player-intel-status"), count
        ? `${count} current CBS item${count === 1 ? "" : "s"} shown above. You stayed inside Thunder Bowl.`
        : `CBS was refreshed, but its current ${player.position} pages have no item naming ${player.name}. You stayed inside Thunder Bowl.`);
    } else {
      const { selected } = playerFbgDepth(player);
      setStatus(byId("player-intel-status"), selected
        ? `Footballguys now lists ${player.name} as ${selected.position}${selected.depthOrder}${selected.starter ? " and a starter" : ""}. You stayed inside Thunder Bowl.`
        : `Footballguys was refreshed, but ${player.name} is not matched on the current team depth chart. You stayed inside Thunder Bowl.`);
    }
  } finally {
    button.disabled = false;
    button.textContent = idleLabel;
  }
}

function savePlayerIntel(event) {
  event.preventDefault();
  if (!intelPlayerId) return;
  const prior = playerAnnotations;
  try {
    const annotation = intelFormAnnotation();
    playerAnnotations = { ...playerAnnotations };
    if (isEmptyAnnotation(annotation)) delete playerAnnotations[intelPlayerId];
    else playerAnnotations[intelPlayerId] = annotation;
    persistPlayerAnnotations();
    renderAll();
    renderPlayerIntel();
    setStatus(byId("player-intel-status"), `Saved ${playerDecisionLabel(annotation)} decision on this laptop.`);
    showToast(`${playerDecisionLabel(annotation)} decision saved for ${byId("player-intel-name").textContent}.`);
  } catch (error) {
    playerAnnotations = prior;
    setStatus(byId("player-intel-status"), errorMessage(error), true);
  }
}

function clearPlayerIntel() {
  if (!intelPlayerId) return;
  try {
    playerAnnotations = { ...playerAnnotations };
    delete playerAnnotations[intelPlayerId];
    persistPlayerAnnotations();
    renderAll();
    renderPlayerIntel();
    setStatus(byId("player-intel-status"), "Personal tag, prices, and note cleared.");
  } catch (error) {
    setStatus(byId("player-intel-status"), errorMessage(error), true);
  }
}

function renderOpponentPressure(player, liveMarketValue, available = true) {
  const container = byId("selected-opponent-pressure");
  const summary = byId("opponent-pressure-summary");
  container.replaceChildren();
  if (!player) {
    summary.textContent = "Select a player to rank likely competition.";
    return;
  }
  if (!available) {
    summary.textContent = "Player already assigned · bidding pressure no longer applies.";
    return;
  }
  if (!draftPack.managerProfiles?.length) {
    summary.textContent = "Historical manager profiles are unavailable in this pack.";
    return;
  }
  const ranked = rankOpponentPressure({
    profiles: draftPack.managerProfiles,
    state: draftState,
    player,
    liveMarketValue,
  }).slice(0, 3);
  summary.textContent = ranked.length
    ? "Low-confidence advisory · winning purchases only"
    : `No opponent can legally reach the current ${currency(liveMarketValue)} market price.`;
  for (const opponent of ranked) {
    const item = document.createElement("li");
    item.className = "opponent-pressure-row";
    const heading = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = opponent.teamName;
    const badge = document.createElement("span");
    badge.className = `opponent-pressure-badge pressure-${opponent.label.toLowerCase()}`;
    badge.textContent = opponent.label;
    const index = document.createElement("b");
    index.textContent = `${opponent.pressureIndex.toFixed(2)}×`;
    heading.append(name, badge, index);
    const detail = document.createElement("small");
    const need = opponent.starterNeeded ? `needs ${player.position}` : `${player.position} starters filled`;
    const affinity = opponent.affinityMatch ? ` · ${player.nflTeam} affinity` : "";
    detail.textContent = `${player.position} history ${opponent.positionMultiplier.toFixed(2)}× · ${need} · ${currency(opponent.cash)}/${opponent.openSlots} slots${affinity}`;
    const sample = document.createElement("small");
    sample.className = "opponent-pressure-sample";
    sample.textContent = `${opponent.samplePurchases} purchases over ${opponent.sampleSeasons} seasons · no max-bid effect`;
    item.append(heading, detail, sample);
    container.append(item);
  }
}

function renderSelectedPlayer() {
  const player = selectedPlayer();
  const annotation = player ? annotationFor(player.id) : null;
  const available = player && !draftState.draftedPlayers[player.id];
  byId("selected-availability").textContent = available ? "Available" : "Unavailable";
  byId("selected-position").textContent = player ? `${player.position} · Tier ${player.tier}` : "—";
  byId("selected-player-name").textContent = player?.name || "Select a player";
  byId("selected-team-line").textContent = player ? `${player.nflTeam} · Source rank ${player.sourceRank}` : "Search or use the arrow keys.";
  const dogsMaximum = draftState.teams["dogs-of-war"]?.legalMaxBid ?? 0;
  const live = player ? livePlayerValues(player) : null;
  const personalMaximum = player ? effectivePlayerBidLimit(player) : null;
  byId("selected-max-bid").textContent = personalMaximum === null ? "—" : annotation?.tag === "avoid" ? "AVOID" : currency(personalMaximum);
  const personalTag = byId("selected-personal-tag");
  personalTag.textContent = playerDecisionLabel(annotation);
  personalTag.className = `personal-tag tag-${annotation?.tag || "neutral"}`;
  byId("selected-intrinsic").textContent = player ? currency(player.intrinsicValue) : "—";
  byId("selected-market").textContent = player ? currency(live.marketValue) : "—";
  byId("selected-projected").textContent = player ? player.projectedPoints.toFixed(1) : "—";
  const context = player ? buildDecisionContext({
    selectedPlayer: player,
    availablePlayers: availablePlayers(),
    valueFor: (candidate) => effectivePlayerBidLimit(candidate),
  }) : null;
  byId("selected-tier-supply").textContent = context ? `${context.sameTierRemaining} left` : "—";
  byId("selected-next-alternative").textContent = context?.nextAlternative
    ? `${context.nextAlternative.name} · ${currency(context.alternativeValue)}`
    : player ? "No lower tier" : "—";
  byId("selected-tier-cliff").textContent = context?.nextAlternative ? currency(context.maxBidCliff) : "—";
  const disagreement = context?.disagreement;
  byId("selected-source-spread").textContent = disagreement?.available
    ? `${disagreement.spread.toFixed(1)} pts · ${disagreement.level.toUpperCase()}`
    : player ? "One source" : "—";
  byId("selected-source-spread").classList.toggle("evidence-alert", disagreement?.level === "high");
  byId("selected-context-detail").textContent = context?.nextAlternative
    ? `${context.nextAlternative.position}${context.nextAlternative.sourceRank}, Tier ${context.nextAlternative.tier}, is the next available lower-tier option. The cliff compares today's effective bid limits; source spread is ${disagreement?.available ? `${disagreement.lowSource} to ${disagreement.highSource}` : "unavailable"}. No value authority.`
    : player ? "No lower-tier alternative remains in the current position pool. Display-only evidence; no value authority." : "Dynamic pool evidence only; it never changes VBD, prices, or bid limits.";
  const priority = player ? priorityForPlayer(player) : null;
  const priorityCard = byId("selected-priority-card");
  priorityCard.classList.toggle("is-experimental", priorityScenario.mode === "experimental");
  if (!player) {
    byId("selected-priority").textContent = "Baseline —";
    byId("selected-priority-detail").textContent = "Select a player to inspect weekly timing.";
  } else if (priorityScenario.mode !== "experimental") {
    byId("selected-priority").textContent = `Baseline ${player.projectedPoints.toFixed(1)}`;
    byId("selected-priority-detail").textContent = "Experimental weighting is off; authoritative VBD and bid limits remain unchanged.";
  } else if (!priority.available) {
    byId("selected-priority").textContent = "No weekly context";
    byId("selected-priority-detail").textContent = `Baseline ${player.projectedPoints.toFixed(1)} remains authoritative; no adjustment was invented.`;
  } else {
    byId("selected-priority").textContent = `${priority.projectedPoints.toFixed(1)} (${signed(priority.delta)})`;
    byId("selected-priority-detail").textContent = `Experimental only · ordinary ${priorityScenario.baseline.toFixed(2)}× · division ${priorityScenario.division.toFixed(2)}× · playoffs ${priorityScenario.playoffs.toFixed(2)}× · no VBD, price, or max-bid effect`;
  }
  byId("selected-vbd").textContent = player ? signed(player.vbd) : "—";
  byId("selected-rank").textContent = player ? `${player.position}${player.sourceRank}` : "—";
  const injuryEvidence = byId("selected-injury");
  injuryEvidence.textContent = liveInjuryEvidence(player);
  injuryEvidence.classList.toggle("evidence-alert", injuryEvidence.textContent.startsWith("Sleeper"));
  byId("selected-sos").textContent = player?.sos || "—";
  byId("selected-notes").textContent = annotation?.note
    ? `Your note: ${annotation.note} · Pack: ${player?.notes || "No additional pack note."}`
    : player?.notes || "Player evidence and decision notes appear here.";
  renderProjectionSources(player);
  renderOpponentPressure(player, live?.marketValue || 1, available);
  byId("sale-player").value = player?.name || "";
  byId("sale-player-id").value = player?.id || "";
  if (player && !salePrice.value) salePrice.value = String(Math.max(1, Math.round(personalMaximum || live.maxBid || 1)));
}

function renderNeeds() {
  const team = draftState.teams["dogs-of-war"];
  const container = byId("dogs-needs");
  container.replaceChildren();
  for (const position of POSITIONS) {
    const chip = document.createElement("span");
    chip.className = "need-chip";
    chip.textContent = `${position} ${team.positionCounts[position]}/${draftState.config.starterRequirements[position]}`;
    container.append(chip);
  }
}

function renderMetrics() {
  const dogs = draftState.teams["dogs-of-war"];
  const openSlots = Object.values(draftState.teams).reduce((sum, team) => sum + team.openSlots, 0);
  byId("dogs-cash").textContent = currency(dogs.cash);
  byId("dogs-slots").textContent = `${dogs.openSlots} open slot${dogs.openSlots === 1 ? "" : "s"}`;
  byId("dogs-legal-max").textContent = currency(dogs.legalMaxBid);
  byId("room-cash").textContent = currency(draftState.totalCash);
  byId("room-slots").textContent = `${openSlots} open slots`;

  byId("market-signal").textContent = `${liveMarket.displayPercent >= 0 ? "+" : ""}${liveMarket.displayPercent.toFixed(1)}%`;
  byId("market-detail").textContent = draftPack.status === "production"
    ? "Market estimate: historical demand + live cash"
    : "Market estimate: historical demand + practice cash";

  const nominator = draftState.currentNominatorTeamId ? draftState.teams[draftState.currentNominatorTeamId] : null;
  byId("current-nominator").textContent = nominator?.name || "Draft complete";
  byId("next-nomination-line").textContent = nominator?.name || "Draft complete";
  const verified = draftState.config.nominationOrderStatus === "verified";
  byId("nomination-detail").textContent = verified ? "Full order verified" : "Order prefix verified only";
  byId("nomination-warning").textContent = verified
    ? "The full 2026 snake order is locked."
    : `Only the first ${draftState.config.verifiedPrefixCount} order positions are verified; the next position is provisional.`;

  if (draftState.lastSale) {
    byId("last-sale-price").textContent = currency(draftState.lastSale.amount);
    byId("last-sale-detail").textContent = `${draftState.lastSale.playerName} · ${draftState.lastSale.teamName}`;
  } else {
    byId("last-sale-price").textContent = "—";
    byId("last-sale-detail").textContent = "No auction sale recorded";
  }
}

function renderPackStatus() {
  const production = draftPack.status === "production";
  byId("sample-warning").hidden = production;
  if (!production) {
    if (REPLAY_2025) {
      byId("pack-warning-title").textContent = "2025 replay sandbox · local only.";
      byId("pack-warning-copy").textContent = "The 12 actual first-round keepers are loaded; every second-round choice is deliberately left open for beta testing. Final 2025 outcomes are hindsight-only and never affect the 2026 model or ledger.";
    } else {
    const illustrative = draftPack.status === "illustrative";
    byId("pack-warning-title").textContent = illustrative ? "Illustrative values only." : "Current practice pack.";
    byId("pack-warning-copy").textContent = illustrative
      ? "The interface is live; the displayed player projections and prices are placeholders until the approved 2026 draft pack is imported."
      : "Current Footballguys and CBS projections are loaded with FantasyPros as a dated, value-neutral second opinion. The 2026 schedule and divisions are loaded; values remain provisional until keeper, injury, source-refresh, and schedule-weighting gates pass.";
    }
  }
  const packChip = byId("pack-status");
  packChip.textContent = production ? "Production pack" : `${draftPack.status[0].toUpperCase()}${draftPack.status.slice(1)} pack`;
  packChip.classList.toggle("status-warning", !production);
  packChip.classList.toggle("status-good", production);
  byId("pack-name").textContent = draftPack.packId;
  byId("pack-detail-status").textContent = draftPack.status;
  byId("pack-as-of").textContent = dateTime(draftPack.asOf);
  byId("pack-player-total").textContent = String(draftPack.players.length);
  byId("pack-source-total").textContent = String(draftPack.sources.length);
  byId("status-as-of").textContent = REPLAY_2025
    ? "Not used in replay"
    : liveStatusSnapshot?.capturedAt
    ? dateTime(liveStatusSnapshot.capturedAt)
    : liveStatusError
      ? `Unavailable — ${liveStatusError}`
      : "Saved pack";

  const schedule = draftPack.scheduleContext;
  byId("schedule-status").textContent = schedule ? "Loaded - candidate held" : REPLAY_2025 ? "Not used in replay" : "Not loaded";
  byId("schedule-division").textContent = schedule?.division || "â€”";
  byId("schedule-rivals").textContent = schedule?.divisionRivals?.join(" / ") || "â€”";
  byId("schedule-division-weeks").textContent = schedule?.divisionWeeks
    ?.map((row) => `W${row.week} ${row.opponent}`)
    .join(" / ") || "â€”";
  byId("schedule-week-14").textContent = schedule?.randomWeek14Opponent || "â€”";
  byId("schedule-playoffs").textContent = schedule?.playoffWeeks?.map((week) => `W${week}`).join(" / ") || "â€”";

  renderPrioritySettings();
  renderCbsBridgeStatus();
  renderMorningIntelligenceStatus();
  renderHumanRehearsal();

  const list = byId("nomination-order-list");
  list.replaceChildren();
  draftState.config.nominationOrder.forEach((teamId, index) => {
    const item = document.createElement("li");
    item.textContent = draftState.teams[teamId].name;
    const evidence = nominationOrderEvidence(draftState.config, index);
    if (evidence === "verified") item.className = "is-verified";
    else if (evidence === "provisional") item.className = "is-provisional";
    list.append(item);
  });
}

function humanRehearsalInputs() {
  return [...document.querySelectorAll("[data-human-rehearsal]")];
}

function checkedHumanRehearsalItems() {
  return Object.fromEntries(humanRehearsalInputs().map((input) => [input.dataset.humanRehearsal, input.checked]));
}

function refreshHumanRehearsalControls() {
  const inputs = humanRehearsalInputs();
  const completed = inputs.filter((input) => input.checked).length;
  const chip = byId("human-rehearsal-progress");
  chip.textContent = `${completed} of ${HUMAN_REHEARSAL_ITEMS.length}`;
  chip.classList.remove("status-good", "status-warning", "status-danger");
  chip.classList.add(completed === HUMAN_REHEARSAL_ITEMS.length ? "status-good" : "status-warning");
  byId("seal-human-rehearsal").disabled = LOCAL_ONLY || completed !== HUMAN_REHEARSAL_ITEMS.length || inputs.every((input) => input.disabled);
}

function renderHumanRehearsal() {
  if (!draftPack) return;
  const status = humanRehearsalStatus(humanRehearsalEvidence, draftPack.leagueConfig);
  const inputs = humanRehearsalInputs();
  for (const input of inputs) {
    if (status.current) input.checked = true;
    else if (humanRehearsalEvidence) input.checked = false;
    input.disabled = status.current || LOCAL_ONLY;
  }
  byId("clear-human-rehearsal").disabled = !humanRehearsalEvidence || LOCAL_ONLY;
  refreshHumanRehearsalControls();
  const copy = LOCAL_ONLY
    ? "Return to the real 2026 rehearsal room to seal physical test evidence; training sandboxes cannot certify the second-screen cloud path."
    : status.current
      ? `${status.reason} Sealed ${dateTime(status.completedAt)}.`
      : `${status.reason} Check all seven actions after physically performing them, then seal the certificate.`;
  setStatus(byId("human-rehearsal-status"), copy, Boolean(humanRehearsalEvidence && !status.current));
}

async function sealHumanRehearsal() {
  const status = byId("human-rehearsal-status");
  try {
    if (LOCAL_ONLY) throw new RuleViolation("REHEARSAL_WRONG_ROOM", "Human rehearsal evidence can be sealed only from the real 2026 cloud rehearsal room.");
    humanRehearsalEvidence = createHumanRehearsalEvidence({
      checks: checkedHumanRehearsalItems(),
      leagueConfig: draftPack.leagueConfig,
    });
    await setMeta("humanRehearsalEvidence", humanRehearsalEvidence);
    renderHumanRehearsal();
    await runDraftReadinessCheck({ announce: false });
    setStatus(status, `Human-paced rehearsal sealed ${dateTime(humanRehearsalEvidence.completedAt)}. This is local attestation only; no draft or model data changed.`);
  } catch (error) {
    setStatus(status, errorMessage(error), true);
  }
}

async function clearHumanRehearsal() {
  humanRehearsalEvidence = null;
  await setMeta("humanRehearsalEvidence", null);
  for (const input of humanRehearsalInputs()) {
    input.checked = false;
    input.disabled = LOCAL_ONLY;
  }
  refreshHumanRehearsalControls();
  await runDraftReadinessCheck({ announce: false });
  setStatus(byId("human-rehearsal-status"), "Certificate cleared. Repeat all seven physical tests before sealing a new one.");
}

function renderDraftReadinessReport() {
  const chip = byId("readiness-overall");
  const summary = byId("readiness-summary");
  const list = byId("readiness-checks");
  list.replaceChildren();
  chip.classList.remove("status-good", "status-warning", "status-danger");
  if (!draftReadinessReport) {
    chip.textContent = "Not checked";
    chip.classList.add("status-warning");
    summary.textContent = "Run the departure check after every final pack, keeper, cap, or nomination-order change.";
    return;
  }
  const { blocks, warnings, passes, total } = draftReadinessReport.counts;
  chip.textContent = draftReadinessReport.overall === "ready" ? "Ready to leave" : draftReadinessReport.overall === "review" ? "Review warnings" : "Blocked";
  chip.classList.add(draftReadinessReport.overall === "ready" ? "status-good" : draftReadinessReport.overall === "review" ? "status-warning" : "status-danger");
  summary.textContent = `${passes} of ${total} checks pass · ${warnings} warning${warnings === 1 ? "" : "s"} · ${blocks} blocker${blocks === 1 ? "" : "s"}. Generated ${dateTime(draftReadinessReport.generatedAt)}.`;
  for (const check of draftReadinessReport.checks) {
    const item = document.createElement("li");
    item.className = `readiness-item is-${check.status}`;
    const mark = document.createElement("span");
    mark.className = "readiness-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "×";
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = check.label;
    const detail = document.createElement("small");
    detail.textContent = check.detail;
    copy.append(title, detail);
    item.append(mark, copy);
    list.append(item);
  }
}

async function runDraftReadinessCheck({ announce = true } = {}) {
  const actionStatus = byId("readiness-action-status");
  try {
    if (announce) setStatus(actionStatus, "Checking the saved pack, local ledger, offline unlock, cloud path, projector, and recovery evidence…");
    const offlineVerifierReady = await hasOfflineVerifier();
    lastRecoveryExportAt = lastRecoveryExportAt || await getMeta("lastRecoveryExportAt");
    const personalBoardBundle = currentPersonalBoardBundle();
    const currentPersonalBoardFingerprint = await personalBoardFingerprint(personalBoardBundle);
    draftReadinessReport = buildDraftReadinessReport({
      pack: draftPack,
      state: draftState,
      mode: APP_MODE,
      now: new Date().toISOString(),
      online: navigator.onLine,
      cloudReachable,
      ledgerGeneration,
      ledgerStale,
      offlineVerifierReady,
      displayBoardUrl,
      recoveryExportedAt: lastRecoveryExportAt,
      personalBoardDecisionCount: personalBoardBundle.entries.length,
      personalBoardFingerprint: currentPersonalBoardFingerprint,
      personalBoardBackupEvidence,
      liveStatusCapturedAt: liveStatusSnapshot?.capturedAt,
      liveStatusCount: liveStatusSnapshot?.updates?.length || 0,
      morningIntelligenceCapturedAt: morningIntelligenceSnapshot?.capturedAt,
      morningIntelligencePackId: morningIntelligenceSnapshot?.packId,
      morningIntelligencePlayersScanned: morningIntelligenceSnapshot?.coverage?.playersScanned || 0,
      morningIntelligenceStaleSources: morningIntelligenceSnapshot?.staleSources?.length || 0,
      humanRehearsalEvidence,
    });
    renderDraftReadinessReport();
    if (announce) {
      const copy = draftReadinessReport.overall === "ready"
        ? "Departure gate passed. Download one final recovery file and keep the printed local fallback with you."
        : draftReadinessReport.overall === "review"
          ? "No hard blocker remains, but review every warning before leaving."
          : "Do not treat this setup as draft-ready yet. Resolve the red blockers first.";
      setStatus(actionStatus, copy, draftReadinessReport.overall === "blocked");
    }
    return draftReadinessReport;
  } catch (error) {
    draftReadinessReport = null;
    renderDraftReadinessReport();
    setStatus(actionStatus, `Readiness check failed safely: ${errorMessage(error)}`, true);
    return null;
  }
}

function openEmergencyBoard() {
  const actionStatus = byId("readiness-action-status");
  try {
    const generatedAt = new Date().toISOString();
    const snapshot = toPublicSnapshot(draftState, { updatedAt: generatedAt });
    const html = buildEmergencyBoardHtml(snapshot, { packId: draftPack.packId, generatedAt, rosterSize: draftState.config.rosterSize });
    byId("emergency-board-frame").srcdoc = html;
    byId("emergency-board-dialog").showModal();
    setStatus(byId("emergency-board-status"), "Local snapshot ready. Select Print, then keep the paper copy with the draft laptop.");
    setStatus(actionStatus, "Printable local fallback opened from the current ledger.");
  } catch (error) {
    setStatus(actionStatus, `Emergency board failed safely: ${errorMessage(error)}`, true);
  }
}

function printEmergencyBoard() {
  try {
    const frameWindow = byId("emergency-board-frame").contentWindow;
    if (!frameWindow) throw new Error("The printable frame is not ready.");
    frameWindow.focus();
    frameWindow.print();
    setStatus(byId("emergency-board-status"), "Print dialog opened. Verify all 12 teams before accepting the print job.");
  } catch (error) {
    setStatus(byId("emergency-board-status"), `Printing failed safely: ${errorMessage(error)}.`, true);
  }
}

function renderKeeperEvidenceDisclosure() {
  const details = byId("keeper-evidence-details");
  byId("keeper-evidence-toggle-label").textContent = details.open ? "Hide table" : "Show table";
}

function keeperSandboxConfigEvent() {
  return {
    id: `keeper-sandbox-config-${ROOM_SEASON}`,
    type: EVENT_TYPES.DRAFT_CONFIGURED,
    createdAt: `${ROOM_SEASON}-01-01T00:00:00.000Z`,
    deviceId: "keeper-sandbox",
    payload: draftPack.leagueConfig,
  };
}

function replayKeeperSandbox() {
  keeperSandboxState = replayDraft([keeperSandboxConfigEvent(), ...keeperSandboxEvents]);
  return keeperSandboxState;
}

function keeperWorkspaceState() {
  return keeperWorkspaceMode === "sandbox" ? keeperSandboxState : draftState;
}

function keeperWorkspaceEventList() {
  return keeperWorkspaceMode === "sandbox" ? keeperSandboxEvents : events;
}

function currentKeeperCandidates() {
  const state = keeperWorkspaceState();
  return draftPack.keeperCandidates.map((candidate) => ({
    ...candidate,
    originalTeamId: candidate.teamId,
    teamId: state.keeperRightsOwners[candidate.playerId]?.teamId || candidate.teamId,
  }));
}

function keeperScenarioPack() {
  const candidates = currentKeeperCandidates().map((candidate) => {
    const scenarioValue = keeperScenario?.valuesByPlayerId[candidate.playerId] ?? candidate.marketValue;
    return {
      ...candidate,
      marketValue: scenarioValue,
      surplus: candidate.keeperYear <= 3 ? scenarioValue - candidate.keeperSalary : 0,
    };
  });
  return { ...draftPack, keeperCandidates: candidates };
}

function activeDeclaredKeeperIds() {
  return Object.values(keeperWorkspaceState().teams)
    .flatMap((team) => team.roster)
    .filter((player) => player.acquisitionType === "keeper")
    .map((player) => player.playerId);
}

function keeperCandidatesForTeam(teamId) {
  return currentKeeperCandidates().filter((candidate) => candidate.teamId === teamId);
}

function renderKeeperWorkspace() {
  const sandbox = keeperWorkspaceMode === "sandbox";
  byId("keeper-mode-sandbox").setAttribute("aria-pressed", String(sandbox));
  byId("keeper-mode-official").setAttribute("aria-pressed", String(!sandbox));
  byId("keeper-mode-sandbox").className = `button ${sandbox ? "button-primary" : "button-secondary"}`;
  byId("keeper-mode-official").className = `button ${sandbox ? "button-secondary" : "button-primary"}`;
  byId("keeper-sandbox-copy-official").disabled = !sandbox;
  byId("keeper-sandbox-reset").disabled = !sandbox || keeperSandboxEvents.length === 0;
  byId("keeper-workspace-description").textContent = sandbox
    ? "Private sandbox changes stay on this laptop and never reach the public board. Every keeper or trade recalculates forecast auction values."
    : "Official ledger actions sync to the auctioneer and public board. Use this mode only for confirmed keeper decisions and trades.";
  byId("keeper-operations-eyebrow").textContent = sandbox ? "Private prediction ledger" : "Official synced setup ledger";
  byId("keeper-operations-title").textContent = sandbox
    ? "Test keeper declarations and rights trades"
    : "Record confirmed keeper declarations and rights trades";

  const impact = byId("keeper-scenario-impact");
  impact.replaceChildren();
  const summary = document.createElement("strong");
  summary.textContent = `${keeperScenario.activeKeeperCount} forecast keeper${keeperScenario.activeKeeperCount === 1 ? "" : "s"} · room inflation ${keeperScenario.globalInflationPercent >= 0 ? "+" : ""}${keeperScenario.globalInflationPercent.toFixed(1)}%`;
  impact.append(summary);
  const chips = document.createElement("div");
  chips.className = "keeper-impact-chips";
  for (const position of POSITIONS) {
    const row = keeperScenario.positionImpacts[position];
    const chip = document.createElement("span");
    chip.className = row.displayPercent > 0 ? "is-up" : row.displayPercent < 0 ? "is-down" : "";
    chip.textContent = `${position} ${row.displayPercent >= 0 ? "+" : ""}${row.displayPercent.toFixed(1)}% · ${row.keepers} kept`;
    chip.title = `${row.expectedRemainingDemand.toFixed(1)} expected ${position} purchases remain; current replacement rank ${position}${row.replacementRank}. ${currency(row.keeperSurplus)} keeper surplus is concentrated here.`;
    chips.append(chip);
  }
  impact.append(chips);
}

function renderKeeperEvidenceTeamSelector() {
  const select = byId("keeper-evidence-team");
  const teamIds = draftState.config.nominationOrder;
  if (!teamIds.includes(selectedKeeperEvidenceTeamId)) selectedKeeperEvidenceTeamId = "dogs-of-war";
  select.replaceChildren();
  for (const teamId of teamIds) {
    const option = document.createElement("option");
    option.value = teamId;
    option.textContent = draftState.teams[teamId].name;
    select.append(option);
  }
  select.value = selectedKeeperEvidenceTeamId;
  byId("keeper-evidence-team-label").textContent = draftState.teams[selectedKeeperEvidenceTeamId].name;
}

function keeperRows() {
  const tbody = byId("keeper-rows");
  tbody.replaceChildren();
  renderKeeperEvidenceTeamSelector();
  const boardByPlayerId = new Map(keeperBoardRows.map((row) => [row.playerId, row]));
  const dynamicKeeperSurplus = (candidate) => boardByPlayerId.get(candidate.playerId)?.surplus ?? candidate.surplus;
  const dynamicKeeperValue = (candidate) => boardByPlayerId.get(candidate.playerId)?.marketValue ?? candidate.marketValue;
  const candidates = keeperCandidatesForTeam(selectedKeeperEvidenceTeamId)
    .slice()
    .sort((left, right) =>
      dynamicKeeperSurplus(right) - dynamicKeeperSurplus(left)
      || dynamicKeeperValue(right) - dynamicKeeperValue(left)
      || left.playerName.localeCompare(right.playerName),
    );
  const workspaceState = keeperWorkspaceState();
  const fbgRows = new Map((draftPack.fbgAuctionValues?.values || []).map((row) => [row.playerId, row]));
  const fbgCoverage = draftPack.fbgAuctionValues;
  byId("keeper-fbg-coverage").textContent = fbgCoverage
    ? `FBG comparison loaded: ${fbgCoverage.matchedRows}/${fbgCoverage.reportedRows} supplied rows matched · supplied PDF covers ${fbgCoverage.rankStart === 1 ? "complete " : ""}ranks ${fbgCoverage.rankStart}–${fbgCoverage.rankEnd}${fbgCoverage.rankStart === 1 ? "" : " only"} · no model effect. ${fbgAuctionValueCompatibilityText()}`
    : "No Footballguys auction-value comparison is loaded in this pack.";
  byId("keeper-count").textContent = `${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`;
  if (!candidates.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.className = "muted";
    cell.textContent = `${draftState.teams[selectedKeeperEvidenceTeamId].name} has no keeper candidates that passed the evidence gate.`;
    row.append(cell);
    tbody.append(row);
    return candidates;
  }
  for (const candidate of candidates) {
    const row = document.createElement("tr");
    const boardRow = boardByPlayerId.get(candidate.playerId);
    const fbg = fbgRows.get(candidate.playerId);
    const actionable = candidate.keeperYear <= 3 && !workspaceState.draftedPlayers[candidate.playerId];
    row.dataset.playerId = candidate.playerId;
    row.className = actionable ? "keeper-candidate-action" : workspaceState.draftedPlayers[candidate.playerId] ? "keeper-candidate-recorded" : "";
    if (actionable) {
      row.tabIndex = 0;
      row.title = `Double-click to record ${candidate.playerName} when ${teamName(candidate.teamId)} is on the clock`;
      row.addEventListener("dblclick", () => void recordKeeperCandidate(candidate, candidate.teamId));
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        void recordKeeperCandidate(candidate, candidate.teamId);
      });
    }
    const playerCell = document.createElement("td");
    const playerName = document.createElement("span");
    playerName.className = "player-name";
    playerName.textContent = candidate.playerName;
    const playerMeta = document.createElement("span");
    playerMeta.className = "player-meta";
    playerMeta.textContent = candidate.position;
    playerCell.append(playerName, playerMeta);
    const tenure = keeperContractTenure(candidate.keeperYear);
    const contract = document.createElement("td");
    contract.className = "keeper-contract";
    const contractYear = document.createElement("strong");
    contractYear.textContent = tenure.yearLabel;
    const contractRemaining = document.createElement("small");
    contractRemaining.textContent = `${tenure.yearsUsed} contract year${tenure.yearsUsed === 1 ? "" : "s"} used · ${tenure.yearsLeft} eligible year${tenure.yearsLeft === 1 ? "" : "s"} left`;
    contract.append(contractYear, contractRemaining);
    const evidence = document.createElement("td");
    evidence.textContent = candidate.evidenceStatus;
    const trade = document.createElement("td");
    trade.className = "keeper-trade-read";
    trade.textContent = boardRow?.tradeRead || "No current trade read";
    const fbgCell = numberCell(fbg ? currency(fbg.value) : "—", fbg ? "fbg-value" : "fbg-missing");
    fbgCell.title = fbg
      ? `Footballguys rank ${fbg.rank} in the supplied August 8 PDF · comparison only`
      : fbgCoverage
        ? `Not ranked in the supplied Footballguys ranks ${fbgCoverage.rankStart}–${fbgCoverage.rankEnd} report.`
        : "No Footballguys auction-value comparison is loaded.";
    row.append(
      playerCell,
      contract,
      numberCell(currency(candidate.keeperSalary), "gold"),
      numberCell(currency(boardRow?.marketValue ?? candidate.marketValue)),
      fbgCell,
      numberCell(currency(boardRow?.surplus ?? candidate.surplus), (boardRow?.surplus ?? candidate.surplus) > 0 ? "positive" : ""),
      trade,
      evidence,
    );
    tbody.append(row);
  }
  return candidates;
}

function renderLeagueKeeperPressure() {
  const state = keeperWorkspaceState();
  const grid = byId("league-keeper-grid");
  grid.replaceChildren();
  if (REPLAY_2025) {
    const selectedCount = Object.values(state.teams)
      .flatMap((team) => team.roster)
      .filter((player) => player.acquisitionType === "keeper").length;
    byId("league-keeper-count").textContent = `${selectedCount} recorded · ${24 - selectedCount} choices open`;
    for (const teamId of state.config.nominationOrder) {
      const team = state.teams[teamId];
      const recorded = team.roster.filter((player) => player.acquisitionType === "keeper");
      const card = document.createElement("article");
      card.className = `keeper-pressure-card${team.id === "dogs-of-war" ? " is-dogs" : ""}`;
      const header = document.createElement("header");
      const title = document.createElement("h4");
      title.textContent = team.name;
      const count = document.createElement("span");
      count.textContent = `${recorded.length} of 2 selected`;
      header.append(title, count);
      const list = document.createElement("div");
      list.className = "keeper-pressure-list";
      for (let index = 0; index < 2; index += 1) {
        const keeper = recorded[index];
        const row = document.createElement("div");
        row.className = `keeper-pressure-player${keeper ? "" : " is-pending"}`;
        const identity = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = keeper?.playerName || `Round ${index + 1} — choice pending`;
        const detail = document.createElement("small");
        detail.textContent = keeper
          ? `${keeper.position} · ${currency(keeper.price)} keeper price`
          : index === 0
            ? "No first-round keeper recorded"
            : "Choose, trade, or pass";
        identity.append(name, detail);
        const value = document.createElement("span");
        value.className = "keeper-pressure-value";
        value.textContent = keeper ? currency(keeper.price) : "OPEN";
        row.append(identity, value);
        list.append(row);
      }
      card.append(header, list);
      grid.append(card);
    }
    return;
  }
  const scenarioCandidates = keeperScenarioPack().keeperCandidates;
  const eligibleTotal = scenarioCandidates.filter((candidate) => candidate.keeperYear <= 3).length;
  const forcedTotal = scenarioCandidates.length - eligibleTotal;
  byId("league-keeper-count").textContent = `${eligibleTotal} eligible · ${forcedTotal} forced pool`;

  for (const team of draftPack.leagueConfig.teams) {
    const candidates = scenarioCandidates.filter((candidate) => candidate.teamId === team.id);
    const eligible = candidates.filter((candidate) => candidate.keeperYear <= 3).sort((left, right) => right.surplus - left.surplus);
    const forced = candidates.filter((candidate) => candidate.keeperYear > 3);
    const card = document.createElement("article");
    card.className = `keeper-pressure-card${team.id === "dogs-of-war" ? " is-dogs" : ""}`;
    const header = document.createElement("header");
    const title = document.createElement("h4");
    title.textContent = team.name;
    const count = document.createElement("span");
    count.textContent = `${eligible.length} eligible${forced.length ? ` · ${forced.length} forced` : ""}`;
    header.append(title, count);
    const list = document.createElement("div");
    list.className = "keeper-pressure-list";
    for (const candidate of eligible.slice(0, 2)) {
      const tenure = keeperContractTenure(candidate.keeperYear);
      const row = document.createElement("div");
      row.className = "keeper-pressure-player";
      const identity = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = candidate.playerName;
      const detail = document.createElement("small");
      detail.textContent = `${candidate.position} · ${tenure.yearLabel} · ${tenure.yearsUsed} used/${tenure.yearsLeft} left · ${currency(candidate.keeperSalary)} cost`;
      identity.append(name, detail);
      const value = document.createElement("span");
      value.className = "keeper-pressure-value";
      value.textContent = `${candidate.surplus >= 0 ? "+" : ""}${currency(candidate.surplus)}`;
      row.append(identity, value);
      list.append(row);
    }
    if (!eligible.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = forced.length ? "No legal 2026 keeper; current contracts are expired." : "No roster candidates loaded.";
      list.append(empty);
    }
    card.append(header, list);
    grid.append(card);
  }
}

function renderKeeperScenarios(candidates) {
  const state = keeperWorkspaceState();
  const container = byId("keeper-scenarios");
  container.replaceChildren();
  const dogsStartingCap = state.teams["dogs-of-war"]?.startingCap || 104;
  const boardByPlayerId = new Map(keeperBoardRows.map((row) => [row.playerId, row]));
  const eligible = candidates
    .filter((candidate) => candidate.keeperYear <= 3)
    .map((candidate) => ({ ...candidate, surplus: boardByPlayerId.get(candidate.playerId)?.surplus ?? candidate.surplus }))
    .sort((left, right) => right.surplus - left.surplus);
  const scenarios = [
    {
      label: "Keep nobody",
      value: currency(dogsStartingCap),
      detail: "Full auction cash, no locked keeper surplus.",
    },
  ];
  for (const candidate of eligible.slice(0, 4)) {
    const tenure = keeperContractTenure(candidate.keeperYear);
    const tradeRead = keeperBoardRows.find((row) => row.playerId === candidate.playerId)?.tradeRead;
    scenarios.push({
      label: `Keep ${candidate.playerName}`,
      value: `${candidate.surplus >= 0 ? "+" : ""}${currency(candidate.surplus)}`,
      detail: `${currency(dogsStartingCap - candidate.keeperSalary)} auction cash after a ${currency(candidate.keeperSalary)} keeper (${tenure.yearLabel}; ${tenure.yearsUsed} used, ${tenure.yearsLeft} left). ${candidate.evidenceStatus}.${tradeRead ? ` Trade read: ${tradeRead}.` : ""}`,
    });
  }
  if (eligible.length >= 2) {
    const [first, second] = eligible;
    scenarios.push({
      label: `Keep ${first.playerName} + ${second.playerName}`,
      value: `+${currency(first.surplus + second.surplus)}`,
      detail: `${currency(dogsStartingCap - first.keeperSalary - second.keeperSalary)} auction cash after both keepers.`,
    });
  }
  scenarios.forEach((scenario, index) => {
    const button = document.createElement("button");
    button.className = "scenario-button";
    button.type = "button";
    button.setAttribute("aria-pressed", String(scenario.label === selectedKeeperScenarioLabel));
    button.textContent = scenario.label;
    button.addEventListener("click", () => {
      selectedKeeperScenarioLabel = scenario.label;
      container.querySelectorAll("button").forEach((candidateButton) => candidateButton.setAttribute("aria-pressed", String(candidateButton === button)));
      byId("scenario-label").textContent = scenario.label;
      byId("scenario-value").textContent = scenario.value;
      byId("scenario-detail").textContent = scenario.detail;
    });
    container.append(button);
  });
  const selectedScenario = scenarios.find((scenario) => scenario.label === selectedKeeperScenarioLabel) || scenarios[0];
  selectedKeeperScenarioLabel = selectedScenario.label;
  container.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.textContent === selectedScenario.label)));
  byId("scenario-label").textContent = selectedScenario.label;
  byId("scenario-value").textContent = selectedScenario.value;
  byId("scenario-detail").textContent = selectedScenario.detail;
}

function tradeRange(opportunity) {
  return opportunity.offerFloor === opportunity.offerCeiling
    ? currency(opportunity.offerFloor)
    : `${currency(opportunity.offerFloor)}–${currency(opportunity.offerCeiling)}`;
}

function defaultTradeTestAmount(opportunity) {
  return Math.min(opportunity.offerCeiling, Math.max(opportunity.offerFloor, 2));
}

function addKeeperTradeFact(container, label, value) {
  const fact = document.createElement("div");
  const term = document.createElement("span");
  term.textContent = label;
  const amount = document.createElement("strong");
  amount.textContent = value;
  fact.append(term, amount);
  container.append(fact);
}

function ownerKeeperStatusMeta(opportunity) {
  return opportunity.ownerDeclaredKeeperCount > 0
    ? `${opportunity.ownerDeclaredKeeperCount}/2 keepers declared`
    : `owner option #${opportunity.ownerKeeperRank ?? opportunity.portfolioRank}`;
}

function ownerKeeperStatusRationale(opportunity) {
  const owner = opportunity.ownerTeamName;
  const declaredNames = opportunity.ownerDeclaredKeeperNames.length
    ? ` (${opportunity.ownerDeclaredKeeperNames.join(" and ")})`
    : "";
  if (opportunity.ownerDeclaredKeeperCount >= 2) {
    return `${owner} has already declared both keepers${declaredNames}. ${opportunity.playerName} is outside those locked slots, so trading the right does not displace keeper value.`;
  }
  if (opportunity.ownerDeclaredKeeperCount === 1) {
    return opportunity.ownerPortfolioIncludesPlayer
      ? `${owner} has declared one keeper${declaredNames}. The model currently places ${opportunity.playerName} in the remaining open slot, so a trade displaces ${currency(opportunity.sellerPortfolioLoss)} of keeper value.`
      : `${owner} has declared one keeper${declaredNames}, but the model has a stronger option for the remaining open slot. ${opportunity.playerName} does not displace keeper value.`;
  }
  return opportunity.ownerPortfolioIncludesPlayer
    ? `${owner} has not declared any keepers. The model currently places ${opportunity.playerName} in its best two available options, so a trade displaces ${currency(opportunity.sellerPortfolioLoss)} of keeper value.`
    : `${owner} has not declared any keepers and the model has at least two stronger available options. ${opportunity.playerName} does not displace keeper value.`;
}

function loadKeeperTradeProposal(opportunity, amount, optimizerTeamId) {
  const acquiring = opportunity.kind === "acquire";
  capFromTeam.value = acquiring ? optimizerTeamId : opportunity.bestBuyerTeamId;
  capToTeam.value = acquiring ? opportunity.ownerTeamId : optimizerTeamId;
  capTransferAmount.value = String(amount);
  teamASendsPlayerIds = new Set();
  teamBSendsPlayerIds = new Set([opportunity.playerId]);
  renderKeeperOperations();
  updateCapTransferSummary();
  capTransferForm.scrollIntoView({ behavior: "smooth", block: "center" });
  setStatus(byId("keeper-market-status"), `${currency(amount)} ${opportunity.playerName} proposal for ${teamName(optimizerTeamId)} loaded below. Review it, negotiate, and record the atomic rights trade only after both teams agree.`);
}

function keeperTradeOpportunityCard(opportunity, market) {
  const card = document.createElement("article");
  card.className = "keeper-market-card";
  const heading = document.createElement("header");
  const identity = document.createElement("div");
  const name = document.createElement("h5");
  name.textContent = opportunity.playerName;
  const meta = document.createElement("p");
  meta.textContent = opportunity.kind === "acquire"
    ? `${opportunity.position} · ${opportunity.ownerTeamName} · ${ownerKeeperStatusMeta(opportunity)}`
    : `${opportunity.position} · ${market.teamName} · ${ownerKeeperStatusMeta(opportunity)} · best fit ${opportunity.bestBuyerTeamName}`;
  identity.append(name, meta);
  const edge = document.createElement("span");
  edge.className = "keeper-market-edge";
  edge.textContent = opportunity.kind === "acquire"
    ? `+${currency(opportunity.portfolioGainAtOpening)} opening edge`
    : `+${currency(opportunity.portfolioGainAtCeiling)} cap upside`;
  heading.append(identity, edge);

  const facts = document.createElement("div");
  facts.className = "keeper-market-facts";
  addKeeperTradeFact(facts, "Market", currency(opportunity.marketValue));
  addKeeperTradeFact(facts, "Keeper salary", currency(opportunity.keeperSalary));
  addKeeperTradeFact(facts, "Contract", `${opportunity.contractYearLabel} · ${opportunity.contractYearsLeft} left`);
  addKeeperTradeFact(facts, opportunity.kind === "acquire" ? "Pay cap" : "Ask cap", tradeRange(opportunity));

  const rationale = document.createElement("p");
  rationale.className = "keeper-market-rationale";
  if (opportunity.kind === "acquire") {
    const replacement = opportunity.displacedPlayer
      ? `It would replace ${opportunity.displacedPlayer.playerName} (${opportunity.displacedPlayer.surplus >= 0 ? "+" : ""}${currency(opportunity.displacedPlayer.surplus)}).`
      : "It fills an open positive-value keeper slot.";
    rationale.textContent = `${ownerKeeperStatusRationale(opportunity)} ${replacement}`;
  } else {
    const buyerFits = opportunity.buyerFits.map((buyer) => `${buyer.teamName} up to ${currency(buyer.ceiling)}`).join(" · ");
    rationale.textContent = `${ownerKeeperStatusRationale(opportunity)} Modeled fits: ${buyerFits}.`;
  }

  const calculator = document.createElement("div");
  calculator.className = "keeper-market-calculator";
  const label = document.createElement("label");
  const labelText = document.createElement("span");
  labelText.textContent = opportunity.kind === "acquire" ? "Test cap payment" : "Test cap received";
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(opportunity.offerFloor);
  input.max = String(opportunity.offerCeiling);
  input.step = "1";
  input.inputMode = "numeric";
  input.value = String(defaultTradeTestAmount(opportunity));
  label.append(labelText, input);
  const result = document.createElement("p");
  result.className = "keeper-market-result";
  const action = document.createElement("button");
  action.type = "button";
  action.className = "button button-secondary keeper-market-action";

  const update = () => {
    const amount = Math.min(opportunity.offerCeiling, Math.max(opportunity.offerFloor, Math.round(Number(input.value) || opportunity.offerFloor)));
    input.value = String(amount);
    const scenario = keeperTradeScenario(opportunity, amount);
    if (opportunity.kind === "acquire") {
      result.textContent = `At ${currency(amount)}: ${currency(scenario.allInCost)} all-in (${currency(opportunity.keeperSalary)} keeper + ${currency(amount)} cap), ${scenario.playerNetSurplus >= 0 ? "+" : ""}${currency(scenario.playerNetSurplus)} player net, ${scenario.portfolioGain >= 0 ? "+" : ""}${currency(scenario.portfolioGain)} versus ${market.teamName}’s current two.`;
      action.textContent = `Load ${currency(amount)} offer`;
    } else {
      result.textContent = `At ${currency(amount)} received: ${scenario.portfolioGain >= 0 ? "+" : ""}${currency(scenario.portfolioGain)} to ${market.teamName}’s keeper portfolio after ${currency(opportunity.sellerPortfolioLoss)} of displaced keeper value.`;
      action.textContent = `Load ${currency(amount)} proposal`;
    }
  };
  input.addEventListener("input", update);
  input.addEventListener("change", update);
  action.addEventListener("click", () => loadKeeperTradeProposal(opportunity, Number(input.value), market.teamId));
  update();
  calculator.append(label, result, action);
  card.append(heading, facts, rationale, calculator);
  return card;
}

const KEEPER_TRADE_RESULT_LIMIT = 20;
const KEEPER_TRADE_VISIBLE_CARDS = 5;

function keeperTradeResultCount(total) {
  const shown = Math.min(total, KEEPER_TRADE_RESULT_LIMIT);
  return total > KEEPER_TRADE_RESULT_LIMIT
    ? `${total} viable · top ${shown} shown`
    : `${total} viable · ${shown} shown`;
}

function sizeKeeperTradeResultWindow(list) {
  const cards = [...list.querySelectorAll(":scope > .keeper-market-card")];
  const scrollable = cards.length > KEEPER_TRADE_VISIBLE_CARDS;
  list.classList.toggle("is-scrollable", scrollable);
  if (!scrollable) {
    list.style.removeProperty("--keeper-market-window-height");
    return;
  }
  const visibleCards = cards.slice(0, KEEPER_TRADE_VISIBLE_CARDS);
  if (!visibleCards.every((card) => card.getBoundingClientRect().height > 0)) return;
  const rowGap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
  const visibleHeight = visibleCards.reduce((total, card) => total + card.getBoundingClientRect().height, 0)
    + (rowGap * (visibleCards.length - 1));
  list.style.setProperty("--keeper-market-window-height", `${Math.ceil(visibleHeight)}px`);
}

function sizeKeeperTradeResultWindows() {
  sizeKeeperTradeResultWindow(byId("keeper-acquire-list"));
  sizeKeeperTradeResultWindow(byId("keeper-sell-list"));
}

function renderKeeperTradeMarket() {
  const select = byId("keeper-market-team");
  const teamIds = draftState.config.nominationOrder;
  if (!teamIds.includes(selectedKeeperMarketTeamId)) selectedKeeperMarketTeamId = "dogs-of-war";
  select.replaceChildren();
  for (const teamId of teamIds) {
    const option = document.createElement("option");
    option.value = teamId;
    option.textContent = teamName(teamId);
    select.append(option);
  }
  select.value = selectedKeeperMarketTeamId;
  const declaredKeeperIds = activeDeclaredKeeperIds();
  const market = buildKeeperTradeMarket(keeperScenarioPack(), { teamId: selectedKeeperMarketTeamId, declaredKeeperIds });
  const acquireList = byId("keeper-acquire-list");
  const sellList = byId("keeper-sell-list");
  acquireList.replaceChildren();
  sellList.replaceChildren();
  byId("keeper-market-summary").textContent = `${currency(market.currentPortfolioValue)} current top-two surplus`;
  byId("keeper-market-note").textContent = `Ranked by the change to ${market.teamName}’s best two-keeper portfolio—not just a player’s raw discount. ${declaredKeeperIds.length} declared keeper${declaredKeeperIds.length === 1 ? " is" : "s are"} locked out of the trade market. Test the separate cap payment before loading a proposal into the audited trade form.`;
  byId("keeper-acquire-count").textContent = keeperTradeResultCount(market.acquire.length);
  byId("keeper-sell-count").textContent = keeperTradeResultCount(market.tradeAway.length);
  const evidence = byId("keeper-market-evidence");
  evidence.hidden = market.completeTradeDiscovery;
  evidence.textContent = market.completeTradeDiscovery
    ? ""
    : "Historical replay limitation: this pack contains only the two preserved keeper candidates per team. It can price those players, but it cannot discover third-choice trade targets until the complete end-of-season rosters are loaded. The live 2026 pack has complete roster coverage.";

  for (const opportunity of market.acquire.slice(0, KEEPER_TRADE_RESULT_LIMIT)) acquireList.append(keeperTradeOpportunityCard(opportunity, market));
  for (const opportunity of market.tradeAway.slice(0, KEEPER_TRADE_RESULT_LIMIT)) sellList.append(keeperTradeOpportunityCard(opportunity, market));
  if (!market.acquire.length) {
    const empty = document.createElement("p");
    empty.className = "keeper-market-empty";
    empty.textContent = `No modeled acquisition currently improves ${market.teamName}’s top two at a price that also protects the seller.`;
    acquireList.append(empty);
  }
  if (!market.tradeAway.length) {
    const empty = document.createElement("p");
    empty.className = "keeper-market-empty";
    empty.textContent = `No ${market.teamName} surplus player currently has a buyer whose modeled ceiling clears that team’s keeper loss.`;
    sellList.append(empty);
  }
  requestAnimationFrame(sizeKeeperTradeResultWindows);
}

const KEEPER_SETUP_EVENT_TYPES = [EVENT_TYPES.CAP_TRANSFERRED, EVENT_TYPES.KEEPER_RIGHTS_TRADED, EVENT_TYPES.KEEPER_ASSIGNED, EVENT_TYPES.KEEPER_PASSED];

function teamName(teamId) {
  return draftState.teams[teamId]?.name || teamId;
}

function eligibleKeeperCandidates() {
  const state = keeperWorkspaceState();
  return currentKeeperCandidates()
    .filter((candidate) => candidate.keeperYear <= 3 && !state.draftedPlayers[candidate.playerId])
    .sort((left, right) => {
      const leftDogs = left.teamId === "dogs-of-war" ? 0 : 1;
      const rightDogs = right.teamId === "dogs-of-war" ? 0 : 1;
      if (leftDogs !== rightDogs) return leftDogs - rightDogs;
      const teamDifference = state.config.teams.findIndex((team) => team.id === left.teamId)
        - state.config.teams.findIndex((team) => team.id === right.teamId);
      return teamDifference || right.surplus - left.surplus || left.playerName.localeCompare(right.playerName);
    });
}

function fillTeamSelect(select, preferredTeamId, labelValue) {
  const state = keeperWorkspaceState();
  select.replaceChildren();
  for (const configuredTeam of state.config.teams) {
    const team = state.teams[configuredTeam.id];
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = `${team.name} — ${labelValue(team)}`;
    select.append(option);
  }
  select.value = state.teams[preferredTeamId] ? preferredTeamId : state.config.teams[0].id;
}

function selectedKeeperCandidate() {
  return currentKeeperCandidates().find((candidate) => candidate.playerId === keeperPlayer.value) || null;
}

function currentKeeperCandidate(playerId) {
  return currentKeeperCandidates().find((candidate) => candidate.playerId === playerId) || null;
}

function selectedTradePlayers(playerIds) {
  return [...playerIds].map(currentKeeperCandidate).filter(Boolean);
}

function playerNameMatches(candidate, query) {
  const normalized = normalizePlayerSearch(query);
  return !normalized || normalizePlayerSearch(candidate.playerName).includes(normalized);
}

function updateKeeperSelectionSummary() {
  const state = keeperWorkspaceState();
  const summary = byId("keeper-selection-summary");
  const candidate = selectedKeeperCandidate();
  const selectedTeam = state.teams[keeperTeam.value];
  if (state.keeperSelection.complete) {
    summary.textContent = "All 24 keeper turns are complete. Undo the last setup action if a correction is needed.";
    return;
  }
  if (!candidate || !selectedTeam) {
    summary.textContent = "No eligible keeper rights remain to record.";
    return;
  }
  const originalTeam = teamName(candidate.originalTeamId);
  const currentOwner = teamName(candidate.teamId);
  const rightsPath = candidate.originalTeamId === candidate.teamId ? currentOwner : `${originalTeam} → ${currentOwner}`;
  const remainingCash = selectedTeam.cash - candidate.keeperSalary;
  summary.replaceChildren();
  const headline = document.createElement("strong");
  const tenure = keeperContractTenure(candidate.keeperYear);
  headline.textContent = `${candidate.playerName}: ${currency(candidate.keeperSalary)} · ${tenure.yearLabel} · ${tenure.yearsUsed} used/${tenure.yearsLeft} left`;
  const detail = document.createElement("span");
  detail.textContent = ` ${rightsPath} · ${currency(remainingCash)} auction cash after keeper · ${candidate.surplus >= 0 ? "+" : ""}${currency(candidate.surplus)} modeled surplus.`;
  summary.append(headline, detail);
}

function updateCapTransferSummary() {
  const state = keeperWorkspaceState();
  const summary = byId("cap-transfer-summary");
  const teamA = state.teams[capFromTeam.value];
  const teamB = state.teams[capToTeam.value];
  const teamASends = selectedTradePlayers(teamASendsPlayerIds);
  const teamBSends = selectedTradePlayers(teamBSendsPlayerIds);
  const amount = Number(capTransferAmount.value);
  if (!teamA || !teamB || teamA.id === teamB.id || (!teamASends.length && !teamBSends.length) || !Number.isInteger(amount) || amount < 0) {
    summary.textContent = "Add at least one player to either side. Cap can be $0 for a player swap.";
    return;
  }
  summary.replaceChildren();
  const headline = document.createElement("strong");
  const aPackage = [teamASends.map((player) => player.playerName).join(" + "), amount > 0 ? currency(amount) : ""].filter(Boolean).join(" + ") || "no players";
  const bPackage = teamBSends.map((player) => player.playerName).join(" + ") || "no players";
  headline.textContent = `${teamA.name} sends ${aPackage}; ${teamB.name} sends ${bPackage}.`;
  const detail = document.createElement("span");
  detail.textContent = amount > 0
    ? ` Auction cash: ${teamA.name} ${currency(teamA.cash)} → ${currency(teamA.cash - amount)}; ${teamB.name} ${currency(teamB.cash)} → ${currency(teamB.cash + amount)}.`
    : " Player-for-player swap; neither salary cap changes.";
  summary.append(headline, detail);
}

function addPlayerToTrade(direction) {
  const teamAtoB = direction === "A_TO_B";
  const select = teamAtoB ? capReturnPlayer : capTransferPlayer;
  const playerId = select.value;
  if (!playerId) return;
  const destination = teamAtoB ? teamASendsPlayerIds : teamBSendsPlayerIds;
  destination.add(playerId);
  renderKeeperOperations();
}

function activeKeeperSetupEvents() {
  const workspaceEvents = keeperWorkspaceEventList();
  const voided = new Set(workspaceEvents.filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED).map((event) => event.payload.targetEventId));
  return workspaceEvents.filter((event) => KEEPER_SETUP_EVENT_TYPES.includes(event.type) && !voided.has(event.id));
}

function renderKeeperSelectionTimeline() {
  const state = keeperWorkspaceState();
  const selection = state.keeperSelection;
  const container = byId("keeper-selection-timeline");
  const next = selection.nextSlot;
  byId("keeper-turn-count").textContent = `${selection.completedCount} of ${selection.totalSlots} turns complete`;
  if (next) {
    byId("keeper-on-clock-team").textContent = teamName(next.teamId);
    byId("keeper-on-clock-detail").textContent = `Round ${next.round} · Pick ${next.pick} · Turn ${next.selectionNumber} of ${selection.totalSlots}`;
  } else {
    byId("keeper-on-clock-team").textContent = "Keeper selection complete";
    byId("keeper-on-clock-detail").textContent = "All 24 keeper turns are recorded";
  }
  passKeeperTurnButton.disabled = !next || state.saleCount > 0;

  container.replaceChildren();
  for (const slot of selection.slots) {
    const card = document.createElement("article");
    const current = next?.selectionNumber === slot.selectionNumber;
    card.className = `keeper-turn-card is-${slot.status}${current ? " is-current" : ""}`;
    const turn = document.createElement("span");
    turn.className = "keeper-turn-number";
    turn.textContent = `Round ${slot.round} · Pick ${slot.pick}`;
    const name = document.createElement("strong");
    name.textContent = teamName(slot.teamId);
    const detail = document.createElement("small");
    let keeperMeta = null;
    if (slot.status === "kept") {
      detail.textContent = slot.playerName;
      keeperMeta = document.createElement("small");
      keeperMeta.className = "keeper-turn-meta";
      keeperMeta.textContent = `${slot.position} · ${slot.nflTeam} · ${currency(slot.salary)}`;
    }
    else if (slot.status === "passed") detail.textContent = "Passed — no keeper";
    else if (current) detail.textContent = "ON THE CLOCK";
    else detail.textContent = "Waiting";
    card.append(turn, name, detail);
    if (keeperMeta) card.append(keeperMeta);
    container.append(card);
  }
}

function renderKeeperActionList() {
  const list = byId("keeper-action-list");
  const active = activeKeeperSetupEvents();
  const keeperCount = active.filter((event) => event.type === EVENT_TYPES.KEEPER_ASSIGNED).length;
  byId("keeper-recorded-count").textContent = `${keeperCount} keeper${keeperCount === 1 ? "" : "s"} recorded`;
  list.replaceChildren();
  if (!active.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "No keeper setup actions recorded.";
    list.append(empty);
  } else {
    for (const event of active.slice().reverse().slice(0, 8)) {
      const item = document.createElement("li");
      const headline = document.createElement("strong");
      const detail = document.createElement("span");
      if (event.type === EVENT_TYPES.KEEPER_ASSIGNED) {
        const tenure = keeperContractTenure(event.payload.keeperYear);
        headline.textContent = `${teamName(event.payload.teamId)} kept ${event.payload.playerName}`;
        detail.textContent = `${currency(event.payload.salary)} · ${tenure.yearLabel} · ${tenure.yearsUsed} used/${tenure.yearsLeft} left`;
      } else if (event.type === EVENT_TYPES.KEEPER_PASSED) {
        headline.textContent = `${teamName(event.payload.teamId)} passed Round ${event.payload.round}`;
        detail.textContent = "No keeper selected for this turn";
      } else if (event.type === EVENT_TYPES.KEEPER_RIGHTS_TRADED) {
        headline.textContent = `${teamName(event.payload.teamAId)} ↔ ${teamName(event.payload.teamBId)} rights trade`;
        const aSends = event.payload.teamASends.map((player) => player.playerName).join(" + ") || "no players";
        const bSends = event.payload.teamBSends.map((player) => player.playerName).join(" + ") || "no players";
        detail.textContent = `A sends ${aSends}${event.payload.amountFromAToB ? ` + ${currency(event.payload.amountFromAToB)}` : ""}; B sends ${bSends}`;
      } else {
        headline.textContent = `${teamName(event.payload.fromTeamId)} paid ${teamName(event.payload.toTeamId)} ${currency(event.payload.amount)}`;
        detail.textContent = event.payload.reason;
      }
      item.append(headline, detail);
      list.append(item);
    }
  }
  undoKeeperActionButton.disabled = !lastUndoableEvent(keeperWorkspaceEventList(), KEEPER_SETUP_EVENT_TYPES);
}

function renderSelectedTradeList(containerId, playerIds, destinationTeamId) {
  const container = byId(containerId);
  container.replaceChildren();
  const players = selectedTradePlayers(playerIds);
  if (!players.length) {
    container.textContent = "No players added.";
    return;
  }
  for (const player of players) {
    const chip = document.createElement("span");
    const label = document.createElement("span");
    label.textContent = `${player.playerName} → ${teamName(destinationTeamId)}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = `Remove ${player.playerName} from this trade`;
    remove.setAttribute("aria-label", `Remove ${player.playerName} from this trade`);
    remove.addEventListener("click", () => {
      playerIds.delete(player.playerId);
      renderKeeperOperations();
    });
    chip.append(label, remove);
    container.append(chip);
  }
}

function renderKeeperOperations() {
  const state = keeperWorkspaceState();
  const priorPlayerId = keeperPlayer.value;
  const priorTradePlayerId = capTransferPlayer.value;
  const priorReturnPlayerId = capReturnPlayer.value;
  const priorFromTeamId = capFromTeam.value;
  const priorToTeamId = capToTeam.value;
  const candidates = eligibleKeeperCandidates();
  const boardByPlayerId = new Map(keeperBoardRows.map((row) => [row.playerId, row]));
  const nextKeeperTeamId = state.keeperSelection.nextSlot?.teamId || state.config.nominationOrder[0];
  const keeperCandidates = candidates.filter((candidate) => candidate.teamId === nextKeeperTeamId);
  const keeperMatches = keeperCandidates.filter((candidate) => playerNameMatches(candidate, keeperPlayerSearch.value));

  keeperPlayer.replaceChildren();
  for (const candidate of keeperMatches) {
    const tenure = keeperContractTenure(candidate.keeperYear);
    const option = document.createElement("option");
    option.value = candidate.playerId;
    const scenarioSurplus = boardByPlayerId.get(candidate.playerId)?.surplus ?? candidate.surplus;
    option.textContent = `${candidate.playerName} — ${teamName(candidate.teamId)} · ${currency(candidate.keeperSalary)} · ${tenure.yearLabel} (${tenure.yearsUsed} used/${tenure.yearsLeft} left) · ${scenarioSurplus >= 0 ? "+" : ""}${currency(scenarioSurplus)}`;
    keeperPlayer.append(option);
  }
  if (keeperMatches.some((candidate) => candidate.playerId === priorPlayerId)) keeperPlayer.value = priorPlayerId;
  byId("keeper-player-search-status").textContent = keeperPlayerSearch.value
    ? `${keeperMatches.length} matching eligible player${keeperMatches.length === 1 ? "" : "s"} for ${teamName(nextKeeperTeamId)}.`
    : `${keeperCandidates.length} eligible player${keeperCandidates.length === 1 ? "" : "s"} owned by ${teamName(nextKeeperTeamId)}.`;
  fillTeamSelect(keeperTeam, nextKeeperTeamId, (team) => `${team.roster.filter((player) => player.acquisitionType === "keeper").length}/2 keepers · ${currency(team.cash)}`);

  fillTeamSelect(capFromTeam, priorFromTeamId || "dogs-of-war", (team) => `${currency(team.cash)} cash`);
  const receiverFallback = state.config.teams.find((team) => team.id !== capFromTeam.value)?.id;
  fillTeamSelect(capToTeam, priorToTeamId || receiverFallback, (team) => `${currency(team.cash)} cash`);
  if (capFromTeam.value === capToTeam.value) capToTeam.value = receiverFallback;

  const teamACandidates = candidates.filter((candidate) => candidate.teamId === capFromTeam.value);
  const teamBCandidates = candidates.filter((candidate) => candidate.teamId === capToTeam.value);
  teamASendsPlayerIds = new Set([...teamASendsPlayerIds].filter((playerId) => teamACandidates.some((candidate) => candidate.playerId === playerId)));
  teamBSendsPlayerIds = new Set([...teamBSendsPlayerIds].filter((playerId) => teamBCandidates.some((candidate) => candidate.playerId === playerId)));
  const tradeMatches = teamBCandidates.filter((candidate) => !teamBSendsPlayerIds.has(candidate.playerId));
  capTransferPlayer.replaceChildren();
  for (const candidate of tradeMatches) {
    const tenure = keeperContractTenure(candidate.keeperYear);
    const option = document.createElement("option");
    option.value = candidate.playerId;
    option.textContent = `${candidate.playerName} · ${currency(candidate.keeperSalary)} · ${tenure.yearLabel} · ${teamName(candidate.teamId)}`;
    capTransferPlayer.append(option);
  }
  if (tradeMatches.some((candidate) => candidate.playerId === priorTradePlayerId)) capTransferPlayer.value = priorTradePlayerId;
  byId("cap-transfer-player-status").textContent = `${tradeMatches.length} available player${tradeMatches.length === 1 ? "" : "s"} owned by ${teamName(capToTeam.value)}.`;

  const returnMatches = teamACandidates.filter((candidate) => !teamASendsPlayerIds.has(candidate.playerId));
  capReturnPlayer.replaceChildren();
  for (const candidate of returnMatches) {
    const tenure = keeperContractTenure(candidate.keeperYear);
    const option = document.createElement("option");
    option.value = candidate.playerId;
    option.textContent = `${candidate.playerName} · ${currency(candidate.keeperSalary)} · ${tenure.yearLabel} · ${teamName(candidate.teamId)}`;
    capReturnPlayer.append(option);
  }
  if (returnMatches.some((candidate) => candidate.playerId === priorReturnPlayerId)) capReturnPlayer.value = priorReturnPlayerId;
  byId("cap-return-player-status").textContent = `${returnMatches.length} available player${returnMatches.length === 1 ? "" : "s"} owned by ${teamName(capFromTeam.value)}.`;
  renderSelectedTradeList("cap-transfer-player-list", teamBSendsPlayerIds, capFromTeam.value);
  renderSelectedTradeList("cap-return-player-list", teamASendsPlayerIds, capToTeam.value);

  const auctionStarted = state.saleCount > 0;
  const keeperSelectionComplete = state.keeperSelection.complete;
  for (const form of [keeperAssignmentForm, capTransferForm]) form.setAttribute("aria-disabled", String(auctionStarted));
  keeperTeam.disabled = true;
  for (const control of [keeperPlayerSearch, keeperPlayer, byId("record-keeper")]) control.disabled = auctionStarted || keeperSelectionComplete || !keeperCandidates.length;
  for (const control of [capFromTeam, capToTeam, capTransferAmount, capTransferPlayer, capReturnPlayer, byId("add-cap-transfer-player"), byId("add-cap-return-player"), byId("record-cap-transfer")]) control.disabled = auctionStarted;
  capFromTeam.disabled = auctionStarted;
  capToTeam.disabled = auctionStarted;
  capTransferPlayer.disabled = auctionStarted || !tradeMatches.length;
  byId("add-cap-transfer-player").disabled = auctionStarted || !tradeMatches.length;
  capReturnPlayer.disabled = auctionStarted || !returnMatches.length;
  byId("add-cap-return-player").disabled = auctionStarted || !returnMatches.length;
  const evidencePass = byId("keeper-evidence-pass");
  const selectedTeamOnClock = state.keeperSelection.nextSlot?.teamId === selectedKeeperEvidenceTeamId;
  evidencePass.disabled = auctionStarted || !selectedTeamOnClock;
  evidencePass.textContent = selectedTeamOnClock
    ? `Pass ${teamName(selectedKeeperEvidenceTeamId)} — no keeper`
    : `${state.keeperSelection.nextSlot ? teamName(state.keeperSelection.nextSlot.teamId) : "Selection complete"} is on clock`;
  if (auctionStarted) keeperOperationStatus.textContent = "Auction purchases have begun. New keepers and cap transfers are locked; append-only undo remains available for corrections.";
  else if (keeperSelectionComplete) keeperOperationStatus.textContent = "All 24 keeper turns are complete. Review the timeline and setup actions before the auction begins.";

  renderKeeperSelectionTimeline();
  updateKeeperSelectionSummary();
  updateCapTransferSummary();
  renderKeeperActionList();
}

function practiceTeamName(teamId) {
  return draftState.teams[teamId]?.name || draftPack.managerProfiles?.find((profile) => profile.teamId === teamId)?.teamName || teamId;
}

async function savePracticeSession() {
  await setMeta("practiceAuctionSession", practiceSession);
}

function renderPracticeConsole() {
  if (!PRACTICE_AUCTION) return;
  const player = practiceSession ? draftPack.players.find((row) => row.id === practiceSession.playerId) : null;
  const active = Boolean(practiceSession && player && !draftState.draftedPlayers[player.id]);
  practiceConsole.hidden = false;
  if (!active) {
    byId("practice-player-name").textContent = draftState.currentNominatorTeamId ? "Ready for a nomination" : "Practice draft complete";
    byId("practice-player-detail").textContent = draftState.currentNominatorTeamId
      ? `${practiceTeamName(draftState.currentNominatorTeamId)} nominates next · selected player is used for Dogs of War`
      : "All 12 rosters are full";
    byId("practice-current-bid").textContent = "—";
    byId("practice-leader").textContent = "—";
    byId("practice-quiet-clock").textContent = "—";
    practiceStartButton.disabled = !draftState.currentNominatorTeamId;
    practiceStartButton.textContent = "Start nomination";
    practiceBidButton.disabled = true;
    practiceBidButton.classList.remove("is-steal");
    practiceBidButton.textContent = "BID +$1";
    practicePassButton.disabled = true;
    practicePassButton.textContent = "I'm out";
    practicePauseButton.disabled = true;
    practicePauseButton.textContent = "Pause";
    byId("practice-activity").replaceChildren();
    return;
  }

  const nextBid = practiceSession.currentBid + 1;
  const annotation = annotationFor(player.id);
  const bidLimit = effectivePlayerBidLimit(player);
  const canBid = !practiceSession.userPassed
    && practiceSession.leaderTeamId !== USER_TEAM_ID
    && annotation?.tag !== "avoid"
    && nextBid <= bidLimit;
  byId("practice-player-name").textContent = player.name;
  byId("practice-player-detail").textContent = `${player.position} · ${player.nflTeam} · nominated by ${practiceTeamName(practiceSession.nominatorTeamId)} · tendency simulation`;
  byId("practice-current-bid").textContent = currency(practiceSession.currentBid);
  byId("practice-leader").textContent = practiceTeamName(practiceSession.leaderTeamId);
  byId("practice-quiet-clock").textContent = `${practiceSession.quietTicks}s`;
  practiceStartButton.disabled = true;
  practiceStartButton.textContent = "Auction active";
  practiceBidButton.disabled = !canBid || practiceSession.paused;
  const signal = priceSignal(nextBid, annotation);
  practiceBidButton.classList.toggle("is-steal", canBid && signal === "steal");
  practiceBidButton.textContent = canBid
    ? signal === "steal" ? `STEAL · BID ${currency(nextBid)}` : `BID ${currency(nextBid)}`
    : practiceSession.leaderTeamId === USER_TEAM_ID
      ? "YOU LEAD"
      : practiceSession.userPassed
        ? "YOU'RE OUT"
        : annotation?.tag === "avoid"
          ? "AVOID"
          : nextBid > bidLimit
            ? `MAX ${currency(bidLimit)}`
            : "CAN'T BID";
  practicePassButton.disabled = practiceSession.userPassed || practiceSession.paused;
  practicePassButton.textContent = practiceSession.userPassed ? "Out" : "I'm out";
  practicePauseButton.disabled = false;
  practicePauseButton.textContent = practiceSession.paused ? "Resume" : "Pause";
  const activity = byId("practice-activity");
  activity.replaceChildren();
  for (const row of practiceSession.activity.slice(-5)) {
    const item = document.createElement("li");
    item.textContent = `${practiceTeamName(row.teamId)} ${currency(row.amount)}`;
    activity.append(item);
  }
  setStatus(
    practiceStatus,
    practiceSession.paused
      ? "Paused. No simulated bids or clock movement."
      : "One automated team may bid each second. Three quiet ticks sells the player; Space or B bids +$1.",
  );
}

async function startNextPracticeNomination() {
  if (!PRACTICE_AUCTION || practiceSession || practiceFinishing) return;
  try {
    if (!draftState.currentNominatorTeamId) throw new RuleViolation("DRAFT_COMPLETE", "Every practice roster is full.");
    const liveValues = new Map(draftPack.players.map((player) => [player.id, livePlayerValues(player).marketValue]));
    const player = choosePracticeNominee({
      profiles: draftPack.managerProfiles || [],
      state: draftState,
      players: draftPack.players,
      liveValues,
      nominatorTeamId: draftState.currentNominatorTeamId,
      selectedPlayerId,
      seed: `tb26:${draftState.nominationStep}`,
    });
    if (!player) throw new RuleViolation("PLAYER_REQUIRED", "No available player can be nominated.");
    practiceSession = createPracticeSession({
      practiceId: `practice-${crypto.randomUUID()}`,
      player,
      nominatorTeamId: draftState.currentNominatorTeamId,
    });
    selectedPlayerId = player.id;
    await savePracticeSession();
    renderAll();
    setStatus(practiceStatus, `${practiceTeamName(practiceSession.nominatorTeamId)} opened ${player.name} at $1.`);
  } catch (error) {
    setStatus(practiceStatus, errorMessage(error), true);
    showToast(errorMessage(error), true);
  }
}

async function recordPracticeUserBid() {
  if (!practiceSession || practiceSession.paused) return;
  try {
    const nextBid = practiceSession.currentBid + 1;
    const dogs = draftState.teams[USER_TEAM_ID];
    const player = draftPack.players.find((row) => row.id === practiceSession.playerId);
    const annotation = annotationFor(practiceSession.playerId);
    if (practiceSession.userPassed) throw new RuleViolation("PRACTICE_PASSED", "You already left this bidding window.");
    if (practiceSession.leaderTeamId === USER_TEAM_ID) throw new RuleViolation("PRACTICE_LEADING", "Dogs of War already has the high bid.");
    if (annotation?.tag === "avoid") throw new RuleViolation("PERSONAL_AVOID", "You marked this player Avoid. Right-click him and change the tag before bidding.");
    if (nextBid > dogs.legalMaxBid) throw new RuleViolation("ILLEGAL_BID", `Dogs of War can spend at most ${currency(dogs.legalMaxBid)}.`);
    const bidLimit = effectivePlayerBidLimit(player);
    if (nextBid > bidLimit) throw new RuleViolation("PERSONAL_MAX", `Your hard stop for this player is ${currency(bidLimit)}. Right-click him to change it.`);
    practiceSession = applyPracticeBid(practiceSession, { teamId: USER_TEAM_ID, amount: nextBid, kind: "user_bid" });
    await savePracticeSession();
    renderAll();
  } catch (error) {
    setStatus(practiceStatus, errorMessage(error), true);
    showToast(errorMessage(error), true);
  }
}

async function passPracticeAuction() {
  if (!practiceSession || practiceSession.paused || practiceSession.userPassed) return;
  practiceSession = validatePracticeSession({ ...practiceSession, userPassed: true });
  await savePracticeSession();
  renderAll();
}

async function togglePracticePause() {
  if (!practiceSession) return;
  practiceSession = validatePracticeSession({ ...practiceSession, paused: !practiceSession.paused });
  await savePracticeSession();
  renderAll();
}

async function finishPracticeSale() {
  if (!practiceSession || practiceFinishing) return;
  practiceFinishing = true;
  const completed = practiceSession;
  const player = draftPack.players.find((row) => row.id === completed.playerId);
  try {
    if (!player || draftState.draftedPlayers[player.id]) throw new RuleViolation("PLAYER_UNAVAILABLE", "The practice player is no longer available.");
    const sale = createEvent(
      EVENT_TYPES.PLAYER_SOLD,
      {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        teamId: completed.leaderTeamId,
        amount: completed.currentBid,
        nominatorTeamId: completed.nominatorTeamId,
        openingBid: 1,
      },
      { deviceId },
    );
    await commitLocalEvents(
      [sale],
      `Sold: ${player.name} to ${practiceTeamName(completed.leaderTeamId)} for ${currency(completed.currentBid)}.`,
      practiceStatus,
    );
    practiceSession = null;
    await savePracticeSession();
    selectedPlayerId = null;
    renderAll();
    const dogsNominateNext = draftState.currentNominatorTeamId === USER_TEAM_ID;
    setStatus(
      practiceStatus,
      dogsNominateNext
        ? `Sold: ${player.name} for ${currency(completed.currentBid)}. Your nomination: select a player, then Start nomination.`
        : `Sold: ${player.name} to ${practiceTeamName(completed.leaderTeamId)} for ${currency(completed.currentBid)}. Next nomination loading…`,
    );
    if (!dogsNominateNext) {
      clearTimeout(practiceAutoStartTimer);
      practiceAutoStartTimer = setTimeout(() => void startNextPracticeNomination(), 1600);
    }
  } catch (error) {
    setStatus(practiceStatus, errorMessage(error), true);
    practiceSession = null;
    await savePracticeSession();
  } finally {
    practiceFinishing = false;
  }
}

async function practiceTick() {
  if (!PRACTICE_AUCTION || practiceTickInFlight || practiceFinishing || !practiceSession || practiceSession.paused || appView.hidden) return;
  practiceTickInFlight = true;
  try {
    const player = draftPack.players.find((row) => row.id === practiceSession.playerId);
    if (!player || draftState.draftedPlayers[player.id]) {
      practiceSession = null;
      await savePracticeSession();
      renderAll();
      return;
    }
    const automated = nextAutomatedBid({
      profiles: draftPack.managerProfiles || [],
      state: draftState,
      player,
      liveMarketValue: livePlayerValues(player).marketValue,
      currentBid: practiceSession.currentBid,
      leaderTeamId: practiceSession.leaderTeamId,
      seed: practiceSession.practiceId,
    });
    practiceSession = automated
      ? applyPracticeBid(practiceSession, { teamId: automated.teamId, amount: automated.amount, kind: "agent_bid" })
      : advanceQuietClock(practiceSession);
    await savePracticeSession();
    renderAll();
    if (practiceSession?.quietTicks === 0) await finishPracticeSale();
  } catch (error) {
    setStatus(practiceStatus, errorMessage(error), true);
    if (!(error instanceof RuleViolation)) practiceSession = validatePracticeSession({ ...practiceSession, paused: true });
  } finally {
    practiceTickInFlight = false;
  }
}

function startPracticeClock() {
  clearInterval(practiceTimer);
  if (PRACTICE_AUCTION) practiceTimer = setInterval(() => void practiceTick(), PRACTICE_TICK_MS);
}

function renderAll() {
  draftState = replayDraft(events);
  replayKeeperSandbox();
  liveMarket = computeLiveMarket();
  keeperScenario = calculateKeeperScenarioValues(draftPack, keeperWorkspaceState());
  keeperBoardRows = buildKeeperBoard(keeperScenarioPack(), { declaredKeeperIds: activeDeclaredKeeperIds() });
  renderMetrics();
  renderPlayerPool();
  renderSelectedPlayer();
  renderNeeds();
  teamOptions();
  renderPackStatus();
  renderKeeperWorkspace();
  keeperRows();
  renderKeeperScenarios(keeperCandidatesForTeam("dogs-of-war"));
  renderKeeperOperations();
  renderKeeperTradeMarket();
  renderLeagueKeeperPressure();
  renderPracticeConsole();
  renderPersonalBoardPortability();
  const undoable = lastUndoableSale(events);
  renderSalesEntryMode();
  undoSaleButton.disabled = salesEntryMode !== SALES_ENTRY_MODES.MANUAL || !undoable;
  const snapshot = toPublicSnapshot(draftState, { updatedAt: new Date().toISOString() });
  draftChannel?.postMessage({ type: "PUBLIC_SNAPSHOT", snapshot });
}

function currentSalesEntryPolicy() {
  return salesEntryPolicy({
    mode: salesEntryMode,
    localOnly: LOCAL_ONLY,
    online: navigator.onLine,
    cloudReachable,
    lastSale: draftState.lastSale,
  });
}

function renderSalesEntryMode() {
  const policy = currentSalesEntryPolicy();
  const control = byId("sales-entry-control");
  control.hidden = LOCAL_ONLY;
  saleForm.classList.toggle("is-auctioneer-mode", policy.auctioneer && !LOCAL_ONLY);
  byId("sales-entry-title").textContent = policy.title;
  byId("sales-entry-detail").textContent = policy.detail;
  byId("sales-entry-health").classList.toggle("is-warning", !policy.healthy);
  const auctioneerButton = byId("sales-mode-auctioneer");
  const manualButton = byId("sales-mode-manual");
  auctioneerButton.setAttribute("aria-pressed", String(policy.auctioneer));
  manualButton.setAttribute("aria-pressed", String(!policy.auctioneer));
  auctioneerButton.className = `button ${policy.auctioneer ? "button-primary" : "button-secondary"}`;
  manualButton.className = `button ${policy.auctioneer ? "button-secondary" : "button-primary"}`;
  auctioneerButton.disabled = salesEntryModeChanging;
  manualButton.disabled = salesEntryModeChanging;
  salePrice.disabled = !policy.manualControlsEnabled;
  saleTeam.disabled = !policy.manualControlsEnabled;
  byId("record-sale").disabled = !policy.manualControlsEnabled;
}

async function changeSalesEntryMode(nextMode) {
  if (LOCAL_ONLY || salesEntryModeChanging) return;
  const normalized = normalizeSalesEntryMode(nextMode);
  if (normalized === salesEntryMode) return;
  salesEntryModeChanging = true;
  renderSalesEntryMode();
  try {
    if (normalized === SALES_ENTRY_MODES.MANUAL && navigator.onLine) {
      byId("sales-entry-detail").textContent = "Pulling the latest confirmed auctioneer sale before manual takeover...";
      await syncNow();
    }
    salesEntryMode = normalized;
    await setMeta("salesEntryMode", salesEntryMode);
    renderAll();
    startPolling();
    if (salesEntryMode === SALES_ENTRY_MODES.MANUAL) {
      showToast("Manual backup active. Confirm the auctioneer has stopped entering sales before you record one here.");
      salePrice.focus();
    } else {
      showToast("Auctioneer feed active. Manual sale controls are locked to prevent duplicate entry.");
      scheduleSync(10);
    }
  } catch (error) {
    showToast(`Sales entry mode was not changed: ${errorMessage(error)}`, true);
  } finally {
    salesEntryModeChanging = false;
    renderSalesEntryMode();
  }
}

function selectPlayer(playerId, focusPrice = false) {
  if (!draftPack.players.some((player) => player.id === playerId)) return;
  selectedPlayerId = playerId;
  salePrice.value = "";
  renderPlayerPool();
  renderSelectedPlayer();
  if (focusPrice) salePrice.focus();
}

async function commitLocalEvents(newEvents, message, statusElement = saleStatus) {
  if (ledgerStale) {
    throw new RuleViolation(
      "LEDGER_GENERATION_MISMATCH",
      "This tab belongs to an archived rehearsal. Use Load current cloud rehearsal in Data & Setup before recording another draft action.",
    );
  }
  const previous = events;
  const candidate = [...events, ...newEvents];
  replayDraft(candidate);
  events = candidate;
  renderAll();
  try {
    await appendEvents(newEvents);
    setStatus(statusElement, message);
    byId("sync-status").textContent = LOCAL_ONLY
      ? PRACTICE_AUCTION ? "Local practice saved" : "Local replay saved"
      : navigator.onLine ? "Saved locally · syncing" : "Saved locally · offline";
    scheduleSync(20);
  } catch (error) {
    events = previous;
    renderAll();
    throw error;
  }
}

async function commitKeeperWorkspaceEvents(newEvents, message) {
  if (keeperWorkspaceMode === "official") {
    await commitLocalEvents(newEvents, message, keeperOperationStatus);
    return;
  }
  const previous = keeperSandboxEvents;
  const candidate = [...keeperSandboxEvents, ...newEvents];
  replayDraft([keeperSandboxConfigEvent(), ...candidate]);
  keeperSandboxEvents = candidate;
  try {
    await setMeta("keeperPredictionSandboxEvents", keeperSandboxEvents);
    renderAll();
    setStatus(keeperOperationStatus, `${message} Private prediction only; public board unchanged.`);
  } catch (error) {
    keeperSandboxEvents = previous;
    renderAll();
    throw error;
  }
}

async function setKeeperWorkspaceMode(mode) {
  if (!['sandbox', 'official'].includes(mode)) return;
  keeperWorkspaceMode = mode;
  await setMeta("keeperWorkspaceMode", mode);
  renderAll();
  showToast(mode === "sandbox" ? "Prediction sandbox active. Public board is protected." : "Official keeper ledger active. Confirmed actions will sync publicly.");
}

async function resetKeeperSandbox() {
  keeperSandboxEvents = [];
  teamASendsPlayerIds = new Set();
  teamBSendsPlayerIds = new Set();
  keeperPlayerSearch.value = "";
  await setMeta("keeperPredictionSandboxEvents", keeperSandboxEvents);
  renderAll();
  setStatus(keeperOperationStatus, "Prediction sandbox reset. Official keeper ledger and public board were not changed.");
}

async function copyOfficialKeeperSetupToSandbox() {
  const voided = new Set(events.filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED).map((event) => event.payload.targetEventId));
  keeperSandboxEvents = events.filter((event) => KEEPER_SETUP_EVENT_TYPES.includes(event.type) && !voided.has(event.id));
  replayDraft([keeperSandboxConfigEvent(), ...keeperSandboxEvents]);
  await setMeta("keeperPredictionSandboxEvents", keeperSandboxEvents);
  renderAll();
  setStatus(keeperOperationStatus, `Prediction sandbox now starts from ${keeperSandboxEvents.length} active official setup action${keeperSandboxEvents.length === 1 ? "" : "s"}. Public board was not changed.`);
}

async function recordSale(event) {
  event.preventDefault();
  const player = selectedPlayer();
  const teamId = saleTeam.value;
  const amount = Number(salePrice.value);
  try {
    if (salesEntryMode !== SALES_ENTRY_MODES.MANUAL) throw new RuleViolation("AUCTIONEER_ENTRY_ACTIVE", "Auctioneer feed is active. Switch to Manual backup before recording a sale here.");
    if (!player || draftState.draftedPlayers[player.id]) throw new RuleViolation("PLAYER_REQUIRED", "Select an available player first.");
    if (!Number.isInteger(amount) || amount < 1) throw new RuleViolation("PRICE_REQUIRED", "Enter a whole-dollar winning price.");
    if (!draftState.currentNominatorTeamId) throw new RuleViolation("DRAFT_COMPLETE", "No nomination remains because all rosters are full.");
    const sale = createEvent(
      EVENT_TYPES.PLAYER_SOLD,
      {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        teamId,
        amount,
        nominatorTeamId: draftState.currentNominatorTeamId,
      },
      { deviceId },
    );
    await commitLocalEvents([sale], `Recorded: ${player.name} to ${draftState.teams[teamId].name} for ${currency(amount)}.`);
    playerSearch.value = "";
    salePrice.value = "";
    selectedPlayerId = availablePlayers()[0]?.id || null;
    renderAll();
    playerSearch.focus();
  } catch (error) {
    setStatus(saleStatus, errorMessage(error), true);
    showToast(errorMessage(error), true);
  }
}

async function undoLastSale() {
  if (salesEntryMode !== SALES_ENTRY_MODES.MANUAL) {
    showToast("Auctioneer feed is active. Corrections belong on the auctioneer screen unless you switch to Manual backup.", true);
    return;
  }
  const target = lastUndoableSale(events);
  if (!target) return;
  try {
    const undo = createEvent(
      EVENT_TYPES.EVENT_VOIDED,
      { targetEventId: target.id, reason: "Immediate user undo" },
      { deviceId },
    );
    selectedPlayerId = target.payload.playerId;
    salePrice.value = "";
    await commitLocalEvents([undo], `Undone: ${target.payload.playerName}. Draft state restored.`);
  } catch (error) {
    setStatus(saleStatus, errorMessage(error), true);
  }
}

async function recordKeeper(event) {
  event.preventDefault();
  await recordKeeperCandidate(selectedKeeperCandidate(), keeperTeam.value);
}

async function recordKeeperCandidate(candidate, teamId) {
  const state = keeperWorkspaceState();
  try {
    if (state.saleCount > 0) throw new RuleViolation("LATE_KEEPER", "Keepers must be assigned before auction purchases begin.");
    const nextTurn = state.keeperSelection.nextSlot;
    if (!nextTurn) throw new RuleViolation("KEEPER_SELECTION_COMPLETE", "All 24 keeper turns are already complete.");
    if (teamId !== nextTurn.teamId) throw new RuleViolation("WRONG_KEEPER_TURN", `${state.teams[nextTurn.teamId].name} is on the clock in Round ${nextTurn.round}. Switch to that team or record/pass the earlier turns first.`);
    if (!candidate || candidate.teamId !== teamId || candidate.keeperYear > 3 || state.draftedPlayers[candidate?.playerId]) {
      throw new RuleViolation("KEEPER_REQUIRED", "Choose an eligible, unassigned keeper first.");
    }
    const player = draftPack.players.find((packPlayer) => packPlayer.id === candidate.playerId);
    if (!player) throw new RuleViolation("KEEPER_PLAYER_MISSING", "That keeper is missing from the validated player pool.");
    const keeper = createEvent(
      EVENT_TYPES.KEEPER_ASSIGNED,
      {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        teamId,
        salary: candidate.keeperSalary,
        keeperYear: candidate.keeperYear,
        selectionRound: nextTurn.round,
        source: `Authenticated ${ROOM_SEASON} keeper candidate`,
      },
      { deviceId },
    );
    await commitKeeperWorkspaceEvents(
      [keeper],
      `Recorded: ${state.teams[teamId].name} keeps ${player.name} for ${currency(candidate.keeperSalary)} in ${keeperContractTenure(candidate.keeperYear).yearLabel}.`,
    );
    keeperPlayerSearch.value = "";
    showToast(`${player.name} recorded as a ${currency(candidate.keeperSalary)} keeper.`);
  } catch (error) {
    setStatus(keeperOperationStatus, errorMessage(error), true);
    showToast(errorMessage(error), true);
  }
}

async function passKeeperTurn(expectedTeamId = null) {
  const state = keeperWorkspaceState();
  try {
    if (state.saleCount > 0) throw new RuleViolation("LATE_KEEPER_PASS", "Keeper turns must be completed before auction purchases begin.");
    const nextTurn = state.keeperSelection.nextSlot;
    if (!nextTurn) throw new RuleViolation("KEEPER_SELECTION_COMPLETE", "All 24 keeper turns are already complete.");
    if (expectedTeamId && expectedTeamId !== nextTurn.teamId) throw new RuleViolation("WRONG_KEEPER_TURN", `${state.teams[nextTurn.teamId].name} is on the clock in Round ${nextTurn.round}.`);
    const pass = createEvent(
      EVENT_TYPES.KEEPER_PASSED,
      { teamId: nextTurn.teamId, round: nextTurn.round, reason: "No keeper selected for this turn" },
      { deviceId },
    );
    await commitKeeperWorkspaceEvents(
      [pass],
      `Recorded: ${state.teams[nextTurn.teamId].name} passes its Round ${nextTurn.round} keeper turn.`,
    );
    showToast(`${state.teams[nextTurn.teamId].name} passed Round ${nextTurn.round}.`);
  } catch (error) {
    setStatus(keeperOperationStatus, errorMessage(error), true);
    showToast(errorMessage(error), true);
  }
}

async function recordCapTransfer(event) {
  event.preventDefault();
  const state = keeperWorkspaceState();
  const buyerTeamId = capFromTeam.value;
  const sellerTeamId = capToTeam.value;
  const amount = Number(capTransferAmount.value);
  const teamASends = selectedTradePlayers(teamASendsPlayerIds);
  const teamBSends = selectedTradePlayers(teamBSendsPlayerIds);
  try {
    if (state.saleCount > 0) throw new RuleViolation("LATE_KEEPER_RIGHTS_TRADE", "Keeper-rights trades must be recorded before auction purchases begin.");
    if (!Number.isInteger(amount) || amount < 0) throw new RuleViolation("CAP_AMOUNT_REQUIRED", "Enter a whole-dollar cap amount, including $0 for a player swap.");
    if (buyerTeamId === sellerTeamId) throw new RuleViolation("SELF_TRANSFER", "Choose different buying and selling teams.");
    if (!teamASends.length && !teamBSends.length) throw new RuleViolation("KEEPER_TRADE_PLAYER_REQUIRED", "Add at least one eligible player to the trade package.");
    if (teamASends.some((candidate) => candidate.teamId !== buyerTeamId || candidate.keeperYear > 3 || state.draftedPlayers[candidate.playerId])) {
      throw new RuleViolation("KEEPER_TRADE_PLAYER_REQUIRED", "Every Team A player must be eligible and currently owned by Team A.");
    }
    if (teamBSends.some((candidate) => candidate.teamId !== sellerTeamId || candidate.keeperYear > 3 || state.draftedPlayers[candidate.playerId])) {
      throw new RuleViolation("KEEPER_TRADE_PLAYER_REQUIRED", "Every Team B player must be eligible and currently owned by Team B.");
    }
    const transfer = createEvent(
      EVENT_TYPES.KEEPER_RIGHTS_TRADED,
      {
        teamAId: buyerTeamId,
        teamBId: sellerTeamId,
        amountFromAToB: amount,
        teamASends: teamASends.map((candidate) => ({ playerId: candidate.playerId, playerName: candidate.playerName })),
        teamBSends: teamBSends.map((candidate) => ({ playerId: candidate.playerId, playerName: candidate.playerName })),
      },
      { deviceId },
    );
    const buyerName = state.teams[buyerTeamId].name;
    const sellerName = state.teams[sellerTeamId].name;
    await commitKeeperWorkspaceEvents(
      [transfer],
      `Recorded complete trade package between ${buyerName} and ${sellerName}${amount ? ` with ${currency(amount)} moving to ${sellerName}` : " with no cap payment"}.`,
    );
    capTransferAmount.value = "0";
    teamASendsPlayerIds = new Set();
    teamBSendsPlayerIds = new Set();
    selectedKeeperEvidenceTeamId = buyerTeamId;
    renderAll();
    showToast("Complete keeper-rights trade recorded as one undoable action.");
  } catch (error) {
    setStatus(keeperOperationStatus, errorMessage(error), true);
    showToast(errorMessage(error), true);
  }
}

async function undoLastKeeperAction() {
  const target = lastUndoableEvent(keeperWorkspaceEventList(), KEEPER_SETUP_EVENT_TYPES);
  if (!target) return;
  try {
    const undo = createEvent(
      EVENT_TYPES.EVENT_VOIDED,
      { targetEventId: target.id, reason: "Immediate keeper setup correction" },
      { deviceId },
    );
    const label = target.type === EVENT_TYPES.KEEPER_ASSIGNED
      ? `${target.payload.playerName} keeper assignment`
      : target.type === EVENT_TYPES.KEEPER_PASSED
        ? `${teamName(target.payload.teamId)} Round ${target.payload.round} pass`
        : target.type === EVENT_TYPES.KEEPER_RIGHTS_TRADED
          ? `${teamName(target.payload.teamAId)} / ${teamName(target.payload.teamBId)} rights trade`
      : `${currency(target.payload.amount)} cap transfer`;
    await commitKeeperWorkspaceEvents([undo], `Undone: ${label}. Keeper setup state restored.`);
    showToast(`Undone: ${label}.`);
  } catch (error) {
    setStatus(keeperOperationStatus, errorMessage(error), true);
    showToast(errorMessage(error), true);
  }
}

function showView(view) {
  currentView = view;
  document.querySelectorAll(".app-tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".page-view").forEach((page) => {
    page.hidden = page.id !== `view-${view}`;
  });
  if (view === "draft") playerSearch.focus();
  if (view === "keepers") requestAnimationFrame(sizeKeeperTradeResultWindows);
  if (view === "settings") void runDraftReadinessCheck({ announce: false });
}

function navigateAppTabs(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...document.querySelectorAll(".app-tab")];
  const currentIndex = Math.max(0, tabs.indexOf(event.target));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : event.key === "ArrowRight"
        ? (currentIndex + 1) % tabs.length
        : (currentIndex - 1 + tabs.length) % tabs.length;
  event.preventDefault();
  const nextTab = tabs[nextIndex];
  showView(nextTab.dataset.view);
  nextTab.focus();
}

async function fetchSession() {
  if (!navigator.onLine) return null;
  const response = await fetch("/api/thunder-bowl/auth", {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(ACCESS_CHECK_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.json();
}

async function rememberDisplayUrl(url) {
  if (!url) return;
  displayBoardUrl = url;
  await setMeta("displayBoardUrl", url);
}

function showApp() {
  sessionStorage.setItem(UNLOCK_SESSION_KEY, "true");
  loginView.hidden = true;
  appView.hidden = false;
  renderAll();
  playerSearch.focus();
  startPracticeClock();
  startPolling();
  schedulePackRefresh();
  scheduleStatusRefresh(50);
  scheduleNewsRefresh(80);
  scheduleResearchRefresh(110);
  void runDraftReadinessCheck({ announce: false });
}

async function attemptLogin(event) {
  event.preventDefault();
  const code = accessCode.value.trim();
  setStatus(loginStatus, navigator.onLine ? "Checking code…" : "Checking offline verifier…");
  try {
    if (navigator.onLine) {
      const response = await fetch("/api/thunder-bowl/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        signal: AbortSignal.timeout(ACCESS_CHECK_TIMEOUT_MS),
      });
      if (response.status === 401) throw new RuleViolation("BAD_CODE", "That access code is not correct.");
      if (!response.ok) throw new Error("Online access check is temporarily unavailable.");
      const data = await response.json();
      await saveOfflineVerifier(code);
      await rememberDisplayUrl(data.displayBoardUrl);
      try {
        const latestPack = await fetchProtectedDraftPack();
        if (latestPack) await applyDraftPack(latestPack, byId("pack-import-status"));
      } catch (packError) {
        showToast(`Access succeeded, but the latest pack refresh did not: ${errorMessage(packError)}`, true);
      }
      accessCode.value = "";
      cloudReachable = true;
      updateNetworkStatus();
      showApp();
      scheduleSync(10);
      return;
    }
    if (!(await verifyOfflineCode(code))) throw new RuleViolation("BAD_OFFLINE_CODE", "That code does not match this laptop's saved offline verifier.");
    accessCode.value = "";
    cloudReachable = false;
    updateNetworkStatus();
    showApp();
    showToast("Offline command center unlocked. Every action will stay queued locally until Wi‑Fi returns.");
  } catch (error) {
    if (!(error instanceof RuleViolation) && (await hasOfflineVerifier())) {
      if (!(await verifyOfflineCode(code))) {
        setStatus(loginStatus, "That code does not match this laptop's saved offline verifier.", true);
        return;
      }
      accessCode.value = "";
      cloudReachable = false;
      updateNetworkStatus();
      showApp();
      showToast("Online access is unavailable. The local command center is unlocked and every action will sync later.");
      return;
    }
    setStatus(loginStatus, errorMessage(error), true);
  }
}

function scheduleSync(delay = 250) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncNow(), delay);
}

async function syncNow() {
  if (LOCAL_ONLY) {
    cloudReachable = true;
    updateNetworkStatus();
    const chip = byId("sync-status");
    chip.textContent = PRACTICE_AUCTION ? "Local practice saved" : "Local replay saved";
    chip.classList.remove("status-warning", "status-danger");
    chip.classList.add("status-good");
    return;
  }
  if (syncInFlight || ledgerResetInFlight || ledgerStale || !navigator.onLine || appView.hidden) return;
  syncInFlight = true;
  const chip = byId("sync-status");
  chip.textContent = "Syncing…";
  chip.classList.remove("status-warning", "status-danger");
  try {
    const response = await fetch("/api/thunder-bowl/ledger", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events, generation: ledgerGeneration }),
    });
    if (response.status === 401) throw new RuleViolation("SESSION_EXPIRED", "Online session expired. Local recording is still safe; sign in again before cloud sync.");
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new RuleViolation(body.code || "CLOUD_SYNC_FAILED", body.error || `Cloud sync returned ${response.status}.`);
    }
    const data = await response.json();
    if (!Number.isSafeInteger(data.generation) || data.generation < 1) {
      throw new RuleViolation("INVALID_LEDGER_GENERATION", "The cloud returned an invalid ledger generation. Local data was retained.");
    }
    cloudReachable = true;
    ledgerStale = false;
    updateNetworkStatus();
    const merged = mergeEventStreams(data.events || [], events);
    events = merged;
    ledgerGeneration = data.generation;
    await Promise.all([replaceEvents(events), setMeta("ledgerGeneration", ledgerGeneration)]);
    await rememberDisplayUrl(data.displayBoardUrl);
    renderAll();
    chip.textContent = salesEntryMode === SALES_ENTRY_MODES.AUCTIONEER ? "Auctioneer feed live" : "Cloud synced";
    chip.classList.add("status-good");
  } catch (error) {
    if (error instanceof RuleViolation && error.code === "LEDGER_GENERATION_MISMATCH") {
      cloudReachable = true;
      ledgerStale = true;
      updateNetworkStatus();
      chip.textContent = "Archived rehearsal · load current";
      chip.classList.remove("status-good", "status-warning");
      chip.classList.add("status-danger");
      showToast(error.message, true);
    } else {
      cloudReachable = false;
      updateNetworkStatus();
      chip.textContent = "Saved locally · sync pending";
      chip.classList.remove("status-good");
      chip.classList.add("status-warning");
      if (error instanceof RuleViolation && error.code === "SESSION_EXPIRED") showToast(error.message, true);
    }
  } finally {
    syncInFlight = false;
  }
}

function startPolling() {
  clearInterval(pollTimer);
  if (LOCAL_ONLY) return;
  const pollIntervalMs = currentSalesEntryPolicy().pollIntervalMs;
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, pollIntervalMs);
}

function schedulePackRefresh(delay = PACK_REFRESH_INTERVAL_MS) {
  clearTimeout(packRefreshTimer);
  packRefreshTimer = setTimeout(() => void refreshPackInBackground(), delay);
}

async function refreshPackInBackground() {
  if (packRefreshInFlight || !navigator.onLine || appView.hidden) {
    schedulePackRefresh();
    return;
  }
  packRefreshInFlight = true;
  try {
    const latestPack = await fetchProtectedDraftPack();
    if (latestPack) {
      await applyDraftPack(latestPack, byId("pack-import-status"));
      showToast(`Player evidence refreshed: ${latestPack.packId}.`);
    }
  } catch (error) {
    if (error instanceof RuleViolation && error.code === "SESSION_EXPIRED") showToast(error.message, true);
  } finally {
    packRefreshInFlight = false;
    schedulePackRefresh();
  }
}

function validateLiveStatusSnapshot(input) {
  if (!input || input.schemaVersion !== 2 || input.source !== "Sleeper NFL player map" || input.modelEffect !== "none") {
    throw new Error("The live status response failed its source contract.");
  }
  if (input.packId !== draftPack.packId || !Number.isFinite(Date.parse(input.capturedAt)) || !Array.isArray(input.updates) || input.updates.length > 1000) {
    throw new Error("The live status response does not match the active draft pack.");
  }
  const knownPlayers = new Set(draftPack.players.map((player) => player.id));
  const updates = input.updates.map((update) => {
    if (!update || typeof update.playerId !== "string" || !knownPlayers.has(update.playerId)) throw new Error("Live status contains an unknown player.");
    if (!["critical", "high", "moderate", "clear", "unknown"].includes(update.severity)) throw new Error("Live status contains an invalid severity.");
    if (!["fresh", "stale", "undated", "invalid"].includes(update.freshness)) throw new Error("Live status contains invalid freshness evidence.");
    for (const field of ["injuryBodyPart", "injuryStartDate", "injuryNotes", "practiceParticipation", "practiceDescription", "depthChartPosition"]) {
      if (typeof update[field] !== "string" || update[field].length > 300) throw new Error(`Live status contains invalid ${field} evidence.`);
    }
    if (update.depthChartOrder !== null && (!Number.isInteger(update.depthChartOrder) || update.depthChartOrder < 1 || update.depthChartOrder > 20)) {
      throw new Error("Live status contains an invalid depth-chart order.");
    }
    for (const forbidden of ["projectedPoints", "projectionSources", "weeklyProjection", "weeklyContext", "managerProfiles", "pressureIndex", "opponentPressure", "vbd", "intrinsicValue", "marketValue", "maxBid", "keeperValue"]) {
      if (forbidden in update) throw new Error(`Live status attempted to supply forbidden value field ${forbidden}.`);
    }
    return update;
  });
  return { ...input, updates };
}

function applyLiveStatusSnapshot(snapshot) {
  liveStatusError = null;
  liveStatusSnapshot = snapshot;
  liveStatusByPlayerId = new Map(snapshot.updates.map((update) => [update.playerId, update]));
  renderSelectedPlayer();
  renderPackStatus();
  if (playerIntelDialog.open && intelPlayerId) renderPlayerIntel();
}

function validateLiveNewsSnapshot(input) {
  if (!input || input.schemaVersion !== 2 || input.source !== "RotoWire NFL player news RSS" || input.modelEffect !== "none") {
    throw new Error("The live news response failed its source contract.");
  }
  if (!Number.isFinite(Date.parse(input.capturedAt)) || input.refreshMinutes !== 10 || input.archiveWindowDays !== 45 || !Number.isSafeInteger(input.currentItemCount) || input.currentItemCount < 1 || !Number.isSafeInteger(input.archiveItemCount) || input.archiveItemCount !== input.items?.length || !Array.isArray(input.items) || input.items.length > 1000 || !/^[a-f0-9]{64}$/.test(input.rawSha256 || "")) {
    throw new Error("The live news response has invalid provenance.");
  }
  const ids = new Set();
  const items = input.items.map((item) => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) throw new Error("Live news contains a duplicate or invalid item id.");
    ids.add(item.id);
    if (typeof item.title !== "string" || !item.title || item.title.length > 240 || typeof item.description !== "string" || !item.description || item.description.length > 2000) {
      throw new Error("Live news contains invalid headline text.");
    }
    const url = new URL(item.url);
    if (url.protocol !== "https:" || !["rotowire.com", "www.rotowire.com"].includes(url.hostname) || !Number.isFinite(Date.parse(item.publishedAt))) {
      throw new Error("Live news contains an invalid source link or timestamp.");
    }
    for (const forbidden of ["projectedPoints", "weeklyProjection", "weeklyContext", "vbd", "intrinsicValue", "marketValue", "maxBid", "keeperValue", "recommendedBid"]) {
      if (forbidden in item) throw new Error(`Live news attempted to supply forbidden value field ${forbidden}.`);
    }
    return { ...item, url: url.toString() };
  });
  return { ...input, items };
}

function applyLiveNewsSnapshot(snapshot) {
  liveNewsError = null;
  liveNewsSnapshot = snapshot;
  if (playerIntelDialog.open && intelPlayerId) renderPlayerIntel();
}

function scheduleNewsRefresh(delay = NEWS_REFRESH_INTERVAL_MS) {
  clearTimeout(newsRefreshTimer);
  if (REPLAY_2025) return;
  newsRefreshTimer = setTimeout(() => void refreshLiveNews(), delay);
}

async function refreshLiveNews({ force = false } = {}) {
  if (REPLAY_2025) return liveNewsSnapshot;
  if (newsRefreshInFlight || !navigator.onLine || appView.hidden) {
    scheduleNewsRefresh();
    return liveNewsSnapshot;
  }
  newsRefreshInFlight = true;
  try {
    const priorEtag = await getMeta("liveNewsEtag");
    const response = await fetch(`${LIVE_NEWS_URL}${force ? "?force=1" : ""}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: !force && priorEtag ? { "If-None-Match": priorEtag } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304 && !liveNewsSnapshot) {
      await setMeta("liveNewsEtag", null);
      throw new Error("The news cache marker had no saved snapshot; retry scheduled.");
    }
    if (response.status !== 304) {
      if (response.status === 401) throw new RuleViolation("SESSION_EXPIRED", "Sign in again before refreshing player news.");
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.diagnostic || failure.error || "Player news is temporarily unavailable.");
      }
      const snapshot = validateLiveNewsSnapshot(await response.json());
      const etag = response.headers.get("etag");
      await Promise.all([
        setMeta("liveNewsSnapshot", snapshot),
        etag ? setMeta("liveNewsEtag", etag) : Promise.resolve(),
      ]);
      applyLiveNewsSnapshot(snapshot);
    }
  } catch (error) {
    liveNewsError = error instanceof Error ? error.message : "Player news is temporarily unavailable.";
    if (playerIntelDialog.open && intelPlayerId) renderPlayerIntel();
    if (error instanceof RuleViolation && error.code === "SESSION_EXPIRED") showToast(error.message, true);
  } finally {
    newsRefreshInFlight = false;
    scheduleNewsRefresh();
  }
  return liveNewsSnapshot;
}

function applyLiveResearchSnapshot(snapshot) {
  liveResearchError = null;
  liveResearchSnapshot = snapshot;
  if (playerIntelDialog.open && intelPlayerId) renderPlayerIntel();
}

function scheduleResearchRefresh(delay = RESEARCH_REFRESH_INTERVAL_MS) {
  clearTimeout(researchRefreshTimer);
  if (REPLAY_2025) return;
  researchRefreshTimer = setTimeout(() => void refreshLiveResearch(), delay);
}

async function refreshLiveResearch({ force = false } = {}) {
  if (REPLAY_2025) return liveResearchSnapshot;
  if (researchRefreshInFlight || !navigator.onLine || appView.hidden) {
    scheduleResearchRefresh();
    return liveResearchSnapshot;
  }
  researchRefreshInFlight = true;
  try {
    const priorEtag = await getMeta("liveResearchEtag");
    const response = await fetch(`${LIVE_RESEARCH_URL}${force ? "?force=1" : ""}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: !force && priorEtag ? { "If-None-Match": priorEtag } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 304 && !liveResearchSnapshot) {
      await setMeta("liveResearchEtag", null);
      throw new Error("The research cache marker had no saved snapshot; retry scheduled.");
    }
    if (response.status !== 304) {
      if (response.status === 401) throw new RuleViolation("SESSION_EXPIRED", "Sign in again before refreshing FBG/CBS research.");
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.diagnostic || failure.error || "FBG/CBS research is temporarily unavailable.");
      }
      const snapshot = validateResearchSnapshot(await response.json());
      const etag = response.headers.get("etag");
      await Promise.all([
        setMeta("liveResearchSnapshot", snapshot),
        etag ? setMeta("liveResearchEtag", etag) : Promise.resolve(),
      ]);
      applyLiveResearchSnapshot(snapshot);
    }
  } catch (error) {
    liveResearchError = error instanceof Error ? error.message : "FBG/CBS research is temporarily unavailable.";
    if (playerIntelDialog.open && intelPlayerId) renderPlayerIntel();
    if (error instanceof RuleViolation && error.code === "SESSION_EXPIRED") showToast(error.message, true);
  } finally {
    researchRefreshInFlight = false;
    scheduleResearchRefresh();
  }
  return liveResearchSnapshot;
}

function scheduleStatusRefresh(delay = STATUS_REFRESH_INTERVAL_MS) {
  clearTimeout(statusRefreshTimer);
  if (REPLAY_2025) return;
  statusRefreshTimer = setTimeout(() => void refreshLiveStatus(), delay);
}

async function refreshLiveStatus({ force = false } = {}) {
  if (REPLAY_2025) return liveStatusSnapshot;
  if (statusRefreshInFlight || !navigator.onLine || appView.hidden) {
    scheduleStatusRefresh();
    return liveStatusSnapshot;
  }
  statusRefreshInFlight = true;
  try {
    const priorEtag = await getMeta("liveStatusEtag");
    const response = await fetch(`${LIVE_STATUS_URL}${force ? "?force=1" : ""}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: !force && priorEtag ? { "If-None-Match": priorEtag } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304 && !liveStatusSnapshot) {
      await setMeta("liveStatusEtag", null);
      throw new Error("The live-status cache marker had no saved snapshot; retry scheduled.");
    }
    if (response.status !== 304) {
      if (response.status === 401) throw new RuleViolation("SESSION_EXPIRED", "Sign in again before refreshing live injury status.");
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.diagnostic || failure.error || "Live injury status is temporarily unavailable.");
      }
      const snapshot = validateLiveStatusSnapshot(await response.json());
      const etag = response.headers.get("etag");
      await Promise.all([
        setMeta("liveStatusSnapshot", snapshot),
        etag ? setMeta("liveStatusEtag", etag) : Promise.resolve(),
      ]);
      applyLiveStatusSnapshot(snapshot);
    }
  } catch (error) {
    liveStatusError = error instanceof Error ? error.message : "Live injury status is temporarily unavailable.";
    renderPackStatus();
    if (error instanceof RuleViolation && error.code === "SESSION_EXPIRED") showToast(error.message, true);
  } finally {
    statusRefreshInFlight = false;
    scheduleStatusRefresh();
  }
  return liveStatusSnapshot;
}

function morningPlayerCoverage(statusSnapshot, newsSnapshot, researchSnapshot) {
  const statusIds = new Set(statusSnapshot.updates.map((update) => update.playerId));
  const cbsByName = new Map();
  for (const item of researchSnapshot.cbsNews.items) {
    const key = normalizedNewsText(item.playerName);
    cbsByName.set(key, (cbsByName.get(key) || 0) + 1);
  }
  const rows = draftPack.players.map((player) => {
    const normalizedName = normalizedNewsText(player.name);
    const depthEligible = ["QB", "RB", "WR", "TE", "K"].includes(player.position);
    const fbgDepth = depthEligible && Boolean(playerFbgDepth(player, researchSnapshot).selected);
    const cbsItems = cbsByName.get(normalizedName) || 0;
    const rotowireItems = newsSnapshot.items.filter((item) => normalizedNewsText(`${item.title} ${item.description}`).includes(normalizedName)).length;
    return {
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      status: statusIds.has(player.id),
      depthEligible,
      fbgDepth,
      cbsItems,
      rotowireItems,
    };
  });
  return {
    rows,
    summary: {
      playersScanned: rows.length,
      statusMatchedPlayers: rows.filter((row) => row.status).length,
      depthEligiblePlayers: rows.filter((row) => row.depthEligible).length,
      fbgDepthMatchedPlayers: rows.filter((row) => row.fbgDepth).length,
      cbsPlayersWithNews: rows.filter((row) => row.cbsItems > 0).length,
      rotowirePlayersWithNews: rows.filter((row) => row.rotowireItems > 0).length,
      playersWithAnyNews: rows.filter((row) => row.cbsItems > 0 || row.rotowireItems > 0).length,
      cbsArchiveItems: researchSnapshot.cbsNews.archiveItemCount,
      rotowireArchiveItems: newsSnapshot.archiveItemCount,
    },
  };
}

function validateMorningIntelligenceSnapshot(input) {
  if (!input || input.schemaVersion !== MORNING_INTELLIGENCE_SCHEMA_VERSION || input.modelEffect !== "none" || input.ledgerEffect !== "none" || input.packId !== draftPack.packId || !Number.isFinite(Date.parse(input.capturedAt))) {
    throw new Error("The draft-morning intelligence lockbox does not match the active player pack.");
  }
  const statusSnapshot = validateLiveStatusSnapshot(input.sourceSnapshots?.status);
  const newsSnapshot = validateLiveNewsSnapshot(input.sourceSnapshots?.rotowire);
  const researchSnapshot = validateResearchSnapshot(input.sourceSnapshots?.research);
  if (!Array.isArray(input.playerCoverage) || input.playerCoverage.length !== draftPack.players.length || input.coverage?.playersScanned !== draftPack.players.length) {
    throw new Error("The draft-morning intelligence lockbox did not scan the complete player pack.");
  }
  const knownIds = new Set(draftPack.players.map((player) => player.id));
  const coverageIds = new Set();
  for (const row of input.playerCoverage) {
    if (!row || !knownIds.has(row.playerId) || coverageIds.has(row.playerId) || !Number.isSafeInteger(row.cbsItems) || row.cbsItems < 0 || !Number.isSafeInteger(row.rotowireItems) || row.rotowireItems < 0) throw new Error("The draft-morning intelligence lockbox contains invalid player coverage.");
    coverageIds.add(row.playerId);
  }
  for (const forbidden of ["projectedPoints", "weeklyProjection", "weeklyContext", "vbd", "intrinsicValue", "marketValue", "maxBid", "keeperValue", "recommendedBid"]) {
    if (forbidden in input || input.playerCoverage.some((row) => forbidden in row)) throw new Error(`The draft-morning intelligence lockbox attempted to supply forbidden value field ${forbidden}.`);
  }
  return { ...input, sourceSnapshots: { status: statusSnapshot, rotowire: newsSnapshot, research: researchSnapshot } };
}

function buildMorningIntelligenceSnapshot() {
  if (!liveStatusSnapshot || !liveNewsSnapshot || !liveResearchSnapshot) throw new Error("All three player-intelligence sources must be saved before sealing the morning lockbox.");
  const coverage = morningPlayerCoverage(liveStatusSnapshot, liveNewsSnapshot, liveResearchSnapshot);
  const staleSources = [
    liveStatusSnapshot.staleFallback || liveStatusError ? "Sleeper status" : null,
    liveNewsSnapshot.staleFallback || liveNewsError ? "RotoWire" : null,
    liveResearchSnapshot.staleFallback || liveResearchError ? "Footballguys/CBS" : null,
  ].filter(Boolean);
  return validateMorningIntelligenceSnapshot({
    schemaVersion: MORNING_INTELLIGENCE_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    packId: draftPack.packId,
    modelEffect: "none",
    ledgerEffect: "none",
    staleSources,
    coverage: coverage.summary,
    playerCoverage: coverage.rows,
    sourceSnapshots: {
      status: liveStatusSnapshot,
      rotowire: liveNewsSnapshot,
      research: liveResearchSnapshot,
    },
  });
}

function renderMorningIntelligenceStatus() {
  const snapshot = morningIntelligenceSnapshot;
  byId("morning-intelligence-time").textContent = snapshot ? dateTime(snapshot.capturedAt) : "Not captured";
  byId("morning-intelligence-players").textContent = snapshot ? `${snapshot.coverage.playersScanned} / ${draftPack.players.length}` : `0 / ${draftPack?.players?.length || 0}`;
  byId("morning-intelligence-status-coverage").textContent = snapshot ? `${snapshot.coverage.statusMatchedPlayers} matched` : "—";
  byId("morning-intelligence-depth").textContent = snapshot ? `${snapshot.coverage.fbgDepthMatchedPlayers} / ${snapshot.coverage.depthEligiblePlayers} eligible` : "—";
  byId("morning-intelligence-news").textContent = snapshot ? `${snapshot.coverage.playersWithAnyNews} players · ${snapshot.coverage.cbsArchiveItems + snapshot.coverage.rotowireArchiveItems} saved items` : "—";
  byId("export-morning-intelligence").disabled = !snapshot;
}

async function waitForIntelligenceRefreshes() {
  const deadline = Date.now() + 25_000;
  while (statusRefreshInFlight || newsRefreshInFlight || researchRefreshInFlight) {
    if (Date.now() >= deadline) throw new Error("A background player-intelligence refresh did not finish in time. Try the morning capture again.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function captureMorningIntelligence() {
  const button = byId("capture-morning-intelligence");
  const status = byId("morning-intelligence-action-status");
  if (REPLAY_2025) {
    setStatus(status, "Current-season morning intelligence is disabled in the 2025 replay to prevent hindsight.", true);
    return;
  }
  if (!navigator.onLine) {
    setStatus(status, "Internet is unavailable. The last sealed lockbox remains stored locally; reconnect before creating a new one.", true);
    return;
  }
  if (morningIntelligenceInFlight) return;
  morningIntelligenceInFlight = true;
  button.disabled = true;
  button.textContent = "Scanning every player…";
  setStatus(status, `Refreshing injury status, Footballguys depth charts, CBS news, and RotoWire news before scanning all ${draftPack.players.length} players…`);
  try {
    await waitForIntelligenceRefreshes();
    await Promise.all([
      refreshLiveStatus({ force: true }),
      refreshLiveNews({ force: true }),
      refreshLiveResearch({ force: true }),
    ]);
    morningIntelligenceSnapshot = buildMorningIntelligenceSnapshot();
    await setMeta("morningIntelligenceSnapshot", morningIntelligenceSnapshot);
    renderMorningIntelligenceStatus();
    void runDraftReadinessCheck({ announce: false });
    const coverage = morningIntelligenceSnapshot.coverage;
    const stale = morningIntelligenceSnapshot.staleSources.length
      ? ` Saved fallbacks were required for ${morningIntelligenceSnapshot.staleSources.join(", ")}; retry while online before leaving.`
      : " All source captures are current and available offline.";
    setStatus(status, `Scanned ${coverage.playersScanned} players. Stored ${coverage.cbsArchiveItems} CBS and ${coverage.rotowireArchiveItems} RotoWire items; ${coverage.fbgDepthMatchedPlayers} of ${coverage.depthEligiblePlayers} eligible players matched Footballguys.${stale}`, morningIntelligenceSnapshot.staleSources.length > 0);
  } catch (error) {
    setStatus(status, `Morning intelligence capture failed safely: ${errorMessage(error)} The previous lockbox remains intact.`, true);
  } finally {
    morningIntelligenceInFlight = false;
    button.disabled = false;
    button.textContent = "Capture all player intelligence now";
  }
}

function exportMorningIntelligence() {
  const status = byId("morning-intelligence-action-status");
  try {
    if (!morningIntelligenceSnapshot) throw new Error("Run the full morning capture before downloading a backup.");
    const stamp = morningIntelligenceSnapshot.capturedAt.replace(/[:.]/g, "-");
    downloadJSON(`thunder-bowl-2026-morning-intelligence-${stamp}.json`, morningIntelligenceSnapshot);
    setStatus(status, "Downloaded the complete offline player-intelligence lockbox.");
  } catch (error) {
    setStatus(status, errorMessage(error), true);
  }
}

function absoluteBoardUrl() {
  return displayBoardUrl ? new URL(displayBoardUrl, window.location.origin).toString() : null;
}

function openBoard() {
  if (LOCAL_ONLY) {
    showToast(PRACTICE_AUCTION ? "The projector board is disabled in private auto-auction practice." : "The projector board is disabled in the isolated 2025 replay.", true);
    return;
  }
  const url = absoluteBoardUrl();
  if (!url) {
    showToast("Connect online once to receive the isolated projector link.", true);
    return;
  }
  window.open(url, "thunder-bowl-public-board", "noopener");
}

async function copyBoardLink() {
  if (LOCAL_ONLY) {
    setStatus(byId("board-link-status"), PRACTICE_AUCTION ? "The projector board is disabled in private auto-auction practice." : "The projector board is disabled in the isolated 2025 replay.", true);
    return;
  }
  const url = absoluteBoardUrl();
  if (!url) {
    setStatus(byId("board-link-status"), "Connect online once to receive the projector link.", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    setStatus(byId("board-link-status"), "Projector link copied.");
  } catch {
    setStatus(byId("board-link-status"), "Clipboard access was blocked. Open the board and copy its address from the browser.", true);
  }
}

function downloadJSON(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(filename, value, type = "text/plain;charset=utf-8") {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportKeeperBoard() {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`thunder-bowl-2026-keeper-board-${stamp}.csv`, keeperBoardCsv(keeperBoardRows), "text/csv;charset=utf-8");
    setStatus(byId("keeper-export-status"), `Exported ${keeperBoardRows.length} candidates from ${draftPack.packId}. Trade ranges are advisory and use current practice values.`);
  } catch (error) {
    setStatus(byId("keeper-export-status"), `Keeper export failed safely: ${errorMessage(error)}`, true);
  }
}

function exportDraftHistory() {
  try {
    const rows = buildDraftHistoryRows({ events, pack: draftPack });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const mode = REPLAY_2025 ? "-replay" : PRACTICE_AUCTION ? "-practice" : "";
    downloadText(
      `thunder-bowl-${ROOM_SEASON}${mode}-draft-history-${stamp}.csv`,
      draftHistoryCsv(rows),
      "text/csv;charset=utf-8",
    );
    setStatus(byId("draft-history-status"), `Exported ${rows.length} active setup and auction rows from ${draftPack.packId}.`);
  } catch (error) {
    setStatus(byId("draft-history-status"), errorMessage(error), true);
  }
}

function currentPersonalBoardBundle() {
  return createPersonalBoardBundle({
    season: ROOM_SEASON,
    packId: draftPack.packId,
    players: draftPack.players,
    annotations: playerAnnotations,
  });
}

function personalBoardFilename(extension) {
  const mode = REPLAY_2025 ? "-replay" : PRACTICE_AUCTION ? "-practice" : "";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `thunder-bowl-${ROOM_SEASON}${mode}-personal-board-${stamp}.${extension}`;
}

async function recordPersonalBoardEvidence(bundle, action) {
  personalBoardBackupEvidence = await createPersonalBoardEvidence({ bundle, action });
  await setMeta("personalBoardBackupEvidence", personalBoardBackupEvidence);
  renderPersonalBoardPortability();
}

async function exportPersonalBoard() {
  try {
    const bundle = currentPersonalBoardBundle();
    downloadJSON(personalBoardFilename("json"), bundle);
    await recordPersonalBoardEvidence(bundle, "export");
    await runDraftReadinessCheck({ announce: false });
    setStatus(byId("personal-board-status"), `Private JSON backup downloaded with ${bundle.entries.length} player decisions. Use this file to restore or move them to your Mac.`);
  } catch (error) {
    setStatus(byId("personal-board-status"), errorMessage(error), true);
  }
}

function exportPersonalBoardCsv() {
  try {
    const bundle = currentPersonalBoardBundle();
    downloadText(personalBoardFilename("csv"), personalBoardCsv(bundle), "text/csv;charset=utf-8");
    setStatus(byId("personal-board-status"), `Spreadsheet copy downloaded with ${bundle.entries.length} player decisions. Import the JSON version to restore data.`);
  } catch (error) {
    setStatus(byId("personal-board-status"), errorMessage(error), true);
  }
}

async function importPersonalBoard(file) {
  const status = byId("personal-board-status");
  const priorAnnotations = playerAnnotations;
  const priorEvidence = personalBoardBackupEvidence;
  const priorSerialized = localStorage.getItem(PLAYER_ANNOTATIONS_KEY);
  let localStorageChanged = false;
  try {
    const bundle = validatePersonalBoardBundle(await parseFile(file), { season: ROOM_SEASON, players: draftPack.players });
    const knownPlayerIds = draftPack.players.map((player) => player.id);
    const nextAnnotations = bundle.scope === "full-board"
      ? replacePersonalBoardAnnotations(bundle, knownPlayerIds)
      : mergePersonalBoardAnnotations(playerAnnotations, bundle, knownPlayerIds);
    const clearedCount = Object.keys(playerAnnotations).filter((playerId) => !(playerId in nextAnnotations)).length;
    const nextBundle = createPersonalBoardBundle({
      season: ROOM_SEASON,
      packId: draftPack.packId,
      players: draftPack.players,
      annotations: nextAnnotations,
    });
    const nextEvidence = bundle.scope === "full-board"
      ? await createPersonalBoardEvidence({ bundle: nextBundle, action: "import" })
      : null;

    localStorage.setItem(PLAYER_ANNOTATIONS_KEY, JSON.stringify(nextAnnotations));
    localStorageChanged = true;
    await setMeta("personalBoardBackupEvidence", nextEvidence);
    playerAnnotations = nextAnnotations;
    personalBoardBackupEvidence = nextEvidence;
    renderAll();
    await runDraftReadinessCheck({ announce: false });
    setStatus(status, bundle.scope === "full-board"
      ? `Restored the complete personal board from ${bundle.sourcePackId}: ${bundle.entries.length} decision${bundle.entries.length === 1 ? "" : "s"} loaded and ${clearedCount} older local decision${clearedCount === 1 ? "" : "s"} cleared. No projections, VBD, prices, or draft events changed.`
      : `Imported legacy schema-v1 decisions from ${bundle.sourcePackId} as a safe merge. Existing decisions were preserved because old files cannot transmit deletions. Export a new full-board JSON on the source computer before relying on Mac transfer readiness.`);
  } catch (error) {
    playerAnnotations = priorAnnotations;
    personalBoardBackupEvidence = priorEvidence;
    if (localStorageChanged) {
      if (priorSerialized === null) localStorage.removeItem(PLAYER_ANNOTATIONS_KEY);
      else localStorage.setItem(PLAYER_ANNOTATIONS_KEY, priorSerialized);
      try { await setMeta("personalBoardBackupEvidence", priorEvidence); } catch { /* Best-effort rollback after a storage failure. */ }
    }
    renderAll();
    setStatus(status, `Import failed safely; the previous personal board was restored. ${errorMessage(error)}`, true);
  } finally {
    byId("personal-board-file").value = "";
  }
}

function exportRecovery() {
  try {
    const exportedAt = new Date().toISOString();
    const bundle = createRecoveryBundle(draftPack, events, exportedAt);
    const stamp = exportedAt.replace(/[:.]/g, "-");
    downloadJSON(`thunder-bowl-${ROOM_SEASON}${REPLAY_2025 ? "-replay" : PRACTICE_AUCTION ? "-practice" : ""}-recovery-${stamp}.json`, bundle);
    lastRecoveryExportAt = exportedAt;
    void setMeta("lastRecoveryExportAt", exportedAt);
    void runDraftReadinessCheck({ announce: false });
    setStatus(byId("recovery-status"), "Recovery bundle downloaded.");
    return true;
  } catch (error) {
    setStatus(byId("recovery-status"), errorMessage(error), true);
    return false;
  }
}

function resetArchiveDialog() {
  byId("archive-confirmation").value = "";
  byId("confirm-archive").disabled = true;
  setStatus(byId("archive-dialog-status"), "");
}

function openArchiveDialog() {
  resetArchiveDialog();
  byId("archive-dialog").showModal();
  byId("archive-confirmation").focus();
}

async function loadCurrentCloudLedger() {
  const status = byId("archive-status");
  try {
    if (LOCAL_ONLY) throw new RuleViolation("LOCAL_ONLY", PRACTICE_AUCTION ? "Private practice never reads or changes the live cloud ledger." : "The 2025 replay never reads or changes the 2026 cloud ledger.");
    if (!navigator.onLine) throw new RuleViolation("CLOUD_REQUIRED", "Reconnect before loading the current cloud rehearsal.");
    if (syncInFlight || ledgerResetInFlight) {
      throw new RuleViolation("SYNC_IN_PROGRESS", "Another cloud operation is finishing. Try again in a moment.");
    }
    ledgerResetInFlight = true;
    setStatus(status, "Saving this local ledger before loading the current rehearsal…");
    if (!exportRecovery()) {
      throw new RuleViolation("RECOVERY_EXPORT_FAILED", "The recovery download failed, so local data was not replaced.");
    }
    const response = await fetch("/api/thunder-bowl/ledger", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new RuleViolation("SESSION_EXPIRED", "Online session expired. Sign in again before loading the current rehearsal.");
    if (!response.ok) throw new RuleViolation(data.code || "CLOUD_LOAD_FAILED", data.error || "The current cloud rehearsal could not be loaded.");
    if (!Number.isSafeInteger(data.generation) || data.generation < 1 || !Array.isArray(data.events)) {
      throw new RuleViolation("INVALID_CLOUD_LEDGER", "The cloud ledger failed validation. Local data was not replaced.");
    }
    replayDraft(data.events);
    events = data.events;
    ledgerGeneration = data.generation;
    ledgerStale = false;
    cloudReachable = true;
    selectedPlayerId = null;
    await Promise.all([replaceEvents(events), setMeta("ledgerGeneration", ledgerGeneration)]);
    await rememberDisplayUrl(data.displayBoardUrl);
    await ensureConfigurationEvent();
    updateNetworkStatus();
    renderAll();
    setStatus(status, `Current cloud rehearsal loaded at generation ${ledgerGeneration}. The prior local ledger was downloaded first.`);
    showToast("Current cloud rehearsal loaded. Recording is ready.");
    scheduleSync(20);
  } catch (error) {
    setStatus(status, errorMessage(error), true);
  } finally {
    ledgerResetInFlight = false;
  }
}

async function archiveAndStartNew(event) {
  event.preventDefault();
  const status = byId("archive-dialog-status");
  const confirmation = byId("archive-confirmation").value;
  const confirmButton = byId("confirm-archive");
  try {
    if (confirmation !== "ARCHIVE AND START NEW") {
      throw new RuleViolation("ARCHIVE_CONFIRMATION_REQUIRED", "Type the exact confirmation phrase first.");
    }
    if (LOCAL_ONLY) {
      ledgerResetInFlight = true;
      confirmButton.disabled = true;
      setStatus(status, PRACTICE_AUCTION ? "Saving this practice draft before resetting it…" : "Saving this replay before resetting it…");
      if (!exportRecovery()) throw new RuleViolation("RECOVERY_EXPORT_FAILED", PRACTICE_AUCTION ? "The recovery download failed, so practice was not reset." : "The recovery download failed, so the replay was not reset.");
      events = [];
      ledgerGeneration = null;
      ledgerStale = false;
      selectedPlayerId = null;
      practiceSession = null;
      await Promise.all([replaceEvents(events), setMeta("ledgerGeneration", null), setMeta("practiceAuctionSession", null)]);
      await ensureConfigurationEvent();
      await ensureReplayFirstRoundKeepers();
      renderAll();
      byId("archive-dialog").close();
      setStatus(byId("archive-status"), PRACTICE_AUCTION ? "Saved the prior practice and started a clean local auction." : "Saved the prior replay and started a clean local 2025 ledger.");
      showToast(PRACTICE_AUCTION ? "Clean auto-auction practice ready." : "Clean 2025 replay ready.");
      return;
    }
    if (!navigator.onLine || !cloudReachable) {
      throw new RuleViolation("ARCHIVE_REQUIRES_CLOUD", "Reconnect and complete a cloud sync before archiving this rehearsal.");
    }
    if (syncInFlight) throw new RuleViolation("SYNC_IN_PROGRESS", "Cloud sync is finishing. Try again in a moment.");
    if (!Number.isSafeInteger(ledgerGeneration) || ledgerGeneration < 1) {
      throw new RuleViolation("SYNC_REQUIRED", "Complete one cloud sync before archiving this rehearsal.");
    }
    if (ledgerStale) {
      throw new RuleViolation("LEDGER_GENERATION_MISMATCH", "Load the current cloud rehearsal before using practice controls.");
    }

    ledgerResetInFlight = true;
    confirmButton.disabled = true;
    setStatus(status, "Downloading recovery and preserving the cloud ledger…");
    if (!exportRecovery()) {
      throw new RuleViolation("RECOVERY_EXPORT_FAILED", "The recovery download failed, so the ledger was not reset.");
    }

    const response = await fetch("/api/thunder-bowl/admin", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "archive-reset",
        confirmation,
        generation: ledgerGeneration,
        reason: byId("archive-reason").value,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new RuleViolation("SESSION_EXPIRED", "Online session expired. Sign in again before archiving.");
    if (!response.ok) throw new RuleViolation(data.code || "ARCHIVE_FAILED", data.error || "The rehearsal was not reset.");
    if (!Number.isSafeInteger(data.generation) || data.generation <= ledgerGeneration) {
      throw new RuleViolation("INVALID_LEDGER_GENERATION", "The archive completed without a valid new generation. Reload before recording.");
    }

    events = [];
    ledgerGeneration = data.generation;
    ledgerStale = false;
    selectedPlayerId = null;
    await Promise.all([replaceEvents(events), setMeta("ledgerGeneration", ledgerGeneration)]);
    await ensureConfigurationEvent();
    renderAll();
    byId("archive-dialog").close();
    setStatus(
      byId("archive-status"),
      `Archived ${data.archive?.eventCount ?? 0} events. New rehearsal generation ${ledgerGeneration} is ready.`,
    );
    showToast("Recovery downloaded. Cloud archive preserved. New rehearsal ready.");
    scheduleSync(20);
  } catch (error) {
    setStatus(status, errorMessage(error), true);
  } finally {
    ledgerResetInFlight = false;
    confirmButton.disabled = byId("archive-confirmation").value !== "ARCHIVE AND START NEW";
  }
}

async function parseFile(file) {
  if (!file) throw new Error("Choose a JSON file first.");
  if (file.size > 10 * 1024 * 1024) throw new Error("That file is larger than the 10 MB import limit.");
  return JSON.parse(await file.text());
}

async function applyDraftPack(nextPack, status) {
    const currentConfig = draftState.config;
    const sameConfig = JSON.stringify(currentConfig) === JSON.stringify(nextPack.leagueConfig);
    if (!sameConfig) {
      if (!canReplaceUnstartedConfiguration(events)) {
        throw new RuleViolation("CONFIG_LOCKED", "This pack changes league setup after draft activity exists. Import it into a fresh recovery state instead.");
      }
      const oldConfig = activeConfigEvent();
      const replacements = [];
      if (oldConfig) {
        replacements.push(createEvent(EVENT_TYPES.EVENT_VOIDED, { targetEventId: oldConfig.id, reason: "Replaced by validated draft pack" }, { deviceId }));
      }
      replacements.push(createEvent(EVENT_TYPES.DRAFT_CONFIGURED, nextPack.leagueConfig, { deviceId }));
      await commitLocalEvents(replacements, "League configuration replaced by the validated draft pack.");
    }
    draftPack = nextPack;
    loadPlayerAnnotations();
    await setMeta("draftPack", draftPack);
    await ensureReplayFirstRoundKeepers();
    selectedPlayerId = null;
    renderAll();
    setStatus(status, `${draftPack.packId} imported and validated.`);
}

async function importDraftPack(file) {
  const status = byId("pack-import-status");
  try {
    await applyDraftPack(validateDraftPack(await parseFile(file)), status);
  } catch (error) {
    setStatus(status, errorMessage(error), true);
  }
}

async function loadBundledDraftPack() {
  const status = byId("pack-import-status");
  try {
    setStatus(status, "Loading the latest private 2026 pack…");
    await applyDraftPack(await fetchProtectedDraftPack(false), status);
  } catch (error) {
    setStatus(status, errorMessage(error), true);
  }
}

async function importRecovery(file) {
  const status = byId("recovery-status");
  try {
    const bundle = validateRecoveryBundle(await parseFile(file));
    const meaningfulLocal = events.some(
      (event) => event.type !== EVENT_TYPES.DRAFT_CONFIGURED && event.type !== EVENT_TYPES.EVENT_VOIDED,
    );
    const nextEvents = meaningfulLocal ? mergeEventStreams(bundle.events, events) : bundle.events;
    replayDraft(nextEvents);
    draftPack = bundle.pack;
    loadPlayerAnnotations();
    events = nextEvents;
    await Promise.all([setMeta("draftPack", draftPack), replaceEvents(events)]);
    selectedPlayerId = null;
    renderAll();
    setStatus(status, `Recovery merged: ${events.length} audited events loaded.`);
    scheduleSync(20);
  } catch (error) {
    setStatus(status, errorMessage(error), true);
  }
}

function bindInteractions() {
  loginForm.addEventListener("submit", (event) => void attemptLogin(event));
  saleForm.addEventListener("submit", (event) => void recordSale(event));
  undoSaleButton.addEventListener("click", () => void undoLastSale());
  byId("sales-mode-auctioneer").addEventListener("click", () => void changeSalesEntryMode(SALES_ENTRY_MODES.AUCTIONEER));
  byId("sales-mode-manual").addEventListener("click", () => void changeSalesEntryMode(SALES_ENTRY_MODES.MANUAL));
  keeperAssignmentForm.addEventListener("submit", (event) => void recordKeeper(event));
  capTransferForm.addEventListener("submit", (event) => void recordCapTransfer(event));
  passKeeperTurnButton.addEventListener("click", () => void passKeeperTurn());
  byId("keeper-evidence-pass").addEventListener("click", () => void passKeeperTurn(selectedKeeperEvidenceTeamId));
  undoKeeperActionButton.addEventListener("click", () => void undoLastKeeperAction());
  byId("keeper-mode-sandbox").addEventListener("click", () => void setKeeperWorkspaceMode("sandbox"));
  byId("keeper-mode-official").addEventListener("click", () => void setKeeperWorkspaceMode("official"));
  byId("keeper-sandbox-reset").addEventListener("click", () => void resetKeeperSandbox());
  byId("keeper-sandbox-copy-official").addEventListener("click", () => void copyOfficialKeeperSetupToSandbox());
  byId("keeper-evidence-details").addEventListener("toggle", (event) => {
    renderKeeperEvidenceDisclosure();
    void setMeta("keeperEvidenceExpanded", event.currentTarget.open);
  });
  byId("keeper-evidence-team").addEventListener("change", (event) => {
    const teamId = event.currentTarget.value;
    if (!draftState.config.nominationOrder.includes(teamId)) return;
    selectedKeeperEvidenceTeamId = teamId;
    keeperRows();
    renderKeeperOperations();
    void setMeta("keeperEvidenceTeamId", teamId);
  });
  byId("keeper-market-team").addEventListener("change", (event) => {
    const teamId = event.currentTarget.value;
    if (!draftState.config.nominationOrder.includes(teamId)) return;
    selectedKeeperMarketTeamId = teamId;
    renderKeeperTradeMarket();
  });
  window.addEventListener("resize", () => requestAnimationFrame(sizeKeeperTradeResultWindows));
  keeperPlayerSearch.addEventListener("input", renderKeeperOperations);
  keeperPlayer.addEventListener("change", () => {
    updateKeeperSelectionSummary();
  });
  keeperTeam.addEventListener("change", updateKeeperSelectionSummary);
  capFromTeam.addEventListener("change", () => {
    if (capFromTeam.value === capToTeam.value) {
      capToTeam.value = keeperWorkspaceState().config.teams.find((team) => team.id !== capFromTeam.value)?.id || "";
    }
    renderKeeperOperations();
  });
  capToTeam.addEventListener("change", () => {
    renderKeeperOperations();
  });
  byId("add-cap-transfer-player").addEventListener("click", () => addPlayerToTrade("B_TO_A"));
  byId("add-cap-return-player").addEventListener("click", () => addPlayerToTrade("A_TO_B"));
  capTransferPlayer.addEventListener("change", updateCapTransferSummary);
  capReturnPlayer.addEventListener("change", updateCapTransferSummary);
  capTransferAmount.addEventListener("input", updateCapTransferSummary);
  playerSearch.addEventListener("input", () => {
    renderPlayerPool();
    renderSelectedPlayer();
  });
  positionFilter.addEventListener("change", () => {
    renderPlayerPool();
    renderSelectedPlayer();
  });
  playerRows.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-player-id]");
    if (button) selectPlayer(button.dataset.playerId, !PRACTICE_AUCTION);
  });
  playerRows.addEventListener("contextmenu", (event) => {
    const target = event.target.closest("[data-player-id]");
    if (!target) return;
    event.preventDefault();
    openPlayerIntel(target.dataset.playerId);
  });
  playerSearch.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key) || !visiblePlayerIds.length) return;
    event.preventDefault();
    const currentIndex = Math.max(0, visiblePlayerIds.indexOf(selectedPlayerId));
    const nextIndex = event.key === "ArrowDown"
      ? Math.min(visiblePlayerIds.length - 1, currentIndex + 1)
      : event.key === "ArrowUp"
        ? Math.max(0, currentIndex - 1)
        : currentIndex;
    selectPlayer(visiblePlayerIds[nextIndex], event.key === "Enter");
  });
  document.querySelectorAll(".app-tab").forEach((tab) => {
    tab.addEventListener("click", () => showView(tab.dataset.view));
    tab.addEventListener("keydown", navigateAppTabs);
  });
  byId("open-board").addEventListener("click", openBoard);
  byId("open-board-settings").addEventListener("click", openBoard);
  byId("copy-board-link").addEventListener("click", () => void copyBoardLink());
  byId("run-readiness").addEventListener("click", () => void runDraftReadinessCheck());
  for (const input of humanRehearsalInputs()) input.addEventListener("change", refreshHumanRehearsalControls);
  byId("seal-human-rehearsal").addEventListener("click", () => void sealHumanRehearsal());
  byId("clear-human-rehearsal").addEventListener("click", () => void clearHumanRehearsal());
  byId("capture-morning-intelligence").addEventListener("click", () => void captureMorningIntelligence());
  byId("export-morning-intelligence").addEventListener("click", exportMorningIntelligence);
  byId("open-emergency-board").addEventListener("click", openEmergencyBoard);
  byId("export-keeper-board").addEventListener("click", exportKeeperBoard);
  byId("export-draft-history").addEventListener("click", exportDraftHistory);
  byId("export-personal-board").addEventListener("click", () => void exportPersonalBoard());
  byId("export-personal-board-csv").addEventListener("click", exportPersonalBoardCsv);
  byId("print-emergency-board").addEventListener("click", printEmergencyBoard);
  byId("close-emergency-board").addEventListener("click", () => byId("emergency-board-dialog").close());
  byId("export-recovery").addEventListener("click", exportRecovery);
  byId("export-recovery-top").addEventListener("click", exportRecovery);
  byId("load-bundled-pack").addEventListener("click", () => void loadBundledDraftPack());
  byId("capture-cbs-rosters").addEventListener("click", () => void captureCbsRosters());
  byId("export-cbs-rosters").addEventListener("click", exportCbsRosterSnapshot);
  byId("priority-use-suggested").addEventListener("click", () => {
    const suggested = draftPack?.weeklyContext?.suggestedScenario;
    if (!suggested) return;
    byId("priority-baseline-weight").value = "1.00";
    byId("priority-division-weight").value = Number(suggested.division).toFixed(2);
    byId("priority-playoff-weight").value = Number(suggested.playoffs).toFixed(2);
    byId("priority-experimental-mode").checked = true;
    priorityControlsDirty = true;
    setStatus(byId("priority-settings-status"), "The 1.20 division / 1.40 playoff idea is staged. Choose Save preview settings to apply it privately.");
  });
  for (const controlId of ["priority-experimental-mode", "priority-baseline-weight", "priority-division-weight", "priority-playoff-weight"]) {
    byId(controlId).addEventListener("input", () => { priorityControlsDirty = true; });
  }
  byId("priority-apply").addEventListener("click", async () => {
    try {
      const next = priorityScenarioFromControls();
      await savePriorityScenario(
        next,
        next.mode === "experimental"
          ? `Experimental preview saved: ordinary ${next.baseline.toFixed(2)}×, division ${next.division.toFixed(2)}×, playoffs ${next.playoffs.toFixed(2)}×. VBD and bid limits are unchanged.`
          : "Baseline saved. Experimental timing is off and authoritative projections are unchanged.",
      );
    } catch (error) {
      setStatus(byId("priority-settings-status"), errorMessage(error), true);
    }
  });
  byId("priority-reset").addEventListener("click", () => void savePriorityScenario(
    DEFAULT_PRIORITY_SCENARIO,
    "Reset to baseline 1.00 / 1.00 / 1.00. No draft value or ledger data changed.",
  ));
  byId("draft-pack-file").addEventListener("change", (event) => void importDraftPack(event.target.files?.[0]));
  byId("recovery-file").addEventListener("change", (event) => void importRecovery(event.target.files?.[0]));
  byId("personal-board-file").addEventListener("change", (event) => void importPersonalBoard(event.target.files?.[0]));
  byId("open-archive-dialog").addEventListener("click", openArchiveDialog);
  byId("load-current-ledger").addEventListener("click", () => void loadCurrentCloudLedger());
  byId("cancel-archive").addEventListener("click", () => byId("archive-dialog").close());
  byId("archive-confirmation").addEventListener("input", (event) => {
    byId("confirm-archive").disabled = event.target.value !== "ARCHIVE AND START NEW" || ledgerResetInFlight;
  });
  byId("archive-form").addEventListener("submit", (event) => void archiveAndStartNew(event));
  practiceStartButton.addEventListener("click", () => void startNextPracticeNomination());
  practiceBidButton.addEventListener("click", () => void recordPracticeUserBid());
  practicePassButton.addEventListener("click", () => void passPracticeAuction());
  practicePauseButton.addEventListener("click", () => void togglePracticePause());
  playerIntelForm.addEventListener("submit", savePlayerIntel);
  byId("close-player-intel").addEventListener("click", closePlayerIntel);
  byId("clear-player-intel").addEventListener("click", clearPlayerIntel);
  byId("intel-news-link").addEventListener("click", () => void refreshPlayerNewsInApp());
  byId("intel-cbs-link").addEventListener("click", () => void refreshResearchInApp("cbs"));
  byId("intel-fbg-link").addEventListener("click", () => void refreshResearchInApp("fbg"));
  for (const control of playerIntelForm.querySelectorAll('input[name="playerTag"], #intel-steal-price, #intel-personal-max')) {
    control.addEventListener("input", updateIntelEffectiveLimit);
  }
  byId("refresh-player-intel").addEventListener("click", async () => {
    setStatus(byId("player-intel-status"), navigator.onLine ? "Refreshing live status and source-linked news…" : "Offline: showing the last saved status and news.");
    if (navigator.onLine) await Promise.all([refreshLiveStatus(), refreshLiveNews(), refreshLiveResearch()]);
    renderPlayerIntel();
    setStatus(byId("player-intel-status"), navigator.onLine ? "Live status and news checks finished." : "Offline evidence loaded.");
  });
  playerIntelDialog.addEventListener("close", () => { intelPlayerId = null; });
  window.addEventListener("online", () => {
    updateNetworkStatus();
    scheduleSync(20);
    schedulePackRefresh(1000);
    scheduleStatusRefresh(1200);
    scheduleNewsRefresh(1400);
    scheduleResearchRefresh(1600);
  });
  window.addEventListener("offline", updateNetworkStatus);
  window.addEventListener("storage", (event) => {
    if (event.key !== PLAYER_ANNOTATIONS_KEY || !draftPack) return;
    personalBoardBackupEvidence = null;
    loadPlayerAnnotations();
    renderAll();
    setStatus(byId("personal-board-status"), "Personal board changed in another Thunder Bowl tab. Download a new private JSON before moving it to the MacBook.");
    void runDraftReadinessCheck({ announce: false });
  });
  document.addEventListener("keydown", (event) => {
    const command = event.metaKey || event.ctrlKey;
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement;
    if (command && event.key.toLowerCase() === "k") {
      event.preventDefault();
      showView("draft");
      playerSearch.focus();
      playerSearch.select();
    } else if (command && event.key === "Enter" && currentView === "draft") {
      event.preventDefault();
      if (PRACTICE_AUCTION) void recordPracticeUserBid();
      else saleForm.requestSubmit();
    } else if (command && event.key.toLowerCase() === "z" && currentView === "draft") {
      event.preventDefault();
      if (!PRACTICE_AUCTION || !practiceSession) void undoLastSale();
    } else if (event.key === "Escape" && currentView === "draft") {
      playerSearch.value = "";
      positionFilter.value = "ALL";
      renderPlayerPool();
      renderSelectedPlayer();
      playerSearch.focus();
    } else if (PRACTICE_AUCTION && currentView === "draft" && !typing && (event.code === "Space" || event.key.toLowerCase() === "b")) {
      event.preventDefault();
      void recordPracticeUserBid();
    } else if (currentView === "draft" && !typing && event.key.toLowerCase() === "i" && selectedPlayerId) {
      event.preventDefault();
      openPlayerIntel(selectedPlayerId);
    }
  });
}

async function bootstrap() {
  if (REPLAY_2025) {
    document.title = "Thunder Bowl 2025 Replay Sandbox";
    byId("login-title").textContent = "Thunder Bowl 2025 Replay";
    byId("command-center-title").textContent = "Thunder Bowl 2025 Replay";
    byId("projection-evidence-title").textContent = "2025 projection vs actual";
    byId("projection-evidence-rule").textContent = "Only preseason “primary” drove value";
    byId("league-keeper-title").textContent = "League keeper selections";
    byId("league-keeper-note").textContent = "The actual first round is loaded. Every round-two slot stays open so you can practice the remaining choices, trades, or passes.";
    byId("load-bundled-pack").textContent = "Reload private 2025 replay pack";
    byId("replay-mode-link").href = "./";
    byId("replay-mode-link").textContent = "Return to 2026 draft room";
    byId("practice-mode-top").href = "?mode=practice-auction";
    byId("practice-mode-top").textContent = "Practice draft";
    byId("open-board").disabled = true;
    byId("open-board-settings").disabled = true;
    byId("copy-board-link").disabled = true;
    byId("load-current-ledger").hidden = true;
    byId("open-archive-dialog").textContent = "Save & reset local replay";
    byId("archive-card-title").textContent = "Reset this local replay";
    byId("archive-card-copy").textContent = "Download a recovery file, then clear only the isolated 2025 practice ledger. The 2026 room is never touched.";
    byId("archive-dialog-copy").textContent = "This first downloads a complete replay recovery file, then clears only this browser's isolated 2025 replay. The 2026 room and cloud ledger are never touched.";
    byId("confirm-archive").textContent = "Download & reset local replay";
  } else if (PRACTICE_AUCTION) {
    document.title = "Thunder Bowl 2026 Auto-Auction Practice";
    document.body.classList.add("practice-auction-mode");
    byId("login-title").textContent = "Thunder Bowl 2026 Practice";
    byId("command-center-title").textContent = "Thunder Bowl Auto-Auction Practice";
    byId("sale-form").hidden = true;
    byId("practice-console").hidden = false;
    byId("practice-mode-link").href = "./";
    byId("practice-mode-link").textContent = "Return to 2026 draft room";
    byId("practice-mode-top").href = "./";
    byId("practice-mode-top").textContent = "Exit practice";
    byId("open-board").disabled = true;
    byId("open-board-settings").disabled = true;
    byId("copy-board-link").disabled = true;
    byId("load-current-ledger").hidden = true;
    byId("open-archive-dialog").textContent = "Save & reset local practice";
    byId("archive-card-title").textContent = "Reset auto-auction practice";
    byId("archive-card-copy").textContent = "Download a recovery file, then clear only the isolated local practice auction. The real draft room is never touched.";
    byId("archive-dialog-copy").textContent = "This first downloads a complete practice recovery file, then clears only this browser's isolated auto-auction practice. The real draft room and cloud ledger are never touched.";
    byId("confirm-archive").textContent = "Download & reset local practice";
  }
  bindInteractions();
  updateNetworkStatus();
  try {
    registerOfflineShell().catch(() => null);
    deviceId = await getOrCreateDeviceId();
    const session = await fetchSession().catch(() => null);
    draftPack = await loadPack(Boolean(session?.authenticated));
    const savedKeeperEvidenceTeamId = await getMeta("keeperEvidenceTeamId", "dogs-of-war");
    selectedKeeperEvidenceTeamId = draftPack.leagueConfig.teams.some((team) => team.id === savedKeeperEvidenceTeamId)
      ? savedKeeperEvidenceTeamId
      : "dogs-of-war";
    if (!LOCAL_ONLY) humanRehearsalEvidence = await getMeta("humanRehearsalEvidence");
    byId("keeper-evidence-details").open = await getMeta("keeperEvidenceExpanded", false) === true;
    renderKeeperEvidenceDisclosure();
    try {
      priorityScenario = validatePriorityScenario(await getMeta("priorityWeightScenario", DEFAULT_PRIORITY_SCENARIO));
    } catch {
      priorityScenario = DEFAULT_PRIORITY_SCENARIO;
      await setMeta("priorityWeightScenario", priorityScenario);
    }
    if (!draftPack.weeklyContext) priorityScenario = DEFAULT_PRIORITY_SCENARIO;
    if (!REPLAY_2025) {
      const savedCbsSnapshot = await getMeta("cbsRosterSnapshot");
      if (savedCbsSnapshot) {
        try {
          cbsRosterSnapshot = validateCbsRosterSnapshot(savedCbsSnapshot);
          cbsRosterChanges = compareCbsRosterSnapshots(null, cbsRosterSnapshot);
        } catch {
          cbsRosterSnapshot = null;
          cbsRosterChanges = null;
          await setMeta("cbsRosterSnapshot", null);
        }
      }
    }
    loadPlayerAnnotations();
    const savedPersonalBoardEvidence = await getMeta("personalBoardBackupEvidence");
    if (savedPersonalBoardEvidence) {
      try {
        personalBoardBackupEvidence = validatePersonalBoardEvidence(savedPersonalBoardEvidence, { season: ROOM_SEASON });
      } catch {
        personalBoardBackupEvidence = null;
        await setMeta("personalBoardBackupEvidence", null);
      }
    }
    const savedStatus = await getMeta("liveStatusSnapshot");
    if (savedStatus?.packId === draftPack.packId) {
      try {
        applyLiveStatusSnapshot(validateLiveStatusSnapshot(savedStatus));
      } catch {
        liveStatusSnapshot = null;
        liveStatusByPlayerId = new Map();
      }
    }
    if (!REPLAY_2025) {
      const savedNews = await getMeta("liveNewsSnapshot");
      if (savedNews) {
        try {
          applyLiveNewsSnapshot(validateLiveNewsSnapshot(savedNews));
        } catch {
          liveNewsSnapshot = null;
        }
      }
      const savedResearch = await getMeta("liveResearchSnapshot");
      if (savedResearch) {
        try {
          applyLiveResearchSnapshot(validateResearchSnapshot(savedResearch));
        } catch {
          liveResearchSnapshot = null;
          await setMeta("liveResearchSnapshot", null);
        }
      }
      const savedMorningIntelligence = await getMeta("morningIntelligenceSnapshot");
      if (savedMorningIntelligence) {
        try {
          morningIntelligenceSnapshot = validateMorningIntelligenceSnapshot(savedMorningIntelligence);
          if (!liveStatusSnapshot) applyLiveStatusSnapshot(morningIntelligenceSnapshot.sourceSnapshots.status);
          if (!liveNewsSnapshot) applyLiveNewsSnapshot(morningIntelligenceSnapshot.sourceSnapshots.rotowire);
          if (!liveResearchSnapshot) applyLiveResearchSnapshot(morningIntelligenceSnapshot.sourceSnapshots.research);
        } catch {
          morningIntelligenceSnapshot = null;
          await setMeta("morningIntelligenceSnapshot", null);
        }
      }
    }
    events = await readEvents();
    salesEntryMode = normalizeSalesEntryMode(await getMeta("salesEntryMode", SALES_ENTRY_MODES.AUCTIONEER), { localOnly: LOCAL_ONLY });
    const savedKeeperWorkspaceMode = await getMeta("keeperWorkspaceMode", "sandbox");
    keeperWorkspaceMode = savedKeeperWorkspaceMode === "official" ? "official" : "sandbox";
    const savedKeeperSandboxEvents = await getMeta("keeperPredictionSandboxEvents", []);
    try {
      keeperSandboxEvents = Array.isArray(savedKeeperSandboxEvents) ? savedKeeperSandboxEvents : [];
      replayKeeperSandbox();
    } catch {
      keeperSandboxEvents = [];
      await setMeta("keeperPredictionSandboxEvents", keeperSandboxEvents);
      replayKeeperSandbox();
    }
    ledgerGeneration = await getMeta("ledgerGeneration");
    await ensureConfigurationEvent();
    await ensureReplayFirstRoundKeepers();
    if (PRACTICE_AUCTION) {
      const savedPracticeSession = await getMeta("practiceAuctionSession");
      if (savedPracticeSession) {
        try {
          practiceSession = validatePracticeSession(savedPracticeSession);
        } catch {
          practiceSession = null;
          await setMeta("practiceAuctionSession", null);
        }
      }
    }
    displayBoardUrl = await getMeta("displayBoardUrl");
    lastRecoveryExportAt = await getMeta("lastRecoveryExportAt");
    renderAll();

    if (session?.authenticated) {
      await rememberDisplayUrl(session.displayBoardUrl);
      showApp();
      scheduleSync(20);
      return;
    }
    if (!navigator.onLine && sessionStorage.getItem(UNLOCK_SESSION_KEY) === "true") {
      showApp();
      showToast("Offline mode restored. New events will remain on this laptop until reconnection.");
      return;
    }
    loginView.hidden = false;
    appView.hidden = true;
    const offlineReady = await hasOfflineVerifier();
    setStatus(
      loginStatus,
      navigator.onLine
        ? "Enter your access code."
        : offlineReady
          ? "Internet is unavailable. Your saved offline verifier is ready."
          : "Internet is unavailable and this laptop has not completed its morning access check.",
      !navigator.onLine && !offlineReady,
    );
    accessCode.focus();
  } catch (error) {
    loginView.hidden = false;
    appView.hidden = true;
    setStatus(loginStatus, `Startup check failed: ${errorMessage(error)}`, true);
  }
}

void bootstrap();
