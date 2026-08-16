import { readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const historyRootArgument = process.argv.find((argument) => argument.startsWith("--history-root="))?.slice("--history-root=".length);
const historyRoot = resolve(
  historyRootArgument
    || process.env.THUNDER_BOWL_HISTORY_ROOT
    || resolve(homedir(), "Dropbox/Personal/FAMILY STUFF/Mike Stuff/Fantasy Football"),
);
const normalizedPurchasesPath = resolve(repoRoot, "reports/thunder-bowl/manager-auction-history-normalized.csv");
const reportPath = resolve(repoRoot, "reports/thunder-bowl/auction-price-curve-backtest.json");
const modulePath = resolve(repoRoot, "public/thunder-bowl/auction-price-profile.mjs");
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
const HALF_LIVES = [2, 3, 4, 5, 6, 8, 12, 1000];
const BLEND_WEIGHTS = Array.from({ length: 11 }, (_, index) => index / 10);
const REFERENCE_SEASON = 2026;
const PROJECTION_SOURCES = Object.freeze({
  2015: "2015/2015 - PLAYER POOL.csv",
  2017: "2017/DraftDominator/2017 - PLAYER POOL.csv",
  2018: "2018/DraftDominator/2018 - PLAYER POOL.csv",
  2023: "2023/DraftDominator/2023 - PLAYER POOL.csv",
  2025: "2025/DraftDominator/2025 - PLAYER POOL.csv",
});
const DRAFT_SOURCES = Object.freeze({
  2015: "2015/2015 - DRAFT SUMMARY.csv",
  2017: "2017/DraftDominator/2017 - DRAFT SUMMARY.csv",
  2018: "2018/DraftDominator/2018 - DRAFT SUMMARY.csv",
  2023: "2023/DraftDominator/2023 - DRAFT SUMMARY.csv",
  2025: "2025/DraftDominator/2025 - DRAFT SUMMARY.csv",
});

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
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function position(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\d+$/, "");
  return normalized === "PK" ? "K" : ["DEF", "TD"].includes(normalized) ? "DST" : normalized;
}

function nameKey(value) {
  return String(value || "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function recencyWeight(referenceSeason, season, halfLife) {
  return 0.5 ** (Math.max(0, referenceSeason - season) / halfLife);
}

function quantile(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function buildCurve(rows, referenceSeason, halfLife) {
  const bySeasonPosition = new Map();
  for (const row of rows.filter((candidate) => candidate.season < referenceSeason)) {
    const key = `${row.season}|${row.position}`;
    if (!bySeasonPosition.has(key)) bySeasonPosition.set(key, []);
    bySeasonPosition.get(key).push(row.salary);
  }
  for (const prices of bySeasonPosition.values()) prices.sort((left, right) => right - left);
  const curves = {};
  for (const candidatePosition of POSITIONS) {
    const seasons = [...new Set(rows.filter((row) => row.season < referenceSeason && row.position === candidatePosition).map((row) => row.season))].sort((left, right) => left - right);
    const maximumRank = Math.max(0, ...seasons.map((season) => bySeasonPosition.get(`${season}|${candidatePosition}`)?.length || 0));
    const values = [];
    for (let rank = 1; rank <= maximumRank; rank += 1) {
      const evidence = seasons.flatMap((season) => {
        const price = bySeasonPosition.get(`${season}|${candidatePosition}`)?.[rank - 1];
        return price === undefined ? [] : [{ season, price, weight: recencyWeight(referenceSeason, season, halfLife) }];
      });
      const weight = evidence.reduce((sum, row) => sum + row.weight, 0);
      const mean = weight ? evidence.reduce((sum, row) => sum + row.price * row.weight, 0) / weight : 1;
      values.push({
        rank,
        mean: Math.max(1, mean),
        median: quantile(evidence.map((row) => row.price), 0.5) ?? 1,
        low: quantile(evidence.map((row) => row.price), 0.1) ?? 1,
        high: quantile(evidence.map((row) => row.price), 0.9) ?? 1,
        seasons: evidence.length,
      });
    }
    for (let index = 1; index < values.length; index += 1) {
      values[index].mean = Math.min(values[index - 1].mean, values[index].mean);
      values[index].median = Math.min(values[index - 1].median, values[index].median);
      values[index].low = Math.min(values[index - 1].low, values[index].low);
      values[index].high = Math.min(values[index - 1].high, values[index].high);
    }
    for (const row of values) {
      row.low = Math.max(1, Math.min(row.low, row.mean));
      row.high = Math.max(row.mean, row.high);
      row.median = Math.max(row.low, Math.min(row.median, row.high));
    }
    curves[candidatePosition] = values;
  }
  return curves;
}

function curvePrice(curves, candidatePosition, rank, field = "mean") {
  return Math.max(1, curves[candidatePosition]?.[Math.max(0, rank - 1)]?.[field] ?? 1);
}

function meanAbsoluteError(rows, field) {
  return rows.length ? rows.reduce((sum, row) => sum + Math.abs(row.actual - row[field]), 0) / rows.length : null;
}

function topFiveSeasonMeans(rows) {
  const result = {};
  for (const candidatePosition of POSITIONS) {
    const seasonMeans = [...new Set(rows.map((row) => row.season))].flatMap((season) => {
      const prices = rows.filter((row) => row.season === season && row.position === candidatePosition)
        .map((row) => row.salary).sort((left, right) => right - left).slice(0, 5);
      return prices.length === 5 ? [prices.reduce((sum, value) => sum + value, 0) / 5] : [];
    });
    result[candidatePosition] = {
      seasons: seasonMeans.length,
      mean: finite((seasonMeans.reduce((sum, value) => sum + value, 0) / Math.max(1, seasonMeans.length)).toFixed(2)),
      median: quantile(seasonMeans, 0.5),
      low: Math.min(...seasonMeans),
      high: Math.max(...seasonMeans),
    };
  }
  return result;
}

async function projectionFold(season, purchases, halfLife) {
  const [poolText, draftText] = await Promise.all([
    readFile(resolve(historyRoot, PROJECTION_SOURCES[season]), "utf8"),
    readFile(resolve(historyRoot, DRAFT_SOURCES[season]), "utf8"),
  ]);
  const poolRows = parseCsv(poolText).flatMap((row) => {
    const candidatePosition = position(row.Pos);
    if (!POSITIONS.includes(candidatePosition) || !nameKey(row.Player)) return [];
    return [{
      key: `${candidatePosition}|${nameKey(row.Player)}`,
      name: row.Player,
      position: candidatePosition,
      points: finite(row.Points),
      sourceAuction: Math.max(1, finite(row.DynAuction, finite(row.Auction, 1))),
    }];
  });
  const keepers = new Set(parseCsv(draftText)
    .filter((row) => String(row.Status || "").trim().toLowerCase() === "keeper")
    .map((row) => `${position(row.Pos)}|${nameKey(row.Player)}`));
  const available = poolRows.filter((row) => !keepers.has(row.key));
  const rankByKey = new Map();
  for (const candidatePosition of POSITIONS) {
    available.filter((row) => row.position === candidatePosition)
      .sort((left, right) => right.points - left.points || left.key.localeCompare(right.key))
      .forEach((row, index) => rankByKey.set(row.key, index + 1));
  }
  const poolByKey = new Map(poolRows.map((row) => [row.key, row]));
  const curves = buildCurve(purchases, season, halfLife);
  return purchases.filter((row) => row.season === season).flatMap((row) => {
    const key = `${row.position}|${nameKey(row.playerName)}`;
    const pool = poolByKey.get(key);
    const rank = rankByKey.get(key);
    if (!pool || !rank) return [];
    const history = curvePrice(curves, row.position, rank);
    return [{
      season,
      position: row.position,
      playerName: row.playerName,
      rank,
      actual: row.salary,
      source: pool.sourceAuction,
      history,
    }];
  });
}

const purchases = parseCsv(await readFile(normalizedPurchasesPath, "utf8")).map((row) => ({
  season: Number(row.season),
  position: position(row.position),
  playerName: row.player_name,
  salary: Number(row.salary),
}));
const includedSeasons = [...new Set(purchases.map((row) => row.season))].sort((left, right) => left - right);

const curveStability = [];
for (const halfLife of HALF_LIVES) {
  const errors = [];
  for (const testSeason of includedSeasons) {
    const trainingSeasons = includedSeasons.filter((season) => season < testSeason);
    if (trainingSeasons.length < 2) continue;
    const curves = buildCurve(purchases, testSeason, halfLife);
    for (const candidatePosition of POSITIONS) {
      const actual = purchases.filter((row) => row.season === testSeason && row.position === candidatePosition)
        .map((row) => row.salary).sort((left, right) => right - left);
      actual.forEach((price, index) => errors.push(Math.abs(price - curvePrice(curves, candidatePosition, index + 1))));
    }
  }
  curveStability.push({ halfLife, rows: errors.length, mae: errors.reduce((sum, value) => sum + value, 0) / errors.length });
}
const selectedHalfLife = curveStability.sort((left, right) => left.mae - right.mae || left.halfLife - right.halfLife)[0].halfLife;

const projectionRows = (await Promise.all(Object.keys(PROJECTION_SOURCES).map((season) => projectionFold(Number(season), purchases, selectedHalfLife)))).flat();
const blendBacktest = BLEND_WEIGHTS.map((historyWeight) => {
  const rows = projectionRows.map((row) => ({ ...row, blended: row.source * (1 - historyWeight) + row.history * historyWeight }));
  const premium = rows.filter((row) => row.actual >= 5);
  return {
    historyWeight,
    rows: rows.length,
    premiumRows: premium.length,
    sourceMae: meanAbsoluteError(rows, "source"),
    historyMae: meanAbsoluteError(rows, "history"),
    blendedMae: meanAbsoluteError(rows, "blended"),
    premiumBlendedMae: meanAbsoluteError(premium, "blended"),
  };
});
const selectedBlend = blendBacktest.sort((left, right) => (
  (left.blendedMae + left.premiumBlendedMae) - (right.blendedMae + right.premiumBlendedMae)
  || left.historyWeight - right.historyWeight
))[0];
const finalCurves = buildCurve(purchases, REFERENCE_SEASON, selectedHalfLife);

const report = {
  schemaVersion: 1,
  modelVersion: "thunder-auction-price-curve-v1",
  generatedAt: new Date().toISOString(),
  authority: "historical league market estimate only; intrinsic VBD remains unchanged",
  includedSeasons,
  purchaseRows: purchases.length,
  curveStability,
  selectedHalfLife,
  projectionBacktestSeasons: Object.keys(PROJECTION_SOURCES).map(Number),
  projectionMatchedRows: projectionRows.length,
  blendBacktest,
  selectedHistoricalCurveWeight: selectedBlend.historyWeight,
  selectedMetrics: selectedBlend,
  topFiveSeasonMeans: topFiveSeasonMeans(purchases),
  priceCurves: finalCurves,
};

const profile = {
  schemaVersion: 1,
  modelVersion: report.modelVersion,
  generatedAt: report.generatedAt,
  authority: report.authority,
  seasons: includedSeasons,
  purchaseRows: purchases.length,
  recencyHalfLifeSeasons: selectedHalfLife,
  historicalCurveWeight: selectedBlend.historyWeight,
  priceCurves: Object.fromEntries(POSITIONS.map((candidatePosition) => [candidatePosition, finalCurves[candidatePosition].map((row) => ({
    rank: row.rank,
    mean: Number(row.mean.toFixed(3)),
    low: Number(row.low.toFixed(3)),
    high: Number(row.high.toFixed(3)),
    seasons: row.seasons,
  }))])),
};

for (const [path, content] of [
  [reportPath, JSON.stringify(report, null, 2) + "\n"],
  [modulePath, `// Generated by scripts/build-auction-price-curve.mjs.\nconst profile = ${JSON.stringify(profile, null, 2)};\nObject.freeze(profile.seasons);\nfor (const curve of Object.values(profile.priceCurves)) {\n  curve.forEach(Object.freeze);\n  Object.freeze(curve);\n}\nObject.freeze(profile.priceCurves);\nexport const THUNDER_AUCTION_PRICE_PROFILE = Object.freeze(profile);\n`],
]) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

console.log(JSON.stringify({
  includedSeasons,
  purchaseRows: purchases.length,
  selectedHalfLife,
  selectedHistoricalCurveWeight: selectedBlend.historyWeight,
  projectionMatchedRows: projectionRows.length,
  selectedMetrics: selectedBlend,
  reportPath,
  modulePath,
}, null, 2));
