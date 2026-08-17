import { getStore } from "@netlify/blobs";
import { validateLeagueDocument } from "../../../public/draft-day/core.mjs";

const STORE_NAME = "pips-draft-day-v1";

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function key(leagueCode) {
  return `leagues/${leagueCode.replace("-", "").toLowerCase()}`;
}

export function createBlobRepository() {
  return {
    async create(document) {
      const normalized = validateLeagueDocument(document);
      const result = await store().setJSON(key(normalized.leagueCode), normalized, { onlyIfNew: true });
      if (!result.modified) {
        const error = new Error("That league code is already in use.");
        error.code = "LEAGUE_CODE_CONFLICT";
        error.status = 409;
        throw error;
      }
      return { document: normalized, etag: result.etag };
    },

    async read(leagueCode) {
      const entry = await store().getWithMetadata(key(leagueCode), { consistency: "strong", type: "json" });
      if (!entry?.data) {
        const error = new Error("League not found. Check the eight-character league code.");
        error.code = "LEAGUE_NOT_FOUND";
        error.status = 404;
        throw error;
      }
      return { document: validateLeagueDocument(entry.data), etag: entry.etag || null };
    },

    async commit(document, etag) {
      const normalized = validateLeagueDocument(document);
      // Netlify production returns an ETag and receives a true compare-and-swap.
      // The local Blobs sandbox omits it, so revision validation remains the fallback there.
      const result = await store().setJSON(key(normalized.leagueCode), normalized, etag ? { onlyIfMatch: etag } : {});
      if (!result.modified) {
        const error = new Error("Another auction action was saved first. Refresh and retry.");
        error.code = "REVISION_CONFLICT";
        error.status = 409;
        throw error;
      }
      return { document: normalized, etag: result.etag };
    },
  };
}
