import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";

const root = new URL("../", import.meta.url);
const current = JSON.parse(await readFile(new URL("netlify/functions/_data/draft-pack-2026-provisional.json", root), "utf8"));
const replay = JSON.parse(await readFile(new URL("netlify/functions/_data/draft-pack-2025-replay.json", root), "utf8"));
const audit = JSON.parse(await readFile(new URL("reports/thunder-bowl/manager-history-audit.json", root), "utf8"));
const normalized = await readFile(new URL("reports/thunder-bowl/manager-auction-history-normalized.csv", root), "utf8");

test("current manager tendencies use every validated prior auction without changing authority", () => {
  const pack = validateDraftPack(current);
  assert.equal(pack.managerProfiles.length, 12);
  assert.deepEqual(audit.includedSeasons, [2012, 2015, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025]);
  assert.equal(audit.purchaseRows, 1252);
  assert.equal(audit.selectedHalfLifeSeasons, 1000);
  assert.equal(audit.selectedProfileReliability, 0.15);
  assert.ok(pack.managerProfiles.every((profile) => profile.sampleSeasons === 10));
  assert.ok(pack.managerProfiles.every((profile) => profile.samplePurchases >= 70));
  assert.ok(pack.managerProfiles.every((profile) => profile.reliability === 0.15));
  assert.ok(pack.managerProfiles.every((profile) => profile.modelEffect === "advisory_only"));
  assert.ok(pack.managerProfiles.every((profile) => /keepers\/post-draft moves excluded/.test(profile.note)));
  assert.ok(pack.sources.some((source) => source.name === "Thunder Bowl 2012-2025 validated manager auction profiles"));
});

test("the 2025 replay expands older history without leaking the 2025 auction", () => {
  const pack = validateDraftPack(replay);
  assert.ok(pack.managerProfiles.every((profile) => profile.sampleSeasons === 9));
  assert.ok(pack.sources.some((source) => source.name === "Thunder Bowl 2012-2024 validated manager auction profiles"));
  const liveByTeam = new Map(current.managerProfiles.map((profile) => [profile.teamId, profile]));
  assert.ok(pack.managerProfiles.every((profile) => profile.samplePurchases < liveByTeam.get(profile.teamId).samplePurchases));
});

test("normalized history contains purchases only and preserves audited alias continuity", () => {
  const lines = normalized.trim().split(/\r?\n/);
  assert.equal(lines.length - 1, 1252);
  assert.doesNotMatch(normalized, /,keeper,/i);
  assert.match(normalized, /,the-bungles,The Bungles,Big Pimpin,/);
  assert.match(normalized, /,the-bungles,The Bungles,Fumble Brewskis,/);
  assert.match(normalized, /,three-amigos,Three Amigos,Whoopass,/);
  assert.match(normalized, /,three-amigos,Three Amigos,The Whoopass,/);
  assert.equal(audit.seasonCoverage["2018"].invalid, 1);
});

test("historical signal strength is selected by rolling-origin error, not assertion", () => {
  const selected = audit.recencyBacktest.find((candidate) =>
    candidate.halfLifeSeasons === audit.selectedHalfLifeSeasons
    && candidate.profileReliability === audit.selectedProfileReliability
  );
  const baseline = selected.leagueBaselineMeanAbsoluteShareError;
  assert.ok(selected.meanAbsoluteShareError < baseline);
  assert.equal(
    selected.meanAbsoluteShareError,
    Math.min(...audit.recencyBacktest.map((candidate) => candidate.meanAbsoluteShareError)),
  );
});
