import { EVENT_TYPES, validateEvent } from "./state-engine.mjs?v=20260810d";

export const AUCTION_TELEMETRY_SCHEMA_VERSION = 1;
export const AUCTION_TELEMETRY_META_KEY = "privateAuctionTelemetryV1";
export const RUNNER_UP_PROMPT_MS = 30_000;

const RECORD_STATUSES = new Set(["pending", "recorded", "unknown"]);
const RECORD_KEYS = new Set([
  "saleEventId",
  "playerId",
  "playerName",
  "position",
  "winnerTeamId",
  "salePrice",
  "runnerUpTeamId",
  "status",
  "forecast",
  "promptedAt",
  "updatedAt",
]);
const FORECAST_KEYS = new Set([
  "modelVersion",
  "naturalPoint",
  "naturalLow",
  "naturalHigh",
  "rationalBaseline",
  "dogsBidLimit",
  "generatedAt",
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function exactKeys(input, allowed, label) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail("UNKNOWN_AUCTION_TELEMETRY_FIELD", `${label} contains unknown field '${key}'.`);
  }
}

function iso(value, label) {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    fail("INVALID_AUCTION_TELEMETRY_TIME", `${label} must be an ISO date-time.`);
  }
  return new Date(value).toISOString();
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) fail("INVALID_AUCTION_TELEMETRY_TEXT", `${label} is required.`);
  return value.trim();
}

function saleEvents(rawEvents = []) {
  if (!Array.isArray(rawEvents)) fail("INVALID_AUCTION_TELEMETRY_EVENTS", "Auction telemetry requires an event array.");
  const events = rawEvents.map(validateEvent);
  const voided = new Set(events.filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED).map((event) => event.payload.targetEventId));
  return events.filter((event) => event.type === EVENT_TYPES.PLAYER_SOLD && !voided.has(event.id));
}

export function createAuctionTelemetryStore() {
  return { schemaVersion: AUCTION_TELEMETRY_SCHEMA_VERSION, records: {} };
}

export function createSaleTelemetryRecord(saleEvent, { now = new Date().toISOString() } = {}) {
  const event = validateEvent(saleEvent);
  if (event.type !== EVENT_TYPES.PLAYER_SOLD) fail("TELEMETRY_REQUIRES_SALE", "Runner-up telemetry can be attached only to a player sale.");
  const timestamp = iso(now, "Telemetry timestamp");
  return {
    saleEventId: event.id,
    playerId: event.payload.playerId,
    playerName: event.payload.playerName,
    position: event.payload.position,
    winnerTeamId: event.payload.teamId,
    salePrice: event.payload.amount,
    runnerUpTeamId: null,
    status: "pending",
    forecast: null,
    promptedAt: timestamp,
    updatedAt: timestamp,
  };
}

function validateForecast(input) {
  if (input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_AUCTION_TELEMETRY_FORECAST", "Sale forecast must be an object or null.");
  exactKeys(input, FORECAST_KEYS, "Sale forecast");
  const whole = (value, label, allowZero = false) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) fail("INVALID_AUCTION_TELEMETRY_FORECAST", `${label} must be a whole dollar.`);
    return number;
  };
  const forecast = {
    modelVersion: text(input.modelVersion, "Forecast model version"),
    naturalPoint: whole(input.naturalPoint, "Natural forecast"),
    naturalLow: whole(input.naturalLow, "Natural low"),
    naturalHigh: whole(input.naturalHigh, "Natural high"),
    rationalBaseline: whole(input.rationalBaseline, "Rational baseline"),
    dogsBidLimit: whole(input.dogsBidLimit, "Dogs bid limit", true),
    generatedAt: iso(input.generatedAt, "Forecast generated time"),
  };
  if (forecast.naturalLow > forecast.naturalPoint || forecast.naturalHigh < forecast.naturalPoint) {
    fail("INVALID_AUCTION_TELEMETRY_FORECAST", "Forecast point must be inside its stated range.");
  }
  return forecast;
}

function validateRecord(input, { saleById, teamIds }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_AUCTION_TELEMETRY_RECORD", "Auction telemetry records must be objects.");
  exactKeys(input, RECORD_KEYS, "Auction telemetry record");
  const saleEventId = text(input.saleEventId, "Sale event id");
  const sale = saleById.get(saleEventId);
  if (!sale) fail("UNKNOWN_AUCTION_TELEMETRY_SALE", `Telemetry references inactive or unknown sale '${saleEventId}'.`);
  const expected = sale.payload;
  const playerId = text(input.playerId, "Player id");
  const playerName = text(input.playerName, "Player name");
  const position = text(input.position, "Position");
  const winnerTeamId = text(input.winnerTeamId, "Winning team id");
  const salePrice = Number(input.salePrice);
  if (playerId !== expected.playerId || playerName !== expected.playerName || position !== expected.position
    || winnerTeamId !== expected.teamId || salePrice !== expected.amount) {
    fail("AUCTION_TELEMETRY_SALE_MISMATCH", `Telemetry for ${expected.playerName} does not match the audited sale.`);
  }
  if (!Number.isSafeInteger(salePrice) || salePrice < 1) fail("INVALID_AUCTION_TELEMETRY_PRICE", "Sale price must be a positive whole dollar.");
  if (!RECORD_STATUSES.has(input.status)) fail("INVALID_AUCTION_TELEMETRY_STATUS", "Telemetry status is invalid.");
  const runnerUpTeamId = input.runnerUpTeamId === null ? null : text(input.runnerUpTeamId, "Runner-up team id");
  if (runnerUpTeamId && !teamIds.has(runnerUpTeamId)) fail("UNKNOWN_RUNNER_UP_TEAM", `Runner-up team '${runnerUpTeamId}' is not in this league.`);
  if (runnerUpTeamId === winnerTeamId) fail("WINNER_CANNOT_BE_RUNNER_UP", "The winning team cannot also be the runner-up.");
  if (input.status === "recorded" && !runnerUpTeamId) fail("RECORDED_RUNNER_UP_REQUIRED", "Recorded telemetry requires a runner-up team.");
  if (input.status !== "recorded" && runnerUpTeamId) fail("UNRECORDED_RUNNER_UP", "A runner-up team may be stored only with recorded status.");
  return {
    saleEventId,
    playerId,
    playerName,
    position,
    winnerTeamId,
    salePrice,
    runnerUpTeamId,
    status: input.status,
    forecast: validateForecast(input.forecast ?? null),
    promptedAt: iso(input.promptedAt, "Prompted time"),
    updatedAt: iso(input.updatedAt, "Updated time"),
  };
}

export function attachSaleForecast(input, saleEventId, forecast, { events = [], teamIds = [], now = new Date().toISOString() } = {}) {
  const store = reconcileAuctionTelemetryStore(input, { events, teamIds, now });
  const record = store.records[saleEventId];
  if (!record) fail("UNKNOWN_AUCTION_TELEMETRY_SALE", `Sale '${saleEventId}' is not active.`);
  store.records[saleEventId] = {
    ...record,
    forecast: validateForecast({
      modelVersion: forecast.modelVersion,
      naturalPoint: forecast.naturalSale.point,
      naturalLow: forecast.naturalSale.range80.low,
      naturalHigh: forecast.naturalSale.range80.high,
      rationalBaseline: forecast.rationalBaseline,
      dogsBidLimit: forecast.dogsParticipation.bidLimit,
      generatedAt: now,
    }),
    updatedAt: iso(now, "Updated time"),
  };
  return validateAuctionTelemetryStore(store, { events, teamIds });
}

export function validateAuctionTelemetryStore(input, { events = [], teamIds = [] } = {}) {
  if (input === null || input === undefined) return createAuctionTelemetryStore();
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_AUCTION_TELEMETRY_STORE", "Auction telemetry must be an object.");
  exactKeys(input, new Set(["schemaVersion", "records"]), "Auction telemetry");
  if (input.schemaVersion !== AUCTION_TELEMETRY_SCHEMA_VERSION) fail("UNSUPPORTED_AUCTION_TELEMETRY_SCHEMA", "Auction telemetry schema is not supported.");
  if (!input.records || typeof input.records !== "object" || Array.isArray(input.records)) fail("INVALID_AUCTION_TELEMETRY_RECORDS", "Auction telemetry records must be keyed by sale id.");
  const saleById = new Map(saleEvents(events).map((event) => [event.id, event]));
  const knownTeamIds = new Set(teamIds);
  const records = {};
  for (const [saleEventId, record] of Object.entries(input.records)) {
    if (saleEventId !== record?.saleEventId) fail("AUCTION_TELEMETRY_KEY_MISMATCH", "Telemetry record key must match its sale event id.");
    records[saleEventId] = validateRecord(record, { saleById, teamIds: knownTeamIds });
  }
  return { schemaVersion: AUCTION_TELEMETRY_SCHEMA_VERSION, records };
}

export function reconcileAuctionTelemetryStore(input, { events = [], teamIds = [], now = new Date().toISOString() } = {}) {
  const activeSales = saleEvents(events);
  const activeIds = new Set(activeSales.map((sale) => sale.id));
  const candidate = input?.schemaVersion === AUCTION_TELEMETRY_SCHEMA_VERSION && input?.records && typeof input.records === "object"
    ? input
    : createAuctionTelemetryStore();
  const records = {};
  for (const [saleEventId, record] of Object.entries(candidate.records)) {
    if (!activeIds.has(saleEventId)) continue;
    try {
      records[saleEventId] = validateRecord(record, {
        saleById: new Map(activeSales.map((sale) => [sale.id, sale])),
        teamIds: new Set(teamIds),
      });
    } catch {
      // Fail closed at the record boundary: malformed private metadata never affects the ledger or model.
    }
  }
  for (const sale of activeSales) {
    if (!records[sale.id]) records[sale.id] = createSaleTelemetryRecord(sale, { now });
  }
  return { schemaVersion: AUCTION_TELEMETRY_SCHEMA_VERSION, records };
}

export function recordRunnerUp(input, saleEventId, runnerUpTeamId, { events = [], teamIds = [], now = new Date().toISOString() } = {}) {
  const store = reconcileAuctionTelemetryStore(input, { events, teamIds, now });
  const record = store.records[saleEventId];
  if (!record) fail("UNKNOWN_AUCTION_TELEMETRY_SALE", `Sale '${saleEventId}' is not active.`);
  if (runnerUpTeamId === record.winnerTeamId) fail("WINNER_CANNOT_BE_RUNNER_UP", "The winning team cannot also be the runner-up.");
  if (!teamIds.includes(runnerUpTeamId)) fail("UNKNOWN_RUNNER_UP_TEAM", `Runner-up team '${runnerUpTeamId}' is not in this league.`);
  store.records[saleEventId] = {
    ...record,
    runnerUpTeamId,
    status: "recorded",
    updatedAt: iso(now, "Updated time"),
  };
  return validateAuctionTelemetryStore(store, { events, teamIds });
}

export function markRunnerUpUnknown(input, saleEventId, { events = [], teamIds = [], now = new Date().toISOString() } = {}) {
  const store = reconcileAuctionTelemetryStore(input, { events, teamIds, now });
  const record = store.records[saleEventId];
  if (!record) fail("UNKNOWN_AUCTION_TELEMETRY_SALE", `Sale '${saleEventId}' is not active.`);
  store.records[saleEventId] = {
    ...record,
    runnerUpTeamId: null,
    status: "unknown",
    updatedAt: iso(now, "Updated time"),
  };
  return validateAuctionTelemetryStore(store, { events, teamIds });
}

export function latestPendingRunnerUp(input, { events = [], teamIds = [], afterEventIds = [] } = {}) {
  const store = reconcileAuctionTelemetryStore(input, { events, teamIds });
  const eligible = new Set(afterEventIds);
  const sales = saleEvents(events);
  for (let index = sales.length - 1; index >= 0; index -= 1) {
    const sale = sales[index];
    if (eligible.size && !eligible.has(sale.id)) continue;
    if (store.records[sale.id]?.status === "pending") return store.records[sale.id];
  }
  return null;
}

function csvCell(value) {
  const string = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export function auctionTelemetryCsv(input, { events = [], teams = [] } = {}) {
  const teamIds = teams.map((team) => team.id);
  const store = validateAuctionTelemetryStore(input, { events, teamIds });
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const header = ["sale_event_id", "player_id", "player", "position", "winner", "sale_price", "forecast_point", "forecast_low", "forecast_high", "forecast_error", "runner_up", "runner_up_status", "prompted_at", "updated_at"];
  const rows = Object.values(store.records)
    .sort((left, right) => Date.parse(left.promptedAt) - Date.parse(right.promptedAt))
    .map((record) => [
      record.saleEventId,
      record.playerId,
      record.playerName,
      record.position,
      teamNames.get(record.winnerTeamId) || record.winnerTeamId,
      record.salePrice,
      record.forecast?.naturalPoint ?? "",
      record.forecast?.naturalLow ?? "",
      record.forecast?.naturalHigh ?? "",
      record.forecast ? record.salePrice - record.forecast.naturalPoint : "",
      record.runnerUpTeamId ? teamNames.get(record.runnerUpTeamId) || record.runnerUpTeamId : "",
      record.status,
      record.promptedAt,
      record.updatedAt,
    ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
