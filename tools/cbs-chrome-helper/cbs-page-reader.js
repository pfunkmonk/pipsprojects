(() => {
  "use strict";
  const REQUEST_SOURCE = "thunder-bowl-helper-worker";
  const READER_VERSION = "0.10.8";

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function hasContent(pageKind, expectedPlayerNames = []) {
    const tables = [...document.querySelectorAll("table")];
    if (pageKind === "roster") {
      const teamTableCount = tables.filter((table) => /\sPlayers$/.test(clean(table.querySelector("tr")?.innerText))).length;
      return teamTableCount >= 12;
    }
    if (pageKind === "scoring-preview") {
      const body = document.body?.innerText || "";
      const playerLinks = document.querySelectorAll('a[href*="/players/playerpage/"],a[href*="/players/"]');
      const rosterNameHits = expectedPlayerNames.filter((name) => body.includes(name)).length;
      return /Scoring Preview/i.test(body) && (playerLinks.length >= 8 || rosterNameHits >= 8);
    }
    if (pageKind === "scoring-live") {
      const body = document.body?.innerText || "";
      const playerRows = document.querySelectorAll("#matchupDetailsRegion .playerLayoutContainer");
      const matchupTiles = document.querySelectorAll("#atlRegion .atlItem");
      return /(?:GameTracker|PLAYER MINUTES REMAINING|PMR:)/i.test(body) && playerRows.length >= 16 && matchupTiles.length >= 1;
    }
    const projectionTable = tables.find((table) => /\bFPTS\b/.test(table.innerText || ""));
    return Boolean(projectionTable?.querySelector('a.playerLink[href*="/players/playerpage/"]'));
  }

  function rosterTables() {
    return [...document.querySelectorAll("table")].map((table) => {
      const heading = clean(table.querySelector("tr")?.innerText);
      const teamName = heading.match(/^(.+?)\s+Players$/)?.[1] || "";
      const rows = [...table.querySelectorAll("tr")].map((row) => {
        const playerLink = [...row.querySelectorAll("a[href]")].find((link) => /playerpage|\/players\/\d+/i.test(link.getAttribute("href") || ""));
        const id = (playerLink?.getAttribute("href") || "").match(/(?:playerpage\/|players\/)(\d+)/i)?.[1] || "";
        return {
          cbsPlayerId: id,
          name: clean(playerLink?.textContent),
          cells: [...row.querySelectorAll("th,td")].map((cell) => clean(cell.innerText || cell.textContent)),
          newsTitles: [...row.querySelectorAll("[title]")].map((element) => element.getAttribute("title")).filter(Boolean),
          markerClasses: [...row.querySelectorAll("[class]")].flatMap((element) => [...element.classList]).filter((name) => /inj|status|question|doubt|out|ir|pup/i.test(name)),
        };
      });
      return { teamName, rows };
    }).filter((table) => table.teamName);
  }

  function schedulePage(cbsOrigin, teamNames) {
    const relevant = /schedule|matchup|scoreboard|scores/i;
    const text = clean(document.body?.innerText || document.body?.textContent || "");
    const tables = [...document.querySelectorAll("table")].map((table) => {
      const headerRows = [...table.querySelectorAll("thead tr")];
      const headerRow = headerRows.at(-1) || table.querySelector("tr");
      // CBS uses two THEAD rows on /schedule/full: the first identifies the
      // period and the second labels Matchups/@/Results. Keep both so the
      // normalizer never loses the period number.
      const headers = (headerRows.length ? headerRows : [headerRow])
        .filter(Boolean)
        .flatMap((row) => [...row.querySelectorAll("th,td")].map((cell) => clean(cell.innerText || cell.textContent)));
      const rows = [...table.querySelectorAll("tbody tr, tr")]
        .filter((row) => row !== headerRow && !headerRows.includes(row))
        .map((row) => [...row.querySelectorAll("th,td")].map((cell) => clean(cell.innerText || cell.textContent)))
        .filter((row) => row.length);
      return { headers, rows };
    }).filter((table) => table.rows.length);
    const blocks = [...new Set([...document.querySelectorAll("tr,li,article,select option,[role='option'],[class*='matchup'],[class*='schedule']")]
      .map((node) => clean(node.innerText || node.textContent))
      .filter((value) => value.length >= 8 && value.length <= 500 && teamNames.filter((name) => value.includes(name)).length === 2))];
    const discovered = new Set();
    const addUrl = (raw, label = "") => {
      try {
        const url = new URL(raw, location.href);
        if (url.origin === cbsOrigin && (relevant.test(clean(label) + " " + url.pathname) || /^week\s*(1[0-8]|[1-9])$/i.test(clean(label)))) discovered.add(url.href);
      } catch {
        // Ignore malformed CBS navigation values.
      }
    };
    for (const link of document.querySelectorAll("a[href]")) addUrl(link.getAttribute("href"), link.textContent);
    for (const option of document.querySelectorAll("select option,[role='option'][data-value]")) {
      const label = clean(option.textContent);
      const value = clean(option.value || option.getAttribute("data-value"));
      const week = label.match(/\bweek\s*(1[0-8]|[1-9])\b/i)?.[1] || (/^(1[0-8]|[1-9])$/.test(value) ? value : null);
      if (/^(?:https?:|\/)/i.test(value)) addUrl(value, label);
      else if (week) {
        const url = new URL(location.href);
        url.searchParams.set("week", week);
        discovered.add(url.href);
      }
    }
    return {
      teamHits: teamNames.filter((name) => text.includes(name)).length,
      page: { url: location.href, title: document.title || "", text: text.slice(0, 250_000), tables, blocks },
      discovered: [...discovered].slice(0, 80),
    };
  }

  function scoringPreviewRows(rosterPlayers) {
    const text = (node) => clean(node?.innerText || node?.textContent);
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,th,header,div,span")];
    const reserveHeading = headings.find((node) => /^reserves?$/i.test(text(node)));
    const reservesTop = reserveHeading?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
    const seen = new Set();
    const rows = [];
    const add = ({ cbsPlayerId, name, node }) => {
      if (!cbsPlayerId || !node) return;
      const rect = node.getBoundingClientRect();
      if (!Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) return;
      const key = cbsPlayerId + "|" + Math.round(rect.top);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ cbsPlayerId, name, role: rect.top > reservesTop ? "BENCH" : "STARTER", top: rect.top, left: rect.left });
    };
    for (const link of document.querySelectorAll('a[href*="/players/playerpage/"],a[href*="/players/"]')) {
      const href = link.getAttribute("href") || "";
      add({
        cbsPlayerId: href.match(/(?:playerpage\/|players\/)(\d+)/i)?.[1] || "",
        name: text(link),
        node: link,
      });
    }
    const nameNodes = [...document.querySelectorAll("a,button,span,strong,[class*='player']")];
    for (const player of rosterPlayers) {
      if (rows.some((row) => row.cbsPlayerId === player.cbsPlayerId)) continue;
      const matches = nameNodes.filter((node) => text(node) === player.name && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
      const node = matches.sort((left, right) => left.children.length - right.children.length || left.getBoundingClientRect().width - right.getBoundingClientRect().width)[0];
      add({ cbsPlayerId: player.cbsPlayerId, name: player.name, node });
    }
    return { rows, pageUrl: location.href, pageTitle: document.title || "" };
  }

  function finiteScore(value) {
    const normalized = clean(value).replace(/,/g, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
    const score = Number(normalized);
    return Number.isFinite(score) && score >= -100 && score <= 200 ? score : null;
  }

  function currentLiveScoringRows(rosterPlayers, matchupIndex) {
    const knownIds = new Set(rosterPlayers.map((player) => String(player.cbsPlayerId || "")));
    const rows = [];
    for (const node of document.querySelectorAll("#matchupDetailsRegion .playerLayoutContainer")) {
      const link = node.querySelector('a[href*="/players/playerpage/"],a[href*="/players/"]');
      const cbsPlayerId = (link?.getAttribute("href") || "").match(/(?:playerpage\/|players\/)(\d+)/i)?.[1] || "";
      if (!knownIds.has(cbsPlayerId)) continue;
      const ancestorClasses = [];
      for (let parent = node.parentElement; parent && parent.id !== "matchupDetailsRegion"; parent = parent.parentElement) ancestorClasses.push(String(parent.className || ""));
      const context = ancestorClasses.join(" ");
      const role = /bench/i.test(context) ? "BENCH" : "STARTER";
      const teamSide = /home/i.test(context) ? "HOME" : /away/i.test(context) ? "AWAY" : null;
      const gameText = clean(node.children[1]?.innerText || node.children[1]?.textContent);
      const statsText = clean(node.querySelector(".playerStatsContainer")?.innerText || node.querySelector(".playerStatsContainer")?.textContent);
      const actualPoints = finiteScore(node.querySelector(".playerScoresContainer .playerScore")?.innerText || node.querySelector(".playerScoresContainer .playerScore")?.textContent);
      const cbsLiveProjection = finiteScore(node.querySelector(".playerScoresContainer .projScore")?.innerText || node.querySelector(".playerScoresContainer .projScore")?.textContent);
      const final = /playerCellFinaled/i.test(node.className || "") || /\bFINAL\b/i.test(gameText);
      rows.push({
        cbsPlayerId,
        name: clean(link?.textContent),
        role,
        teamSide,
        matchupIndex,
        actualPoints,
        scoreStatus: actualPoints === null ? "NOT_STARTED" : final ? "FINAL" : "LIVE",
        cbsLiveProjection,
        gameText: gameText.slice(0, 300),
        statsText: statsText.slice(0, 500),
        top: node.getBoundingClientRect().top,
      });
    }
    return rows;
  }

  async function scoringLiveRows(rosterPlayers) {
    const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const tiles = [...document.querySelectorAll("#atlRegion .atlItem")].filter((tile) => tile.getBoundingClientRect().width > 0 && tile.getBoundingClientRect().height > 0);
    const originalIndex = Math.max(0, tiles.findIndex((tile) => tile.classList.contains("selected")));
    const allRows = [];
    const captureErrors = [];
    const signature = () => [...document.querySelectorAll("#matchupDetailsRegion .playerLayoutContainer a.playerLink")]
      .map((link) => (link.getAttribute("href") || "").match(/(?:playerpage\/|players\/)(\d+)/i)?.[1] || "")
      .filter(Boolean).join("|");
    const exactStarterSides = (rows) => ["AWAY", "HOME"].every((side) => rows.filter((row) => row.teamSide === side && row.role === "STARTER").length === 8);
    try {
      for (let matchupIndex = 0; matchupIndex < tiles.length; matchupIndex += 1) {
        const tile = tiles[matchupIndex];
        const before = signature();
        const wasSelected = tile.classList.contains("selected");
        if (!wasSelected) tile.click();
        const deadline = Date.now() + 6_000;
        while (Date.now() < deadline) {
          const current = signature();
          if (tile.classList.contains("selected") && current && (wasSelected || current !== before)) break;
          await pause(100);
        }
        let captured = currentLiveScoringRows(rosterPlayers, matchupIndex);
        // CBS sometimes marks the matchup tile selected just before its player
        // rows finish replacing the prior matchup. Do not accept that
        // intermediate DOM: re-read until both sides expose all eight submitted
        // starters, or report the partial capture honestly after the deadline.
        for (let attempt = 0; attempt < 12 && !exactStarterSides(captured); attempt += 1) {
          await pause(125);
          captured = currentLiveScoringRows(rosterPlayers, matchupIndex);
        }
        if (!exactStarterSides(captured)) captureErrors.push(`CBS live scoring matchup ${matchupIndex + 1} did not expose eight submitted starters for both teams.`);
        allRows.push(...captured);
      }
    } finally {
      if (tiles[originalIndex] && !tiles[originalIndex].classList.contains("selected")) {
        tiles[originalIndex].click();
        await pause(150);
      }
    }
    if (!allRows.length && !captureErrors.length) captureErrors.push("CBS live scoring returned no player rows.");
    return {
      rows: allRows,
      allMatchups: tiles.length >= 6,
      matchupCount: tiles.length,
      pageUrl: location.href,
      pageTitle: document.title || "",
      captureError: captureErrors.join(" ") || null,
    };
  }

  function projectionRows(expectedPosition) {
    const table = [...document.querySelectorAll("table")].find((node) => /FPTS/.test(node.innerText || ""));
    if (!table) return [];
    return [...table.querySelectorAll("tr")].map((row) => {
      const link = row.querySelector('a.playerLink[href*="/players/playerpage/"]');
      const id = (link?.getAttribute("href") || "").match(/playerpage\/(\d+)/)?.[1] || "";
      const identity = link?.getAttribute("aria-label") || "";
      const identityMatch = identity.match(/\s(QB|RB|WR|TE|K|DST)\s+([A-Z]{2,3})\s*$/i);
      return {
        cbsPlayerId: id,
        name: clean(link?.textContent),
        nflTeam: identityMatch?.[1]?.toUpperCase() === expectedPosition ? identityMatch[2].toUpperCase() : "",
        cells: [...row.querySelectorAll("th,td")].map((cell) => clean(cell.innerText || cell.textContent)),
      };
    });
  }

  function directCells(row) {
    return [...row.querySelectorAll(":scope > th, :scope > td")];
  }

  function selectedValue(select) {
    return clean(select?.selectedOptions?.[0]?.textContent || select?.value);
  }

  function leagueName() {
    const chooser = document.querySelector('[aria-label="Team selection"]');
    const lines = String(chooser?.innerText || chooser?.textContent || "").split(/\r?\n/).map(clean).filter(Boolean);
    if (lines.length) return lines[0];
    const heading = [...document.querySelectorAll("h1,h2,h3")].map((node) => clean(node.textContent)).find((value) => /league$/i.test(value));
    return clean(heading?.replace(/\s+league$/i, ""));
  }

  function leagueTeams() {
    const teams = new Map();
    for (const link of document.querySelectorAll('a[href*="/teams/"]')) {
      const match = (link.getAttribute("href") || "").match(/\/teams\/(?:page\/)?(\d+)\/?(?:[?#].*)?$/i);
      const name = clean(link.textContent);
      if (match && name && name.length <= 60 && !teams.has(match[1])) teams.set(match[1], { cbsTeamId: Number(match[1]), name });
    }
    return [...teams.values()];
  }

  function namedControl(pattern) {
    for (const control of document.querySelectorAll("input,select")) {
      if (control.type === "hidden" || control.type === "submit" || control.type === "button") continue;
      const label = clean(control.labels?.[0]?.textContent || control.getAttribute("aria-label") || directCells(control.closest("tr") || document.createElement("tr"))[0]?.textContent || "");
      const identity = `${control.name || ""} ${control.id || ""} ${label}`;
      if (pattern.test(identity) && (control.type !== "radio" && control.type !== "checkbox" || control.checked)) return selectedValue(control) || clean(control.value);
    }
    return "";
  }

  function rosterSetup() {
    const rosterPositions = [];
    const rosterLimits = {};
    for (const row of document.querySelectorAll("tr")) {
      const cells = directCells(row);
      if (cells.length < 2) continue;
      const label = clean(cells[0].textContent || cells[1]?.textContent);
      const positionLabel = clean(cells[1]?.textContent);
      const positionMatch = positionLabel.match(/\(([^)]+)\)\s*$/);
      const selects = [...row.querySelectorAll(":scope > td select, :scope > th select")];
      if (cells.length >= 5 && positionMatch && selects.length >= 3) {
        rosterPositions.push({
          id: positionMatch[1].toUpperCase(),
          label: positionLabel.replace(/\s*\([^)]+\)\s*$/, ""),
          included: Boolean(row.querySelector(":scope > td input:checked, :scope > th input:checked")),
          minimumStarters: selectedValue(selects[0]),
          maximumStarters: selectedValue(selects[1]),
          maximumOnRoster: selectedValue(selects[2]),
        });
        continue;
      }
      if (selects.length < 2) continue;
      const values = selects.map(selectedValue);
      if (/^Starting Players$/i.test(label)) [rosterLimits.startingMinimum, rosterLimits.startingMaximum] = values;
      else if (/^Reserve Players$/i.test(label)) [rosterLimits.reserveMinimum, rosterLimits.reserveMaximum] = values;
      else if (/^Injured Players$/i.test(label)) [rosterLimits.injuredMinimum, rosterLimits.injuredMaximum] = values;
      else if (/^Practice Squad$/i.test(label)) [rosterLimits.practiceMinimum, rosterLimits.practiceMaximum] = values;
      else if (/^Total Roster Limits$/i.test(label)) [rosterLimits.totalMinimum, rosterLimits.totalMaximum] = values;
    }
    return { rosterPositions, rosterLimits };
  }

  function policySetup() {
    const keeperCheckbox = [...document.querySelectorAll('input[type="checkbox"]')].find((input) => /use keepers/i.test(clean(input.labels?.[0]?.textContent || input.closest("fieldset")?.textContent)));
    const keeperMaximum = [...document.querySelectorAll("select")].find((select) => /max(?:imum)? number of keepers/i.test(clean(select.labels?.[0]?.textContent || select.getAttribute("aria-label"))));
    let teamMaximumTotal = clean(document.querySelector('input[name$="wildcard_maxtot_salary"]')?.value);
    for (const row of document.querySelectorAll("tr")) {
      if (teamMaximumTotal) break;
      const cells = directCells(row);
      if (cells.length < 7 || !cells.some((cell) => /^salary$/i.test(clean(cell.textContent)))) continue;
      const textInputs = [...row.querySelectorAll(':scope > td input[type="text"], :scope > th input[type="text"]')];
      teamMaximumTotal = clean(textInputs.at(-1)?.value);
      break;
    }
    return {
      keeperPolicy: keeperCheckbox ? { enabled: keeperCheckbox.checked, maximum: selectedValue(keeperMaximum) } : null,
      salaryPolicy: { teamMaximumTotal },
    };
  }

  function draftSetup() {
    const checkedType = document.querySelector('input[type="radio"][name*="draft_type"]:checked');
    const body = clean(document.body?.innerText || document.body?.textContent);
    const order = body.match(/Draft Order:\s*([A-Za-z -]+)/i)?.[1] || namedControl(/draft.*order|nomination.*order/i);
    return {
      draftSettings: {
        type: clean(checkedType?.value),
        rounds: namedControl(/rounds?/i),
        salaryCap: namedControl(/salary.*cap|cap.*amount|team.*budget|starting.*budget/i),
        minimumBid: namedControl(/minimum.*(?:bid|offer)|opening.*(?:bid|offer)/i),
        bidIncrement: namedControl(/bid.*increment|offer.*increment/i),
        order: clean(order),
      },
    };
  }

  function draftOrderSetup() {
    const source = clean(document.querySelector('input[name="draft-order::order_source"]:checked')?.value).toLowerCase();
    const table = [...document.querySelectorAll("table")].find((candidate) => {
      const heading = clean(candidate.querySelector("tr")?.textContent);
      return /\bPick\b/i.test(heading) && /\bTeam Name\b/i.test(heading);
    });
    const teamNames = source === "manual" && table
      ? [...table.querySelectorAll("tr")].map((row) => {
        const cells = directCells(row);
        const pick = Number.parseInt(clean(cells[0]?.textContent), 10);
        const name = clean(cells.at(-1)?.textContent);
        return Number.isSafeInteger(pick) && pick > 0 && name ? { pick, name } : null;
      }).filter(Boolean).sort((left, right) => left.pick - right.pick).map((entry) => entry.name)
      : [];
    return { draftOrder: { source, teamNames } };
  }

  function setupPage(kind) {
    const body = clean(document.body?.innerText || document.body?.textContent);
    const season = Number(body.match(/\b(20\d{2})\b/)?.[1]) || null;
    const base = { kind, url: location.href, title: document.title || "", leagueName: leagueName(), season, teams: leagueTeams() };
    if (kind === "roster") return { ...base, ...rosterSetup() };
    if (kind === "policies") return { ...base, ...policySetup() };
    if (kind === "order") return { ...base, ...draftOrderSetup() };
    if (kind === "draft" || kind === "home") return { ...base, ...draftSetup() };
    return base;
  }

  async function fabPages(expectedWeek, cbsOrigin) {
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
        if (url.origin === cbsOrigin && relevant.test(clean(link.textContent) + " " + url.pathname)) queue.add(url.href);
      } catch {
        // Ignore malformed CBS navigation links.
      }
    }
    async function fetchPage(requestedUrl) {
      let timeout = null;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 6_000);
        const response = await fetch(requestedUrl, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "text/html" },
        });
        if (!response.ok || new URL(response.url).origin !== cbsOrigin) return null;
        const html = await response.text();
        if (html.length < 500 || html.length > 3_000_000) return null;
        const documentCopy = new DOMParser().parseFromString(html, "text/html");
        const text = clean(documentCopy.body?.innerText || documentCopy.body?.textContent);
        if (/sign in to continue|forgot your password/i.test(text) && !/Angry Face|Muther Humpers|Dogs of War|Orange Crush/.test(text)) return null;
        const tables = [...documentCopy.querySelectorAll("table")].map((table) => {
          const headerRow = table.querySelector("thead tr:last-child") || table.querySelector("tr");
          const headers = [...(headerRow?.querySelectorAll("th,td") || [])].map((cell) => clean(cell.textContent));
          const rows = [...table.querySelectorAll("tbody tr, tr")]
            .filter((row) => row !== headerRow)
            .map((row) => [...row.querySelectorAll("th,td")].map((cell) => clean(cell.textContent)))
            .filter((row) => row.length);
          return { headers, rows };
        }).filter((table) => table.rows.length);
        if (!relevant.test((documentCopy.title || "") + " " + response.url + " " + text) && !/Angry Face|Muther Humpers|Dogs of War|Orange Crush/.test(text)) return null;
        return { url: response.url, title: documentCopy.title || "", text: text.slice(0, 80_000), tables };
      } catch {
        return null;
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }
    }
    const candidates = [...queue].slice(0, 16);
    const captured = [];
    for (let index = 0; index < candidates.length; index += 8) {
      captured.push(...await Promise.all(candidates.slice(index, index + 8).map(fetchPage)));
    }
    return { week: expectedWeek, pages: captured.filter(Boolean) };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.source !== REQUEST_SOURCE || message?.action !== "read-cbs-page") return false;
    if (message.kind === "fab-pages") {
      fabPages(message.args?.week, message.args?.cbsOrigin)
        .then((value) => sendResponse({ ok: true, readerVersion: READER_VERSION, value }))
        .catch((error) => sendResponse({ ok: false, readerVersion: READER_VERSION, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (message.kind === "scoring-live-rows") {
      scoringLiveRows(message.args?.rosterPlayers || [])
        .then((value) => sendResponse({ ok: true, readerVersion: READER_VERSION, value }))
        .catch((error) => sendResponse({ ok: false, readerVersion: READER_VERSION, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    try {
      const args = message.args || {};
      const value = message.kind === "has-content"
        ? hasContent(args.pageKind, args.expectedPlayerNames)
        : message.kind === "roster-tables"
          ? rosterTables()
          : message.kind === "schedule-page"
            ? schedulePage(args.cbsOrigin, args.teamNames || [])
            : message.kind === "scoring-preview-rows"
            ? scoringPreviewRows(args.rosterPlayers || [])
            : message.kind === "projection-rows"
              ? projectionRows(args.position)
              : message.kind === "setup-page"
                ? setupPage(args.setupKind || "home")
                : null;
      sendResponse({ ok: true, readerVersion: READER_VERSION, value });
    } catch (error) {
      sendResponse({ ok: false, readerVersion: READER_VERSION, error: error instanceof Error ? error.message : String(error) });
    }
    return false;
  });
})();
