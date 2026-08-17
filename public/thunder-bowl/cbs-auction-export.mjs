import { EVENT_TYPES, POSITIONS, replayDraft, validateEvent } from "./state-engine.mjs?v=20260810e";

export const CBS_AUCTION_IMPORT_COLUMNS = Object.freeze([
  "player_name",
  "nfl_team",
  "position",
  "fantasy_team",
  "auction_price",
  "player_id",
]);

const APPROVED_POSITIONS = new Set(POSITIONS);
const REQUIRED_TEXT_FIELDS = Object.freeze([
  "player_name",
  "nfl_team",
  "position",
  "fantasy_team",
  "player_id",
]);

export class CbsAuctionExportError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "CbsAuctionExportError";
    this.issues = Object.freeze([...issues]);
  }
}

function rowLabel(row, index) {
  const identity = typeof row?.player_name === "string" && row.player_name.trim()
    ? row.player_name.trim()
    : "unknown player";
  return `row ${index + 2} (${identity})`;
}

function issue(label, message) {
  return `${label}: ${message}`;
}

export function validateCbsAuctionImportRows(rows) {
  if (!Array.isArray(rows)) {
    throw new CbsAuctionExportError("CBS Auction Import CSV requires an array of player rows.");
  }

  const issues = [];
  const playerIds = new Map();
  rows.forEach((row, index) => {
    const label = rowLabel(row, index);
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      issues.push(issue(label, "must be an object."));
      return;
    }

    const keys = Object.keys(row);
    const missingKeys = CBS_AUCTION_IMPORT_COLUMNS.filter((column) => !keys.includes(column));
    const extraKeys = keys.filter((key) => !CBS_AUCTION_IMPORT_COLUMNS.includes(key));
    if (missingKeys.length) issues.push(issue(label, `missing field(s): ${missingKeys.join(", ")}.`));
    if (extraKeys.length) issues.push(issue(label, `unsupported field(s): ${extraKeys.join(", ")}.`));

    for (const field of REQUIRED_TEXT_FIELDS) {
      if (typeof row[field] !== "string" || !row[field].trim()) {
        issues.push(issue(label, `${field} is blank or not text.`));
      }
    }

    if (typeof row.nfl_team === "string" && row.nfl_team.trim() && !/^(?:[A-Z]{2,3}|FA)$/.test(row.nfl_team)) {
      issues.push(issue(label, `nfl_team '${row.nfl_team}' is not a standard uppercase abbreviation or FA.`));
    }
    if (typeof row.position === "string" && row.position.trim() && !APPROVED_POSITIONS.has(row.position)) {
      issues.push(issue(label, `position '${row.position}' is not one of ${POSITIONS.join(", ")}.`));
    }
    if (!Number.isInteger(row.auction_price) || row.auction_price < 0) {
      issues.push(issue(label, "auction_price must be an integer greater than or equal to 0."));
    }

    if (typeof row.player_id === "string" && row.player_id.trim()) {
      const prior = playerIds.get(row.player_id);
      if (prior !== undefined) {
        issues.push(issue(label, `player_id '${row.player_id}' duplicates row ${prior + 2}.`));
      } else {
        playerIds.set(row.player_id, index);
      }
    }
  });

  if (issues.length) {
    throw new CbsAuctionExportError(
      `CBS Auction Import CSV validation failed: ${issues.join(" ")}`,
      issues,
    );
  }
  return rows;
}

export function buildCbsAuctionImportRows({ events, pack }) {
  if (!Array.isArray(events)) throw new CbsAuctionExportError("CBS Auction Import CSV requires the auction event ledger.");
  if (!pack || typeof pack !== "object" || !Array.isArray(pack.players)) {
    throw new CbsAuctionExportError("CBS Auction Import CSV requires the active validated draft pack.");
  }

  const state = replayDraft(events);
  const validatedEvents = events.map(validateEvent);
  const voidedEventIds = new Set(
    validatedEvents
      .filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED)
      .map((event) => event.payload.targetEventId),
  );
  const activeSales = validatedEvents.filter(
    (event) => event.type === EVENT_TYPES.PLAYER_SOLD && !voidedEventIds.has(event.id),
  );
  if (!activeSales.length) {
    throw new CbsAuctionExportError("No active auction purchases are available. Record at least one completed sale before exporting.");
  }

  const packPlayers = new Map();
  for (const player of pack.players) {
    if (!player?.id) continue;
    if (packPlayers.has(player.id)) {
      throw new CbsAuctionExportError(`The active draft pack reuses player_id '${player.id}'. CBS export was blocked.`);
    }
    packPlayers.set(player.id, player);
  }

  const identityIssues = [];
  const rows = activeSales.map((event, index) => {
    const payload = event.payload;
    const label = `sale ${index + 1} (${payload.playerName || payload.playerId || "unknown player"})`;
    const player = packPlayers.get(payload.playerId);
    const team = state.teams[payload.teamId];
    if (!player) {
      identityIssues.push(issue(label, `player_id '${payload.playerId}' is absent from the active draft pack.`));
    } else {
      if (player.name !== payload.playerName) identityIssues.push(issue(label, `player name '${payload.playerName}' does not match active-pack name '${player.name}'.`));
      if (player.position !== payload.position) identityIssues.push(issue(label, `position '${payload.position}' does not match active-pack position '${player.position}'.`));
      if ((player.nflTeam || "FA").toUpperCase() !== payload.nflTeam) identityIssues.push(issue(label, `NFL team '${payload.nflTeam}' does not match active-pack team '${player.nflTeam || "FA"}'.`));
    }
    if (!team) identityIssues.push(issue(label, `fantasy team '${payload.teamId}' is unknown.`));

    return {
      player_name: payload.playerName,
      nfl_team: payload.nflTeam || "FA",
      position: payload.position,
      fantasy_team: team?.name || "",
      auction_price: payload.amount,
      player_id: payload.playerId,
    };
  });

  if (identityIssues.length) {
    throw new CbsAuctionExportError(
      `CBS Auction Import CSV identity validation failed: ${identityIssues.join(" ")}`,
      identityIssues,
    );
  }
  if (rows.length !== state.saleCount) {
    throw new CbsAuctionExportError(`CBS Auction Import CSV expected ${state.saleCount} active sales but built ${rows.length} rows.`);
  }
  return validateCbsAuctionImportRows(rows);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function cbsAuctionImportCsv(rows) {
  validateCbsAuctionImportRows(rows);
  const body = rows.map((row) => CBS_AUCTION_IMPORT_COLUMNS.map((column) => csvCell(row[column])).join(","));
  return `${CBS_AUCTION_IMPORT_COLUMNS.join(",")}\r\n${body.join("\r\n")}\r\n`;
}
