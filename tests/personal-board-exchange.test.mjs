import test from "node:test";
import assert from "node:assert/strict";
import { createPlayerAnnotation } from "../public/thunder-bowl/player-annotations.mjs";
import {
  createPersonalBoardEvidence,
  createPersonalBoardBundle,
  mergePersonalBoardAnnotations,
  personalBoardEvidenceStatus,
  personalBoardCsv,
  personalBoardFingerprint,
  replacePersonalBoardAnnotations,
  validatePersonalBoardEvidence,
  validatePersonalBoardBundle,
} from "../public/thunder-bowl/personal-board-exchange.mjs";

const players = [
  { id: "alpha-1", name: "Alpha Runner", position: "RB", nflTeam: "DET" },
  { id: "beta-2", name: "Beta Receiver", position: "WR", nflTeam: "GB" },
  { id: "gamma-3", name: "Gamma Passer", position: "QB", nflTeam: "BUF" },
];
const target = createPlayerAnnotation(
  { tag: "target", stealPrice: 12, personalMax: 19, note: "Push if RB need remains." },
  "2026-08-05T18:00:00.000Z",
);
const avoid = createPlayerAnnotation(
  { tag: "avoid", personalMax: 3, note: "=HYPERLINK(\"bad\",\"formula\")" },
  "2026-08-05T18:01:00.000Z",
);

function bundle() {
  return createPersonalBoardBundle({
    season: 2026,
    packId: "pack-before-refresh",
    players,
    annotations: { "alpha-1": target, "beta-2": avoid, "gamma-3": createPlayerAnnotation() },
    exportedAt: "2026-08-05T19:00:00.000Z",
  });
}

test("personal board round-trips exact private decisions without model or ledger authority", () => {
  const exported = bundle();
  assert.equal(exported.entries.length, 2);
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.scope, "full-board");
  assert.equal(exported.modelEffect, "none");
  assert.equal(exported.ledgerEffect, "none");
  const imported = validatePersonalBoardBundle(JSON.parse(JSON.stringify(exported)), { season: 2026, players });
  assert.deepEqual(imported.entries, exported.entries);
  assert.equal("vbd" in imported.entries[0], false);
  assert.equal("marketValue" in imported.entries[0], false);
});

test("same-season full-board files survive a projection pack refresh and replace stale local decisions exactly", () => {
  const imported = validatePersonalBoardBundle({ ...bundle(), sourcePackId: "pack-before-refresh" }, { season: 2026, players });
  const existing = { "gamma-3": createPlayerAnnotation({ tag: "target", note: "Keep this local note." }) };
  const replaced = replacePersonalBoardAnnotations(imported, players.map((player) => player.id));
  assert.deepEqual(replaced["alpha-1"], target);
  assert.deepEqual(replaced["beta-2"], avoid);
  assert.equal("gamma-3" in replaced, false);
  assert.equal(existing["gamma-3"].note, "Keep this local note.");
});

test("schema-v1 files remain importable only as explicit legacy merges", () => {
  const current = bundle();
  const { scope, ...legacy } = { ...current, schemaVersion: 1 };
  const imported = validatePersonalBoardBundle(JSON.parse(JSON.stringify(legacy)), { season: 2026, players });
  assert.equal(imported.scope, "legacy-merge");
  const existing = { "gamma-3": createPlayerAnnotation({ tag: "target", note: "Preserved because v1 cannot transmit deletion." }) };
  const merged = mergePersonalBoardAnnotations(existing, imported, players.map((player) => player.id));
  assert.equal(merged["gamma-3"].note, "Preserved because v1 cannot transmit deletion.");
  assert.throws(() => replacePersonalBoardAnnotations(imported, players.map((player) => player.id)), /complete personal-board file/);
});

test("personal board rejects wrong season, unknown or duplicate players, altered identity, and extra fields", () => {
  const exported = JSON.parse(JSON.stringify(bundle()));
  assert.throws(() => validatePersonalBoardBundle({ ...exported, season: 2025 }, { season: 2026, players }), /Choose a 2026/);
  assert.throws(() => validatePersonalBoardBundle({ ...exported, vbd: 42 }, { season: 2026, players }), /schema mismatch/);
  assert.throws(() => validatePersonalBoardBundle({ ...exported, scope: "partial" }, { season: 2026, players }), /scope is invalid/);
  assert.throws(() => validatePersonalBoardBundle({ ...exported, entries: [{ ...exported.entries[0], playerId: "unknown-9" }] }, { season: 2026, players }), /unknown player/);
  assert.throws(() => validatePersonalBoardBundle({ ...exported, entries: [exported.entries[0], exported.entries[0]] }, { season: 2026, players }), /duplicate player/);
  assert.throws(() => validatePersonalBoardBundle({ ...exported, entries: [{ ...exported.entries[0], playerName: "Changed Name" }] }, { season: 2026, players }), /identity changed/);
  assert.throws(() => validatePersonalBoardBundle({ ...exported, entries: [{ ...exported.entries[0], projectedPoints: 300 }] }, { season: 2026, players }), /schema mismatch/);
  assert.throws(() => validatePersonalBoardBundle({ ...exported, entries: [{ ...exported.entries[0], annotation: { ...exported.entries[0].annotation, modelBoost: 1.2 } }] }, { season: 2026, players }), /schema mismatch/);
});

test("CSV is complete, quoted, and neutralizes spreadsheet formulas", () => {
  const csv = personalBoardCsv(bundle());
  assert.equal(csv.trim().split(/\r?\n/).length, 3);
  assert.match(csv, /"player_id","player_name"/);
  assert.match(csv, /"Alpha Runner"/);
  assert.match(csv, /"'=HYPERLINK\(""bad"",""formula""\)"/);
});

test("backup evidence is SHA-256 bound to the exact personal board and survives pack refresh", async () => {
  const exported = bundle();
  const evidence = await createPersonalBoardEvidence({ bundle: exported, action: "export", recordedAt: "2026-08-05T20:00:00.000Z" });
  assert.deepEqual(validatePersonalBoardEvidence(evidence, { season: 2026 }), evidence);
  assert.equal(evidence.boardSchemaVersion, 2);
  assert.equal(evidence.fingerprint, await personalBoardFingerprint({ ...exported, sourcePackId: "new-pack" }));
  const status = personalBoardEvidenceStatus(evidence, {
    season: 2026,
    decisionCount: exported.entries.length,
    fingerprint: evidence.fingerprint,
    now: "2026-08-06T20:00:00.000Z",
  });
  assert.equal(status.current, true);
  assert.match(status.reason, /2 personal player decisions match/);
});

test("an edit, deletion, stale record, future record, malformed record, or authority field invalidates readiness evidence", async () => {
  const exported = bundle();
  const evidence = await createPersonalBoardEvidence({ bundle: exported, action: "import", recordedAt: "2026-08-05T20:00:00.000Z" });
  const changed = createPersonalBoardBundle({
    season: 2026,
    packId: "changed-pack",
    players,
    annotations: { "alpha-1": createPlayerAnnotation({ ...target, note: "Edited after backup." }), "beta-2": avoid },
  });
  const changedFingerprint = await personalBoardFingerprint(changed);
  const base = { season: 2026, decisionCount: changed.entries.length, fingerprint: changedFingerprint, now: "2026-08-06T20:00:00.000Z" };
  assert.match(personalBoardEvidenceStatus(evidence, base).reason, /changed after/i);
  assert.match(personalBoardEvidenceStatus(evidence, { ...base, decisionCount: 1 }).reason, /changed after/i);
  assert.match(personalBoardEvidenceStatus(evidence, { ...base, fingerprint: evidence.fingerprint, now: "2026-08-20T20:00:00.000Z" }).reason, /more than 168 hours/i);
  assert.match(personalBoardEvidenceStatus({ ...evidence, recordedAt: "2026-09-01T00:00:00.000Z" }, { ...base, fingerprint: evidence.fingerprint }).reason, /future/i);
  assert.match(personalBoardEvidenceStatus({ ...evidence, vbd: 3 }, base).reason, /No valid/i);
  const { boardSchemaVersion, ...obsoleteEvidence } = { ...evidence, schemaVersion: 1 };
  assert.match(personalBoardEvidenceStatus(obsoleteEvidence, base).reason, /No valid/i);
  assert.throws(() => validatePersonalBoardEvidence({ ...evidence, modelEffect: "boost" }, { season: 2026 }), /authority boundary/);
});

test("an empty personal board requires no portability evidence", () => {
  const status = personalBoardEvidenceStatus(null, { season: 2026, decisionCount: 0, fingerprint: null, now: "2026-08-05T20:00:00.000Z" });
  assert.equal(status.current, true);
  assert.match(status.reason, /No personal player decisions/i);
});
