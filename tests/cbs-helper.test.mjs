import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { normalizeCbsProjectionRows, normalizeCbsTeamRows } from "../tools/cbs-chrome-helper/cbs-normalize.mjs";
import { normalizeCbsFabPages } from "../tools/cbs-chrome-helper/cbs-fab-normalize.mjs";
import { cbsLeagueRosterReadiness, compareCbsRosterSnapshots, validateCbsRosterSnapshot } from "../public/thunder-bowl/cbs-roster-snapshot.mjs";
import { canonicalizeCbsLeagueSnapshot, validateCanonicalCbsLeagueState } from "../netlify/functions/_lib/cbs-season-source.mjs";
import { scoreThunderBowlProjectedStats } from "../netlify/functions/_lib/thunder-bowl-scoring.mjs";

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
  assert.deepEqual(manifest.host_permissions, ["https://berrymvp.football.cbssports.com/*", "https://www.footballguys.com/*", "https://www.fantasypros.com/*", "https://www.pff.com/*"]);
  assert.equal(manifest.name, "Thunder Bowl Data Helper");
  assert.equal(manifest.version, "0.7.0");
  assert.equal(JSON.stringify(manifest).includes("cookies"), false);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
});

test("the four-source helper waits for authenticated rendered content instead of Edge's tab-complete event", async () => {
  const [worker, seasonHtml] = await Promise.all([
    readFile(new URL("../tools/cbs-chrome-helper/service-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /waitForCbsContent/);
  assert.match(worker, /teamTableCount >= 12/);
  assert.match(worker, /projectionTable\?\.querySelector/);
  assert.doesNotMatch(worker, /tabs\.onUpdated/);
  assert.doesNotMatch(worker, /changeInfo\.status === "complete"/);
  assert.match(worker, /accountLeague === "Thunder Bowl"/);
  assert.match(worker, /Unlock the rest of the projections with a PRO subscription/);
  assert.match(worker, /credentials: "include"/);
  assert.match(worker, /projections\/download\/weekly\/all\/2026/);
  assert.match(worker, /captureFantasyProsProjections/);
  assert.match(worker, /capturePffProjections/);
  assert.match(worker, /a\[href\*="\/nfl\/teams\/"\]/);
  assert.match(worker, /rowKey: providerId \|\|/);
  assert.match(worker, /seen\.has\(row\.rowKey\)/);
  assert.match(worker, /captureCbsFabPages/);
  assert.match(worker, /fab-budget/);
  assert.match(seasonHtml, /thunder-bowl-data-helper-v0\.7\.0\.zip/);
  assert.match(seasonHtml, /edge:\/\/extensions/);
});

test("CBS FAB pages normalize the $50 budget, reverse-standings order, records, and current-week pickups", () => {
  const teams = ["Angry Face", "Orange Crush", "Big Head", "Dogs of War", "T-Dogs", "Super Suckers", "Three Amigos", "Goon Skwad", "El Guapo", "Crime and Punishment", "The Hobbits", "The Bungles"];
  const pages = [
    { url: "https://berrymvp.football.cbssports.com/transactions/fab-budget", title: "FAB Budget", text: "FAB Budget Remaining", tables: [{ headers: ["Team", "Remaining Budget"], rows: teams.map((name, index) => [name, `$${50 - index}`]) }] },
    { url: "https://berrymvp.football.cbssports.com/transactions/fab-order", title: "FAB Order", text: "FAB priority order", tables: [{ headers: ["Order", "Team"], rows: teams.map((name, index) => [String(index + 1), name]) }] },
    { url: "https://berrymvp.football.cbssports.com/standings", title: "Standings", text: "Overall standings", tables: [{ headers: ["Team", "Record"], rows: teams.map((name, index) => [name, `${index % 3}-${2 - (index % 3)}-0`]) }] },
    { url: "https://berrymvp.football.cbssports.com/transactions/report", title: "Transactions", text: "Week 1 transaction report", tables: [{ headers: ["Team", "Result", "Player"], rows: [["Dogs of War", "Awarded", "Test Player"], ["Angry Face", "Unsuccessful", "Other Player"]] }] },
  ];
  const fab = normalizeCbsFabPages(pages, 1, "2026-09-08T12:00:00.000Z");
  assert.equal(fab.status, "COMPLETE");
  assert.equal(fab.rules.startingBudget, 50);
  assert.deepEqual(fab.rules.equalBidTieBreakers, ["WORST_RECORD", "FEWEST_WEEKLY_PICKUPS", "FAB_ORDER"]);
  assert.equal(fab.teams.find((team) => team.teamId === "dogs-of-war").remainingBudget, 47);
  assert.equal(fab.teams.find((team) => team.teamId === "dogs-of-war").fabOrder, 4);
  assert.equal(fab.teams.find((team) => team.teamId === "dogs-of-war").weeklySuccessfulPickups, 1);
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

test("CBS roster readiness accepts the required eight starters plus zero to six backups", () => {
  const starters = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DST"];
  const teams = Array.from({ length: 12 }, (_, teamIndex) => ({
    teamId: `team-${teamIndex + 1}`,
    teamName: `Team ${teamIndex + 1}`,
    roster: Array.from({ length: 8 + (teamIndex % 7) }, (_, playerIndex) => ({
      position: playerIndex < starters.length ? starters[playerIndex] : ["QB", "RB", "WR", "TE", "K", "DST"][playerIndex % 6],
    })),
  }));
  const ready = cbsLeagueRosterReadiness(teams);
  assert.equal(ready.rosterMinimum, 8);
  assert.equal(ready.rosterMaximum, 14);
  assert.equal(ready.legalTeamCount, 12);
  assert.equal(ready.rostersReady, true);
  teams[0].roster = teams[0].roster.filter((player) => player.position !== "DST");
  const missingDefense = cbsLeagueRosterReadiness(teams);
  assert.equal(missingDefense.rostersReady, false);
  assert.deepEqual(missingDefense.teamStatuses[0].missingSlots, ["DST"]);
});

test("stored CBS state is re-evaluated under the legal starter rule instead of stale 14-player metadata", () => {
  const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DST"];
  const teams = Array.from({ length: 12 }, (_, teamIndex) => ({
    teamId: `team-${teamIndex + 1}`,
    teamName: `Team ${teamIndex + 1}`,
    roster: positions.map((position, playerIndex) => ({
      playerId: `player-${teamIndex + 1}-${playerIndex + 1}`,
      position,
      salary: 1,
      contractYear: 1,
    })),
  }));
  const rostered = teams.flatMap((team) => team.roster);
  const pack = { season: 2026, players: [...rostered.map((row) => ({ id: row.playerId })), { id: "available-one" }] };
  const oldState = {
    schemaVersion: 1,
    season: 2026,
    authority: "authenticated league roster and availability authority",
    capturedAt: new Date().toISOString(),
    rawSha256: "a".repeat(64),
    teams,
    teamCount: 12,
    rosteredPlayerCount: rostered.length,
    availablePlayerIds: ["available-one"],
    availablePlayerCount: 1,
    completeTeamCount: 0,
    rostersComplete: false,
  };
  const validated = validateCanonicalCbsLeagueState(oldState, pack);
  assert.equal(validated.legalTeamCount, 12);
  assert.equal(validated.rostersReady, true);
  assert.equal(validated.completeTeamCount, 12);
  assert.equal(validated.rostersComplete, true);
});

test("CBS weekly component projections normalize and use Thunder Bowl scoring instead of provider points", () => {
  const offense = normalizeCbsProjectionRows("QB", [{
    cbsPlayerId: "100", name: "Test Quarterback", nflTeam: "DEN",
    cells: ["", "A", "Test Quarterback", "@KC", "1", "10", "99", "90", "1", "30", "22", "250", "2", "1", "4", "20", "5", "0", "0", "999"],
  }], 1)[0];
  const kicker = normalizeCbsProjectionRows("K", [{
    cbsPlayerId: "101", name: "Test Kicker", nflTeam: "DEN",
    cells: ["", "A", "Test Kicker", "@KC", "1", "10", "99", "90", "1", "2", "2.2", "0", "0", "0.5", "0.5", "0.5", "0.5", "0.5", "0.5", "0.5", "0.5", "3", "3", "999"],
  }], 1)[0];
  const defense = normalizeCbsProjectionRows("DST", [{
    cbsPlayerId: "102", name: "Test Defense", nflTeam: "DEN",
    cells: ["", "A", "Test Defense", "@KC", "1", "10", "99", "90", "3", "0.5", "1", "0", "0.2", "0.1", "333", "333", "17", "17", "999"],
  }], 1)[0];
  assert.equal(scoreThunderBowlProjectedStats(offense.projectedStats, "QB"), 22);
  assert.equal(scoreThunderBowlProjectedStats(kicker.projectedStats, "K"), 10);
  assert.equal(scoreThunderBowlProjectedStats(defense.projectedStats, "DST"), 14.4);
  assert.equal(offense.providerPoints, 999);
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
    Array.from({ length: 13 }, (_, playerIndex) => rawPlayer(30000 + teamIndex * 100 + playerIndex, `${name} Player ${playerIndex + 1}`)),
  ));
  const previous = { schemaVersion: 1, source: "CBS Sports authenticated Thunder Bowl all-team roster report", modelEffect: "none", capturedAt: "2026-08-04T18:30:00.000Z", season: 2026, pageUrl: "https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/", teamCount: 12, playerCount: 156, teams };
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
