import { requestCbsRosterCapture, validateCbsRosterSnapshot } from "../cbs-roster-snapshot.mjs?v=20260805g";
import { getMeta, hasOfflineVerifier, saveOfflineVerifier, setMeta, verifyOfflineCode } from "../storage.mjs?v=20260823a";

const byId = (id) => document.getElementById(id);
const SNAPSHOT_URL = "/api/thunder-bowl/season/snapshot";
const REFRESH_URL = "/api/thunder-bowl/season/refresh";
const PLAN_CACHE_KEY = "seasonPlanV1";
const evidenceValues = new WeakMap();
let plan = null;
let offlineMode = false;

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function dateTime(value) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "not available";
}

function number(value, digits = 1) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

function signed(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${Number(value).toFixed(1)}` : "—";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function setStatus(message, error = false) {
  const target = byId("action-status");
  target.textContent = message;
  target.classList.toggle("error", error);
}

function empty(message) {
  return element("p", "empty", message);
}

function evidenceButton(title, value, label = "Evidence") {
  const button = element("button", "evidence-button", label);
  button.type = "button";
  evidenceValues.set(button, { title, value });
  button.addEventListener("click", () => openEvidence(title, value));
  return button;
}

function openEvidence(title, value) {
  byId("evidence-title").textContent = title;
  const body = byId("evidence-body");
  body.replaceChildren();
  const section = element("section");
  section.append(element("h3", "", "Registered inputs and reasoning"));
  const pre = element("pre");
  pre.textContent = JSON.stringify(value, null, 2);
  section.append(pre);
  body.append(section);
  byId("evidence-dialog").showModal();
}

function sourceAge(source) {
  if (!source.asOf) return "not synced";
  if (!Number.isFinite(source.ageMinutes)) return dateTime(source.asOf);
  if (source.ageMinutes < 60) return `${source.ageMinutes}m old`;
  if (source.ageMinutes < 1440) return `${Math.floor(source.ageMinutes / 60)}h old`;
  return `${Math.floor(source.ageMinutes / 1440)}d old`;
}

function compactRow(title, detail, evidence = null) {
  const row = element("article", "compact-row");
  const copy = element("div");
  copy.append(element("strong", "", title));
  if (detail) copy.append(element("p", "", detail));
  row.append(copy);
  if (evidence) row.append(evidenceButton(title, evidence));
  return row;
}

function renderHeader(value, offline) {
  byId("week-label").textContent = `Week ${value.week}`;
  const state = offline ? "STALE" : value.state;
  const chip = byId("freshness-state");
  chip.textContent = state;
  chip.className = `state-chip ${state.toLowerCase()}`;
  byId("generated-label").textContent = `${offline ? "Cached" : "Generated"} ${dateTime(value.generatedAt)}`;
  const strip = byId("source-strip");
  strip.replaceChildren(...value.sources.map((source) => {
    const node = element("span", "source-chip");
    node.append(element("strong", "", `${source.label}: `), document.createTextNode(sourceAge(source)));
    return node;
  }));
  byId("offline-banner").hidden = !offline;
  const alerts = byId("alerts");
  const messages = [...value.alerts];
  if (offline) messages.unshift("This is a locally cached recovery view. CBS availability, projections, manager moves, and injuries may have changed.");
  alerts.replaceChildren(...messages.map((message) => {
    const node = element("div", "alert");
    node.append(element("strong", "", "CHECK"), element("span", "", message));
    return node;
  }));
  const isCbs = value.baseline.authority.startsWith("authenticated");
  byId("sync-copy").textContent = isCbs
    ? `CBS all-team authority last captured ${dateTime(value.baseline.asOf)}. Sync again after waivers, trades, or lineup-changing roster moves.`
    : "CBS has not been synced for the season. Waivers are blocked and the final auction ledger is only a Week 1 roster baseline.";
}

function renderLineup(value) {
  byId("lineup-total").textContent = `${number(value.lineup.total)} pts`;
  const tbody = byId("starter-rows");
  const slotCount = {};
  tbody.replaceChildren(...value.lineup.starters.map((row) => {
    slotCount[row.position] = (slotCount[row.position] || 0) + 1;
    const tr = document.createElement("tr");
    const slot = document.createElement("td");
    slot.append(element("span", "position", `${row.position}${slotCount[row.position] > 1 ? slotCount[row.position] : ""}`));
    const playerCell = document.createElement("td");
    playerCell.append(element("span", "player-name", row.name), element("span", "subtext", `${row.nflTeam}${row.injury?.status ? ` · ${row.injury.status}` : ""}`));
    const game = element("td", "", row.opponent || (row.bye === value.week ? "BYE" : "TBD"));
    const range = element("td", "", `${number(row.floor)}–${number(row.ceiling)}`);
    const points = element("td", "player-name", number(row.points));
    const action = document.createElement("td");
    action.append(evidenceButton(`${row.name} Week ${value.week}`, row));
    tr.append(slot, playerCell, game, range, points, action);
    return tr;
  }));
  if (!value.lineup.starters.length) {
    const tr = document.createElement("tr");
    const td = element("td", "empty", "No complete governed lineup is available.");
    td.colSpan = 6;
    tr.append(td);
    tbody.append(tr);
  }
  const swaps = byId("swap-list");
  swaps.replaceChildren(...(value.lineup.swaps.length
    ? value.lineup.swaps.map((row) => compactRow(`Start ${row.start} over ${row.sit}`, `${signed(row.delta)} points · confidence ${number(row.confidence, 2)}`, row))
    : [empty("No close start/sit contingency is registered.")]));
  const bench = byId("bench-list");
  bench.replaceChildren(...value.lineup.bench.map((row) => compactRow(`${row.position} · ${row.name}`, `${number(row.points)} projected · ${row.injury?.status || "no actionable injury tag"}`, row)));
}

function metric(label, value) {
  const node = element("span", "metric");
  node.append(document.createTextNode(`${label} `), element("strong", "", value));
  return node;
}

function renderWaivers(value) {
  const target = byId("waiver-list");
  if (!value.waivers.recommendations.length) {
    target.replaceChildren(empty(value.waivers.blockedReason || "No waiver candidate clears the current legal and projection gates."));
    return;
  }
  target.replaceChildren(...value.waivers.recommendations.map((row) => {
    const card = element("article", "decision-card");
    const header = element("header");
    const title = element("div");
    title.append(element("h3", "", `${row.priority}. Add ${row.add.name}`), element("p", "", `Drop ${row.drop.name} · ${row.add.position} ${row.add.nflTeam}`));
    header.append(title, element("span", "verdict", row.verdict));
    card.append(header, element("p", "", row.reason));
    const metrics = element("div", "metrics");
    metrics.append(metric("Week", signed(row.gains.week)), metric("Next 3", signed(row.gains.nextThree)), metric("ROS", signed(row.gains.restOfSeason)));
    card.append(metrics);
    const actions = element("div", "card-actions");
    actions.append(evidenceButton(`${row.add.name} waiver case`, { availability: row.availability, acquisitionAdvice: row.acquisitionAdvice, dropCost: row.dropCost, confidence: row.confidence, evidence: row.evidence }));
    card.append(actions);
    return card;
  }));
}

function renderTrades(value) {
  const target = byId("trade-list");
  if (!value.trades.recommendations.length) {
    target.replaceChildren(empty(value.trades.blockedReason || "No trade idea clears the two-sided gate."));
    return;
  }
  target.replaceChildren(...value.trades.recommendations.map((row) => {
    const send = row.sends.map((item) => item.name).join(" + ");
    const receive = row.receives.map((item) => item.name).join(" + ");
    const card = element("article", "decision-card");
    const header = element("header");
    const title = element("div");
    title.append(element("h3", "", `${send} → ${receive}`), element("p", "", `With ${row.rival.teamName}`));
    header.append(title, element("span", "verdict", row.verdict));
    card.append(header, element("p", "", row.whyRivalAccepts));
    const metrics = element("div", "metrics");
    metrics.append(metric("Dogs ROS", signed(row.dogsDeltas.restOfSeason)), metric("Rival ROS", signed(row.rivalDeltas.restOfSeason)), metric("Salary", row.salary.dogsDelta === null ? "unknown" : `$${signed(row.salary.dogsDelta)}`));
    card.append(metrics);
    const actions = element("div", "card-actions");
    actions.append(evidenceButton(`${send} for ${receive}`, row));
    const copy = element("button", "evidence-button", "Copy proposal");
    copy.type = "button";
    copy.addEventListener("click", async () => { await navigator.clipboard.writeText(row.proposal); setStatus("Trade proposal copied."); });
    actions.append(copy);
    card.append(actions);
    return card;
  }));
}

function renderWatch(value) {
  const moves = byId("move-list");
  moves.replaceChildren(...(value.watch.leagueMoves.length
    ? value.watch.leagueMoves.map((row) => compactRow(`${row.type}: ${row.playerName}`, `${row.from?.teamName || "Available"} → ${row.to?.teamName || "Available"} · ${dateTime(row.detectedAt)}`, row))
    : [empty("No manager roster change has been detected from consecutive CBS snapshots this week.")]));
  const injuries = byId("injury-list");
  injuries.replaceChildren(...(value.watch.injuries.length
    ? value.watch.injuries.slice(0, 15).map((row) => compactRow(`${row.name} · ${row.status}`, `${row.leagueStatus} · ${row.practice || row.bodyPart || "details pending"} · ${number(row.projection.points)} projected`, row))
    : [empty("No actionable injury row is registered.")]));
  const ir = byId("ir-list");
  ir.replaceChildren(...(value.watch.irTargets.length
    ? value.watch.irTargets.map((row) => compactRow(`${row.action}: ${row.name}`, `${row.leagueStatus} · keeper upside ${row.keeperUpside} · healthy ROS ${number(row.healthyRosAverage)}`, row))
    : [empty("No IR/PUP stash target currently clears the governed watch gate.")]));
}

async function renderPlan(value, { offline = false } = {}) {
  plan = value;
  offlineMode = offline;
  byId("login-view").hidden = true;
  byId("app-view").hidden = false;
  renderHeader(value, offline);
  renderLineup(value);
  renderWaivers(value);
  renderTrades(value);
  renderWatch(value);
  for (const control of [byId("refresh-plan"), byId("sync-cbs"), byId("cbs-file"), byId("fbg-file")]) control.disabled = offline;
  if (!offline) await setMeta(PLAN_CACHE_KEY, value);
}

async function responseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "The server request failed.");
    error.status = response.status;
    throw error;
  }
  return data.plan || data;
}

async function loadSnapshot() {
  return responseJson(await fetch(SNAPSHOT_URL, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20_000) }));
}

async function postAction(payload) {
  return responseJson(await fetch(REFRESH_URL, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(55_000),
  }));
}

async function runAction(button, message, task) {
  button.disabled = true;
  setStatus(message);
  try {
    const value = await task();
    await renderPlan(value);
    setStatus(`Updated ${dateTime(value.generatedAt)}.`);
  } catch (error) {
    setStatus(errorMessage(error), true);
  } finally {
    button.disabled = offlineMode;
  }
}

async function attemptLogin(event) {
  event.preventDefault();
  const code = byId("access-code").value.trim();
  const status = byId("login-status");
  status.textContent = navigator.onLine ? "Checking code…" : "Checking offline verifier…";
  status.classList.remove("error");
  try {
    if (navigator.onLine) {
      const auth = await fetch("/api/thunder-bowl/auth", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(5_000) });
      if (!auth.ok) {
        const authError = new Error(auth.status === 401 ? "That access code is not correct." : "Online access check is unavailable.");
        authError.badCode = auth.status === 401;
        throw authError;
      }
      await saveOfflineVerifier(code);
      byId("access-code").value = "";
      await renderPlan(await loadSnapshot());
      return;
    }
    if (!(await verifyOfflineCode(code))) throw new Error("That code does not match this device's saved offline verifier.");
    const cached = await getMeta(PLAN_CACHE_KEY);
    if (!cached) throw new Error("No private weekly plan has been cached on this device yet.");
    byId("access-code").value = "";
    await renderPlan(cached, { offline: true });
  } catch (error) {
    if (!error.badCode && await hasOfflineVerifier() && await verifyOfflineCode(code)) {
      const cached = await getMeta(PLAN_CACHE_KEY);
      if (cached) {
        byId("access-code").value = "";
        await renderPlan(cached, { offline: true });
        setStatus("The server is unavailable. Showing the stale read-only recovery snapshot.");
        return;
      }
    }
    status.textContent = errorMessage(error);
    status.classList.add("error");
  }
}

function downloadPlan() {
  if (!plan) return;
  const blob = new Blob([`${JSON.stringify(plan, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `thunder-bowl-week-${plan.week}-plan-${plan.generatedAt.slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
}

byId("login-form").addEventListener("submit", attemptLogin);
byId("refresh-plan").addEventListener("click", () => runAction(byId("refresh-plan"), "Refreshing public projections, injuries, depth, and news…", () => postAction({ action: "refresh-public" })));
byId("sync-cbs").addEventListener("click", () => runAction(byId("sync-cbs"), "Asking the local CBS Helper to capture all 12 authenticated rosters…", async () => postAction({ action: "sync-cbs", snapshot: validateCbsRosterSnapshot(await requestCbsRosterCapture()) })));
byId("cbs-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  await runAction(event.target, "Validating and syncing the CBS snapshot…", async () => postAction({ action: "sync-cbs", snapshot: validateCbsRosterSnapshot(JSON.parse(await file.text())) }));
  event.target.value = "";
});
byId("fbg-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  await runAction(event.target, "Validating the current-week Footballguys projection export…", async () => postAction({ action: "sync-fbg", csv: await file.text() }));
  event.target.value = "";
});
byId("export-plan").addEventListener("click", downloadPlan);
byId("close-evidence").addEventListener("click", () => byId("evidence-dialog").close());
byId("evidence-dialog").addEventListener("click", (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && byId("evidence-dialog").open) byId("evidence-dialog").close();
});

window.addEventListener("online", async () => {
  if (!offlineMode) return;
  try { await renderPlan(await loadSnapshot()); setStatus("Reconnected and loaded the current private plan."); } catch { /* Keep explicit stale recovery view. */ }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("../service-worker.js", { scope: "../" }).catch(() => {});

(async () => {
  if (navigator.onLine) {
    try { await renderPlan(await loadSnapshot()); return; }
    catch (error) { if (error.status !== 401) byId("login-status").textContent = "The server is unavailable. Enter the code to try offline recovery."; }
  } else if (await hasOfflineVerifier()) {
    byId("login-status").textContent = "Offline recovery is available on this device. Enter the code to unlock the stale cached plan.";
  }
  byId("access-code").focus();
})();

setInterval(async () => {
  if (document.hidden || offlineMode || !navigator.onLine || !plan) return;
  try {
    const current = await loadSnapshot();
    if (current.sourceFingerprint !== plan.sourceFingerprint || current.generatedAt !== plan.generatedAt) await renderPlan(current);
  } catch { /* Manual controls carry actionable errors. */ }
}, 15 * 60_000);
