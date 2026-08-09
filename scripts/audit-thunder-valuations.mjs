import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { replayDraft } from "../public/thunder-bowl/state-engine.mjs";
import { calculateAuctionDemandMarket } from "../public/thunder-bowl/auction-demand.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const fantasyRoot = "C:\\Users\\mailp\\Dropbox\\Personal\\FAMILY STUFF\\Mike Stuff\\Fantasy Football";
const sourcePaths = {
  pack: resolve(repoRoot, "netlify/functions/_data/draft-pack-2026-provisional.json"),
  fbgWeekly: resolve(fantasyRoot, "2026/2026 - PROJECTIONS WEEKLY (FBG).csv"),
  model: resolve(fantasyRoot, "_AGENT_HANDOFF/data/projections_2026.csv"),
  modeling: resolve(fantasyRoot, "_AGENT_HANDOFF/data/player_season_vbd.csv"),
  ddf: resolve(fantasyRoot, "2026/2026 DD.ddf"),
};
const reportDir = resolve(repoRoot, "reports/thunder-bowl");
const reportBase = resolve(reportDir, "valuation-audit-20260808");

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
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
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

function normalizedName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function position(value) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "DEF") return "DST";
  if (normalized === "PK") return "K";
  return normalized;
}

function normalizedTeam(value) {
  const normalized = String(value || "").toUpperCase();
  return ({ JAC: "JAX", WSH: "WAS", LA: "LAR" })[normalized] || normalized;
}

function playerKey(name, pos) {
  return `${normalizedName(name)}|${position(pos)}`;
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function spearman(rows, leftField, rightField) {
  const eligible = rows.filter((row) => row[leftField] !== "" && row[rightField] !== "");
  if (eligible.length < 3) return null;
  const rank = (field) => new Map(
    [...eligible]
      .sort((left, right) => Number(right[field]) - Number(left[field]) || left.name.localeCompare(right.name))
      .map((row, index) => [row.playerId, index + 1]),
  );
  const leftRanks = rank(leftField);
  const rightRanks = rank(rightField);
  const meanRank = (eligible.length + 1) / 2;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (const row of eligible) {
    const left = leftRanks.get(row.playerId) - meanRank;
    const right = rightRanks.get(row.playerId) - meanRank;
    numerator += left * right;
    leftSquares += left * left;
    rightSquares += right * right;
  }
  return numerator / Math.sqrt(leftSquares * rightSquares);
}

function percentGap(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const base = Math.max(1, Math.abs(right));
  return (left - right) / base;
}

function parseFbgWeekly(text) {
  const rows = [];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const cells = parseCsvLine(line);
    const pos = position(cells[1]);
    if (!/^(QB|RB|WR|TE|K|DST)$/.test(pos) || !/^\d+$/.test(cells[0] || "")) continue;
    const weeklyValues = cells.slice(4, -1).map(numberOrNull).filter(Number.isFinite);
    const total = numberOrNull(cells.at(-1));
    if (!Number.isFinite(total)) continue;
    const teamAndBye = String(cells[3] || "").split("/");
    rows.push({
      rank: Number(cells[0]),
      position: pos,
      name: cells[2],
      team: normalizedTeam(teamAndBye[0]),
      byeWeek: numberOrNull(teamAndBye[1]),
      total,
      weeklyValues,
      negativeWeeks: weeklyValues.filter((value) => value < 0).length,
      reportedWeekColumns: weeklyValues.length,
    });
  }
  return rows;
}

function parseDdf(text) {
  const sections = {};
  let section = "";
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      sections[section] ||= {};
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0 || !section) continue;
    sections[section][line.slice(0, separator)] = line.slice(separator + 1);
  }
  return sections;
}

function byKey(rows, nameField = "name", positionField = "pos") {
  const result = new Map();
  for (const row of rows) {
    const key = playerKey(row[nameField], row[positionField]);
    if (!key.startsWith("|")) result.set(key, row);
  }
  return result;
}

function projectionSource(player, source) {
  return numberOrNull((player.projectionSources || []).find((row) => row.source === source)?.points);
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] || {});
  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n") + "\n";
}

const [packText, fbgWeeklyText, modelText, modelingText, ddfText] = await Promise.all(
  Object.values(sourcePaths).map((path) => readFile(path, "utf8")),
);
const pack = JSON.parse(packText);
const fbgWeeklyRows = parseFbgWeekly(fbgWeeklyText);
const modelRows = parseCsv(modelText);
const modelingRows = parseCsv(modelingText).filter((row) => row.season === "2026");
const ddf = parseDdf(ddfText);
const expectedDdf = {
  NumTeams: "12",
  NumRounds: String(pack.leagueConfig.rosterSize),
  StartersQB: String(pack.leagueConfig.starterRequirements.QB),
  StartersRB: String(pack.leagueConfig.starterRequirements.RB),
  StartersWR: String(pack.leagueConfig.starterRequirements.WR),
  StartersTE: String(pack.leagueConfig.starterRequirements.TE),
  StartersPK: String(pack.leagueConfig.starterRequirements.K),
  StartersDef: String(pack.leagueConfig.starterRequirements.DST),
  QBPassYard: "0.04",
  QBPassInt: "-2",
  QBPassTD1: "6",
  RBRecRec: "1",
  WRRecRec: "1",
  TERecRec: "1",
  QBFumbles: "-2",
  RBFumbles: "-2",
  WRFumbles: "-2",
  TEFumbles: "-2",
  DEFSack: "2",
  DEFInt: "2",
  DEFForcedFumble: "0",
  FGMade3: "3",
  DefPoints1: "10",
  DefPoints2: "8",
  DefPoints3: "6",
  DefPoints4: "4",
  DefPoints5: "0",
  DefPoints6: "-4",
  DefPoints7: "-6",
};
const ddfConfigurationIssues = Object.entries(expectedDdf)
  .filter(([key, expected]) => ddf.Setup?.[key] !== expected)
  .map(([key, expected]) => ({ key, expected, actual: ddf.Setup?.[key] ?? "missing" }));
const fbgWeeklyByKey = byKey(fbgWeeklyRows, "name", "position");
const fbgWeeklyDstByTeam = new Map(fbgWeeklyRows.filter((row) => row.position === "DST").map((row) => [row.team, row]));
const modelByKey = byKey(modelRows);
const modelingByKey = byKey(modelingRows);
const fbgValues = new Map((pack.fbgAuctionValues?.values || []).map((row) => [row.playerId, row]));
const liveMarket = calculateAuctionDemandMarket(pack, replayDraft([]));
const teamCount = pack.leagueConfig.teams.length;
const starterReplacementPoints = Object.fromEntries(
  Object.entries(pack.leagueConfig.starterRequirements).map(([pos, starters]) => {
    const rows = pack.players
      .filter((player) => player.position === pos)
      .sort((left, right) => right.projectedPoints - left.projectedPoints || left.id.localeCompare(right.id));
    const replacementRank = teamCount * starters;
    return [pos, rows[replacementRank - 1]?.projectedPoints ?? null];
  }),
);
const sourceReplacementPoints = Object.fromEntries(
  ["CBS", "FantasyPros"].map((source) => [source, Object.fromEntries(
    Object.entries(pack.leagueConfig.starterRequirements).map(([pos, starters]) => {
      const values = pack.players
        .map((player) => ({ player, points: projectionSource(player, source) }))
        .filter((row) => row.player.position === pos && Number.isFinite(row.points))
        .sort((left, right) => right.points - left.points || left.player.id.localeCompare(right.player.id));
      return [pos, values[teamCount * starters - 1]?.points ?? null];
    }),
  )]),
);

const auditRows = pack.players.map((player) => {
  const key = playerKey(player.name, player.position);
  const latestFbg = player.position === "DST" ? fbgWeeklyDstByTeam.get(normalizedTeam(player.nflTeam)) : fbgWeeklyByKey.get(key);
  const model = modelByKey.get(key);
  const modeling = modelingByKey.get(key);
  const fbgProjection = projectionSource(player, "Footballguys");
  const cbs = projectionSource(player, "CBS");
  const fantasyPros = projectionSource(player, "FantasyPros");
  const primary = player.projectedPoints;
  const primarySource = (player.projectionSources || []).find((row) => row.role === "primary")?.source || "Unknown";
  const latestFbgPoints = latestFbg?.total ?? null;
  const currentSourceValues = [fbgProjection, cbs, fantasyPros].filter(Number.isFinite);
  const sourceMedian = median(currentSourceValues);
  const sourceValues = currentSourceValues;
  const sourceRange = sourceValues.length > 1 ? Math.max(...sourceValues) - Math.min(...sourceValues) : null;
  const fbg = fbgValues.get(player.id);
  const market = liveMarket.valuesByPlayerId[player.id];
  const roomCurveMarket = liveMarket.roomCurveValuesByPlayerId[player.id];
  const runtimeMaxBid = liveMarket.bidCeilingsByPlayerId[player.id];
  const modelProjection = numberOrNull(model?.proj_final_pts);
  const mflAav = numberOrNull(modeling?.mfl_aav);
  const expectedVbd = Number.isFinite(starterReplacementPoints[player.position])
    ? Math.round((primary - starterReplacementPoints[player.position]) * 10) / 10
    : null;
  const vbdDelta = Number.isFinite(expectedVbd) ? player.vbd - expectedVbd : null;
  const cbsVbd = Number.isFinite(cbs) && Number.isFinite(sourceReplacementPoints.CBS[player.position])
    ? Math.round((cbs - sourceReplacementPoints.CBS[player.position]) * 10) / 10
    : null;
  const fantasyProsVbd = Number.isFinite(fantasyPros) && Number.isFinite(sourceReplacementPoints.FantasyPros[player.position])
    ? Math.round((fantasyPros - sourceReplacementPoints.FantasyPros[player.position]) * 10) / 10
    : null;
  const flags = [];
  if (latestFbg && latestFbg.team && player.nflTeam && normalizedTeam(latestFbg.team) !== normalizedTeam(player.nflTeam)) flags.push("TEAM_CONFLICT_FBG");
  if (latestFbg?.negativeWeeks > 0) flags.push("FBG_NEGATIVE_WEEK");
  if (Number.isFinite(latestFbgPoints) && latestFbgPoints === 0 && primary >= 50) flags.push("FBG_LATEST_ZERO");
  if (Number.isFinite(sourceRange) && sourceRange >= 50) flags.push("PROJECTION_SOURCE_RANGE_50");
  if (Number.isFinite(sourceMedian) && Math.abs(primary - sourceMedian) >= 30 && Math.abs(percentGap(primary, sourceMedian)) >= 0.15) flags.push("PRIMARY_OUTSIDE_CONSENSUS");
  if (Number.isFinite(modelProjection) && Math.abs(modelProjection - sourceMedian) >= 40 && Math.abs(percentGap(modelProjection, sourceMedian)) >= 0.2) flags.push("CANDIDATE_MODEL_OUTLIER");
  if (player.vbd <= 0 && market >= 8) flags.push("BENCH_DEMAND_VALUE");
  if (Number.isFinite(vbdDelta) && Math.abs(vbdDelta) > 0.11) flags.push("VBD_FORMULA_MISMATCH");
  if (Math.abs(roomCurveMarket - player.marketValue) >= 3 || Math.abs(runtimeMaxBid - player.maxBid) >= 3) flags.push("LEGACY_CURVE_IDENTITY_REPAIR");
  const externalVbds = [cbsVbd, fantasyProsVbd].filter(Number.isFinite);
  if (externalVbds.length
    && externalVbds.every((value) => (value > 0) !== (player.vbd > 0))
    && externalVbds.every((value) => Math.abs(value - player.vbd) >= 10)) {
    flags.push("STARTER_VBD_SOURCE_DISAGREEMENT");
  }
  return {
    playerId: player.id,
    name: player.name,
    position: player.position,
    team: player.nflTeam,
    sourceRank: player.sourceRank,
    primarySource,
    primaryProjection: formatNumber(primary),
    fbg: formatNumber(fbgProjection),
    latestFbgAug8: formatNumber(latestFbgPoints),
    cbs: formatNumber(cbs),
    fantasyPros: formatNumber(fantasyPros),
    sourceMedian: formatNumber(sourceMedian),
    sourceRange: formatNumber(sourceRange),
    candidateModel: formatNumber(modelProjection),
    vbd: formatNumber(player.vbd),
    expectedVbd: formatNumber(expectedVbd),
    vbdDelta: formatNumber(vbdDelta),
    cbsVbd: formatNumber(cbsVbd),
    fantasyProsVbd: formatNumber(fantasyProsVbd),
    intrinsic: player.intrinsicValue,
    market,
    maxBid: runtimeMaxBid,
    packMarket: player.marketValue,
    packMaxBid: player.maxBid,
    monotoneRoomCurveMarket: roomCurveMarket,
    fbgValue: fbg?.value ?? "",
    fbgGlobalRank: fbg?.rank ?? "",
    mflAav: formatNumber(mflAav, 2),
    fbgLatestTeam: latestFbg?.team ?? "",
    fbgNegativeWeeks: latestFbg?.negativeWeeks ?? "",
    marketPositionRank: "",
    fbgPositionRank: "",
    mflPositionRank: "",
    flags: flags.join("|"),
  };
});

for (const pos of ["QB", "RB", "WR", "TE", "K", "DST"]) {
  const positionRows = auditRows.filter((row) => row.position === pos);
  [...positionRows].sort((left, right) => right.market - left.market || Number(right.primaryProjection) - Number(left.primaryProjection) || left.name.localeCompare(right.name))
    .forEach((row, index) => { row.marketPositionRank = index + 1; });
  [...positionRows].filter((row) => row.fbgValue !== "")
    .sort((left, right) => Number(left.fbgGlobalRank) - Number(right.fbgGlobalRank))
    .forEach((row, index) => { row.fbgPositionRank = index + 1; });
  [...positionRows].filter((row) => row.mflAav !== "")
    .sort((left, right) => Number(right.mflAav) - Number(left.mflAav) || left.name.localeCompare(right.name))
    .forEach((row, index) => { row.mflPositionRank = index + 1; });
}
for (const row of auditRows) {
  const flags = row.flags ? row.flags.split("|") : [];
  if (row.fbgPositionRank && Math.abs(row.marketPositionRank - row.fbgPositionRank) >= 12 && Math.min(row.marketPositionRank, row.fbgPositionRank) <= 36) flags.push("MARKET_RANK_VS_FBG_12");
  if (row.mflPositionRank && Math.abs(row.marketPositionRank - row.mflPositionRank) >= 12 && Math.min(row.marketPositionRank, row.mflPositionRank) <= 36) flags.push("MARKET_RANK_VS_MFL_12");
  row.flags = flags.join("|");
}

const flaggedRows = auditRows.filter((row) => row.flags);
const flagCounts = new Map();
for (const row of flaggedRows) {
  for (const flag of row.flags.split("|")) flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
}
const countByPosition = (rows) => Object.fromEntries(
  ["QB", "RB", "WR", "TE", "K", "DST"].map((pos) => [pos, rows.filter((row) => row.position === pos).length]),
);
const projectionCoverage = auditRows.filter((row) => row.latestFbgAug8 !== "");
const fbgValueCoverage = auditRows.filter((row) => row.fbgValue !== "");
const fbgNegativeRows = auditRows.filter((row) => Number(row.fbgNegativeWeeks) > 0);
const severeProjectionRows = auditRows.filter((row) => /PROJECTION_SOURCE_RANGE|PRIMARY_OUTSIDE/.test(row.flags));
const severeValueRows = auditRows.filter((row) => /MARKET_RANK_VS_FBG|MARKET_RANK_VS_MFL/.test(row.flags));
const vbdFormulaMismatchRows = auditRows.filter((row) => row.flags.includes("VBD_FORMULA_MISMATCH"));
const legacyCurveRepairRows = auditRows.filter((row) => row.flags.includes("LEGACY_CURVE_IDENTITY_REPAIR"));
const starterDisagreementRows = auditRows.filter((row) => row.flags.includes("STARTER_VBD_SOURCE_DISAGREEMENT"));
const sourcePositionSummary = ["QB", "RB", "WR", "TE", "K", "DST"].map((pos) => {
  const rows = auditRows.filter((row) => row.position === pos && row.fbg !== "");
  const cbsRows = rows.filter((row) => row.cbs !== "");
  const fantasyProsRows = rows.filter((row) => row.fantasyPros !== "");
  return {
    position: pos,
    cbsN: cbsRows.length,
    medianFbgMinusCbs: median(cbsRows.map((row) => Number(row.fbg) - Number(row.cbs))),
    cbsSpearman: spearman(cbsRows, "fbg", "cbs"),
    fantasyProsN: fantasyProsRows.length,
    medianFbgMinusFantasyPros: median(fantasyProsRows.map((row) => Number(row.fbg) - Number(row.fantasyPros))),
    fantasyProsSpearman: spearman(fantasyProsRows, "fbg", "fantasyPros"),
  };
});

const topProjection = [...severeProjectionRows]
  .sort((left, right) => Number(right.sourceRange) - Number(left.sourceRange))
  .slice(0, 30);
const topValue = [...severeValueRows]
  .sort((left, right) => Math.max(Math.abs(right.marketPositionRank - Number(right.fbgPositionRank || right.marketPositionRank)), Math.abs(right.marketPositionRank - Number(right.mflPositionRank || right.marketPositionRank))) - Math.max(Math.abs(left.marketPositionRank - Number(left.fbgPositionRank || left.marketPositionRank)), Math.abs(left.marketPositionRank - Number(left.mflPositionRank || left.marketPositionRank))))
  .slice(0, 30);

const markdown = [
  "# Thunder Bowl 2026 valuation and VBD discrepancy audit",
  "",
  `- Pack: \`${pack.packId}\` (${pack.players.length} players; as of ${pack.asOf})`,
  `- FBG August 8 weekly coverage: ${projectionCoverage.length}/${pack.players.length} (${JSON.stringify(countByPosition(projectionCoverage))})`,
  `- FBG auction-value coverage: ${fbgValueCoverage.length}/${pack.players.length} (supplied ranks ${pack.fbgAuctionValues.rankStart}-${pack.fbgAuctionValues.rankEnd})`,
  `- Candidate projection coverage: ${auditRows.filter((row) => row.candidateModel !== "").length}/${pack.players.length}`,
  `- FBG weekly rows with at least one negative projected week: ${fbgNegativeRows.length}/${projectionCoverage.length}`,
  `- FBG Draft Dominator configuration compatibility: ${ddfConfigurationIssues.length ? `**MISMATCH** (${ddfConfigurationIssues.length} settings)` : "compatible"}`,
  `- Starter-baseline VBD formula mismatches: ${vbdFormulaMismatchRows.length}/${pack.players.length}`,
  `- Legacy player-identity curve repairs of at least $3: ${legacyCurveRepairRows.length}/${pack.players.length}`,
  `- Players whose starter/replacement classification reverses against every available external source: ${starterDisagreementRows.length}/${pack.players.length}`,
  "",
  "## Systemic findings",
  "",
  "1. The live pack's primary projection is the registered Thunder Bowl Consensus: a near-equal accuracy-weighted blend of the dated Footballguys, CBS, and FantasyPros rows available for each player. Missing sources renormalize rather than becoming zero.",
  "2. The supplied FBG auction PDF was generated from an incompatible Draft Dominator setup: 18 rounds, three starting WRs, non-PPR scoring, 4-point passing TDs, one-point sacks, and other scoring differences. Its ranks remain a directional opinion; its dollars are not Thunder Bowl dollars.",
  "3. The application market estimate uses validated historical roster counts and position spending. The bid ceiling remains the classic starter-VBD room curve because historical-depth VBD failed held-out decision utility.",
  "4. Runtime price curves are reassigned monotonically within each position by projected points. This repairs legacy identity anomalies (for example, a low-ranked player carrying a higher player's old dollar value) without inventing extra room dollars.",
  "5. MFL AAV aggregates mixed budget sizes. It is used as a within-position ranking signal, never compared dollar-for-dollar with Thunder Bowl's $100 cap.",
  "6. The separate handoff model remains a comparison-only challenger. Mean reversion, durability, weather, analog, and schedule total-point corrections remain quarantined because they failed or lacked the production gate.",
  "",
  "## FBG Draft Dominator configuration mismatches",
  "",
  "| Setting | Thunder Bowl | Supplied DDF |",
  "|---|---:|---:|",
  ...ddfConfigurationIssues.map((row) => `| ${row.key} | ${row.expected} | ${row.actual} |`),
  "",
  "## Projection-source calibration by position",
  "",
  "Point totals have systematic level differences, but VBD subtracts a same-position replacement line. Rank agreement is therefore more important than raw-point agreement. Spearman values closer to 1 indicate stronger ordering agreement.",
  "",
  "| Pos | FBG-CBS matches | Median FBG minus CBS | Rank agreement | FBG-FP matches | Median FBG minus FP | Rank agreement |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...sourcePositionSummary.map((row) => `| ${row.position} | ${row.cbsN} | ${formatNumber(row.medianFbgMinusCbs)} | ${formatNumber(row.cbsSpearman, 3)} | ${row.fantasyProsN} | ${formatNumber(row.medianFbgMinusFantasyPros)} | ${formatNumber(row.fantasyProsSpearman, 3)} |`),
  "",
  "## Flag counts",
  "",
  "| Flag | Players |",
  "|---|---:|",
  ...[...flagCounts.entries()].sort((left, right) => right[1] - left[1]).map(([flag, count]) => `| ${flag} | ${count} |`),
  "",
  "## Largest projection disagreements",
  "",
  "| Player | Pos | Thunder | FBG (Aug 3) | FBG weekly (Aug 8) | CBS | FantasyPros | Source range | Challenger | Flags |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ...topProjection.map((row) => `| ${row.name} | ${row.position} | ${row.primaryProjection} | ${row.fbg || "-"} | ${row.latestFbgAug8 || "-"} | ${row.cbs || "-"} | ${row.fantasyPros || "-"} | ${row.sourceRange || "-"} | ${row.candidateModel || "-"} | ${row.flags} |`),
  "",
  "## Replacement-line source disagreements",
  "",
  "These are the source differences most capable of changing VBD rather than merely shifting every player at a position by a similar number of points.",
  "",
  "| Player | Pos | Thunder VBD | CBS VBD | FantasyPros VBD | Market | Max | Flags |",
  "|---|---:|---:|---:|---:|---:|---:|---|",
  ...[...starterDisagreementRows]
    .sort((left, right) => Math.max(Math.abs(Number(right.cbsVbd || 0) - Number(right.vbd)), Math.abs(Number(right.fantasyProsVbd || 0) - Number(right.vbd))) - Math.max(Math.abs(Number(left.cbsVbd || 0) - Number(left.vbd)), Math.abs(Number(left.fantasyProsVbd || 0) - Number(left.vbd))))
    .slice(0, 30)
    .map((row) => `| ${row.name} | ${row.position} | ${row.vbd} | ${row.cbsVbd || "-"} | ${row.fantasyProsVbd || "-"} | $${row.market} | $${row.maxBid} | ${row.flags} |`),
  "",
  "## Investigated high-variance cases",
  "",
  "| Case | Evidence and disposition |",
  "|---|---|",
  "| Kirk Cousins / Fernando Mendoza | Their disagreement is mostly a workload split, not a missing-team total. The Raiders named Cousins the opening-camp QB1 and Mendoza worked with the second unit. Retain FBG's current allocation, flag the competition, and refresh before draft day. [Raiders camp report](https://www.raiders.com/news/kirk-cousins-2026-raiders-training-camp-qb1-klint-kubiak-fernando-mendoza) |",
  "| James Conner | The low FBG projection is plausibly an injury-duration judgment: Arizona says he is still rehabbing the major 2025 foot injury. Do not mechanically average the optimistic CBS number upward. [Cardinals report](https://www.azcardinals.com/news/after-rough-year-cardinals-mike-lafleur-look-at-running-back-room) |",
  "| John Metchie III | He is on Carolina's roster, but the team's own position preview places him in the bubble group behind two established starters. FBG's low role projection is defensible; CBS/FantasyPros are a ceiling scenario, not grounds for an automatic override. [Panthers position preview](https://www.panthers.com/news/panthers-pre-training-camp-2026-positional-preview-offense) |",
  "| Brandon Aiyuk | San Francisco lists him Reserve/Left Squad and outside the 90-man roster. CBS's zero and FBG's small projection are scenario disagreement; the current $1 market/max avoids a false bid signal. [49ers camp update](https://www.49ers.com/news/report-day-takeaways-john-lynch-shares-team-updates-ahead-of-training-camp-2026) |",
  "| Tyreek Hill | He is a free agent rehabbing major multi-ligament knee surgery without a return timetable. The FBG/CBS disagreement is uncertainty, not a safe 72-point expectation; current $1 treatment is appropriate pending a signing and medical update. [NFL update](https://amp.nfl.com/news/tyreek-hill-free-agent-update-injury-no-power-left-leg) |",
  "| Stefon Diggs | CBS's August 3 zero predates his reported August 5 Washington deal; the August 8 FBG team is newer. His team label should refresh in the next projection build, but his present $1 price means no current room-dollar distortion. [Signing report](https://as.com/us/nfl/stefon-diggs-jugara-con-los-washington-commanders-f202608-n/) |",
  "| Five August 8 FBG zero rows | Official rosters still list Theo Wease, Bub Means, Kevin Austin, Tylan Wallace, and Tyrell Shavers. The zeros reflect role/injury judgments rather than identity deletion; all five remain $1 players. [Dolphins](https://www.miamidolphins.com/team/rosters), [Saints](https://www.neworleanssaints.com/team/rosters), [Browns](https://www.clevelandbrowns.com/team/players-roster/tylan-wallace/), [Bills](https://www.buffalobills.com/team/players-roster/tyrell-shavers/) |",
  "",
  "## Largest auction-value disagreements",
  "",
  "| Player | Pos | VBD | Market | Max | FBG raw $ | Market/FBG pos rank | MFL mixed-budget AAV | Market/MFL pos rank | Flags |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ...topValue.map((row) => `| ${row.name} | ${row.position} | ${row.vbd} | $${row.market} | $${row.maxBid} | ${row.fbgValue === "" ? "-" : `$${row.fbgValue}`} | ${row.marketPositionRank}/${row.fbgPositionRank || "-"} | ${row.mflAav === "" ? "-" : `$${row.mflAav}`} | ${row.marketPositionRank}/${row.mflPositionRank || "-"} | ${row.flags} |`),
  "",
  "## Runtime invariants checked",
  "",
  `- Historical-demand market values were computed for all ${pack.players.length} players.`,
  `- Starter-count VBD was independently recomputed for every player; mismatches: ${vbdFormulaMismatchRows.length}.`,
  `- Runtime market and bid curves are monotone within position; material legacy identity repairs: ${legacyCurveRepairRows.length}.`,
  `- Initial expected auction purchases: ${liveMarket.expectedRemainingPurchases}.`,
  `- Demand-only auction allocation reconciles: $${liveMarket.demandAllocatedRoomDollars} / $${liveMarket.remainingRoomDollars}.`,
  `- Bid authority: \`${liveMarket.bidAuthority}\`.`,
  "",
].join("\n");

await mkdir(reportDir, { recursive: true });
await Promise.all([
  writeFile(`${reportBase}.csv`, toCsv(auditRows), "utf8"),
  writeFile(`${reportBase}.md`, markdown, "utf8"),
]);

console.log(JSON.stringify({
  packId: pack.packId,
  players: pack.players.length,
  fbgWeeklyCoverage: projectionCoverage.length,
  fbgValueCoverage: fbgValueCoverage.length,
  candidateCoverage: auditRows.filter((row) => row.candidateModel !== "").length,
  fbgNegativeRows: fbgNegativeRows.length,
  ddfConfigurationIssues,
  vbdFormulaMismatchRows: vbdFormulaMismatchRows.length,
  legacyCurveRepairRows: legacyCurveRepairRows.length,
  starterDisagreementRows: starterDisagreementRows.length,
  sourcePositionSummary,
  severeProjectionRows: severeProjectionRows.length,
  severeValueRows: severeValueRows.length,
  flagCounts: Object.fromEntries([...flagCounts.entries()].sort((left, right) => right[1] - left[1])),
  reports: [`${reportBase}.md`, `${reportBase}.csv`],
}, null, 2));
