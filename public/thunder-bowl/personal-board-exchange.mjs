import {
  isEmptyAnnotation,
  validatePlayerAnnotation,
  validatePlayerAnnotations,
} from "./player-annotations.mjs?v=20260805g";

export const PERSONAL_BOARD_SCHEMA_VERSION = 2;
export const PERSONAL_BOARD_EVIDENCE_SCHEMA_VERSION = 2;

function exactKeys(input, expected, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${label} is invalid.`);
  const keys = Object.keys(input);
  if (keys.length !== expected.length || !expected.every((key) => key in input)) throw new Error(`${label} schema mismatch.`);
}

function seasonNumber(value) {
  const season = Number(value);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) throw new Error("Personal board season is invalid.");
  return season;
}

function playerIndex(players) {
  if (!Array.isArray(players) || !players.length) throw new Error("The active player pack is unavailable.");
  const index = new Map();
  for (const player of players) {
    if (!player?.id || index.has(player.id)) throw new Error("The active player pack contains an invalid or duplicate player identifier.");
    index.set(player.id, player);
  }
  return index;
}

function portablePlayerIdentity(player) {
  return {
    playerId: String(player.id),
    playerName: String(player.name || ""),
    position: String(player.position || ""),
    nflTeam: String(player.nflTeam || ""),
  };
}

function kindFor(season) {
  return `thunder-bowl-${season}-personal-board`;
}

function evidenceKindFor(season) {
  return `thunder-bowl-${season}-personal-board-evidence`;
}

export function createPersonalBoardBundle({ season, packId, players, annotations, exportedAt = new Date().toISOString() }) {
  const normalizedSeason = seasonNumber(season);
  if (typeof packId !== "string" || !packId.trim() || packId.length > 240) throw new Error("Personal board source pack is invalid.");
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error("Personal board export time is invalid.");
  const index = playerIndex(players);
  const validatedAnnotations = validatePlayerAnnotations(annotations, index.keys());
  const entries = Object.entries(validatedAnnotations)
    .filter(([, annotation]) => !isEmptyAnnotation(annotation))
    .map(([playerId, annotation]) => ({
      ...portablePlayerIdentity(index.get(playerId)),
      annotation,
    }))
    .sort((left, right) => left.playerName.localeCompare(right.playerName) || left.playerId.localeCompare(right.playerId));
  return Object.freeze({
    schemaVersion: PERSONAL_BOARD_SCHEMA_VERSION,
    kind: kindFor(normalizedSeason),
    season: normalizedSeason,
    scope: "full-board",
    exportedAt,
    sourcePackId: packId.trim(),
    modelEffect: "none",
    ledgerEffect: "none",
    entries: Object.freeze(entries),
  });
}

export function validatePersonalBoardBundle(input, { season, players }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Personal board file is invalid.");
  const legacy = input.schemaVersion === 1;
  exactKeys(input, legacy
    ? ["schemaVersion", "kind", "season", "exportedAt", "sourcePackId", "modelEffect", "ledgerEffect", "entries"]
    : ["schemaVersion", "kind", "season", "scope", "exportedAt", "sourcePackId", "modelEffect", "ledgerEffect", "entries"], "Personal board file");
  const expectedSeason = seasonNumber(season);
  if (!legacy && input.schemaVersion !== PERSONAL_BOARD_SCHEMA_VERSION) throw new Error("Personal board schema version is unsupported.");
  if (input.season !== expectedSeason || input.kind !== kindFor(expectedSeason)) throw new Error(`Choose a ${expectedSeason} Thunder Bowl personal board file.`);
  if (!legacy && input.scope !== "full-board") throw new Error("Personal board scope is invalid.");
  if (!Number.isFinite(Date.parse(input.exportedAt))) throw new Error("Personal board export time is invalid.");
  if (typeof input.sourcePackId !== "string" || !input.sourcePackId.trim() || input.sourcePackId.length > 240) throw new Error("Personal board source pack is invalid.");
  if (input.modelEffect !== "none" || input.ledgerEffect !== "none") throw new Error("Personal board authority boundary is invalid.");
  if (!Array.isArray(input.entries)) throw new Error("Personal board entries are invalid.");

  const index = playerIndex(players);
  const seen = new Set();
  const entries = input.entries.map((entry) => {
    exactKeys(entry, ["playerId", "playerName", "position", "nflTeam", "annotation"], "Personal board entry");
    if (seen.has(entry.playerId)) throw new Error("Personal board contains a duplicate player.");
    seen.add(entry.playerId);
    const current = index.get(entry.playerId);
    if (!current) throw new Error(`Personal board contains an unknown player: ${entry.playerId}.`);
    const identity = portablePlayerIdentity(current);
    for (const key of ["playerId", "playerName", "position", "nflTeam"]) {
      if (entry[key] !== identity[key]) throw new Error(`Personal board player identity changed for ${entry.playerId}.`);
    }
    const annotation = validatePlayerAnnotation(entry.annotation);
    if (isEmptyAnnotation(annotation)) throw new Error(`Personal board contains an empty decision for ${entry.playerId}.`);
    return Object.freeze({ ...identity, annotation });
  });

  return Object.freeze({
    schemaVersion: input.schemaVersion,
    kind: input.kind,
    season: expectedSeason,
    scope: legacy ? "legacy-merge" : "full-board",
    exportedAt: input.exportedAt,
    sourcePackId: input.sourcePackId.trim(),
    modelEffect: "none",
    ledgerEffect: "none",
    entries: Object.freeze(entries),
  });
}

export function mergePersonalBoardAnnotations(current, bundle, knownPlayerIds) {
  const merged = validatePlayerAnnotations(current, knownPlayerIds);
  for (const entry of bundle.entries) merged[entry.playerId] = entry.annotation;
  return validatePlayerAnnotations(merged, knownPlayerIds);
}

export function replacePersonalBoardAnnotations(bundle, knownPlayerIds) {
  if (bundle.scope !== "full-board") throw new Error("Only a complete personal-board file can replace local decisions.");
  const replacement = Object.fromEntries(bundle.entries.map((entry) => [entry.playerId, entry.annotation]));
  return validatePlayerAnnotations(replacement, knownPlayerIds);
}

function canonicalDecisionPayload(bundle) {
  const entries = [...bundle.entries]
    .sort((left, right) => left.playerId.localeCompare(right.playerId))
    .map((entry) => ({
      playerId: entry.playerId,
      playerName: entry.playerName,
      position: entry.position,
      nflTeam: entry.nflTeam,
      annotation: {
        schemaVersion: entry.annotation.schemaVersion,
        tag: entry.annotation.tag,
        personalMax: entry.annotation.personalMax,
        stealPrice: entry.annotation.stealPrice,
        note: entry.annotation.note,
        updatedAt: entry.annotation.updatedAt,
      },
    }));
  return JSON.stringify({ season: bundle.season, entries });
}

export async function personalBoardFingerprint(bundle) {
  if (!bundle || !Array.isArray(bundle.entries)) throw new Error("Personal board fingerprint requires a validated bundle.");
  const bytes = new TextEncoder().encode(canonicalDecisionPayload(bundle));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createPersonalBoardEvidence({ bundle, action, recordedAt = new Date().toISOString() }) {
  if (!bundle || bundle.schemaVersion !== PERSONAL_BOARD_SCHEMA_VERSION) throw new Error("Personal board evidence requires a validated bundle.");
  if (!["export", "import"].includes(action)) throw new Error("Personal board evidence action is invalid.");
  if (!Number.isFinite(Date.parse(recordedAt))) throw new Error("Personal board evidence time is invalid.");
  return Object.freeze({
    schemaVersion: PERSONAL_BOARD_EVIDENCE_SCHEMA_VERSION,
    kind: evidenceKindFor(bundle.season),
    season: bundle.season,
    action,
    recordedAt,
    boardSchemaVersion: bundle.schemaVersion,
    decisionCount: bundle.entries.length,
    fingerprint: await personalBoardFingerprint(bundle),
    modelEffect: "none",
    ledgerEffect: "none",
  });
}

export function validatePersonalBoardEvidence(input, { season }) {
  exactKeys(
    input,
    ["schemaVersion", "kind", "season", "action", "recordedAt", "boardSchemaVersion", "decisionCount", "fingerprint", "modelEffect", "ledgerEffect"],
    "Personal board backup evidence",
  );
  const expectedSeason = seasonNumber(season);
  if (input.schemaVersion !== PERSONAL_BOARD_EVIDENCE_SCHEMA_VERSION) throw new Error("Personal board backup evidence schema version is unsupported.");
  if (input.season !== expectedSeason || input.kind !== evidenceKindFor(expectedSeason)) throw new Error("Personal board backup evidence season is invalid.");
  if (!["export", "import"].includes(input.action)) throw new Error("Personal board backup evidence action is invalid.");
  if (!Number.isFinite(Date.parse(input.recordedAt))) throw new Error("Personal board backup evidence time is invalid.");
  if (input.boardSchemaVersion !== PERSONAL_BOARD_SCHEMA_VERSION) throw new Error("Personal board backup evidence refers to an obsolete board schema.");
  if (!Number.isSafeInteger(input.decisionCount) || input.decisionCount < 0 || input.decisionCount > 2000) throw new Error("Personal board backup evidence count is invalid.");
  if (!/^[a-f0-9]{64}$/.test(input.fingerprint)) throw new Error("Personal board backup evidence fingerprint is invalid.");
  if (input.modelEffect !== "none" || input.ledgerEffect !== "none") throw new Error("Personal board backup evidence authority boundary is invalid.");
  return Object.freeze({ ...input });
}

export function personalBoardEvidenceStatus(evidence, {
  season,
  decisionCount,
  fingerprint,
  now = new Date().toISOString(),
  maximumAgeHours = 168,
} = {}) {
  const expectedSeason = seasonNumber(season);
  if (!Number.isSafeInteger(decisionCount) || decisionCount < 0) throw new Error("Current personal board decision count is invalid.");
  const nowTimestamp = Date.parse(now);
  if (!Number.isFinite(nowTimestamp)) throw new Error("Current personal board evidence time is invalid.");
  if (decisionCount === 0) return { current: true, reason: "No personal player decisions currently require transfer backup.", ageHours: 0, action: null };
  if (!/^[a-f0-9]{64}$/.test(fingerprint || "")) return { current: false, reason: "The current personal board could not be fingerprinted.", ageHours: Number.POSITIVE_INFINITY, action: null };
  let normalized;
  try {
    normalized = validatePersonalBoardEvidence(evidence, { season: expectedSeason });
  } catch {
    return { current: false, reason: "No valid private JSON backup or Mac restore is recorded for this personal board.", ageHours: Number.POSITIVE_INFINITY, action: null };
  }
  const recordedTimestamp = Date.parse(normalized.recordedAt);
  if (recordedTimestamp > nowTimestamp + 5 * 60_000) return { current: false, reason: "The personal-board evidence time is in the future.", ageHours: 0, action: normalized.action };
  const ageHours = Math.max(0, (nowTimestamp - recordedTimestamp) / 3_600_000);
  if (normalized.decisionCount !== decisionCount || normalized.fingerprint !== fingerprint) {
    return { current: false, reason: "The personal board changed after its last private JSON backup or restore.", ageHours, action: normalized.action };
  }
  if (!Number.isFinite(maximumAgeHours) || maximumAgeHours <= 0 || ageHours > maximumAgeHours) {
    return { current: false, reason: `The matching personal-board ${normalized.action} is more than ${maximumAgeHours} hours old.`, ageHours, action: normalized.action };
  }
  return {
    current: true,
    reason: normalized.action === "import"
      ? `${decisionCount} personal player decision${decisionCount === 1 ? "" : "s"} were restored on this laptop from private JSON.`
      : `${decisionCount} personal player decision${decisionCount === 1 ? " matches" : "s match"} the latest private JSON backup.`,
    ageHours,
    action: normalized.action,
  };
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function personalBoardCsv(bundle) {
  const header = ["player_id", "player_name", "position", "nfl_team", "tag", "steal_price", "hard_stop", "personal_note", "updated_at"];
  const rows = bundle.entries.map((entry) => [
    entry.playerId,
    entry.playerName,
    entry.position,
    entry.nflTeam,
    entry.annotation.tag,
    entry.annotation.stealPrice,
    entry.annotation.personalMax,
    entry.annotation.note,
    entry.annotation.updatedAt,
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
