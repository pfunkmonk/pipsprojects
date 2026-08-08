import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { normalizeCbsTeamRows } from "../tools/cbs-chrome-helper/cbs-normalize.mjs";
import { compareCbsRosterSnapshots, validateCbsRosterSnapshot } from "../public/thunder-bowl/cbs-roster-snapshot.mjs";

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
