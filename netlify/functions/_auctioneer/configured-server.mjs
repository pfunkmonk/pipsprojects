import { readFile } from "node:fs/promises";
import * as stateEngine from "../../../public/thunder-bowl/state-engine.mjs";
import { displayBoardUrl as existingDisplayBoardUrl, verifyDisplayToken } from "../_lib/auth.mjs";
import { commitAuctioneerLedger, readLedger } from "../_lib/ledger-store.mjs";
import { createNativeLedgerService } from "./native-ledger-service.mjs";
import { createHttpHandlers } from "./http-handlers.mjs";

const PACK_PATHS = [
  new URL("./_data/draft-pack-2026-provisional.json", import.meta.url),
  new URL("../_data/draft-pack-2026-provisional.json", import.meta.url),
];
let cachedDraftPack = null;

async function loadDraftPack() {
  if (!cachedDraftPack) {
    let lastError;
    for (const path of PACK_PATHS) {
      try {
        cachedDraftPack = JSON.parse(await readFile(path, "utf8"));
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!cachedDraftPack) throw lastError || new Error("The protected draft pack is unavailable.");
  }
  return cachedDraftPack;
}

function contextFrom(document, draftPack) {
  return {
    events: document.events,
    operationalEvents: document.operationalEvents,
    generation: document.auctioneerRevision,
    ledgerGeneration: document.generation,
    draftPack,
    updatedAt: document.updatedAt,
    actorLabels: document.actorLabels,
    completedIdempotencyKeys: document.completedIdempotencyKeys,
  };
}

export async function loadNativeAuction() {
  const [current, draftPack] = await Promise.all([readLedger(), loadDraftPack()]);
  return contextFrom(current.document, draftPack);
}

export async function commitCanonicalAuction({ events, operationalEvents, expectedGeneration, idempotencyKey, actorRole }) {
  const [result, draftPack] = await Promise.all([
    commitAuctioneerLedger({
      events,
      operationalEvents,
      expectedRevision: expectedGeneration,
      idempotencyKey,
      actorRole,
    }),
    loadDraftPack(),
  ]);
  return contextFrom(result.document, draftPack);
}

export async function authorizeExistingDisplayLink(request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  return verifyDisplayToken(token);
}

const service = createNativeLedgerService({
  adapter: { load: loadNativeAuction, commitCanonical: commitCanonicalAuction },
  stateEngine,
});

export const handlers = createHttpHandlers({
  service,
  authorizeDisplay: authorizeExistingDisplayLink,
  displayBoardUrl: existingDisplayBoardUrl,
});
