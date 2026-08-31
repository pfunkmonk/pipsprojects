import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { normalizeCbsTeamRows } from "../tools/cbs-chrome-helper/cbs-normalize.mjs";
import { compareCbsRosterSnapshots, validateCbsRosterSnapshot } from "../public/thunder-bowl/cbs-roster-snapshot.mjs";
import { canonicalizeCbsLeagueSnapshot } from "../netlify/functions/_lib/cbs-season-source.mjs";

const rawPlayer = (id, name, position = "QB", nflTeam = "DET") => ({
  cbsPlayerId: String(id),
  name,
  cells: ["", position, `${name} ${position} • ${nflTeam}`, "@CHI", "Sun 11:00am MT", "8", "47.5", "5", "12", "97%", "65%", "4", "2", "321.40", "280.10", "300.20"],
  newsTitles: ["Questionable"],
  markerClasses: ["injury-questionable"],
});

test("CBS helper manifest is least-privilege and has no cookie or storage permission", async () => {
  const manifest = JSON.parse(await readFile(new URL("../tools/cbs-chrome-helper/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions.sort(), ["scripting", "tabs"]);
  assert.deepEqual(manifest.host_permissions, ["https://berrymvp.football.cbssports.com/*"]);
  assert.equal(manifest.name, "Thunder Bowl Data Helper");
  assert.equal(manifest.version, "0.3.0");
  assert.equal(JSON.stringify(manifest).includes("cookies"), false);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
});

test("CBS row normalization uses the verified salary, contract, and scoring-column order", () => {
  const team = { teamId: "dogs-of-war", cbsTeamId: 4, name: "Dogs of War" };
  const rows = Array.from({ length: 14 }, (_, index) => rawPlayer(1000 + index, `Player ${index + 1}`));
  const normalized = normalizeCbsTeamRows(team, rows);
  assert.equal(normalized.players.length, 14);
  assert.equal(normalized.players[0].salary, 4);
  assert.equal(normalized.players[0].contractYear, 2);
  assert.equal(normalized.players[0].priorSeasonPoints, 321.4);
  assert.equal(normalized.players[0].threeYearAverage, 280.1);
  assert.equal(normalized.players[0].projectedPoints, 300.2);
  assert.equal(normalized.players[0].position, "QB");
  assert.equal(normalized.players[0].nflTeam, "DET");
  assert.equal(normalized.players[0].opponent, "@CHI");
  assert.equal(normalized.players[0].gameTime, "Sun 11:00am MT");
  assert.equal(normalized.players[0].bye, 8);
  assert.equal(normalized.players[0].overUnder, 47.5);
});

test("CBS row normalization accepts the live all-team report without a blank leading cell", () => {
  const team = { teamId: "angry-face", cbsTeamId: 1, name: "Angry Face" };
  const liveRow = rawPlayer(2221960, "Justin Herbert", "QB", "LAC");
  liveRow.cells = liveRow.cells.slice(1);
  const normalized = normalizeCbsTeamRows(team, Array.from({ length: 11 }, (_, index) => ({ ...liveRow, cbsPlayerId: String(2221960 + index), name: `Live Player ${index + 1}` })));
  assert.equal(normalized.players[0].opponent, "@CHI");
  assert.equal(normalized.players[0].gameTime, "Sun 11:00am MT");
  assert.equal(normalized.players[0].bye, 8);
  assert.equal(normalized.players[0].salary, 4);
  assert.equal(normalized.players[0].contractYear, 2);
});

test("CBS row normalization preserves authenticated partial auction rosters", () => {
  const team = { teamId: "angry-face", cbsTeamId: 1, name: "Angry Face" };
  const normalized = normalizeCbsTeamRows(team, Array.from({ length: 11 }, (_, index) => rawPlayer(2000 + index, `Partial Player ${index + 1}`)));
  assert.equal(normalized.players.length, 11);
});

test("CBS roster snapshot validation requires all 12 exact league teams", () => {
  const catalog = [
    ["angry-face", 1, "Angry Face"], ["orange-crush", 2, "Orange Crush"], ["big-head", 3, "Big Head"],
    ["dogs-of-war", 4, "Dogs of War"], ["t-dogs", 5, "T-Dogs"], ["super-suckers", 6, "Super Suckers"],
    ["three-amigos", 7, "Three Amigos"], ["goon-skwad", 8, "Goon Skwad"], ["el-guapo", 9, "El Guapo"],
    ["crime-and-punishment", 10, "Crime and Punishment"], ["the-hobbits", 11, "The Hobbits"], ["the-bungles", 12, "The Bungles"],
  ];
  const teams = catalog.map(([teamId, cbsTeamId, name], teamIndex) => normalizeCbsTeamRows(
    { teamId, cbsTeamId, name },
    Array.from({ length: 14 }, (_, playerIndex) => rawPlayer(10000 + teamIndex * 100 + playerIndex, `${name} Player ${playerIndex + 1}`)),
  ));
  const snapshot = {
    schemaVersion: 1,
    source: "CBS Sports authenticated Thunder Bowl all-team roster report",
    modelEffect: "none",
    capturedAt: "2026-08-04T18:30:00.000Z",
    season: 2026,
    pageUrl: "https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/",
    teamCount: 12,
    playerCount: 168,
    teams,
  };
  assert.equal(validateCbsRosterSnapshot(snapshot), snapshot);
  snapshot.teams[0].players.length = 11;
  snapshot.playerCount = 165;
  assert.equal(validateCbsRosterSnapshot(snapshot), snapshot);
  snapshot.teams[0].name = "Unknown Team";
  assert.throws(() => validateCbsRosterSnapshot(snapshot), /unknown team mapping/);
});

test("CBS comparison detects moves and contract changes without adding model authority", () => {
  const catalog = [
    ["angry-face", 1, "Angry Face"], ["orange-crush", 2, "Orange Crush"], ["big-head", 3, "Big Head"],
    ["dogs-of-war", 4, "Dogs of War"], ["t-dogs", 5, "T-Dogs"], ["super-suckers", 6, "Super Suckers"],
    ["three-amigos", 7, "Three Amigos"], ["goon-skwad", 8, "Goon Skwad"], ["el-guapo", 9, "El Guapo"],
    ["crime-and-punishment", 10, "Crime and Punishment"], ["the-hobbits", 11, "The Hobbits"], ["the-bungles", 12, "The Bungles"],
  ];
  const teams = catalog.map(([teamId, cbsTeamId, name], teamIndex) => normalizeCbsTeamRows(
    { teamId, cbsTeamId, name },
    Array.from({ length: 15 }, (_, playerIndex) => rawPlayer(30000 + teamIndex * 100 + playerIndex, `${name} Player ${playerIndex + 1}`)),
  ));
  const previous = { schemaVersion: 1, source: "CBS Sports authenticated Thunder Bowl all-team roster report", modelEffect: "none", capturedAt: "2026-08-04T18:30:00.000Z", season: 2026, pageUrl: "https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/", teamCount: 12, playerCount: 180, teams };
  const current = structuredClone(previous);
  current.capturedAt = "2026-08-05T18:30:00.000Z";
  current.teams[0].players[0].salary += 1;
  const moved = current.teams[0].players.pop();
  current.teams[1].players.push(moved);
  assert.deepEqual(compareCbsRosterSnapshots(previous, current), { baseline: false, added: 0, removed: 0, moved: 1, contractChanges: 1, totalChanges: 2 });
  assert.equal(current.modelEffect, "none");
});

test("CBS defense nicknames resolve by unique NFL team without inventing team drift", () => {
  const catalog = [
    ["angry-face", 1, "Angry Face"], ["orange-crush", 2, "Orange Crush"], ["big-head", 3, "Big Head"],
    ["dogs-of-war", 4, "Dogs of War"], ["t-dogs", 5, "T-Dogs"], ["super-suckers", 6, "Super Suckers"],
    ["three-amigos", 7, "Three Amigos"], ["goon-skwad", 8, "Goon Skwad"], ["el-guapo", 9, "El Guapo"],
    ["crime-and-punishment", 10, "Crime and Punishment"], ["the-hobbits", 11, "The Hobbits"], ["the-bungles", 12, "The Bungles"],
  ];
  const teams = catalog.map(([teamId, cbsTeamId, name], index) => normalizeCbsTeamRows(
    { teamId, cbsTeamId, name },
    [index === 0 ? rawPlayer(1921, "Eagles", "DST", "PHI") : index === 1 ? rawPlayer(1929, "Jaguars", "DST", "JAC") : rawPlayer(40000 + index, `${name} Quarterback`)],
  ));
  const snapshot = { schemaVersion: 1, source: "CBS Sports authenticated Thunder Bowl all-team roster report", modelEffect: "none", capturedAt: new Date().toISOString(), season: 2026, pageUrl: "https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/", teamCount: 12, playerCount: 12, teams };
  const pack = { season: 2026, players: teams.flatMap((team) => team.players.map((row) => ({ id: `pack:${row.cbsPlayerId}`, name: row.cbsPlayerId === "1921" ? "Philadelphia Eagles" : row.cbsPlayerId === "1929" ? "Jacksonville Jaguars" : row.name, position: row.position, nflTeam: row.cbsPlayerId === "1929" ? "JAX" : row.nflTeam }))) };
  const canonical = canonicalizeCbsLeagueSnapshot(snapshot, pack);
  assert.equal(canonical.teams[0].roster[0].name, "Philadelphia Eagles");
  assert.equal(canonical.teams[1].roster[0].name, "Jacksonville Jaguars");
  assert.equal(canonical.completeTeamCount, 0);
  assert.equal(canonical.rostersComplete, false);
  assert.deepEqual(canonical.teamDrift, []);
});

test("Admin UI wires capture, local persistence, and download without automatic keeper or value mutation", async () => {
  const [app, html] = await Promise.all([
    readFile(new URL("../public/thunder-bowl/app.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="capture-cbs-rosters"/);
  assert.match(html, /id="export-cbs-rosters"/);
  assert.match(app, /requestCbsRosterCapture\(\)/);
  assert.match(app, /setMeta\("cbsRosterSnapshot", snapshot\)/);
  assert.match(app, /Evidence only: no keeper, value, or ledger field changed/);
});
