import {
  draftCsv,
  keeperLegality,
  normalizeLeagueCode,
  normalizePlayer,
  optimisticSnapshot,
  playerIdentity,
  publicSnapshot,
  saleLegality,
} from "../core.mjs";
import { clearRememberedAccess, rememberLeague, rememberedLeague, savedVerifier, saveVerifier } from "../session-storage.mjs";

const byId = (id) => document.getElementById(id);
const loginPanel = byId("login-panel");
const consolePanel = byId("console");
const playerSearch = byId("player-search");
const keeperSearch = byId("keeper-player-search");
const query = new URLSearchParams(location.search);
let snapshot = null;
let playerPool = [];
let selectedPlayer = null;
let selectedKeeperPlayer = null;
let customPlayerTarget = "sale";
let refreshInFlight = false;
let queueInFlight = false;
let pollTimer = null;
let boardStateTimer = null;
let roomChannel = null;
let boardLastSeen = 0;
let clockTimer = null;
let clockState = { enabled: false, duration: 30, remaining: 30, running: false, deadline: null };

function leagueCode() { return snapshot?.leagueCode || normalizeLeagueCode(byId("league-code").value); }
function cacheKey(code = leagueCode()) { return `pips-draft-day-auctioneer-${code}`; }
function queueKey(code = leagueCode()) { return `pips-draft-day-outbox-${code}`; }
function publicCacheKey(code = leagueCode()) { return `pips-draft-day-board-${code}`; }
function channelName(code = leagueCode()) { return `pips-draft-day-${code}`; }
function keeperOpenKey() { return `pips-draft-day-keeper-open-${leagueCode()}`; }
function clockKey() { return `pips-draft-day-clock-${leagueCode()}`; }

async function accessVerifier(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pips-draft-day-auctioneer|${value}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function setStatus(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("is-error", error);
  element.classList.toggle("is-success", Boolean(message) && !error);
}

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "The Draft Day service is unavailable.");
    error.status = response.status; error.code = body.code; throw error;
  }
  return body;
}

function normalizeSearch(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function rankPlayers(players, value) {
  const queryText = normalizeSearch(value);
  if (!queryText) return [];
  const tokens = queryText.split(" ");
  return players.map((player) => {
    const name = normalizeSearch(player.name);
    const haystack = `${name} ${normalizeSearch(player.position)} ${normalizeSearch(player.nflTeam)} ${normalizeSearch(player.nflTeamName)} ${normalizeSearch(player.nflTeamShortName)}`;
    if (!tokens.every((token) => haystack.includes(token))) return null;
    const score = name === queryText ? 0 : name.startsWith(queryText) ? 1 : haystack.startsWith(queryText) ? 2 : 3;
    return { player, score };
  }).filter(Boolean).sort((left, right) => left.score - right.score || left.player.name.localeCompare(right.player.name)).map((entry) => entry.player);
}

function option(value, label, selected = false) {
  const element = document.createElement("option");
  element.value = value; element.textContent = label; element.selected = selected;
  return element;
}

function allPlayers() {
  const map = new Map();
  for (const player of [...playerPool, ...(snapshot?.customPlayers || [])]) map.set(player.id, player);
  return [...map.values()];
}

function activePlayerIds() {
  return new Set((snapshot?.assignments || []).filter((assignment) => assignment.status === "active").map((assignment) => playerIdentity({ id: assignment.playerId, name: assignment.playerName, position: assignment.position })));
}

function availablePlayers() {
  const active = activePlayerIds();
  return allPlayers().filter((player) => !active.has(playerIdentity(player)));
}

function selectedFor(kind) { return kind === "keeper" ? selectedKeeperPlayer : selectedPlayer; }
function playerTeamLine(player) { return `${player.nflTeamName || player.nflTeam} · ${player.byeWeek ? `Bye ${player.byeWeek}` : "Bye —"}`; }

function predictiveElements(kind) {
  return kind === "keeper"
    ? { search: keeperSearch, results: byId("keeper-player-results"), add: byId("add-custom-keeper-player") }
    : { search: playerSearch, results: byId("player-results"), add: byId("add-custom-player") };
}

function renderPredictiveResults(kind) {
  const { search, results, add } = predictiveElements(kind);
  results.replaceChildren();
  if (selectedFor(kind) || !search.value.trim()) {
    results.hidden = true; add.hidden = true; search.setAttribute("aria-expanded", "false"); return;
  }
  const matches = rankPlayers(availablePlayers(), search.value).slice(0, 10);
  for (const player of matches) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "search-result"; button.setAttribute("role", "option");
    const name = document.createElement("strong"); name.textContent = player.name;
    const meta = document.createElement("span"); meta.textContent = `${player.position} · ${playerTeamLine(player)}`;
    button.append(name, meta);
    button.addEventListener("click", () => kind === "keeper" ? selectKeeperPlayer(player) : selectPlayer(player));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...results.querySelectorAll("button")];
      const current = buttons.indexOf(button);
      buttons[(current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    });
    results.append(button);
  }
  if (!matches.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No matching player in the 2026 pool."; results.append(empty);
  }
  results.hidden = false; add.hidden = false; search.setAttribute("aria-expanded", "true");
}

function selectPlayer(player) {
  selectedPlayer = player; playerSearch.value = player.name;
  playerSearch.setAttribute("aria-expanded", "false");
  byId("player-results").hidden = true; byId("add-custom-player").hidden = true;
  byId("selected-player").hidden = false; byId("selected-position").textContent = player.position;
  byId("selected-name").textContent = player.name; byId("selected-nfl-team").textContent = playerTeamLine(player);
  updatePendingSale(); byId("buying-team").focus();
  void runCommand({ type: "nominate-player", player, statusTarget: "sale" });
}

function selectKeeperPlayer(player) {
  selectedKeeperPlayer = player; keeperSearch.value = player.name;
  keeperSearch.setAttribute("aria-expanded", "false");
  byId("keeper-player-results").hidden = true; byId("add-custom-keeper-player").hidden = true;
  byId("keeper-selected-player").hidden = false; byId("keeper-selected-position").textContent = player.position;
  byId("keeper-selected-name").textContent = player.name; byId("keeper-selected-nfl-team").textContent = playerTeamLine(player);
  updatePendingKeeper(); byId("keeper-team").focus();
}

function clearPlayer(clearNomination = true) {
  const shouldClearNomination = clearNomination && Boolean(snapshot?.nominatedPlayer);
  selectedPlayer = null; playerSearch.value = ""; byId("selected-player").hidden = true;
  updatePendingSale(); playerSearch.focus();
  if (shouldClearNomination) void runCommand({ type: "clear-nomination", statusTarget: "sale" });
}

function clearKeeperPlayer() {
  selectedKeeperPlayer = null; keeperSearch.value = ""; byId("keeper-selected-player").hidden = true;
  updatePendingKeeper(); if (!snapshot?.keepersLocked) keeperSearch.focus();
}

function bindPredictiveSearch(kind) {
  const { search, results } = predictiveElements(kind);
  search.addEventListener("input", () => {
    if (kind === "keeper" && selectedKeeperPlayer && search.value !== selectedKeeperPlayer.name) selectedKeeperPlayer = null;
    if (kind === "sale" && selectedPlayer && search.value !== selectedPlayer.name) { selectedPlayer = null; if (snapshot?.nominatedPlayer) void runCommand({ type: "clear-nomination", statusTarget: "sale" }); }
    byId(kind === "keeper" ? "keeper-selected-player" : "selected-player").hidden = !selectedFor(kind);
    renderPredictiveResults(kind);
    kind === "keeper" ? updatePendingKeeper() : updatePendingSale();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { results.hidden = true; search.setAttribute("aria-expanded", "false"); return; }
    if (event.key === "ArrowDown") { const first = results.querySelector("button"); if (first) { event.preventDefault(); first.focus(); } }
    if (event.key === "Enter" && !selectedFor(kind)) { const first = results.querySelector("button"); if (first) { event.preventDefault(); first.click(); } }
  });
}

function renderTeamOptions() {
  const buying = byId("buying-team"); const correction = byId("correction-team"); const keeper = byId("keeper-team");
  const buyingSelected = buying.value; const keeperSelected = keeper.value;
  buying.replaceChildren(option("", "Choose a team")); correction.replaceChildren(); keeper.replaceChildren(option("", "Choose a team"));
  for (const team of snapshot.teams) {
    buying.append(option(team.id, `${team.name} — $${team.remainingBudget} left · max $${team.legalMaxBid}`, team.id === buyingSelected));
    correction.append(option(team.id, team.name));
    const keeperCount = snapshot.config.keeperMaximum == null ? `${team.keeperCount} keepers` : `${team.keeperCount}/${team.keeperMaximum} keepers`;
    keeper.append(option(team.id, `${team.name} — ${keeperCount} · $${team.remainingBudget} cash`, team.id === keeperSelected));
  }
}

function renderKeeperProgress() {
  const activeKeepers = snapshot.assignments.filter((assignment) => assignment.status === "active" && assignment.acquisitionType === "keeper");
  const summaryLimit = snapshot.config.keeperMaximum == null ? "" : ` · maximum ${snapshot.config.keeperMaximum} per team`;
  byId("keeper-summary-line").textContent = `${activeKeepers.length} recorded${summaryLimit}`;
  byId("keeper-ready-state").textContent = snapshot.keepersLocked ? "LOCKED" : "READY";
  byId("keeper-ready-state").classList.remove("is-error");
  byId("keeper-preflight").textContent = snapshot.auctionStarted
    ? "Keeper entry is permanently locked by the first sale. Corrections and undo/restore remain available below."
    : snapshot.keepersLocked
      ? "Keeper entry is locked. Unlock it here if the room needs to add another keeper before the first sale."
      : "Preflight passed: keeper salaries are deducted and every team retains a legal roster path.";
  const lockButton = byId("toggle-keeper-lock"); lockButton.textContent = snapshot.keepersLocked ? "Unlock keepers" : "Lock keepers"; lockButton.disabled = snapshot.auctionStarted;
  const grid = byId("keeper-team-grid"); grid.replaceChildren();
  for (const team of snapshot.teams) {
    const card = document.createElement("article"); card.className = "keeper-team-progress"; card.tabIndex = 0;
    const header = document.createElement("header"); const name = document.createElement("strong"); name.textContent = team.name;
    const cash = document.createElement("b"); cash.textContent = `$${team.remainingBudget}`; header.append(name, cash);
    const progress = document.createElement("p");
    const limit = snapshot.config.keeperMaximum == null ? `${team.keeperCount} keepers` : `${team.keeperCount}/${team.keeperMaximum} keepers`;
    progress.textContent = `${limit} · $${team.keeperSpend} keeper salary · ${team.rosterCount}/${snapshot.config.rosterMaximum} rostered`;
    card.append(header, progress);
    const choose = () => { if (!snapshot.keepersLocked) { byId("keeper-team").value = team.id; updatePendingKeeper(); keeperSearch.focus(); } };
    card.addEventListener("click", choose); card.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); choose(); } });
    grid.append(card);
  }
  byId("keeper-form").querySelectorAll("input, select, button").forEach((control) => { control.disabled = snapshot.keepersLocked; });
}

function renderTeamSummaries() {
  const container = byId("team-summary-grid"); container.replaceChildren();
  for (const team of snapshot.teams) {
    const card = document.createElement("article"); card.className = "team-summary";
    const header = document.createElement("header"); const name = document.createElement("strong"); name.textContent = team.name;
    const cash = document.createElement("b"); cash.textContent = `$${team.remainingBudget}`; header.append(name, cash);
    const summary = document.createElement("p"); summary.textContent = `${team.rosterCount}/${snapshot.config.rosterMaximum} rostered · ${team.keeperCount} keepers · max legal bid $${team.legalMaxBid}${team.canFinish ? " · legal to finish" : ""}`;
    const counts = document.createElement("div"); counts.className = "count-row";
    for (const rule of snapshot.config.positionRules) { const chip = document.createElement("span"); chip.textContent = `${rule.id} ${team.positionCounts[rule.id] || 0}`; counts.append(chip); }
    card.append(header, summary, counts); container.append(card);
  }
  const current = snapshot.teams.find((team) => team.id === snapshot.currentNominatorTeamId);
  byId("nominator-status").textContent = snapshot.config.nominationMode === "manual" ? "Nomination tracking is off." : current ? `${current.name} is next to nominate.` : "Nomination order unavailable.";
}

function actionButton(label, className, handler) {
  const button = document.createElement("button"); button.type = "button"; button.className = className; button.textContent = label; button.addEventListener("click", handler); return button;
}

function renderHistory() {
  const body = byId("history-rows"); body.replaceChildren();
  const assignments = [...snapshot.assignments].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  if (!assignments.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 7; cell.className = "empty-state"; cell.textContent = "No keepers or sales recorded yet."; row.append(cell); body.append(row); return; }
  for (const assignment of assignments) {
    const row = document.createElement("tr");
    const details = assignment.acquisitionType === "keeper"
      ? [assignment.contractYear ? `Year ${assignment.contractYear}` : null, assignment.keeperRound ? `Round ${assignment.keeperRound}` : null].filter(Boolean).join(" · ") || "—"
      : assignment.nflTeam;
    const values = [assignment.playerName, snapshot.config.teams.find((team) => team.id === assignment.teamId)?.name || assignment.teamId, `$${assignment.price}`, assignment.acquisitionType, details, assignment.status];
    values.forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); });
    const actions = document.createElement("td"); actions.className = "history-actions";
    if (assignment.status === "active") {
      actions.append(actionButton("Correct", "secondary", () => openCorrection(assignment)));
      actions.append(actionButton("Undo", "danger", () => void runCommand({ type: assignment.acquisitionType === "keeper" ? "void-keeper" : "void-sale", targetId: assignment.id })));
    } else {
      actions.append(actionButton("Restore", "secondary", () => void runCommand({ type: assignment.acquisitionType === "keeper" ? "restore-keeper" : "restore-sale", targetId: assignment.id })));
    }
    row.append(actions); body.append(row);
  }
}

function updatePendingSale() {
  if (!snapshot) return;
  const input = { player: selectedPlayer, teamId: byId("buying-team").value, price: Number(byId("winning-price").value) };
  const inputReady = Boolean(selectedPlayer && input.teamId && byId("winning-price").value !== "");
  const legality = inputReady ? saleLegality(snapshot, input) : null;
  byId("record-sale").disabled = !legality?.legal;
  byId("record-sale").textContent = snapshot.auctionStarted ? "Record sale" : snapshot.keepersLocked ? "Record first sale" : "Record first sale & lock keepers";
  byId("sale-preview").hidden = !inputReady;
  if (!inputReady) { setStatus(byId("sale-status"), "Choose a player, team, and price."); return; }
  const team = snapshot.teams.find((candidate) => candidate.id === input.teamId);
  byId("preview-sentence").textContent = `${selectedPlayer.name} → ${team?.name || "team"} for $${input.price}`;
  byId("preview-before").textContent = `$${team?.remainingBudget ?? 0}`; byId("preview-price").textContent = `$${input.price}`;
  byId("preview-after").textContent = `$${legality?.after?.remainingBudget ?? team?.remainingBudget - input.price}`; byId("preview-max").textContent = `$${legality?.legalMaxBid ?? team?.legalMaxBid ?? 0}`;
  const ready = legality?.legal ? (snapshot.auctionStarted || snapshot.keepersLocked ? "Legal sale — ready to record." : "Legal sale — recording it will lock new keeper entry.") : legality?.message || "Sale is not legal.";
  setStatus(byId("sale-status"), ready, !legality?.legal);
}

function updatePendingKeeper() {
  if (!snapshot) return;
  if (snapshot.keepersLocked) { byId("keeper-preview").hidden = true; byId("record-keeper").disabled = true; setStatus(byId("keeper-status"), "New keeper entry is locked. Use Unlock keepers before the first sale, or Correct below for an audited repair."); return; }
  const input = {
    player: selectedKeeperPlayer,
    teamId: byId("keeper-team").value,
    salary: byId("keeper-salary").value,
    contractYear: byId("keeper-contract-year").value,
    keeperRound: byId("keeper-round").value,
  };
  const inputReady = Boolean(selectedKeeperPlayer && input.teamId && input.salary !== "");
  const legality = inputReady ? keeperLegality(snapshot, input) : null;
  byId("record-keeper").disabled = !legality?.legal; byId("keeper-preview").hidden = !inputReady;
  if (!inputReady) { setStatus(byId("keeper-status"), "Choose a player, fantasy team, and salary."); return; }
  const team = snapshot.teams.find((candidate) => candidate.id === input.teamId);
  byId("keeper-preview-sentence").textContent = `${selectedKeeperPlayer.name} → ${team?.name || "team"} as a $${input.salary} keeper`;
  byId("keeper-preview-before").textContent = `$${team?.remainingBudget ?? 0}`; byId("keeper-preview-price").textContent = `$${input.salary}`;
  byId("keeper-preview-after").textContent = `$${legality?.after?.remainingBudget ?? team?.remainingBudget ?? 0}`;
  byId("keeper-preview-count").textContent = legality?.after ? `${legality.after.keeperCount}/${legality.after.keeperMaximum}` : "—";
  setStatus(byId("keeper-status"), legality?.legal ? "Legal keeper — ready to record." : legality?.message || "Keeper is not legal.", !legality?.legal);
}

function publishLocalSnapshot() {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(snapshot));
    const sanitized = publicSnapshot(snapshot); localStorage.setItem(publicCacheKey(), JSON.stringify(sanitized));
    roomChannel?.postMessage(sanitized);
  } catch { /* The live server remains authoritative if browser storage is unavailable. */ }
}

function renderBoardState() {
  const connected = Date.now() - boardLastSeen < 5_000;
  byId("board-state").textContent = connected ? "BOARD CONNECTED" : "BOARD NOT OPEN";
  byId("board-state").classList.toggle("is-error", !connected);
}

function attachRoomChannel() {
  roomChannel?.close(); roomChannel = new BroadcastChannel(channelName());
  roomChannel.addEventListener("message", (event) => {
    if (event.data?.type !== "board-heartbeat" || event.data.leagueCode !== leagueCode()) return;
    boardLastSeen = Date.now(); renderBoardState();
  });
  if (boardStateTimer) window.clearInterval(boardStateTimer);
  boardStateTimer = window.setInterval(renderBoardState, 1_000);
}

function render() {
  if (!snapshot) return;
  byId("header-league").textContent = snapshot.config.leagueName; byId("header-season").textContent = `${snapshot.config.season} · AUCTIONEER · PUBLIC RESULTS ONLY`;
  const boardUrl = `../board/?league=${encodeURIComponent(snapshot.leagueCode)}`; byId("board-link").href = boardUrl;
  byId("finish-draft").textContent = snapshot.draftStatus === "complete" ? "Reopen draft" : "Finish draft";
  renderTeamOptions(); renderKeeperProgress(); renderTeamSummaries(); renderHistory(); updatePendingSale(); updatePendingKeeper(); publishLocalSnapshot(); renderBoardState();
}

function getQueue() { try { return JSON.parse(localStorage.getItem(queueKey()) || "[]"); } catch { return []; } }
function setQueue(value) { localStorage.setItem(queueKey(), JSON.stringify(value)); }

function renderSync(message = null, error = false) {
  const pending = getQueue().length; const chip = byId("sync-state");
  chip.textContent = message || (pending ? `${pending} PENDING` : "LIVE"); chip.classList.toggle("is-error", error || pending > 0);
}

function commandStatusElement(command) { return command?.type?.includes("keeper") || command?.statusTarget === "keeper" ? byId("keeper-status") : byId("sale-status"); }

async function flushQueue() {
  if (queueInFlight || !navigator.onLine || !snapshot) return;
  queueInFlight = true;
  try {
    let queue = getQueue();
    if (!queue.length) { renderSync(); return; }
    let canonical = await request(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(leagueCode())}`);
    while (queue.length) {
      const command = { ...queue[0], leagueCode: canonical.leagueCode, expectedRevision: canonical.revision };
      canonical = await request("/api/draft-day/commands", { method: "POST", body: JSON.stringify(command) });
      queue.shift(); setQueue(queue);
    }
    snapshot = canonical; render(); renderSync();
  } catch (error) {
    if (error.status === 401) {
      requireAuctioneerSignIn();
      return;
    }
    if (error.status && error.status < 500 && error.status !== 409) {
      const queue = getQueue(); const rejected = queue.shift(); setQueue(queue);
      try { snapshot = await request(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(leagueCode())}`); render(); } catch { /* Keep the last usable snapshot. */ }
      setStatus(commandStatusElement(rejected), `A pending action was rejected: ${error.message}`, true);
    }
    renderSync(navigator.onLine ? "RETRYING" : "OFFLINE", true);
    if (navigator.onLine && getQueue().length) window.setTimeout(() => void flushQueue(), 750);
  } finally { queueInFlight = false; }
}

async function runCommand(fields) {
  if (!snapshot) return false;
  const command = { ...fields, idempotencyKey: crypto.randomUUID(), eventId: fields.eventId || `${fields.type}-${crypto.randomUUID()}` };
  const firstSale = fields.type === "record-sale" && !snapshot.auctionStarted;
  try {
    const optimistic = optimisticSnapshot(snapshot, command);
    const queue = getQueue(); queue.push(command); setQueue(queue); snapshot = optimistic; render(); renderSync();
    if (fields.type === "record-sale") {
      clearPlayer(false); byId("winning-price").value = snapshot.config.minimumBid; playerSearch.focus();
      setStatus(byId("sale-status"), "Sale saved on this device and queued for cloud confirmation.");
      if (firstSale) { byId("keeper-setup").open = false; localStorage.setItem(keeperOpenKey(), "false"); }
      restartClockAfterSale();
    }
    if (fields.type === "record-keeper") {
      clearKeeperPlayer(); setStatus(byId("keeper-status"), "Keeper saved on this device and queued for cloud confirmation.");
    }
    if (fields.type === "lock-keepers" || fields.type === "unlock-keepers") setStatus(byId("keeper-status"), fields.type === "lock-keepers" ? "Keeper entry locked. You can unlock it until the first sale." : "Keeper entry unlocked.");
    await flushQueue(); return true;
  } catch (error) {
    setStatus(commandStatusElement(command), error.message, true); renderSync(null, !navigator.onLine); return false;
  }
}

async function refresh() {
  if (refreshInFlight || queueInFlight || !snapshot || getQueue().length) return;
  if (!navigator.onLine) { renderSync("OFFLINE", true); return; }
  refreshInFlight = true;
  try {
    const next = await request(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(leagueCode())}`);
    if (!snapshot || next.revision !== snapshot.revision) { snapshot = next; render(); }
    renderSync();
  } catch (error) {
    if (error.status === 401) requireAuctioneerSignIn();
    else renderSync(navigator.onLine ? "CONNECTION LOST" : "OFFLINE", true);
  }
  finally { refreshInFlight = false; }
}

function openCorrection(assignment) {
  const keeper = assignment.acquisitionType === "keeper";
  byId("correction-dialog").dataset.kind = assignment.acquisitionType;
  byId("correction-target").value = assignment.id; byId("correction-title").textContent = `Correct ${assignment.playerName}`;
  byId("correction-name").value = assignment.playerName; byId("correction-nfl-team").value = assignment.nflTeam;
  byId("correction-team").value = assignment.teamId; byId("correction-price").value = assignment.price;
  byId("correction-position").value = assignment.position; byId("correction-price").min = keeper ? "0" : String(snapshot.config.minimumBid);
  byId("correction-team-label").textContent = keeper ? "Fantasy team" : "Buying team";
  byId("correction-price-label").textContent = keeper ? "Keeper salary" : "Price";
  byId("correction-keeper-fields").hidden = !keeper;
  byId("correction-contract-year").value = assignment.contractYear ?? ""; byId("correction-keeper-round").value = assignment.keeperRound ?? "";
  byId("correction-dialog").showModal();
}

function populatePositionSelects() {
  for (const select of [byId("custom-position"), byId("correction-position")]) {
    select.replaceChildren(); snapshot.config.positionRules.forEach((rule) => select.append(option(rule.id, rule.label)));
  }
}

function loadClock() {
  try { clockState = { ...clockState, ...JSON.parse(localStorage.getItem(clockKey()) || "{}") }; } catch { /* Use defaults. */ }
  clockState.duration = Number(clockState.duration) || 30;
  if (clockState.running && clockState.deadline) clockState.remaining = Math.max(0, Math.ceil((clockState.deadline - Date.now()) / 1_000));
  byId("clock-enabled").checked = clockState.enabled; byId("clock-duration").value = String(clockState.duration);
  renderClock(); clearInterval(clockTimer); clockTimer = window.setInterval(tickClock, 250);
}

function saveClock() { try { localStorage.setItem(clockKey(), JSON.stringify(clockState)); } catch { /* Clock remains usable in memory. */ } }
function renderClock() {
  const display = byId("clock-display"); display.textContent = clockState.enabled ? String(clockState.remaining).padStart(2, "0") : "OFF";
  display.classList.toggle("is-expired", clockState.enabled && clockState.remaining <= 0);
  byId("clock-start").disabled = !clockState.enabled || clockState.running;
  byId("clock-pause").disabled = !clockState.enabled || !clockState.running;
  byId("clock-reset").disabled = !clockState.enabled;
}
function tickClock() {
  if (!clockState.running || !clockState.deadline) return;
  const remaining = Math.max(0, Math.ceil((clockState.deadline - Date.now()) / 1_000));
  if (remaining === clockState.remaining) return;
  clockState.remaining = remaining;
  if (!remaining) { clockState.running = false; clockState.deadline = null; }
  saveClock(); renderClock();
}
function startClock() { if (!clockState.enabled) return; clockState.running = true; clockState.deadline = Date.now() + clockState.remaining * 1_000; saveClock(); renderClock(); }
function pauseClock() { tickClock(); clockState.running = false; clockState.deadline = null; saveClock(); renderClock(); }
function resetClock(run = false) { clockState.remaining = clockState.duration; clockState.running = run && clockState.enabled; clockState.deadline = clockState.running ? Date.now() + clockState.remaining * 1_000 : null; saveClock(); renderClock(); }
function restartClockAfterSale() { if (clockState.enabled) resetClock(true); }

async function enterConsole() {
  loginPanel.hidden = true; consolePanel.hidden = false;
  if (!playerPool.length) playerPool = await fetch("../player-pool.json", { cache: "force-cache" }).then((response) => response.ok ? response.json() : []);
  populatePositionSelects(); byId("winning-price").value = snapshot.config.minimumBid;
  attachRoomChannel();
  const savedOpen = localStorage.getItem(keeperOpenKey()); byId("keeper-setup").open = savedOpen == null ? !snapshot.auctionStarted : savedOpen === "true";
  loadClock(); render();
  pollTimer ||= window.setInterval(() => void refresh(), 1_200); playerSearch.focus(); void flushQueue();
}

function stopConsoleResources() {
  if (pollTimer) window.clearInterval(pollTimer);
  if (boardStateTimer) window.clearInterval(boardStateTimer);
  if (clockTimer) window.clearInterval(clockTimer);
  pollTimer = null; boardStateTimer = null; clockTimer = null;
  roomChannel?.close(); roomChannel = null; boardLastSeen = 0;
}

function requireAuctioneerSignIn(message = "Auctioneer sign-in expired. Enter the auctioneer code again.") {
  stopConsoleResources(); consolePanel.hidden = true; loginPanel.hidden = false; byId("access-code").value = "";
  const pending = getQueue().length;
  setStatus(byId("login-status"), pending ? `${message} ${pending} pending ${pending === 1 ? "action is" : "actions are"} safe on this device and will sync after sign-in.` : message, true);
}

async function restoreAuctioneerSession(value) {
  if (!value) return false;
  loginPanel.hidden = true;
  try {
    const code = normalizeLeagueCode(value); byId("league-code").value = code;
    setStatus(byId("login-status"), "Restoring auctioneer session…");
    snapshot = await request(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(code)}`);
    rememberLeague(localStorage, "auctioneer", code);
    await enterConsole(); return true;
  } catch (error) {
    if (error.status !== 401) {
      try {
        const code = normalizeLeagueCode(value); const cached = JSON.parse(localStorage.getItem(cacheKey(code)) || "null");
        if (cached && savedVerifier(localStorage, "auctioneer", code)) { snapshot = cached; await enterConsole(); renderSync("OFFLINE CACHE", true); return true; }
      } catch { /* Leave the sign-in form available. */ }
    }
    loginPanel.hidden = false; setStatus(byId("login-status"), error.status === 401 ? "Enter the auctioneer code to open this league." : error.message, error.status !== 401); return false;
  }
}

byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); setStatus(byId("login-status"), "Opening auction room…");
  let code = ""; let verifier = ""; let boardWindow = null;
  try {
    code = normalizeLeagueCode(byId("league-code").value); byId("league-code").value = code;
    if (byId("open-board-after-login").checked) boardWindow = window.open("about:blank", "pips-draft-day-board");
    const accessCode = byId("access-code").value;
    await request("/api/draft-day/auth", { method: "POST", body: JSON.stringify({ leagueCode: code, role: "auctioneer", code: accessCode }) });
    verifier = await accessVerifier(accessCode); saveVerifier(localStorage, "auctioneer", code, verifier); byId("access-code").value = "";
    snapshot = await request(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(code)}`); rememberLeague(localStorage, "auctioneer", code);
    await enterConsole();
    if (byId("open-board-after-login").checked) {
      const boardUrl = `../board/?league=${encodeURIComponent(code)}`;
      if (boardWindow) boardWindow.location.replace(boardUrl);
      else setStatus(byId("sale-status"), "The browser blocked the Draft Board window. Use Open board in the header.", true);
    }
  } catch (error) {
    try {
      code ||= normalizeLeagueCode(byId("league-code").value); const cached = JSON.parse(localStorage.getItem(cacheKey(code)) || "null");
      verifier ||= await accessVerifier(byId("access-code").value);
      const verified = savedVerifier(localStorage, "auctioneer", code) === verifier;
      if (cached && verified) { snapshot = cached; byId("access-code").value = ""; await enterConsole(); renderSync("OFFLINE CACHE", true); return; }
    } catch { /* Continue with the sign-in error. */ }
    if (boardWindow && code) boardWindow.location.replace(`../board/?league=${encodeURIComponent(code)}`);
    setStatus(byId("login-status"), error.message, true);
  }
});

bindPredictiveSearch("sale"); bindPredictiveSearch("keeper");
byId("clear-player").addEventListener("click", clearPlayer); byId("keeper-clear-player").addEventListener("click", clearKeeperPlayer);
byId("focus-search").addEventListener("click", () => playerSearch.focus());
byId("buying-team").addEventListener("change", updatePendingSale); byId("winning-price").addEventListener("input", updatePendingSale);
for (const id of ["keeper-team", "keeper-salary", "keeper-contract-year", "keeper-round"]) byId(id).addEventListener("input", updatePendingKeeper);

byId("keeper-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = { player: selectedKeeperPlayer, teamId: byId("keeper-team").value, salary: byId("keeper-salary").value, contractYear: byId("keeper-contract-year").value, keeperRound: byId("keeper-round").value };
  const legality = keeperLegality(snapshot, input); if (!legality.legal) { setStatus(byId("keeper-status"), legality.message, true); return; }
  void runCommand({ type: "record-keeper", ...input });
});

byId("sale-form").addEventListener("submit", (event) => {
  event.preventDefault(); const legality = saleLegality(snapshot, { player: selectedPlayer, teamId: byId("buying-team").value, price: Number(byId("winning-price").value) });
  if (!legality.legal) { setStatus(byId("sale-status"), legality.message, true); return; }
  void runCommand({ type: "record-sale", player: selectedPlayer, teamId: legality.team.id, price: legality.price });
});

function openCustomPlayer(target) {
  customPlayerTarget = target; const search = target === "keeper" ? keeperSearch : playerSearch;
  byId("custom-name").value = search.value.trim(); byId("custom-player-dialog").showModal();
}
byId("add-custom-player").addEventListener("click", () => openCustomPlayer("sale"));
byId("add-custom-keeper-player").addEventListener("click", () => openCustomPlayer("keeper"));
byId("custom-player-form").addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault(); const name = byId("custom-name").value.trim(); const position = byId("custom-position").value;
  const player = normalizePlayer({ id: `custom-${crypto.randomUUID()}`, name, position, nflTeam: byId("custom-nfl-team").value.trim() || "FA" });
  byId("custom-player-dialog").close();
  if (await runCommand({ type: "add-player", player, statusTarget: customPlayerTarget })) customPlayerTarget === "keeper" ? selectKeeperPlayer(player) : selectPlayer(player);
});

byId("correction-form").addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault(); const targetId = byId("correction-target").value; const target = snapshot.assignments.find((assignment) => assignment.id === targetId);
  const player = { id: target?.playerId || `corrected-${targetId}`, name: byId("correction-name").value, position: byId("correction-position").value, nflTeam: byId("correction-nfl-team").value || "FA" };
  const command = target?.acquisitionType === "keeper"
    ? { type: "correct-keeper", targetId, player, teamId: byId("correction-team").value, salary: byId("correction-price").value, contractYear: byId("correction-contract-year").value, keeperRound: byId("correction-keeper-round").value }
    : { type: "correct-sale", targetId, player, teamId: byId("correction-team").value, price: Number(byId("correction-price").value) };
  byId("correction-dialog").close(); void runCommand(command);
});

byId("keeper-setup").addEventListener("toggle", () => { byId("keeper-toggle-label").textContent = byId("keeper-setup").open ? "Collapse" : "Expand"; if (snapshot) localStorage.setItem(keeperOpenKey(), String(byId("keeper-setup").open)); });
byId("toggle-keeper-lock").addEventListener("click", () => void runCommand({ type: snapshot.keepersLocked ? "unlock-keepers" : "lock-keepers", statusTarget: "keeper" }));
byId("copy-board-link").addEventListener("click", async () => {
  const url = new URL(byId("board-link").href, location.href).href;
  try { await navigator.clipboard.writeText(url); byId("copy-board-link").textContent = "Board link copied"; window.setTimeout(() => { byId("copy-board-link").textContent = "Copy board link"; }, 1_500); }
  catch { setStatus(byId("sale-status"), `Board link: ${url}`); }
});
byId("finish-draft").addEventListener("click", () => void runCommand({ type: snapshot.draftStatus === "complete" ? "reopen-draft" : "finish-draft" }));
byId("export-csv").addEventListener("click", () => exportFile(byId("export-csv"), draftCsv(snapshot), `${snapshot.leagueCode.toLowerCase()}-auction-results.csv`, "text/csv;charset=utf-8", "CSV download started"));
byId("export-json").addEventListener("click", () => exportFile(byId("export-json"), JSON.stringify({ kind: "pips-draft-day-backup", exportedAt: new Date().toISOString(), snapshot }, null, 2), `${snapshot.leagueCode.toLowerCase()}-auction-backup.json`, "application/json", "Backup download started"));

async function logOut() {
  const button = byId("logout"); button.disabled = true; button.textContent = "Logging out…";
  try {
    const code = leagueCode();
    await request("/api/draft-day/auth", { method: "DELETE" });
    clearRememberedAccess(localStorage, code);
    location.reload();
  } catch (error) {
    button.disabled = false; button.textContent = "Log out";
    setStatus(byId("sale-status"), `Could not log out securely: ${error.message}`, true);
  }
}

byId("logout").addEventListener("click", () => void logOut());

byId("clock-enabled").addEventListener("change", () => { clockState.enabled = byId("clock-enabled").checked; resetClock(false); });
byId("clock-duration").addEventListener("change", () => { clockState.duration = Number(byId("clock-duration").value); resetClock(false); });
byId("clock-start").addEventListener("click", startClock); byId("clock-pause").addEventListener("click", pauseClock); byId("clock-reset").addEventListener("click", () => resetClock(false));

function download(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type })); const link = document.createElement("a");
  link.href = url; link.download = filename; link.hidden = true; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function exportFile(button, contents, filename, type, confirmation) {
  const originalLabel = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = originalLabel; download(contents, filename, type); button.textContent = confirmation;
  window.setTimeout(() => { button.textContent = originalLabel; }, 1_500);
}

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); playerSearch.focus(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && snapshot) {
    const active = [...snapshot.assignments].filter((assignment) => assignment.status === "active").sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const latest = snapshot.auctionStarted ? active.find((assignment) => assignment.acquisitionType === "auction") : active[0];
    if (latest) { event.preventDefault(); void runCommand({ type: latest.acquisitionType === "keeper" ? "void-keeper" : "void-sale", targetId: latest.id }); }
  }
});
window.addEventListener("online", () => void flushQueue()); window.addEventListener("offline", () => renderSync("OFFLINE", true));
const initialLeague = query.get("league") || rememberedLeague(localStorage, "auctioneer"); byId("league-code").value = initialLeague;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../service-worker.js").catch(() => {});
void restoreAuctioneerSession(initialLeague);
