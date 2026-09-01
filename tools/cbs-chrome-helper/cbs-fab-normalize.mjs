const TEAM_CATALOG = Object.freeze([
  ["angry-face", 1, "Angry Face"], ["orange-crush", 2, "Orange Crush"],
  ["big-head", 3, "Big Head"], ["dogs-of-war", 4, "Dogs of War"],
  ["t-dogs", 5, "T-Dogs"], ["super-suckers", 6, "Super Suckers"],
  ["three-amigos", 7, "Three Amigos"], ["goon-skwad", 8, "Goon Skwad"],
  ["el-guapo", 9, "El Guapo"], ["crime-and-punishment", 10, "Crime and Punishment"],
  ["the-hobbits", 11, "The Hobbits"], ["the-bungles", 12, "The Bungles"],
].map(([teamId, cbsTeamId, name]) => ({ teamId, cbsTeamId, name })));

export const THUNDER_BOWL_FAB_RULES = Object.freeze({
  startingBudget: 50,
  minimumBid: 1,
  zeroDollarBidsAllowed: false,
  allPlayersUseFab: true,
  processingNights: Object.freeze(["TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]),
  typicalProcessingWindow: "1–4 a.m. ET the following morning",
  weeklyPriorityReset: "REVERSE_STANDINGS",
  equalBidTieBreakers: Object.freeze(["WORST_RECORD", "FEWEST_WEEKLY_PICKUPS", "FAB_ORDER"]),
  sequentialWinsLowerPriority: true,
  winningBidBecomesSalary: true,
  dropPeriodDays: 1,
});

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pageRows(page) {
  return (page?.tables || []).flatMap((table) => (table.rows || []).map((cells) => ({
    headers: table.headers || [],
    cells: cells.map(clean),
    text: cells.map(clean).join(" "),
  })));
}

function teamRow(page, teamName) {
  return pageRows(page).find((row) => row.cells.some((cell) => clean(cell) === teamName)) || null;
}

function columnValue(row, heading) {
  const index = row?.headers?.findIndex((header) => heading.test(clean(header))) ?? -1;
  return index >= 0 ? clean(row.cells[index]) : "";
}

function money(value) {
  const match = clean(value).match(/(?:\$\s*)?(\d{1,3})(?:\.00)?\b/);
  const amount = Number(match?.[1]);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 50 ? amount : null;
}

function order(value) {
  const match = clean(value).match(/(?:^|\s)(\d{1,2})(?:st|nd|rd|th)?(?:\s|$)/i);
  const rank = Number(match?.[1]);
  return Number.isSafeInteger(rank) && rank >= 1 && rank <= 12 ? rank : null;
}

function record(value) {
  const match = clean(value).match(/\b(\d{1,2})\s*-\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?\b/);
  if (!match) return null;
  return { wins: Number(match[1]), losses: Number(match[2]), ties: Number(match[3] || 0) };
}

function findPage(pages, patterns) {
  return pages
    .filter((page) => patterns.some((pattern) => pattern.test(`${page.title || ""} ${page.text || ""} ${page.url || ""}`)))
    .sort((left, right) => {
      const coverage = (page) => TEAM_CATALOG.filter((team) => teamRow(page, team.name)).length;
      return coverage(right) - coverage(left);
    })[0] || null;
}

function pickupCounts(pages, week) {
  const transactionPages = pages.filter((page) => /transaction|add\/drop|waiver|fab result/i.test(`${page.title || ""} ${page.url || ""} ${page.text || ""}`));
  const counts = new Map(TEAM_CATALOG.map((team) => [team.teamId, 0]));
  let evidenceRows = 0;
  for (const page of transactionPages) {
    for (const row of pageRows(page)) {
      if (!/\b(awarded|won|added|claimed|acquired)\b/i.test(row.text) || /\b(unsuccessful|failed|dropped|released)\b/i.test(row.text)) continue;
      const team = TEAM_CATALOG.find((candidate) => row.cells.some((cell) => cell === candidate.name));
      if (!team) continue;
      counts.set(team.teamId, counts.get(team.teamId) + 1);
      evidenceRows += 1;
    }
  }
  return {
    counts,
    evidenceRows,
    coverage: transactionPages.some((page) => new RegExp(`(?:week|period)\\s*${week}\\b`, "i").test(page.text || ""))
      ? "CURRENT_WEEK"
      : evidenceRows ? "UNSCOPED" : "NO_RESULTS_YET",
  };
}

export function normalizeCbsFabPages(pages = [], week = 1, capturedAt = new Date().toISOString()) {
  const safePages = pages.filter((page) => page && Array.isArray(page.tables));
  const budgetPage = findPage(safePages, [/fab.{0,20}budget/i, /remaining.{0,12}budget/i, /available.{0,12}balance/i]);
  const orderPage = findPage(safePages, [/fab.{0,20}(order|priority)/i, /(waiver|claim).{0,20}(order|priority)/i]);
  const standingsPage = findPage(safePages, [/standings/i, /overall.{0,20}record/i]);
  const pickups = pickupCounts(safePages, week);
  const teams = TEAM_CATALOG.map((team) => {
    const budgetRow = teamRow(budgetPage, team.name);
    const orderRow = teamRow(orderPage, team.name);
    const standingsRow = teamRow(standingsPage, team.name);
    const remainingBudget = money(columnValue(budgetRow, /remaining|available|balance|budget/i))
      ?? money((budgetRow?.cells || []).find((cell) => /\$/.test(cell)));
    const fabOrder = order(columnValue(orderRow, /order|priority|rank/i))
      ?? order((orderRow?.cells || []).find((cell) => /^\d{1,2}(?:st|nd|rd|th)?$/i.test(cell)));
    const teamRecord = record(columnValue(standingsRow, /record|overall/i)) ?? record(standingsRow?.text);
    return {
      ...team,
      remainingBudget,
      fabOrder,
      record: teamRecord,
      weeklySuccessfulPickups: pickups.coverage === "CURRENT_WEEK" ? pickups.counts.get(team.teamId) : null,
    };
  });
  const budgetCoverage = teams.filter((team) => team.remainingBudget !== null).length;
  const orderCoverage = teams.filter((team) => team.fabOrder !== null).length;
  const recordCoverage = teams.filter((team) => team.record !== null).length;
  return {
    schemaVersion: 1,
    source: "CBS Sports authenticated Thunder Bowl FAB, standings, and transaction pages",
    capturedAt,
    week,
    status: budgetCoverage === 12 && orderCoverage === 12 && recordCoverage === 12 ? "COMPLETE" : "PARTIAL",
    rules: { ...THUNDER_BOWL_FAB_RULES, processingNights: [...THUNDER_BOWL_FAB_RULES.processingNights], equalBidTieBreakers: [...THUNDER_BOWL_FAB_RULES.equalBidTieBreakers] },
    coverage: { budgetTeams: budgetCoverage, orderTeams: orderCoverage, recordTeams: recordCoverage, pickupEvidence: pickups.coverage, pickupRows: pickups.evidenceRows },
    teams,
    pageUrls: [...new Set(safePages.map((page) => page.url).filter(Boolean))].slice(0, 30),
  };
}
