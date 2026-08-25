import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PLAYER_POOL_CONTROLS,
  PLAYER_POOL_SORTS,
  activePlayerPoolFilters,
  filterAndSortPlayerPool,
} from "../public/thunder-bowl/player-pool-controls.mjs";
import {
  PLAYER_DEMOGRAPHICS_2026,
  PLAYER_DEMOGRAPHICS_AUDIT,
} from "../public/thunder-bowl/player-demographics-2026.mjs";

const players = [
  { id: "veteran-rb", name: "Veteran Runner", position: "RB", nflTeam: "DET", tier: 2, projectedPoints: 210, vbd: 40, marketValue: 18, maxBid: 22, weeklyProjection: { byeWeek: 8 } },
  { id: "rookie-rb", name: "Rookie Runner", position: "RB", nflTeam: "GB", tier: 3, projectedPoints: 190, vbd: 28, marketValue: 12, maxBid: 16, weeklyProjection: { byeWeek: 8 } },
  { id: "young-wr", name: "Young Receiver", position: "WR", nflTeam: "CHI", tier: 1, projectedPoints: 240, vbd: 55, marketValue: 25, maxBid: 29, weeklyProjection: { byeWeek: 5 } },
  { id: "unknown-te", name: "Unknown Tight End", position: "TE", nflTeam: "FA", tier: 8, projectedPoints: 80, vbd: -5, marketValue: 1, maxBid: 1 },
];

const demographics = {
  "veteran-rb": { age: 29, rookie: false },
  "rookie-rb": { age: 21, rookie: true },
  "young-wr": { age: 23, rookie: false },
};
const tags = { "rookie-rb": "target", "unknown-te": "avoid" };

function run(controls = {}, query = "") {
  return filterAndSortPlayerPool({
    players,
    query,
    controls: { ...DEFAULT_PLAYER_POOL_CONTROLS, ...controls },
    searchScoreFor: (player, value) => !value || player.name.toLowerCase().includes(value.toLowerCase()) ? 100 : null,
    tagFor: (player) => tags[player.id] || "neutral",
    demographicsFor: (player) => demographics[player.id] || null,
    hasAttention: (player) => player.id === "veteran-rb",
  });
}

test("filters can combine position, bye week, rookie status, tier, tag, and attention", () => {
  assert.deepEqual(run({ position: "RB", byeWeek: "8", experience: "ROOKIE" }).map(({ id }) => id), ["rookie-rb"]);
  assert.deepEqual(run({ tag: "TARGET" }).map(({ id }) => id), ["rookie-rb"]);
  assert.deepEqual(run({ attention: "ALERT" }).map(({ id }) => id), ["veteran-rb"]);
  assert.deepEqual(run({ tier: "1" }).map(({ id }) => id), ["young-wr"]);
});

test("explicit sorts keep unknown demographic values last", () => {
  assert.deepEqual(run({ sort: PLAYER_POOL_SORTS.AGE_ASC }).map(({ id }) => id), ["rookie-rb", "young-wr", "veteran-rb", "unknown-te"]);
  assert.deepEqual(run({ sort: PLAYER_POOL_SORTS.AGE_DESC }).map(({ id }) => id), ["veteran-rb", "young-wr", "rookie-rb", "unknown-te"]);
  assert.deepEqual(run({ sort: PLAYER_POOL_SORTS.ROOKIE_FIRST }).map(({ id }) => id), ["rookie-rb", "young-wr", "veteran-rb", "unknown-te"]);
  assert.deepEqual(run({ sort: PLAYER_POOL_SORTS.BYE_ASC }).map(({ id }) => id), ["young-wr", "rookie-rb", "veteran-rb", "unknown-te"]);
});

test("search relevance remains authoritative over a selected sort", () => {
  assert.deepEqual(run({ sort: PLAYER_POOL_SORTS.VBD_DESC }, "Rookie").map(({ id }) => id), ["rookie-rb"]);
});

test("active-filter copy is concise and does not count sorting as a filter", () => {
  assert.deepEqual(activePlayerPoolFilters({ position: "RB", byeWeek: "8", experience: "ROOKIE", sort: PLAYER_POOL_SORTS.AGE_ASC }), ["RB", "Bye 8", "Rookies"]);
});

test("demographic enrichment is broad, display-only, and protects established-player identity collisions", () => {
  assert.ok(Object.keys(PLAYER_DEMOGRAPHICS_2026).length >= 600);
  assert.equal(PLAYER_DEMOGRAPHICS_AUDIT.unknown, 111);
  assert.deepEqual(PLAYER_DEMOGRAPHICS_2026["fbg:JeffJu00"], { age: 27, experience: 6, rookie: false });
  for (const metadata of Object.values(PLAYER_DEMOGRAPHICS_2026)) {
    assert.deepEqual(Object.keys(metadata).sort(), ["age", "experience", "rookie"]);
    assert.equal("vbd" in metadata, false);
    assert.equal("marketValue" in metadata, false);
    assert.equal("maxBid" in metadata, false);
  }
});
