import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const dataRoot = "C:\\Users\\mailp\\OneDrive\\Desktop\\CODEX_D_Drive_Backup_2026-07-30_160939\\thunder-bowl-2026\\data\\normalized";
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
const STARTERS = { QB: 12, RB: 24, WR: 24, TE: 12, K: 12, DST: 12 };

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += character;
  }
  cells.push(cell);
  return cells;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function finite(value, fallback = 0) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function apportion(exact, total) {
  const result = Object.fromEntries(Object.entries(exact).map(([key, value]) => [key, Math.floor(value)]));
  let left = total - Object.values(result).reduce((sum, value) => sum + value, 0);
  const order = Object.keys(exact).sort((leftKey, rightKey) =>
    (exact[rightKey] - Math.floor(exact[rightKey])) - (exact[leftKey] - Math.floor(exact[leftKey]))
    || leftKey.localeCompare(rightKey));
  for (const key of order) {
    if (left <= 0) break;
    result[key] += 1;
    left -= 1;
  }
  return result;
}

function allocateRows(rows, rank, budget) {
  const sorted = [...rows].sort((left, right) => right.points - left.points || left.id.localeCompare(right.id));
  const selected = sorted.slice(0, Math.min(rank, sorted.length));
  const baseline = selected.at(-1)?.points ?? 0;
  const weighted = selected.map((row) => ({ ...row, vorp: Math.max(0, row.points - baseline) }));
  const totalVorp = weighted.reduce((sum, row) => sum + row.vorp, 0);
  const reserve = selected.length;
  const discretionary = Math.max(0, budget - reserve);
  const exact = weighted.map((row) => 1 + (totalVorp ? discretionary * row.vorp / totalVorp : discretionary / Math.max(1, reserve)));
  const rounded = exact.map(Math.floor);
  let left = budget - rounded.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value), id: weighted[index].id }))
    .sort((leftRow, rightRow) => rightRow.remainder - leftRow.remainder || leftRow.id.localeCompare(rightRow.id));
  for (const row of order) {
    if (left <= 0) break;
    rounded[row.index] += 1;
    left -= 1;
  }
  return new Map(weighted.map((row, index) => [row.id, rounded[index]]));
}

function trainingProfile(rosters, trainingSeasons) {
  const training = rosters.filter((row) => trainingSeasons.has(Number(row.season)));
  const teamSeasons = new Map();
  const spend = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  for (const row of training) {
    const key = `${row.season}|${row.team}`;
    if (!teamSeasons.has(key)) teamSeasons.set(key, Object.fromEntries(POSITIONS.map((position) => [position, 0])));
    teamSeasons.get(key)[row.position] += 1;
    spend[row.position] += finite(row.salary);
  }
  const exactRanks = Object.fromEntries(POSITIONS.map((position) => [
    position,
    [...teamSeasons.values()].reduce((sum, counts) => sum + counts[position], 0) / Math.max(1, teamSeasons.size) * 12,
  ]));
  const ranks = apportion(exactRanks, Math.round(Object.values(exactRanks).reduce((sum, value) => sum + value, 0)));
  const totalSpend = Object.values(spend).reduce((sum, value) => sum + value, 0);
  const spendShares = Object.fromEntries(POSITIONS.map((position) => [position, spend[position] / totalSpend]));
  return { teamSeasons: teamSeasons.size, ranks, spendShares };
}

function calculateValues(pool, ranks, totalBudget, spendShares, method) {
  if (method === "classic") {
    const all = [];
    for (const position of POSITIONS) {
      const rows = pool.filter((row) => row.position === position);
      const sorted = [...rows].sort((left, right) => right.points - left.points || left.id.localeCompare(right.id));
      const baseline = sorted[Math.min(STARTERS[position], sorted.length) - 1]?.points ?? 0;
      all.push(...rows.map((row) => ({ ...row, vorp: Math.max(0, row.points - baseline) })));
    }
    const selected = [...all].sort((left, right) => right.vorp - left.vorp || left.id.localeCompare(right.id)).slice(0, 144);
    const totalVorp = selected.reduce((sum, row) => sum + row.vorp, 0);
    const exact = selected.map((row) => 1 + (totalBudget - selected.length) * row.vorp / totalVorp);
    const rounded = exact.map(Math.floor);
    let left = totalBudget - rounded.reduce((sum, value) => sum + value, 0);
    const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value), id: selected[index].id }))
      .sort((leftRow, rightRow) => rightRow.remainder - leftRow.remainder || leftRow.id.localeCompare(rightRow.id));
    for (const row of order) {
      if (left <= 0) break;
      rounded[row.index] += 1;
      left -= 1;
    }
    return new Map(selected.map((row, index) => [row.id, rounded[index]]));
  }
  if (method === "global-demand") {
    const selected = [];
    for (const position of POSITIONS) {
      const rows = pool.filter((row) => row.position === position).sort((left, right) => right.points - left.points || left.id.localeCompare(right.id));
      const baseline = rows[Math.min(ranks[position], rows.length) - 1]?.points ?? 0;
      selected.push(...rows.slice(0, ranks[position]).map((row) => ({ ...row, vorp: Math.max(0, row.points - baseline) })));
    }
    const totalVorp = selected.reduce((sum, row) => sum + row.vorp, 0);
    const exact = selected.map((row) => 1 + (totalBudget - selected.length) * row.vorp / totalVorp);
    const rounded = exact.map(Math.floor);
    let left = totalBudget - rounded.reduce((sum, value) => sum + value, 0);
    const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value), id: selected[index].id }))
      .sort((leftRow, rightRow) => rightRow.remainder - leftRow.remainder || leftRow.id.localeCompare(rightRow.id));
    for (const row of order) {
      if (left <= 0) break;
      rounded[row.index] += 1;
      left -= 1;
    }
    return new Map(selected.map((row, index) => [row.id, rounded[index]]));
  }
  const exactBudgets = Object.fromEntries(POSITIONS.map((position) => [position, totalBudget * spendShares[position]]));
  const budgets = apportion(exactBudgets, totalBudget);
  const result = new Map();
  for (const position of POSITIONS) {
    const positionValues = allocateRows(pool.filter((row) => row.position === position), ranks[position], budgets[position]);
    for (const [id, value] of positionValues) result.set(id, value);
  }
  return result;
}

function mae(rows, values) {
  return rows.reduce((sum, row) => sum + Math.abs(finite(row.salary) - (values.get(row.player_id) ?? 1)), 0) / Math.max(1, rows.length);
}

const [projectionText, rosterText, auctionText] = await Promise.all([
  readFile(resolve(dataRoot, "cbs_projection_actual_joins_2021_2025.csv"), "utf8"),
  readFile(resolve(dataRoot, "auction_rosters_2021_2025.csv"), "utf8"),
  readFile(resolve(dataRoot, "backtest_player_auction_2021_2025.csv"), "utf8"),
]);
const projections = parseCsv(projectionText);
const rosters = parseCsv(rosterText);
const auctions = parseCsv(auctionText);
const folds = [];

for (const testSeason of [2023, 2024, 2025]) {
  const trainingSeasons = new Set([2021, 2022, 2023, 2024].filter((season) => season < testSeason));
  const profile = trainingProfile(rosters, trainingSeasons);
  const pool = projections.filter((row) => Number(row.season) === testSeason && row.eligible_for_model_fitting === "true_provisional_source")
    .map((row) => ({ id: row.canonical_player_id, position: row.position, points: finite(row.projected_points_for_evaluation) }));
  const purchaseRows = auctions.filter((row) => Number(row.season) === testSeason && row.acquisition_type !== "keeper");
  const teamCaps = new Map(purchaseRows.map((row) => [
    row.fantasy_team,
    String(row.starting_cap || "").trim() === ""
      ? 100 + finite(row.cap_adjustment)
      : finite(row.starting_cap, 100),
  ]));
  const totalBudget = [...teamCaps.values()].reduce((sum, value) => sum + value, 0) || 1200;
  const classic = calculateValues(pool, profile.ranks, totalBudget, profile.spendShares, "classic");
  const globalDemand = calculateValues(pool, profile.ranks, totalBudget, profile.spendShares, "global-demand");
  const positionBudget = calculateValues(pool, profile.ranks, totalBudget, profile.spendShares, "position-budget");
  const blended = new Map(pool.map((row) => [row.id, Math.max(1, Math.round(0.25 * (classic.get(row.id) ?? 1) + 0.75 * (positionBudget.get(row.id) ?? 1)))]));
  const matchedPurchaseRows = purchaseRows.filter((row) => classic.has(row.player_id));
  const metricSet = (rows) => rows.length ? {
    classic: Number(mae(rows, classic).toFixed(3)),
    globalDemand: Number(mae(rows, globalDemand).toFixed(3)),
    positionBudget: Number(mae(rows, positionBudget).toFixed(3)),
    blendedPositionBudget: Number(mae(rows, blended).toFixed(3)),
  } : null;
  folds.push({
    testSeason,
    evidenceRole: testSeason === 2025 ? "descriptive_only_outcomes_previously_seen" : "development_fold",
    trainingSeasons: [...trainingSeasons],
    trainingTeamSeasons: profile.teamSeasons,
    purchases: purchaseRows.length,
    matchedPurchases: matchedPurchaseRows.length,
    totalBudget,
    ranks: profile.ranks,
    spendShares: Object.fromEntries(POSITIONS.map((position) => [position, Number(profile.spendShares[position].toFixed(4))])),
    mae: metricSet(purchaseRows),
    matchedMae: metricSet(matchedPurchaseRows),
    positionMae: Object.fromEntries(POSITIONS.map((position) => [position, {
      n: purchaseRows.filter((row) => row.position === position).length,
      classic: Number(mae(purchaseRows.filter((row) => row.position === position), classic).toFixed(3)),
      globalDemand: Number(mae(purchaseRows.filter((row) => row.position === position), globalDemand).toFixed(3)),
      positionBudget: Number(mae(purchaseRows.filter((row) => row.position === position), positionBudget).toFixed(3)),
      blendedPositionBudget: Number(mae(purchaseRows.filter((row) => row.position === position), blended).toFixed(3)),
    }])),
  });
}

const development = folds.filter((fold) => fold.evidenceRole === "development_fold");
const weighted = (field) => Number((development.reduce((sum, fold) => sum + fold.mae[field] * fold.purchases, 0) / development.reduce((sum, fold) => sum + fold.purchases, 0)).toFixed(3));
const weightedMatched = (field) => Number((development.reduce((sum, fold) => sum + fold.matchedMae[field] * fold.matchedPurchases, 0) / development.reduce((sum, fold) => sum + fold.matchedPurchases, 0)).toFixed(3));
const result = {
  schemaVersion: 1,
  protocol: "time-forward CBS preseason projections; train roster counts and position spend on prior Thunder Bowl seasons; explicit keepers excluded where labeled; unresolved draft/keeper rows retained",
  developmentPurchases: development.reduce((sum, fold) => sum + fold.purchases, 0),
  developmentWeightedMae: {
    classic: weighted("classic"),
    globalDemand: weighted("globalDemand"),
    positionBudget: weighted("positionBudget"),
    blendedPositionBudget: weighted("blendedPositionBudget"),
  },
  developmentMatchedPurchases: development.reduce((sum, fold) => sum + fold.matchedPurchases, 0),
  developmentMatchedWeightedMae: {
    classic: weightedMatched("classic"),
    globalDemand: weightedMatched("globalDemand"),
    positionBudget: weightedMatched("positionBudget"),
    blendedPositionBudget: weightedMatched("blendedPositionBudget"),
  },
  folds,
};

const reportPath = resolve(repoRoot, "reports/thunder-bowl/auction-market-position-calibration-20260808.json");
const temporaryReportPath = `${reportPath}.tmp`;
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(temporaryReportPath, JSON.stringify(result, null, 2) + "\n", "utf8");
await rename(temporaryReportPath, reportPath);
console.log(JSON.stringify(result, null, 2));
