import { requestCbsRosterCapture, validateCbsRosterSnapshot } from "../cbs-roster-snapshot.mjs?v=20260915a";
import { requestFbgProjectionCapture } from "../fbg-session-capture.mjs?v=20260912c";
import { requestSupplementalProjectionCapture } from "../supplemental-session-capture.mjs?v=20260912c";
import { getMeta, hasOfflineVerifier, saveOfflineVerifier, setMeta, verifyOfflineCode } from "../storage.mjs?v=20260823a";
import { buildEvidenceExplanation } from "./season-evidence.mjs?v=20260914a";
import { buildTeamNewsFeed, collectLatestPlayerNews, safeNewsUrl } from "./season-news.mjs?v=20260901b";
import { sortTradeProposals } from "./season-trade-ranking.mjs?v=20260901a";
import { renderManagement } from "./season-management-ui.mjs?v=20260915a";
import { formatDenverKickoff } from "./season-kickoff.mjs?v=20260910a";

const byId = (id) => document.getElementById(id);
const SNAPSHOT_URL = "/api/thunder-bowl/season/snapshot";
const REFRESH_URL = "/api/thunder-bowl/season/refresh";
const AI_ADVICE_URL = "/api/thunder-bowl/season/ai-advice";
const AI_ADVICE_BACKGROUND_URL = "/api/thunder-bowl/season/ai-advice-background";
const TRADE_ANALYSIS_URL = "/api/thunder-bowl/season/trade-analysis";
const STATUS_REFRESH_URL = "/api/thunder-bowl/status?force=1";
const NEWS_REFRESH_URL = "/api/thunder-bowl/news?force=1";
const RESEARCH_REFRESH_URL = "/api/thunder-bowl/research?force=1";
const NEWS_STORED_URL = "/api/thunder-bowl/news?stored=1";
const RESEARCH_STORED_URL = "/api/thunder-bowl/research?stored=1";
const PLAN_CACHE_KEY = "seasonPlanV1";
const PLAYER_NEWS_CACHE_KEY = "seasonAllPlayerNewsV1";
const AI_SECTIONS = Object.freeze(["lineup", "waivers", "trades", "trade-finder", "stash-watch"]);
const AI_SECTION_LABELS = Object.freeze({ lineup: "Start / sit", waivers: "Waiver wire", trades: "Trade", "trade-finder": "League-wide trade finder", "stash-watch": "Stash Watch" });
const DEEP_AI_SECTIONS = new Set(["trade-finder", "stash-watch"]);
const UPDATE_CONTROL_IDS = Object.freeze(["refresh-plan", "update-cbs-only", "update-fbg-only", "update-fp-only", "update-pff-only", "update-news-only", "refresh-team-news"]);
const FILE_CONTROL_IDS = Object.freeze(["cbs-file", "fbg-file", "export-plan"]);
const TAB_IDS = Object.freeze(["start-sit", "scoring-preview", "waivers", "trades", "player-stats", "news", "admin"]);
let plan = null;
let lineupPlan = null;
let offlineMode = false;
let playerNewsRequestId = 0;
let aiAdviceRequestId = 0;
let playerNewsCacheLoaded = false;
let playerNewsCache = null;
let playerNewsServerLoaded = false;
const savedAiAdvice = new Map();
const savedAiJobs = new Map();
const waiverView = { position: "ALL", sort: "priority" };
const playerStatsView = { position: "ALL", availability: "FREE_AGENT", sort: "points", direction: "desc", search: "", page: 0, pageSize: 50 };
let tradeBuilderFingerprint = null;
let tradeBuilderState = { teamIds: [], playerIdsByTeam: new Map(), recipientsByTeam: new Map() };

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

function activateTab(tabId, { focus = false, updateHash = true } = {}) {
  const safeId = TAB_IDS.includes(tabId) ? tabId : "start-sit";
  for (const candidate of TAB_IDS) {
    const selected = candidate === safeId;
    const button = byId(`tab-button-${candidate}`);
    const panel = byId(`tab-${candidate}`);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
  }
  if (updateHash) {
    const url = new URL(window.location.href);
    url.hash = safeId;
    history.replaceState(null, "", url);
  }
  if (focus) byId(`tab-button-${safeId}`).focus();
}

function activeTabId() {
  return TAB_IDS.find((candidate) => byId(`tab-button-${candidate}`).getAttribute("aria-selected") === "true") || "start-sit";
}

function empty(message) {
  return element("p", "empty", message);
}

function evidenceButton(title, value, kind, label = "Why?", week = null) {
  const button = element("button", "evidence-button", label);
  button.type = "button";
  button.addEventListener("click", () => openEvidence(title, value, kind, week));
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
  return players.filter(Boolean).map((player) => newsButton(player, `News: ${player.name}`));
}

function setUpdateControlsDisabled(disabled) {
  for (const id of UPDATE_CONTROL_IDS) byId(id).disabled = disabled;
}

function setActionControlsDisabled(disabled) {
  setUpdateControlsDisabled(disabled);
  for (const id of FILE_CONTROL_IDS) byId(id).disabled = disabled;
  for (const section of AI_SECTIONS) byId(`ai-run-${section}`).disabled = disabled;
}

function restoreActionControls() {
  const setupRequired = plan?.kind === "thunder-bowl-season-setup-required";
  setUpdateControlsDisabled(offlineMode);
  byId("cbs-file").disabled = offlineMode;
  byId("fbg-file").disabled = offlineMode || setupRequired;
  byId("export-plan").disabled = offlineMode || setupRequired;
  updateAiControls();
}

function updateAiControls() {
  const unavailable = offlineMode || plan?.kind === "thunder-bowl-season-setup-required";
  const lineupForecast = Boolean(plan && lineupPlan && lineupPlan.week !== plan.week);
  const alternateLineupTeam = Boolean(plan && lineupPlan && lineupPlan.lineup?.teamId !== plan.lineup?.teamId);
  for (const section of AI_SECTIONS) {
    const saved = savedAiAdvice.get(section) || null;
    const job = savedAiJobs.get(section) || null;
    const run = byId(`ai-run-${section}`);
    const view = byId(`ai-view-${section}`);
    const lineupLocked = section === "lineup" && (lineupForecast || alternateLineupTeam);
    const jobRunning = job?.status === "RUNNING" && job.sourceFingerprint === plan?.sourceFingerprint;
    run.disabled = unavailable || lineupLocked || jobRunning;
    view.disabled = !saved || lineupLocked;
    run.textContent = jobRunning ? "Analysis running…" : lineupLocked
      ? alternateLineupTeam ? "Dogs of War AI only" : "Current week AI only"
      : section === "trade-finder" ? "Find new trades with AI"
        : section === "stash-watch" ? "Find IR gems with AI"
          : "Run AI analysis";
    view.textContent = saved
      ? lineupLocked ? alternateLineupTeam ? "Return to Dogs of War" : "Return to current week" : section === "trade-finder" ? "View saved search" : section === "stash-watch" ? "View saved stash analysis" : "View saved advice"
      : section === "trade-finder" ? "No saved search" : section === "stash-watch" ? "No saved stash analysis" : "No saved advice";
  }
}

function openEvidence(title, value, kind, week = null) {
  playerNewsRequestId += 1;
  byId("evidence-eyebrow").textContent = "Plain-English explanation";
  byId("evidence-title").textContent = title;
  const body = byId("evidence-body");
  body.replaceChildren();
  const explanation = buildEvidenceExplanation(kind, value, { week: week || plan?.week || null });
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

function adviceList(title, items) {
  const section = element("section");
  section.append(element("h3", "", title));
  const list = element("ul", "evidence-list");
  for (const item of items) list.append(element("li", "", item));
  section.append(list);
  return section;
}

function advicePlainText(section, envelope) {
  const value = envelope.advice;
  return [
    `${AI_SECTION_LABELS[section]} AI advice — ${value.headline}`,
    `Generated ${dateTime(envelope.generatedAt)} · Confidence ${value.confidence}`,
    "",
    value.summary,
    "",
    "Decision reviews",
    ...value.decisionReviews.map((item) => `${item.verdict}: ${item.decision}\n${item.reasoning}`),
    "",
    "Key reasons",
    ...value.keyReasons.map((item) => `- ${item}`),
    "",
    "Risks and uncertainty",
    ...value.risks.map((item) => `- ${item}`),
    "",
    "Next steps",
    ...value.nextSteps.map((item) => `- ${item}`),
  ].join("\n");
}

function openAiAdvice(section, saved) {
  playerNewsRequestId += 1;
  const envelope = saved.advice;
  const value = envelope.advice;
  const stale = saved.stale || envelope.sourceFingerprint !== plan?.sourceFingerprint;
  byId("evidence-eyebrow").textContent = `Saved AI decision review · ${envelope.model} · ${dateTime(envelope.generatedAt)}`;
  byId("evidence-title").textContent = `${AI_SECTION_LABELS[section]} advice`;
  const body = byId("evidence-body");
  body.replaceChildren(element("p", "evidence-summary", value.headline), element("p", "evidence-note", `${value.summary} Confidence: ${value.confidence.toLowerCase()}.`));
  if (stale) body.append(element("p", "fab-unavailable", "This advice was generated before the current roster, projections, or news snapshot. It remains available for reference; choose Run AI analysis for an updated review."));
  for (const item of value.decisionReviews) {
    const review = element("section", "ai-decision");
    const heading = element("h3");
    heading.append(element("span", "ai-verdict", item.verdict), document.createTextNode(item.decision));
    review.append(heading, element("p", "", item.reasoning));
    body.append(review);
  }
  body.append(adviceList("Key reasons", value.keyReasons), adviceList("Risks and uncertainty", value.risks), adviceList("Next steps", value.nextSteps));
  const actions = element("div", "ai-copy-actions");
  const copy = element("button", "button primary", "Copy advice");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(advicePlainText(section, envelope));
      setStatus(`${AI_SECTION_LABELS[section]} AI advice copied.`);
    } catch {
      setStatus("The browser could not copy the AI advice. Select the text in this window instead.", true);
    }
  });
  actions.append(copy);
  body.append(actions);
  const dialog = byId("evidence-dialog");
  if (!dialog.open) dialog.showModal();
}

async function loadSavedAiAdviceIndex(value) {
  if (offlineMode || value.kind === "thunder-bowl-season-setup-required") {
    updateAiControls();
    return;
  }
  const fingerprint = value.sourceFingerprint;
  try {
    const index = await privateJson(AI_ADVICE_URL);
    if (plan?.sourceFingerprint !== fingerprint) return;
    for (const section of AI_SECTIONS) {
      const saved = index.adviceBySection?.[section] || null;
      const job = index.jobsBySection?.[section] || null;
      if (saved) savedAiAdvice.set(section, saved);
      else savedAiAdvice.delete(section);
      if (job) savedAiJobs.set(section, job);
      else savedAiJobs.delete(section);
    }
  } catch {
    // The governed recommendations remain fully usable if the optional AI index is unavailable.
  }
  updateAiControls();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runDeepAiAdvice(section, requestId) {
  const jobId = crypto.randomUUID();
  const response = await fetch(AI_ADVICE_BACKGROUND_URL, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ section, jobId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 202) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `The background AI search could not start (${response.status}).`);
  }
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    await wait(4_000);
    if (requestId !== aiAdviceRequestId) return null;
    const index = await privateJson(AI_ADVICE_URL);
    const job = index.jobsBySection?.[section] || null;
    if (job) savedAiJobs.set(section, job);
    const saved = index.adviceBySection?.[section] || null;
    if (job?.jobId !== jobId) continue;
    if (job.status === "FAILED") throw new Error(job.error || "The background AI search failed before advice could be saved.");
    if (job.status === "COMPLETED") {
      if (!saved || saved.stale || saved.advice?.sourceFingerprint !== plan?.sourceFingerprint) throw new Error("The background search finished, but its saved advice does not match the current data. Please update the page and run it again.");
      savedAiAdvice.set(section, saved);
      return { saved, cached: false };
    }
    setStatus(`${AI_SECTION_LABELS[section]} is still running safely in the background. You can leave this tab open; the result will be saved automatically…`);
    updateAiControls();
  }
  throw new Error(`${AI_SECTION_LABELS[section]} is still running in the background. Its result will remain saved when it finishes; use View saved advice after it completes.`);
}

async function runAiAdvice(section) {
  const requestId = ++aiAdviceRequestId;
  const run = byId(`ai-run-${section}`);
  const original = run.textContent;
  for (const candidate of AI_SECTIONS) byId(`ai-run-${candidate}`).disabled = true;
  run.textContent = "Analyzing…";
  setStatus(section === "trade-finder"
    ? "GPT-5.6 Sol is searching all 12 rosters and governed player projections in a background job, so the page will not time out. This deeper analysis can take a few minutes…"
    : section === "stash-watch"
      ? "GPT-5.6 Sol is deeply evaluating every captured IR/PUP asset for keeper surplus and 2027 salary-cap trade leverage in a background job, so the page will not time out. This can take a few minutes…"
      : `AI is auditing the current ${AI_SECTION_LABELS[section].toLowerCase()} decisions against Thunder Bowl rules and saved evidence…`);
  try {
    if (DEEP_AI_SECTIONS.has(section)) {
      const result = await runDeepAiAdvice(section, requestId);
      if (!result || requestId !== aiAdviceRequestId) return;
      updateAiControls();
      openAiAdvice(section, result.saved);
      setStatus(`${AI_SECTION_LABELS[section]} AI analysis finished in the background and was saved for instant reopening.`);
      return;
    }
    const response = await fetch(AI_ADVICE_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ section }),
      signal: AbortSignal.timeout(100_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `AI analysis failed (${response.status}).`);
    if (requestId !== aiAdviceRequestId) return;
    const saved = { advice: data.advice, stale: false };
    savedAiAdvice.set(section, saved);
    updateAiControls();
    openAiAdvice(section, saved);
    setStatus(data.cached
      ? `Opened the saved current ${AI_SECTION_LABELS[section].toLowerCase()} analysis. No new AI call was made.`
      : `${AI_SECTION_LABELS[section]} AI analysis finished and was saved for instant reopening.`);
  } catch (error) {
    setStatus(errorMessage(error), true);
  } finally {
    run.textContent = original;
    updateAiControls();
  }
}

async function privateJson(url) {
  const response = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || `Source request failed (${response.status}).`);
  return value;
}

function validPlayerNewsCache(value) {
  return Boolean(value
    && value.schemaVersion === 1
    && Number.isFinite(Date.parse(value.cachedAt))
    && (value.newsSnapshot || value.researchSnapshot));
}

async function restoreAllPlayerNews() {
  if (playerNewsCacheLoaded) return playerNewsCache;
  playerNewsCacheLoaded = true;
  try {
    const cached = await getMeta(PLAYER_NEWS_CACHE_KEY);
    if (validPlayerNewsCache(cached)) playerNewsCache = cached;
  } catch {
    // News remains available after the next explicit all-player refresh if local storage is unavailable.
  }
  return playerNewsCache;
}

async function saveAllPlayerNews(newsSnapshot, researchSnapshot) {
  if (!newsSnapshot && !researchSnapshot) throw new Error("The all-player news feeds did not return a safe snapshot.");
  playerNewsCache = { schemaVersion: 1, cachedAt: new Date().toISOString(), newsSnapshot, researchSnapshot };
  try { await setMeta(PLAYER_NEWS_CACHE_KEY, playerNewsCache); } catch { /* Keep the in-memory copy for this session. */ }
  return playerNewsCache;
}

async function loadSavedPlayerNewsFromServer() {
  const cached = await restoreAllPlayerNews();
  if (offlineMode || playerNewsServerLoaded) return cached;
  playerNewsServerLoaded = true;
  const [newsResult, researchResult] = await Promise.allSettled([
    privateJson(NEWS_STORED_URL),
    privateJson(RESEARCH_STORED_URL),
  ]);
  const newsSnapshot = newsResult.status === "fulfilled" ? newsResult.value : cached?.newsSnapshot || null;
  const researchSnapshot = researchResult.status === "fulfilled" ? researchResult.value : cached?.researchSnapshot || null;
  if (!newsSnapshot && !researchSnapshot) return cached;
  return saveAllPlayerNews(newsSnapshot, researchSnapshot);
}

async function refreshInjuriesAndAllPlayerNews() {
  const [statusResult, newsResult, researchResult] = await Promise.allSettled([
    privateJson(STATUS_REFRESH_URL),
    privateJson(NEWS_REFRESH_URL),
    privateJson(RESEARCH_REFRESH_URL),
  ]);
  const labeled = [["injuries", statusResult], ["RotoWire news", newsResult], ["CBS/Footballguys research", researchResult]];
  const warnings = labeled.flatMap(([label, result]) => {
    if (result.status === "rejected") return [`${label}: ${errorMessage(result.reason)}`];
    return result.value?.refreshError ? [`${label}: ${result.value.refreshError}`] : [];
  });
  const cached = await restoreAllPlayerNews();
  const newsSnapshot = newsResult.status === "fulfilled" ? newsResult.value : cached?.newsSnapshot || null;
  const researchSnapshot = researchResult.status === "fulfilled" ? researchResult.value : cached?.researchSnapshot || null;
  if (newsSnapshot || researchSnapshot) await saveAllPlayerNews(newsSnapshot, researchSnapshot);
  const rebuilt = await postAction({ action: "rebuild-plan" });
  rebuilt.updateSummary = {
    ...(rebuilt.updateSummary || {}),
    injuryNews: {
      ok: warnings.length === 0,
      asOf: rebuilt.sources?.find((source) => source.label === "injury / news")?.asOf || rebuilt.generatedAt,
      error: warnings.length ? warnings.join("; ") : null,
    },
  };
  return rebuilt;
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

function teamNewsStory(item) {
  const story = element("article", "team-news-item");
  const header = document.createElement("header");
  header.append(element("h3", "", item.title));
  const timestamp = element("time", "", item.asOf ? dateTime(item.asOf) : "Date unavailable");
  if (item.asOf) timestamp.dateTime = item.asOf;
  header.append(timestamp);
  const meta = element("div", "team-news-meta");
  meta.append(element("span", "news-source", item.source));
  for (const player of item.players) meta.append(element("span", "news-player", `${player.name}${player.position || player.nflTeam ? ` · ${[player.position, player.nflTeam].filter(Boolean).join(" ")}` : ""}`));
  story.append(header, meta, element("p", "", item.summary));
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

function renderTeamNews(value, cached = playerNewsCache) {
  const target = byId("team-news-list");
  const roster = [...(value.lineup?.starters || []), ...(value.lineup?.bench || [])];
  if (!cached) {
    byId("team-news-count").textContent = "No saved history yet";
    byId("team-news-updated").textContent = "Choose Refresh all news once to create the private season archive. Future updates will add to it, not replace it.";
    target.replaceChildren(empty("No saved team news is available yet."));
    return;
  }
  const items = buildTeamNewsFeed(roster, cached.newsSnapshot, cached.researchSnapshot);
  const sourceCaptures = [cached.newsSnapshot?.capturedAt, cached.researchSnapshot?.capturedAt]
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  byId("team-news-count").textContent = `${items.length} saved ${items.length === 1 ? "update" : "updates"} · newest first`;
  byId("team-news-updated").textContent = `Private server history through ${sourceCaptures.length ? dateTime(sourceCaptures[0]) : dateTime(cached.cachedAt)}. The complete 2026 season archive is retained across news refreshes and browser sessions.`;
  target.replaceChildren(...(items.length
    ? items.map(teamNewsStory)
    : [empty("No saved RotoWire, CBS, or Footballguys story currently matches a player on the Dogs of War roster.")]));
}

async function openPlayerNews(player) {
  const requestId = ++playerNewsRequestId;
  byId("evidence-eyebrow").textContent = "Latest player news";
  byId("evidence-title").textContent = player.name;
  const body = byId("evidence-body");
  body.replaceChildren();
  const dialog = byId("evidence-dialog");
  if (!dialog.open) dialog.showModal();
  const cached = await restoreAllPlayerNews();
  if (requestId !== playerNewsRequestId) return;
  if (!cached) {
    body.append(element("p", "evidence-summary", "All-player news has not been downloaded on this device yet."));
    body.append(element("p", "evidence-note", "Choose Update injuries/news once. It will collect and save the current RotoWire, CBS, and Footballguys feeds for every player, so every News button opens immediately afterward."));
    return;
  }
  const items = collectLatestPlayerNews(player.name, cached.newsSnapshot, cached.researchSnapshot);
  body.append(element("p", "evidence-summary", items.length
    ? `${items.length} current ${items.length === 1 ? "update" : "updates"} matched ${player.name}. News is evidence only and does not change the projection.`
    : `No current RotoWire, CBS, or Footballguys story matched ${player.name}. That does not override the injury designation or projection shown in the row.`));
  if (items.length) body.append(...items.map(newsStory));
  body.append(element("p", "evidence-note", `${offlineMode ? "Saved offline copy" : "All-player news cache"} updated ${dateTime(cached.cachedAt)}. Choose Update injuries/news whenever you want a fresh league-wide pull.`));
}

function sourceAge(source) {
  if (!source.asOf) return "not synced";
  if (!Number.isFinite(source.ageMinutes)) return dateTime(source.asOf);
  if (source.ageMinutes < 60) return `${source.ageMinutes}m old`;
  if (source.ageMinutes < 1440) return `${Math.floor(source.ageMinutes / 60)}h old`;
  return `${Math.floor(source.ageMinutes / 1440)}d old`;
}

function compactRow(title, detail, evidence = null, evidenceKind = "generic", evidenceWeek = null) {
  const row = element("article", "compact-row");
  const copy = element("div");
  copy.append(element("strong", "", title));
  if (detail) copy.append(element("p", "", detail));
  row.append(copy);
  if (evidence) row.append(evidenceButton(title, evidence, evidenceKind, "Why?", evidenceWeek));
  return row;
}

function playerWatchRow(title, detail, player, evidenceKind, evidenceWeek = null) {
  const row = compactRow(title, detail);
  const actions = element("div", "row-actions");
  actions.append(newsButton(player), evidenceButton(title, player, evidenceKind, "Why?", evidenceWeek));
  row.append(actions);
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
    ? `Last CBS capture: ${dateTime(value.baseline.asOf)}. All teams satisfy the 8–14 player rule${value.baseline.scheduleMatchups ? `, and ${value.baseline.scheduleMatchups} regular-season matchups are stored` : "; the matchup schedule still needs the current Data Helper"}. Refresh only the source that changed, or use Update everything for a complete pass.`
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
      const schedule = summary.scheduleMatchups ? ` · ${summary.scheduleMatchups} schedule matchups` : " · schedule missing";
      const scoringPreview = summary.scoringPreviewStatus === "COMPLETE" ? " · both submitted lineups captured" : " · scoring preview needs attention";
      state.textContent = `Updated ${dateTime(summary.asOf || summary.capturedAt)} · ${legalTeams}/${summary.teamCount} legal rosters · ${summary.rosteredPlayers} players${schedule}${scoringPreview}${projections}${fab}`;
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

function lineupRow(row, slotLabel, kind, value, { toggle = null, alternativeFor = null, className = "" } = {}) {
    const tr = document.createElement("tr");
    if (className) tr.className = className;
    const slot = document.createElement("td");
    slot.append(element("span", "position", slotLabel));
    const playerCell = document.createElement("td");
    if (toggle) {
      const identity = element("div", "lineup-player-control");
      identity.append(toggle, element("span", "player-name", row.name));
      playerCell.append(identity);
    } else playerCell.append(element("span", "player-name", row.name));
    if (alternativeFor) playerCell.append(element("span", "subtext free-agent-comparison", `CBS-confirmed free agent · ${signed(row.delta)} vs ${alternativeFor}`));
    const teamStatus = document.createElement("td");
    teamStatus.append(element("span", "", row.nflTeam || "—"), element("span", "subtext", row.injury?.status || "Active"));
    const game = document.createElement("td");
    const isBye = row.bye === value.week;
    game.append(element("span", "", row.opponent || (isBye ? "BYE" : "Matchup TBD")));
    if (!isBye) game.append(element("span", "subtext kickoff-time", formatDenverKickoff(row, value.week, value.season) || "Start time TBD"));
    const range = element("td", "", `${number(row.floor)}–${number(row.ceiling)}`);
    const points = element("td", "player-name", number(row.points));
    const action = document.createElement("td");
    const actions = element("div", "row-actions");
    actions.append(newsButton(row), evidenceButton(`${row.name} Week ${value.week}`, row, kind, "Why?", value.week));
    action.append(actions);
    tr.append(slot, playerCell, teamStatus, game, range, points, action);
    return tr;
}

function renderLineup(value) {
  lineupPlan = value;
  const currentWeek = value.viewing?.currentWeek || plan?.week || value.week;
  const maxWeek = value.viewing?.maxSelectableWeek || Math.min(18, currentWeek + 2);
  const selector = byId("lineup-week");
  const labels = new Map([[currentWeek, "Current week"], [currentWeek + 1, "Next week"], [currentWeek + 2, "Two weeks out"]]);
  const options = [];
  for (let week = currentWeek; week <= maxWeek; week += 1) {
    const option = document.createElement("option");
    option.value = String(week);
    option.textContent = `Week ${week} — ${labels.get(week) || "Upcoming"}`;
    options.push(option);
  }
  selector.replaceChildren(...options);
  selector.value = String(value.week);
  selector.disabled = offlineMode || value.kind === "thunder-bowl-season-setup-required";
  const teamSelector = byId("lineup-team");
  const userOpponentTeamId = value.viewing?.userOpponentTeamId || null;
  const teamOptions = (value.league?.teams || []).map((team) => {
    const option = document.createElement("option");
    option.value = team.teamId;
    const isDogsOpponent = team.teamId === userOpponentTeamId;
    option.textContent = isDogsOpponent ? `★ ${team.teamName} — Dogs' Week ${value.week} opponent` : team.teamName;
    option.classList.toggle("opponent-option", isDogsOpponent);
    return option;
  });
  teamSelector.replaceChildren(...teamOptions);
  teamSelector.value = value.lineup?.teamId || value.viewing?.selectedTeamId || plan?.lineup?.teamId || "dogs-of-war";
  teamSelector.disabled = offlineMode || value.kind === "thunder-bowl-season-setup-required";
  const teamName = value.lineup?.teamName || value.viewing?.selectedTeamName || "Dogs of War";
  const fantasyOpponent = value.lineup?.opponent?.teamName || value.viewing?.opponentTeamName || null;
  byId("lineup-title").textContent = `${teamName} start / sit plan`;
  const note = byId("lineup-week-note");
  const opponentCopy = fantasyOpponent ? `${teamName} faces ${fantasyOpponent}. ` : value.lineup?.opponent?.allPlay ? `${teamName} is in the all-play week. ` : "";
  if (value.week === currentWeek) {
    note.textContent = `${opponentCopy}Current week: the latest signed-in component projections and Thunder Bowl scoring are used. The ★ team is Dogs of War's CBS opponent. Open a starter’s caret to compare higher-projected free agents.`;
  } else {
    const direct = value.viewing?.directProjectionSources || [];
    note.textContent = opponentCopy + (direct.length
      ? `Early Week ${value.week} outlook using ${direct.join(", ")} direct weekly data plus the governed schedule-shaped baseline for sources that have not posted yet. Open a starter’s caret to compare higher-projected free agents.`
      : `Early Week ${value.week} outlook using the latest roster and injury information plus the governed schedule-shaped projection baseline. Direct weekly component stats replace it when available. Open a starter’s caret to compare higher-projected free agents.`);
  }
  byId("lineup-total").textContent = `${teamName} · ${number(value.lineup.total)} pts`;
  const tbody = byId("starter-rows");
  const slotCount = {};
  tbody.replaceChildren();
  value.lineup.starters.forEach((row, starterIndex) => {
    slotCount[row.position] = (slotCount[row.position] || 0) + 1;
    const alternatives = value.lineup.freeAgentAlternatives?.[row.playerId] || [];
    const alternativeRows = alternatives.length
      ? alternatives.map((alternative, alternativeIndex) => {
        const candidate = lineupRow(alternative, `FA ${alternative.position}`, "free-agent", value, { alternativeFor: row.name, className: "starter-alternative-row" });
        candidate.id = `starter-alternative-${value.lineup.teamId}-${value.week}-${starterIndex}-${alternativeIndex}`;
        candidate.hidden = true;
        return candidate;
      })
      : [(() => {
        const emptyRow = document.createElement("tr");
        emptyRow.id = `starter-alternative-${value.lineup.teamId}-${value.week}-${starterIndex}-empty`;
        emptyRow.className = "starter-alternative-row starter-alternative-empty";
        emptyRow.hidden = true;
        const cell = element("td", "empty", `No CBS-confirmed ${row.position} free agent currently projects above ${row.name} for Week ${value.week}.`);
        cell.colSpan = 7;
        emptyRow.append(cell);
        return emptyRow;
      })()];
    const toggle = element("button", "starter-alternatives-toggle", "▸");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", alternativeRows.map((candidate) => candidate.id).join(" "));
    toggle.setAttribute("aria-label", `Show higher-projected free-agent alternatives for ${row.name}`);
    toggle.title = alternatives.length
      ? `Show ${alternatives.length} higher-projected free-agent alternative${alternatives.length === 1 ? "" : "s"}`
      : "Check for higher-projected free-agent alternatives";
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.textContent = expanded ? "▾" : "▸";
      toggle.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} higher-projected free-agent alternatives for ${row.name}`);
      for (const candidate of alternativeRows) candidate.hidden = !expanded;
    });
    tbody.append(
      lineupRow(row, `${row.position}${slotCount[row.position] > 1 ? slotCount[row.position] : ""}`, "starter", value, { toggle }),
      ...alternativeRows,
    );
  });
  if (!value.lineup.starters.length) {
    const tr = document.createElement("tr");
    const td = element("td", "empty", "No complete governed lineup is available.");
    td.colSpan = 7;
    tr.append(td);
    tbody.append(tr);
  }
  const summaryTarget = byId("lineup-summary");
  const summary = value.lineup.decisionSummary;
  summaryTarget.replaceChildren(...(summary ? [compactRow(summary.headline, `${summary.verdict} · ${summary.reason}`)] : []));
  const swaps = byId("swap-list");
  const decisionRows = [];
  for (const row of value.lineup.swaps || []) {
    const title = row.strength === "TOSS-UP"
      ? `${row.start} vs ${row.sit} is a toss-up`
      : row.strength === "LEAN"
        ? `Lean ${row.start} over ${row.sit}`
        : `Start ${row.start} over ${row.sit}`;
    const detail = `${signed(row.delta)} points · ${row.strength || "UNRATED"} · source agreement ${number(row.confidence, 2)}${row.sourceDisagreement ? ` · source spread ${number(row.sourceDisagreement)}` : ""}`;
    decisionRows.push(compactRow(title, detail, row, "swap", value.week));
  }
  for (const monitor of value.lineup.monitors || []) decisionRows.push(playerWatchRow(`Monitor ${monitor.name} before lock`, monitor.reason, monitor, "starter", value.week));
  swaps.replaceChildren(...(decisionRows.length ? decisionRows : [empty("No decision-relevant start/sit comparison is registered.")]));
  const bench = byId("bench-rows");
  bench.replaceChildren(...value.lineup.bench.map((row) => lineupRow(row, row.position, "bench", value)));
  if (!value.lineup.bench.length) {
    const tr = document.createElement("tr");
    const td = element("td", "empty", "No bench players are currently rostered.");
    td.colSpan = 7;
    tr.append(td);
    bench.append(tr);
  }
  updateAiControls();
}

function scoringPreviewPlayer(row, role, week) {
  if (!row) return element("div", "scoring-player scoring-player-missing", "CBS lineup slot not captured");
  const card = element("article", "scoring-player");
  const identity = element("div", "scoring-player-identity");
  identity.append(
    element("strong", "", row.name),
    element("span", "", `${row.position} · ${row.nflTeam || "NFL team pending"} · ${row.injury?.status || "Active"}`),
    element("small", "", `${row.opponent || (row.bye === week ? "BYE" : "Matchup pending")}${row.gameTime ? ` · ${row.gameTime}` : ""}`),
  );
  if (row.liveStats) identity.append(element("small", "scoring-live-stats", row.liveStats));
  const projection = element("div", "scoring-player-projection");
  if (Number.isFinite(row.actualPoints)) {
    projection.classList.add(row.scoreStatus === "FINAL" ? "final" : "live");
    projection.append(
      element("strong", "", number(row.actualPoints)),
      element("span", "scoring-actual-label", `${row.scoreStatus === "FINAL" ? "FINAL" : "LIVE"} ACTUAL`),
      element("small", "", `Projected ${number(row.points)} · ${number(row.floor)}–${number(row.ceiling)}`),
    );
  } else {
    projection.append(
      element("strong", "", number(row.points)),
      element("span", "", `${number(row.floor)}–${number(row.ceiling)} projected range`),
    );
  }
  const actions = element("div", "row-actions scoring-player-actions");
  actions.append(newsButton(row), evidenceButton(`${row.name} Week ${week} scoring preview`, row, `scoring-preview-${role}`, "Why?", week));
  card.append(identity, projection, actions);
  return card;
}

function renderScoringPreview(value) {
  const preview = value.scoringPreview || { status: "UNAVAILABLE", errors: ["Update CBS with the newest Data Helper to capture submitted lineups and current scores."] };
  const selector = byId("scoring-preview-matchup");
  const selectedTeamId = preview.selectedTeamId || value.viewing?.selectedTeamId || value.league?.userTeamId || "";
  selector.replaceChildren();
  for (const matchup of value.schedule?.matchups || []) {
    const option = element("option", "", `${matchup.teamAName} vs ${matchup.teamBName}`);
    option.value = matchup.teamAId;
    option.selected = matchup.teamAId === selectedTeamId || matchup.teamBId === selectedTeamId;
    selector.append(option);
  }
  selector.disabled = offlineMode || selector.options.length === 0;
  byId("scoring-preview-week").textContent = `Week ${preview.week || value.week}`;
  const allSubmitted = preview.teams?.length === 2 && preview.teams.every((team) => team.submitted);
  byId("scoring-preview-updated").textContent = preview.asOf ? `${allSubmitted ? "CBS lineups/scores" : "CBS rosters"} captured ${dateTime(preview.asOf)}` : "CBS data not captured";
  byId("scoring-preview-authority").textContent = preview.authorityNote || "CBS determines submitted lineups and live or final scoring. Frozen four-source projections remain visible for an honest forecast-versus-result comparison.";
  const target = byId("scoring-preview-content");
  target.replaceChildren();
  if (preview.status !== "COMPLETE" || preview.teams?.length !== 2) {
    const unavailable = element("section", "scoring-preview-unavailable");
    unavailable.append(element("h3", "", "Current CBS lineups and scores are not safely available yet"));
    const list = element("ul", "evidence-list");
    for (const message of preview.errors?.length ? preview.errors : ["Update CBS to capture every league matchup, submitted lineup, and current score."]) list.append(element("li", "", message));
    const action = element("button", "button primary", "Go to Admin and update CBS");
    action.type = "button";
    action.addEventListener("click", () => activateTab("admin", { focus: true }));
    unavailable.append(list, action);
    target.append(unavailable);
    return;
  }
  const [left, right] = preview.teams;
  const scoreboard = element("section", "scoring-scoreboard");
  const teamScore = (team, alignment) => {
    const node = element("div", `scoring-team-score ${alignment}`);
    const hasActual = Number.isFinite(team.actualPoints);
    node.append(
      element("span", "", team.teamName),
      element("strong", hasActual ? (team.actualStatus === "FINAL" ? "final" : "live") : "", number(hasActual ? team.actualPoints : team.total)),
      element("small", "", hasActual
        ? `${team.actualStatus === "FINAL" ? "CBS final" : "CBS live score"} · projected ${number(team.total)}`
        : team.submitted ? "CBS submitted · Thunder Bowl projected points" : "Projected legal lineup · Thunder Bowl points"),
    );
    return node;
  };
  const middle = element("div", "scoring-edge");
  const favorite = preview.favoriteTeamId ? preview.teams.find((team) => team.teamId === preview.favoriteTeamId) : null;
  const actualLeader = Number.isFinite(preview.actualMargin) && preview.actualMargin !== 0 ? (preview.actualMargin > 0 ? left : right) : null;
  middle.append(
    element("strong", "", Number.isFinite(preview.actualMargin) ? (preview.actualMargin === 0 ? "TIED LIVE" : "CURRENT SCORE") : preview.edge === "EVEN" ? "EVEN" : `${preview.edge} EDGE`),
    element("span", "", actualLeader ? `${actualLeader.teamName} by ${Math.abs(preview.actualMargin).toFixed(1)}` : favorite && Number.isFinite(preview.projectedMargin) ? `${favorite.teamName} projected by ${Math.abs(preview.projectedMargin).toFixed(1)}` : "No dependable projected edge"),
  );
  scoreboard.append(teamScore(left, "left"), middle, teamScore(right, "right"));
  target.append(scoreboard);

  const positionGroups = [["Quarterbacks", "QB"], ["Running backs", "RB"], ["Wide receivers", "WR"], ["Tight ends", "TE"], ["Kickers", "K"], ["Defense / special teams", "DST"]];
  const matchups = element("div", "scoring-position-groups");
  for (const [label, position] of positionGroups) {
    const leftRows = left.starters.filter((row) => row.position === position);
    const rightRows = right.starters.filter((row) => row.position === position);
    const group = element("section", "scoring-position-group");
    group.append(element("h3", "", label));
    for (let index = 0; index < Math.max(leftRows.length, rightRows.length, 1); index += 1) {
      const row = element("div", "scoring-matchup-row");
      row.append(scoringPreviewPlayer(leftRows[index], "starter", preview.week), element("div", "scoring-versus", "VS"), scoringPreviewPlayer(rightRows[index], "starter", preview.week));
      group.append(row);
    }
    matchups.append(group);
  }
  target.append(matchups);

  const reserves = element("section", "scoring-reserves");
  reserves.append(element("h3", "", "Reserves"));
  const reserveColumns = element("div", "scoring-reserve-columns");
  for (const team of [left, right]) {
    const column = element("section", "scoring-reserve-team");
    column.append(element("h4", "", team.teamName));
    if (team.bench.length) for (const row of team.bench) column.append(scoringPreviewPlayer(row, "bench", preview.week));
    else column.append(empty("CBS shows no reserves for this team."));
    reserveColumns.append(column);
  }
  reserves.append(reserveColumns);
  target.append(reserves);
}

async function loadScoringPreviewMatchup() {
  const selector = byId("scoring-preview-matchup");
  const teamId = selector.value;
  if (!plan || !teamId) return;
  if (offlineMode) {
    setStatus("Changing matchups requires an online connection.", true);
    return;
  }
  selector.disabled = true;
  const label = selector.selectedOptions[0]?.textContent || "selected matchup";
  setStatus(`Loading ${label}…`);
  try {
    const outlook = await loadSnapshot(plan.week, teamId);
    if (outlook.scoringPreview?.selectedTeamId !== teamId) throw new Error("The server returned the wrong scoring-preview matchup.");
    renderScoringPreview(outlook);
    setStatus(`Showing ${label}. CBS-submitted labels distinguish captured lineups from projected legal lineups.`);
  } catch (error) {
    renderScoringPreview(plan);
    setStatus(errorMessage(error), true);
  } finally {
    byId("scoring-preview-matchup").disabled = offlineMode || byId("scoring-preview-matchup").options.length === 0;
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
  const all = value.waivers.recommendations || [];
  const rows = all
    .filter((row) => waiverView.position === "ALL" || row.add.position === waiverView.position)
    .sort((left, right) => {
      if (waiverView.sort === "week") return (right.gains.week ?? -999) - (left.gains.week ?? -999);
      if (waiverView.sort === "nextThree") return (right.gains.nextThree ?? -999) - (left.gains.nextThree ?? -999);
      if (waiverView.sort === "ros") return (right.gains.restOfSeason ?? -999) - (left.gains.restOfSeason ?? -999);
      if (waiverView.sort === "bid") return (right.fab?.recommended ?? -1) - (left.fab?.recommended ?? -1);
      return left.priority - right.priority;
    });
  byId("waiver-result-count").textContent = `${rows.length} of ${all.length} recommendations`;
  if (!rows.length) {
    const hold = value.waivers.hold;
    if (hold) {
      const card = element("article", "decision-card");
      const header = element("header");
      const title = element("div");
      title.append(element("h3", "", "Hold FAB and roster depth"), element("p", "", `${hold.roster.size}/${hold.roster.maximum} roster spots · No flex`));
      header.append(title, element("span", "verdict", hold.verdict));
      card.append(header, element("p", "", hold.reason));
      const metrics = element("div", "metrics");
      metrics.append(metric("Confidence", hold.confidence), metric("FAB", Number.isFinite(hold.fab.currentBudget) ? `$${hold.fab.currentBudget}` : "Pending"), metric("Tie order", hold.fab.orderAvailable ? "Captured" : "Partial"));
      card.append(metrics);
      target.replaceChildren(card);
    } else {
      target.replaceChildren(empty(value.waivers.blockedReason || "No waiver candidate clears the current legal and projection gates."));
    }
    return;
  }
  target.replaceChildren(...rows.map((row) => {
    const card = element("article", "decision-card");
    const header = element("header");
    const title = element("div");
    title.append(element("h3", "", `${row.priority}. Add ${row.add.name}`), element("p", "", `${row.drop ? `Drop ${row.drop.name}` : "No drop required"} · ${row.add.position} ${row.add.nflTeam}`));
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
  const summaryTarget = byId("trade-board-summary");
  if (value.trades.boardSummary) {
    const summary = value.trades.boardSummary;
    const card = element("article", "decision-card");
    const header = element("header");
    const title = element("div");
    title.append(element("h3", "", summary.headline), element("p", "", `${summary.counts.offer} offer · ${summary.counts.monitor} monitor · ${summary.counts.pass} pass`));
    header.append(title, element("span", "verdict", summary.verdict));
    card.append(header, element("p", "", summary.reason));
    summaryTarget.replaceChildren(card);
  } else summaryTarget.replaceChildren();
  const recommendations = sortTradeProposals(value.trades.recommendations || []);
  if (!recommendations.length) {
    target.replaceChildren(empty(value.trades.blockedReason || "No trade idea clears the two-sided gate."));
    return;
  }
  const cards = recommendations.map((row) => {
    const send = row.sends.map((item) => item.name).join(" + ");
    const receive = row.receives.map((item) => item.name).join(" + ");
    const card = element("article", "decision-card");
    const header = element("header");
    const title = element("div");
    title.append(element("h3", "", `${send} → ${receive}`), element("p", "", `With ${row.rival.teamName}`));
    header.append(title, element("span", "verdict", row.verdict));
    card.append(header);
    const metrics = element("div", "metrics");
    metrics.append(
      metric("Dogs Week", signed(row.dogsDeltas.week)),
      metric("Dogs next 3", signed(row.dogsDeltas.nextThree)),
      metric("Dogs ROS", signed(row.dogsDeltas.restOfSeason)),
      metric("Dogs division", signed(row.dogsDeltas.division)),
      metric("Dogs playoffs", signed(row.dogsDeltas.playoffs)),
      metric("Rival Week", signed(row.rivalDeltas.week)),
      metric("Rival next 3", signed(row.rivalDeltas.nextThree)),
      metric("Rival ROS", signed(row.rivalDeltas.restOfSeason)),
      metric("Rival playoffs", signed(row.rivalDeltas.playoffs)),
    );
    card.append(metrics);
    const detailGrid = element("div", "trade-detail-grid");
    const dogsCase = element("section", "trade-detail");
    dogsCase.append(element("strong", "", "Why Dogs of War improves"), element("p", "", `The exact legal lineup gains ${signed(row.dogsDeltas.restOfSeason)} average rest-of-season points and ${signed(row.dogsDeltas.nextThree)} over the next three weeks.`));
    const rivalCase = element("section", "trade-detail");
    rivalCase.append(element("strong", "", row.verdict === "OFFER" ? "Why the other manager might accept" : "Acceptance reality check"), element("p", "", row.whyRivalAccepts));
    const playerCase = element("section", "trade-detail");
    const outgoing = row.sends[0];
    const incoming = row.receives[0];
    playerCase.append(element("strong", "", "Direct player evidence"), element("p", "", `${outgoing.name}: ${number(outgoing.weekProjection?.points)} projected, ${outgoing.injury?.status || "Active"}, ${outgoing.weekProjection?.directSourceCount || 0} direct source${outgoing.weekProjection?.directSourceCount === 1 ? "" : "s"}, ${(outgoing.news || []).length} current news item${(outgoing.news || []).length === 1 ? "" : "s"}. ${incoming.name}: ${number(incoming.weekProjection?.points)} projected, ${incoming.injury?.status || "Active"}, ${incoming.weekProjection?.directSourceCount || 0} direct source${incoming.weekProjection?.directSourceCount === 1 ? "" : "s"}, ${(incoming.news || []).length} current news item${(incoming.news || []).length === 1 ? "" : "s"}.`));
    const rosterCase = element("section", "trade-detail");
    const rivalFit = incoming.position === outgoing.position
      ? `${row.rival.teamName} would make a same-position ${incoming.position} exchange and keep ${row.rosterContext?.rival?.beforeCounts?.[incoming.position] ?? "—"} at that position.`
      : `${row.rival.teamName} currently carries ${row.rosterContext?.rival?.beforeCounts?.[incoming.position] ?? "—"} ${incoming.position}${(row.rosterContext?.rival?.beforeCounts?.[incoming.position] ?? 0) === 1 ? "" : "s"} and ${row.rosterContext?.rival?.beforeCounts?.[outgoing.position] ?? "—"} ${outgoing.position}${(row.rosterContext?.rival?.beforeCounts?.[outgoing.position] ?? 0) === 1 ? "" : "s"}.`;
    rosterCase.append(element("strong", "", "Rival roster fit"), element("p", "", `${rivalFit} The exchange keeps a legal ${row.rosterContext?.rival?.afterSize ?? "—"}-player roster.`));
    const risk = element("section", "trade-detail");
    risk.append(element("strong", "", "Primary risk"), element("p", "", row.primaryRisk));
    const approach = element("section", "trade-detail");
    approach.append(element("strong", "", "Suggested approach"), element("p", "", row.proposal));
    detailGrid.append(dogsCase, rivalCase, playerCase, rosterCase, risk, approach);
    card.append(detailGrid);
    const actions = element("div", "card-actions");
    actions.append(...recommendationNewsButtons([...row.sends, ...row.receives]));
    actions.append(evidenceButton(`${send} for ${receive}`, row, "trade"));
    if (row.verdict === "OFFER") {
      const copy = element("button", "evidence-button", "Copy proposal");
      copy.type = "button";
      copy.addEventListener("click", async () => { await navigator.clipboard.writeText(row.proposal); setStatus("Trade proposal copied."); });
      actions.append(copy);
    }
    card.append(actions);
    return card;
  });
  target.replaceChildren(...cards);
}

function renderWatch(value) {
  const moves = byId("move-list");
  moves.replaceChildren(...(value.watch.leagueMoves.length
    ? value.watch.leagueMoves.map((row) => compactRow(`${row.type}: ${row.playerName}`, `${row.from?.teamName || "Available"} → ${row.to?.teamName || "Available"} · ${dateTime(row.detectedAt)}`, row, "move"))
    : [empty("No manager roster change has been detected from consecutive CBS snapshots this week.")]));
  const injuries = byId("injury-list");
  injuries.replaceChildren(...(value.watch.injuries.length
    ? value.watch.injuries.slice(0, 30).map((row) => playerWatchRow(`${row.name} · ${row.status}`, `${row.position} · ${row.nflTeam} · Bye ${row.bye ?? "—"} · ${row.leagueStatus} · ${row.practice || row.bodyPart || "details pending"} · ${number(row.projection.points)} projected`, row, "injury"))
    : [empty("No actionable injury row is registered.")]));
  const ir = byId("ir-list");
  ir.replaceChildren(...(value.watch.irTargets.length
    ? value.watch.irTargets.map((row) => {
      const salary = row.leagueStatus === "AVAILABLE"
        ? "winning FAB bid becomes salary ($1 minimum)"
        : Number.isFinite(row.currentSalary) ? `CBS salary $${row.currentSalary}` : "salary not captured";
      return playerWatchRow(`${row.action}: ${row.name}`, `${row.position} · ${row.nflTeam} · Bye ${row.bye ?? "—"} · ${row.leagueStatus} · keeper upside ${row.keeperUpside} · healthy ROS ${number(row.healthyRosAverage)} · ${salary}`, row, "ir");
    })
    : [empty("No IR/PUP stash target currently clears the governed watch gate.")]));
}

function statValue(row, key, digits = 1) {
  const value = row.projectedStats?.[key];
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

const TEXT_PLAYER_SORTS = new Set(["name", "leagueStatus", "opponent"]);

function playerSortValue(row, key) {
  if (key === "name") return row.name;
  if (key === "leagueStatus") return row.leagueStatus;
  if (key === "opponent") return row.opponent || "";
  if (key === "bye") return row.bye;
  if (key === "sourceCount") return row.sourceCount;
  if (key === "points") return row.points;
  if (key === "range") return row.floor;
  return row.projectedStats?.[key];
}

function comparePlayerStats(left, right) {
  const leftValue = playerSortValue(left, playerStatsView.sort);
  const rightValue = playerSortValue(right, playerStatsView.sort);
  const leftMissing = leftValue === null || leftValue === undefined || leftValue === "" || (typeof leftValue === "number" && !Number.isFinite(leftValue));
  const rightMissing = rightValue === null || rightValue === undefined || rightValue === "" || (typeof rightValue === "number" && !Number.isFinite(rightValue));
  if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  if (leftMissing && rightMissing) return left.name.localeCompare(right.name);
  const direction = playerStatsView.direction === "asc" ? 1 : -1;
  const compared = TEXT_PLAYER_SORTS.has(playerStatsView.sort)
    ? String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true })
    : Number(leftValue) - Number(rightValue);
  return compared * direction || left.name.localeCompare(right.name);
}

function updatePlayerSortHeaders() {
  for (const button of document.querySelectorAll("button[data-player-sort]")) {
    const active = button.dataset.playerSort === playerStatsView.sort;
    const heading = button.closest("th");
    button.classList.toggle("active", active);
    button.querySelector("span").textContent = active ? (playerStatsView.direction === "asc" ? "▲" : "▼") : "↕";
    heading.setAttribute("aria-sort", active ? (playerStatsView.direction === "asc" ? "ascending" : "descending") : "none");
  }
}

function renderPlayerStats(value) {
  const all = value.playerStats || [];
  const search = playerStatsView.search.trim().toLowerCase();
  const rows = all.filter((row) => {
    if (playerStatsView.position !== "ALL" && row.position !== playerStatsView.position) return false;
    if (playerStatsView.availability === "FREE_AGENT" && row.leagueStatus !== "FREE AGENT") return false;
    if (playerStatsView.availability === "MY_TEAM" && row.leagueStatus !== "DOGS OF WAR") return false;
    if (playerStatsView.availability === "ROSTERED" && ["FREE AGENT", "UNCONFIRMED"].includes(row.leagueStatus)) return false;
    return !search || [row.name, row.nflTeam, row.position, row.leagueStatus].some((text) => String(text || "").toLowerCase().includes(search));
  }).sort(comparePlayerStats);
  updatePlayerSortHeaders();
  const pages = Math.max(1, Math.ceil(rows.length / playerStatsView.pageSize));
  playerStatsView.page = Math.min(playerStatsView.page, pages - 1);
  const visible = rows.slice(playerStatsView.page * playerStatsView.pageSize, (playerStatsView.page + 1) * playerStatsView.pageSize);
  byId("player-stats-count").textContent = `${rows.length} ${rows.length === 1 ? "player" : "players"}`;
  byId("player-page-label").textContent = `Page ${playerStatsView.page + 1} of ${pages}`;
  byId("player-prev").disabled = playerStatsView.page === 0;
  byId("player-next").disabled = playerStatsView.page >= pages - 1;
  const body = byId("player-stats-rows");
  body.replaceChildren(...visible.map((row) => {
    const tr = document.createElement("tr");
    const playerCell = document.createElement("td");
    playerCell.append(element("span", "player-name", row.name), element("span", "subtext", `${row.position} · ${row.nflTeam}${row.injury?.status ? ` · ${row.injury.status}` : ""}`));
    const availability = element("td");
    availability.append(element("span", "availability", row.leagueStatus));
    const sources = element("td", "source-count", `${row.directSourceCount ?? 0}/4 weekly${row.sourceCount > (row.directSourceCount ?? 0) ? " + estimates" : ""}`);
    sources.title = row.sourceNames?.join(", ") || "No current projection source";
    const actions = document.createElement("td");
    actions.append(newsButton(row, "News"));
    tr.append(
      playerCell,
      availability,
      element("td", "", row.opponent || (row.bye === value.week ? "BYE" : "—")),
      element("td", "", row.bye ?? "—"),
      sources,
      element("td", "player-name", number(row.points)),
      element("td", "", `${number(row.floor)}–${number(row.ceiling)}`),
      element("td", "", statValue(row, "passingYards")),
      element("td", "", statValue(row, "passingTouchdowns", 2)),
      element("td", "", statValue(row, "interceptionsThrown", 2)),
      element("td", "", statValue(row, "rushingAttempts")),
      element("td", "", statValue(row, "rushingYards")),
      element("td", "", statValue(row, "rushingTouchdowns", 2)),
      element("td", "", statValue(row, "receptions")),
      element("td", "", statValue(row, "receivingYards")),
      element("td", "", statValue(row, "receivingTouchdowns", 2)),
      element("td", "", statValue(row, "fumblesLost", 2)),
      element("td", "", statValue(row, "fieldGoalsMade", 2)),
      element("td", "", statValue(row, "extraPointsMade", 2)),
      element("td", "", statValue(row, "defensiveSacks", 2)),
      element("td", "", statValue(row, "defensiveInterceptions", 2)),
      element("td", "", statValue(row, "defensiveFumblesRecovered", 2)),
      element("td", "", statValue(row, "defensiveTouchdowns", 2)),
      actions,
    );
    return tr;
  }));
  if (!visible.length) {
    const tr = document.createElement("tr");
    const td = element("td", "empty", "No player matches these filters.");
    td.colSpan = 24;
    tr.append(td);
    body.append(tr);
  }
}

function selectedValues(select) {
  return [...select.selectedOptions].map((option) => option.value);
}

function resetTradeBuilder(value) {
  const teams = value.league?.teams || [];
  const dogsId = value.league?.userTeamId || "dogs-of-war";
  const rivals = teams.filter((team) => team.teamId !== dogsId);
  const count = Number(byId("trade-team-count").value || 2);
  tradeBuilderState = {
    teamIds: [dogsId, ...rivals.slice(0, count - 1).map((team) => team.teamId)],
    playerIdsByTeam: new Map(),
    recipientsByTeam: new Map(),
  };
  byId("trade-analysis-result").replaceChildren();
}

function renderTradeBuilder(value, { forceReset = false } = {}) {
  const teams = value.league?.teams || [];
  if (!teams.length) {
    byId("trade-team-rows").replaceChildren(empty("Sync CBS rosters before building a proposed trade."));
    byId("analyze-trade").disabled = true;
    return;
  }
  const fingerprintChanged = tradeBuilderFingerprint !== value.sourceFingerprint;
  if (forceReset || fingerprintChanged || !tradeBuilderState.teamIds.length) resetTradeBuilder(value);
  tradeBuilderFingerprint = value.sourceFingerprint;
  byId("analyze-trade").disabled = offlineMode;
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  const count = Number(byId("trade-team-count").value || 2);
  const dogsId = value.league.userTeamId;
  const rivals = teams.filter((team) => team.teamId !== dogsId);
  tradeBuilderState.teamIds = [dogsId, ...tradeBuilderState.teamIds.slice(1, count)];
  while (tradeBuilderState.teamIds.length < count) {
    const candidate = rivals.find((team) => !tradeBuilderState.teamIds.includes(team.teamId));
    if (!candidate) break;
    tradeBuilderState.teamIds.push(candidate.teamId);
  }
  const rows = tradeBuilderState.teamIds.map((teamId, index) => {
    const team = teamById.get(teamId);
    const row = element("section", "trade-team-row");
    const teamLabel = element("label", "", "Manager / team");
    const teamSelect = document.createElement("select");
    teamSelect.dataset.tradeTeamIndex = String(index);
    const options = index === 0 ? [teamById.get(dogsId)] : rivals;
    for (const optionTeam of options) {
      const option = element("option", "", optionTeam.teamName);
      option.value = optionTeam.teamId;
      option.selected = optionTeam.teamId === teamId;
      option.disabled = optionTeam.teamId !== teamId && tradeBuilderState.teamIds.includes(optionTeam.teamId);
      teamSelect.append(option);
    }
    if (index === 0) teamSelect.disabled = true;
    teamSelect.addEventListener("change", () => {
      const oldId = tradeBuilderState.teamIds[index];
      tradeBuilderState.teamIds[index] = teamSelect.value;
      tradeBuilderState.playerIdsByTeam.delete(oldId);
      tradeBuilderState.recipientsByTeam.delete(oldId);
      renderTradeBuilder(value);
    });
    teamLabel.append(teamSelect);

    const playersLabel = element("label", "", "Players this team sends (Ctrl/Cmd-click for multiple)");
    const players = document.createElement("select");
    players.multiple = true;
    players.size = Math.min(8, Math.max(4, team.roster.length));
    const selected = new Set(tradeBuilderState.playerIdsByTeam.get(teamId) || []);
    for (const player of team.roster) {
      const option = element("option", "", `${player.position} · ${player.name} · ${number(player.points)} pts`);
      option.value = player.playerId;
      option.selected = selected.has(player.playerId);
      players.append(option);
    }
    players.addEventListener("change", () => tradeBuilderState.playerIdsByTeam.set(teamId, selectedValues(players)));
    playersLabel.append(players);

    const recipientLabel = element("label", "", "This package goes to");
    const recipient = document.createElement("select");
    const otherIds = tradeBuilderState.teamIds.filter((candidate) => candidate !== teamId);
    const defaultRecipient = otherIds[(index === count - 1 && count === 3) ? 0 : Math.min(index, otherIds.length - 1)] || otherIds[0];
    const recipientId = otherIds.includes(tradeBuilderState.recipientsByTeam.get(teamId)) ? tradeBuilderState.recipientsByTeam.get(teamId) : defaultRecipient;
    tradeBuilderState.recipientsByTeam.set(teamId, recipientId);
    for (const candidateId of otherIds) {
      const option = element("option", "", teamById.get(candidateId).teamName);
      option.value = candidateId;
      option.selected = candidateId === recipientId;
      recipient.append(option);
    }
    recipient.addEventListener("change", () => tradeBuilderState.recipientsByTeam.set(teamId, recipient.value));
    recipientLabel.append(recipient);
    row.append(teamLabel, playersLabel, recipientLabel);
    return row;
  });
  byId("trade-team-rows").replaceChildren(...rows);
}

function renderTradeAnalysis(result) {
  const target = byId("trade-analysis-result");
  const summary = element("section", "trade-analysis-summary");
  summary.append(element("span", "verdict", result.verdict), element("h3", "", result.summary), element("p", "", result.method));
  const grid = element("div", "trade-impact-grid");
  for (const team of result.teams) {
    const card = element("section", "trade-impact-card");
    card.append(element("h3", "", team.teamName));
    card.append(element("p", "", `Sends: ${team.sends.map((player) => player.name).join(" + ") || "none"}`));
    card.append(element("p", "", `Receives: ${team.receives.map((player) => player.name).join(" + ") || "none"}`));
    const metrics = element("div", "metrics");
    metrics.append(metric("Week", signed(team.impact.week.delta)), metric("Next 3", signed(team.impact.nextThree.delta)), metric("ROS", signed(team.impact.restOfSeason.delta)), metric("Division", signed(team.impact.division.delta)), metric("Playoffs", signed(team.impact.playoffs.delta)));
    card.append(metrics);
    const actions = element("div", "card-actions");
    actions.append(...recommendationNewsButtons([...team.sends, ...team.receives]));
    card.append(actions);
    grid.append(card);
  }
  const risks = adviceList("Risks and acceptance", result.risks || []);
  target.replaceChildren(summary, grid, risks);
}

async function analyzeBuiltTrade() {
  const button = byId("analyze-trade");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Analyzing…";
  setStatus("Validating every post-trade roster and calculating the complete two- or three-team impact…");
  try {
    const transfers = tradeBuilderState.teamIds.map((fromTeamId) => ({
      fromTeamId,
      toTeamId: tradeBuilderState.recipientsByTeam.get(fromTeamId),
      playerIds: tradeBuilderState.playerIdsByTeam.get(fromTeamId) || [],
    }));
    const response = await fetch(TRADE_ANALYSIS_URL, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ transfers }), signal: AbortSignal.timeout(45_000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Trade analysis failed (${response.status}).`);
    renderTradeAnalysis(result);
    setStatus("Trade package analyzed against every participating team's legal optimal lineup.");
  } catch (error) {
    byId("trade-analysis-result").replaceChildren(element("p", "fab-unavailable", errorMessage(error)));
    setStatus(errorMessage(error), true);
  } finally {
    button.textContent = original;
    button.disabled = offlineMode;
  }
}

async function renderPlan(value, { offline = false } = {}) {
  plan = value;
  offlineMode = offline;
  const localNews = await restoreAllPlayerNews();
  const setupRequired = value.kind === "thunder-bowl-season-setup-required";
  byId("login-view").hidden = true;
  byId("app-view").hidden = false;
  renderHeader(value, offline);
  renderLineup(value);
  renderScoringPreview(value);
  renderWaivers(value);
  renderTrades(value);
  renderWatch(value);
  renderPlayerStats(value);
  renderTradeBuilder(value);
  renderUpdateSources(value);
  renderTeamNews(value, localNews);
  renderManagement(value, { offline, onImport: async (records) => {
    const next = await postAction({ action: "import-management", records });
    await renderPlan(next);
  } });
  restoreActionControls();
  if (setupRequired && !offline) {
    byId("helper-setup").open = true;
    activateTab("admin");
    setStatus("Access accepted. Complete the one-time helper setup, then choose Update CBS or Update everything.");
  }
  if (value.updateSummary?.cbs?.ok) byId("helper-setup").open = false;
  if (!offline && !setupRequired) await setMeta(PLAN_CACHE_KEY, value);
  await loadSavedAiAdviceIndex(value);
  const savedNews = await loadSavedPlayerNewsFromServer();
  if (plan === value) renderTeamNews(value, savedNews);
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

async function loadSnapshot(week = null, teamId = null) {
  const url = new URL(SNAPSHOT_URL, window.location.origin);
  if (week !== null) url.searchParams.set("week", String(week));
  if (teamId) url.searchParams.set("team", teamId);
  return responseJson(await fetch(url, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20_000) }));
}

async function loadLineupSelection() {
  const weekSelector = byId("lineup-week");
  const teamSelector = byId("lineup-team");
  const week = Number(weekSelector.value);
  const teamId = teamSelector.value;
  if (!plan || !Number.isSafeInteger(week) || !teamId) return;
  if (week === plan.week && teamId === plan.lineup?.teamId) {
    renderLineup(plan);
    setStatus(`Showing Dogs of War's current Week ${week} lineup.`);
    return;
  }
  if (offlineMode) {
    renderLineup(lineupPlan || plan);
    setStatus("Other-team and upcoming-week outlooks require an online connection.", true);
    return;
  }
  const priorLineup = lineupPlan || plan;
  weekSelector.disabled = true;
  teamSelector.disabled = true;
  const selectedName = teamSelector.selectedOptions[0]?.textContent?.replace(/^★\s*/, "").replace(/\s+— Dogs'.*$/, "") || teamId;
  byId("lineup-week-note").textContent = `Loading ${selectedName}'s Week ${week} outlook…`;
  setStatus(`Calculating ${selectedName}'s Week ${week} lineup from the CBS roster and available projections…`);
  try {
    const outlook = await loadSnapshot(week, teamId);
    if (outlook.week !== week) throw new Error(`The server returned Week ${outlook.week} instead of Week ${week}.`);
    if (outlook.lineup?.teamId !== teamId) throw new Error("The server returned the wrong CBS team lineup.");
    renderLineup(outlook);
    const opponent = outlook.lineup?.opponent?.teamName ? ` against ${outlook.lineup.opponent.teamName}` : "";
    setStatus(`Showing ${outlook.lineup.teamName}'s Week ${week} outlook${opponent}. AI advice remains reserved for Dogs of War's current week.`);
  } catch (error) {
    renderLineup(priorLineup);
    byId("lineup-week-note").textContent = "The requested team outlook could not be loaded; the prior lineup remains visible.";
    setStatus(errorMessage(error), true);
  } finally {
    weekSelector.disabled = offlineMode;
    teamSelector.disabled = offlineMode;
  }
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
    snapshot = validateCbsRosterSnapshot(await requestCbsRosterCapture({ timeoutMs: 300_000, week: plan?.week || 1 }));
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

for (const tabId of TAB_IDS) {
  const button = byId(`tab-button-${tabId}`);
  button.addEventListener("click", () => activateTab(tabId));
  button.addEventListener("keydown", (event) => {
    const current = TAB_IDS.indexOf(activeTabId());
    let next = null;
    if (event.key === "ArrowRight") next = (current + 1) % TAB_IDS.length;
    if (event.key === "ArrowLeft") next = (current - 1 + TAB_IDS.length) % TAB_IDS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TAB_IDS.length - 1;
    if (next === null) return;
    event.preventDefault();
    activateTab(TAB_IDS[next], { focus: true });
  });
}
window.addEventListener("hashchange", () => activateTab(location.hash.slice(1), { updateHash: false }));

byId("lineup-week").addEventListener("change", loadLineupSelection);
byId("lineup-team").addEventListener("change", loadLineupSelection);
byId("scoring-preview-matchup").addEventListener("change", loadScoringPreviewMatchup);
byId("waiver-position").addEventListener("change", (event) => {
  waiverView.position = event.target.value;
  if (plan) renderWaivers(plan);
});
byId("waiver-sort").addEventListener("change", (event) => {
  waiverView.sort = event.target.value;
  if (plan) renderWaivers(plan);
});
byId("player-position-filters").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-position]");
  if (!button) return;
  playerStatsView.position = button.dataset.position;
  playerStatsView.page = 0;
  for (const candidate of byId("player-position-filters").querySelectorAll("button")) candidate.classList.toggle("active", candidate === button);
  if (plan) renderPlayerStats(plan);
});
byId("player-search").addEventListener("input", (event) => {
  playerStatsView.search = event.target.value;
  playerStatsView.page = 0;
  if (plan) renderPlayerStats(plan);
});
byId("player-availability").addEventListener("change", (event) => {
  playerStatsView.availability = event.target.value;
  playerStatsView.page = 0;
  if (plan) renderPlayerStats(plan);
});
document.querySelector(".player-stats-table thead").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-player-sort]");
  if (!button) return;
  const key = button.dataset.playerSort;
  if (playerStatsView.sort === key) playerStatsView.direction = playerStatsView.direction === "asc" ? "desc" : "asc";
  else {
    playerStatsView.sort = key;
    playerStatsView.direction = TEXT_PLAYER_SORTS.has(key) ? "asc" : "desc";
  }
  playerStatsView.page = 0;
  if (plan) renderPlayerStats(plan);
});
byId("player-prev").addEventListener("click", () => {
  playerStatsView.page = Math.max(0, playerStatsView.page - 1);
  if (plan) renderPlayerStats(plan);
});
byId("player-next").addEventListener("click", () => {
  playerStatsView.page += 1;
  if (plan) renderPlayerStats(plan);
});
byId("trade-team-count").addEventListener("change", () => {
  if (!plan) return;
  resetTradeBuilder(plan);
  renderTradeBuilder(plan);
});
byId("clear-trade").addEventListener("click", () => {
  if (!plan) return;
  resetTradeBuilder(plan);
  renderTradeBuilder(plan);
  setStatus("Proposed trade cleared.");
});
byId("analyze-trade").addEventListener("click", analyzeBuiltTrade);

byId("login-form").addEventListener("submit", attemptLogin);
byId("update-cbs-only").addEventListener("click", () => runAction(
  byId("update-cbs-only"),
  "Updating the CBS submitted lineups, league schedule, all 12 rosters, moves, availability, and weekly component stats…",
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
function runNewsRefresh(button) {
  return runAction(
    button,
    "Refreshing injuries and IR, then downloading RotoWire, CBS, and Footballguys news for every player…",
    refreshInjuriesAndAllPlayerNews,
    (value) => `Injuries, IR, and all-player news updated ${dateTime(value.generatedAt)}. New stories were added to the private season archive; older stories remain available on the News tab.`,
  );
}

byId("update-news-only").addEventListener("click", () => runNewsRefresh(byId("update-news-only")));
byId("refresh-team-news").addEventListener("click", () => runNewsRefresh(byId("refresh-team-news")));
byId("refresh-plan").addEventListener("click", () => runAction(byId("refresh-plan"), "Step 1 of 5: capturing the CBS submitted lineups, schedule, and all 12 rosters from your signed-in browser session…", async () => {
  let snapshot;
  try {
    snapshot = validateCbsRosterSnapshot(await requestCbsRosterCapture({ timeoutMs: 300_000, week: plan?.week || 1 }));
  } catch (error) {
    byId("helper-setup").open = true;
    throw new Error(`${errorMessage(error)} Open “First-time setup” below; after that, this same button updates everything.`);
  }
  setStatus("CBS captured. Saving the submitted lineups, league schedule, rosters, moves, and CBS component-stat projections before continuing…");
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
    current = await refreshInjuriesAndAllPlayerNews();
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
byId("import-cbs-json-paste").addEventListener("click", async (event) => {
  const field = byId("cbs-json-paste");
  let snapshot;
  try {
    snapshot = validateCbsRosterSnapshot(JSON.parse(field.value.trim()));
  } catch (error) {
    setStatus(`CBS pasted-data import failed validation: ${errorMessage(error)}`, true);
    return;
  }
  await runAction(event.currentTarget, "Validating and syncing the captured CBS data…", async () => postAction({ action: "sync-cbs", snapshot }));
  field.value = "";
});
byId("fbg-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  await runAction(event.target, "Validating the current-week Footballguys projection export…", async () => postAction({ action: "sync-fbg", csv: await file.text() }));
  event.target.value = "";
});
byId("export-plan").addEventListener("click", downloadPlan);
for (const section of AI_SECTIONS) {
  byId(`ai-run-${section}`).addEventListener("click", () => runAiAdvice(section));
  byId(`ai-view-${section}`).addEventListener("click", () => {
    const saved = savedAiAdvice.get(section);
    if (saved) openAiAdvice(section, saved);
  });
}
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

activateTab(location.hash.slice(1), { updateHash: false });

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
  if (document.hidden || offlineMode || !navigator.onLine || !plan || document.activeElement?.closest(".management-form")) return;
  try {
    const current = await loadSnapshot(plan.viewing?.selectedWeek ?? plan.week, plan.lineup?.teamId);
    if (current.sourceFingerprint !== plan.sourceFingerprint || current.generatedAt !== plan.generatedAt) await renderPlan(current);
  } catch { /* Manual controls carry actionable errors. */ }
}, 60_000);
