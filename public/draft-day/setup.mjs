import { DEFAULT_POSITION_RULES, normalizeLeagueConfig } from "./core.mjs";

const byId = (id) => document.getElementById(id);
const steps = [...document.querySelectorAll("[data-wizard-step]")];
const pills = [...document.querySelectorAll("[data-step]")];
let currentStep = 0;
let editingSnapshot = null;
let resultAccess = null;

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
  renderKeeperTeamOptions();
}

function positionOptions(selected = "") {
  const fragment = document.createDocumentFragment();
  for (const row of byId("position-rules").querySelectorAll("tr")) {
    const value = row.querySelector("[data-position-id]").value.trim().toUpperCase();
    if (!value) continue;
    const option = document.createElement("option"); option.value = value; option.textContent = value; option.selected = value === selected;
    fragment.append(option);
  }
  return fragment;
}

function teamOptions(selected = "") {
  const fragment = document.createDocumentFragment();
  for (const team of currentTeams()) {
    const option = document.createElement("option"); option.value = team.id; option.textContent = team.name; option.selected = team.id === selected;
    fragment.append(option);
  }
  return fragment;
}

function addKeeperRow(keeper = null) {
  const row = document.createElement("div"); row.className = "keeper-row"; row.dataset.keeperId = keeper?.id || `keeper-${crypto.randomUUID()}`;
  const player = document.createElement("label"); player.textContent = "Player"; player.append(input("text", keeper?.player?.name || "", { maxlength: "100", "data-keeper-name": "true", required: "" }));
  const position = document.createElement("label"); position.textContent = "Position"; const positionSelect = document.createElement("select"); positionSelect.dataset.keeperPosition = "true"; positionSelect.append(positionOptions(keeper?.player?.position)); position.append(positionSelect);
  const nfl = document.createElement("label"); nfl.textContent = "NFL team"; nfl.append(input("text", keeper?.player?.nflTeam || "FA", { maxlength: "20", "data-keeper-nfl": "true" }));
  const fantasy = document.createElement("label"); fantasy.textContent = "Fantasy team"; const teamSelect = document.createElement("select"); teamSelect.dataset.keeperTeam = "true"; teamSelect.append(teamOptions(keeper?.teamId)); fantasy.append(teamSelect);
  const salary = document.createElement("label"); salary.textContent = "Salary"; salary.append(input("number", keeper?.salary ?? 1, { min: "0", "data-keeper-salary": "true", required: "" }));
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary"; remove.textContent = "Remove"; remove.addEventListener("click", () => row.remove());
  row.append(player, position, nfl, fantasy, salary, remove); byId("keeper-rows").append(row);
}

function renderKeeperTeamOptions() {
  for (const select of byId("keeper-rows").querySelectorAll("[data-keeper-team]")) {
    const selected = select.value; select.replaceChildren(teamOptions(selected));
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
  const keepers = byId("keepers-enabled").checked ? [...byId("keeper-rows").querySelectorAll(".keeper-row")].map((row) => {
    const name = row.querySelector("[data-keeper-name]").value.trim();
    const position = row.querySelector("[data-keeper-position]").value;
    return {
      id: row.dataset.keeperId,
      player: { id: `custom-${name}-${position}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name, position, nflTeam: row.querySelector("[data-keeper-nfl]").value },
      teamId: row.querySelector("[data-keeper-team]").value,
      salary: row.querySelector("[data-keeper-salary]").value,
    };
  }) : [];
  return normalizeLeagueConfig({
    leagueName: byId("league-name").value,
    season: byId("season").value,
    minimumBid: byId("minimum-bid").value,
    bidIncrement: byId("bid-increment").value,
    rosterMinimum: byId("roster-minimum").value,
    rosterMaximum: byId("roster-maximum").value,
    budgetMode: byId("budget-mode").value,
    nominationMode: byId("nomination-mode").value,
    positionRules, teams, keepers, keepersEnabled: byId("keepers-enabled").checked,
    nominationOrder: teams.map((team) => team.id),
  });
}

function openSetup() {
  byId("setup-panel").hidden = false; byId("result-panel").hidden = true; showStep(0);
  byId("setup-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function loadSnapshot(snapshot) {
  editingSnapshot = snapshot;
  const config = snapshot.config;
  byId("setup-title").textContent = `Manage ${config.leagueName}`;
  byId("setup-subtitle").textContent = `League ${snapshot.leagueCode} · Setup locks after the first auction sale.`;
  byId("league-name").value = config.leagueName; byId("season").value = config.season; byId("team-count").value = config.teams.length;
  byId("minimum-bid").value = config.minimumBid; byId("bid-increment").value = config.bidIncrement; byId("nomination-mode").value = config.nominationMode;
  byId("roster-minimum").value = config.rosterMinimum; byId("roster-maximum").value = config.rosterMaximum; byId("budget-mode").value = config.budgetMode;
  renderPositionRules(config.positionRules); renderTeams(config.teams);
  byId("keepers-enabled").checked = config.keepers.length > 0; byId("keeper-editor").hidden = !config.keepers.length; byId("keeper-rows").replaceChildren(); config.keepers.forEach(addKeeperRow);
  byId("new-access-fields").hidden = true; byId("existing-access-note").hidden = false;
  openSetup();
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The Draft Day service is unavailable.");
  return body;
}

function showResult(snapshot, access) {
  resultAccess = { leagueCode: snapshot.leagueCode, leagueName: snapshot.config.leagueName, ...access };
  byId("setup-panel").hidden = true; byId("manage-panel").hidden = true; byId("result-panel").hidden = false;
  byId("result-league-name").textContent = `${snapshot.config.leagueName} is ready`;
  byId("result-league-code").textContent = snapshot.leagueCode;
  const container = byId("result-access"); container.replaceChildren();
  for (const [label, key] of [["Organizer", "adminCode"], ["Auctioneer", "auctioneerCode"], ["Draft Board", "boardCode"]]) {
    const card = document.createElement("div"); card.className = "access-card"; const strong = document.createElement("strong"); strong.textContent = `${label} code`; const code = document.createElement("code"); code.textContent = access[key]; card.append(strong, code); container.append(card);
  }
  const encoded = encodeURIComponent(snapshot.leagueCode);
  byId("result-auctioneer-link").href = `./auctioneer/?league=${encoded}`; byId("result-board-link").href = `./board/?league=${encoded}`;
  byId("result-panel").scrollIntoView({ behavior: "smooth" });
}

byId("start-create").addEventListener("click", () => { editingSnapshot = null; byId("setup-title").textContent = "Create the auction room"; byId("setup-subtitle").textContent = "Nothing here affects projections or player advice."; byId("new-access-fields").hidden = false; byId("existing-access-note").hidden = true; openSetup(); });
byId("close-setup").addEventListener("click", () => { byId("setup-panel").hidden = true; });
pills.forEach((pill) => pill.addEventListener("click", () => showStep(Number(pill.dataset.step))));
byId("previous-step").addEventListener("click", () => showStep(currentStep - 1));
byId("next-step").addEventListener("click", () => { try { gatherConfig(); showStep(currentStep + 1); setStatus(byId("setup-status"), ""); } catch (error) { setStatus(byId("setup-status"), error.message, true); } });
byId("team-count").addEventListener("input", () => renderTeams());
byId("default-pool").addEventListener("change", () => {});
byId("apply-default-pool").addEventListener("click", () => { const value = byId("default-pool").value; byId("team-rows").querySelectorAll("[data-team-pool]").forEach((field) => { field.value = value; }); });
byId("budget-mode").addEventListener("change", () => { const current = byId("budget-mode").value === "current-cash"; byId("pool-heading").textContent = current ? "Current auction cash" : "Starting pool"; byId("budget-help").textContent = current ? "Enter the cash each team actually has available when bidding begins. Keeper prices will still appear on the board, but will not be deducted twice." : "Enter each team's pool before keepers. Keeper salaries will be deducted automatically to calculate auction-day cash."; });
byId("add-position").addEventListener("click", () => {
  const rules = [...byId("position-rules").querySelectorAll("tr")].map((row) => ({ id: row.querySelector("[data-position-id]").value, label: row.querySelector("[data-position-label]").value, minimum: row.querySelector("[data-position-min]").value, maximum: row.querySelector("[data-position-max]").value }));
  renderPositionRules([...rules, { id: `POS${rules.length + 1}`, label: "Custom position", minimum: 0, maximum: null }]);
});
byId("allow-any-mix").addEventListener("click", () => {
  byId("position-rules").querySelectorAll("[data-position-max]").forEach((field) => { field.value = ""; });
  setStatus(byId("setup-status"), "Position limits removed. The overall roster maximum still applies.");
});
byId("keepers-enabled").addEventListener("change", () => { byId("keeper-editor").hidden = !byId("keepers-enabled").checked; if (byId("keepers-enabled").checked && !byId("keeper-rows").children.length) addKeeperRow(); });
byId("add-keeper").addEventListener("click", () => addKeeperRow());
byId("regenerate-codes").addEventListener("click", generateCodes);

byId("manage-form").addEventListener("submit", async (event) => {
  event.preventDefault(); setStatus(byId("manage-status"), "Opening league setup…");
  try {
    const leagueCode = byId("manage-league-code").value;
    await api("/api/draft-day/auth", { method: "POST", body: JSON.stringify({ leagueCode, role: "admin", code: byId("manage-admin-code").value }) });
    const snapshot = await api(`/api/draft-day/snapshot?role=auctioneer&league=${encodeURIComponent(leagueCode)}`);
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
      showResult(snapshot, access);
    }
  } catch (error) { setStatus(byId("setup-status"), error.message, true); } finally { byId("save-league").disabled = false; }
});

byId("download-access").addEventListener("click", () => {
  if (!resultAccess) return;
  const blob = new Blob([JSON.stringify({ kind: "pips-draft-day-access-sheet", createdAt: new Date().toISOString(), ...resultAccess }, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${resultAccess.leagueCode.toLowerCase()}-draft-day-access.json`; link.click(); URL.revokeObjectURL(link.href);
});

byId("season").value = new Date().getFullYear();
renderPositionRules(); renderTeams([]); generateCodes(); showStep(0);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
