import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { auditDraftPack } from "../../../scripts/pack-release-gate.mjs";
import { validateDraftPack } from "../../../public/thunder-bowl/state-engine.mjs";

const STORE_NAME = "thunder-bowl-2026";
const RELEASE_KEY = "draft-pack-release-2026";

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export function draftPackSha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function promotionGate(packInput) {
  const pack = validateDraftPack(packInput);
  const audit = auditDraftPack(pack);
  const blockingIssues = [...audit.blockingIssues];
  if (pack.status !== "practice" && pack.status !== "production") blockingIssues.push("Only the validated practice pack can be promoted.");
  if (pack.season !== 2026 || pack.players.length < 650) blockingIssues.push("The final pack must cover the 2026 player universe.");
  if (pack.managerProfiles?.length !== pack.leagueConfig.teams.length) blockingIssues.push("Every team must have an advisory manager profile.");
  if (pack.weeklyContext?.status !== "loaded_validated_schedule_weighting") blockingIssues.push("Validated weekly timing evidence is required.");
  if (pack.weeklyContext?.coveredPlayers !== pack.players.length) blockingIssues.push("Weekly timing evidence must cover the full player pool.");
  return { approved: blockingIssues.length === 0, blockingIssues, audit };
}

export async function readDraftPackRelease() {
  try {
    const value = await store().get(RELEASE_KEY, { type: "json" });
    if (!value || value.schemaVersion !== 1 || value.season !== 2026) return null;
    return value;
  } catch {
    // The release flag is an optional overlay. If Blob storage is unavailable,
    // keep serving the authenticated, offline-capable practice pack.
    return null;
  }
}

export async function promoteDraftPack({ packText, packId, promotedBy = "dogs-of-war" }) {
  const pack = validateDraftPack(JSON.parse(packText));
  if (pack.packId !== packId) {
    const error = new Error("The loaded pack changed. Refresh before promoting it.");
    error.code = "PACK_RELEASE_CONFLICT";
    throw error;
  }
  const gate = promotionGate(pack);
  if (!gate.approved) {
    const error = new Error(`The final-pack gate blocked promotion: ${gate.blockingIssues.join(" | ")}`);
    error.code = "PACK_RELEASE_BLOCKED";
    throw error;
  }
  const release = {
    schemaVersion: 1,
    season: 2026,
    packId: pack.packId,
    packSha256: draftPackSha256(packText),
    promotedAt: new Date().toISOString(),
    promotedBy,
  };
  await store().setJSON(RELEASE_KEY, release);
  return release;
}

export function releasedPackText(packText, release) {
  if (!release) return packText;
  const pack = JSON.parse(packText);
  if (release.packId !== pack.packId || release.packSha256 !== draftPackSha256(packText)) return packText;
  pack.status = "production";
  return `${JSON.stringify(pack, null, 2)}\n`;
}
