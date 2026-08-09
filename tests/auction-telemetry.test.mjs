import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  EVENT_TYPES,
  createEvent,
} from "../public/thunder-bowl/state-engine.mjs";
import {
  auctionTelemetryCsv,
  attachSaleForecast,
  createAuctionTelemetryStore,
  latestPendingRunnerUp,
  markRunnerUpUnknown,
  reconcileAuctionTelemetryStore,
  recordRunnerUp,
  validateAuctionTelemetryStore,
} from "../public/thunder-bowl/auction-telemetry.mjs";

const DEVICE_ID = "telemetry-test-device";
const NOW = "2026-08-29T18:00:00.000Z";

function saleEvent(overrides = {}) {
  return createEvent(EVENT_TYPES.PLAYER_SOLD, {
    playerId: "player-one",
    playerName: "Player One",
    position: "RB",
    nflTeam: "DET",
    teamId: "dogs-of-war",
    amount: 18,
    nominatorTeamId: DEFAULT_CONFIG.nominationOrder[0],
    ...overrides,
  }, { deviceId: DEVICE_ID, createdAt: NOW });
}

test("runner-up telemetry is private metadata keyed to an audited active sale", () => {
  const sale = saleEvent();
  const events = [sale];
  const teamIds = DEFAULT_CONFIG.teams.map((team) => team.id);
  const store = reconcileAuctionTelemetryStore(createAuctionTelemetryStore(), { events, teamIds, now: NOW });
  assert.deepEqual(Object.keys(store.records), [sale.id]);
  assert.equal(store.records[sale.id].status, "pending");
  assert.equal(latestPendingRunnerUp(store, { events, teamIds }).saleEventId, sale.id);

  const recorded = recordRunnerUp(store, sale.id, "the-hobbits", { events, teamIds, now: "2026-08-29T18:00:05.000Z" });
  assert.equal(recorded.records[sale.id].runnerUpTeamId, "the-hobbits");
  assert.equal(recorded.records[sale.id].status, "recorded");
  assert.equal(latestPendingRunnerUp(recorded, { events, teamIds }), null);
});

test("the winner cannot be recorded as the runner-up and unknown remains editable", () => {
  const sale = saleEvent();
  const events = [sale];
  const teamIds = DEFAULT_CONFIG.teams.map((team) => team.id);
  const store = reconcileAuctionTelemetryStore(null, { events, teamIds, now: NOW });
  assert.throws(
    () => recordRunnerUp(store, sale.id, "dogs-of-war", { events, teamIds, now: NOW }),
    (error) => error.code === "WINNER_CANNOT_BE_RUNNER_UP",
  );
  const unknown = markRunnerUpUnknown(store, sale.id, { events, teamIds, now: NOW });
  assert.equal(unknown.records[sale.id].status, "unknown");
  const corrected = recordRunnerUp(unknown, sale.id, "big-head", { events, teamIds, now: NOW });
  assert.equal(corrected.records[sale.id].runnerUpTeamId, "big-head");
});

test("undoing a sale removes its private telemetry instead of leaking stale model evidence", () => {
  const sale = saleEvent();
  const undo = createEvent(EVENT_TYPES.EVENT_VOIDED, { targetEventId: sale.id, reason: "test correction" }, { deviceId: DEVICE_ID });
  const teamIds = DEFAULT_CONFIG.teams.map((team) => team.id);
  const populated = reconcileAuctionTelemetryStore(null, { events: [sale], teamIds, now: NOW });
  const reconciled = reconcileAuctionTelemetryStore(populated, { events: [sale, undo], teamIds, now: NOW });
  assert.deepEqual(reconciled.records, {});
});

test("telemetry validation is strict and the CSV is explicitly separate from the public ledger", () => {
  const sale = saleEvent();
  const events = [sale];
  const teams = DEFAULT_CONFIG.teams;
  const teamIds = teams.map((team) => team.id);
  const store = reconcileAuctionTelemetryStore(null, { events, teamIds, now: NOW });
  const forecasted = attachSaleForecast(store, sale.id, {
    modelVersion: "test-model-v1",
    naturalSale: { point: 16, range80: { low: 10, high: 23 } },
    rationalBaseline: 15,
    dogsParticipation: { bidLimit: 20 },
  }, { events, teamIds, now: NOW });
  assert.equal(forecasted.records[sale.id].forecast.naturalPoint, 16);
  const invalid = structuredClone(store);
  invalid.records[sale.id].secretNarrative = "tilt";
  assert.throws(
    () => validateAuctionTelemetryStore(invalid, { events, teamIds }),
    (error) => error.code === "UNKNOWN_AUCTION_TELEMETRY_FIELD",
  );
  const csv = auctionTelemetryCsv(forecasted, { events, teams });
  assert.match(csv, /runner_up_status/);
  assert.match(csv, /forecast_error/);
  assert.match(csv, /,2,/);
  assert.match(csv, /pending/);
  assert.doesNotMatch(csv, /secretNarrative/);
});
