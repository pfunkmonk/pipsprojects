import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import replayPackHandler from "../netlify/functions/thunder-replay-2025-pack.mjs";
import {
  EVENT_TYPES,
  createEvent,
  createRecoveryBundle,
  replayDraft,
  validateDraftPack,
  validateRecoveryBundle,
} from "../public/thunder-bowl/state-engine.mjs";

const replayPath = new URL("../netlify/functions/_data/draft-pack-2025-replay.json", import.meta.url);
const activePath = new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url);
const storageSource = await readFile(new URL("../public/thunder-bowl/storage.mjs", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/thunder-bowl/app.mjs", import.meta.url), "utf8");
const replay = validateDraftPack(JSON.parse(await readFile(replayPath, "utf8")));
const active2026 = JSON.parse(await readFile(activePath, "utf8"));

test("the isolated replay is a complete 12-team, 14-roster 2025 practice pack", () => {
  assert.equal(replay.season, 2025);
  assert.match(replay.packId, /^tb25-replay-20250825-v2-manager-history-\d{8}T\d{6}$/);
  assert.equal(replay.players.length, 755);
  assert.equal(replay.keeperCandidates.length, 24);
  assert.equal(replay.managerProfiles.length, 12);
  assert.ok(replay.managerProfiles.every((profile) => profile.modelEffect === "advisory_only"));
  assert.equal(replay.leagueConfig.teams.length, 12);
  assert.equal(replay.leagueConfig.rosterSize, 14);
  assert.equal(replay.leagueConfig.teams.reduce((sum, team) => sum + team.startingCap, 0), 1212);
  assert.equal([...replay.players].sort((left, right) => right.marketValue - left.marketValue).slice(0, 168).reduce((sum, player) => sum + player.marketValue, 0), 1212);
  const keepersByTeam = new Map(replay.leagueConfig.teams.map((team) => [team.id, 0]));
  for (const keeper of replay.keeperCandidates) keepersByTeam.set(keeper.teamId, keepersByTeam.get(keeper.teamId) + 1);
  assert.ok([...keepersByTeam.values()].every((count) => count === 2));
  assert.equal(replay.keeperCandidates.filter((keeper) => keeper.selectionRound === 1).length, 12);
  assert.equal(replay.keeperCandidates.filter((keeper) => keeper.selectionRound > 1).length, 12);
  assert.equal(replay.leagueConfig.nominationOrderStatus, "verified");
  assert.equal(replay.leagueConfig.verifiedPrefixCount, 12);
});

test("replay first-round seeding leaves exactly one open keeper choice per team", () => {
  const config = createEvent(EVENT_TYPES.DRAFT_CONFIGURED, replay.leagueConfig, {
    id: "event-2025-seed-config",
    deviceId: "device-2025-replay",
    createdAt: "2025-08-25T17:59:00.000Z",
  });
  const players = new Map(replay.players.map((player) => [player.id, player]));
  const firstRound = replay.keeperCandidates
    .filter((keeper) => keeper.selectionRound === 1)
    .sort((left, right) => left.selectionPick.localeCompare(right.selectionPick));
  const keeperEvents = firstRound.map((keeper, index) => {
    const player = players.get(keeper.playerId);
    return createEvent(EVENT_TYPES.KEEPER_ASSIGNED, {
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      teamId: keeper.teamId,
      salary: keeper.keeperSalary,
      keeperYear: keeper.keeperYear,
      source: `Verified 2025 first-round keeper ${keeper.selectionPick}`,
    }, {
      id: `event-2025-seed-${index + 1}`,
      deviceId: "device-2025-replay",
      createdAt: `2025-08-25T18:${String(index).padStart(2, "0")}:00.000Z`,
    });
  });
  const state = replayDraft([config, ...keeperEvents]);
  assert.equal(state.totalPlayers, 12);
  assert.equal(Object.values(state.teams).filter((team) => team.roster.length === 1).length, 12);
  const remaining = replay.keeperCandidates.filter((keeper) => !state.draftedPlayers[keeper.playerId]);
  assert.equal(remaining.length, 12);
  assert.equal(new Set(remaining.map((keeper) => keeper.teamId)).size, 12);
  assert.match(appSource, /ensureReplayFirstRoundKeepers/);
  assert.match(appSource, /if \(!selectionMetadata\.length\) return/);
  assert.match(appSource, /await ensureReplayFirstRoundKeepers\(\);\s*selectedPlayerId = null/);
  assert.match(appSource, /12 actual first-round keepers are loaded/);
});

test("2025 actuals are hindsight-only and never enter the active 2026 pack", () => {
  const actualRows = replay.players.flatMap((player) => player.projectionSources.filter((source) => source.source === "2025 final actual"));
  assert.equal(actualRows.length, 488);
  assert.ok(actualRows.every((source) => source.role === "supplemental" && source.modelEffect === "none"));
  assert.equal(JSON.stringify(active2026).includes("2025 final actual"), false);
  assert.equal(active2026.season, 2026);
});

test("2025 replay recovery files are season-scoped", () => {
  const config = createEvent(EVENT_TYPES.DRAFT_CONFIGURED, replay.leagueConfig, {
    id: "event-2025-replay-config",
    deviceId: "device-2025-replay",
    createdAt: "2025-08-25T18:00:00.000Z",
  });
  const bundle = createRecoveryBundle(replay, [config], "2025-08-25T18:01:00.000Z");
  assert.equal(bundle.kind, "thunder-bowl-2025-recovery");
  assert.equal(validateRecoveryBundle(bundle).pack.season, 2025);
});

test("the replay uses separate browser storage and cannot sync to the 2026 cloud ledger", () => {
  assert.match(storageSource, /thunder-bowl-2025-replay/);
  assert.match(appSource, /const LOCAL_ONLY = REPLAY_2025 \|\| PRACTICE_AUCTION/);
  assert.match(appSource, /if \(LOCAL_ONLY\) \{\s*cloudReachable = true;/);
  assert.match(appSource, /The 2025 replay never reads or changes the 2026 cloud ledger/);
});

test("the private replay endpoint rejects unauthenticated requests", async () => {
  const response = await replayPackHandler(new Request("https://pipsprojects.com/api/thunder-bowl/replay-2025/pack"));
  assert.equal(response.status, 401);
});
