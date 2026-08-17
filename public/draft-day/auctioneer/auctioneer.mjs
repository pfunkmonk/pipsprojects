import { draftCsv, normalizeLeagueCode, optimisticSnapshot, playerIdentity, publicSnapshot, saleLegality } from "../core.mjs";

const byId = (id) => document.getElementById(id);
const loginPanel = byId("login-panel");
const consolePanel = byId("console");
const playerSearch = byId("player-search");
let snapshot = null;
let serverSnapshot = null;
let playerPool = [];
let selectedPlayer = null;
let refreshInFlight = false;
let queueInFlight = false;
let pollTimer = null;
const query = new URLSearchParams(location.search);

function leagueCode() { return snapshot?.leagueCode || normalizeLeagueCode(byId("league-code").value); }
function cacheKey(code = leagueCode()) { return `pips-draft-day-auctioneer-${code}`; }
function queueKey(code = leagueCode()) { return `pips-draft-day-outbox-${code}`; }
function publicCacheKey(code = leagueCode()) { return `pips-draft-day-board-${code}`; }
function channelName(code = leagueCode()) { return `pips-draft-day-${code}`; }
function verifierKey(code) { return `pips-draft-day-auctioneer-verifier-${code}`; }

async function accessVerifier(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pips-draft-day-auctioneer|${value}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function setStatus(element, message, error = false) {
  element.textContent = message; element.classList.toggle("is-error", error); element.classList.toggle("is-success", Boolean(message) && !error);
}

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || "The Draft Day service is unavailable."); error.status = response.status; error.code = body.code; throw error; }
  return body;
}

function normalizeSearch(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function rankPlayers(players, value) {
  const queryText = normalizeSearch(value); if (!queryText) return [];
  const tokens = queryText.split(" ");
  return players.map((player) => {
    const name = normalizeSearch(player.name); const haystack = `${name} ${normalizeSearch(player.position)} ${normalizeSearch(player.nflTeam)}`;
    if (!tokens.every((token) => haystack.includes(token))) return null;
    const score = name === queryText ? 0 : name.startsWith(queryText) ? 1 : haystack.startsWith(queryText) ? 2 : 3;
    return { player, score };
  }).filter(Boolean).sort((left, right) => left.score - right.score || left.player.name.localeCompare(right.player.name)).map((entry) => entry.player);
}

function option(value, label, selected = false) {
  const element = document.createElement("option"); element.value = value; element.textContent = label; element.selected = selected; return element;
}

function allPlayers() {
  const map = new Map();
  for (const player of [...playerPool, ...(snapshot?.customPlayers || [])]) map.set(player.id, player);
  return [...map.values()];
}

function activePlayerIds() {
  return new Set((snapshot?.assignments || []).filter((assignment) => assignment.status === "active").map((assignment) => playerIdentity({ id: assignment.playerId, name: assignment.playerName, position: assignment.position })));
}

function availablePlayers() { const active = activePlayerIds(); return allPlayers().filter((player) => !active.has(playerIdentity(player))); }

function renderSearchResults() {
  const results = byId("player-results"); results.replaceChildren();
  if (selectedPlayer || !playerSearch.value.trim()) { results.hidden = true; byId("add-custom-player").hidden = true; playerSearch.setAttribute("aria-expanded", "false"); return; }
  const matches = rankPlayers(availablePlayers(), playerSearch.value).slice(0, 10);
  for (const player of matches) {
    const button = document.createElement("button"); button.type = "button"; button.className = "search-result"; button.setAttribute("role", "option");
    const name = document.createElement("strong"); name.textContent = player.name; const meta = document.createElement("span"); meta.textContent = `${player.position} · ${player.nflTeam}`;
    button.append(name, meta); button.addEventListener("click", () => selectPlayer(player)); results.append(button);
  }
  if (!matches.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No matching player in the built-in pool."; results.append(empty); }
  results.hidden = false; byId("add-custom-player").hidden = false; playerSearch.setAttribute("aria-expanded", "true");
}

function selectPlayer(player) {
  selectedPlayer = player; playerSearch.value = player.name; byId("player-results").hidden = true; byId("add-custom-player").hidden = true;
  byId("selected-player").hidden = false; byId("selected-position").textContent = player.position; byId("selected-name").textContent = player.name; byId("selected-nfl-team").textContent = player.nflTeam;
  updatePendingSale(); byId("buying-team").focus();
}

function clearPlayer() { selectedPlayer = null; playerSearch.value = ""; byId("selected-player").hidden = true; updatePendingSale(); playerSearch.focus(); }

function activeAssignments() { return snapshot.assignments.filter((assignment) => assignment.status === "active"); }

function renderTeamOptions() {
  const buying = byId("buying-team"); const correction = byId("correction-team"); const selected = buying.value;
  buying.replaceChildren(option("", "Choose a team")); correction.replaceChildren();
  for (const team of snapshot.teams) {
    buying.append(option(team.id, `${team.name} — $${team.remainingBudget} left · max $${team.legalMaxBid}`, team.id === selected));
    correction.append(option(team.id, team.name));
  }
}

function renderTeamSummaries() {
  const container = byId("team-summary-grid"); container.replaceChildren();
  for (const team of snapshot.teams) {
    const card = document.createElement("article"); card.className = "team-summary";
    const header = document.createElement("header"); const name = document.createElement("strong"); name.textContent = team.name; const cash = document.createElement("b"); cash.textContent = `$${team.remainingBudget}`; header.append(name, cash);
    const summary = document.createElement("p"); summary.textContent = `${team.rosterCount}/${snapshot.config.rosterMaximum} rostered · max legal bid $${team.legalMaxBid}${team.canFinish ? " · legal to finish" : ""}`;
    const counts = document.createElement("div"); counts.className = "count-row";
    for (const rule of snapshot.config.positionRules) { const chip = document.createElement("span"); chip.textContent = `${rule.id} ${team.positionCounts[rule.id] || 0}`; counts.append(chip); }
    card.append(header, summary, counts); container.append(card);
  }
  const current = snapshot.teams.find((team) => team.id === snapshot.currentNominatorTeamId);
  byId("nominator-status").textContent = snapshot.config.nominationMode === "manual" ? "Nomination tracking is off." : current ? `${current.name} is next to nominate.` : "Nomination order unavailable.";
}

function renderHistory() {
  const body = byId("history-rows"); body.replaceChildren();
  const assignments = [...snapshot.assignments].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  if (!assignments.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 6; cell.className = "empty-state"; cell.textContent = "No keepers or sales recorded yet."; row.append(cell); body.append(row); return; }
  for (const assignment of assignments) {
    const row = document.createElement("tr");
    const values = [assignment.playerName, snapshot.config.teams.find((team) => team.id === assignment.teamId)?.name || assignment.teamId, `$${assignment.price}`, assignment.acquisitionType, assignment.status];
    values.forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); });
    const actions = document.createElement("td"); actions.className = "history-actions";
    if (assignment.acquisitionType === "auction") {
      if (assignment.status === "active") {
        const edit = document.createElement("button"); edit.type = "button"; edit.className = "secondary"; edit.textContent = "Correct"; edit.addEventListener("click", () => openCorrection(assignment));
        const undo = document.createElement("button"); undo.type = "button"; undo.className = "danger"; undo.textContent = "Undo"; undo.addEventListener("click", () => void runCommand({ type: "void-sale", targetId: assignment.id })); actions.append(edit, undo);
      } else {
        const restore = document.createElement("button"); restore.type = "button"; restore.className = "secondary"; restore.textContent = "Restore"; restore.addEventListener("click", () => void runCommand({ type: "restore-sale", targetId: assignment.id })); actions.append(restore);
      }
    }
    row.append(actions); body.append(row);
  }
}

function updatePendingSale() {
  if (!snapshot) return;
  const input = { player: selectedPlayer, teamId: byId("buying-team").value, price: Number(byId("winning-price").value) };
  const inputReady = Boolean(selectedPlayer && input.teamId && input.price);
  const legality = inputReady ? saleLegality(snapshot, input) : null;
  byId("record-sale").disabled = !legality?.legal;
  byId("sale-preview").hidden = !inputReady;
  if (!inputReady) { setStatus(byId("sale-status"), "Choose a player, team, and price."); return; }
  const team = snapshot.teams.find((candidate) => candidate.id === input.teamId);
  byId("preview-sentence").textContent = `${selectedPlayer.name} → ${team?.name || "team"} for $${input.price}`;
  byId("preview-before").textContent = `$${team?.remainingBudget ?? 0}`; byId("preview-price").textContent = `$${input.price}`; byId("preview-after").textContent = `$${legality?.after?.remainingBudget ?? team?.remainingBudget - input.price}`; byId("preview-max").textContent = `$${legality?.legalMaxBid ?? team?.legalMaxBid ?? 0}`;
  setStatus(byId("sale-status"), legality?.legal ? "Legal sale — ready to record." : legality?.message || "Sale is not legal.", !legality?.legal);
}

function publishLocalSnapshot() {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(snapshot));
    const sanitized = publicSnapshot(snapshot); localStorage.setItem(publicCacheKey(), JSON.stringify(sanitized));
    const channel = new BroadcastChannel(channelName()); channel.postMessage(sanitized); channel.close();
  } catch { /* The live server remains authoritative if browser storage is unavailable. */ }
}

function render() {
  if (!snapshot) return;
  byId("header-league").textContent = snapshot.config.leagueName; byId("header-season").textContent = `${snapshot.config.season} · AUCTIONEER · PUBLIC RESULTS ONLY`;
  byId("board-link").href = `../board/?league=${encodeURIComponent(snapshot.leagueCode)}`;
  byId("finish-draft").textContent = snapshot.draftStatus === "complete" ? "Reopen draft" : "Finish draft";
  renderTeamOptions(); renderTeamSummaries(); renderHistory(); updatePendingSale(); publishLocalSnapshot();
}

function getQueue() { try { return JSON.parse(localStorage.getItem(queueKey()) || "[]"); } catch { return []; } }
function setQueue(value) { localStorage.setItem(queueKey(), JSON.stringify(value)); }

function renderSync(message = null, error = false) {
  const pending = getQueue().length; const chip = byId("sync-state");
  chip.textContent = message || (pending ? `${pending} PENDING` : "LIVE"); chip.classList.toggle("is-error", error || pending > 0);
}

async function flushQueue() {
  if (queueInFlight || !navigator.onLine || !snapshot) return;
  queueInFlight = true;
  try {
    let queue = getQueue();
    if (!queue.length) { renderSync(); return; }
    let canonical = await request(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(leagueCode())}`);
    serverSnapshot = canonical;
    while (queue.length) {
      const command = { ...queue[0], leagueCode: canonical.leagueCode, expectedRevision: canonical.revision };
      canonical = await request("/api/draft-day/commands", { method: "POST", body: JSON.stringify(command) });
      queue.shift(); setQueue(queue);
    }
    snapshot = serverSnapshot = canonical; render(); renderSync();
  } catch (error) {
    if (error.status && error.status < 500 && error.status !== 409) { const queue = getQueue(); queue.shift(); setQueue(queue); setStatus(byId("sale-status"), `A pending action was rejected: ${error.message}`, true); }
    renderSync(navigator.onLine ? "RETRYING" : "OFFLINE", true);
    if (navigator.onLine && getQueue().length) window.setTimeout(() => void flushQueue(), 750);
  } finally { queueInFlight = false; }
}

async function runCommand(fields) {
  if (!snapshot) return;
  const command = { ...fields, idempotencyKey: crypto.randomUUID(), eventId: fields.eventId || `${fields.type}-${crypto.randomUUID()}` };
  try {
    const optimistic = optimisticSnapshot(snapshot, command);
    const queue = getQueue(); queue.push(command); setQueue(queue); snapshot = optimistic; render(); renderSync();
    if (fields.type === "record-sale") { clearPlayer(); byId("winning-price").value = snapshot.config.minimumBid; playerSearch.focus(); setStatus(byId("sale-status"), "Sale saved on this device and queued for cloud confirmation."); }
    await flushQueue();
  } catch (error) { setStatus(byId("sale-status"), error.message, true); renderSync(null, !navigator.onLine); }
}

async function refresh() {
  if (refreshInFlight || queueInFlight || !snapshot || getQueue().length) return;
  refreshInFlight = true;
  try {
    const next = await request(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(leagueCode())}`);
    if (!snapshot || next.revision !== snapshot.revision) { snapshot = serverSnapshot = next; render(); }
    renderSync();
  } catch (error) { renderSync(navigator.onLine ? "CONNECTION LOST" : "OFFLINE", true); }
  finally { refreshInFlight = false; }
}

function openCorrection(assignment) {
  byId("correction-target").value = assignment.id; byId("correction-title").textContent = `Correct ${assignment.playerName}`; byId("correction-name").value = assignment.playerName; byId("correction-nfl-team").value = assignment.nflTeam; byId("correction-team").value = assignment.teamId; byId("correction-price").value = assignment.price; byId("correction-position").value = assignment.position; byId("correction-dialog").showModal();
}

function populatePositionSelects() {
  for (const select of [byId("custom-position"), byId("correction-position")]) { select.replaceChildren(); snapshot.config.positionRules.forEach((rule) => select.append(option(rule.id, rule.label))); }
}

async function enterConsole() {
  loginPanel.hidden = true; consolePanel.hidden = false;
  playerPool = await fetch("../player-pool.json", { cache: "force-cache" }).then((response) => response.ok ? response.json() : []);
  populatePositionSelects(); byId("winning-price").value = snapshot.config.minimumBid; render();
  pollTimer ||= window.setInterval(() => void refresh(), 1_200); playerSearch.focus(); void flushQueue();
}

byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); setStatus(byId("login-status"), "Opening auction room…");
  try {
    const code = normalizeLeagueCode(byId("league-code").value); byId("league-code").value = code;
    await request("/api/draft-day/auth", { method: "POST", body: JSON.stringify({ leagueCode: code, role: "auctioneer", code: byId("access-code").value }) });
    localStorage.setItem(verifierKey(code), await accessVerifier(byId("access-code").value));
    snapshot = serverSnapshot = await request(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(code)}`); localStorage.setItem("pips-draft-day-last-league", code);
    if (byId("open-board-after-login").checked) window.open(`../board/?league=${encodeURIComponent(code)}`, "pips-draft-day-board");
    await enterConsole();
  } catch (error) {
    try { const code = normalizeLeagueCode(byId("league-code").value); const cached = JSON.parse(localStorage.getItem(cacheKey(code)) || "null"); const verified = localStorage.getItem(verifierKey(code)) === await accessVerifier(byId("access-code").value); if (cached && verified) { snapshot = cached; await enterConsole(); renderSync("OFFLINE CACHE", true); return; } } catch { /* Continue with the sign-in error. */ }
    setStatus(byId("login-status"), error.message, true);
  }
});

playerSearch.addEventListener("input", () => { if (selectedPlayer && playerSearch.value !== selectedPlayer.name) selectedPlayer = null; byId("selected-player").hidden = !selectedPlayer; renderSearchResults(); updatePendingSale(); });
playerSearch.addEventListener("keydown", (event) => { if (event.key === "Enter" && !selectedPlayer) { const first = byId("player-results").querySelector("button"); if (first) { event.preventDefault(); first.click(); } } });
byId("clear-player").addEventListener("click", clearPlayer); byId("focus-search").addEventListener("click", () => playerSearch.focus());
byId("buying-team").addEventListener("change", updatePendingSale); byId("winning-price").addEventListener("input", updatePendingSale);
byId("sale-form").addEventListener("submit", (event) => { event.preventDefault(); const legality = saleLegality(snapshot, { player: selectedPlayer, teamId: byId("buying-team").value, price: Number(byId("winning-price").value) }); if (!legality.legal) { setStatus(byId("sale-status"), legality.message, true); return; } void runCommand({ type: "record-sale", player: selectedPlayer, teamId: legality.team.id, price: legality.price }); });
byId("add-custom-player").addEventListener("click", () => { byId("custom-name").value = playerSearch.value.trim(); byId("custom-player-dialog").showModal(); });
byId("custom-player-form").addEventListener("submit", (event) => { if (event.submitter?.value === "cancel") return; event.preventDefault(); const name = byId("custom-name").value.trim(); const position = byId("custom-position").value; const player = { id: `custom-${crypto.randomUUID()}`, name, position, nflTeam: byId("custom-nfl-team").value.trim() || "FA" }; byId("custom-player-dialog").close(); void runCommand({ type: "add-player", player }).then(() => selectPlayer(player)); });
byId("correction-form").addEventListener("submit", (event) => { if (event.submitter?.value === "cancel") return; event.preventDefault(); const targetId = byId("correction-target").value; const target = snapshot.assignments.find((assignment) => assignment.id === targetId); const command = { type: "correct-sale", targetId, player: { id: target?.playerId || `corrected-${targetId}`, name: byId("correction-name").value, position: byId("correction-position").value, nflTeam: byId("correction-nfl-team").value || "FA" }, teamId: byId("correction-team").value, price: Number(byId("correction-price").value) }; byId("correction-dialog").close(); void runCommand(command); });
byId("finish-draft").addEventListener("click", () => void runCommand({ type: snapshot.draftStatus === "complete" ? "reopen-draft" : "finish-draft" }));
byId("export-csv").addEventListener("click", () => download(draftCsv(snapshot), `${snapshot.leagueCode.toLowerCase()}-auction.csv`, "text/csv;charset=utf-8"));
byId("export-json").addEventListener("click", () => download(JSON.stringify({ kind: "pips-draft-day-backup", exportedAt: new Date().toISOString(), snapshot }, null, 2), `${snapshot.leagueCode.toLowerCase()}-auction-backup.json`, "application/json"));

function download(contents, filename, type) { const url = URL.createObjectURL(new Blob([contents], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); playerSearch.focus(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && snapshot) { const latest = [...snapshot.assignments].reverse().find((assignment) => assignment.acquisitionType === "auction" && assignment.status === "active"); if (latest) { event.preventDefault(); void runCommand({ type: "void-sale", targetId: latest.id }); } }
});
window.addEventListener("online", () => void flushQueue()); window.addEventListener("offline", () => renderSync("OFFLINE", true));
const initialLeague = query.get("league") || localStorage.getItem("pips-draft-day-last-league") || ""; byId("league-code").value = initialLeague;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../service-worker.js").catch(() => {});
