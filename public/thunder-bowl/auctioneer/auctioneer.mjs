import { createDataSource } from "../shared/data-source.mjs";
import { assertLeagueLegality, assertPublicSnapshot, downloadAuditCsv, downloadBoardCsv, evaluateDraftCompletion, evaluatePurchase, publicPlayerSearch, teamSummary } from "../shared/public-core.mjs";
import { demoMode } from "../shared/addon-config.mjs";
import { projectorPresenceIsFresh, readProjectorPresence, subscribeProjectorPresence } from "../shared/projector-presence.mjs";
import { evaluateDraftReadiness } from "../shared/readiness.mjs";
import { clockFromSnapshot, formatNominationClock } from "../shared/nomination-clock.mjs?v=20260808-cloud";
import { nextClockAlert } from "../shared/clock-alert-policy.mjs";

const source = createDataSource("auctioneer");
const isDemo = demoMode();
const loginPanel = document.getElementById("login-panel");
const consoleView = document.getElementById("console");
const loginStatus = document.getElementById("login-status");
const saleStatus = document.getElementById("sale-status");
const syncState = document.getElementById("sync-state");
const historyPanel = document.querySelector(".history-panel");
const historyRows = document.getElementById("history-rows");
const historySearch = document.getElementById("history-search");
const playerSearch = document.getElementById("player-search");
const playerResults = document.getElementById("player-results");
const saleTeam = document.getElementById("sale-team");
const salePrice = document.getElementById("sale-price");
const recordSaleButton = document.getElementById("record-sale");
const editDialog = document.getElementById("edit-dialog");
const keypadDialog = document.getElementById("keypad-dialog");
const reconciliationDialog = document.getElementById("reconciliation-dialog");
const readinessDialog = document.getElementById("readiness-dialog");
const boardLink = document.getElementById("board-link");
const projectorState = document.getElementById("projector-state");
const finishDialog = document.getElementById("finish-dialog");
const shareDialog = document.getElementById("share-dialog");
let snapshot = null;
let refreshInFlight = false;
let commandInFlight = false;
let cloudReady = isDemo || navigator.onLine;
let reconciliationMode = false;
let lastChangedAssignmentId = null;
let keypadBuffer = "";
let selectedPlayerId = null;
let nominationIntentVersion = 0;
let nominationCommandQueue = Promise.resolve(false);
let focusedPlayerResultIndex = -1;
let pendingUndoAssignmentId = null;
let pendingUndoTimer = null;
let lastProjectorPresence = readProjectorPresence();
const stagedAssignmentIds = new Set();
const TEAM_SHORTCUTS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || "");
const shortcutModifier = isMac ? "Option" : "Alt";
const clockSoundTabId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
let clockAlertTracker = { second: null, buzzed: false };
let clockAudioContext = null;
let clockOwnerRenewedAt = 0;
let clockSoundTestTimer = null;

if (!isDemo) boardLink.href = "../board";

function setStatus(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("is-error", error);
}

function option(value, label, disabled = false) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  element.disabled = disabled;
  return element;
}

function playTone(success, force = false) {
  if (!force && document.getElementById("sale-sounds-enabled")?.checked === false) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = success ? "sine" : "square";
    oscillator.frequency.setValueAtTime(success ? 740 : 190, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(success ? 0.11 : 0.08, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (success ? 0.18 : 0.3));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (success ? 0.2 : 0.32));
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Audio feedback is helpful but must never block auction recording.
  }
}

function clockSoundsEnabled() {
  return localStorage.getItem("thunder-bowl-clock-sounds") !== "off";
}

function activateClockSoundOwner() {
  localStorage.setItem("thunder-bowl-clock-sound-owner", JSON.stringify({ id: clockSoundTabId, expiresAt: Date.now() + 4 * 60 * 60 * 1000 }));
  clockOwnerRenewedAt = Date.now();
  if (clockSoundsEnabled()) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      clockAudioContext ||= new AudioContext();
      void clockAudioContext.resume();
    }
  }
}

function ownsClockSound() {
  let owner;
  try { owner = JSON.parse(localStorage.getItem("thunder-bowl-clock-sound-owner") || "null"); } catch { return false; }
  if (owner?.id !== clockSoundTabId || owner.expiresAt < Date.now()) return false;
  if (Date.now() - clockOwnerRenewedAt > 10_000) activateClockSoundOwner();
  return true;
}

function playClockAlert(kind) {
  if (!clockSoundsEnabled() || !ownsClockSound()) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    clockAudioContext ||= new AudioContext();
    void clockAudioContext.resume();
    const now = clockAudioContext.currentTime;
    const gain = clockAudioContext.createGain();
    gain.connect(clockAudioContext.destination);
    if (kind === "tick") {
      const oscillator = clockAudioContext.createOscillator();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(1250, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.32, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);
      oscillator.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + 0.11);
      return;
    }
    for (const frequency of [120, 168]) {
      const oscillator = clockAudioContext.createOscillator();
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + 1.45);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.42, now + 0.02);
    gain.gain.setValueAtTime(0.42, now + 1.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.45);
  } catch {
    // Clock visuals remain authoritative if the browser or operating system blocks audio.
  }
}

function renderClockSoundButton() {
  const button = document.getElementById("clock-sound");
  const enabled = clockSoundsEnabled();
  button.textContent = `Clock sound: ${enabled ? "On" : "Off"}`;
  button.setAttribute("aria-pressed", String(enabled));
}

function runClockSoundTest() {
  const live = clockFromSnapshot(snapshot?.clock);
  const button = document.getElementById("test-clock-alerts");
  if (live.status === "running") {
    setStatus(saleStatus, "Pause the live nomination clock before testing its final ten seconds.", true);
    return;
  }
  if (clockSoundTestTimer) return;
  localStorage.setItem("thunder-bowl-clock-sounds", "on");
  renderClockSoundButton();
  activateClockSoundOwner();
  let second = 10;
  button.disabled = true;
  button.textContent = `Testing ${second}…`;
  playClockAlert("tick");
  clockSoundTestTimer = window.setInterval(() => {
    second -= 1;
    if (second > 0) {
      button.textContent = `Testing ${second}…`;
      playClockAlert("tick");
      return;
    }
    window.clearInterval(clockSoundTestTimer);
    clockSoundTestTimer = null;
    button.textContent = "Buzzer!";
    playClockAlert("buzzer");
    window.setTimeout(() => { button.disabled = false; button.textContent = "Test final 10 seconds"; }, 1600);
  }, 1000);
}

function activePlayerIds() {
  return new Set(snapshot.assignments.filter((assignment) => assignment.status === "active").map((assignment) => assignment.playerId));
}

function selectedPlayer() {
  if (!snapshot || !selectedPlayerId) return null;
  const player = snapshot.availablePlayers.find((candidate) => candidate.id === selectedPlayerId);
  return player && !activePlayerIds().has(player.id) ? player : null;
}

function assignmentTeamName(assignment) {
  return snapshot.teams.find((team) => team.id === assignment.teamId)?.name || assignment.teamId;
}

function richTeamLabel(team) {
  const summary = teamSummary(snapshot, team.id);
  return `${team.name}${summary.isFinished ? " — FINISHED" : ""} — $${summary.remainingCap} left · up to ${summary.openSlots} more · max $${summary.legalMaxBid}`;
}

function playerOptionElements(selectedPlayerId = null) {
  return snapshot.availablePlayers.map((player) => option(player.id, `${player.name} — ${player.position} ${player.nflTeam}`, activePlayerIds().has(player.id) && player.id !== selectedPlayerId));
}

function teamOptionElements(disableFinished = false) {
  return snapshot.teams.map((team) => option(team.id, richTeamLabel(team), disableFinished && (snapshot.finishedTeamIds || []).includes(team.id)));
}

function publishNominationIntent(playerId) {
  const intentVersion = ++nominationIntentVersion;
  nominationCommandQueue = nominationCommandQueue.then(() => {
    if (intentVersion !== nominationIntentVersion) return false;
    return runCommand(playerId
      ? { type: "stage-nomination", playerId }
      : { type: "clear-nomination" }, { quiet: true });
  });
  return nominationCommandQueue;
}

function selectPlayer(player, moveForward = false) {
  if (!player || activePlayerIds().has(player.id)) return;
  selectedPlayerId = player.id;
  playerSearch.value = player.name;
  playerResults.hidden = true;
  playerSearch.setAttribute("aria-expanded", "false");
  focusedPlayerResultIndex = -1;
  updateSelectedPlayer();
  activateClockSoundOwner();
  void publishNominationIntent(player.id);
  if (moveForward) saleTeam.focus();
}

function renderPlayerResults() {
  playerResults.replaceChildren();
  const query = playerSearch.value.trim();
  if (!query || selectedPlayer()) {
    playerResults.hidden = true;
    playerSearch.setAttribute("aria-expanded", "false");
    return;
  }
  const matches = publicPlayerSearch(snapshot.availablePlayers, query).slice(0, 8);
  const activeByPlayer = new Map(snapshot.assignments.filter((assignment) => assignment.status === "active").map((assignment) => [assignment.playerId, assignment]));
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "player-results-empty";
    empty.textContent = "No matching players. Try a name, position, or NFL team.";
    playerResults.append(empty);
  }
  matches.forEach((player, index) => {
    const assignment = activeByPlayer.get(player.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `player-result${index === focusedPlayerResultIndex ? " is-focused" : ""}`;
    button.disabled = Boolean(assignment);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === focusedPlayerResultIndex ? "true" : "false");
    const identity = document.createElement("span");
    const playerName = document.createElement("strong");
    playerName.textContent = player.name;
    const playerMeta = document.createElement("small");
    playerMeta.textContent = `${player.position} · ${player.nflTeam}`;
    identity.append(playerName, playerMeta);
    const state = document.createElement("em");
    state.textContent = assignment ? `DRAFTED · ${assignmentTeamName(assignment)} · $${assignment.price}` : "AVAILABLE";
    button.append(identity, state);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => selectPlayer(player, true));
    playerResults.append(button);
  });
  playerResults.hidden = false;
  playerSearch.setAttribute("aria-expanded", "true");
}

function renderQuickTeams() {
  const grid = document.getElementById("quick-team-grid");
  grid.replaceChildren();
  snapshot.teams.forEach((team, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.teamId = team.id;
    button.classList.toggle("is-selected", saleTeam.value === team.id);
    button.classList.toggle("is-finished", (snapshot.finishedTeamIds || []).includes(team.id));
    button.disabled = (snapshot.finishedTeamIds || []).includes(team.id);
    button.title = `${richTeamLabel(team)} · ${shortcutModifier}+${TEAM_SHORTCUTS[index]}`;
    button.append(document.createTextNode(team.name));
    const shortcut = document.createElement("kbd");
    shortcut.textContent = `${isMac ? "⌥" : "Alt+"}${TEAM_SHORTCUTS[index]}`;
    button.append(shortcut);
    button.addEventListener("click", () => selectBuyingTeam(team.id));
    grid.append(button);
  });
}

function selectBuyingTeam(teamId) {
  if (!snapshot.teams.some((team) => team.id === teamId)) return;
  if ((snapshot.finishedTeamIds || []).includes(teamId)) {
    setStatus(saleStatus, `${snapshot.teams.find((team) => team.id === teamId)?.name || "That team"} is finished. Reopen it from Finish draft before recording another purchase.`, true);
    return;
  }
  saleTeam.value = teamId;
  renderQuickTeams();
  updateRecordAvailability();
  salePrice.focus();
}

function populateControls() {
  const currentSaleTeam = saleTeam.value;
  const prompt = option("", "Choose a team for this sale", true);
  prompt.selected = true;
  saleTeam.replaceChildren(prompt, ...teamOptionElements(true));
  if (snapshot.teams.some((team) => team.id === currentSaleTeam) && !(snapshot.finishedTeamIds || []).includes(currentSaleTeam)) saleTeam.value = currentSaleTeam;
  renderQuickTeams();

  const editPlayer = document.getElementById("edit-player");
  const editTeam = document.getElementById("edit-team");
  const selectedEditPlayer = editPlayer.value;
  const selectedEditTeam = editTeam.value;
  editPlayer.replaceChildren(...playerOptionElements(selectedEditPlayer));
  editTeam.replaceChildren(...teamOptionElements());
  if (selectedEditPlayer) editPlayer.value = selectedEditPlayer;
  if (selectedEditTeam) editTeam.value = selectedEditTeam;
}

function updateSelectedPlayer() {
  const player = selectedPlayer();
  const card = document.getElementById("selected-player-card");
  card.hidden = !player;
  if (player) {
    document.getElementById("selected-player-position").textContent = player.position;
    document.getElementById("selected-player-name").textContent = player.name;
    document.getElementById("selected-player-team").textContent = player.nflTeam;
  }
  updateRecordAvailability();
  return player;
}

function updateRecordAvailability() {
  const price = Number(salePrice.value);
  const ready = Boolean(snapshot && cloudReady && !commandInFlight && selectedPlayer() && saleTeam.value && Number.isInteger(price) && price >= 1);
  recordSaleButton.disabled = !ready;
  recordSaleButton.textContent = ready ? `Record $${price} sale` : "Record sale";
  document.getElementById("clear-sale").disabled = commandInFlight;
  document.getElementById("offline-warning").hidden = cloudReady;
  renderPendingSale();
}

function renderPendingSale() {
  const preview = document.getElementById("pending-sale-preview");
  const player = selectedPlayer();
  const team = snapshot?.teams.find((candidate) => candidate.id === saleTeam.value);
  const price = Number(salePrice.value);
  if (!player || !team || !Number.isInteger(price) || price < 1) {
    preview.hidden = true;
    preview.classList.remove("is-illegal");
    return;
  }
  const summary = teamSummary(snapshot, team.id);
  const legality = evaluatePurchase(snapshot, { playerId: player.id, teamId: team.id, price });
  preview.hidden = false;
  preview.classList.toggle("is-illegal", !legality.legal);
  document.getElementById("pending-sale-sentence").textContent = `${player.name} → ${team.name} for $${price}${legality.legal ? "" : " · ILLEGAL"}`;
  document.getElementById("impact-before").textContent = `$${summary.remainingCap}`;
  document.getElementById("impact-price").textContent = `$${price}`;
  document.getElementById("impact-after").textContent = `$${summary.remainingCap - price}`;
  document.getElementById("impact-open").textContent = String(summary.openSlots - 1);
  document.getElementById("impact-max").textContent = `$${legality.legalMaxBid}`;
  const nextAssignments = [...summary.assignments, { position: player.position }];
  const counts = nextAssignments.reduce((all, assignment) => ({ ...all, [assignment.position]: (all[assignment.position] || 0) + 1 }), {});
  const requirements = snapshot.starterRequirements || { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };
  const positionCompletion = document.getElementById("position-completion");
  positionCompletion.replaceChildren(...Object.entries(requirements).filter(([, required]) => required > 0).map(([position, required]) => {
    const badge = document.createElement("span");
    const complete = (counts[position] || 0) >= required;
    badge.className = complete ? "is-complete" : "is-needed";
    badge.textContent = `${position} ${counts[position] || 0}/${required}${complete ? " ✓" : ""}`;
    return badge;
  }));
}

function renderClock() {
  const state = clockFromSnapshot(snapshot?.clock);
  const clock = document.getElementById("auctioneer-clock");
  const clockConsole = clock.closest(".clock-console");
  clock.textContent = formatNominationClock(state.remainingMs);
  document.getElementById("clock-duration").value = String(state.durationMs);
  document.getElementById("clock-reset").textContent = `Reset ${formatNominationClock(state.durationMs)}`;
  document.getElementById("clock-state").textContent = state.remainingMs <= 0 ? "Time expired — no automatic action" : state.status === "running" ? "Running" : "Paused";
  clockConsole.classList.toggle("is-expired", state.remainingMs <= 0);
  document.getElementById("clock-pause").disabled = state.status !== "running";
  document.getElementById("clock-resume").disabled = state.status === "running";
  const decision = nextClockAlert(state, clockAlertTracker);
  clockAlertTracker = decision.tracker;
  if (decision.alert) playClockAlert(decision.alert);
}

function updateNomination() {
  const current = snapshot.teams.find((team) => team.id === snapshot.currentNominatorTeamId);
  const next = snapshot.teams.find((team) => team.id === snapshot.nextNominatorTeamId);
  document.getElementById("current-nominator").textContent = current?.name || "Complete";
  document.getElementById("next-nominator").textContent = next?.name || "—";
}

function activeRecentSales() {
  return snapshot.assignments
    .filter((assignment) => assignment.status === "active" && assignment.acquisitionType === "auction")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 3);
}

function clearPendingUndo() {
  pendingUndoAssignmentId = null;
  if (pendingUndoTimer) window.clearTimeout(pendingUndoTimer);
  pendingUndoTimer = null;
  const button = document.getElementById("confirmation-undo");
  button.textContent = "Undo";
  button.classList.remove("confirm-undo");
}

function requestUndo(assignment) {
  if (!assignment || assignment.status !== "active") return;
  if (pendingUndoAssignmentId === assignment.id) {
    clearPendingUndo();
    void runCommand({ type: "void-assignment", assignmentId: assignment.id }, { confirmation: assignment, action: "Undone" });
    return;
  }
  clearPendingUndo();
  pendingUndoAssignmentId = assignment.id;
  if (lastChangedAssignmentId === assignment.id) {
    const button = document.getElementById("confirmation-undo");
    button.textContent = "Confirm undo";
    button.classList.add("confirm-undo");
  }
  setStatus(saleStatus, `Press Confirm undo again to remove ${assignment.playerName} from ${assignmentTeamName(assignment)}. Nothing has changed yet.`);
  renderRecentSales();
  renderHistory();
  pendingUndoTimer = window.setTimeout(() => {
    clearPendingUndo();
    renderRecentSales();
    renderHistory();
  }, 5000);
}

function configureUndoButton(button, assignment) {
  button.type = "button";
  button.textContent = pendingUndoAssignmentId === assignment.id ? "Confirm undo" : "Undo";
  button.classList.toggle("confirm-undo", pendingUndoAssignmentId === assignment.id);
  button.addEventListener("click", () => requestUndo(assignment));
}

function renderRecentSales() {
  const container = document.getElementById("recent-sale-cards");
  container.replaceChildren();
  const recent = activeRecentSales();
  if (!recent.length) {
    const empty = document.createElement("p");
    empty.className = "form-status";
    empty.textContent = "No auction sales recorded yet.";
    container.append(empty);
    return;
  }
  for (const assignment of recent) {
    const card = document.createElement("article");
    card.className = "recent-card";
    const title = document.createElement("strong");
    title.textContent = assignment.playerName;
    const detail = document.createElement("span");
    detail.textContent = `${assignmentTeamName(assignment)} · $${assignment.price}`;
    const actions = document.createElement("div");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEdit(assignment));
    const undo = document.createElement("button");
    configureUndoButton(undo, assignment);
    actions.append(edit, undo);
    card.append(title, detail, actions);
    container.append(card);
  }
}

function visibleHistory() {
  const needle = historySearch.value.trim().toLocaleLowerCase();
  return [...snapshot.assignments]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .filter((assignment) => {
      const team = snapshot.teams.find((candidate) => candidate.id === assignment.teamId);
      return !needle || `${assignment.playerName} ${team?.name || ""}`.toLocaleLowerCase().includes(needle);
    });
}

function updateReconciliationToolbar() {
  const count = stagedAssignmentIds.size;
  document.getElementById("reconciliation-count").textContent = `${count} selected`;
  document.getElementById("open-reconciliation").disabled = count < 2;
}

function renderHistory() {
  historyRows.replaceChildren();
  for (const assignment of visibleHistory()) {
    const team = snapshot.teams.find((candidate) => candidate.id === assignment.teamId);
    const row = document.createElement("tr");
    row.classList.toggle("is-voided", assignment.status === "voided");
    const recorded = new Date(assignment.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const selection = document.createElement("td");
    selection.className = "reconcile-cell";
    if (assignment.status === "active") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = stagedAssignmentIds.has(assignment.id);
      checkbox.setAttribute("aria-label", `Select ${assignment.playerName} for a connected correction`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) stagedAssignmentIds.add(assignment.id);
        else stagedAssignmentIds.delete(assignment.id);
        updateReconciliationToolbar();
      });
      selection.append(checkbox);
    }
    const playerCell = document.createElement("td");
    const playerName = document.createElement("strong");
    playerName.textContent = assignment.playerName;
    const playerMeta = document.createElement("small");
    playerMeta.textContent = `${assignment.position} · ${assignment.nflTeam}`;
    playerCell.append(playerName, playerMeta);
    const teamCell = document.createElement("td");
    teamCell.textContent = team?.name || assignment.teamId;
    const priceCell = document.createElement("td");
    priceCell.textContent = `$${assignment.price}`;
    const typeCell = document.createElement("td");
    typeCell.textContent = assignment.acquisitionType === "keeper" ? `Keeper · Y${assignment.contractYear}` : "Auction";
    const recordedCell = document.createElement("td");
    recordedCell.append(document.createTextNode(recorded));
    const actor = document.createElement("small");
    actor.textContent = assignment.actorLabel || "Auctioneer";
    recordedCell.append(actor);
    const actions = document.createElement("td");
    actions.className = "actions";
    row.append(selection, playerCell, teamCell, priceCell, typeCell, recordedCell, actions);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.disabled = assignment.status === "voided";
    edit.addEventListener("click", () => openEdit(assignment));
    const toggle = document.createElement("button");
    toggle.type = "button";
    if (assignment.status === "active") {
      toggle.className = "danger";
      configureUndoButton(toggle, assignment);
    } else {
      toggle.textContent = "Restore";
      toggle.addEventListener("click", () => void runCommand({ type: "restore-assignment", assignmentId: assignment.id }, { confirmation: assignment }));
    }
    actions.append(edit, toggle);
    historyRows.append(row);
  }
  updateReconciliationToolbar();
}

function renderActivity() {
  const list = document.getElementById("activity-items");
  list.replaceChildren();
  const rows = [...snapshot.assignments].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8);
  if (!rows.length) {
    const item = document.createElement("li");
    item.textContent = "No assignment activity yet.";
    list.append(item);
    return;
  }
  for (const assignment of rows) {
    const item = document.createElement("li");
    const action = assignment.status === "voided" ? "Undid" : assignment.actorLabel?.includes("correct") ? "Corrected" : assignment.actorLabel?.includes("restor") ? "Restored" : assignment.acquisitionType === "keeper" ? "Loaded keeper" : "Recorded";
    item.textContent = `${action}: ${assignment.playerName} → ${assignmentTeamName(assignment)} · $${assignment.price}`;
    const time = document.createElement("time");
    time.textContent = `${new Date(assignment.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${assignment.actorLabel || "Auctioneer"}`;
    item.append(time);
    list.append(item);
  }
}

function renderFinishCheck() {
  const result = evaluateDraftCompletion(snapshot);
  const summary = document.getElementById("finish-summary");
  summary.className = `readiness-summary ${result.complete ? "is-ready" : "is-not-ready"}`;
  summary.textContent = result.complete ? "DRAFT IS LEGAL TO FINISH · Every team has 8–14 players and every required starting position." : `${result.teams.filter((team) => !team.complete).length} TEAM${result.teams.filter((team) => !team.complete).length === 1 ? "" : "S"} STILL NEED ATTENTION`;
  const list = document.getElementById("finish-results");
  list.replaceChildren();
  for (const team of result.teams) {
    const row = document.createElement("li");
    row.classList.toggle("is-pass", team.complete);
    const finished = (snapshot.finishedTeamIds || []).includes(team.teamId);
    const title = document.createElement("strong");
    title.textContent = `${team.teamName} · ${team.playerCount} players${finished ? " · FINISHED" : ""}`;
    const detail = document.createElement("span");
    detail.textContent = team.complete ? (finished ? "Skipped in nomination rotation" : "Legal roster — may continue or finish") : team.problems.join("; ");
    const control = document.createElement("button");
    control.type = "button";
    control.className = "team-finish-control";
    control.textContent = finished ? "Resume drafting" : "Mark finished";
    control.disabled = !finished && !team.complete;
    control.addEventListener("click", async () => {
      const success = await runCommand({ type: finished ? "reopen-team" : "mark-team-finished", teamId: team.teamId }, { quiet: true });
      if (success) renderFinishCheck();
    });
    row.append(title, detail, control);
    list.append(row);
  }
  document.getElementById("export-final").disabled = !result.complete;
}

function publicBoardUrl() {
  return new URL(boardLink.getAttribute("href"), window.location.href).href;
}

function renderShare() {
  const url = publicBoardUrl();
  document.getElementById("share-board-url").textContent = url;
  const qr = document.getElementById("share-qr");
  qr.replaceChildren();
  if (typeof globalThis.qrcode !== "function") {
    const unavailable = document.createElement("p");
    unavailable.textContent = "QR generator unavailable. Use Copy viewer link; the private display URL was not sent to another service.";
    qr.append(unavailable);
    return;
  }
  const code = globalThis.qrcode(0, "M");
  code.addData(url);
  code.make();
  const wrapper = document.createElement("div");
  wrapper.setAttribute("role", "img");
  wrapper.setAttribute("aria-label", "QR code for the read-only public board");
  const svgDocument = new DOMParser().parseFromString(code.createSvgTag({ cellSize: 4, margin: 2, scalable: true }), "image/svg+xml");
  if (svgDocument.documentElement.localName !== "svg") throw new Error("The local QR generator returned invalid SVG.");
  wrapper.append(document.importNode(svgDocument.documentElement, true));
  qr.append(wrapper);
}

function showConfirmation(assignment, action = "Recorded", actionable = true) {
  if (!assignment) return;
  const banner = document.getElementById("sale-confirmation");
  banner.classList.remove("is-illegal");
  lastChangedAssignmentId = actionable ? assignment.id : null;
  document.getElementById("confirmation-text").textContent = `${action}: ${assignment.playerName} → ${assignmentTeamName(assignment)} for $${assignment.price}`;
  document.getElementById("confirmation-edit").hidden = !actionable;
  document.getElementById("confirmation-undo").hidden = !actionable;
  banner.querySelector("small").textContent = "SUCCESSFULLY CLOUD SYNCED";
  banner.hidden = false;
}

function flashIllegal(message) {
  const banner = document.getElementById("sale-confirmation");
  const panel = document.querySelector(".record-panel");
  lastChangedAssignmentId = null;
  banner.hidden = false;
  banner.classList.remove("is-illegal");
  void banner.offsetWidth;
  banner.classList.add("is-illegal");
  banner.querySelector("small").textContent = "ILLEGAL PURCHASE — NOT RECORDED";
  document.getElementById("confirmation-text").textContent = message;
  document.getElementById("confirmation-edit").hidden = true;
  document.getElementById("confirmation-undo").hidden = true;
  setStatus(saleStatus, message, true);
  panel.classList.remove("illegal-flash");
  void panel.offsetWidth;
  panel.classList.add("illegal-flash");
  playTone(false);
}

function validateCorrections(changes) {
  try {
    const candidate = structuredClone(snapshot);
    for (const change of changes) {
      const target = candidate.assignments.find((assignment) => assignment.id === change.assignmentId && assignment.status === "active");
      const player = candidate.availablePlayers.find((item) => item.id === change.playerId);
      if (!target || !player) throw new Error("A selected assignment or player is no longer available.");
      Object.assign(target, {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        teamId: change.teamId,
        price: Number(change.price),
        contractYear: target.acquisitionType === "keeper" ? Number(change.contractYear) : null,
      });
    }
    assertPublicSnapshot(candidate);
    assertLeagueLegality(candidate);
    return { legal: true };
  } catch (error) {
    return { legal: false, message: error.message };
  }
}

function updateProjectorStatus(presence = readProjectorPresence()) {
  lastProjectorPresence = presence;
  projectorState.classList.remove("is-live", "is-stale", "is-error");
  if (!projectorPresenceIsFresh(presence)) {
    projectorState.textContent = "PROJECTOR NOT SEEN";
    projectorState.classList.add("is-error");
    return;
  }
  if (!presence.dataFresh) {
    projectorState.textContent = "PROJECTOR DATA STALE";
    projectorState.classList.add("is-stale");
    return;
  }
  const seconds = Math.max(0, Math.round((Date.now() - presence.lastSeen) / 1000));
  projectorState.textContent = `PROJECTOR LIVE · ${seconds}s`;
  projectorState.classList.add("is-live");
}

function renderReadiness(result) {
  const summary = document.getElementById("readiness-summary");
  summary.className = `readiness-summary ${result.ready ? "is-ready" : "is-not-ready"}`;
  summary.textContent = result.ready
    ? `READY FOR DRAFT DAY · ${result.passed}/${result.total} checks passed`
    : `NOT READY YET · ${result.passed}/${result.total} checks passed`;
  const list = document.getElementById("readiness-results");
  list.replaceChildren();
  for (const item of result.checks) {
    const row = document.createElement("li");
    row.classList.toggle("is-pass", item.ok);
    const title = document.createElement("strong");
    title.textContent = item.label;
    const detail = document.createElement("span");
    detail.textContent = item.detail;
    row.append(title, detail);
    list.append(row);
  }
}

async function runReadinessCheck() {
  const button = document.getElementById("run-readiness");
  button.disabled = true;
  button.textContent = "Checking everything…";
  try {
    const checkedSnapshot = await source.snapshot();
    cloudReady = true;
    snapshot = checkedSnapshot;
    render();
    renderReadiness(evaluateDraftReadiness(snapshot, readProjectorPresence(), {
      cloudReady,
      expectedTeamCount: 12,
      audioConfirmed: document.getElementById("sound-confirmed").checked,
      zoomConfirmed: document.getElementById("zoom-confirmed").checked,
    }));
  } catch (error) {
    cloudReady = false;
    const fallback = snapshot || { teams: [], assignments: [], availablePlayers: [] };
    const result = evaluateDraftReadiness(fallback, readProjectorPresence(), {
      cloudReady: false,
      expectedTeamCount: 12,
      audioConfirmed: document.getElementById("sound-confirmed").checked,
      zoomConfirmed: document.getElementById("zoom-confirmed").checked,
    });
    const cloud = result.checks.find((item) => item.id === "cloud");
    if (cloud) cloud.detail = error.message;
    renderReadiness(result);
  } finally {
    button.disabled = false;
    button.textContent = "Run all checks";
  }
}

function render() {
  assertPublicSnapshot(snapshot);
  if (snapshot.displayBoardUrl) boardLink.href = snapshot.displayBoardUrl;
  populateControls();
  updateNomination();
  renderRecentSales();
  renderHistory();
  renderActivity();
  updateSelectedPlayer();
  renderPlayerResults();
  syncState.textContent = cloudReady ? "CLOUD SYNCED" : "OFFLINE";
  syncState.classList.toggle("is-error", !cloudReady);
}

async function refresh() {
  if (refreshInFlight || consoleView.hidden) return;
  refreshInFlight = true;
  try {
    const next = await source.snapshot();
    cloudReady = true;
    if (!snapshot || next.revision !== snapshot.revision) {
      snapshot = next;
      render();
    } else {
      updateRecordAvailability();
    }
  } catch (error) {
    cloudReady = false;
    syncState.textContent = "OFFLINE";
    syncState.classList.add("is-error");
    setStatus(saleStatus, `${error.message} Use the command-center laptop until synchronization returns.`, true);
    updateRecordAvailability();
  } finally {
    refreshInFlight = false;
  }
}

async function runCommand(command, options = {}) {
  if (!cloudReady) {
    setStatus(saleStatus, "Offline recording is disabled. Use the command-center laptop.", true);
    playTone(false);
    return false;
  }
  commandInFlight = true;
  const commandStartedAt = performance.now();
  const finishedBeforeCommand = new Set(snapshot?.finishedTeamIds || []);
  updateRecordAvailability();
  try {
    syncState.textContent = "SYNCING";
    command.idempotencyKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    snapshot = await source.command(command);
    const automaticallyReopened = [...finishedBeforeCommand].filter((teamId) => !(snapshot.finishedTeamIds || []).includes(teamId));
    cloudReady = true;
    clearPendingUndo();
    render();
    const changed = command.type === "record-sale" || command.type === "correct-assignment"
      ? snapshot.assignments.find((assignment) => assignment.status === "active" && assignment.playerId === command.playerId && assignment.teamId === command.teamId && assignment.price === Number(command.price))
      : command.type === "restore-assignment" && options.confirmation
        ? snapshot.assignments.find((assignment) => assignment.status === "active" && assignment.playerId === options.confirmation.playerId)
        : options.confirmation;
    if (changed && !options.quiet) showConfirmation(changed, options.action || (command.type === "record-sale" ? "Recorded" : "Updated"), command.type !== "void-assignment");
    if (command.type === "record-sale") activateClockSoundOwner();
    const elapsedMs = Math.round(performance.now() - commandStartedAt);
    if (!options.quiet) {
      const reopenedMessage = automaticallyReopened.length ? ` ${automaticallyReopened.map((teamId) => snapshot.teams.find((team) => team.id === teamId)?.name || teamId).join(", ")} was automatically reopened because the correction changed its legal finish state.` : "";
      setStatus(saleStatus, `Cloud confirmed in ${elapsedMs} ms. The projector board and private command center will refresh automatically.${reopenedMessage}`);
      playTone(true);
    }
    return true;
  } catch (error) {
    syncState.textContent = navigator.onLine || isDemo ? "CHANGE REJECTED" : "OFFLINE";
    syncState.classList.add("is-error");
    if (!navigator.onLine && !isDemo) cloudReady = false;
    if ((navigator.onLine || isDemo) && !options.quiet) flashIllegal(error.message);
    else {
      setStatus(saleStatus, error.message, true);
      if (!options.quiet) playTone(false);
    }
    if (error.status === 409) await refresh();
    return false;
  } finally {
    commandInFlight = false;
    updateRecordAvailability();
  }
}

function clearSaleForm({ clearNomination = true } = {}) {
  keypadBuffer = "";
  selectedPlayerId = null;
  focusedPlayerResultIndex = -1;
  playerSearch.value = "";
  saleTeam.value = "";
  salePrice.value = "";
  renderQuickTeams();
  const banner = document.getElementById("sale-confirmation");
  if (banner.classList.contains("is-illegal")) {
    banner.hidden = true;
    banner.classList.remove("is-illegal");
  }
  document.querySelector(".record-panel").classList.remove("illegal-flash");
  playerResults.hidden = true;
  playerSearch.setAttribute("aria-expanded", "false");
  setStatus(saleStatus, cloudReady
    ? "Choose a player, team, and whole-dollar price."
    : "Offline recording is disabled. Use the command-center laptop.", !cloudReady);
  updateSelectedPlayer();
  playerSearch.focus();
  if (clearNomination) void publishNominationIntent(null);
}

function openEdit(assignment) {
  document.getElementById("edit-assignment-id").value = assignment.id;
  document.getElementById("edit-title").textContent = assignment.playerName;
  const editPlayer = document.getElementById("edit-player");
  editPlayer.replaceChildren(...playerOptionElements(assignment.playerId));
  editPlayer.value = assignment.playerId;
  document.getElementById("edit-team").value = assignment.teamId;
  document.getElementById("edit-price").value = String(assignment.price);
  document.getElementById("edit-contract").value = assignment.contractYear ? String(assignment.contractYear) : "";
  document.getElementById("contract-field").hidden = assignment.acquisitionType !== "keeper";
  editDialog.showModal();
}

function setReconciliationMode(active) {
  reconciliationMode = active;
  historyPanel.classList.toggle("is-reconciling", active);
  document.getElementById("reconciliation-toolbar").hidden = !active;
  document.getElementById("toggle-reconciliation").textContent = active ? "Selecting connected mistakes…" : "Correct a connected mix-up";
  if (!active) stagedAssignmentIds.clear();
  renderHistory();
}

function openReconciliationDialog() {
  const selected = [...stagedAssignmentIds]
    .map((id) => snapshot.assignments.find((assignment) => assignment.id === id))
    .filter((assignment) => assignment?.status === "active");
  if (selected.length < 2) return;
  const container = document.getElementById("reconciliation-rows");
  container.replaceChildren();
  for (const assignment of selected) {
    const row = document.createElement("section");
    row.className = "reconciliation-row";
    row.dataset.assignmentId = assignment.id;
    const name = document.createElement("strong");
    name.textContent = assignment.playerName;
    const playerLabel = document.createElement("label");
    playerLabel.textContent = "Player";
    const player = document.createElement("select");
    player.dataset.field = "player";
    player.replaceChildren(...playerOptionElements(assignment.playerId));
    player.value = assignment.playerId;
    playerLabel.append(player);
    const teamLabel = document.createElement("label");
    teamLabel.textContent = "Team";
    const team = document.createElement("select");
    team.dataset.field = "team";
    team.replaceChildren(...teamOptionElements());
    team.value = assignment.teamId;
    teamLabel.append(team);
    const priceLabel = document.createElement("label");
    priceLabel.textContent = "Price";
    const price = document.createElement("input");
    price.type = "number";
    price.min = "1";
    price.step = "1";
    price.required = true;
    price.value = String(assignment.price);
    price.dataset.field = "price";
    priceLabel.append(price);
    const contractLabel = document.createElement("label");
    contractLabel.className = "contract-input";
    contractLabel.hidden = assignment.acquisitionType !== "keeper";
    contractLabel.textContent = "Contract year";
    const contract = document.createElement("input");
    contract.type = "number";
    contract.min = "1";
    contract.max = "3";
    contract.step = "1";
    contract.value = assignment.contractYear ? String(assignment.contractYear) : "";
    contract.dataset.field = "contract";
    contractLabel.append(contract);
    row.append(name, playerLabel, teamLabel, priceLabel, contractLabel);
    container.append(row);
  }
  reconciliationDialog.showModal();
}

function openKeypad() {
  keypadBuffer = salePrice.value && Number(salePrice.value) > 0 ? String(Number(salePrice.value)) : "";
  document.getElementById("keypad-value").textContent = `$${keypadBuffer || "0"}`;
  keypadDialog.showModal();
}

function updateKeypad(value) {
  if (value === "clear") keypadBuffer = "";
  else if (value === "back") keypadBuffer = keypadBuffer.slice(0, -1);
  else if (keypadBuffer.length < 3) keypadBuffer = `${keypadBuffer}${value}`.replace(/^0+(?=\d)/, "");
  document.getElementById("keypad-value").textContent = `$${keypadBuffer || "0"}`;
}

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const shouldOpenBoard = document.getElementById("auto-open-board").checked;
  const boardWindow = shouldOpenBoard ? window.open("about:blank", "thunder-bowl-public-board") : null;
  try {
    setStatus(loginStatus, "Checking access…");
    await source.login(document.getElementById("access-code").value.trim());
    loginPanel.hidden = true;
    consoleView.hidden = false;
    await refresh();
    if (boardWindow) boardWindow.location.href = boardLink.href;
    playerSearch.focus();
  } catch (error) {
    boardWindow?.close();
    setStatus(loginStatus, error.message, true);
    playTone(false);
  }
});

document.getElementById("sale-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const player = selectedPlayer();
  if (!player) return setStatus(saleStatus, "Explicitly choose an available player from the search results.", true);
  if (!saleTeam.value) return setStatus(saleStatus, "Choose the purchasing team for this sale.", true);
  const legality = evaluatePurchase(snapshot, { playerId: player.id, teamId: saleTeam.value, price: Number(salePrice.value) });
  if (!legality.legal) {
    flashIllegal(legality.message);
    return;
  }
  activateClockSoundOwner();
  const success = await runCommand({ type: "record-sale", playerId: player.id, teamId: saleTeam.value, price: Number(salePrice.value) });
  if (success) clearSaleForm({ clearNomination: false });
});

document.getElementById("edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const assignmentId = document.getElementById("edit-assignment-id").value;
  const original = snapshot.assignments.find((assignment) => assignment.id === assignmentId);
  const change = {
    assignmentId,
    playerId: document.getElementById("edit-player").value,
    teamId: document.getElementById("edit-team").value,
    price: Number(document.getElementById("edit-price").value),
    contractYear: original?.acquisitionType === "keeper" ? Number(document.getElementById("edit-contract").value) : null,
  };
  const legality = validateCorrections([change]);
  if (!legality.legal) {
    editDialog.close();
    flashIllegal(legality.message);
    return;
  }
  const success = await runCommand({
    type: "correct-assignment", assignmentId,
    playerId: change.playerId,
    teamId: change.teamId,
    price: change.price,
    contractYear: change.contractYear,
  }, { confirmation: original, action: "Corrected" });
  if (success) editDialog.close();
});

document.getElementById("reconciliation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const changes = [...document.querySelectorAll(".reconciliation-row")].map((row) => {
    const original = snapshot.assignments.find((assignment) => assignment.id === row.dataset.assignmentId);
    return {
      assignmentId: row.dataset.assignmentId,
      playerId: row.querySelector('[data-field="player"]').value,
      teamId: row.querySelector('[data-field="team"]').value,
      price: Number(row.querySelector('[data-field="price"]').value),
      contractYear: original?.acquisitionType === "keeper" ? Number(row.querySelector('[data-field="contract"]').value) : null,
    };
  });
  const legality = validateCorrections(changes);
  if (!legality.legal) {
    reconciliationDialog.close();
    flashIllegal(legality.message);
    return;
  }
  const success = await runCommand({ type: "reconcile-assignments", changes });
  if (success) {
    reconciliationDialog.close();
    setReconciliationMode(false);
    lastChangedAssignmentId = null;
    document.getElementById("sale-confirmation").classList.remove("is-illegal");
    document.getElementById("sale-confirmation").querySelector("small").textContent = "SUCCESSFULLY CLOUD SYNCED";
    document.getElementById("confirmation-edit").hidden = true;
    document.getElementById("confirmation-undo").hidden = true;
    document.getElementById("sale-confirmation").hidden = false;
    document.getElementById("confirmation-text").textContent = `Corrected ${changes.length} connected assignments together`;
  }
});

playerSearch.addEventListener("input", () => {
  if (selectedPlayer()?.name !== playerSearch.value) selectedPlayerId = null;
  focusedPlayerResultIndex = -1;
  updateSelectedPlayer();
  renderPlayerResults();
});
playerSearch.addEventListener("keydown", (event) => {
  const allResults = [...playerResults.querySelectorAll("button")];
  const enabledResults = allResults.filter((button) => !button.disabled);
  const currentButton = allResults[focusedPlayerResultIndex];
  const currentEnabledIndex = enabledResults.indexOf(currentButton);
  if (event.key === "ArrowDown" && enabledResults.length) {
    event.preventDefault();
    const target = enabledResults[Math.min(currentEnabledIndex + 1, enabledResults.length - 1)];
    focusedPlayerResultIndex = allResults.indexOf(target);
    renderPlayerResults();
  } else if (event.key === "ArrowUp" && enabledResults.length) {
    event.preventDefault();
    const target = enabledResults[Math.max(0, currentEnabledIndex < 0 ? 0 : currentEnabledIndex - 1)];
    focusedPlayerResultIndex = allResults.indexOf(target);
    renderPlayerResults();
  } else if (event.key === "Enter" && !selectedPlayer() && enabledResults.length) {
    event.preventDefault();
    const target = currentButton && !currentButton.disabled ? currentButton : enabledResults[0];
    target?.click();
  } else if (event.key === "Enter" && selectedPlayer()) {
    event.preventDefault();
    saleTeam.focus();
  }
});
saleTeam.addEventListener("change", () => { renderQuickTeams(); updateRecordAvailability(); });
saleTeam.addEventListener("keydown", (event) => { if (event.key === "Enter" && saleTeam.value) { event.preventDefault(); salePrice.focus(); } });
salePrice.addEventListener("input", updateRecordAvailability);
historySearch.addEventListener("input", renderHistory);
document.getElementById("export-csv").addEventListener("click", () => snapshot && downloadBoardCsv(snapshot));
document.getElementById("export-audit").addEventListener("click", () => snapshot && downloadAuditCsv(snapshot));
document.getElementById("toggle-reconciliation").addEventListener("click", () => setReconciliationMode(!reconciliationMode));
document.getElementById("cancel-reconciliation").addEventListener("click", () => setReconciliationMode(false));
document.getElementById("open-reconciliation").addEventListener("click", openReconciliationDialog);
document.getElementById("open-keypad").addEventListener("click", openKeypad);
document.getElementById("clear-sale").addEventListener("click", clearSaleForm);
document.querySelector(".quick-team-heading span").textContent = `${shortcutModifier} + shown key`;
document.getElementById("clock-pause").addEventListener("click", () => { activateClockSoundOwner(); void runCommand({ type: "update-clock", action: "pause" }, { quiet: true }); });
document.getElementById("clock-resume").addEventListener("click", () => { activateClockSoundOwner(); void runCommand({ type: "update-clock", action: "resume" }, { quiet: true }); });
document.getElementById("clock-reset").addEventListener("click", () => { activateClockSoundOwner(); void runCommand({ type: "update-clock", action: "reset" }, { quiet: true }); });
document.getElementById("clock-duration").addEventListener("change", (event) => {
  activateClockSoundOwner();
  void runCommand({ type: "update-clock", action: "set-duration", durationMs: Number(event.target.value) }, { quiet: true });
});
document.getElementById("clock-sound").addEventListener("click", () => {
  const enabled = !clockSoundsEnabled();
  localStorage.setItem("thunder-bowl-clock-sounds", enabled ? "on" : "off");
  if (enabled) activateClockSoundOwner();
  renderClockSoundButton();
});
document.getElementById("open-finish").addEventListener("click", () => { renderFinishCheck(); finishDialog.showModal(); });
document.getElementById("run-finish").addEventListener("click", renderFinishCheck);
document.getElementById("export-final").addEventListener("click", () => snapshot && downloadBoardCsv(snapshot, `thunder-bowl-${snapshot.season}-final-rosters.csv`));
document.getElementById("open-share").addEventListener("click", () => { renderShare(); shareDialog.showModal(); });
document.getElementById("copy-board-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(publicBoardUrl());
    document.getElementById("copy-board-link").textContent = "Copied";
    window.setTimeout(() => { document.getElementById("copy-board-link").textContent = "Copy viewer link"; }, 1600);
  } catch {
    document.getElementById("share-board-url").focus?.();
  }
});
document.getElementById("open-readiness").addEventListener("click", () => {
  readinessDialog.showModal();
  void runReadinessCheck();
});
document.getElementById("run-readiness").addEventListener("click", () => void runReadinessCheck());
document.getElementById("test-sound").addEventListener("click", () => playTone(true, true));
document.getElementById("test-clock-alerts").addEventListener("click", runClockSoundTest);
document.getElementById("sale-sounds-enabled").checked = localStorage.getItem("thunder-bowl-sale-sounds") !== "off";
document.getElementById("sale-sounds-enabled").addEventListener("change", (event) => localStorage.setItem("thunder-bowl-sale-sounds", event.target.checked ? "on" : "off"));
document.getElementById("sound-confirmed").addEventListener("change", () => void runReadinessCheck());
document.getElementById("zoom-confirmed").addEventListener("change", () => void runReadinessCheck());
document.querySelectorAll("[data-price-add]").forEach((button) => button.addEventListener("click", () => {
  salePrice.value = String(Math.max(0, Number(salePrice.value) || 0) + Number(button.dataset.priceAdd));
  updateRecordAvailability();
}));
document.querySelectorAll("[data-keypad]").forEach((button) => button.addEventListener("click", () => updateKeypad(button.dataset.keypad)));
document.querySelectorAll("[data-keypad-add]").forEach((button) => button.addEventListener("click", () => {
  keypadBuffer = String((Number(keypadBuffer) || 0) + Number(button.dataset.keypadAdd));
  document.getElementById("keypad-value").textContent = `$${keypadBuffer}`;
}));
document.getElementById("apply-keypad").addEventListener("click", (event) => {
  event.preventDefault();
  salePrice.value = keypadBuffer ? String(Number(keypadBuffer)) : "";
  keypadDialog.close();
  updateRecordAvailability();
  salePrice.focus();
});
document.getElementById("confirmation-edit").addEventListener("click", () => {
  const assignment = snapshot.assignments.find((candidate) => candidate.id === lastChangedAssignmentId && candidate.status === "active");
  if (assignment) openEdit(assignment);
});
document.getElementById("confirmation-undo").addEventListener("click", () => {
  const assignment = snapshot.assignments.find((candidate) => candidate.id === lastChangedAssignmentId && candidate.status === "active");
  if (assignment) requestUndo(assignment);
});
document.addEventListener("keydown", (event) => {
  if (event.altKey && !event.metaKey && !event.ctrlKey && !document.querySelector("dialog[open]") && snapshot) {
    const teamIndex = TEAM_SHORTCUTS.indexOf(event.key);
    if (teamIndex >= 0 && snapshot.teams[teamIndex]) {
      event.preventDefault();
      selectBuyingTeam(snapshot.teams[teamIndex].id);
      return;
    }
  }
  if (event.key !== "Escape" || consoleView.hidden || document.querySelector("dialog[open]")) return;
  event.preventDefault();
  clearSaleForm();
});
window.addEventListener("offline", () => {
  if (isDemo) return;
  cloudReady = false;
  syncState.textContent = "OFFLINE";
  syncState.classList.add("is-error");
  updateRecordAvailability();
});
window.addEventListener("online", () => void refresh());
source.subscribe(() => void refresh());
subscribeProjectorPresence(updateProjectorStatus);
window.setInterval(() => updateProjectorStatus(lastProjectorPresence), 1000);
window.setInterval(renderClock, 250);
updateProjectorStatus(lastProjectorPresence);
renderClockSoundButton();
renderClock();

if (isDemo) setStatus(loginStatus, "Demo access number: 2026 · public data only.");
