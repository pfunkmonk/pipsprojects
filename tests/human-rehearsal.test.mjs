import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  HUMAN_REHEARSAL_ITEMS,
  createHumanRehearsalEvidence,
  humanRehearsalStatus,
  rehearsalConfigSignature,
} from "../public/thunder-bowl/human-rehearsal.mjs";

const pack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
const checks = Object.fromEntries(HUMAN_REHEARSAL_ITEMS.map((item) => [item.id, true]));

test("a complete human rehearsal certificate is configuration-bound and value neutral", () => {
  const evidence = createHumanRehearsalEvidence({ checks, leagueConfig: pack.leagueConfig, completedAt: "2026-08-05T12:00:00.000Z" });
  assert.equal(evidence.itemCount, 7);
  assert.equal(evidence.configSignature, rehearsalConfigSignature(pack.leagueConfig));
  assert.equal(evidence.modelEffect, "none");
  assert.equal(evidence.ledgerEffect, "none");
  assert.equal(humanRehearsalStatus(evidence, pack.leagueConfig, { now: "2026-08-06T12:00:00.000Z" }).current, true);
});

test("missing physical actions cannot be sealed", () => {
  const incomplete = { ...checks, reconnect: false };
  assert.throws(() => createHumanRehearsalEvidence({ checks: incomplete, leagueConfig: pack.leagueConfig }), /reconnect.*not complete/i);
});

test("configuration drift and expiration invalidate the certificate", () => {
  const evidence = createHumanRehearsalEvidence({ checks, leagueConfig: pack.leagueConfig, completedAt: "2026-08-05T12:00:00.000Z" });
  const changed = structuredClone(pack.leagueConfig);
  changed.teams[0].startingCap += 1;
  assert.match(humanRehearsalStatus(evidence, changed, { now: "2026-08-06T12:00:00.000Z" }).reason, /configuration changed/i);
  assert.match(humanRehearsalStatus(evidence, pack.leagueConfig, { now: "2026-09-10T12:00:00.000Z" }).reason, /36 days old/i);
});

test("malformed, future-dated, or value-bearing certificates fail closed", () => {
  const evidence = createHumanRehearsalEvidence({ checks, leagueConfig: pack.leagueConfig, completedAt: "2026-08-05T12:00:00.000Z" });
  assert.match(humanRehearsalStatus({ ...evidence, modelEffect: "changes_vbd" }, pack.leagueConfig, { now: "2026-08-06T12:00:00.000Z" }).reason, /failed its evidence contract/i);
  assert.match(humanRehearsalStatus({ ...evidence, completedAt: "2026-08-07T12:00:00.000Z" }, pack.leagueConfig, { now: "2026-08-06T12:00:00.000Z" }).reason, /completion time is invalid/i);
});
