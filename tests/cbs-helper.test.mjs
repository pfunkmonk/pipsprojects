import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import { cbsRosterCaptureAllowed, normalizeCbsProjectionRows, normalizeCbsTeamRows } from "../tools/cbs-chrome-helper/cbs-normalize.mjs";
import { normalizeCbsFabPages } from "../tools/cbs-chrome-helper/cbs-fab-normalize.mjs";
import { normalizeCbsSchedulePages, scheduleOpponent } from "../tools/cbs-chrome-helper/cbs-schedule-normalize.mjs";
import { cbsScheduleUrlMatches, renderedCbsScheduleReady } from "../tools/cbs-chrome-helper/cbs-schedule-readiness.mjs";
import { normalizeCbsScoringPreviewRows } from "../tools/cbs-chrome-helper/cbs-scoring-preview-normalize.mjs";
import { fantasyProsProjectionTableReady } from "../tools/cbs-chrome-helper/fantasypros-projection-readiness.mjs";
import { pffProjectionTableReady } from "../tools/cbs-chrome-helper/pff-projection-readiness.mjs";
import { cbsLeagueRosterReadiness, compareCbsRosterSnapshots, requestCbsRosterCapture, validateCbsRosterSnapshot } from "../public/thunder-bowl/cbs-roster-snapshot.mjs";
import { canonicalizeCbsLeagueSnapshot, validateCanonicalCbsLeagueState } from "../netlify/functions/_lib/cbs-season-source.mjs";
import { scoreThunderBowlProjectedStats } from "../netlify/functions/_lib/thunder-bowl-scoring.mjs";

const rawPlayer = (id, name, position = "QB", nflTeam = "DET") => ({
  cbsPlayerId: String(id),
  name,
  cells: ["", position, `${name} ${position} • ${nflTeam}`, "@CHI", "Sun 11:00am MT", "8", "47.5", "5", "12", "97%", "65%", "4", "2", "321.40", "280.10", "300.20"],
  newsTitles: ["Questionable"],
  markerClasses: ["injury-questionable"],
});

const scheduleTeams = [
  ["angry-face", "Angry Face"], ["orange-crush", "Orange Crush"], ["big-head", "Big Head"], ["dogs-of-war", "Dogs of War"],
  ["t-dogs", "T-Dogs"], ["super-suckers", "Super Suckers"], ["three-amigos", "Three Amigos"], ["goon-skwad", "Goon Skwad"],
  ["el-guapo", "El Guapo"], ["crime-and-punishment", "Crime and Punishment"], ["the-hobbits", "The Hobbits"], ["the-bungles", "The Bungles"],
];

function scheduleMatchups() {
  const rotating = scheduleTeams.slice(1);
  const fixed = scheduleTeams[0];
  const rounds = [];
  for (let round = 0; round < 11; round += 1) {
    const order = [fixed, ...rotating];
    rounds.push(Array.from({ length: 6 }, (_, index) => [order[index], order[11 - index]]));
    rotating.unshift(rotating.pop());
  }
  return Array.from({ length: 13 }, (_, index) => rounds[index % 11].map(([left, right]) => ({
    week: index + 1,
    teamAId: left[0], teamAName: left[1], teamBId: right[0], teamBName: right[1],
  }))).flat();
}

function rawLeagueSchedule() {
  const matchups = scheduleMatchups();
  return {
    schemaVersion: 1,
    source: "CBS Sports authenticated Thunder Bowl league schedule",
    modelEffect: "opponent_identification_only",
    capturedAt: "2026-08-04T18:30:00.000Z",
    season: 2026,
    headToHeadWeeks: Array.from({ length: 13 }, (_, index) => index + 1),
    allPlayWeeks: [14],
    matchupCount: matchups.length,
    matchups,
    pageUrls: ["https://berrymvp.football.cbssports.com/schedule"],
  };
}

test("PFF readiness accepts the current semantic table without the retired grid wrapper", () => {
  const currentPffTable = {
    heading: "FANTASY FOOTBALL PROJECTIONS",
    playerLinkCount: 100,
    identityRowCount: 100,
    statRowCount: 100,
    columnLabels: ["RANK", "PLAYER", "TEAM", "POS", "BYE", "#G", "PTS", "AV", "YDS", "TD", "INT", "REC", "FG", "XP"],
  };
  assert.equal(pffProjectionTableReady(currentPffTable), true);
  assert.equal(pffProjectionTableReady({ ...currentPffTable, statRowCount: 0 }), false);
  assert.equal(pffProjectionTableReady({ ...currentPffTable, heading: "Sign in" }), false);
  assert.equal(pffProjectionTableReady({ ...currentPffTable, columnLabels: ["PLAYER", "TEAM"] }), false);
});

test("FantasyPros readiness accepts a valid weekly table without a MyPlaybook league picker", () => {
  const headers = ["PLAYER", "ATT", "CMP", "YDS", "TDS", "INTS", "ATT", "YDS", "TDS", "FL", "FPTS"];
  const globalWeeklyTable = {
    pageMatches: true,
    heading: "Fantasy Football Projections - Week 2",
    headers,
    rowCount: 54,
  };
  assert.equal(fantasyProsProjectionTableReady(globalWeeklyTable, headers, "qb"), true);
  assert.equal(fantasyProsProjectionTableReady({ ...globalWeeklyTable, pageMatches: false }, headers, "qb"), false);
  assert.equal(fantasyProsProjectionTableReady({ ...globalWeeklyTable, rowCount: 49 }, headers, "qb"), false);
  assert.equal(fantasyProsProjectionTableReady({ ...globalWeeklyTable, headers: ["PLAYER", "FPTS"] }, headers, "qb"), false);
});

test("CBS helper manifest is least-privilege and has no cookie or storage permission", async () => {
  const manifest = JSON.parse(await readFile(new URL("../tools/cbs-chrome-helper/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions.sort(), ["scripting", "tabs"]);
  assert.deepEqual(manifest.host_permissions, ["https://*.football.cbssports.com/*", "https://www.footballguys.com/*", "https://www.fantasypros.com/*", "https://www.pff.com/*"]);
  assert.equal(manifest.name, "Thunder Bowl Data Helper");
  assert.equal(manifest.version, "0.10.13");
  assert.deepEqual(manifest.content_scripts.find((entry) => entry.matches.includes("https://*.football.cbssports.com/*"))?.js, ["cbs-page-reader.js"]);
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes("https://pipsprojects.com/draft-day/*") && entry.js.includes("page-bridge.js")));
  assert.equal(JSON.stringify(manifest).includes("cookies"), false);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
});

test("the season page accepts only the exact current helper protocol and release", async () => {
  const [bridge, cbsClient, fbgClient, supplementalClient] = await Promise.all([
    readFile(new URL("../tools/cbs-chrome-helper/page-bridge.js", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/cbs-roster-snapshot.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/fbg-session-capture.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/supplemental-session-capture.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(bridge, /PROTOCOL_VERSION = 2/);
  assert.match(bridge, /HELPER_VERSION = "0\.10\.13"/);
  assert.match(bridge, /captureCbsInStages/);
  assert.match(bridge, /action: "capture-cbs-roster-base"/);
  assert.match(bridge, /action: "capture-cbs-schedule"/);
  assert.match(bridge, /action: "capture-cbs-fab"/);
  assert.match(bridge, /action: "capture-cbs-preview"/);
  assert.match(bridge, /action: "capture-cbs-position"/);
  assert.match(bridge, /transientHelperFailure/);
  assert.match(bridge, /attempt <= 2/);
  assert.match(bridge, /safeProjectionCoverage/);
  assert.match(bridge, /projectionErrors\.length === 0/);
  assert.match(bridge, /data\.expectedHelperVersion !== HELPER_VERSION/);
  assert.match(bridge, /helperVersion: HELPER_VERSION/);
  assert.match(bridge, /action: "helper-version"/);
  assert.match(bridge, /versionResult\?\.helperVersion !== HELPER_VERSION/);
  for (const client of [cbsClient, fbgClient, supplementalClient]) {
    assert.match(client, /CAPTURE_PROTOCOL_VERSION = 2/);
    assert.match(client, /REQUIRED_HELPER_VERSION = "0\.10\.13"/);
    assert.match(client, /(?:CBS_|FBG_|SUPPLEMENTAL_)COMPATIBLE_HELPER_VERSIONS = Object\.freeze\(\[(?:CBS_|FBG_|SUPPLEMENTAL_)REQUIRED_HELPER_VERSION\]\)/);
    assert.match(client, /COMPATIBLE_HELPER_VERSIONS\.includes\(data\.helperVersion\)/);
    assert.match(client, /for \(const expectedHelperVersion of .*COMPATIBLE_HELPER_VERSIONS\)/);
    assert.match(client, /expectedHelperVersion,/);
  }
});

test("the Draft Day bridge sends one version-checked CBS setup request and returns only normalized setup", async () => {
  const bridge = await readFile(new URL("../tools/cbs-chrome-helper/page-bridge.js", import.meta.url), "utf8");
  const calls = [];
  let listener;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const setup = {
    schemaVersion: 1,
    source: "CBS Sports authenticated league setup",
    capturedAt: "2026-09-03T18:00:00.000Z",
    leagueOrigin: "https://friends.football.cbssports.com",
    leagueName: "Friends League",
    season: 2026,
    teams: [{ id: "cbs-1", name: "One" }, { id: "cbs-2", name: "Two" }],
  };
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      calls.push({ ...message });
      if (message.action === "helper-version") callback({ ok: true, helperVersion: "0.10.13" });
      else callback({ ok: true, helperVersion: "0.10.13", setup });
    },
  };
  const fakeWindow = {
    location: { origin: "https://pipsprojects.com" },
    addEventListener(type, callback) { if (type === "message") listener = callback; },
    postMessage(message, targetOrigin) {
      if (message.type === "PIPS_DRAFT_DAY_CBS_SETUP_RESPONSE") finish({ message, targetOrigin });
    },
  };
  runInNewContext(bridge, { window: fakeWindow, chrome: { runtime }, setTimeout, clearTimeout, console }, { filename: "page-bridge.js" });
  listener({
    source: fakeWindow,
    origin: fakeWindow.location.origin,
    data: {
      source: "pips-draft-day-app",
      type: "PIPS_DRAFT_DAY_CBS_SETUP_REQUEST",
      protocolVersion: 2,
      expectedHelperVersion: "0.10.13",
      requestId: "draft-day-setup-test",
    },
  });
  const result = await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(new Error("Draft Day bridge test timed out.")), 1_000))]);
  assert.equal(result.targetOrigin, fakeWindow.location.origin);
  assert.equal(result.message.ok, true);
  assert.deepEqual(result.message.setup, setup);
  assert.deepEqual(calls.map((call) => call.action), ["helper-version", "capture-draft-day-cbs-setup"]);
  assert.equal(calls[1].week, undefined);
});

async function exerciseCbsBridge({ failAction = null, transientAction = null } = {}) {
  const bridge = await readFile(new URL("../tools/cbs-chrome-helper/page-bridge.js", import.meta.url), "utf8");
  const calls = [];
  const attempts = new Map();
  let inFlight = 0;
  let maxInFlight = 0;
  let messageListener;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      calls.push({ ...message });
      if (message.action === "helper-version") {
        callback({ ok: true, helperVersion: "0.10.13" });
        return;
      }
      const attempt = (attempts.get(message.action) || 0) + 1;
      attempts.set(message.action, attempt);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => {
        inFlight -= 1;
        if (message.action === transientAction && attempt === 1) {
          runtime.lastError = { message: "The message port closed before a response was received." };
          callback(undefined);
          runtime.lastError = null;
          return;
        }
        if (message.action === failAction) {
          callback({ ok: false, helperVersion: "0.10.13", error: `${failAction} stopped safely` });
          return;
        }
        if (message.action === "capture-cbs-roster-base") {
          callback({ ok: true, helperVersion: "0.10.13", snapshot: { schemaVersion: 1, teams: [{ name: "Dogs of War", players: [{ cbsPlayerId: "1", name: "Jalen Hurts" }] }], projectionCount: 0 } });
          return;
        }
        if (message.action === "capture-cbs-schedule") {
          callback({ ok: true, helperVersion: "0.10.13", rawLeagueSchedule: { schemaVersion: 1, pages: [{ url: "https://berrymvp.football.cbssports.com/schedule/full" }] } });
          return;
        }
        if (message.action === "capture-cbs-fab") {
          callback({ ok: true, helperVersion: "0.10.13", fabState: null });
          return;
        }
        if (message.action === "capture-cbs-preview") {
          callback({ ok: true, helperVersion: "0.10.13", rawScoringPreview: { schemaVersion: 1, rows: [] } });
          return;
        }
        if (message.action === "capture-cbs-position") {
          const rows = Array.from({ length: 20 }, (_, index) => ({ cbsPlayerId: `${message.position}-${index}`, position: message.position }));
          callback({ ok: true, helperVersion: "0.10.13", position: message.position, rows });
          return;
        }
        callback({ ok: false, helperVersion: "0.10.13", error: "unexpected action" });
      }, 1);
    },
  };
  const fakeWindow = {
    location: { origin: "https://pipsprojects.com" },
    addEventListener(type, listener) { if (type === "message") messageListener = listener; },
    postMessage(message, origin) {
      if (message.source === "thunder-bowl-cbs-helper" && message.type === "THUNDER_BOWL_CBS_CAPTURE_RESPONSE") finish({ message, origin });
    },
  };
  runInNewContext(bridge, { window: fakeWindow, chrome: { runtime }, setTimeout, clearTimeout, console }, { filename: "page-bridge.js" });
  messageListener({
    source: fakeWindow,
    origin: fakeWindow.location.origin,
    data: {
      source: "thunder-bowl-app",
      type: "THUNDER_BOWL_CBS_CAPTURE_REQUEST",
      protocolVersion: 2,
      expectedHelperVersion: "0.10.13",
      requestId: "release-test",
      week: 1,
    },
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Bridge test timed out.")), 2_000));
  return { ...(await Promise.race([finished, timeout])), calls, attempts, maxInFlight };
}

test("CBS one-click bridge runs every short stage serially and recovers one worker restart", async () => {
  const result = await exerciseCbsBridge({ transientAction: "capture-cbs-schedule" });
  assert.equal(result.message.ok, true);
  assert.equal(result.message.helperVersion, "0.10.13");
  assert.equal(result.message.snapshot.weeklyProjections.length, 120);
  assert.equal(result.message.snapshot.projectionCount, 120);
  assert.equal(result.message.snapshot.fabState, undefined);
  assert.equal(result.maxInFlight, 1);
  assert.equal(result.attempts.get("capture-cbs-schedule"), 2);
  assert.deepEqual(
    result.calls.filter((call) => call.action !== "helper-version").map((call) => `${call.action}${call.position ? `:${call.position}` : ""}`),
    [
      "capture-cbs-roster-base",
      "capture-cbs-schedule",
      "capture-cbs-schedule",
      "capture-cbs-fab",
      "capture-cbs-preview",
      "capture-cbs-position:QB",
      "capture-cbs-position:RB",
      "capture-cbs-position:WR",
      "capture-cbs-position:TE",
      "capture-cbs-position:K",
      "capture-cbs-position:DST",
    ],
  );
});

test("CBS one-click bridge fails closed at the exact stage instead of hanging or saving partial core data", async () => {
  const result = await exerciseCbsBridge({ failAction: "capture-cbs-schedule" });
  assert.equal(result.message.ok, false);
  assert.match(result.message.error, /capture-cbs-schedule stopped safely/);
  assert.equal(result.maxInFlight, 1);
  assert.deepEqual(result.calls.filter((call) => call.action !== "helper-version").map((call) => call.action), ["capture-cbs-roster-base", "capture-cbs-schedule"]);
});

test("the helper waits for authenticated rendered content and limits CBS setup to one selected league", async () => {
  const [worker, bridge, cbsReader, seasonHtml] = await Promise.all([
    readFile(new URL("../tools/cbs-chrome-helper/service-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../tools/cbs-chrome-helper/page-bridge.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/cbs-chrome-helper/cbs-page-reader.js", import.meta.url), "utf8"),
    readFile(new URL("../public/thunder-bowl/season/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /waitForCbsContent/);
  assert.match(worker, /ROSTER_URL_PREFIXES/);
  assert.match(worker, /Array\.isArray\(expectedUrlPrefix\)/);
  assert.match(worker, /readCbsPage/);
  assert.match(worker, /response\.readerVersion !== HELPER_VERSION/);
  assert.match(worker, /waitForRenderedSchedulePage\(tabId, fullScheduleUrl, 30_000\)/);
  assert.match(worker, /15_000/);
  assert.match(cbsReader, /READER_VERSION = "0\.10\.13"/);
  assert.match(cbsReader, /exactStarterSides/);
  assert.match(cbsReader, /attempt < 12/);
  assert.match(cbsReader, /eight submitted starters for both teams/);
  assert.match(cbsReader, /teamTableCount >= 12/);
  assert.match(cbsReader, /projectionTable\?\.querySelector/);
  assert.match(cbsReader, /rosterNameHits >= 8/);
  assert.match(cbsReader, /function schedulePage/);
  assert.match(cbsReader, /function scoringPreviewRows/);
  assert.match(cbsReader, /async function scoringLiveRows/);
  assert.match(cbsReader, /#atlRegion \.atlItem/);
  assert.match(cbsReader, /\.playerScoresContainer \.playerScore/);
  assert.match(cbsReader, /actualPoints === null \? "NOT_STARTED" : final \? "FINAL" : "LIVE"/);
  assert.match(cbsReader, /captureErrors\.push/);
  assert.match(cbsReader, /message\.kind === "scoring-live-rows"/);
  assert.match(cbsReader, /function projectionRows/);
  assert.match(cbsReader, /async function fabPages/);
  assert.match(cbsReader, /credentials: "include"/);
  assert.match(cbsReader, /slice\(0, 16\)/);
  assert.match(cbsReader, /index \+= 8/);
  assert.match(cbsReader, /text\.slice\(0, 80_000\)/);
  assert.match(cbsReader, /readerVersion: READER_VERSION/);
  assert.match(cbsReader, /function setupPage/);
  assert.match(cbsReader, /function draftOrderSetup/);
  assert.match(cbsReader, /draft-order::order_source/);
  assert.match(worker, /draft-management\/order/);
  assert.match(worker, /Promise\.all\(specs\.map/);
  assert.match(cbsReader, /input\[name\$="wildcard_maxtot_salary"\]/);
  assert.match(cbsReader, /message\.kind === "setup-page"/);
  const cbsWorkerRuntime = worker.slice(0, worker.indexOf("async function fbgSubscriberState"));
  assert.doesNotMatch(cbsWorkerRuntime, /chrome\.scripting\.executeScript/);
  assert.doesNotMatch(worker, /tabs\.onUpdated/);
  assert.doesNotMatch(worker, /changeInfo\.status === "complete"/);
  assert.match(worker, /accountLeague === "Thunder Bowl"/);
  assert.match(worker, /Unlock the rest of the projections with a PRO subscription/);
  assert.match(worker, /projections\/download\/weekly\/all\/2026/);
  assert.match(worker, /captureFantasyProsProjections/);
  assert.match(worker, /captureFantasyProsPosition/);
  assert.match(bridge, /captureFantasyProsInStages/);
  assert.match(bridge, /capture-fantasypros-position/);
  assert.match(worker, /fantasyProsProjectionTableReady/);
  assert.match(worker, /!queryWeek && new RegExp/);
  assert.match(worker, /test\(heading\)/);
  assert.doesNotMatch(worker, /#mpb-set-league/);
  assert.doesNotMatch(worker, /state\.leagueControlReady && state\.accountLeague !== "Thunder Bowl"/);
  assert.match(worker, /capturePffProjections/);
  assert.match(worker, /const findToggle = \(\) => buttons\(\)\.find/);
  assert.match(worker, /text\(findToggle\(\)\)/);
  assert.match(worker, /PFF capture script returned no data/);
  assert.match(worker, /a\[href\*="\/nfl\/players\/"\]/);
  assert.match(worker, /playerLinkCount: document\.querySelectorAll\('main a\[href\*="\/nfl\/players\/"\]'\)\.length/);
  assert.match(worker, /pffProjectionTableReady\(state\)/);
  assert.match(worker, /statRowCount/);
  assert.doesNotMatch(worker, /main \[role="grid"\]/);
  assert.doesNotMatch(worker, /PFF is not signed in/);
  assert.doesNotMatch(worker, /text\(link\) === "Sign out"/);
  assert.match(worker, /captureError/);
  assert.match(worker, /PFF keeps all Kyber dropdown choices mounted/);
  assert.match(worker, /world: "MAIN"/);
  assert.match(worker, /text\(node\)\.toLowerCase\(\) === label\.toLowerCase\(\)/);
  assert.match(worker, /a\[href\*="\/nfl\/teams\/"\]/);
  assert.match(worker, /rowKey: providerId \|\|/);
  assert.match(worker, /seen\.has\(row\.rowKey\)/);
  assert.match(worker, /captureCbsFabPages/);
  assert.match(worker, /message\?\.action === "helper-version"/);
  assert.match(worker, /message\?\.expectedHelperVersion !== HELPER_VERSION/);
  assert.match(worker, /captureCbsFabPagesWithinDeadline/);
  assert.match(worker, /Promise\.race\(\[/);
  assert.match(worker, /delay\(timeoutMs\)\.then\(\(\) => null\)/);
  assert.match(cbsReader, /fab-budget/);
  assert.match(worker, /captureCbsSchedule/);
  assert.match(worker, /renderedSchedulePage/);
  assert.match(worker, /renderedCbsScheduleReady/);
  assert.match(worker, /withTemporaryCbsTab/);
  assert.match(worker, /captureCbsRosterBase/);
  assert.match(worker, /captureCbsScheduleStage/);
  assert.match(worker, /captureCbsFabStage/);
  assert.match(worker, /captureCbsPreviewStage/);
  assert.doesNotMatch(worker, /async function captureCbsCore/);
  assert.match(worker, /rawScheduleEvidence\(\[captured\.page\], capturedAt\)/);
  assert.match(worker, /CBS returned no rendered full-schedule page/);
  assert.doesNotMatch(worker, /captureRenderedScheduleUrls/);
  assert.doesNotMatch(worker, /captureExistingFullSchedulePages/);
  assert.doesNotMatch(worker, /canonicalWeekUrls/);
  assert.doesNotMatch(worker, /fallbackUrls/);
  assert.match(worker, /chrome\.tabs\.query\(\{ url: "https:\/\/\*\.football\.cbssports\.com\/\*" \}\)/);
  assert.match(worker, /mostRecentCbsLeagueOrigin/);
  assert.match(worker, /captureDraftDayCbsSetup/);
  assert.match(worker, /normalizeCbsDraftDaySetupPages/);
  assert.match(worker, /message\.action === "capture-draft-day-cbs-setup"/);
  assert.match(worker, /The new CBS document can commit before its content reader reaches document_idle/);
  assert.match(worker, /message\.action === "capture-cbs-fab"/);
  assert.doesNotMatch(worker, /Promise\.all\(candidates\.map\(\(url\) => chrome\.tabs\.create/);
  assert.match(worker, /cbsScheduleUrlMatches\(url, expectedUrl\)/);
  assert.match(worker, /renderedCbsScheduleReady\(captured, url, expectedUrl/);
  assert.match(worker, /captureCbsScoringPreviewRaw/);
  assert.match(worker, /scoring-live-rows/);
  assert.match(worker, /allMatchups/);
  assert.match(worker, /scoring\/live/);
  assert.match(worker, /rawLeagueSchedule: value/);
  assert.match(worker, /rawScoringPreview/);
  assert.match(worker, /live scoring page/);
  assert.match(worker, /expectedPlayers/);
  assert.match(seasonHtml, /thunder-bowl-data-helper-v0\.10\.13\.zip/);
  assert.match(seasonHtml, /edge:\/\/extensions/);
});

test("CBS schedule pages normalize all 12 teams for Weeks 1–13 and identify opponents", () => {
  const matchups = scheduleMatchups();
  const pages = Array.from({ length: 13 }, (_, index) => ({
    url: `https://berrymvp.football.cbssports.com/schedule?week=${index + 1}`,
    title: `Thunder Bowl Schedule - Week ${index + 1}`,
    text: `Week ${index + 1}`,
    tables: [{ headers: ["Matchup"], rows: matchups.filter((row) => row.week === index + 1).map((row) => [`${row.teamAName} vs ${row.teamBName}`]) }],
  }));
  const schedule = normalizeCbsSchedulePages(pages, "2026-09-01T12:00:00.000Z");
  assert.equal(schedule.matchupCount, 78);
  assert.ok(scheduleOpponent(schedule, "dogs-of-war", 1)?.teamName);
  assert.deepEqual(scheduleOpponent(schedule, "dogs-of-war", 14), { teamId: null, teamName: "All-play", allPlay: true });
});

test("CBS schedule normalization accepts one rendered all-weeks league grid", () => {
  const matchups = scheduleMatchups();
  const headers = ["Team", ...Array.from({ length: 13 }, (_, index) => `Week ${index + 1}`)];
  const rows = scheduleTeams.map(([teamId, teamName]) => [
    teamName,
    ...Array.from({ length: 13 }, (_, index) => {
      const matchup = matchups.find((row) => row.week === index + 1 && (row.teamAId === teamId || row.teamBId === teamId));
      return matchup.teamAId === teamId ? matchup.teamBName : matchup.teamAName;
    }),
  ]);
  const schedule = normalizeCbsSchedulePages([{
    url: "https://berrymvp.football.cbssports.com/schedule",
    title: "Thunder Bowl League Schedule",
    text: "Regular Season Schedule",
    tables: [{ headers, rows }],
  }], "2026-09-01T12:00:00.000Z");
  assert.equal(schedule.matchupCount, 78);
  assert.equal(schedule.pageUrls.length, 1);
  const expectedWeekOne = matchups.find((row) => row.week === 1 && (row.teamAId === "dogs-of-war" || row.teamBId === "dogs-of-war"));
  assert.equal(scheduleOpponent(schedule, "dogs-of-war", 1)?.teamName, expectedWeekOne.teamAId === "dogs-of-war" ? expectedWeekOne.teamBName : expectedWeekOne.teamAName);
});

test("CBS schedule normalization accepts the live Full Schedule period tables", () => {
  const matchups = scheduleMatchups();
  const tables = Array.from({ length: 13 }, (_, index) => ({
    headers: [`Period ${index + 1}: Matchups`, "@", "Results", ""],
    rows: matchups
      .filter((row) => row.week === index + 1)
      .map((row) => [row.teamAName, row.teamBName, "", ""]),
  }));
  const schedule = normalizeCbsSchedulePages([{
    url: "https://berrymvp.football.cbssports.com/schedule/full",
    title: "Thunder Bowl Full Schedule",
    text: "Full Schedule",
    tables,
    blocks: matchups.map((row) => `${row.teamAName} ${row.teamBName}`),
  }], "2026-09-01T12:00:00.000Z");
  assert.equal(schedule.matchupCount, 78);
  assert.equal(schedule.pageUrls[0], "https://berrymvp.football.cbssports.com/schedule/full");
});

test("CBS schedule normalization preserves the stable team id after a CBS team rename", () => {
  const matchups = scheduleMatchups();
  const renamedRows = Array.from({ length: 13 }, (_, index) => ({
    headers: [`Period ${index + 1}: Matchups`, "@", "Results", ""],
    rows: matchups
      .filter((row) => row.week === index + 1)
      .map((row) => [row.teamAName === "Angry Face" ? "Muther Humpers" : row.teamAName, "@", row.teamBName === "Angry Face" ? "Muther Humpers" : row.teamBName, ""]),
  }));
  const schedule = normalizeCbsSchedulePages([{
    url: "https://berrymvp.football.cbssports.com/schedule/full",
    title: "Thunder Bowl Full Schedule",
    text: "Regular Season Schedule",
    tables: renamedRows,
  }], "2026-09-09T20:00:00.000Z");
  assert.equal(schedule.matchupCount, 78);
  assert.equal(schedule.matchups.some((row) => row.teamAId === "angry-face" || row.teamBId === "angry-face"), true);
  assert.equal(schedule.matchups.some((row) => row.teamAName === "Muther Humpers" || row.teamBName === "Muther Humpers"), false);
});

test("CBS schedule normalization carries inline period separator rows in the live single-table layout", () => {
  const matchups = scheduleMatchups();
  const rows = [];
  for (let index = 0; index < 13; index += 1) {
    if (index > 0) rows.push([`Period ${index + 1}: 9/9/26 - 9/14/26 Matchups`, "@", "Results", ""]);
    rows.push(...matchups
      .filter((row) => row.week === index + 1)
      .map((row) => [row.teamAName, row.teamBName, "", ""]));
  }
  const schedule = normalizeCbsSchedulePages([{
    url: "https://berrymvp.football.cbssports.com/schedule/full",
    title: "Thunder Bowl Full Schedule",
    text: "Full Schedule",
    tables: [{ headers: ["Period 1: 9/9/26 - 9/14/26 Matchups", "@", "Results", ""], rows }],
  }], "2026-09-01T12:00:00.000Z");
  assert.equal(schedule.matchupCount, 78);
  for (let week = 1; week <= 13; week += 1) {
    assert.equal(schedule.matchups.filter((row) => row.week === week).length, 6);
  }
});

test("CBS schedule readiness rejects the previous page and partial lazy-rendered periods", () => {
  const matchups = scheduleMatchups();
  const fullTables = Array.from({ length: 13 }, (_, index) => ({
    headers: [`Period ${index + 1}: Matchups`, "@", "Results", ""],
    rows: matchups.filter((row) => row.week === index + 1).map((row) => [row.teamAName, row.teamBName, "", ""]),
  }));
  const captured = { teamHits: 12, page: { tables: fullTables } };
  const names = scheduleTeams.map(([, name]) => name);
  assert.equal(cbsScheduleUrlMatches("https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/", "https://berrymvp.football.cbssports.com/schedule/full"), false);
  assert.equal(renderedCbsScheduleReady(captured, "https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/", "https://berrymvp.football.cbssports.com/schedule/full", names), false);
  assert.equal(renderedCbsScheduleReady({ teamHits: 12, page: { tables: fullTables.slice(0, 1) } }, "https://berrymvp.football.cbssports.com/schedule/full", "https://berrymvp.football.cbssports.com/schedule/full", names), false);
  assert.equal(renderedCbsScheduleReady(captured, "https://berrymvp.football.cbssports.com/schedule/full", "https://berrymvp.football.cbssports.com/schedule/full", names), true);
});

test("CBS schedule readiness accepts a current team name supplied through a historical alias", () => {
  const matchups = scheduleMatchups().map((row) => ({
    ...row,
    teamAName: row.teamAName === "Angry Face" ? "Muther Humpers" : row.teamAName,
    teamBName: row.teamBName === "Angry Face" ? "Muther Humpers" : row.teamBName,
  }));
  const tables = Array.from({ length: 13 }, (_, index) => ({
    headers: [`Period ${index + 1}: Matchups`, "@", "Results", ""],
    rows: matchups.filter((row) => row.week === index + 1).map((row) => [row.teamAName, row.teamBName, "", ""]),
  }));
  const namesAndAliases = [...scheduleTeams.map(([, name]) => name), "Muther Humpers"];
  const captured = { teamHits: 12, page: { tables } };
  assert.equal(renderedCbsScheduleReady(captured, "https://berrymvp.football.cbssports.com/schedule/full", "https://berrymvp.football.cbssports.com/schedule/full", namesAndAliases), true);
});

test("CBS scoring preview reconciles the submitted Dogs of War and opponent starters and reserves", () => {
  const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DST", "RB", "WR"];
  const teams = scheduleTeams.map(([teamId, name], teamIndex) => ({
    teamId,
    cbsTeamId: teamIndex + 1,
    name,
    players: positions.map((position, playerIndex) => ({
      cbsPlayerId: String(100_000 + teamIndex * 100 + playerIndex),
      name: `${name} Player ${playerIndex + 1}`,
      position,
      nflTeam: playerIndex % 2 ? "DEN" : "SEA",
    })),
  }));
  const schedule = rawLeagueSchedule();
  const opponent = scheduleOpponent(schedule, "dogs-of-war", 1);
  const previewTeams = teams.filter((team) => ["dogs-of-war", opponent.teamId].includes(team.teamId));
  const rows = previewTeams.flatMap((team, teamIndex) => team.players.map((player, playerIndex) => ({
    cbsPlayerId: player.cbsPlayerId,
    name: player.name,
    role: playerIndex < 8 ? "STARTER" : "BENCH",
    top: teamIndex * 1_000 + playerIndex * 50,
  })));
  const preview = normalizeCbsScoringPreviewRows({
    rows,
    teams,
    leagueSchedule: schedule,
    week: 1,
    capturedAt: "2026-09-01T12:00:00.000Z",
    pageUrl: "https://berrymvp.football.cbssports.com/scoring/preview",
    pageTitle: "Dogs of War Scoring Preview",
  });
  assert.equal(preview.status, "COMPLETE");
  assert.equal(preview.teams.length, 2);
  assert.equal(preview.teams.find((team) => team.teamId === "dogs-of-war").starters.length, 8);
  assert.equal(preview.teams.find((team) => team.teamId === "dogs-of-war").bench.length, 2);
  assert.deepEqual(preview.errors, []);

  const partial = normalizeCbsScoringPreviewRows({
    rows: rows.slice(1),
    teams,
    leagueSchedule: schedule,
    week: 1,
    capturedAt: "2026-09-01T12:00:00.000Z",
    pageUrl: "https://berrymvp.football.cbssports.com/scoring/preview",
  });
  assert.equal(partial.status, "PARTIAL");
  assert.match(partial.errors.join(" "), /exactly 1 QB/);
});

test("CBS live scoring normalizes all 12 matchups teams with actuals and preserves frozen-score evidence", () => {
  const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DST", "RB", "WR"];
  const teams = scheduleTeams.map(([teamId, name], teamIndex) => ({
    teamId,
    cbsTeamId: teamIndex + 1,
    name,
    players: positions.map((position, playerIndex) => ({
      cbsPlayerId: String(200_000 + teamIndex * 100 + playerIndex),
      name: `${name} Live Player ${playerIndex + 1}`,
      position,
      nflTeam: playerIndex % 2 ? "DEN" : "SEA",
    })),
  }));
  const rows = teams.flatMap((team, teamIndex) => team.players.map((player, playerIndex) => ({
    cbsPlayerId: player.cbsPlayerId,
    name: player.name,
    role: playerIndex < 8 ? "STARTER" : "BENCH",
    matchupIndex: Math.floor(teamIndex / 2),
    actualPoints: playerIndex === 0 ? teamIndex + 0.5 : null,
    scoreStatus: playerIndex === 0 ? (teamIndex % 2 ? "LIVE" : "FINAL") : "NOT_STARTED",
    cbsLiveProjection: 10 + playerIndex,
    gameText: playerIndex === 0 && teamIndex % 2 === 0 ? "FINAL" : "Sun 2:25 PM MT",
    statsText: playerIndex === 0 ? "Passing: 245 Yds, 2 TD" : "",
    top: playerIndex * 50,
  })));
  const preview = normalizeCbsScoringPreviewRows({
    rows,
    teams,
    leagueSchedule: rawLeagueSchedule(),
    week: 1,
    capturedAt: "2026-09-12T12:00:00.000Z",
    pageUrl: "https://berrymvp.football.cbssports.com/scoring/live/1/",
    pageTitle: "Thunder Bowl Live Scoring",
    allMatchups: true,
  });
  assert.equal(preview.status, "COMPLETE");
  assert.equal(preview.coverageScope, "LEAGUE");
  assert.equal(preview.modelEffect, "submitted_lineup_and_actual_score_authority");
  assert.equal(preview.teams.length, 12);
  assert.ok(preview.teams.every((team) => team.starters.length === 8 && team.bench.length === 2));
  assert.equal(preview.teams[0].starters[0].actualPoints, 0.5);
  assert.equal(preview.teams[0].starters[0].scoreStatus, "FINAL");
  assert.equal(preview.teams[0].starters[0].cbsLiveProjection, 10);
  assert.equal(preview.teams[0].actuals.currentPoints, 0.5);
  assert.equal(preview.teams[0].actuals.status, "LIVE");
  assert.deepEqual(preview.errors, []);
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

test("CBS FAB normalization accepts the current CBS alias for Angry Face", () => {
  const teams = ["Muther Humpers", "Orange Crush", "Big Head", "Dogs of War", "T-Dogs", "Super Suckers", "Three Amigos", "Goon Skwad", "El Guapo", "Crime and Punishment", "The Hobbits", "The Bungles"];
  const pages = [
    { url: "https://berrymvp.football.cbssports.com/transactions/fab-budget", title: "FAB Budget", text: "FAB Budget Remaining", tables: [{ headers: ["Team", "Remaining Budget"], rows: teams.map((name, index) => [name, `$${50 - index}`]) }] },
    { url: "https://berrymvp.football.cbssports.com/transactions/fab-order", title: "FAB Order", text: "FAB priority order", tables: [{ headers: ["Order", "Team"], rows: teams.map((name, index) => [String(index + 1), name]) }] },
    { url: "https://berrymvp.football.cbssports.com/standings", title: "Standings", text: "Overall standings", tables: [{ headers: ["Team", "Record"], rows: teams.map((name) => [name, "0-0-0"]) }] },
  ];
  const fab = normalizeCbsFabPages(pages, 1, "2026-09-09T20:00:00.000Z");
  const renamed = fab.teams.find((team) => team.teamId === "angry-face");
  assert.equal(fab.coverage.budgetTeams, 12);
  assert.equal(fab.coverage.orderTeams, 12);
  assert.equal(fab.coverage.recordTeams, 12);
  assert.equal(renamed.name, "Angry Face");
  assert.equal(Object.hasOwn(renamed, "aliases"), false);
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

test("CBS row normalization preserves temporarily illegal rosters for downstream warnings", () => {
  const team = { teamId: "orange-crush", cbsTeamId: 2, name: "Orange Crush" };
  const rows = Array.from({ length: 15 }, (_, index) => rawPlayer(7000 + index, `Orange Player ${index + 1}`));
  const illegal = normalizeCbsTeamRows(team, rows);
  assert.equal(illegal.players.length, 15);
  assert.equal(cbsRosterCaptureAllowed(illegal.players), true);
  assert.equal(cbsLeagueRosterReadiness([{ teamId: team.teamId, teamName: team.name, roster: illegal.players }]).teamStatuses[0].aboveMaximum, true);

  rows[14].newsTitles = ["Physically Unable to Perform. Expected Return - Week 5"];
  const normalized = normalizeCbsTeamRows(team, rows);
  assert.equal(normalized.players.length, 15);
  assert.equal(normalized.players[14].irEligible, true);
  assert.equal(normalized.players.filter((player) => player.irEligible).length, 1);

  const sixteen = [...rows, rawPlayer(7015, "Orange Player 16")];
  assert.equal(normalizeCbsTeamRows(team, sixteen).players.length, 16);
  const unsafe = Array.from({ length: 31 }, (_, index) => rawPlayer(8000 + index, `Unsafe Player ${index + 1}`));
  assert.throws(() => normalizeCbsTeamRows(team, unsafe), /expected 1–30 structurally valid/i);
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

test("CBS roster readiness counts one verified PUP/IR player outside the 14-player active cap", () => {
  const starters = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DST"];
  const roster = Array.from({ length: 15 }, (_, index) => ({
    position: index < starters.length ? starters[index] : "WR",
    newsTitles: index === 14 ? ["Injured Reserve"] : [],
    markerClasses: [],
  }));
  const ready = cbsLeagueRosterReadiness(Array.from({ length: 12 }, (_, index) => ({
    teamId: `team-${index}`,
    teamName: `Team ${index}`,
    roster: structuredClone(roster),
  })));
  assert.equal(ready.rostersReady, true);
  assert.equal(ready.rosterMaximum, 14);
  assert.equal(ready.totalRosterMaximum, 15);
  assert.equal(ready.teamStatuses[0].rosterSize, 15);
  assert.equal(ready.teamStatuses[0].activeRosterSize, 14);
  assert.equal(ready.teamStatuses[0].irExemptionCount, 1);

  ready.teamStatuses.length = 0;
  roster[14].newsTitles = [];
  const invalid = cbsLeagueRosterReadiness([{ teamId: "orange-crush", teamName: "Orange Crush", roster }]);
  assert.equal(invalid.teamStatuses[0].aboveMaximum, true);
  assert.equal(invalid.teamStatuses[0].legal, false);
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
    leagueSchedule: rawLeagueSchedule(),
  };
  assert.equal(validateCbsRosterSnapshot(snapshot), snapshot);
  snapshot.teams[0].players.length = 11;
  snapshot.playerCount = 165;
  assert.equal(validateCbsRosterSnapshot(snapshot), snapshot);
  snapshot.teams[0].name = "Unknown Team";
  assert.throws(() => validateCbsRosterSnapshot(snapshot), /unknown team mapping/);
});

test("CBS snapshot validation retains illegal rosters while readiness marks them unsafe for roster-sensitive advice", () => {
  const teams = scheduleTeams.map(([teamId, name], teamIndex) => {
    const count = teamId === "orange-crush" ? 15 : 14;
    const rows = Array.from({ length: count }, (_, playerIndex) => rawPlayer(110000 + teamIndex * 100 + playerIndex, `${name} Player ${playerIndex + 1}`));
    if (teamId === "orange-crush") rows[14].markerClasses = ["player-status-ir"];
    return normalizeCbsTeamRows({ teamId, cbsTeamId: teamIndex + 1, name }, rows);
  });
  const snapshot = {
    schemaVersion: 1,
    source: "CBS Sports authenticated Thunder Bowl all-team roster report",
    modelEffect: "none",
    capturedAt: "2026-09-16T14:00:00.000Z",
    season: 2026,
    pageUrl: "https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/",
    teamCount: 12,
    playerCount: teams.reduce((sum, team) => sum + team.players.length, 0),
    teams,
    leagueSchedule: rawLeagueSchedule(),
  };
  assert.equal(validateCbsRosterSnapshot(snapshot), snapshot);
  assert.equal(cbsLeagueRosterReadiness(teams).teamStatuses.find((team) => team.teamId === "orange-crush").activeRosterSize, 14);

  snapshot.teams.find((team) => team.teamId === "orange-crush").players[14].irEligible = false;
  snapshot.teams.find((team) => team.teamId === "orange-crush").players[14].markerClasses = [];
  assert.equal(validateCbsRosterSnapshot(snapshot), snapshot);
  const readiness = cbsLeagueRosterReadiness(snapshot.teams);
  assert.equal(readiness.rostersReady, false);
  assert.equal(readiness.teamStatuses.find((team) => team.teamId === "orange-crush").aboveMaximum, true);
  const pack = {
    season: 2026,
    players: snapshot.teams.flatMap((team) => team.players.map((row) => ({
      id: `pack:${row.cbsPlayerId}`,
      name: row.name,
      position: row.position,
      nflTeam: row.nflTeam,
    }))),
  };
  const canonical = canonicalizeCbsLeagueSnapshot(snapshot, pack);
  assert.equal(canonical.rosteredPlayerCount, snapshot.playerCount);
  assert.equal(canonical.teamStatuses.find((team) => team.teamId === "orange-crush").aboveMaximum, true);
  assert.equal(validateCanonicalCbsLeagueState(canonical, pack).rostersReady, false);
});

test("the app materializes raw CBS schedule pages before enforcing the roster snapshot contract", () => {
  const teams = scheduleTeams.map(([teamId, name], teamIndex) => normalizeCbsTeamRows(
    { teamId, cbsTeamId: teamIndex + 1, name },
    [rawPlayer(60000 + teamIndex, `${name} Quarterback`)],
  ));
  const matchups = scheduleMatchups();
  const tables = Array.from({ length: 13 }, (_, index) => ({
    headers: [`Period ${index + 1}: Matchups`, "@", "Results", ""],
    rows: matchups.filter((row) => row.week === index + 1).map((row) => [row.teamAName, row.teamBName, "", ""]),
  }));
  const raw = {
    schemaVersion: 1,
    source: "CBS Sports authenticated Thunder Bowl all-team roster report",
    modelEffect: "none",
    capturedAt: "2026-09-01T18:30:00.000Z",
    season: 2026,
    pageUrl: "https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/",
    teamCount: 12,
    playerCount: 12,
    teams,
    projectionWeek: 1,
    rawLeagueSchedule: {
      schemaVersion: 1,
      capturedAt: "2026-09-01T18:30:00.000Z",
      pages: [{
        url: "https://berrymvp.football.cbssports.com/schedule/full",
        title: "Thunder Bowl Full Schedule",
        text: `Full Schedule ${"navigation advertisement ".repeat(12_000)}`,
        tables,
        blocks: matchups.map((row) => `${row.teamAName} ${row.teamBName}`),
      }],
    },
  };
  const normalized = validateCbsRosterSnapshot(raw);
  assert.equal(normalized.leagueSchedule.matchupCount, 78);
  assert.equal(normalized.rawLeagueSchedule, undefined);
  assert.equal(normalized.leagueSchedule.matchups.filter((row) => row.week === 1).length, 6);
});

test("league-wide CBS scoring diagnostics remain bounded without rejecting valid partial captures", () => {
  const teams = scheduleTeams.map(([teamId, name], teamIndex) => normalizeCbsTeamRows(
    { teamId, cbsTeamId: teamIndex + 1, name },
    [rawPlayer(61000 + teamIndex, `${name} Quarterback`)],
  ));
  const snapshot = {
    schemaVersion: 1,
    source: "CBS Sports authenticated Thunder Bowl all-team roster report",
    modelEffect: "none",
    capturedAt: "2026-09-12T18:30:00.000Z",
    season: 2026,
    pageUrl: "https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/",
    teamCount: 12,
    playerCount: 12,
    teams,
    projectionWeek: 1,
    leagueSchedule: rawLeagueSchedule(),
  };
  snapshot.scoringPreview = normalizeCbsScoringPreviewRows({
    rows: [],
    teams,
    leagueSchedule: snapshot.leagueSchedule,
    week: 1,
    capturedAt: "2026-09-12T18:30:00.000Z",
    pageUrl: "https://berrymvp.football.cbssports.com/scoring/live/1/",
    pageTitle: "Thunder Bowl Live Scoring",
    captureError: "CBS returned partial live-scoring rows.",
    allMatchups: true,
  });
  const normalized = validateCbsRosterSnapshot(snapshot);
  assert.equal(normalized.scoringPreview.status, "PARTIAL");
  assert.equal(normalized.scoringPreview.errors.length, 25);
});

test("CBS capture rejects an invalid helper response immediately instead of hanging until timeout", async () => {
  const listeners = new Set();
  const fakeWindow = {
    addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); },
    postMessage(message, origin) {
      if (message.source !== "thunder-bowl-app" || message.expectedHelperVersion !== "0.10.13") return;
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener({
          source: fakeWindow,
          origin,
          data: {
            source: "thunder-bowl-cbs-helper",
            type: "THUNDER_BOWL_CBS_CAPTURE_RESPONSE",
            protocolVersion: 2,
            helperVersion: "0.10.13",
            requestId: message.requestId,
            ok: true,
            snapshot: {},
          },
        });
      });
    },
  };
  await assert.rejects(
    requestCbsRosterCapture({ targetWindow: fakeWindow, origin: "https://pipsprojects.com", timeoutMs: 1_000, week: 1 }),
    /unsupported schema/,
  );
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
  const previous = { schemaVersion: 1, source: "CBS Sports authenticated Thunder Bowl all-team roster report", modelEffect: "none", capturedAt: "2026-08-04T18:30:00.000Z", season: 2026, pageUrl: "https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/", teamCount: 12, playerCount: 156, teams, leagueSchedule: rawLeagueSchedule() };
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
  const snapshot = { schemaVersion: 1, source: "CBS Sports authenticated Thunder Bowl all-team roster report", modelEffect: "none", capturedAt: new Date().toISOString(), season: 2026, pageUrl: "https://berrymvp.football.cbssports.com/teams/roster-report/all/2026/", teamCount: 12, playerCount: 12, teams, leagueSchedule: rawLeagueSchedule() };
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
