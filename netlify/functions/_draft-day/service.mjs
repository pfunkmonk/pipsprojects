import { randomBytes, randomUUID } from "node:crypto";
import {
  applyCommand,
  DRAFT_DAY_SCHEMA_VERSION,
  normalizeLeagueCode,
  normalizeLeagueConfig,
  publicSnapshot,
  snapshotFromDocument,
} from "../../../public/draft-day/core.mjs";
import { accessRecords, verifyAccessCode } from "./security.mjs";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomLeagueCode() {
  const bytes = randomBytes(8);
  const characters = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
  return `${characters.slice(0, 4)}-${characters.slice(4)}`;
}

export function createDraftDayService({ repository, now = () => new Date().toISOString(), leagueCode = randomLeagueCode }) {
  if (!repository?.create || !repository?.read || !repository?.commit) throw new Error("Draft Day repository is required.");

  async function createLeague(input) {
    const config = normalizeLeagueConfig(input?.config);
    const access = accessRecords(input?.access);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = normalizeLeagueCode(leagueCode());
      const timestamp = now();
      const document = {
        schemaVersion: DRAFT_DAY_SCHEMA_VERSION,
        leagueCode: code,
        revision: 0,
        nominationStep: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        config,
        events: [],
        completedIdempotencyKeys: [],
        access,
      };
      try {
        const created = await repository.create(document);
        return snapshotFromDocument(created.document);
      } catch (error) {
        if (error?.code !== "LEAGUE_CODE_CONFLICT") throw error;
      }
    }
    throw new Error("A unique league code could not be allocated. Try again.");
  }

  async function authenticate({ leagueCode: suppliedLeagueCode, role, code }) {
    const normalizedLeagueCode = normalizeLeagueCode(suppliedLeagueCode);
    if (!["admin", "auctioneer", "board"].includes(role)) throw new Error("Choose a valid access role.");
    const current = await repository.read(normalizedLeagueCode);
    if (!verifyAccessCode(code, current.document.access[role])) {
      const error = new Error("That access code is not correct.");
      error.status = 401;
      error.code = "INVALID_ACCESS_CODE";
      throw error;
    }
    return { leagueCode: normalizedLeagueCode, role };
  }

  async function snapshot(suppliedLeagueCode, role) {
    const current = await repository.read(normalizeLeagueCode(suppliedLeagueCode));
    const result = snapshotFromDocument(current.document);
    return role === "board" ? publicSnapshot(result) : result;
  }

  async function command(suppliedLeagueCode, input, role) {
    const current = await repository.read(normalizeLeagueCode(suppliedLeagueCode));
    const next = applyCommand(current.document, input, { now: now(), actor: role === "admin" ? "Organizer" : "Auctioneer", role });
    if (next.revision === current.document.revision) return snapshotFromDocument(current.document);
    const committed = await repository.commit(next, current.etag);
    return snapshotFromDocument(committed.document);
  }

  return { createLeague, authenticate, snapshot, command, randomUUID };
}
