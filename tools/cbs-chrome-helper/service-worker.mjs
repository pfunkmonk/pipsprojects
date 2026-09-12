import { normalizeCbsProjectionRows, normalizeCbsTeamRows } from "./cbs-normalize.mjs";
import { normalizeCbsDraftDaySetupPages } from "./cbs-draft-day-setup.mjs";
import { normalizeCbsFabPages } from "./cbs-fab-normalize.mjs";
import { cbsScheduleUrlMatches, renderedCbsScheduleReady } from "./cbs-schedule-readiness.mjs";
import { pffProjectionTableReady } from "./pff-projection-readiness.mjs";

const TEAMS = [
  ["angry-face", 1, "Angry Face", ["Muther Humpers"]], ["orange-crush", 2, "Orange Crush"],
  ["big-head", 3, "Big Head"], ["dogs-of-war", 4, "Dogs of War"],
  ["t-dogs", 5, "T-Dogs"], ["super-suckers", 6, "Super Suckers"],
  ["three-amigos", 7, "Three Amigos"], ["goon-skwad", 8, "Goon Skwad"],
  ["el-guapo", 9, "El Guapo"], ["crime-and-punishment", 10, "Crime and Punishment"],
  ["the-hobbits", 11, "The Hobbits"], ["the-bungles", 12, "The Bungles"],
].map(([teamId, cbsTeamId, name, aliases = []]) => ({ teamId, cbsTeamId, name, aliases }));

const CBS_ORIGIN = "https://berrymvp.football.cbssports.com";
const REPORT_URL = `${CBS_ORIGIN}/teams/roster-report/all/2026/`;
const ROSTER_URL_PREFIXES = [`${CBS_ORIGIN}/teams/roster-report/all/2026`, `${CBS_ORIGIN}/teams/all`];
const FBG_ORIGIN = "https://www.footballguys.com";
const FBG_CAPTURE_SOURCE = "Footballguys authenticated weekly projections download";
const FANTASYPROS_ORIGIN = "https://www.fantasypros.com";
const FANTASYPROS_CAPTURE_SOURCE = "FantasyPros authenticated weekly component projections capture";
const PFF_ORIGIN = "https://www.pff.com";
const PFF_CAPTURE_SOURCE = "PFF authenticated weekly component projections capture";
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
const ALLOWED_APP_ORIGINS = new Set(["https://pipsprojects.com", "http://localhost:8888"]);
const PAGE_READY_TIMEOUT_MS = 30_000;
const PAGE_POLL_INTERVAL_MS = 250;
const HELPER_VERSION = "0.10.6";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function cbsPageHasContent(tabId, pageKind, expectedPlayerNames = []) {
  return (await readCbsPage(tabId, "has-content", { pageKind, expectedPlayerNames })) === true;
}

async function readCbsPage(tabId, kind, args = {}, timeoutMs = 5_000) {
  const response = await Promise.race([
    chrome.tabs.sendMessage(tabId, {
      source: "thunder-bowl-helper-worker",
      action: "read-cbs-page",
      kind,
      args,
    }),
    delay(timeoutMs).then(() => {
      throw new Error("CBS " + kind + " reader timed out.");
    }),
  ]);
  if (!response?.ok || response.readerVersion !== HELPER_VERSION) throw new Error(response?.error || "CBS page reader version does not match the active helper.");
  return response.value;
}

async function waitForCbsContent(tabId, expectedUrlPrefix, pageKind, label, timeoutMs = PAGE_READY_TIMEOUT_MS, expectedPlayerNames = []) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let sawExpectedPage = false;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error("CBS tab closed before capture completed.");
    }
    const pageUrl = tab.url || tab.pendingUrl || "";
    const expectedPrefixes = Array.isArray(expectedUrlPrefix) ? expectedUrlPrefix : [expectedUrlPrefix];
    if (expectedPrefixes.some((prefix) => pageUrl.startsWith(prefix))) {
      sawExpectedPage = true;
      try {
        if (await cbsPageHasContent(tabId, pageKind, expectedPlayerNames)) return;
      } catch {
        // Edge can briefly report no content-script receiver between navigation commits.
      }
    } else if (sawExpectedPage || (Date.now() - startedAt > 1_500 && pageUrl && pageUrl !== "about:blank" && !pageUrl.startsWith(CBS_ORIGIN) && tab.status === "complete")) {
      throw new Error(`CBS redirected away from the ${label}. Sign in to Thunder Bowl on CBS in this browser, then retry.`);
    }
    await delay(PAGE_POLL_INTERVAL_MS);
  }
  throw new Error(`CBS ${label} did not become ready within ${Math.round(timeoutMs / 1000)} seconds. Keep the CBS sign-in open in this browser, then retry.`);
}

async function rawRosterTables(tabId) {
  return await readCbsPage(tabId, "roster-tables") || [];
}

async function renderedSchedulePage(tabId, timeoutMs = 5_000) {
  return await readCbsPage(tabId, "schedule-page", {
    cbsOrigin: CBS_ORIGIN,
    teamNames: TEAMS.flatMap((team) => [team.name, ...team.aliases]),
  }, timeoutMs);
}

async function waitForRenderedSchedulePage(tabId, expectedUrl, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
    const url = tab.url || tab.pendingUrl || "";
    if (url && !url.startsWith(CBS_ORIGIN) && url !== "about:blank" && tab.status === "complete") return null;
    if (cbsScheduleUrlMatches(url, expectedUrl)) {
      try {
        const captured = await renderedSchedulePage(tabId);
        if (renderedCbsScheduleReady(captured, url, expectedUrl, TEAMS.flatMap((team) => [team.name, ...team.aliases]))) return captured;
      } catch {
        // The new CBS document can commit before its content reader reaches document_idle.
      }
    }
    await delay(PAGE_POLL_INTERVAL_MS);
  }
  return null;
}

function rawScheduleEvidence(pages, capturedAt) {
  return {
    schemaVersion: 1,
    capturedAt,
    pages: pages.slice(0, 30).map((page) => ({
      url: page?.url || "",
      title: page?.title || "",
      text: String(page?.text || "").slice(0, 250_000),
      tables: Array.isArray(page?.tables) ? page.tables : [],
      blocks: Array.isArray(page?.blocks) ? page.blocks : [],
    })),
  };
}

async function captureCbsSchedule(tabId) {
  const capturedAt = new Date().toISOString();
  const fullScheduleUrl = `${CBS_ORIGIN}/schedule/full`;
  const captured = await waitForRenderedSchedulePage(tabId, fullScheduleUrl, 30_000);
  if (!captured?.page) throw new Error("CBS full schedule did not finish rendering within 30 seconds.");
  return { rawLeagueSchedule: rawScheduleEvidence([captured.page], capturedAt) };
}

async function captureCbsFabPages(tabId, week) {
  const result = await readCbsPage(tabId, "fab-pages", { week, cbsOrigin: CBS_ORIGIN }, 18_000);
  if (!result?.pages?.length) return null;
  const normalized = normalizeCbsFabPages(result.pages, week, new Date().toISOString());
  const coverage = normalized.coverage;
  return coverage.budgetTeams || coverage.orderTeams || coverage.recordTeams || coverage.pickupRows ? normalized : null;
}

async function captureCbsFabPagesWithinDeadline(tabId, week, timeoutMs = 20_000) {
  return Promise.race([
    captureCbsFabPages(tabId, week).catch(() => null),
    delay(timeoutMs).then(() => null),
  ]);
}

async function captureCbsScoringPreviewRaw(tabId, week, teams) {
  const capturedAt = new Date().toISOString();
  const pageUrl = `${CBS_ORIGIN}/scoring/live/${week}/`;
  const expectedPlayers = teams.flatMap((team) => team.players.map((player) => ({ cbsPlayerId: player.cbsPlayerId, name: player.name })));
  try {
    await chrome.tabs.update(tabId, { url: pageUrl, active: false });
    await waitForCbsContent(tabId, [`${CBS_ORIGIN}/scoring/live`, pageUrl], "scoring-live", "live scoring page", 30_000, expectedPlayers.map((player) => player.name));
    const page = await readCbsPage(tabId, "scoring-live-rows", { rosterPlayers: expectedPlayers }, 45_000) || {};
    return { schemaVersion: 1, capturedAt, week, rows: page.rows || [], allMatchups: page.allMatchups === true, matchupCount: page.matchupCount || 0, pageUrl: page.pageUrl || pageUrl, pageTitle: page.pageTitle || "", captureError: page.captureError || null };
  } catch (error) {
    return { schemaVersion: 1, capturedAt, week, rows: [], allMatchups: false, matchupCount: 0, pageUrl, pageTitle: "", captureError: error instanceof Error ? error.message : String(error) };
  }
}

async function rawProjectionTable(tabId, position, week) {
  const reportUrl = `${CBS_ORIGIN}/stats/stats-main/all:${position}/${week}:p/standard/projections`;
  await chrome.tabs.update(tabId, { url: reportUrl, active: false });
  await waitForCbsContent(tabId, reportUrl, "projection", `${position} projection table`, 15_000);
  const rows = await readCbsPage(tabId, "projection-rows", { position });
  return normalizeCbsProjectionRows(position, rows || [], week);
}

async function withTemporaryCbsTab(url, task) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    if (!Number.isSafeInteger(tab?.id)) throw new Error("The helper could not open its temporary CBS capture tab.");
    tabId = tab.id;
    return await task(tabId);
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

function validCbsLeagueOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-z0-9-]+\.football\.cbssports\.com$/i.test(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

async function mostRecentCbsLeagueOrigin() {
  const tabs = await chrome.tabs.query({ url: "https://*.football.cbssports.com/*" });
  const candidates = tabs
    .map((tab) => ({ origin: validCbsLeagueOrigin(tab.url || tab.pendingUrl), lastAccessed: Number(tab.lastAccessed) || 0 }))
    .filter((tab) => tab.origin)
    .sort((left, right) => right.lastAccessed - left.lastAccessed);
  if (!candidates.length) throw new Error("Open the CBS football league you want to import in this browser, then try Sync from CBS again.");
  return candidates[0].origin;
}

async function waitForSetupPage(tabId, expectedUrl, setupKind, timeoutMs = 20_000) {
  const expectedOrigin = new URL(expectedUrl).origin;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let tab;
    try { tab = await chrome.tabs.get(tabId); }
    catch { throw new Error("The temporary CBS setup tab closed before the import finished."); }
    const pageUrl = tab.url || tab.pendingUrl || "";
    if (pageUrl && pageUrl !== "about:blank" && validCbsLeagueOrigin(pageUrl) !== expectedOrigin && tab.status === "complete") {
      throw new Error("CBS redirected away from the selected football league. Sign in to that league in this browser, then retry.");
    }
    if (validCbsLeagueOrigin(pageUrl) === expectedOrigin && tab.status === "complete") {
      try {
        const page = await readCbsPage(tabId, "setup-page", { setupKind });
        if (page?.url && validCbsLeagueOrigin(page.url) === expectedOrigin) return page;
      } catch {
        // CBS can finish navigation just before the content reader reconnects.
      }
    }
    await delay(PAGE_POLL_INTERVAL_MS);
  }
  throw new Error(`CBS ${setupKind} settings did not become readable within ${Math.round(timeoutMs / 1000)} seconds.`);
}

async function captureDraftDayCbsSetup() {
  const origin = await mostRecentCbsLeagueOrigin();
  const specs = [
    ["home", "/"],
    ["standings", "/standings"],
    ["roster", "/setup/league-settings/team-rosters"],
    ["policies", "/setup/league-settings/player-policies"],
    ["draft", "/setup/league-settings/draft-management/config"],
    ["order", "/setup/league-settings/draft-management/order"],
  ];
  const results = await Promise.all(specs.map(async ([kind, path]) => {
    const url = `${origin}${path}`;
    try {
      const page = await withTemporaryCbsTab(url, (tabId) => waitForSetupPage(tabId, url, kind));
      return { kind, page };
    } catch (error) {
      return { kind, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  const pages = results.flatMap((result) => result.page ? [result.page] : []);
  const skipped = results.flatMap((result) => result.error ? [result.kind] : []);
  const setup = normalizeCbsDraftDaySetupPages(pages, new Date().toISOString());
  if (skipped.length) setup.review.push(`CBS could not read ${skipped.join(", ")} ${skipped.length === 1 ? "page" : "pages"}`);
  return setup;
}

async function captureCbsRosterBase(week) {
  return withTemporaryCbsTab(REPORT_URL, async (tabId) => {
    await waitForCbsContent(tabId, ROSTER_URL_PREFIXES, "roster", "all-team roster report");
    const rosterPageUrl = (await chrome.tabs.get(tabId)).url || REPORT_URL;
    const reportTables = await rawRosterTables(tabId);
    const byTeam = new Map(reportTables.map((table) => [table.teamName, table.rows]));
    const rowsForTeam = (team) => [team.name, ...team.aliases].map((name) => byTeam.get(name)).find(Boolean);
    const missing = TEAMS.filter((team) => !rowsForTeam(team));
    if (missing.length) throw new Error(`CBS roster report is missing ${missing.map((team) => team.name).join(", ")}.`);
    const teams = TEAMS.map((team) => normalizeCbsTeamRows(team, rowsForTeam(team)));
    const playerCount = teams.reduce((sum, team) => sum + team.players.length, 0);
    return {
      schemaVersion: 1,
      source: "CBS Sports authenticated Thunder Bowl all-team roster report",
      modelEffect: "none",
      capturedAt: new Date().toISOString(),
      season: 2026,
      pageUrl: rosterPageUrl,
      teamCount: teams.length,
      playerCount,
      teams,
      projectionWeek: week,
      projectionCount: 0,
    };
  });
}

async function captureCbsScheduleStage() {
  return withTemporaryCbsTab(`${CBS_ORIGIN}/schedule/full`, async (tabId) => {
    const scheduleCapture = await captureCbsSchedule(tabId);
    if (!scheduleCapture.rawLeagueSchedule?.pages?.length) throw new Error("CBS returned no rendered full-schedule page.");
    return scheduleCapture.rawLeagueSchedule;
  });
}

async function captureCbsFabStage(week) {
  return withTemporaryCbsTab(REPORT_URL, async (tabId) => {
    await waitForCbsContent(tabId, ROSTER_URL_PREFIXES, "roster", "all-team roster report");
    return captureCbsFabPagesWithinDeadline(tabId, week);
  });
}

function previewTeams(input) {
  if (!Array.isArray(input) || input.length !== TEAMS.length) throw new Error("CBS scoring-preview capture received incomplete roster context.");
  const expectedNames = new Set(TEAMS.map((team) => team.name));
  let playerCount = 0;
  const teams = input.map((team) => {
    if (!expectedNames.has(team?.name) || !Array.isArray(team?.players) || team.players.length < 1 || team.players.length > 14) throw new Error("CBS scoring-preview capture received invalid roster context.");
    playerCount += team.players.length;
    return {
      name: team.name,
      players: team.players.map((player) => ({
        cbsPlayerId: String(player?.cbsPlayerId || ""),
        name: String(player?.name || ""),
      })),
    };
  });
  if (playerCount < 96 || teams.some((team) => team.players.some((player) => !/^\d{1,10}$/.test(player.cbsPlayerId) || player.name.length < 2 || player.name.length > 80))) throw new Error("CBS scoring-preview capture received unsafe player coverage.");
  return teams;
}

async function captureCbsPreviewStage(week, teams) {
  const safeTeams = previewTeams(teams);
  return withTemporaryCbsTab(`${CBS_ORIGIN}/scoring/live/${week}/`, (tabId) => captureCbsScoringPreviewRaw(tabId, week, safeTeams));
}

async function captureCbsPosition(week, position) {
  if (!POSITIONS.includes(position)) throw new Error("CBS projection capture requested an invalid position.");
  let tabId = null;
  try {
    const reportUrl = `${CBS_ORIGIN}/stats/stats-main/all:${position}/${week}:p/standard/projections`;
    const tab = await chrome.tabs.create({ url: reportUrl, active: false });
    tabId = tab.id;
    const rows = await rawProjectionTable(tabId, position, week);
    if (!rows.length) throw new Error(`CBS returned no ${position} projection rows.`);
    return { position, rows };
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

async function fbgSubscriberState(tabId, week) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (expectedWeek) => {
      const body = document.body?.innerText || "";
      const download = document.querySelector(`a[href$="/projections/download/weekly/all/2026/${expectedWeek}"]`);
      const selectedOptions = [...document.querySelectorAll("select option:checked")]
        .map((option) => option.textContent?.trim() || "")
        .filter(Boolean);
      const league = selectedOptions.find((value) => value === "Thunder Bowl") || selectedOptions[0] || "";
      const fullPlayerRows = [...document.querySelectorAll("table tbody tr")]
        .filter((row) => row.querySelector('a[href*="/player/"]')).length;
      return {
        locked: /Unlock the rest of the projections with a PRO subscription/i.test(body),
        accountLeague: league,
        fullPlayerRows,
        downloadUrl: download?.href || "",
        heading: document.querySelector("h1")?.textContent?.trim() || "",
      };
    },
    args: [week],
  });
  return results[0]?.result || null;
}

async function waitForFbgSubscriberContent(tabId, pageUrl, week, timeoutMs = PAGE_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error("Footballguys tab closed before capture completed.");
    }
    const currentUrl = tab.url || tab.pendingUrl || "";
    const isExpectedPage = (() => {
      try {
        const current = new URL(currentUrl);
        return current.origin === FBG_ORIGIN
          && current.pathname === "/projections/duration/weekly"
          && current.searchParams.get("week") === String(week)
          && current.searchParams.get("pos") === "qb";
      } catch {
        return false;
      }
    })();
    if (isExpectedPage) {
      try {
        const state = await fbgSubscriberState(tabId, week);
        if (state?.locked) throw new Error("Footballguys is showing the free preview. Sign into your PRO account in this browser, then retry.");
        if (state?.accountLeague === "Thunder Bowl" && state.fullPlayerRows >= 20 && state.downloadUrl) return state;
        if (tab.status === "complete" && state?.heading && state.accountLeague !== "Thunder Bowl") {
          throw new Error("Footballguys is signed in, but the Thunder Bowl league is not selected or available in this account.");
        }
      } catch (error) {
        if (/free preview|Thunder Bowl league/.test(error?.message || "")) throw error;
        // Edge can briefly reject script injection while the application renders.
      }
    } else if (currentUrl && currentUrl !== "about:blank" && tab.status === "complete") {
      throw new Error("Footballguys redirected away from the weekly projections. Sign into your PRO account in this browser, then retry.");
    }
    await delay(PAGE_POLL_INTERVAL_MS);
  }
  throw new Error("Footballguys member projections did not become ready within 30 seconds. Keep your Footballguys sign-in open in this browser, then retry.");
}

async function captureFbgProjections(week) {
  const pageUrl = `${FBG_ORIGIN}/projections/duration/weekly?week=${week}&pos=qb`;
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: pageUrl, active: false });
    tabId = tab.id;
    const state = await waitForFbgSubscriberContent(tabId, pageUrl, week);
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (downloadUrl) => {
        const response = await fetch(downloadUrl, { credentials: "include", cache: "no-store", headers: { Accept: "text/csv,application/octet-stream;q=0.9" } });
        return {
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get("content-type") || "",
          providerAsOf: response.headers.get("last-modified") || response.headers.get("date") || new Date().toISOString(),
          csv: await response.text(),
        };
      },
      args: [state.downloadUrl],
    });
    const download = results[0]?.result;
    if (!download?.ok) throw new Error(`Footballguys member download returned HTTP ${download?.status || "unknown"}.`);
    if (typeof download.csv !== "string" || download.csv.length > 2_000_000 || !download.csv.replace(/^\uFEFF/, "").startsWith("id,name,pos,team,set-id,")) {
      throw new Error("Footballguys member download was not the expected component-stat CSV.");
    }
    return {
      schemaVersion: 1,
      source: FBG_CAPTURE_SOURCE,
      modelEffect: "none",
      authenticated: true,
      accountLeague: state.accountLeague,
      capturedAt: new Date().toISOString(),
      providerAsOf: download.providerAsOf,
      season: 2026,
      week,
      pageUrl,
      downloadUrl: state.downloadUrl,
      csv: download.csv,
    };
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

const FANTASYPROS_POSITIONS = Object.freeze(["qb", "rb", "wr", "te", "k", "dst"]);
const FANTASYPROS_HEADERS = Object.freeze({
  qb: ["PLAYER", "ATT", "CMP", "YDS", "TDS", "INTS", "ATT", "YDS", "TDS", "FL", "FPTS"],
  rb: ["PLAYER", "ATT", "YDS", "TDS", "REC", "YDS", "TDS", "FL", "FPTS"],
  wr: ["PLAYER", "REC", "YDS", "TDS", "ATT", "YDS", "TDS", "FL", "FPTS"],
  te: ["PLAYER", "REC", "YDS", "TDS", "FL", "FPTS"],
  k: ["PLAYER", "FG", "FGA", "XPT", "FPTS"],
  dst: ["PLAYER", "SACK", "INT", "FR", "FF", "TD", "SAFETY", "PA", "YDS AGN", "FPTS"],
});

async function fantasyProsPageState(tabId, position, week) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (expectedPosition, expectedWeek) => {
      const table = document.querySelector("table#data");
      const selected = [...document.querySelectorAll("select option:checked")].map((option) => option.textContent?.trim() || "").filter(Boolean);
      return {
        accountLeague: selected.find((value) => value === "Thunder Bowl") || "",
        heading: document.querySelector("h1")?.textContent?.trim() || "",
        providerTime: document.querySelector("h2 time")?.getAttribute("datetime") || "",
        headers: table ? [...table.querySelectorAll("thead tr:last-child th")].map((cell) => (cell.innerText || cell.textContent || "").trim()) : [],
        rowCount: table?.querySelectorAll("tbody tr").length || 0,
        pageMatches: location.pathname === `/nfl/projections/${expectedPosition}.php` && new URLSearchParams(location.search).get("week") === String(expectedWeek),
      };
    },
    args: [position, week],
  });
  return results[0]?.result || null;
}

async function waitForFantasyProsContent(tabId, position, week, timeoutMs = PAGE_READY_TIMEOUT_MS) {
  const pageUrl = `${FANTASYPROS_ORIGIN}/nfl/projections/${position}.php?week=${week}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error("FantasyPros tab closed before capture completed.");
    }
    const currentUrl = tab.url || tab.pendingUrl || "";
    if (currentUrl.startsWith(`${FANTASYPROS_ORIGIN}/nfl/projections/`)) {
      try {
        const state = await fantasyProsPageState(tabId, position, week);
        if (state?.pageMatches && state.accountLeague === "Thunder Bowl" && state.rowCount >= (position === "k" || position === "dst" ? 30 : 50) && state.headers.join("|") === FANTASYPROS_HEADERS[position].join("|")) return state;
        if (tab.status === "complete" && state?.heading && state.accountLeague !== "Thunder Bowl") throw new Error("FantasyPros is signed in, but the Thunder Bowl league is not selected or available in this account.");
      } catch (error) {
        if (/Thunder Bowl league/.test(error?.message || "")) throw error;
      }
    } else if (currentUrl && currentUrl !== "about:blank" && tab.status === "complete") {
      throw new Error("FantasyPros redirected away from the weekly projections. Sign into FantasyPros in this browser, then retry.");
    }
    await delay(PAGE_POLL_INTERVAL_MS);
  }
  throw new Error(`FantasyPros ${position.toUpperCase()} Week ${week} projections did not become ready within 30 seconds.`);
}

async function rawFantasyProsTable(tabId, position) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (expectedPosition) => {
      const table = document.querySelector("table#data");
      if (!table) return null;
      const headers = [...table.querySelectorAll("thead tr:last-child th")].map((cell) => (cell.innerText || cell.textContent || "").trim());
      const rows = [...table.querySelectorAll("tbody tr")].map((row) => {
        const cells = [...row.querySelectorAll("td")];
        const identity = cells[0];
        const link = identity?.querySelector("a.fp-player-link, a.player-name");
        const playerName = link?.getAttribute("fp-player-name")?.trim() || link?.textContent?.trim() || "";
        const identityText = (identity?.innerText || identity?.textContent || "").replace(/\s+/g, " ").trim();
        const teamText = identityText.startsWith(playerName) ? identityText.slice(playerName.length).trim() : "";
        return {
          providerId: (link?.className || "").match(/\bfp-id-(\d+)\b/)?.[1] || "",
          providerUrl: link?.href || "",
          playerName,
          nflTeam: expectedPosition === "dst" ? "" : teamText.split(/\s+/).at(-1) || "",
          position: expectedPosition === "dst" ? "DST" : expectedPosition.toUpperCase(),
          cells: cells.slice(1).map((cell) => (cell.innerText || cell.textContent || "").replace(/,/g, "").trim()),
        };
      }).filter((row) => row.providerId && row.playerName);
      return { headers, rows };
    },
    args: [position],
  });
  return results[0]?.result || null;
}

function fantasyProsProviderTime(value) {
  const normalized = String(value || "").trim().replace(" ", "T");
  const parsed = Date.parse(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

async function captureFantasyProsProjections(week) {
  const pageUrl = `${FANTASYPROS_ORIGIN}/nfl/projections/qb.php?week=${week}`;
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: pageUrl, active: false });
    tabId = tab.id;
    const rows = [];
    const tables = [];
    let providerAsOf = null;
    for (const position of FANTASYPROS_POSITIONS) {
      const targetUrl = `${FANTASYPROS_ORIGIN}/nfl/projections/${position}.php?week=${week}`;
      if (position !== "qb") await chrome.tabs.update(tabId, { url: targetUrl, active: false });
      const state = await waitForFantasyProsContent(tabId, position, week);
      const table = await rawFantasyProsTable(tabId, position);
      if (!table || table.headers.join("|") !== FANTASYPROS_HEADERS[position].join("|") || table.rows.length !== state.rowCount) throw new Error(`FantasyPros ${position.toUpperCase()} table changed while it was being captured.`);
      providerAsOf = providerAsOf || fantasyProsProviderTime(state.providerTime);
      tables.push({ position: position === "dst" ? "DST" : position.toUpperCase(), headers: table.headers, rowCount: table.rows.length });
      rows.push(...table.rows);
    }
    if (rows.length < 400 || rows.length > 800) throw new Error(`FantasyPros returned unsafe weekly coverage (${rows.length} rows).`);
    return {
      schemaVersion: 1,
      provider: "fantasyPros",
      source: FANTASYPROS_CAPTURE_SOURCE,
      modelEffect: "none",
      authenticated: true,
      accountLeague: "Thunder Bowl",
      capturedAt: new Date().toISOString(),
      providerAsOf: providerAsOf || new Date().toISOString(),
      season: 2026,
      week,
      pageUrl,
      tables,
      rows,
    };
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

async function waitForPffContent(tabId, timeoutMs = PAGE_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error("PFF tab closed before capture completed.");
    }
    const currentUrl = tab.url || tab.pendingUrl || "";
    if (currentUrl.startsWith(`${PFF_ORIGIN}/fantasy/projections`)) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const text = (node) => (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
            const rows = [...document.querySelectorAll('main [role="row"]')];
            return {
              heading: text(document.querySelector("main h1, h1")),
              playerLinkCount: document.querySelectorAll('main a[href*="/nfl/players/"]').length,
              identityRowCount: rows.filter((row) => row.querySelector('a[href*="/nfl/players/"]')).length,
              statRowCount: rows.filter((row) => row.querySelectorAll('[role="gridcell"]').length >= 15).length,
              columnLabels: [...document.querySelectorAll('main [role="columnheader"], main th')].map(text),
            };
          },
        });
        const state = results[0]?.result;
        if (pffProjectionTableReady(state)) return;
      } catch (error) {
        if (/tab closed/.test(error?.message || "")) throw error;
      }
    } else if (currentUrl && currentUrl !== "about:blank" && tab.status === "complete") {
      throw new Error("PFF redirected away from the fantasy projections. Sign into PFF in this browser, then retry.");
    }
    await delay(PAGE_POLL_INTERVAL_MS);
  }
  throw new Error("PFF projection rows did not become ready within 30 seconds. Keep the PFF projections page open, then retry.");
}

async function rawPffWeeklyTables(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      try {
      const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const text = (node) => (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
      const visible = (node) => Boolean(node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length));
      async function waitFor(check, message, timeoutMs = 15_000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = check();
          if (value) return value;
          await pause(100);
        }
        throw new Error(message);
      }
      const buttons = () => [...document.querySelectorAll("main button")];
      // PFF keeps all Kyber dropdown choices mounted even when their menu is
      // visually closed. Using the mounted option avoids background-tab click
      // behavior preventing the menu animation from becoming visible.
      const exactLabels = (label) => [...document.querySelectorAll("main label.kyber-dropdown-option__checkbox")].filter((node) => text(node).toLowerCase() === label.toLowerCase());
      async function openFilters() {
        const filter = buttons().find((button) => text(button) === "Filters");
        if (!filter) throw new Error("PFF Filters control is missing.");
        if (!buttons().some((button) => /^Timeframe/i.test(text(button)) && visible(button))) filter.click();
        await waitFor(() => buttons().find((button) => /^Timeframe/i.test(text(button)) && visible(button)), "PFF timeframe control did not open.");
      }
      async function choose(toggleLabel, optionLabel) {
        const findToggle = () => buttons().find((button) => new RegExp(`^${toggleLabel}`, "i").test(text(button)) && visible(button));
        const toggle = await waitFor(findToggle, `PFF ${toggleLabel} control is missing.`);
        // PFF replaces the dropdown button after a selection. Re-read it while
        // waiting instead of checking the detached pre-selection React node.
        const selected = () => text(findToggle()).replace(new RegExp(`^${toggleLabel}\\s*`, "i"), "").trim().toLowerCase();
        if (selected() === optionLabel.toLowerCase()) return;
        toggle.click();
        const option = await waitFor(() => exactLabels(optionLabel)[0], `PFF ${optionLabel} choice is missing.`);
        option.click();
        await waitFor(() => selected() === optionLabel.toLowerCase(), `PFF did not select ${optionLabel}.`);
        await pause(350);
      }
      async function setPageSize() {
        const inputs = [...document.querySelectorAll('main input[type="checkbox"]')]
          .filter((node) => /^\d+$/.test(node.value || ""))
          .sort((left, right) => Number(right.value) - Number(left.value));
        const input = inputs[0];
        if (input && !input.checked) {
          (input.closest("label") || input).click();
          await pause(500);
        }
      }
      function currentRows(kind) {
        const all = [...document.querySelectorAll('main .kyber-table-body [role="row"]')];
        const linkSelector = kind === "offense" ? 'a[href*="/nfl/players/"]' : 'a[href*="/nfl/teams/"]';
        const identities = all.filter((row) => row.querySelectorAll('[role="gridcell"]').length === 2 && row.querySelector(linkSelector));
        const expectedCells = kind === "offense" ? 15 : 20;
        const stats = all.filter((row) => row.querySelectorAll('[role="gridcell"]').length === expectedCells && text(row));
        if (!identities.length || identities.length !== stats.length) throw new Error(`PFF ${kind} player and stat rows did not reconcile.`);
        return identities.map((identity, index) => {
          const identityCells = [...identity.querySelectorAll('[role="gridcell"]')];
          const link = identity.querySelector(linkSelector);
          const providerUrl = link?.href || "";
          const providerId = (link?.getAttribute("href") || "").match(/\/(\d+)(?:[/?#]|$)/)?.[1] || "";
          const cells = [...stats[index].querySelectorAll('[role="gridcell"]')].map((cell) => text(cell).replace(/,/g, ""));
          return {
            kind,
            rank: Number(text(identityCells[0])),
            providerId,
            providerUrl,
            playerName: text(link),
            cells,
            rowKey: providerId || `${text(link)}|${cells[0] || ""}|${cells[1] || kind}`,
          };
        });
      }
      async function capturePages(kind) {
        await setPageSize();
        for (let page = 0; page < 20; page += 1) {
          const previous = buttons().find((button) => /kyber-table-pagination__button-prev/.test(button.className));
          if (!previous || previous.disabled || /--disabled/.test(previous.className)) break;
          previous.click();
          await pause(400);
        }
        await waitFor(() => {
          try { return currentRows(kind); } catch { return null; }
        }, `PFF ${kind} table did not become stable.`);
        const captured = [];
        const seen = new Set();
        for (let page = 0; page < 20; page += 1) {
          const pageRows = await waitFor(() => {
            try { return currentRows(kind); } catch { return null; }
          }, `PFF ${kind} table did not become stable.`);
          const firstKey = pageRows[0]?.rowKey;
          for (const row of pageRows) {
            if (!row.rowKey || seen.has(row.rowKey)) continue;
            seen.add(row.rowKey);
            captured.push(row);
          }
          const next = buttons().find((button) => /kyber-table-pagination__button-next/.test(button.className));
          if (!next || next.disabled || /--disabled/.test(next.className)) break;
          next.click();
          await waitFor(() => {
            try { return currentRows(kind)[0]?.rowKey !== firstKey; } catch { return false; }
          }, `PFF ${kind} pagination did not advance.`);
        }
        return captured;
      }

      const projectionRows = [...document.querySelectorAll('main [role="row"]')];
      const projectionViewReady = (
        text(document.querySelector("main h1, h1")).toUpperCase() === "FANTASY FOOTBALL PROJECTIONS"
        && projectionRows.filter((row) => row.querySelector('a[href*="/nfl/players/"]')).length >= 20
        && projectionRows.filter((row) => row.querySelectorAll('[role="gridcell"]').length >= 15).length >= 20
      );
      if (!projectionViewReady) throw new Error("PFF projection rows are not available on the loaded page.");
      await openFilters();
      await choose("Timeframe", "This Week");
      await choose("Positions", "Offense");
      await waitFor(() => [...document.querySelectorAll('main [role="columnheader"]')].some((cell) => text(cell).toLowerCase() === "rec"), "PFF offense component columns did not load.");
      const offenseRows = await capturePages("offense");
      await choose("Positions", "DST");
      await waitFor(() => [...document.querySelectorAll('main [role="columnheader"]')].some((cell) => text(cell).toLowerCase() === "sack"), "PFF DST component columns did not load.");
      const dstRows = await capturePages("dst");
      return {
        offenseHeaders: ["TEAM", "POS", "BYE", "OPP", "PTS", "PASS_YDS", "PASS_TD", "PASS_INT", "RUSH_YDS", "RUSH_TD", "REC", "REC_YDS", "REC_TD", "FG", "XP"],
        dstHeaders: ["TEAM", "POS", "BYE", "OPP", "PTS", "SACK", "SFT", "INT", "FF", "FR", "TD", "RETURN_YDS", "RETURN_TD", "PA_0", "PA_1_6", "PA_7_13", "PA_14_20", "PA_21_27", "PA_28_34", "PA_35_PLUS"],
        rows: [...offenseRows, ...dstRows],
      };
      } catch (error) {
        return {
          captureError: error?.message || String(error),
          captureStage: {
            url: location.href,
            buttons: [...document.querySelectorAll("main button")].map((button) => (button.innerText || button.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 20),
            options: [...document.querySelectorAll("main label.kyber-dropdown-option__checkbox")].map((label) => (label.innerText || label.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40),
            rowCellCounts: [...new Set([...document.querySelectorAll('main .kyber-table-body [role="row"]')].map((row) => row.querySelectorAll('[role="gridcell"]').length))],
          },
        };
      }
    },
  });
  const injection = results[0];
  if (injection?.result?.captureError) {
    const stage = injection.result.captureStage || {};
    throw new Error(`PFF capture stopped: ${injection.result.captureError} [${stage.url || "unknown page"}; cells ${(stage.rowCellCounts || []).join(",") || "none"}; options ${(stage.options || []).join("|") || "none"}]`);
  }
  if (!injection?.result) {
    const detail = injection?.error?.message || String(injection?.error || "").trim();
    throw new Error(detail ? `PFF capture stopped: ${detail}` : "PFF capture script returned no data.");
  }
  return injection.result;
}

async function capturePffProjections(week) {
  const pageUrl = `${PFF_ORIGIN}/fantasy/projections`;
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: pageUrl, active: false });
    tabId = tab.id;
    await waitForPffContent(tabId);
    const capturedAt = new Date().toISOString();
    const table = await rawPffWeeklyTables(tabId);
    if (!table || table.rows.length < 200 || table.rows.length > 800 || !table.rows.some((row) => row.kind === "dst")) throw new Error(`PFF returned unsafe weekly coverage (${table?.rows?.length || 0} rows).`);
    return {
      schemaVersion: 1,
      provider: "pff",
      source: PFF_CAPTURE_SOURCE,
      modelEffect: "none",
      authenticated: true,
      accountStatus: "signed-in",
      capturedAt,
      providerAsOf: capturedAt,
      season: 2026,
      week,
      pageUrl,
      offenseHeaders: table.offenseHeaders,
      dstHeaders: table.dstHeaders,
      rows: table.rows,
    };
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const origin = (() => { try { return new URL(sender.url).origin; } catch { return ""; } })();
  if (ALLOWED_APP_ORIGINS.has(origin) && message?.action === "helper-version") {
    sendResponse({ ok: true, helperVersion: HELPER_VERSION });
    return false;
  }
  const allowedActions = ["capture-draft-day-cbs-setup", "capture-cbs-roster-base", "capture-cbs-schedule", "capture-cbs-fab", "capture-cbs-preview", "capture-cbs-position", "capture-fbg-projections", "capture-fantasypros-projections", "capture-pff-projections"];
  if (!ALLOWED_APP_ORIGINS.has(origin) || !allowedActions.includes(message?.action) || message?.expectedHelperVersion !== HELPER_VERSION) return false;
  const week = Number(message.week);
  if (message.action !== "capture-draft-day-cbs-setup" && (!Number.isSafeInteger(week) || week < 1 || week > 18)) {
    sendResponse({ ok: false, error: "The In-Season GM requested an invalid NFL week." });
    return false;
  }
  const position = String(message.position || "").toUpperCase();
  const task = message.action === "capture-draft-day-cbs-setup"
    ? captureDraftDayCbsSetup()
    : message.action === "capture-cbs-roster-base"
    ? captureCbsRosterBase(week)
    : message.action === "capture-cbs-schedule"
      ? captureCbsScheduleStage()
      : message.action === "capture-cbs-fab"
        ? captureCbsFabStage(week)
        : message.action === "capture-cbs-preview"
          ? captureCbsPreviewStage(week, message.teams)
    : message.action === "capture-cbs-position"
      ? captureCbsPosition(week, position)
      : message.action === "capture-fbg-projections"
    ? captureFbgProjections(week)
    : message.action === "capture-fantasypros-projections"
      ? captureFantasyProsProjections(week)
      : message.action === "capture-pff-projections"
        ? capturePffProjections(week)
        : Promise.reject(new Error("The helper received an unsupported capture action."));
  task
    .then((value) => {
      if (message.action === "capture-draft-day-cbs-setup") sendResponse({ ok: true, helperVersion: HELPER_VERSION, setup: value });
      else if (message.action === "capture-cbs-roster-base") sendResponse({ ok: true, helperVersion: HELPER_VERSION, snapshot: value });
      else if (message.action === "capture-cbs-schedule") sendResponse({ ok: true, helperVersion: HELPER_VERSION, rawLeagueSchedule: value });
      else if (message.action === "capture-cbs-fab") sendResponse({ ok: true, helperVersion: HELPER_VERSION, fabState: value });
      else if (message.action === "capture-cbs-preview") sendResponse({ ok: true, helperVersion: HELPER_VERSION, rawScoringPreview: value });
      else if (message.action === "capture-cbs-position") sendResponse({ ok: true, helperVersion: HELPER_VERSION, position: value.position, rows: value.rows });
      else sendResponse({ ok: true, helperVersion: HELPER_VERSION, capture: value });
    })
    .catch((error) => sendResponse({ ok: false, helperVersion: HELPER_VERSION, error: error instanceof Error ? error.message : "The requested capture failed safely." }));
  return true;
});
