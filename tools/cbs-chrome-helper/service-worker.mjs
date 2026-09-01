import { normalizeCbsProjectionRows, normalizeCbsTeamRows } from "./cbs-normalize.mjs";
import { normalizeCbsFabPages } from "./cbs-fab-normalize.mjs";

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
const FANTASYPROS_ORIGIN = "https://www.fantasypros.com";
const FANTASYPROS_CAPTURE_SOURCE = "FantasyPros authenticated weekly component projections capture";
const PFF_ORIGIN = "https://www.pff.com";
const PFF_CAPTURE_SOURCE = "PFF authenticated weekly component projections capture";
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

async function captureCbsFabPages(tabId, week) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (expectedWeek, cbsOrigin) => {
      const relevant = /fab|waiver|claim|transaction|standings|rules|settings|add-drop/i;
      const paths = [
        "/", "/rules", "/settings", "/standings", "/transactions", "/transactions/add-drop",
        "/transactions/waivers", "/transactions/fab", "/transactions/fab-budget",
        "/transactions/fab-order", "/transactions/report",
      ];
      const queue = new Set(paths.map((path) => new URL(path, cbsOrigin).href));
      for (const link of document.querySelectorAll("a[href]")) {
        try {
          const url = new URL(link.href, location.href);
          if (url.origin === cbsOrigin && relevant.test(`${link.textContent || ""} ${url.pathname}`)) queue.add(url.href);
        } catch {
          // Ignore malformed navigation links.
        }
      }
      async function fetchPage(requestedUrl) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8_000);
          const response = await fetch(requestedUrl, { credentials: "include", cache: "no-store", signal: controller.signal, headers: { Accept: "text/html" } });
          clearTimeout(timeout);
          if (!response.ok || new URL(response.url).origin !== cbsOrigin) return null;
          const html = await response.text();
          if (html.length < 500 || html.length > 3_000_000) return null;
          const documentCopy = new DOMParser().parseFromString(html, "text/html");
          const text = (documentCopy.body?.innerText || documentCopy.body?.textContent || "").replace(/\s+/g, " ").trim();
          if (/sign in to continue|forgot your password/i.test(text) && !/Angry Face|Dogs of War|Orange Crush/.test(text)) return null;
          const tables = [...documentCopy.querySelectorAll("table")].map((table) => {
            const headerRow = table.querySelector("thead tr:last-child") || table.querySelector("tr");
            const headers = [...(headerRow?.querySelectorAll("th,td") || [])].map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim());
            const rows = [...table.querySelectorAll("tbody tr, tr")]
              .filter((row) => row !== headerRow)
              .map((row) => [...row.querySelectorAll("th,td")].map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim()))
              .filter((row) => row.length);
            return { headers, rows };
          }).filter((table) => table.rows.length);
          if (!relevant.test(`${documentCopy.title || ""} ${response.url} ${text}`) && !/Angry Face|Dogs of War|Orange Crush/.test(text)) return null;
          const discovered = [];
          for (const link of documentCopy.querySelectorAll("a[href]")) {
            try {
              const url = new URL(link.href, response.url);
              if (url.origin === cbsOrigin && relevant.test(`${link.textContent || ""} ${url.pathname}`)) discovered.push(url.href);
            } catch {
              // Ignore malformed navigation links.
            }
          }
          return { page: { url: response.url, title: documentCopy.title || "", text: text.slice(0, 200_000), tables }, discovered };
        } catch {
          // A missing optional CBS report must not discard roster/projection data.
          return null;
        }
      }
      const pages = [];
      const visited = new Set();
      for (let round = 0; round < 2; round += 1) {
        const batch = [...queue].filter((url) => !visited.has(url)).slice(0, 24);
        if (!batch.length) break;
        batch.forEach((url) => visited.add(url));
        const captured = await Promise.all(batch.map(fetchPage));
        for (const result of captured.filter(Boolean)) {
          pages.push(result.page);
          for (const url of result.discovered) if (queue.size < 40) queue.add(url);
        }
      }
      return { week: expectedWeek, pages };
    },
    args: [week, CBS_ORIGIN],
  });
  return normalizeCbsFabPages(results[0]?.result?.pages || [], week, new Date().toISOString());
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
    const fabState = await captureCbsFabPages(tabId, week);
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
      fabState,
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
          func: () => ({
            signedIn: [...document.querySelectorAll("a")].some((link) => (link.textContent || "").trim() === "Sign out"),
            heading: document.querySelector("main h1, h1")?.textContent?.trim() || "",
            hasGrid: Boolean(document.querySelector('main [role="grid"]')),
          }),
        });
        const state = results[0]?.result;
        if (state?.signedIn && state.heading === "Fantasy Football Projections" && state.hasGrid) return;
        if (tab.status === "complete" && state?.heading && !state.signedIn) throw new Error("PFF is not signed in in this browser. Sign into PFF, then retry.");
      } catch (error) {
        if (/not signed in/.test(error?.message || "")) throw error;
      }
    } else if (currentUrl && currentUrl !== "about:blank" && tab.status === "complete") {
      throw new Error("PFF redirected away from the fantasy projections. Sign into PFF in this browser, then retry.");
    }
    await delay(PAGE_POLL_INTERVAL_MS);
  }
  throw new Error("PFF projections did not become ready within 30 seconds.");
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

      if (![...document.querySelectorAll("a")].some((link) => text(link) === "Sign out")) throw new Error("PFF is not signed in.");
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
  const allowedActions = ["capture-cbs-rosters", "capture-fbg-projections", "capture-fantasypros-projections", "capture-pff-projections"];
  if (!ALLOWED_APP_ORIGINS.has(origin) || !allowedActions.includes(message?.action)) return false;
  const week = Number(message.week);
  if (!Number.isSafeInteger(week) || week < 1 || week > 18) {
    sendResponse({ ok: false, error: "The In-Season GM requested an invalid NFL week." });
    return false;
  }
  const task = message.action === "capture-fbg-projections"
    ? captureFbgProjections(week)
    : message.action === "capture-fantasypros-projections"
      ? captureFantasyProsProjections(week)
      : message.action === "capture-pff-projections"
        ? capturePffProjections(week)
        : captureRosters(week);
  task
    .then((value) => sendResponse(message.action === "capture-cbs-rosters" ? { ok: true, snapshot: value } : { ok: true, capture: value }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Premium projection capture failed safely." }));
  return true;
});
