import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildStatusSnapshot, rebindStatusSnapshot, statusCacheKeys, statusUniverseHash } from "../netlify/functions/_lib/status-store.mjs";
import statusHandler from "../netlify/functions/thunder-status.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));

function payloadFixture() {
  const payload = {};
  for (let index = 0; index < 1000; index += 1) {
    payload[`filler-${index}`] = { player_id: `filler-${index}`, full_name: `Filler Player ${index}`, position: "DB", active: true };
  }
  payload.gibbs = {
    player_id: "gibbs",
    full_name: "Jahmyr Gibbs",
    position: "RB",
    fantasy_positions: ["RB"],
    team: "DET",
    active: true,
    status: "Active",
    injury_status: "Questionable",
    injury_body_part: "Back",
    injury_start_date: "2026-08-02",
    injury_notes: "Day to day",
    practice_participation: "Limited",
    practice_description: "Limited in individual drills",
    depth_chart_position: "RB",
    depth_chart_order: 1,
    news_updated: Date.parse("2026-08-03T17:20:00Z"),
  };
  payload.walker = {
    player_id: "walker",
    full_name: "Kenneth Walker",
    position: "RB",
    fantasy_positions: ["RB"],
    team: "KC",
    active: true,
    status: "Active",
  };
  payload.gano = {
    player_id: "gano",
    full_name: "Graham Gano",
    position: "K",
    fantasy_positions: ["K"],
    team: null,
    active: true,
    status: "Active",
    injury_status: "Questionable",
    news_updated: Date.parse("2026-03-30T23:15:00Z"),
  };
  return payload;
}

test("live status normalization is identity-safe, freshness-gated, and value-free", () => {
  const snapshot = buildStatusSnapshot(pack, payloadFixture(), "2026-08-03T22:00:00Z");
  assert.equal(snapshot.modelEffect, "none");
  assert.match(snapshot.playerUniverseHash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.playerUniverseHash, statusUniverseHash(pack));
  assert.equal(snapshot.ambiguousPlayers, 0);
  const gibbs = snapshot.updates.find((update) => update.name === "Jahmyr Gibbs");
  const walker = snapshot.updates.find((update) => update.name === "Kenneth Walker");
  const gano = snapshot.updates.find((update) => update.name === "Graham Gano");
  assert.equal(gibbs.freshness, "fresh");
  assert.equal(gibbs.severity, "moderate");
  assert.equal(gibbs.injuryBodyPart, "Back");
  assert.equal(gibbs.practiceParticipation, "Limited");
  assert.equal(gibbs.depthChartPosition, "RB");
  assert.equal(gibbs.depthChartOrder, 1);
  assert.equal(walker.matchMethod, "name_alias_position");
  assert.equal(gano.freshness, "stale");
  for (const forbidden of ["projectedPoints", "projectionSources", "managerProfiles", "pressureIndex", "opponentPressure", "vbd", "marketValue", "maxBid", "keeperValue"]) {
    assert.equal(forbidden in gibbs, false);
  }
});

test("status cache keys are versioned so new evidence fields cannot reuse an old snapshot", () => {
  const keys = statusCacheKeys(pack, "2026-08-03");
  assert.match(keys.dailyKey, /^sleeper\/v2\/2026-08-03\//);
  assert.match(keys.latestKey, /^sleeper\/v2\/latest\//);
});

test("value-neutral pack releases rebind status only when the player universe is identical", () => {
  const snapshot = buildStatusSnapshot(pack, payloadFixture(), "2026-08-03T22:00:00Z");
  const nextPack = structuredClone(pack);
  nextPack.packId = "tb26-value-neutral-next-pack";
  nextPack.managerProfiles = [];
  const rebound = rebindStatusSnapshot(nextPack, snapshot);
  assert.equal(rebound.packId, nextPack.packId);
  assert.equal(rebound.playerUniverseHash, snapshot.playerUniverseHash);
  assert.deepEqual(rebound.updates, snapshot.updates);
  assert.equal(rebound.modelEffect, "none");
  assert.deepEqual(
    statusCacheKeys(nextPack, "2026-08-03"),
    statusCacheKeys(pack, "2026-08-03"),
  );

  const changedUniverse = structuredClone(nextPack);
  changedUniverse.players.pop();
  assert.notDeepEqual(
    statusCacheKeys(changedUniverse, "2026-08-03"),
    statusCacheKeys(pack, "2026-08-03"),
  );
  assert.throws(
    () => rebindStatusSnapshot(changedUniverse, snapshot),
    /different player universe/,
  );
});

test("status rebinding rejects duplicate or unknown update identities", () => {
  const snapshot = buildStatusSnapshot(pack, payloadFixture(), "2026-08-03T22:00:00Z");
  const duplicate = structuredClone(snapshot);
  duplicate.updates.push(structuredClone(duplicate.updates[0]));
  duplicate.matchedPlayers = duplicate.updates.length;
  assert.throws(() => rebindStatusSnapshot(pack, duplicate), /inconsistent player identities/);

  const unknown = structuredClone(snapshot);
  unknown.updates[0].playerId = "not-in-the-active-pack";
  assert.throws(() => rebindStatusSnapshot(pack, unknown), /outside the active pack/);
});

test("the live status endpoint rejects unauthenticated requests before external work", async () => {
  const response = await statusHandler(new Request("https://pipsprojects.com/api/thunder-bowl/status"));
  assert.equal(response.status, 401);
});
