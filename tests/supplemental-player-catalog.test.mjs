import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditDraftPack } from "../scripts/pack-release-gate.mjs";
import {
  addApprovedSupplementalPlayers,
  isApprovedSupplementalTransition,
} from "../scripts/supplemental-player-catalog.mjs";

const active = JSON.parse(readFileSync(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));
const current = structuredClone(active);
current.packId = "tb26-test-before-supplemental-catalog";
current.asOf = new Date(Date.parse(active.asOf) - 60_000).toISOString();
current.players = current.players.filter((player) => player.id !== "fbg:SmitJo02");
current.weeklyContext.coveredPlayers = current.players.filter((player) => player.weeklyProjection).length;

test("the approved supplemental catalog adds a complete searchable and assignable player identity", () => {
  const { candidate, added } = addApprovedSupplementalPlayers(current, { exportedAt: "2026-08-29T13:30:00.000Z" });
  assert.deepEqual(added, ["fbg:SmitJo02"]);
  assert.equal(candidate.players.length, current.players.length + 1);
  const jonnu = candidate.players.find((player) => player.id === "fbg:SmitJo02");
  assert.deepEqual(
    {
      name: jonnu.name,
      position: jonnu.position,
      nflTeam: jonnu.nflTeam,
      byeWeek: jonnu.weeklyProjection.byeWeek,
      marketValue: jonnu.marketValue,
      maxBid: jonnu.maxBid,
    },
    { name: "Jonnu Smith", position: "TE", nflTeam: "GB", byeWeek: 11, marketValue: 1, maxBid: 1 },
  );
  assert.equal(candidate.weeklyContext.coveredPlayers, candidate.players.length);
  assert.equal(isApprovedSupplementalTransition(current, candidate, jonnu.id), true);
  const audit = auditDraftPack(candidate, current);
  assert.equal(audit.approved, true, audit.blockingIssues.join(" | "));
  assert.deepEqual(audit.changes.addedPlayerIds, [jonnu.id]);
});

test("an unregistered or mutated player cannot use the supplemental-catalog release exception", () => {
  const { candidate } = addApprovedSupplementalPlayers(current, { exportedAt: "2026-08-29T13:30:00.000Z" });
  const jonnu = candidate.players.find((player) => player.id === "fbg:SmitJo02");
  jonnu.nflTeam = "FA";
  assert.equal(isApprovedSupplementalTransition(current, candidate, jonnu.id), false);
  const audit = auditDraftPack(candidate, current);
  assert.equal(audit.approved, false);
  assert.match(audit.blockingIssues.join(" | "), /outside the approved supplemental catalog/i);
});

test("reapplying the supplemental catalog is idempotent", () => {
  const first = addApprovedSupplementalPlayers(current, { exportedAt: "2026-08-29T13:30:00.000Z" }).candidate;
  const second = addApprovedSupplementalPlayers(first, { exportedAt: "2026-08-29T13:31:00.000Z" });
  assert.deepEqual(second.added, []);
  assert.equal(second.candidate.players.filter((player) => player.name === "Jonnu Smith").length, 1);
});
