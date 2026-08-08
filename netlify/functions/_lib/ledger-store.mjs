import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import {
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

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function emptyDocument() {
  return {
    schemaVersion: SCHEMA_VERSION,
    season: SEASON,
    generation: INITIAL_LEDGER_GENERATION,
    updatedAt: null,
    events: [],
  };
}

function validateDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored ledger is not an object.");
  const keys = Object.keys(value).sort();
  const legacyKeys = ["events", "schemaVersion", "season", "updatedAt"];
  const currentKeys = ["events", "generation", "schemaVersion", "season", "updatedAt"];
  if (JSON.stringify(keys) !== JSON.stringify(legacyKeys) && JSON.stringify(keys) !== JSON.stringify(currentKeys)) {
    throw new Error("Stored ledger has an unexpected shape.");
  }
  if (value.schemaVersion !== SCHEMA_VERSION || value.season !== SEASON || !Array.isArray(value.events)) {
    throw new Error("Stored ledger schema does not match Thunder Bowl 2026.");
  }
  const events = value.events.map(validateEvent);
  replayDraft(events);
  return {
    schemaVersion: SCHEMA_VERSION,
    season: SEASON,
    generation: value.generation === undefined
      ? INITIAL_LEDGER_GENERATION
      : normalizeLedgerGeneration(value.generation),
    updatedAt: value.updatedAt || null,
    events,
  };
}

export async function readLedger(options = {}) {
  const requestedEtag = options.etag || undefined;
  const entry = await store().getWithMetadata(LEDGER_KEY, {
    consistency: "strong",
    type: "json",
    ...(requestedEtag ? { etag: requestedEtag } : {}),
  });
  if (!entry) {
    return {
      document: emptyDocument(),
      etag: EMPTY_ETAG,
      notModified: requestedEtag === EMPTY_ETAG,
    };
  }
  if (entry.data === null) {
    return { document: null, etag: entry.etag, notModified: true };
  }
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
    const currentEvents = current.document.events;
    const mergedEvents = mergeEventStreams(currentEvents, validatedIncoming);
    if (mergedEvents.length === currentEvents.length) {
      return { document: current.document, etag: current.etag, changed: false };
    }
    const document = {
      schemaVersion: SCHEMA_VERSION,
      season: SEASON,
      generation: current.document.generation,
      updatedAt: new Date().toISOString(),
      events: mergedEvents,
    };
    replayDraft(document.events);
    const write = await store().setJSON(
      LEDGER_KEY,
      document,
      current.etag === EMPTY_ETAG ? { onlyIfNew: true } : { onlyIfMatch: current.etag },
    );
    if (write.modified) return { document, etag: write.etag, changed: true };
  }
  const error = new Error("Another writer changed the ledger repeatedly. Retry the sync.");
  error.code = "LEDGER_CONFLICT";
  throw error;
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
    schemaVersion: SCHEMA_VERSION,
    season: SEASON,
    generation: nextLedgerGeneration(current.document.generation),
    updatedAt: archivedAt,
    events: [],
  };
  const resetWrite = await store().setJSON(
    LEDGER_KEY,
    document,
    current.etag === EMPTY_ETAG ? { onlyIfNew: true } : { onlyIfMatch: current.etag },
  );
  if (!resetWrite.modified) {
    const error = new Error("The active ledger changed while it was being archived. It was not reset; retry after syncing.");
    error.code = "LEDGER_CONFLICT";
    throw error;
  }
  return {
    document,
    etag: resetWrite.etag,
    archiveId,
    archivedAt,
    eventCount: archive.eventCount,
  };
}

export function publicSnapshot(document, etag) {
  const state = replayDraft(document.events);
  return toPublicSnapshot(state, { updatedAt: document.updatedAt, revision: etag });
}
