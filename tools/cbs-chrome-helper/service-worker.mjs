import { normalizeCbsTeamRows } from "./cbs-normalize.mjs";

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
const ALLOWED_APP_ORIGINS = new Set(["https://pipsprojects.com", "http://localhost:8888"]);

function waitForTab(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("CBS page timed out while loading.")), timeoutMs);
    function finish(error) {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (error) reject(error); else resolve();
    }
    function onUpdated(updatedId, changeInfo) {
      if (updatedId === tabId && changeInfo.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch(() => finish(new Error("CBS tab closed before capture completed.")));
  });
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

async function captureRosters() {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: REPORT_URL, active: false });
    tabId = tab.id;
    await waitForTab(tabId);
    const page = await chrome.tabs.get(tabId);
    if (!page.url?.startsWith(REPORT_URL)) throw new Error("CBS redirected to sign-in. Sign in to the Thunder Bowl league in Chrome, then retry.");
    const reportTables = await rawRosterTables(tabId);
    const byTeam = new Map(reportTables.map((table) => [table.teamName, table.rows]));
    const missing = TEAMS.filter((team) => !byTeam.has(team.name));
    if (missing.length) throw new Error(`CBS roster report is missing ${missing.map((team) => team.name).join(", ")}.`);
    const teams = TEAMS.map((team) => normalizeCbsTeamRows(team, byTeam.get(team.name)));
    const playerCount = teams.reduce((sum, team) => sum + team.players.length, 0);
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
    };
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const origin = (() => { try { return new URL(sender.url).origin; } catch { return ""; } })();
  if (!ALLOWED_APP_ORIGINS.has(origin) || message?.action !== "capture-cbs-rosters") return false;
  captureRosters()
    .then((snapshot) => sendResponse({ ok: true, snapshot }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "CBS capture failed safely." }));
  return true;
});
