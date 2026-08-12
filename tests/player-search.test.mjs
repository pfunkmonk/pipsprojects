import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { normalizePlayerSearch, playerSearchScore } from "../public/thunder-bowl/player-search.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
const byName = new Map(pack.players.map((player) => [player.name, player]));

function ranked(query) {
  return pack.players
    .map((player) => ({ player, score: playerSearchScore(player, query) }))
    .filter((row) => row.score !== null)
    .sort((left, right) => right.score - left.score || left.player.name.localeCompare(right.player.name));
}

test("search normalization removes accents, suffix noise, punctuation, and extra whitespace", () => {
  assert.equal(normalizePlayerSearch("  D'Andre   Swift Jr. "), "d andre swift");
  assert.equal(normalizePlayerSearch("Amon-Ra St. Brown"), "amon ra st brown");
});

test("exact player, team, and position searches retain strong deterministic matches", () => {
  assert.equal(ranked("Jahmyr Gibbs")[0].player.name, "Jahmyr Gibbs");
  assert.ok(ranked("DET").every(({ player }) => player.nflTeam === "DET"));
  assert.ok(ranked("QB").every(({ player }) => player.position === "QB"));
});

test("common missing-letter, substitution, and transposition typos find the intended player first", () => {
  for (const typo of ["jamyr gibs", "jamy gbbs", "jahmir gibbs", "jahmyr gibbs", "jamhyr gibbs"]) {
    assert.equal(ranked(typo)[0]?.player.name, "Jahmyr Gibbs", typo);
  }
  assert.equal(ranked("amom ra st brown")[0]?.player.name, "Amon-Ra St. Brown");
  assert.equal(ranked("puka nacua")[0]?.player.name, "Puka Nacua");
});

test("short fragments require a safe prefix or exact token instead of broad fuzzy noise", () => {
  assert.ok(ranked("go").every(({ player }) => normalizePlayerSearch(`${player.name} ${player.nflTeam} ${player.position}`).split(" ").some((token) => token.startsWith("go"))));
  assert.equal(playerSearchScore(byName.get("Jahmyr Gibbs"), "zz"), null);
});

test("the complete 716-player fuzzy search remains comfortably below the 100 ms product gate", () => {
  const queries = ["jahmir gibs", "amon ra", "det", "wr", "washngton", "mcaffrey", "laporta", "baltimore dst"];
  const durations = [];
  for (let iteration = 0; iteration < 20; iteration += 1) {
    for (const query of queries) {
      const started = performance.now();
      ranked(query);
      durations.push(performance.now() - started);
    }
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.floor(durations.length * 0.95)];
  assert.ok(p95 < 100, `fuzzy-search p95 was ${p95.toFixed(2)} ms`);
});
