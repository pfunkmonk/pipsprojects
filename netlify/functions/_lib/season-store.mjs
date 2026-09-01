import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { validateCanonicalCbsLeagueState } from "./cbs-season-source.mjs";
import { validateFbgWeeklySnapshot } from "./fbg-season-source.mjs";
import { validateSupplementalWeeklySnapshot } from "./supplemental-season-source.mjs";

const STORE_NAME = "thunder-bowl-2026-season";

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function playerOwners(snapshot) {
  const owners = new Map();
  for (const team of snapshot?.teams || []) {
    for (const player of team.roster || []) owners.set(player.playerId, { teamId: team.teamId, teamName: team.teamName });
  }
  return owners;
}

export function diffLeagueOwnership(previous, current, pack) {
  if (!previous) return [];
  const oldOwners = playerOwners(previous);
  const newOwners = playerOwners(current);
  const players = new Map(pack.players.map((player) => [player.id, player]));
  const changes = [];
  for (const playerId of new Set([...oldOwners.keys(), ...newOwners.keys()])) {
    const from = oldOwners.get(playerId) || null;
    const to = newOwners.get(playerId) || null;
    if (from?.teamId === to?.teamId) continue;
    const player = players.get(playerId);
    if (!player) continue;
    changes.push({
      id: hashJson([previous.rawSha256, current.rawSha256, playerId]).slice(0, 24),
      detectedAt: current.capturedAt,
      playerId,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      type: !from && to ? "PICKUP" : from && !to ? "DROP" : "OWNER CHANGE",
      from,
      to,
      evidence: "Diff of two authenticated all-team CBS roster snapshots; transaction mechanism is not inferred.",
    });
  }
  return changes.sort((left, right) => left.playerName.localeCompare(right.playerName));
}

async function readJson(key) {
  const entry = await store().getWithMetadata(key, { consistency: "strong", type: "json" });
  return entry?.data || null;
}

export async function readLatestCbsLeagueState(pack) {
  const value = await readJson("sources/cbs/v1/latest");
  if (!value) return null;
  return {
    snapshot: validateCanonicalCbsLeagueState(value.snapshot, pack),
    leagueMoves: Array.isArray(value.leagueMoves) ? value.leagueMoves : [],
    storedAt: value.storedAt,
  };
}

export async function readLeagueMoves(week) {
  const value = await readJson(`sources/cbs/v1/week-${week}/moves`);
  return Array.isArray(value) ? value : [];
}

export async function saveCbsLeagueState(snapshot, pack, { week } = {}) {
  const canonical = validateCanonicalCbsLeagueState(snapshot, pack);
  const prior = await readLatestCbsLeagueState(pack);
  if (prior?.snapshot.rawSha256 === canonical.rawSha256) return { ...prior, changed: false };
  const leagueMoves = diffLeagueOwnership(prior?.snapshot || null, canonical, pack);
  const storedAt = new Date().toISOString();
  const envelope = { snapshot: canonical, leagueMoves, storedAt };
  await store().setJSON(`sources/cbs/v1/raw/${canonical.rawSha256}`, envelope, { onlyIfNew: true });
  await store().setJSON("sources/cbs/v1/latest", envelope);
  if (Number.isSafeInteger(week) && week >= 1 && week <= 18 && leagueMoves.length) {
    const priorMoves = await readLeagueMoves(week);
    const byId = new Map([...priorMoves, ...leagueMoves].map((move) => [move.id, move]));
    await store().setJSON(`sources/cbs/v1/week-${week}/moves`, [...byId.values()].sort((left, right) => right.detectedAt.localeCompare(left.detectedAt)).slice(0, 500));
  }
  return { ...envelope, changed: true };
}

export async function readLatestFbgWeeklySnapshot(pack, week) {
  const value = await readJson(`sources/fbg/v1/week-${week}/latest`);
  return value ? validateFbgWeeklySnapshot(value, pack) : null;
}

export async function saveFbgWeeklySnapshot(snapshot, pack) {
  const weekly = validateFbgWeeklySnapshot(snapshot, pack);
  await store().setJSON(`sources/fbg/v1/week-${weekly.week}/raw/${weekly.rawSha256}`, weekly, { onlyIfNew: true });
  await store().setJSON(`sources/fbg/v1/week-${weekly.week}/latest`, weekly);
  return weekly;
}

export async function readLatestSupplementalWeeklySnapshot(pack, week, provider) {
  const value = await readJson(`sources/${provider}/v1/week-${week}/latest`);
  return value ? validateSupplementalWeeklySnapshot(value, pack, provider) : null;
}

export async function saveSupplementalWeeklySnapshot(snapshot, pack, provider) {
  const weekly = validateSupplementalWeeklySnapshot(snapshot, pack, provider);
  await store().setJSON(`sources/${provider}/v1/week-${weekly.week}/raw/${weekly.rawSha256}`, weekly, { onlyIfNew: true });
  await store().setJSON(`sources/${provider}/v1/week-${weekly.week}/latest`, weekly);
  return weekly;
}

function validatePlan(value) {
  if (!value || value.schemaVersion !== 1 || value.kind !== "thunder-bowl-season-recommendations" || value.season !== 2026) throw new Error("Stored in-season recommendation plan is invalid.");
  if (!Number.isSafeInteger(value.week) || value.week < 1 || value.week > 18 || !Number.isFinite(Date.parse(value.generatedAt))) throw new Error("Stored in-season recommendation plan has invalid timing.");
  if (!/^[a-f0-9]{64}$/.test(value.sourceFingerprint || "")) throw new Error("Stored in-season recommendation plan has invalid provenance.");
  return value;
}

export async function readLatestSeasonPlan() {
  const value = await readJson("plans/v1/latest");
  return value ? validatePlan(value) : null;
}

export async function readTuesdayArchive(week) {
  const value = await readJson(`plans/v1/2026/week-${week}/tuesday`);
  return value ? validatePlan(value) : null;
}

export async function saveSeasonPlan(value, { archiveTuesday = false } = {}) {
  const plan = validatePlan(value);
  const prefix = `plans/v1/${plan.season}/week-${plan.week}`;
  await store().setJSON(`${prefix}/sources/${plan.sourceFingerprint}`, plan, { onlyIfNew: true });
  await store().setJSON(`${prefix}/latest`, plan);
  await store().setJSON("plans/v1/latest", plan);
  let archived = false;
  if (archiveTuesday) {
    const write = await store().setJSON(`${prefix}/tuesday`, plan, { onlyIfNew: true });
    archived = write.modified;
  }
  return { plan, archived };
}

export async function claimScheduledRun(idempotencyKey, capturedAt = new Date().toISOString()) {
  const key = String(idempotencyKey || "").trim();
  if (!/^2026\/week-\d{1,2}\/[a-z0-9-]+\/v\d+$/.test(key)) throw new Error("Scheduled refresh idempotency key is invalid.");
  const write = await store().setJSON(`scheduled/v1/${key}`, { idempotencyKey: key, capturedAt }, { onlyIfNew: true });
  return write.modified;
}
