import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_POSITION_RUN_CONFIG, detectPositionRun } from "../public/thunder-bowl/position-run.mjs";
import { validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const fantasyRoot = process.env.THUNDER_FANTASY_ROOT
  || join(process.env.USERPROFILE || "C:\\Users\\mailp", "Dropbox", "Personal", "FAMILY STUFF", "Mike Stuff", "Fantasy Football");
const reportDirectory = join(root, "reports", "thunder-bowl");
const candidateFiles = [
  [2012, join(fantasyRoot, "2012", "2012 - DRAFT SUMMARY.csv")],
  [2014, join(fantasyRoot, "2014", "2014 - DRAFT SUMMARY.csv")],
  [2015, join(fantasyRoot, "2015", "2015 - DRAFT SUMMARY.csv")],
  [2017, join(fantasyRoot, "2017", "DraftDominator", "2017 - DRAFT SUMMARY.csv")],
  [2018, join(fantasyRoot, "2018", "DraftDominator", "2018 - DRAFT SUMMARY.csv")],
  [2023, join(fantasyRoot, "2023", "DraftDominator", "2023 - DRAFT SUMMARY.csv")],
];
const positions = ["QB", "RB", "WR", "TE", "K", "DST"];

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(current);
      current = "";
    } else current += character;
  }
  cells.push(current);
  return cells;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 1;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function loadSeason(year, path) {
  if (!existsSync(path)) return null;
  const lines = (await readFile(path, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((column, index) => [column, cells[index] ?? ""]));
  })
    .filter((row) => !/keeper/i.test(row.Status || ""))
    .map((row) => ({
      position: String(row.Pos || "").toUpperCase().replace(/\d+.*$/, ""),
      amount: Number(row["Amt Paid"]),
      name: row.Player,
    }))
    .filter((row) => positions.includes(row.position) && Number.isFinite(row.amount) && row.amount >= 1);
  if (rows.length < 80) return null;
  const history = [];
  const sales = rows.map((sale) => {
    const samePosition = history.filter((prior) => prior.position === sale.position).slice(-8).map((prior) => prior.amount);
    const allPrior = history.slice(-18).map((prior) => prior.amount);
    const expectedPrice = samePosition.length >= 3 ? median(samePosition) : allPrior.length >= 6 ? median(allPrior) : sale.amount;
    const normalized = { ...sale, expectedPrice };
    history.push(normalized);
    return normalized;
  });
  return { year, path, sales };
}

function actualContinuation(season, index, position, expectedShare) {
  const future = season.sales.slice(index + 1, index + 4);
  if (!future.length) return false;
  const matching = future.filter((sale) => sale.position === position);
  const futureShare = matching.length / future.length;
  const overpay = matching.length ? matching.reduce((sum, sale) => sum + sale.amount - sale.expectedPrice, 0) / matching.length : 0;
  return futureShare >= Math.min(1, Math.max(0.5, expectedShare * 2)) || overpay >= 2;
}

function evaluate(seasons, config) {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  let predictions = 0;
  for (const season of seasons) {
    for (let index = config.minimumObservedSales - 1; index < season.sales.length - 1; index += 1) {
      const prior = season.sales.slice(0, index + 1);
      for (const position of positions) {
        const remainingSupply = season.sales.slice(index + 1).filter((sale) => sale.position === position).length;
        const result = detectPositionRun({
          sales: prior,
          position,
          tierSupply: remainingSupply,
          referencePrice: median(prior.filter((sale) => sale.position === position).slice(-8).map((sale) => sale.amount)),
          config,
        });
        const actual = actualContinuation(season, index, position, config.expectedShare[position]);
        predictions += 1;
        if (result.active && actual) truePositive += 1;
        else if (result.active) falsePositive += 1;
        else if (actual) falseNegative += 1;
        else trueNegative += 1;
      }
    }
  }
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  const f1 = 2 * precision * recall / Math.max(0.000001, precision + recall);
  return {
    config: {
      decay: config.decay,
      intensityThreshold: config.intensityThreshold,
      priceThreshold: config.priceThreshold,
    },
    predictions,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    activeRate: round((truePositive + falsePositive) / Math.max(1, predictions)),
  };
}

const seasons = (await Promise.all(candidateFiles.map(([year, path]) => loadSeason(year, path)))).filter(Boolean);
if (seasons.length < 4) throw new Error("At least four complete chronological auction summaries are required for position-run tuning.");
const totalByPosition = Object.fromEntries(positions.map((position) => [position, seasons.reduce((sum, season) => sum + season.sales.filter((sale) => sale.position === position).length, 0)]));
const totalSales = Object.values(totalByPosition).reduce((sum, value) => sum + value, 0);
const expectedShare = Object.fromEntries(positions.map((position) => [position, totalByPosition[position] / totalSales]));
const results = [];
for (const decay of [0.65, 0.75, 0.85]) {
  for (const intensityThreshold of [1.15, 1.35, 1.55]) {
    for (const priceThreshold of [1, 2, 3]) {
      results.push(evaluate(seasons, {
        ...DEFAULT_POSITION_RUN_CONFIG,
        decay,
        intensityThreshold,
        priceThreshold,
        expectedShare,
      }));
    }
  }
}
results.sort((left, right) => right.f1 - left.f1 || right.precision - left.precision || left.activeRate - right.activeRate);
const replayPack = validateDraftPack(JSON.parse(await readFile(join(root, "netlify", "functions", "_data", "draft-pack-2025-replay.json"), "utf8")));
const report = {
  kind: "thunder-bowl-position-run-backtest-v1",
  generatedAt: new Date().toISOString(),
  detectorVersion: "position-run-v1",
  authority: "advisory_only",
  sourceSeasons: seasons.map((season) => ({ year: season.year, sales: season.sales.length, path: season.path })),
  totalSales,
  historicalExpectedShare: Object.fromEntries(Object.entries(expectedShare).map(([key, value]) => [key, round(value)])),
  target: "Predict whether the next three chronological sales continue a position frequency surge or +$2 overpay pressure.",
  selected: results[0],
  defaultConfiguration: evaluate(seasons, { ...DEFAULT_POSITION_RUN_CONFIG, expectedShare }),
  topConfigurations: results.slice(0, 10),
  replay2025: {
    packValidated: true,
    teams: replayPack.leagueConfig.teams.length,
    players: replayPack.players.length,
    orderedAuctionSalesAvailable: false,
    note: "The 2025 replay pack and supplied 2025 DraftDominator summary contain keeper setup but no complete chronological auction-sale sequence. It can verify UI, privacy, ledger, and cap behavior, but it cannot honestly tune a time-series run detector. Complete 2012, 2014, 2015, 2017, 2018, and 2023 chronological exports were used instead.",
  },
  gate: {
    minimumObservedSales: DEFAULT_POSITION_RUN_CONFIG.minimumObservedSales,
    maximumDollarImpact: DEFAULT_POSITION_RUN_CONFIG.maximumDollarImpact,
    maximumVbdImpact: DEFAULT_POSITION_RUN_CONFIG.maximumVbdImpact,
    liveAuthority: "Dollar/WTP advisory only; no direct authoritative VBD mutation.",
  },
};
const markdown = `# Position-run detector backtest\n\nGenerated: ${report.generatedAt}\n\n- Authority: advisory only\n- Complete chronological seasons: ${seasons.map((season) => season.year).join(", ")} (${totalSales} auction sales)\n- Selected parameters: decay ${report.selected.config.decay}, intensity ${report.selected.config.intensityThreshold}, overpay $${report.selected.config.priceThreshold}\n- Precision: ${(report.selected.precision * 100).toFixed(1)}%\n- Recall: ${(report.selected.recall * 100).toFixed(1)}%\n- F1: ${(report.selected.f1 * 100).toFixed(1)}%\n- Trigger rate: ${(report.selected.activeRate * 100).toFixed(1)}%\n- Safety: at least four confirmed sales; never one-sale triggered; +$3 / +3 VBD proposal caps. No direct authoritative VBD mutation.\n\n## 2025 replay limitation\n\n${report.replay2025.note}\n\n## Interpretation\n\nThis is a short-horizon continuation classifier, not proof that every active run should change intrinsic player value. The app may use its bounded dollar signal for rival willingness-to-pay and presentation. Authoritative VBD remains governed by the existing validated replacement and global cap paths.\n`;
await mkdir(reportDirectory, { recursive: true });
await Promise.all([
  writeFile(join(reportDirectory, "position-run-backtest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(join(reportDirectory, "position-run-backtest.md"), markdown, "utf8"),
]);
console.log(`Position-run backtest PASS: ${totalSales} sales; selected decay ${report.selected.config.decay}, intensity ${report.selected.config.intensityThreshold}, overpay $${report.selected.config.priceThreshold}; precision ${(report.selected.precision * 100).toFixed(1)}%, recall ${(report.selected.recall * 100).toFixed(1)}%.`);
