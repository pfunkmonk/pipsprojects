import { normalizeCbsProjectionRows, normalizeCbsTeamRows } from "./cbs-normalize.mjs";

const TEAMS = [
  ["angry-face", 1, "Angry Face"], ["orange-crush", 2, "Orange Crush"],
  ["big-head", 3, "Big Head"], ["dogs-of-war", 4, "Dogs of War"],
  ["t-dogs", 5, "T-Dogs"], ["super-suckers", 6, "Super Suckers"],
  ["three-amigos", 7, "Three Amigos"], ["goon-skwad", 8, "Goon Skwad"],
  ["el-guapo", 9, "El Guapo"], ["crime-and-punishment", 10, "Crime and Punishment"],
  ["the-hobbits", 11, "The Hobbits"], ["the-bungles", 12, "The Bungles"],
].map(([teamId, cbsTeamId, name]) => ({ teamId, cbsTeamId, name }));

const CBS_ORIGIN = "https://berrymvp.football.cbssports.com";
const REPORT_URL = `${CBS_ORIGIN}/teams/roster-report/all/2026/`;
const FBG_ORIGIN = "https://www.footballguys.com";
const FBG_CAPTURE_SOURCE = "Footballguys authenticated weekly projections download";
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
const ALLOWED_APP_ORIGINS = new Set(["https://pipsprojects.com", "http://localhost:8888"]);
const PAGE_READY_TIMEOUT_MS = 30_000;
const PAGE_POLL_INTERVAL_MS = 250;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function cbsPageHasContent(tabId, pageKind) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (kind) => {
      const tables = [...document.querySelectorAll("table")];
      if (kind === "roster") {
        const teamTableCount = tables.filter((table) => /\sPlayers$/.test((table.querySelector("tr")?.innerText || "").replace(/\s+/g, " ").trim())).length;
        return teamTableCount >= 12;
      }
      const projectionTable = tables.find((table) => /\bFPTS\b/.test(table.innerText || ""));
      return Boolean(projectionTable?.querySelector('a.playerLink[href*="/players/playerpage/"]'));
    },
    args: [pageKind],
  });
  return results[0]?.result === true;
}

async function waitForCbsContent(tabId, expectedUrlPrefix, pageKind, label, timeoutMs = PAGE_READY_TIMEOUT_MS) {
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
    if (pageUrl.startsWith(expectedUrlPrefix)) {
      sawExpectedPage = true;
      try {
        if (await cbsPageHasContent(tabId, pageKind)) return;
      } catch {
        // Edge can briefly reject script injection between navigation commits.
      }
    } else if (sawExpectedPage || (Date.now() - startedAt > 1_500 && pageUrl && pageUrl !== "about:blank" && !pageUrl.startsWith(CBS_ORIGIN) && tab.status === "complete")) {
      throw new Error(`CBS redirected away from the ${label}. Sign in to Thunder Bowl on CBS in this browser, then retry.`);
    }
    await delay(PAGE_POLL_INTERVAL_MS);
  }
  throw new Error(`CBS ${label} did not become ready within ${Math.round(timeoutMs / 1000)} seconds. Keep the CBS sign-in open in this browser, then retry.`);
}

async function rawRosterTables(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => [...document.querySelectorAll("table")].map((table) => {
      const heading = (table.querySelector("tr")?.innerText || "").replace(/\s+/g, " ").trim();
      const teamName = heading.match(/^(.+?)\s+Players$/)?.[1] || "";
      const rows = [...table.querySelectorAll("tr")].map((row) => {
        const playerLink = [...row.querySelectorAll("a[href]")].find((link) => /playerpage|\/players\/\d+/i.test(link.getAttribute("href") || ""));
        const id = (playerLink?.getAttribute("href") || "").match(/(?:playerpage\/|players\/)(\d+)/i)?.[1] || "";
        return {
          cbsPlayerId: id,
          name: (playerLink?.textContent || "").trim(),
          cells: [...row.querySelectorAll("th,td")].map((cell) => (cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim()),
          newsTitles: [...row.querySelectorAll("[title]")].map((element) => element.getAttribute("title")).filter(Boolean),
          markerClasses: [...row.querySelectorAll("[class]")].flatMap((element) => [...element.classList]).filter((name) => /inj|status|question|doubt|out|ir|pup/i.test(name)),
        };
      });
      return { teamName, rows };
    }).filter((table) => table.teamName),
  });
  return results[0]?.result || [];
}

async function rawProjectionTable(tabId, position, week) {
  const reportUrl = `${CBS_ORIGIN}/stats/stats-main/all:${position}/${week}:p/standard/projections`;
  await chrome.tabs.update(tabId, { url: reportUrl, active: false });
  await waitForCbsContent(tabId, reportUrl, "projection", `${position} projection table`);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (expectedPosition) => {
      const table = [...document.querySelectorAll("table")].find((node) => /FPTS/.test(node.innerText || ""));
      if (!table) return [];
      return [...table.querySelectorAll("tr")].map((row) => {
        const link = row.querySelector('a.playerLink[href*="/players/playerpage/"]');
        const id = (link?.getAttribute("href") || "").match(/playerpage\/(\d+)/)?.[1] || "";
        const identity = link?.getAttribute("aria-label") || "";
        const identityMatch = identity.match(/\s(QB|RB|WR|TE|K|DST)\s+([A-Z]{2,3})\s*$/i);
        return {
          cbsPlayerId: id,
          name: (link?.textContent || "").trim(),
          nflTeam: identityMatch?.[1]?.toUpperCase() === expectedPosition ? identityMatch[2].toUpperCase() : "",
          cells: [...row.querySelectorAll("th,td")].map((cell) => (cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim()),
        };
      });
    },
    args: [position],
  });
  return normalizeCbsProjectionRows(position, results[0]?.result || [], week);
}

async function captureRosters(week) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: REPORT_URL, active: false });
    tabId = tab.id;
    await waitForCbsContent(tabId, REPORT_URL, "roster", "all-team roster report");
    const reportTables = await rawRosterTables(tabId);
    const byTeam = new Map(reportTables.map((table) => [table.teamName, table.rows]));
    const missing = TEAMS.filter((team) => !byTeam.has(team.name));
    if (missing.length) throw new Error(`CBS roster report is missing ${missing.map((team) => team.name).join(", ")}.`);
    const teams = TEAMS.map((team) => normalizeCbsTeamRows(team, byTeam.get(team.name)));
    const playerCount = teams.reduce((sum, team) => sum + team.players.length, 0);
    const weeklyProjections = [];
    for (const position of POSITIONS) weeklyProjections.push(...await rawProjectionTable(tabId, position, week));
    return {
      schemaVersion: 1,
      source: "CBS Sports authenticated Thunder Bowl all-team roster report",
      modelEffect: "none",
      capturedAt: new Date().toISOString(),
      season: 2026,
      pageUrl: REPORT_URL,
      teamCount: teams.length,
      playerCount,
      teams,
      projectionWeek: week,
      projectionCount: weeklyProjections.length,
      weeklyProjections,
    };
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const origin = (() => { try { return new URL(sender.url).origin; } catch { return ""; } })();
  if (!ALLOWED_APP_ORIGINS.has(origin) || !["capture-cbs-rosters", "capture-fbg-projections"].includes(message?.action)) return false;
  const week = Number(message.week);
  if (!Number.isSafeInteger(week) || week < 1 || week > 18) {
    sendResponse({ ok: false, error: "The In-Season GM requested an invalid NFL week." });
    return false;
  }
  const task = message.action === "capture-fbg-projections" ? captureFbgProjections(week) : captureRosters(week);
  task
    .then((value) => sendResponse(message.action === "capture-fbg-projections" ? { ok: true, capture: value } : { ok: true, snapshot: value }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "CBS capture failed safely." }));
  return true;
});
