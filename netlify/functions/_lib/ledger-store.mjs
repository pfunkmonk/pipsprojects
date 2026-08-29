import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import {
  EVENT_TYPES,
  SCHEMA_VERSION,
  SEASON,
  mergeEventStreams,
  replayDraft,
  toPublicSnapshot,
  validateEvent,
} from "../../../public/thunder-bowl/state-engine.mjs";
import {
  INITIAL_LEDGER_GENERATION,
  assertExpectedLedgerGeneration,
  nextLedgerGeneration,
  normalizeLedgerGeneration,
} from "./ledger-generation.mjs";

const STORE_NAME = "thunder-bowl-2026";
const LEDGER_KEY = "auction-ledger-2026";
const EMPTY_ETAG = '"tb26-empty-v1"';
const MAX_IDEMPOTENCY_KEYS = 2_000;
const DOCUMENT_KEYS = new Set([
  "schemaVersion",
  "season",
  "generation",
  "auctioneerRevision",
  "updatedAt",
  "events",
  "operationalEvents",
  "completedIdempotencyKeys",
  "actorLabels",
]);
const OPERATION_TYPES = new Set([
  "TEAM_FINISHED",
  "TEAM_REOPENED",
  "NOMINATION_STAGED",
  "NOMINATION_CLEARED",
  "CLOCK_UPDATED",
]);
const CLOCK_STATUSES = new Set(["running", "paused"]);
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function publicText(value, label, maximum = 200) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum) throw new Error(`${label} is invalid.`);
  return text;
}

function exactKeys(value, required, optional, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains an unsupported field.`);
  for (const key of required) if (!(key in value)) throw new Error(`${label} is missing ${key}.`);
}

function validateClock(value) {
  exactKeys(value, ["status", "durationMs", "remainingMs", "deadline"], [], "Nomination clock");
  if (!CLOCK_STATUSES.has(value.status)) throw new Error("Nomination clock status is invalid.");
  if (!Number.isInteger(value.durationMs) || value.durationMs < 15_000 || value.durationMs > 600_000) throw new Error("Nomination clock duration is invalid.");
  if (!Number.isInteger(value.remainingMs) || value.remainingMs < 0 || value.remainingMs > value.durationMs) throw new Error("Nomination clock remaining time is invalid.");
  if (value.deadline !== null && (!Number.isSafeInteger(value.deadline) || value.deadline < 0)) throw new Error("Nomination clock deadline is invalid.");
  if (value.status === "running" && value.deadline === null) throw new Error("A running nomination clock requires a deadline.");
  if (value.status === "paused" && value.deadline !== null) throw new Error("A paused nomination clock cannot retain a deadline.");
  return { status: value.status, durationMs: value.durationMs, remainingMs: value.remainingMs, deadline: value.deadline };
}

function validateOperationalEvent(value) {
  exactKeys(value, ["id", "type", "createdAt", "actorLabel"], ["teamId", "player", "clock"], "Operational event");
  const event = {
    id: publicText(value.id, "Operational event id", 120),
    type: publicText(value.type, "Operational event type", 40),
    createdAt: new Date(value.createdAt).toISOString(),
    actorLabel: publicText(value.actorLabel, "Operational actor", 80),
  };
  if (!OPERATION_TYPES.has(event.type)) throw new Error("Operational event type is invalid.");
  if (["TEAM_FINISHED", "TEAM_REOPENED"].includes(event.type)) {
    if (value.player !== undefined || value.clock !== undefined) throw new Error("Team operation contains unrelated data.");
    event.teamId = publicText(value.teamId, "Operational team id", 120);
  } else if (event.type === "NOMINATION_STAGED") {
    if (value.teamId !== undefined || value.clock !== undefined) throw new Error("Nomination operation contains unrelated data.");
    exactKeys(value.player, ["id", "name", "position", "nflTeam"], ["byeWeek"], "Staged player");
    if (!POSITIONS.has(value.player.position)) throw new Error("Staged player position is invalid.");
    if (value.player.byeWeek !== undefined && value.player.byeWeek !== null
      && (!Number.isInteger(value.player.byeWeek) || value.player.byeWeek < 1 || value.player.byeWeek > 18)) {
      throw new Error("Staged player bye week is invalid.");
    }
    event.player = {
      id: publicText(value.player.id, "Staged player id", 120),
      name: publicText(value.player.name, "Staged player name"),
      position: value.player.position,
      nflTeam: publicText(value.player.nflTeam, "Staged player NFL team", 20),
      ...(Number.isInteger(value.player.byeWeek) ? { byeWeek: value.player.byeWeek } : {}),
    };
  } else if (event.type === "CLOCK_UPDATED") {
    if (value.teamId !== undefined || value.player !== undefined) throw new Error("Clock operation contains unrelated data.");
    event.clock = validateClock(value.clock);
  } else if (value.teamId !== undefined || value.player !== undefined || value.clock !== undefined) {
    throw new Error("Clear-nomination operation contains unrelated data.");
  }
  return event;
}

function validateOperationalEvents(values) {
  if (!Array.isArray(values) || values.length > 10_000) throw new Error("Operational event history is invalid.");
  const ids = new Set();
  return values.map((value) => {
    const event = validateOperationalEvent(value);
    if (ids.has(event.id)) throw new Error("Operational event ids must be unique.");
    ids.add(event.id);
    return event;
  });
}

export function validateAuctioneerOperationalEvents(values) {
  return validateOperationalEvents(values);
}

function validateIdempotencyKeys(values) {
  if (!Array.isArray(values) || values.length > MAX_IDEMPOTENCY_KEYS) throw new Error("Auctioneer idempotency history is invalid.");
  const keys = values.map((value) => publicText(value, "Auctioneer idempotency key", 200));
  if (new Set(keys).size !== keys.length) throw new Error("Auctioneer idempotency keys must be unique.");
  return keys;
}

function validateActorLabels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Actor labels are invalid.");
  return Object.fromEntries(Object.entries(value).map(([eventId, label]) => [
    publicText(eventId, "Actor event id", 120),
    publicText(label, "Actor label", 80),
  ]));
}

function emptyDocument() {
  return {
    schemaVersion: SCHEMA_VERSION,
    season: SEASON,
    generation: INITIAL_LEDGER_GENERATION,
    auctioneerRevision: 0,
    updatedAt: null,
    events: [],
    operationalEvents: [],
    completedIdempotencyKeys: [],
    actorLabels: {},
  };
}

function validateDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored ledger is not an object.");
  for (const key of Object.keys(value)) if (!DOCUMENT_KEYS.has(key)) throw new Error("Stored ledger has an unexpected shape.");
  if (value.schemaVersion !== SCHEMA_VERSION || value.season !== SEASON || !Array.isArray(value.events)) {
    throw new Error("Stored ledger schema does not match Thunder Bowl 2026.");
  }
  const events = value.events.map(validateEvent);
  replayDraft(events);
  const auctioneerRevision = value.auctioneerRevision === undefined ? 0 : Number(value.auctioneerRevision);
  if (!Number.isSafeInteger(auctioneerRevision) || auctioneerRevision < 0) throw new Error("Auctioneer revision is invalid.");
  return {
    schemaVersion: SCHEMA_VERSION,
    season: SEASON,
    generation: value.generation === undefined ? INITIAL_LEDGER_GENERATION : normalizeLedgerGeneration(value.generation),
    auctioneerRevision,
    updatedAt: value.updatedAt || null,
    events,
    operationalEvents: validateOperationalEvents(value.operationalEvents || []),
    completedIdempotencyKeys: validateIdempotencyKeys(value.completedIdempotencyKeys || []),
    actorLabels: validateActorLabels(value.actorLabels || {}),
  };
}

function incrementAuctioneerRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) throw new Error("Auctioneer revision has reached its safe limit.");
  return value + 1;
}

function conflict(message, currentRevision = null) {
  const error = new Error(message);
  error.code = "LEDGER_CONFLICT";
  error.currentRevision = currentRevision;
  return error;
}

const FINAL_KEEPER_PROTECTED_TYPES = new Set([
  EVENT_TYPES.DRAFT_CONFIGURED,
  EVENT_TYPES.CAP_TRANSFERRED,
  EVENT_TYPES.KEEPER_RIGHTS_TRADED,
  EVENT_TYPES.KEEPER_ASSIGNED,
  EVENT_TYPES.KEEPER_PASSED,
  EVENT_TYPES.KEEPERS_FINALIZED,
]);

function finalKeeperProtectedStream(events) {
  const protectedIds = new Set(events
    .filter((event) => FINAL_KEEPER_PROTECTED_TYPES.has(event.type))
    .map((event) => event.id));
  return events.filter((event) => FINAL_KEEPER_PROTECTED_TYPES.has(event.type)
    || (event.type === EVENT_TYPES.EVENT_VOIDED && protectedIds.has(event.payload.targetEventId)));
}

export function assertAuctioneerKeeperSetupUnchanged(currentEvents, candidateEvents) {
  const currentState = replayDraft(currentEvents);
  if (!currentState.keeperFinalization) return true;
  const currentProtected = finalKeeperProtectedStream(currentEvents);
  const candidateProtected = finalKeeperProtectedStream(candidateEvents);
  if (JSON.stringify(currentProtected) !== JSON.stringify(candidateProtected)) {
    const error = new Error("The final 2026 keeper set is organizer-locked. The auctioneer can view keepers but cannot edit, undo, restore, or reconcile them.");
    error.code = "KEEPERS_FINALIZED";
    error.status = 403;
    throw error;
  }
  return true;
}

function assertKeeperFinalizationReady(currentEvents, mergedEvents) {
  const currentState = replayDraft(currentEvents);
  const mergedState = replayDraft(mergedEvents);
  if (currentState.keeperFinalization || !mergedState.keeperFinalization) return;
  const finalization = mergedState.keeperFinalization;
  if (!finalization.selectionComplete || !finalization.canonical) {
    const error = new Error(`Finalize keepers only after every keeper turn is complete and the ${finalization.keeperCount}-keeper count matches the active official ledger.`);
    error.code = "KEEPERS_NOT_READY_TO_FINALIZE";
    throw error;
  }
}

export async function readLedger(options = {}) {
  const requestedEtag = options.etag || undefined;
  const entry = await store().getWithMetadata(LEDGER_KEY, {
    consistency: "strong",
    type: "json",
    ...(requestedEtag ? { etag: requestedEtag } : {}),
  });
  if (!entry) return { document: emptyDocument(), etag: EMPTY_ETAG, notModified: requestedEtag === EMPTY_ETAG };
  if (entry.data === null) return { document: null, etag: entry.etag, notModified: true };
  return { document: validateDocument(entry.data), etag: entry.etag, notModified: false };
}

export async function appendLedgerEvents(incomingEvents, expectedGeneration = null) {
  if (!Array.isArray(incomingEvents) || incomingEvents.length > 500) {
    const error = new Error("Sync payload must contain no more than 500 events.");
    error.code = "INVALID_SYNC_PAYLOAD";
    throw error;
  }
  const validatedIncoming = incomingEvents.map(validateEvent);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await readLedger();
    assertExpectedLedgerGeneration(current.document.generation, expectedGeneration);
    const mergedEvents = mergeEventStreams(current.document.events, validatedIncoming);
    assertKeeperFinalizationReady(current.document.events, mergedEvents);
    if (mergedEvents.length === current.document.events.length) return { document: current.document, etag: current.etag, changed: false };
    const document = {
      ...current.document,
      auctioneerRevision: incrementAuctioneerRevision(current.document.auctioneerRevision),
      updatedAt: new Date().toISOString(),
      events: mergedEvents,
    };
    replayDraft(document.events);
    const write = await store().setJSON(LEDGER_KEY, document, current.etag === EMPTY_ETAG ? { onlyIfNew: true } : { onlyIfMatch: current.etag });
    if (write.modified) return { document, etag: write.etag, changed: true };
  }
  throw conflict("Another writer changed the ledger repeatedly. Retry the sync.");
}

export async function commitAuctioneerLedger({ events, operationalEvents, expectedRevision, idempotencyKey, actorRole = "auctioneer" }) {
  const key = publicText(idempotencyKey, "Auctioneer idempotency key", 200);
  const candidateEvents = events.map(validateEvent);
  replayDraft(candidateEvents);
  const candidateOperations = validateOperationalEvents(operationalEvents || []);
  const current = await readLedger();
  if (actorRole === "auctioneer") assertAuctioneerKeeperSetupUnchanged(current.document.events, candidateEvents);
  if (current.document.completedIdempotencyKeys.includes(key)) return { document: current.document, etag: current.etag, changed: false };
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.document.auctioneerRevision) {
    throw conflict("Another draft action was saved first. The auctioneer has refreshed; retry this action.", current.document.auctioneerRevision);
  }
  const currentEventIds = new Set(current.document.events.map((event) => event.id));
  const actorLabel = actorRole === "auctioneer" ? "Auctioneer" : "Command center";
  const actorLabels = { ...current.document.actorLabels };
  for (const event of candidateEvents) if (!currentEventIds.has(event.id)) actorLabels[event.id] = actorLabel;
  const document = {
    ...current.document,
    auctioneerRevision: incrementAuctioneerRevision(current.document.auctioneerRevision),
    updatedAt: new Date().toISOString(),
    events: candidateEvents,
    operationalEvents: candidateOperations,
    completedIdempotencyKeys: [...current.document.completedIdempotencyKeys, key].slice(-MAX_IDEMPOTENCY_KEYS),
    actorLabels,
  };
  const write = await store().setJSON(LEDGER_KEY, document, current.etag === EMPTY_ETAG ? { onlyIfNew: true } : { onlyIfMatch: current.etag });
  if (!write.modified) throw conflict("Another draft action was saved first. The auctioneer has refreshed; retry this action.");
  return { document, etag: write.etag, changed: true };
}

function archiveReason(value) {
  if (typeof value !== "string") {
    const error = new Error("Archive reason must be text.");
    error.code = "INVALID_ARCHIVE_REQUEST";
    throw error;
  }
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 120) {
    const error = new Error("Archive reason must be between 3 and 120 characters.");
    error.code = "INVALID_ARCHIVE_REQUEST";
    throw error;
  }
  return reason;
}

export async function archiveAndResetLedger(reasonValue, expectedGeneration) {
  const reason = archiveReason(reasonValue);
  const current = await readLedger();
  assertExpectedLedgerGeneration(current.document.generation, expectedGeneration);
  const archivedAt = new Date().toISOString();
  const archiveId = `archive-${archivedAt.replace(/[:.]/g, "-")}-${randomUUID()}`;
  const archiveKey = `archives/${SEASON}/${archiveId}`;
  const archive = {
    schemaVersion: SCHEMA_VERSION,
    season: SEASON,
    kind: "thunder-bowl-ledger-archive",
    archiveId,
    archivedAt,
    reason,
    sourceGeneration: current.document.generation,
    sourceRevision: current.etag,
    eventCount: current.document.events.length,
    ledger: current.document,
  };
  const archiveWrite = await store().setJSON(archiveKey, archive, { onlyIfNew: true });
  if (!archiveWrite.modified) {
    const error = new Error("A unique archive could not be created. The active ledger was not changed.");
    error.code = "LEDGER_ARCHIVE_CONFLICT";
    throw error;
  }
  const document = {
    ...emptyDocument(),
    generation: nextLedgerGeneration(current.document.generation),
    auctioneerRevision: incrementAuctioneerRevision(current.document.auctioneerRevision),
    updatedAt: archivedAt,
  };
  const resetWrite = await store().setJSON(LEDGER_KEY, document, current.etag === EMPTY_ETAG ? { onlyIfNew: true } : { onlyIfMatch: current.etag });
  if (!resetWrite.modified) {
    const error = new Error("The active ledger changed while it was being archived. It was not reset; retry after syncing.");
    error.code = "LEDGER_CONFLICT";
    throw error;
  }
  return { document, etag: resetWrite.etag, archiveId, archivedAt, eventCount: archive.eventCount };
}

export function publicSnapshot(document, etag) {
  const state = replayDraft(document.events);
  return toPublicSnapshot(state, { updatedAt: document.updatedAt, revision: etag });
}
