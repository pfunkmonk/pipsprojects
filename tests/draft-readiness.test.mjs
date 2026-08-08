import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDraftReadinessReport, buildEmergencyBoardHtml } from "../public/thunder-bowl/draft-readiness.mjs";
import { HUMAN_REHEARSAL_ITEMS, createHumanRehearsalEvidence } from "../public/thunder-bowl/human-rehearsal.mjs";
import { createPersonalBoardBundle, createPersonalBoardEvidence, personalBoardFingerprint } from "../public/thunder-bowl/personal-board-exchange.mjs";
import { createPlayerAnnotation } from "../public/thunder-bowl/player-annotations.mjs";
import { EVENT_TYPES, createEvent, replayDraft, toPublicSnapshot, validateDraftPack } from "../public/thunder-bowl/state-engine.mjs";

const rawPack = JSON.parse(await readFile(new URL("../netlify/functions/_data/draft-pack-2026-provisional.json", import.meta.url), "utf8"));

function promotedPack() {
  const candidate = structuredClone(rawPack);
  candidate.status = "production";
  candidate.leagueConfig.nominationOrderStatus = "verified";
  candidate.leagueConfig.verifiedPrefixCount = 12;
  for (const team of candidate.leagueConfig.teams) {
    if (team.capStatus === "provisional") team.capStatus = "confirmed";
  }
  return validateDraftPack(candidate);
}

function configuredState(pack) {
  const event = createEvent(EVENT_TYPES.DRAFT_CONFIGURED, pack.leagueConfig, {
    id: "readiness-config-event",
    deviceId: "readiness-test-device",
    createdAt: "2026-08-04T03:00:00.000Z",
  });
  return replayDraft([event]);
}

function readyInputs() {
  const pack = promotedPack();
  const rehearsalChecks = Object.fromEntries(HUMAN_REHEARSAL_ITEMS.map((item) => [item.id, true]));
  return {
    pack,
    state: configuredState(pack),
    mode: "draft-room",
    now: "2026-08-04T04:00:00.000Z",
    online: true,
    cloudReachable: true,
    ledgerGeneration: 7,
    ledgerStale: false,
    offlineVerifierReady: true,
    displayBoardUrl: "https://pipsprojects.com/thunder-bowl/board?display=test-token",
    recoveryExportedAt: "2026-08-04T03:30:00.000Z",
    liveStatusCapturedAt: "2026-08-04T03:45:00.000Z",
    liveStatusCount: 710,
    morningIntelligenceCapturedAt: "2026-08-04T03:50:00.000Z",
    morningIntelligencePackId: pack.packId,
    morningIntelligencePlayersScanned: pack.players.length,
    morningIntelligenceStaleSources: 0,
    humanRehearsalEvidence: createHumanRehearsalEvidence({ checks: rehearsalChecks, leagueConfig: pack.leagueConfig, completedAt: "2026-08-04T03:40:00.000Z" }),
  };
}

test("draft-morning gate can pass only the promoted live room with every safety path ready", () => {
  const report = buildDraftReadinessReport(readyInputs());
  assert.equal(report.overall, "ready");
  assert.equal(report.counts.blocks, 0);
  assert.equal(report.counts.warnings, 0);
  assert.equal(report.counts.passes, report.counts.total);
  assert.equal(report.modelEffect, "none");
  assert.equal(report.ledgerEffect, "none");
  assert.ok(report.checks.every((check) => check.status === "pass"));
});

test("practice mode, practice authority, stale generation, and missing offline verifier fail closed", () => {
  const inputs = readyInputs();
  inputs.mode = "practice-auction";
  inputs.pack = validateDraftPack(structuredClone(rawPack));
  inputs.state = configuredState(inputs.pack);
  inputs.ledgerGeneration = null;
  inputs.ledgerStale = true;
  inputs.offlineVerifierReady = false;
  const report = buildDraftReadinessReport(inputs);
  assert.equal(report.overall, "blocked");
  for (const id of ["room-mode", "pack-authority", "cloud-generation", "offline-unlock"]) {
    assert.equal(report.checks.find((check) => check.id === id)?.status, "block");
  }
});

test("unverified order, provisional cap, stale sources, missing recovery, projector, and live status stay visible as warnings", () => {
  const inputs = readyInputs();
  const candidate = structuredClone(inputs.pack);
  candidate.asOf = "2026-08-01T00:00:00.000Z";
  candidate.leagueConfig.nominationOrderStatus = "verified-prefix-only";
  candidate.leagueConfig.verifiedPrefixCount = 2;
  candidate.leagueConfig.teams.find((team) => team.id === "el-guapo").capStatus = "provisional";
  inputs.pack = validateDraftPack(candidate);
  inputs.state = configuredState(inputs.pack);
  inputs.displayBoardUrl = null;
  inputs.recoveryExportedAt = null;
  inputs.liveStatusCapturedAt = null;
  inputs.liveStatusCount = 0;
  inputs.morningIntelligenceCapturedAt = null;
  inputs.morningIntelligencePackId = null;
  inputs.morningIntelligencePlayersScanned = 0;
  inputs.online = false;
  inputs.cloudReachable = false;
  const report = buildDraftReadinessReport(inputs);
  assert.equal(report.overall, "review");
  for (const id of ["pack-freshness", "team-caps", "nomination-order", "projector-link", "recovery-export", "live-status", "morning-intelligence", "network-path"]) {
    assert.equal(report.checks.find((check) => check.id === id)?.status, "warning");
  }
  assert.match(report.checks.find((check) => check.id === "nomination-order")?.detail || "", /Only 2 of 12/);
});

test("missing or configuration-stale human rehearsal evidence remains a visible departure warning", () => {
  const missingInputs = readyInputs();
  missingInputs.humanRehearsalEvidence = null;
  const missingReport = buildDraftReadinessReport(missingInputs);
  assert.equal(missingReport.overall, "review");
  assert.equal(missingReport.checks.find((check) => check.id === "human-rehearsal")?.status, "warning");

  const changedInputs = readyInputs();
  changedInputs.pack = structuredClone(changedInputs.pack);
  changedInputs.pack.leagueConfig.teams[0].startingCap += 1;
  changedInputs.state = configuredState(changedInputs.pack);
  const changedReport = buildDraftReadinessReport(changedInputs);
  assert.equal(changedReport.checks.find((check) => check.id === "human-rehearsal")?.status, "warning");
  assert.match(changedReport.checks.find((check) => check.id === "human-rehearsal")?.detail || "", /configuration changed/i);
});

test("current personal decisions require an exact recent JSON backup or Mac restore", async () => {
  const inputs = readyInputs();
  const player = inputs.pack.players[0];
  const bundle = createPersonalBoardBundle({
    season: 2026,
    packId: inputs.pack.packId,
    players: inputs.pack.players,
    annotations: { [player.id]: createPlayerAnnotation({ tag: "target", stealPrice: 12, personalMax: 18, note: "Draft morning target." }, "2026-08-04T03:20:00.000Z") },
    exportedAt: "2026-08-04T03:30:00.000Z",
  });
  inputs.personalBoardDecisionCount = bundle.entries.length;
  inputs.personalBoardFingerprint = await personalBoardFingerprint(bundle);
  let report = buildDraftReadinessReport(inputs);
  assert.equal(report.overall, "review");
  assert.equal(report.checks.find((check) => check.id === "personal-board-backup")?.status, "warning");

  inputs.personalBoardBackupEvidence = await createPersonalBoardEvidence({ bundle, action: "export", recordedAt: "2026-08-04T03:30:00.000Z" });
  report = buildDraftReadinessReport(inputs);
  assert.equal(report.checks.find((check) => check.id === "personal-board-backup")?.status, "pass");
  assert.match(report.checks.find((check) => check.id === "personal-board-backup")?.detail || "", /matches the latest private JSON backup/i);

  inputs.personalBoardFingerprint = "0".repeat(64);
  report = buildDraftReadinessReport(inputs);
  assert.equal(report.checks.find((check) => check.id === "personal-board-backup")?.status, "warning");
  assert.match(report.checks.find((check) => check.id === "personal-board-backup")?.detail || "", /changed after/i);
});

test("readiness independently detects an impossible local cash reserve", () => {
  const inputs = readyInputs();
  inputs.state = structuredClone(inputs.state);
  inputs.state.teams["dogs-of-war"].cash = 2;
  const report = buildDraftReadinessReport(inputs);
  assert.equal(report.overall, "blocked");
  assert.equal(report.checks.find((check) => check.id === "ledger-legality")?.status, "block");
});

test("readiness blocks a saved ledger whose configuration differs from the validated pack", () => {
  const inputs = readyInputs();
  inputs.state = structuredClone(inputs.state);
  inputs.state.config.verifiedPrefixCount = 1;
  const report = buildDraftReadinessReport(inputs);
  assert.equal(report.overall, "blocked");
  const contract = report.checks.find((check) => check.id === "league-contract");
  assert.equal(contract?.status, "block");
  assert.match(contract?.detail || "", /saved ledger configuration differs/i);
});

test("printable emergency board contains exactly 12 public-safe 14-slot cards and escapes content", () => {
  const inputs = readyInputs();
  const snapshot = toPublicSnapshot(inputs.state, { updatedAt: inputs.now });
  snapshot.teams[0].name = `<script>alert("no")</script>`;
  const html = buildEmergencyBoardHtml(snapshot, { packId: inputs.pack.packId, generatedAt: inputs.now });
  assert.equal((html.match(/<article class="team-card">/g) || []).length, 12);
  assert.equal((html.match(/<tbody>/g) || []).length, 12);
  const bodyRows = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)]
    .reduce((total, match) => total + (match[1].match(/<tr(?: class="blank")?>/g) || []).length, 0);
  assert.equal(bodyRows, 12 * 14);
  assert.match(html, /&lt;script&gt;alert\(&quot;no&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|vbd|intrinsicValue|marketValue|personalMax|playerTag|managerProfiles/i);
  assert.match(html, /no projections or strategy/i);
});

test("a full-roster emergency card reports a zero legal maximum", () => {
  const inputs = readyInputs();
  const snapshot = toPublicSnapshot(inputs.state, { updatedAt: inputs.now });
  snapshot.teams[0].openSlots = 0;
  snapshot.teams[0].cash = 9;
  snapshot.teams[0].players = Array.from({ length: 14 }, (_, index) => ({
    playerId: `print-${index}`,
    playerName: `Player ${index}`,
    position: "WR",
    price: 1,
  }));
  const html = buildEmergencyBoardHtml(snapshot, { packId: inputs.pack.packId, generatedAt: inputs.now });
  const firstCard = html.match(/<article class="team-card">[\s\S]*?<\/article>/)?.[0] || "";
  assert.match(firstCard, /0 open · max \$0/);
});
