import { DEFAULT_POSITION_RULES, normalizeLeagueCode, normalizeLeagueConfig } from "./core.mjs";
import { clearRememberedAccess, rememberLeague, rememberedLeague } from "./session-storage.mjs";

const byId = (id) => document.getElementById(id);
const displayLeagueCode = (value) => String(value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
const steps = [...document.querySelectorAll("[data-wizard-step]")];
const pills = [...document.querySelectorAll("[data-step]")];
let currentStep = 0;
let editingSnapshot = null;
let resultAccess = null;
let currentOrganizerLeague = "";

function setStatus(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("is-error", error);
  element.classList.toggle("is-success", Boolean(message) && !error);
}

function randomCode(length = 12) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return [...values].map((value) => alphabet[value % alphabet.length]).join("");
}

function generateCodes() {
  byId("admin-code").value = randomCode(14);
  byId("auctioneer-code").value = randomCode(10);
  byId("board-code").value = randomCode(10);
}

function showStep(index) {
  currentStep = Math.max(0, Math.min(steps.length - 1, index));
  steps.forEach((step, stepIndex) => { step.hidden = stepIndex !== currentStep; });
  pills.forEach((pill, stepIndex) => pill.classList.toggle("is-active", stepIndex === currentStep));
  byId("previous-step").disabled = currentStep === 0;
  byId("next-step").hidden = currentStep === steps.length - 1;
  byId("save-league").hidden = currentStep !== steps.length - 1;
  byId("save-league").textContent = editingSnapshot ? "Save setup" : "Create league";
}

function input(type, value, attributes = {}) {
  const element = document.createElement("input");
  element.type = type;
  element.value = value ?? "";
  for (const [key, attribute] of Object.entries(attributes)) element.setAttribute(key, attribute);
  return element;
}

function renderPositionRules(rules = DEFAULT_POSITION_RULES) {
  const body = byId("position-rules");
  body.replaceChildren();
  rules.forEach((rule) => {
    const row = document.createElement("tr");
    row.dataset.positionRow = "true";
    const idCell = document.createElement("td");
    const labelCell = document.createElement("td");
    const minCell = document.createElement("td");
    const maxCell = document.createElement("td");
    const actionCell = document.createElement("td");
    idCell.append(input("text", rule.id, { maxlength: "20", "data-position-id": "true", required: "" }));
    labelCell.append(input("text", rule.label, { maxlength: "30", "data-position-label": "true", required: "" }));
    minCell.append(input("number", rule.minimum, { min: "0", "data-position-min": "true", required: "" }));
    maxCell.append(input("number", rule.maximum, {
      min: "0",
      placeholder: "No positional limit",
      title: "Leave blank to allow any number at this position up to the overall roster maximum.",
      "aria-label": `${rule.label} maximum; leave blank for no positional limit`,
      "data-position-max": "true",
    }));
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "secondary"; remove.textContent = "Remove";
    remove.addEventListener("click", () => row.remove());
    actionCell.append(remove);
    row.append(idCell, labelCell, minCell, maxCell, actionCell);
    body.append(row);
  });
}

function currentTeams() {
  return [...byId("team-rows").querySelectorAll("tr")].map((row, index) => ({
    id: row.dataset.teamId || `team-${index + 1}`,
    name: row.querySelector("[data-team-name]").value,
    enteredPool: row.querySelector("[data-team-pool]").value,
  }));
}

function renderTeams(teams = null) {
  const existing = teams || currentTeams();
  const count = Number(byId("team-count").value) || 2;
  const defaultPool = Number(byId("default-pool").value) || 200;
  const body = byId("team-rows");
  body.replaceChildren();
  for (let index = 0; index < count; index += 1) {
    const team = existing[index] || { id: `team-${index + 1}`, name: `Team ${index + 1}`, enteredPool: defaultPool };
    const row = document.createElement("tr");
    row.dataset.teamId = team.id;
    const order = document.createElement("td"); order.textContent = String(index + 1);
    const name = document.createElement("td"); name.append(input("text", team.name, { maxlength: "60", "data-team-name": "true", required: "" }));
    const pool = document.createElement("td"); pool.append(input("number", team.enteredPool, { min: "1", "data-team-pool": "true", required: "" }));
    row.append(order, name, pool); body.append(row);
  }
}

function gatherConfig() {
  const positionRules = [...byId("position-rules").querySelectorAll("tr")].map((row) => ({
    id: row.querySelector("[data-position-id]").value,
    label: row.querySelector("[data-position-label]").value,
    minimum: row.querySelector("[data-position-min]").value,
    maximum: row.querySelector("[data-position-max]").value,
  }));
  const teams = currentTeams();
  const keepers = editingSnapshot?.config?.keepers || [];
  return normalizeLeagueConfig({
    leagueName: byId("league-name").value,
    season: byId("season").value,
    minimumBid: byId("minimum-bid").value,
    bidIncrement: byId("bid-increment").value,
    rosterMinimum: byId("roster-minimum").value,
    rosterMaximum: byId("roster-maximum").value,
    keeperMaximum: byId("keeper-maximum").value,
    budgetMode: "pre-keeper",
    nominationMode: byId("nomination-mode").value,
    positionRules, teams, keepers, keepersEnabled: true,
    nominationOrder: teams.map((team) => team.id),
  });
}

function openSetup() {
  byId("setup-panel").hidden = false; byId("result-panel").hidden = true; showStep(0);
  byId("setup-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function loadSnapshot(snapshot) {
  editingSnapshot = snapshot;
  currentOrganizerLeague = snapshot.leagueCode;
  byId("logout").hidden = false;
  const config = snapshot.config;
  byId("setup-title").textContent = `Manage ${config.leagueName}`;
  byId("setup-subtitle").textContent = `League ${displayLeagueCode(snapshot.leagueCode)} · Setup locks after the first auction sale.`;
  byId("league-name").value = config.leagueName; byId("season").value = config.season; byId("team-count").value = config.teams.length;
  byId("minimum-bid").value = config.minimumBid; byId("bid-increment").value = config.bidIncrement; byId("nomination-mode").value = config.nominationMode;
  byId("roster-minimum").value = config.rosterMinimum; byId("roster-maximum").value = config.rosterMaximum; byId("keeper-maximum").value = config.keeperMaximum ?? "";
  renderPositionRules(config.positionRules); renderTeams(config.teams);
  byId("new-access-fields").hidden = true; byId("existing-access-note").hidden = false;
  openSetup();
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || "The Draft Day service is unavailable."); error.status = response.status; throw error; }
  return body;
}

function showResult(snapshot, access) {
  const friendlyCode = displayLeagueCode(snapshot.leagueCode);
  currentOrganizerLeague = snapshot.leagueCode;
  resultAccess = { leagueCode: friendlyCode, leagueName: snapshot.config.leagueName, ...access };
  byId("logout").hidden = false;
  byId("setup-panel").hidden = true; byId("manage-panel").hidden = true; byId("result-panel").hidden = false;
  byId("result-league-name").textContent = `${snapshot.config.leagueName} is ready`;
  byId("result-league-code").textContent = friendlyCode;
  const container = byId("result-access"); container.replaceChildren();
  for (const [label, key] of [["Organizer", "adminCode"], ["Auctioneer", "auctioneerCode"], ["Draft Board", "boardCode"]]) {
    const card = document.createElement("div"); card.className = "access-card"; const strong = document.createElement("strong"); strong.textContent = `${label} code`; const code = document.createElement("code"); code.textContent = access[key]; card.append(strong, code); container.append(card);
  }
  const encoded = encodeURIComponent(friendlyCode);
  byId("result-auctioneer-link").href = `./auctioneer/?league=${encoded}`; byId("result-board-link").href = `./board/?league=${encoded}`;
  byId("result-panel").scrollIntoView({ behavior: "smooth" });
}

byId("start-create").addEventListener("click", () => { editingSnapshot = null; byId("setup-title").textContent = "Create the auction room"; byId("setup-subtitle").textContent = "Nothing here affects projections or player advice."; byId("new-access-fields").hidden = false; byId("existing-access-note").hidden = true; openSetup(); });
byId("close-setup").addEventListener("click", () => { byId("setup-panel").hidden = true; });
pills.forEach((pill) => pill.addEventListener("click", () => showStep(Number(pill.dataset.step))));
byId("previous-step").addEventListener("click", () => showStep(currentStep - 1));
byId("next-step").addEventListener("click", () => { try { gatherConfig(); showStep(currentStep + 1); setStatus(byId("setup-status"), ""); } catch (error) { setStatus(byId("setup-status"), error.message, true); } });
byId("team-count").addEventListener("input", () => renderTeams());
byId("apply-default-pool").addEventListener("click", () => { const value = byId("default-pool").value; byId("team-rows").querySelectorAll("[data-team-pool]").forEach((field) => { field.value = value; }); });
byId("add-position").addEventListener("click", () => {
  const rules = [...byId("position-rules").querySelectorAll("tr")].map((row) => ({ id: row.querySelector("[data-position-id]").value, label: row.querySelector("[data-position-label]").value, minimum: row.querySelector("[data-position-min]").value, maximum: row.querySelector("[data-position-max]").value }));
  renderPositionRules([...rules, { id: `POS${rules.length + 1}`, label: "Custom position", minimum: 0, maximum: null }]);
});
byId("allow-any-mix").addEventListener("click", () => {
  byId("position-rules").querySelectorAll("[data-position-max]").forEach((field) => { field.value = ""; });
  setStatus(byId("setup-status"), "Position limits removed. The overall roster maximum still applies.");
});
byId("regenerate-codes").addEventListener("click", generateCodes);

byId("manage-form").addEventListener("submit", async (event) => {
  event.preventDefault(); setStatus(byId("manage-status"), "Opening league setup…");
  try {
    const leagueCode = normalizeLeagueCode(byId("manage-league-code").value); byId("manage-league-code").value = leagueCode;
    await api("/api/draft-day/auth", { method: "POST", body: JSON.stringify({ leagueCode, role: "admin", code: byId("manage-admin-code").value }) });
    byId("manage-admin-code").value = "";
    const snapshot = await api(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(leagueCode)}`);
    rememberLeague(localStorage, "organizer", leagueCode);
    loadSnapshot(snapshot); setStatus(byId("manage-status"), "Organizer access confirmed.");
  } catch (error) { setStatus(byId("manage-status"), error.message, true); }
});

byId("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const config = gatherConfig(); setStatus(byId("setup-status"), editingSnapshot ? "Saving setup…" : "Creating league…"); byId("save-league").disabled = true;
    if (editingSnapshot) {
      editingSnapshot = await api("/api/draft-day/commands", { method: "POST", body: JSON.stringify({ type: "replace-setup", leagueCode: editingSnapshot.leagueCode, config, expectedRevision: editingSnapshot.revision, idempotencyKey: crypto.randomUUID() }) });
      setStatus(byId("setup-status"), "League setup saved.");
    } else {
      const access = { adminCode: byId("admin-code").value, auctioneerCode: byId("auctioneer-code").value, boardCode: byId("board-code").value };
      const snapshot = await api("/api/draft-day/leagues", { method: "POST", body: JSON.stringify({ config, access }) });
      rememberLeague(localStorage, "organizer", snapshot.leagueCode);
      showResult(snapshot, access);
    }
  } catch (error) { setStatus(byId("setup-status"), error.message, true); } finally { byId("save-league").disabled = false; }
});

byId("download-access").addEventListener("click", () => {
  if (!resultAccess) return;
  const blob = new Blob([JSON.stringify({ kind: "pips-draft-day-access-sheet", createdAt: new Date().toISOString(), ...resultAccess }, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); const url = URL.createObjectURL(blob);
  link.href = url; link.download = `${resultAccess.leagueCode.toLowerCase()}-draft-day-access.json`; link.hidden = true; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
});

async function logOut() {
  const button = byId("logout"); button.disabled = true; button.textContent = "Logging out…";
  const status = byId("setup-panel").hidden ? byId("manage-status") : byId("setup-status");
  try {
    await api("/api/draft-day/auth", { method: "DELETE" });
    clearRememberedAccess(localStorage, currentOrganizerLeague);
    location.reload();
  } catch (error) {
    button.disabled = false; button.textContent = "Log out";
    setStatus(status, `Could not log out securely: ${error.message}`, true);
  }
}

byId("logout").addEventListener("click", () => void logOut());

async function restoreOrganizerSession(value) {
  if (!value) return false;
  try {
    const leagueCode = normalizeLeagueCode(value); byId("manage-league-code").value = leagueCode; setStatus(byId("manage-status"), "Restoring organizer session…");
    const snapshot = await api(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(leagueCode)}`);
    rememberLeague(localStorage, "organizer", leagueCode);
    loadSnapshot(snapshot); setStatus(byId("manage-status"), "Organizer session restored."); return true;
  } catch (error) {
    setStatus(byId("manage-status"), error.status === 401 ? "Enter the organizer code to manage this league." : error.message, error.status !== 401); return false;
  }
}

byId("season").value = new Date().getFullYear();
renderPositionRules(); renderTeams([]); generateCodes(); showStep(0);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
const initialOrganizerLeague = new URLSearchParams(location.search).get("league") || rememberedLeague(localStorage, "organizer"); byId("manage-league-code").value = initialOrganizerLeague;
void restoreOrganizerSession(initialOrganizerLeague);
