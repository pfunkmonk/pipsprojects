import { requestCbsRosterCapture, validateCbsRosterSnapshot } from "../cbs-roster-snapshot.mjs?v=20260831e";
import { requestFbgProjectionCapture } from "../fbg-session-capture.mjs?v=20260831a";
import { requestSupplementalProjectionCapture } from "../supplemental-session-capture.mjs?v=20260831a";
import { getMeta, hasOfflineVerifier, saveOfflineVerifier, setMeta, verifyOfflineCode } from "../storage.mjs?v=20260823a";
import { buildEvidenceExplanation } from "./season-evidence.mjs?v=20260831c";
import { collectLatestPlayerNews, safeNewsUrl } from "./season-news.mjs?v=20260831a";

const byId = (id) => document.getElementById(id);
const SNAPSHOT_URL = "/api/thunder-bowl/season/snapshot";
const REFRESH_URL = "/api/thunder-bowl/season/refresh";
const NEWS_URL = "/api/thunder-bowl/news?force=1";
const RESEARCH_URL = "/api/thunder-bowl/research?force=1";
const PLAN_CACHE_KEY = "seasonPlanV1";
const UPDATE_CONTROL_IDS = Object.freeze(["refresh-plan", "update-cbs-only", "update-fbg-only", "update-fp-only", "update-pff-only", "update-news-only"]);
const FILE_CONTROL_IDS = Object.freeze(["cbs-file", "fbg-file", "export-plan"]);
let plan = null;
let offlineMode = false;
let playerNewsRequestId = 0;

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

function evidenceButton(title, value, kind, label = "Why?") {
  const button = element("button", "evidence-button", label);
  button.type = "button";
  button.addEventListener("click", () => openEvidence(title, value, kind));
  return button;
}

function newsButton(player, label = "Latest news") {
  const button = element("button", "news-button", label);
  button.type = "button";
  button.setAttribute("aria-label", `Latest news for ${player.name}`);
  button.addEventListener("click", () => openPlayerNews(player));
  return button;
}

function recommendationNewsButtons(players) {
  return players.map((player) => newsButton(player, `News: ${player.name}`));
}

function setUpdateControlsDisabled(disabled) {
  for (const id of UPDATE_CONTROL_IDS) byId(id).disabled = disabled;
}

function setActionControlsDisabled(disabled) {
  setUpdateControlsDisabled(disabled);
  for (const id of FILE_CONTROL_IDS) byId(id).disabled = disabled;
}

function restoreActionControls() {
  const setupRequired = plan?.kind === "thunder-bowl-season-setup-required";
  setUpdateControlsDisabled(offlineMode);
  byId("cbs-file").disabled = offlineMode;
  byId("fbg-file").disabled = offlineMode || setupRequired;
  byId("export-plan").disabled = offlineMode || setupRequired;
}

function openEvidence(title, value, kind) {
  playerNewsRequestId += 1;
  byId("evidence-eyebrow").textContent = "Plain-English explanation";
  byId("evidence-title").textContent = title;
  const body = byId("evidence-body");
  body.replaceChildren();
  const explanation = buildEvidenceExplanation(kind, value, { week: plan?.week || null });
  body.append(element("p", "evidence-summary", explanation.summary));
  for (const group of explanation.sections) {
    if (!group.items.length) continue;
    const sectionNode = element("section");
    sectionNode.append(element("h3", "", group.title));
    const list = element("ul", "evidence-list");
    for (const item of group.items) list.append(element("li", "", item));
    sectionNode.append(list);
    body.append(sectionNode);
  }
  if (explanation.note) body.append(element("p", "evidence-note", explanation.note));
  byId("evidence-dialog").showModal();
}

async function privateJson(url) {
  const response = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || `News request failed (${response.status}).`);
  return value;
}

function newsStory(item) {
  const story = element("section", "news-story");
  const meta = element("p", "news-meta", `${item.source}${item.asOf ? ` · ${dateTime(item.asOf)}` : ""}`);
  story.append(meta, element("h3", "", item.title), element("p", "", item.summary));
  const href = safeNewsUrl(item.url);
  if (href) {
    const link = element("a", "news-link", `Open ${item.source} story`);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    story.append(link);
  }
  return story;
}

async function openPlayerNews(player) {
  const requestId = ++playerNewsRequestId;
  byId("evidence-eyebrow").textContent = "Latest player news";
  byId("evidence-title").textContent = player.name;
  const body = byId("evidence-body");
  body.replaceChildren(element("p", "evidence-summary", `Checking RotoWire, CBS, and Footballguys for the latest ${player.name} news…`));
  body.setAttribute("aria-busy", "true");
  const dialog = byId("evidence-dialog");
  if (!dialog.open) dialog.showModal();
  if (offlineMode) {
    body.replaceChildren(element("p", "evidence-note", "Latest player news is unavailable in the offline recovery view. Reconnect, then choose News again."));
    body.removeAttribute("aria-busy");
    return;
  }
  const [newsResult, researchResult] = await Promise.allSettled([privateJson(NEWS_URL), privateJson(RESEARCH_URL)]);
  if (requestId !== playerNewsRequestId) return;
  const newsSnapshot = newsResult.status === "fulfilled" ? newsResult.value : null;
  const researchSnapshot = researchResult.status === "fulfilled" ? researchResult.value : null;
  const items = collectLatestPlayerNews(player.name, newsSnapshot, researchSnapshot);
  const failures = [newsResult, researchResult].filter((result) => result.status === "rejected");
  body.replaceChildren();
  body.append(element("p", "evidence-summary", failures.length === 2
    ? `Latest news could not be loaded for ${player.name}. The projection and injury designation shown in the row remain unchanged.`
    : items.length
    ? `${items.length} current ${items.length === 1 ? "update" : "updates"} matched ${player.name}. News is evidence only and does not change the projection.`
    : `No current RotoWire, CBS, or Footballguys story matched ${player.name}. That does not override the injury designation or projection shown in the row.`));
  if (items.length) body.append(...items.map(newsStory));
  if (failures.length) body.append(element("p", "evidence-note", failures.length === 2
    ? "The current news feeds did not answer. Close this window and choose Latest news again in a moment."
    : "One news feed could not refresh, so the available verified sources are shown."));
  body.removeAttribute("aria-busy");
}

function sourceAge(source) {
  if (!source.asOf) return "not synced";
  if (!Number.isFinite(source.ageMinutes)) return dateTime(source.asOf);
  if (source.ageMinutes < 60) return `${source.ageMinutes}m old`;
  if (source.ageMinutes < 1440) return `${Math.floor(source.ageMinutes / 60)}h old`;
  return `${Math.floor(source.ageMinutes / 1440)}d old`;
}

function compactRow(title, detail, evidence = null, evidenceKind = "generic") {
  const row = element("article", "compact-row");
  const copy = element("div");
  copy.append(element("strong", "", title));
  if (detail) copy.append(element("p", "", detail));
  row.append(copy);
  if (evidence) row.append(evidenceButton(title, evidence, evidenceKind));
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
  const setupRequired = value.kind === "thunder-bowl-season-setup-required";
  const isCbs = value.baseline.authority.startsWith("authenticated");
  const partialCbs = isCbs && (value.baseline.rostersReady ?? value.baseline.rostersComplete) === false;
  byId("sync-copy").textContent = setupRequired
    ? "Your access code worked. Choose Update CBS to establish the roster baseline, then update the projection sources you want—or use Update everything for all five stages."
    : partialCbs
    ? `CBS is current, but ${value.baseline.legalTeamCount ?? value.baseline.completeTeamCount} of ${value.baseline.teamCount} teams currently satisfy the legal roster rule: eight required starters and no more than six backups.`
    : isCbs
    ? `Last CBS capture: ${dateTime(value.baseline.asOf)}. All teams satisfy the 8–14 player rule. Refresh only the source that changed, or use Update everything for a complete pass.`
    : "CBS has not been captured for the season. Choose Update CBS or Update everything before trusting availability, manager moves, or weekly lineup advice.";
}

function renderUpdateSource(rowId, stateId, source, summary, emptyText) {
  const row = byId(rowId);
  const state = byId(stateId);
  row.classList.remove("updated", "failed");
  if (summary) {
    row.classList.add(summary.ok ? "updated" : "failed");
    if (!summary.ok) state.textContent = `Needs attention: ${summary.error || "update failed"}`;
    else if (source?.label === "CBS league") {
      const legalTeams = summary.legalTeams ?? summary.completeTeams;
      const projections = summary.projectionRows ? ` · ${summary.projectionRows} raw-stat projections for Week ${summary.projectionWeek}` : "";
      const fab = summary.fabStatus === "COMPLETE" ? " · FAB balances/order/records captured" : " · FAB pricing incomplete";
      state.textContent = `Updated ${dateTime(summary.asOf || summary.capturedAt)} · ${legalTeams}/${summary.teamCount} legal rosters · ${summary.rosteredPlayers} players${projections}${fab}`;
    } else if (source?.label === "FBG projections") {
      state.textContent = `Updated ${dateTime(summary.asOf || summary.capturedAt)} · ${summary.rows || 0} raw-stat rows · Thunder Bowl scoring`;
    } else state.textContent = `Updated ${dateTime(summary.asOf || summary.capturedAt)}`;
    return;
  }
  state.textContent = source?.asOf ? `Last updated ${dateTime(source.asOf)}` : emptyText;
}

function renderUpdateSources(value) {
  const sources = new Map(value.sources.map((source) => [source.label, source]));
  const summary = value.updateSummary || null;
  renderUpdateSource("update-cbs-source", "update-cbs-state", sources.get("CBS league"), summary?.cbs, "Needs the one-time CBS helper");
  renderUpdateSource("update-fbg-source", "update-fbg-state", sources.get("FBG projections"), summary?.footballguys, "Ready to capture from your signed-in account");
  renderUpdateSource("update-fp-source", "update-fp-state", sources.get("FantasyPros"), summary?.fantasyPros, "Ready to capture from your signed-in account");
  renderUpdateSource("update-pff-source", "update-pff-state", sources.get("PFF"), summary?.pff, "Ready to capture from your signed-in account");
  renderUpdateSource("update-news-source", "update-news-state", sources.get("injury / news"), summary?.injuryNews, "Ready to refresh automatically");
}

function lineupRow(row, slotLabel, kind, value) {
    const tr = document.createElement("tr");
    const slot = document.createElement("td");
    slot.append(element("span", "position", slotLabel));
    const playerCell = document.createElement("td");
    playerCell.append(element("span", "player-name", row.name), element("span", "subtext", `${row.nflTeam}${row.injury?.status ? ` · ${row.injury.status}` : ""}`));
    const game = element("td", "", row.opponent || (row.bye === value.week ? "BYE" : "TBD"));
    const range = element("td", "", `${number(row.floor)}–${number(row.ceiling)}`);
    const points = element("td", "player-name", number(row.points));
    const action = document.createElement("td");
    const actions = element("div", "row-actions");
    actions.append(newsButton(row), evidenceButton(`${row.name} Week ${value.week}`, row, kind));
    action.append(actions);
    tr.append(slot, playerCell, game, range, points, action);
    return tr;
}

function renderLineup(value) {
  byId("lineup-total").textContent = `${number(value.lineup.total)} pts`;
  const tbody = byId("starter-rows");
  const slotCount = {};
  tbody.replaceChildren(...value.lineup.starters.map((row) => {
    slotCount[row.position] = (slotCount[row.position] || 0) + 1;
    return lineupRow(row, `${row.position}${slotCount[row.position] > 1 ? slotCount[row.position] : ""}`, "starter", value);
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
    ? value.lineup.swaps.map((row) => compactRow(`Start ${row.start} over ${row.sit}`, `${signed(row.delta)} points · confidence ${number(row.confidence, 2)}`, row, "swap"))
    : [empty("No close start/sit contingency is registered.")]));
  const bench = byId("bench-rows");
  bench.replaceChildren(...value.lineup.bench.map((row) => lineupRow(row, row.position, "bench", value)));
  if (!value.lineup.bench.length) {
    const tr = document.createElement("tr");
    const td = element("td", "empty", "No bench players are currently rostered.");
    td.colSpan = 6;
    tr.append(td);
    bench.append(tr);
  }
}

function metric(label, value) {
  const node = element("span", "metric");
  node.append(document.createTextNode(`${label} `), element("strong", "", value));
  return node;
}

function waiverBidAdvice(fab) {
  const advice = element("section", "fab-advice");
  advice.setAttribute("aria-label", "Waiver bid recommendation");
  const recommendation = element("div", "fab-advice-primary");
  recommendation.append(
    element("span", "", "Recommended blind bid"),
    element("strong", "", `$${number(fab.recommended, 0)}`),
  );
  const details = element("div", "fab-advice-details");
  details.append(
    metric("Do not exceed", `$${number(fab.maximum, 0)}`),
    metric("Remaining after a win", `$${number(fab.budgetAfter, 0)}`),
  );
  advice.append(recommendation, details);
  return advice;
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
    if (Number.isFinite(row.fab?.recommended)) {
      card.append(waiverBidAdvice(row.fab));
    } else if (row.fab?.unavailableReason) {
      card.append(element("p", "fab-unavailable", row.fab.unavailableReason));
    }
    card.append(metrics);
    const actions = element("div", "card-actions");
    actions.append(...recommendationNewsButtons([row.add, row.drop]));
    actions.append(evidenceButton(`${row.add.name} waiver case`, row, "waiver"));
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
    metrics.append(metric("Dogs ROS", signed(row.dogsDeltas.restOfSeason)), metric("Rival ROS", signed(row.rivalDeltas.restOfSeason)), metric("Dogs next 3", signed(row.dogsDeltas.nextThree)));
    card.append(metrics);
    const actions = element("div", "card-actions");
    actions.append(...recommendationNewsButtons([...row.sends, ...row.receives]));
    actions.append(evidenceButton(`${send} for ${receive}`, row, "trade"));
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
    ? value.watch.leagueMoves.map((row) => compactRow(`${row.type}: ${row.playerName}`, `${row.from?.teamName || "Available"} → ${row.to?.teamName || "Available"} · ${dateTime(row.detectedAt)}`, row, "move"))
    : [empty("No manager roster change has been detected from consecutive CBS snapshots this week.")]));
  const injuries = byId("injury-list");
  injuries.replaceChildren(...(value.watch.injuries.length
    ? value.watch.injuries.slice(0, 15).map((row) => compactRow(`${row.name} · ${row.status}`, `${row.leagueStatus} · ${row.practice || row.bodyPart || "details pending"} · ${number(row.projection.points)} projected`, row, "injury"))
    : [empty("No actionable injury row is registered.")]));
  const ir = byId("ir-list");
  ir.replaceChildren(...(value.watch.irTargets.length
    ? value.watch.irTargets.map((row) => compactRow(`${row.action}: ${row.name}`, `${row.leagueStatus} · keeper upside ${row.keeperUpside} · healthy ROS ${number(row.healthyRosAverage)}`, row, "ir"))
    : [empty("No IR/PUP stash target currently clears the governed watch gate.")]));
}

async function renderPlan(value, { offline = false } = {}) {
  plan = value;
  offlineMode = offline;
  const setupRequired = value.kind === "thunder-bowl-season-setup-required";
  byId("login-view").hidden = true;
  byId("app-view").hidden = false;
  renderHeader(value, offline);
  renderLineup(value);
  renderWaivers(value);
  renderTrades(value);
  renderWatch(value);
  renderUpdateSources(value);
  restoreActionControls();
  if (setupRequired && !offline) {
    byId("helper-setup").open = true;
    setStatus("Access accepted. Complete the one-time helper setup, then choose Update CBS or Update everything.");
  }
  if (value.updateSummary?.cbs?.ok) byId("helper-setup").open = false;
  if (!offline && !setupRequired) await setMeta(PLAN_CACHE_KEY, value);
}

async function responseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `The server stopped before this update stage finished (HTTP ${response.status}). Earlier completed stages remain saved.`);
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
    signal: AbortSignal.timeout(90_000),
  }));
}

async function runAction(button, message, task, successMessage = null) {
  setActionControlsDisabled(true);
  button.closest?.(".update-source")?.classList.add("updating");
  setStatus(message);
  try {
    const value = await task();
    await renderPlan(value);
    const failed = value.updateSummary
      ? Object.entries(value.updateSummary).filter(([key, result]) => key !== "capturedAt" && result?.ok === false).map(([key]) => key)
      : [];
    const partialRosters = (value.updateSummary?.cbs?.rostersReady ?? value.updateSummary?.cbs?.rostersComplete) === false;
    const defaultMessage = failed.length
      ? `The weekly plan updated, but ${failed.join(" and ")} need attention. The last-known safe data remains visible.`
      : partialRosters
      ? `Update finished, but only ${value.updateSummary.cbs.legalTeams ?? value.updateSummary.cbs.completeTeams}/${value.updateSummary.cbs.teamCount} CBS teams satisfy the required eight starters and 14-player maximum. Waiver and trade advice remains blocked.`
      : `Everything updated ${dateTime(value.generatedAt)}. CBS, Footballguys PRO, FantasyPros, and PFF raw component projections were scored with Thunder Bowl rules; moves, injuries, news, and IR targets are current.`;
    setStatus(successMessage && !failed.length && !partialRosters
      ? typeof successMessage === "function" ? successMessage(value) : successMessage
      : defaultMessage, failed.length > 0);
  } catch (error) {
    setStatus(errorMessage(error), true);
  } finally {
    button.closest?.(".update-source")?.classList.remove("updating");
    restoreActionControls();
  }
}

async function rebuildAfterSourceSave(source) {
  try {
    return await postAction({ action: "rebuild-plan" });
  } catch (error) {
    throw new Error(`${source} was saved, but the recommendations could not be rebuilt: ${errorMessage(error)}`);
  }
}

async function updateCbsOnly() {
  let snapshot;
  try {
    snapshot = validateCbsRosterSnapshot(await requestCbsRosterCapture({ timeoutMs: 90_000, week: plan?.week || 1 }));
    await postAction({ action: "capture-cbs", snapshot });
  } catch (error) {
    byId("helper-setup").open = true;
    throw error;
  }
  byId("helper-setup").open = false;
  return rebuildAfterSourceSave("CBS");
}

async function updateFbgOnly() {
  try {
    const capture = await requestFbgProjectionCapture({ timeoutMs: 90_000, week: plan?.week || 1 });
    await postAction({ action: "capture-fbg", capture });
  } catch (error) {
    byId("helper-setup").open = true;
    throw error;
  }
  return rebuildAfterSourceSave("Footballguys");
}

async function updateSupplementalOnly(provider, label) {
  try {
    const capture = await requestSupplementalProjectionCapture({ provider, timeoutMs: 180_000, week: plan?.week || 1 });
    await postAction({ action: provider === "fantasyPros" ? "capture-fantasypros" : "capture-pff", capture });
  } catch (error) {
    byId("helper-setup").open = true;
    throw error;
  }
  return rebuildAfterSourceSave(label);
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
        const retrySeconds = Number(auth.headers.get("Retry-After"));
        const retryMinutes = Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.max(1, Math.ceil(retrySeconds / 60)) : 3;
        const message = auth.status === 401
          ? "That access code is not correct."
          : auth.status === 429
            ? `Too many recent access checks. Wait ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}, then try again.`
            : "The online access service had a temporary problem. Wait a moment, then try again.";
        const authError = new Error(message);
        authError.badCode = auth.status === 401;
        authError.status = auth.status;
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
byId("update-cbs-only").addEventListener("click", () => runAction(
  byId("update-cbs-only"),
  "Updating CBS rosters, moves, availability, and weekly component stats…",
  updateCbsOnly,
  (value) => `CBS updated ${dateTime(value.generatedAt)}. Recommendations now use the latest saved CBS data; the other sources were left unchanged.`,
));
byId("update-fbg-only").addEventListener("click", () => runAction(
  byId("update-fbg-only"),
  "Updating Footballguys PRO weekly component projections…",
  updateFbgOnly,
  (value) => `Footballguys updated ${dateTime(value.generatedAt)}. Recommendations were rebuilt without recapturing the other sources.`,
));
byId("update-fp-only").addEventListener("click", () => runAction(
  byId("update-fp-only"),
  "Updating FantasyPros weekly component projections…",
  () => updateSupplementalOnly("fantasyPros", "FantasyPros"),
  (value) => `FantasyPros updated ${dateTime(value.generatedAt)}. Recommendations were rebuilt without recapturing the other sources.`,
));
byId("update-pff-only").addEventListener("click", () => runAction(
  byId("update-pff-only"),
  "Updating PFF weekly component projections…",
  () => updateSupplementalOnly("pff", "PFF"),
  (value) => `PFF updated ${dateTime(value.generatedAt)}. Recommendations were rebuilt without recapturing the other sources.`,
));
byId("update-news-only").addEventListener("click", () => runAction(
  byId("update-news-only"),
  "Refreshing injuries, news, practice status, and IR evidence…",
  () => postAction({ action: "refresh-news" }),
  (value) => `Injuries, news, and IR evidence updated ${dateTime(value.generatedAt)}. Projection sources were left unchanged.`,
));
byId("refresh-plan").addEventListener("click", () => runAction(byId("refresh-plan"), "Step 1 of 5: capturing all 12 CBS rosters from your signed-in browser session…", async () => {
  let snapshot;
  try {
    snapshot = validateCbsRosterSnapshot(await requestCbsRosterCapture({ timeoutMs: 90_000, week: plan?.week || 1 }));
  } catch (error) {
    byId("helper-setup").open = true;
    throw new Error(`${errorMessage(error)} Open “First-time setup” below; after that, this same button updates everything.`);
  }
  setStatus("CBS captured. Saving rosters, moves, and CBS component-stat projections before continuing…");
  let current;
  try {
    await postAction({ action: "capture-cbs", snapshot });
  } catch (error) {
    throw new Error(`CBS was captured but could not be saved: ${errorMessage(error)}`);
  }
  byId("helper-setup").open = false;

  setStatus("CBS saved. Step 2 of 5: reading Footballguys PRO component-stat projections from your signed-in browser session…");
  try {
    const capture = await requestFbgProjectionCapture({ timeoutMs: 90_000, week: plan?.week || 1 });
    await postAction({ action: "capture-fbg", capture });
  } catch (error) {
    byId("helper-setup").open = true;
    throw new Error(`CBS was saved successfully, but Footballguys PRO could not be captured: ${errorMessage(error)} CBS will not need to be recaptured.`);
  }

  setStatus("CBS and Footballguys saved. Step 3 of 5: reading FantasyPros component-stat projections from your signed-in Thunder Bowl account…");
  try {
    const capture = await requestSupplementalProjectionCapture({ provider: "fantasyPros", timeoutMs: 180_000, week: plan?.week || 1 });
    await postAction({ action: "capture-fantasypros", capture });
  } catch (error) {
    byId("helper-setup").open = true;
    throw new Error(`CBS and Footballguys were saved successfully, but FantasyPros could not be captured: ${errorMessage(error)} The completed sources remain saved.`);
  }

  setStatus("CBS, Footballguys, and FantasyPros saved. Step 4 of 5: reading PFF component-stat projections from your signed-in account…");
  try {
    const capture = await requestSupplementalProjectionCapture({ provider: "pff", timeoutMs: 180_000, week: plan?.week || 1 });
    await postAction({ action: "capture-pff", capture });
  } catch (error) {
    byId("helper-setup").open = true;
    throw new Error(`CBS, Footballguys, and FantasyPros were saved successfully, but PFF could not be captured: ${errorMessage(error)} The completed sources remain saved.`);
  }

  setStatus("All four projection sources saved. Step 5 of 5: refreshing injuries, news, and IR evidence…");
  try {
    current = await postAction({ action: "refresh-news" });
  } catch (error) {
    throw new Error(`CBS, Footballguys, FantasyPros, and PFF were saved successfully, but injuries/news could not refresh: ${errorMessage(error)} The saved weekly sources remain usable.`);
  }
  return current;
}));
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch(() => {});

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
