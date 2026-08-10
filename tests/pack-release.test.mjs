import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { draftPackSha256, promotionGate, releasedPackText } from "../netlify/functions/_lib/pack-release-store.mjs";

const packText = await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8");
const pack = JSON.parse(packText);

test("final-pack promotion reuses every existing release gate and pins exact bytes", () => {
  const gate = promotionGate(pack);
  assert.equal(gate.approved, true, gate.blockingIssues.join(" | "));
  const release = { schemaVersion: 1, season: 2026, packId: pack.packId, packSha256: draftPackSha256(packText) };
  const released = JSON.parse(releasedPackText(packText, release));
  assert.equal(released.status, "production");
  assert.equal(released.packId, pack.packId);
  assert.equal(released.players.length, pack.players.length);
});

test("a stale or forged release record cannot change the served pack", () => {
  const wrongHash = { schemaVersion: 1, season: 2026, packId: pack.packId, packSha256: "0".repeat(64) };
  const wrongId = { schemaVersion: 1, season: 2026, packId: `${pack.packId}-other`, packSha256: draftPackSha256(packText) };
  assert.equal(releasedPackText(packText, wrongHash), packText);
  assert.equal(releasedPackText(packText, wrongId), packText);
});
