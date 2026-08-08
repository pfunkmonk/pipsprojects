import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const reportUrl = new URL("../reports/thunder-bowl/keeper-auction-catastrophe-rehearsal.json", import.meta.url);
const packUrl = new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url);
const engineUrl = new URL("../public/thunder-bowl/state-engine.mjs", import.meta.url);
const scriptUrl = new URL("../scripts/run-keeper-auction-catastrophe-rehearsal.mjs", import.meta.url);
const [report, packBytes, engineBytes, scriptBytes] = await Promise.all([
  readFile(reportUrl, "utf8").then(JSON.parse),
  readFile(packUrl),
  readFile(engineUrl),
  readFile(scriptUrl),
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("catastrophe rehearsal is pinned to the current pack, engine, and runner", () => {
  assert.equal(report.pins.packSha256, sha256(packBytes));
  assert.equal(report.pins.engineSha256, sha256(engineBytes));
  assert.equal(report.pins.scriptSha256, sha256(scriptBytes));
  assert.equal(report.pack.id, "tb26-provisional-20260804-v9");
  assert.equal(report.pack.players, 716);
  assert.equal(report.pack.keeperCandidates, 177);
});

test("catastrophe rehearsal passes every keeper, auction, outage, recovery, and privacy gate", () => {
  assert.equal(report.passed, true);
  assert.ok(Object.keys(report.checks).length >= 16);
  assert.ok(Object.values(report.checks).every(Boolean));
  assert.equal(report.ledger.activeKeepers, 24);
  assert.equal(report.ledger.activeSales, 144);
  assert.equal(report.finalState.totalPlayers, 168);
  assert.ok(report.finalState.teams.every((team) => team.keepers === 2 && team.roster === 14));
});

test("catastrophe rehearsal proves the Herbert trade and exact reconnect/recovery behavior", () => {
  const goon = report.finalState.teams.find((team) => team.id === "goon-skwad");
  const dogs = report.finalState.teams.find((team) => team.id === "dogs-of-war");
  assert.equal(goon.startingCap, 104);
  assert.equal(dogs.startingCap, 106);
  assert.equal(report.ledger.keeperCorrection.mistakenEventId, "catastrophe-event-0002");
  assert.equal(report.ledger.keeperCorrection.voidEventId, "catastrophe-event-0003");
  assert.equal(report.outage.disconnectAtActiveSales, 72);
  assert.equal(report.outage.exact, true);
  assert.equal(report.outage.idempotent, true);
  assert.equal(report.recovery.exact, true);
});
