import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EVENT_TYPES,
  createEvent,
  replayDraft,
  validateDraftPack,
} from "../public/thunder-bowl/state-engine.mjs";
import {
  PRACTICE_TICK_MS,
  QUIET_TICKS_TO_SALE,
  advanceQuietClock,
  applyPracticeBid,
  canPracticeTeamRoster,
  choosePracticeNominee,
  createPracticeSession,
  nextAutomatedBid,
  profileBidCeiling,
  rankPracticeBidders,
  validatePracticeSession,
} from "../public/thunder-bowl/practice-engine.mjs";

const pack = validateDraftPack(JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8")));
const appSource = await readFile(new URL("../public/thunder-bowl/app.mjs", import.meta.url), "utf8");
const storageSource = await readFile(new URL("../public/thunder-bowl/storage.mjs", import.meta.url), "utf8");
const html = await readFile(new URL("../public/thunder-bowl/index.html", import.meta.url), "utf8");
const config = createEvent(EVENT_TYPES.DRAFT_CONFIGURED, pack.leagueConfig, {
  id: "event-practice-config",
  deviceId: "device-practice-test",
  createdAt: "2026-08-29T18:00:00.000Z",
});
const state = replayDraft([config]);
const player = pack.players.find((row) => row.name === "Jahmyr Gibbs") || pack.players[0];
const profiles = pack.managerProfiles.filter((profile) => profile.teamId !== "dogs-of-war");

test("the practice room has exactly 11 historical-tendency opponents", () => {
  assert.equal(pack.leagueConfig.teams.length, 12);
  assert.equal(profiles.length, 11);
  assert.equal(new Set(profiles.map((profile) => profile.teamId)).size, 11);
  assert.ok(profiles.every((profile) => profile.modelEffect === "advisory_only"));
});

test("agent ceilings are deterministic, legal, and reliability-shrunk", () => {
  for (const profile of profiles) {
    const context = { profile, state, player, liveMarketValue: player.marketValue, seed: "gate-01" };
    const first = profileBidCeiling(context);
    const second = profileBidCeiling(context);
    assert.equal(first, second);
    assert.ok(first >= 0 && first <= state.teams[profile.teamId].legalMaxBid);
  }
  const ranked = rankPracticeBidders({ profiles, state, player, liveMarketValue: player.marketValue, currentBid: 1, leaderTeamId: "goon-skwad", seed: "gate-01" });
  assert.ok(ranked.length > 0);
  assert.ok(ranked.every((row) => row.teamId !== "dogs-of-war" && row.teamId !== "goon-skwad"));
});

test("only one opponent bids per tick and every bid is exactly one dollar", () => {
  assert.equal(PRACTICE_TICK_MS, 1000);
  const bid = nextAutomatedBid({ profiles, state, player, liveMarketValue: player.marketValue, currentBid: 7, leaderTeamId: "goon-skwad", seed: "one-second" });
  assert.equal(bid.amount, 8);
  const session = createPracticeSession({ practiceId: "practice-test-001", player, nominatorTeamId: "goon-skwad", createdAt: "2026-08-29T18:01:00.000Z" });
  const advanced = applyPracticeBid(session, { teamId: bid.teamId, amount: 2, kind: "agent_bid" });
  assert.equal(advanced.currentBid, 2);
  assert.equal(advanced.activity.length, 2);
  assert.throws(() => applyPracticeBid(advanced, { teamId: "big-head", amount: 4 }), /exactly \$1/);
});

test("three quiet one-second ticks sell and paused ticks do not move", () => {
  let session = createPracticeSession({ practiceId: "practice-test-quiet", player, nominatorTeamId: "goon-skwad", createdAt: "2026-08-29T18:01:00.000Z" });
  assert.equal(session.quietTicks, QUIET_TICKS_TO_SALE);
  session = advanceQuietClock(session);
  session = advanceQuietClock(session);
  session = advanceQuietClock(session);
  assert.equal(session.quietTicks, 0);
  const paused = validatePracticeSession({ ...createPracticeSession({ practiceId: "practice-test-pause", player, nominatorTeamId: "goon-skwad" }), paused: true });
  assert.equal(advanceQuietClock(paused).quietTicks, QUIET_TICKS_TO_SALE);
});

test("nomination selection respects roster legality and Dogs can nominate the selected player", () => {
  assert.equal(canPracticeTeamRoster(state, "dogs-of-war", player), true);
  const liveValues = new Map(pack.players.map((row) => [row.id, row.marketValue]));
  const chosen = choosePracticeNominee({ profiles: pack.managerProfiles, state, players: pack.players, liveValues, nominatorTeamId: "dogs-of-war", selectedPlayerId: player.id, seed: "dogs-choice" });
  assert.equal(chosen.id, player.id);
});

test("practice storage, cloud sync, projector, and controls are isolated from the real room", () => {
  assert.match(storageSource, /thunder-bowl-2026-practice/);
  assert.match(appSource, /const LOCAL_ONLY = REPLAY_2025 \|\| PRACTICE_AUCTION/);
  assert.match(appSource, /if \(LOCAL_ONLY\) \{\s*cloudReachable = true;/);
  assert.match(appSource, /Private practice never reads or changes the live cloud ledger/);
  assert.match(appSource, /The projector board is disabled in private auto-auction practice/);
  for (const id of ["practice-console", "practice-current-bid", "practice-leader", "practice-bid", "practice-pass", "practice-pause"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="practice-mode-top"[^>]*href="\?mode=practice-auction"[^>]*>Practice draft/);
  assert.match(appSource, /byId\("practice-mode-top"\)\.textContent = "Exit practice"/);
  assert.match(appSource, /clears only this browser's isolated auto-auction practice/);
  assert.match(appSource, /Download & reset local practice/);
  assert.match(appSource, /event\.code === "Space"/);
});

test("browsing another player cannot masquerade as the active practice auction", () => {
  for (const id of ["practice-browse-warning", "practice-browse-detail", "return-practice-player"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(appSource, /browsingDifferentPlayer: Boolean\(active && player && activePlayer\.id !== player\.id\)/);
  assert.match(appSource, /verdict: "BROWSE"/);
  assert.match(appSource, /Return to the live player before making a bid decision/);
  assert.match(appSource, /selectPlayer\(practiceSession\.playerId, false\)/);
});
