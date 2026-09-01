import test from "node:test";
import assert from "node:assert/strict";

import { readSeasonPack } from "../netlify/functions/_lib/season-pack.mjs";
import { parseFantasyProsAuthenticatedCapture, parsePffAuthenticatedCapture } from "../netlify/functions/_lib/supplemental-season-source.mjs";

const FP_HEADERS = {
  QB: ["PLAYER", "ATT", "CMP", "YDS", "TDS", "INTS", "ATT", "YDS", "TDS", "FL", "FPTS"],
  RB: ["PLAYER", "ATT", "YDS", "TDS", "REC", "YDS", "TDS", "FL", "FPTS"],
  WR: ["PLAYER", "REC", "YDS", "TDS", "ATT", "YDS", "TDS", "FL", "FPTS"],
  TE: ["PLAYER", "REC", "YDS", "TDS", "FL", "FPTS"],
  K: ["PLAYER", "FG", "FGA", "XPT", "FPTS"],
  DST: ["PLAYER", "SACK", "INT", "FR", "FF", "TD", "SAFETY", "PA", "YDS AGN", "FPTS"],
};

const FP_CELLS = {
  QB: ["30", "20", "250", "2", "1", "5", "25", "1", "0.5", "999"],
  RB: ["15", "80", "1", "4", "40", "0.5", "0.25", "999"],
  WR: ["5", "60", "0.5", "1", "5", "0", "0.1", "999"],
  TE: ["4", "40", "0.5", "0.1", "999"],
  K: ["2", "2.2", "3", "999"],
  DST: ["3", "1", "0.5", "1", "0.2", "0.05", "17", "330", "999"],
};

function baseCapture(provider) {
  return {
    schemaVersion: 1,
    provider,
    source: provider === "fantasyPros" ? "FantasyPros authenticated weekly component projections capture" : "PFF authenticated weekly component projections capture",
    modelEffect: "none",
    authenticated: true,
    capturedAt: "2026-08-31T18:00:00.000Z",
    providerAsOf: "2026-08-31T17:59:00.000Z",
    season: 2026,
    week: 1,
    pageUrl: provider === "fantasyPros" ? "https://www.fantasypros.com/nfl/projections/qb.php?week=1" : "https://www.pff.com/fantasy/projections",
  };
}

test("signed-in FantasyPros component tables are scored by Thunder Bowl rules, not FPTS", async () => {
  const pack = await readSeasonPack();
  const limits = { QB: 70, RB: 117, WR: 183, TE: 116, K: 32, DST: 32 };
  const selected = Object.fromEntries(Object.entries(limits).map(([position, limit]) => [position, pack.players.filter((player) => player.position === position).slice(0, limit)]));
  const rows = Object.entries(selected).flatMap(([position, players]) => players.map((player, index) => ({
    providerId: `${position}-${index}`,
    providerUrl: `https://www.fantasypros.com/nfl/projections/${encodeURIComponent(player.name)}.php?week=1`,
    playerName: player.name,
    nflTeam: position === "DST" ? "" : player.nflTeam,
    position,
    cells: FP_CELLS[position],
  })));
  const capture = {
    ...baseCapture("fantasyPros"),
    accountLeague: "Thunder Bowl",
    tables: Object.entries(selected).map(([position, players]) => ({ position, headers: FP_HEADERS[position], rowCount: players.length })),
    rows,
  };
  const negativeRushRow = capture.rows.find((row) => row.position === "QB");
  negativeRushRow.cells = [...negativeRushRow.cells];
  negativeRushRow.cells[6] = "-1.3";
  const snapshot = parseFantasyProsAuthenticatedCapture(capture, pack);
  assert.equal(snapshot.itemCount, rows.length);
  assert.equal(snapshot.unmatchedRowCount, 0);
  const quarterback = snapshot.items.find((item) => item.position === "QB");
  assert.equal(quarterback.providerPoints, 999);
  assert.equal(quarterback.points, 27.5);
  assert.equal(quarterback.projectedStats.passingYards, 250);
  assert.equal(snapshot.items.find((item) => item.playerName === negativeRushRow.playerName).projectedStats.rushingYards, -1.3);
  assert.match(quarterback.scoringCaveats[0], /two-point/);
  assert.throws(() => parseFantasyProsAuthenticatedCapture({ ...capture, accountLeague: "Another league" }, pack), /Thunder Bowl league view/);
  const changed = structuredClone(capture);
  changed.tables[0].headers[1] = "CHANGED";
  assert.throws(() => parseFantasyProsAuthenticatedCapture(changed, pack), /columns or row count changed/);
});

test("signed-in PFF offense and DST probabilities use raw components and disclose omitted categories", async () => {
  const pack = await readSeasonPack();
  const offense = pack.players.filter((player) => player.position !== "DST").slice(0, 250);
  const defenses = pack.players.filter((player) => player.position === "DST");
  const offenseRows = offense.map((player, index) => ({
    kind: "offense", rank: index + 1, providerId: `p-${index}`, providerUrl: `https://www.pff.com/nfl/players/player/${index}`, playerName: player.name,
    cells: [player.nflTeam, player.position, "8", "DEN", "999", "250", "2", "1", "80", "1", "4", "40", "0.5", "2", "3"],
  }));
  const dstRows = defenses.map((player, index) => ({
    kind: "dst", rank: index + 1, providerId: `d-${index}`, providerUrl: `https://www.pff.com/nfl/teams/team/${index}`, playerName: `${player.name} DST`,
    cells: [player.nflTeam, "DST", "8", "DEN", "999", "3", "0.1", "1", "1", "0.5", "0.2", "90", "0.1", "0.01", "0.03", "0.20", "0.28", "0.25", "0.17", "0.06"],
  }));
  const capture = {
    ...baseCapture("pff"),
    accountStatus: "signed-in",
    offenseHeaders: ["TEAM", "POS", "BYE", "OPP", "PTS", "PASS_YDS", "PASS_TD", "PASS_INT", "RUSH_YDS", "RUSH_TD", "REC", "REC_YDS", "REC_TD", "FG", "XP"],
    dstHeaders: ["TEAM", "POS", "BYE", "OPP", "PTS", "SACK", "SFT", "INT", "FF", "FR", "TD", "RETURN_YDS", "RETURN_TD", "PA_0", "PA_1_6", "PA_7_13", "PA_14_20", "PA_21_27", "PA_28_34", "PA_35_PLUS"],
    rows: [...offenseRows, ...dstRows],
  };
  const snapshot = parsePffAuthenticatedCapture(capture, pack);
  assert.equal(snapshot.itemCount, capture.rows.length);
  const defense = snapshot.items.find((item) => item.position === "DST");
  assert.equal(defense.providerPoints, 999);
  assert.equal(defense.points, 13.42);
  assert.match(defense.scoringCaveats.join(" "), /probability-weighted/);
  const offenseItem = snapshot.items.find((item) => item.position !== "DST");
  assert.notEqual(offenseItem.points, offenseItem.providerPoints);
  assert.match(offenseItem.scoringCaveats[0], /fumbles or two-point/);
  const changed = { ...capture, offenseHeaders: [...capture.offenseHeaders.slice(0, -1), "CHANGED"] };
  assert.throws(() => parsePffAuthenticatedCapture(changed, pack), /changed its component-stat columns/);
});
