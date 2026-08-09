export const SCHEMA_VERSION = 1;
export const SEASON = 2026;
export const SUPPORTED_SEASONS = Object.freeze([2025, 2026]);
export const MINIMUM_BID = 1;
export const ROSTER_SIZE = 14;
export const POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "K", "DST"]);
export const STARTER_REQUIREMENTS = Object.freeze({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 });
export const MINIMUM_ROSTER_SIZE = Object.values(STARTER_REQUIREMENTS).reduce((sum, count) => sum + count, 0);

export const EVENT_TYPES = Object.freeze({
  DRAFT_CONFIGURED: "DRAFT_CONFIGURED",
  CAP_TRANSFERRED: "CAP_TRANSFERRED",
  KEEPER_RIGHTS_TRADED: "KEEPER_RIGHTS_TRADED",
  KEEPER_ASSIGNED: "KEEPER_ASSIGNED",
  KEEPER_PASSED: "KEEPER_PASSED",
  PLAYER_SOLD: "PLAYER_SOLD",
  NOMINATION_SKIPPED: "NOMINATION_SKIPPED",
  EVENT_VOIDED: "EVENT_VOIDED",
});

const TEAM_SEED = [
  ["goon-skwad", "Goon Skwad", 106, "confirmed"],
  ["dogs-of-war", "Dogs of War", 104, "confirmed"],
  ["el-guapo", "El Guapo", 102, "confirmed"],
  ["angry-face", "Angry Face", 100, "default"],
  ["big-head", "Big Head", 100, "default"],
  ["crime-and-punishment", "Crime and Punishment", 100, "default"],
  ["orange-crush", "Orange Crush", 100, "default"],
  ["super-suckers", "Super Suckers", 100, "default"],
  ["t-dogs", "T-Dogs", 100, "default"],
  ["the-bungles", "The Bungles", 100, "default"],
  ["the-hobbits", "The Hobbits", 100, "default"],
  ["three-amigos", "Three Amigos", 100, "default"],
];

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  season: SEASON,
  rulesVersion: "thunder-bowl-2026-v1",
  rosterSize: ROSTER_SIZE,
  minimumBid: MINIMUM_BID,
  starterRequirements: STARTER_REQUIREMENTS,
  teams: TEAM_SEED.map(([id, name, startingCap, capStatus]) => ({ id, name, startingCap, capStatus })),
  nominationOrder: [
    "orange-crush",
    "the-hobbits",
    "crime-and-punishment",
    "t-dogs",
    "super-suckers",
    "angry-face",
    "goon-skwad",
    "dogs-of-war",
    "el-guapo",
    "the-bungles",
    "big-head",
    "three-amigos",
  ],
  nominationOrderStatus: "verified",
  verifiedPrefixCount: 12,
});

const EVENT_KEYS = ["id", "type", "createdAt", "deviceId", "payload"];
const OPTIONAL_EVENT_KEYS = ["serverReceivedAt"];

export class RuleViolation extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RuleViolation";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new RuleViolation(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) fail("INVALID_OBJECT", `${label} must be a plain object.`);
}

function assertExactKeys(value, required, optional = [], label = "object") {
  assertPlainObject(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("UNKNOWN_FIELD", `${label} contains unsupported field '${key}'.`);
  }
  for (const key of required) {
    if (!(key in value)) fail("MISSING_FIELD", `${label} is missing '${key}'.`);
  }
}

function assertString(value, label, minimum = 1, maximum = 120) {
  if (typeof value !== "string") fail("INVALID_STRING", `${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) {
    fail("INVALID_STRING_LENGTH", `${label} must contain ${minimum}-${maximum} characters.`);
  }
  return trimmed;
}

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("INVALID_INTEGER", `${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function assertTimestamp(value, label) {
  assertString(value, label, 20, 40);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail("INVALID_TIMESTAMP", `${label} is not a valid timestamp.`);
  return new Date(timestamp).toISOString();
}

function assertIdentifier(value, label) {
  const id = assertString(value, label, 6, 120);
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    fail("INVALID_IDENTIFIER", `${label} contains unsupported characters.`);
  }
  return id;
}

function assertPosition(value, label = "position") {
  const position = assertString(value, label, 1, 3).toUpperCase();
  if (!POSITIONS.includes(position)) fail("INVALID_POSITION", `${label} must be QB, RB, WR, TE, K, or DST.`);
  return position;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameJSON(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function emptyPositionCounts() {
  return Object.fromEntries(POSITIONS.map((position) => [position, 0]));
}

export function validateLeagueConfig(input) {
  assertExactKeys(
    input,
    [
      "schemaVersion",
      "season",
      "rulesVersion",
      "rosterSize",
      "minimumBid",
      "starterRequirements",
      "teams",
      "nominationOrder",
      "nominationOrderStatus",
      "verifiedPrefixCount",
    ],
    [],
    "league configuration",
  );

  if (input.schemaVersion !== SCHEMA_VERSION) fail("SCHEMA_MISMATCH", "Unsupported league configuration schema.");
  if (!SUPPORTED_SEASONS.includes(input.season)) fail("SEASON_MISMATCH", "This build accepts only the isolated 2025 replay or the 2026 league configuration.");
  assertString(input.rulesVersion, "rulesVersion", 3, 80);
  if (input.rosterSize !== ROSTER_SIZE) fail("ROSTER_SIZE_MISMATCH", "Thunder Bowl rosters must contain 14 players.");
  if (input.minimumBid !== MINIMUM_BID) fail("MINIMUM_BID_MISMATCH", "Thunder Bowl uses a $1 minimum bid.");

  assertExactKeys(input.starterRequirements, POSITIONS, [], "starter requirements");
  for (const position of POSITIONS) {
    const expected = STARTER_REQUIREMENTS[position];
    if (input.starterRequirements[position] !== expected) {
      fail("STARTER_RULE_MISMATCH", `${position} starter requirement must be ${expected}.`);
    }
  }

  if (!Array.isArray(input.teams) || input.teams.length !== 12) {
    fail("TEAM_COUNT_MISMATCH", "League configuration must contain exactly 12 teams.");
  }
  const teamIds = new Set();
  const teamNames = new Set();
  const teams = input.teams.map((team, index) => {
    assertExactKeys(team, ["id", "name", "startingCap", "capStatus"], [], `team ${index + 1}`);
    const id = assertIdentifier(team.id, `team ${index + 1} id`);
    const name = assertString(team.name, `team ${index + 1} name`, 2, 60);
    const nameKey = name.toLowerCase();
    if (teamIds.has(id)) fail("DUPLICATE_TEAM_ID", `Team id '${id}' appears more than once.`);
    if (teamNames.has(nameKey)) fail("DUPLICATE_TEAM_NAME", `Team name '${name}' appears more than once.`);
    teamIds.add(id);
    teamNames.add(nameKey);
    const startingCap = assertInteger(team.startingCap, `${name} starting cap`, ROSTER_SIZE, 300);
    const capStatus = assertString(team.capStatus, `${name} cap status`, 3, 30);
    return { id, name, startingCap, capStatus };
  });

  if (!Array.isArray(input.nominationOrder) || input.nominationOrder.length !== 12) {
    fail("NOMINATION_ORDER_MISMATCH", "Nomination order must list all 12 teams exactly once.");
  }
  const orderIds = input.nominationOrder.map((id, index) => assertIdentifier(id, `nomination order ${index + 1}`));
  if (new Set(orderIds).size !== 12 || orderIds.some((id) => !teamIds.has(id))) {
    fail("INVALID_NOMINATION_ORDER", "Nomination order must contain each configured team exactly once.");
  }
  const nominationOrderStatus = assertString(input.nominationOrderStatus, "nomination order status", 3, 40);
  const verifiedPrefixCount = assertInteger(input.verifiedPrefixCount, "verified prefix count", 0, 12);

  return {
    schemaVersion: SCHEMA_VERSION,
    season: input.season,
    rulesVersion: input.rulesVersion,
    rosterSize: ROSTER_SIZE,
    minimumBid: MINIMUM_BID,
    starterRequirements: clone(STARTER_REQUIREMENTS),
    teams,
    nominationOrder: orderIds,
    nominationOrderStatus,
    verifiedPrefixCount,
  };
}

export function nominationOrderEvidence(config, index) {
  if (!Number.isInteger(index) || index < 0 || index >= 12) return "unverified";
  if (config?.nominationOrderStatus === "verified" && config?.verifiedPrefixCount === 12) return "verified";
  const verifiedPrefixCount = Number.isInteger(config?.verifiedPrefixCount) ? config.verifiedPrefixCount : 0;
  if (index < verifiedPrefixCount) return "verified";
  if (config?.nominationOrderStatus === "verified-prefix-only" && index === verifiedPrefixCount) return "provisional";
  return "unverified";
}

export function canReplaceUnstartedConfiguration(rawEvents = []) {
  if (!Array.isArray(rawEvents)) return false;
  try {
    replayDraft(rawEvents);
  } catch {
    return false;
  }
  const events = rawEvents.map(validateEvent);
  const voided = new Set(events.filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED).map((event) => event.payload.targetEventId));
  return events.every((event) => event.type === EVENT_TYPES.DRAFT_CONFIGURED || event.type === EVENT_TYPES.EVENT_VOIDED || voided.has(event.id));
}

function validatePlayerPayload(payload, label, amountField) {
  const required = ["playerId", "playerName", "position", "nflTeam", "teamId", amountField];
  const optional = amountField === "amount" ? ["nominatorTeamId", "openingBid"] : ["keeperYear", "source", "selectionRound"];
  assertExactKeys(payload, required, optional, label);
  const normalized = {
    playerId: assertIdentifier(payload.playerId, `${label} player id`),
    playerName: assertString(payload.playerName, `${label} player name`, 2, 80),
    position: assertPosition(payload.position, `${label} position`),
    nflTeam: assertString(payload.nflTeam || "FA", `${label} NFL team`, 2, 10).toUpperCase(),
    teamId: assertIdentifier(payload.teamId, `${label} fantasy team`),
    [amountField]: assertInteger(payload[amountField], `${label} ${amountField}`, 1, 300),
  };
  if (amountField === "amount") {
    normalized.nominatorTeamId = assertIdentifier(payload.nominatorTeamId, `${label} nominator`);
    if (payload.openingBid !== undefined) {
      normalized.openingBid = assertInteger(payload.openingBid, `${label} opening bid`, 1, normalized.amount);
    }
  } else {
    normalized.keeperYear = assertInteger(payload.keeperYear, `${label} keeper year`, 1, 3);
    normalized.source = assertString(payload.source, `${label} source`, 3, 80);
    if (payload.selectionRound !== undefined) {
      normalized.selectionRound = assertInteger(payload.selectionRound, `${label} selection round`, 1, 2);
    }
  }
  return normalized;
}

function validateRightsTradePlayers(input, label) {
  if (!Array.isArray(input) || input.length > ROSTER_SIZE) fail("INVALID_RIGHTS_TRADE_PLAYERS", `${label} must contain 0-${ROSTER_SIZE} players.`);
  const ids = new Set();
  return input.map((player, index) => {
    const rowLabel = `${label} player ${index + 1}`;
    assertExactKeys(player, ["playerId", "playerName"], [], rowLabel);
    const row = {
      playerId: assertIdentifier(player.playerId, `${rowLabel} id`),
      playerName: assertString(player.playerName, `${rowLabel} name`, 2, 80),
    };
    if (ids.has(row.playerId)) fail("DUPLICATE_RIGHTS_TRADE_PLAYER", `${row.playerName} appears more than once in the same trade side.`);
    ids.add(row.playerId);
    return row;
  });
}

export function validateEvent(input) {
  assertExactKeys(input, EVENT_KEYS, OPTIONAL_EVENT_KEYS, "auction event");
  const event = {
    id: assertIdentifier(input.id, "event id"),
    type: assertString(input.type, "event type", 3, 40),
    createdAt: assertTimestamp(input.createdAt, "event createdAt"),
    deviceId: assertIdentifier(input.deviceId, "event deviceId"),
    payload: null,
  };
  if (input.serverReceivedAt !== undefined) event.serverReceivedAt = assertTimestamp(input.serverReceivedAt, "serverReceivedAt");

  switch (event.type) {
    case EVENT_TYPES.DRAFT_CONFIGURED:
      event.payload = validateLeagueConfig(input.payload);
      break;
    case EVENT_TYPES.CAP_TRANSFERRED:
      assertExactKeys(input.payload, ["fromTeamId", "toTeamId", "amount", "reason"], [], "cap transfer");
      event.payload = {
        fromTeamId: assertIdentifier(input.payload.fromTeamId, "cap transfer source team"),
        toTeamId: assertIdentifier(input.payload.toTeamId, "cap transfer destination team"),
        amount: assertInteger(input.payload.amount, "cap transfer amount", 1, 200),
        reason: assertString(input.payload.reason, "cap transfer reason", 3, 120),
      };
      if (event.payload.fromTeamId === event.payload.toTeamId) {
        fail("SELF_TRANSFER", "A cap transfer requires two different teams.");
      }
      break;
    case EVENT_TYPES.KEEPER_RIGHTS_TRADED:
      assertExactKeys(input.payload, ["teamAId", "teamBId", "amountFromAToB", "teamASends", "teamBSends"], [], "keeper-rights trade");
      event.payload = {
        teamAId: assertIdentifier(input.payload.teamAId, "keeper-rights trade Team A"),
        teamBId: assertIdentifier(input.payload.teamBId, "keeper-rights trade Team B"),
        amountFromAToB: assertInteger(input.payload.amountFromAToB, "keeper-rights trade cap amount", 0, 200),
        teamASends: validateRightsTradePlayers(input.payload.teamASends, "Team A sends"),
        teamBSends: validateRightsTradePlayers(input.payload.teamBSends, "Team B sends"),
      };
      if (event.payload.teamAId === event.payload.teamBId) {
        fail("SELF_TRANSFER", "A keeper-rights trade requires two different teams.");
      }
      if (!event.payload.teamASends.length && !event.payload.teamBSends.length) fail("EMPTY_RIGHTS_TRADE", "A keeper-rights trade must move at least one player.");
      const bothSides = [...event.payload.teamASends, ...event.payload.teamBSends].map((player) => player.playerId);
      if (new Set(bothSides).size !== bothSides.length) fail("DUPLICATE_RIGHTS_TRADE_PLAYER", "A player cannot move in both directions in one trade.");
      break;
    case EVENT_TYPES.KEEPER_ASSIGNED:
      event.payload = validatePlayerPayload(input.payload, "keeper", "salary");
      break;
    case EVENT_TYPES.KEEPER_PASSED:
      assertExactKeys(input.payload, ["teamId", "round", "reason"], [], "keeper pass");
      event.payload = {
        teamId: assertIdentifier(input.payload.teamId, "keeper pass team"),
        round: assertInteger(input.payload.round, "keeper pass round", 1, 2),
        reason: assertString(input.payload.reason, "keeper pass reason", 3, 120),
      };
      break;
    case EVENT_TYPES.PLAYER_SOLD:
      event.payload = validatePlayerPayload(input.payload, "sale", "amount");
      break;
    case EVENT_TYPES.NOMINATION_SKIPPED:
      assertExactKeys(input.payload, ["teamId", "reason"], [], "nomination skip");
      event.payload = {
        teamId: assertIdentifier(input.payload.teamId, "skipped team"),
        reason: assertString(input.payload.reason, "skip reason", 3, 120),
      };
      break;
    case EVENT_TYPES.EVENT_VOIDED:
      assertExactKeys(input.payload, ["targetEventId", "reason"], [], "void event");
      event.payload = {
        targetEventId: assertIdentifier(input.payload.targetEventId, "void target"),
        reason: assertString(input.payload.reason, "void reason", 3, 120),
      };
      break;
    default:
      fail("UNKNOWN_EVENT_TYPE", `Unsupported auction event type '${event.type}'.`);
  }
  return event;
}

export function createEvent(type, payload, options = {}) {
  const createdAt = options.createdAt || new Date().toISOString();
  const deviceId = options.deviceId || "device-local";
  const id = options.id || globalThis.crypto?.randomUUID?.() || `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return validateEvent({ id, type, createdAt, deviceId, payload });
}

function buildKeeperSelectionTimeline(operationalEvents, config) {
  const slots = [1, 2].flatMap((round) => config.nominationOrder.map((teamId, index) => ({
    selectionNumber: (round - 1) * config.nominationOrder.length + index + 1,
    round,
    pick: index + 1,
    teamId,
    status: "open",
    eventId: null,
    playerId: null,
    playerName: null,
    position: null,
    nflTeam: null,
    salary: null,
    legacyAssignment: false,
  })));
  const slotByKey = new Map(slots.map((slot) => [`${slot.teamId}:${slot.round}`, slot]));
  const firstOpenSlot = () => slots.find((slot) => slot.status === "open") || null;

  for (const event of operationalEvents) {
    if (event.type === EVENT_TYPES.KEEPER_ASSIGNED) {
      const explicitRound = event.payload.selectionRound;
      const slot = explicitRound === undefined
        ? slots.find((candidate) => candidate.teamId === event.payload.teamId && candidate.status === "open")
        : slotByKey.get(`${event.payload.teamId}:${explicitRound}`);
      if (!slot || slot.status !== "open") {
        fail("KEEPER_SELECTION_SLOT_FILLED", `${event.payload.teamId} has no open keeper-selection slot.`);
      }
      if (explicitRound !== undefined && firstOpenSlot()?.selectionNumber !== slot.selectionNumber) {
        fail("WRONG_KEEPER_TURN", "Keeper assignment does not match the current 1-12 / 1-12 selection turn.", {
          expected: firstOpenSlot(),
          received: { teamId: event.payload.teamId, round: explicitRound },
        });
      }
      Object.assign(slot, {
        status: "kept",
        eventId: event.id,
        playerId: event.payload.playerId,
        playerName: event.payload.playerName,
        position: event.payload.position,
        nflTeam: event.payload.nflTeam,
        salary: event.payload.salary,
        legacyAssignment: explicitRound === undefined,
      });
      continue;
    }

    if (event.type === EVENT_TYPES.KEEPER_PASSED) {
      const slot = slotByKey.get(`${event.payload.teamId}:${event.payload.round}`);
      if (!slot || slot.status !== "open") {
        fail("KEEPER_SELECTION_SLOT_FILLED", `${event.payload.teamId}'s Round ${event.payload.round} keeper turn is already complete.`);
      }
      if (firstOpenSlot()?.selectionNumber !== slot.selectionNumber) {
        fail("WRONG_KEEPER_TURN", "Keeper pass does not match the current 1-12 / 1-12 selection turn.", {
          expected: firstOpenSlot(),
          received: { teamId: event.payload.teamId, round: event.payload.round },
        });
      }
      Object.assign(slot, { status: "passed", eventId: event.id });
    }
  }

  const completedCount = slots.filter((slot) => slot.status !== "open").length;
  return {
    order: [...config.nominationOrder],
    slots,
    completedCount,
    totalSlots: slots.length,
    nextSlot: firstOpenSlot(),
    complete: completedCount === slots.length,
  };
}

export function keeperSelectionTimeline(rawEvents = [], rawConfig = DEFAULT_CONFIG) {
  if (!Array.isArray(rawEvents)) fail("EVENTS_NOT_ARRAY", "Keeper selection events must be supplied as an array.");
  const events = rawEvents.map(validateEvent);
  const config = validateLeagueConfig(rawConfig);
  const byId = new Map(events.map((event, index) => [event.id, { event, index }]));
  const voided = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type !== EVENT_TYPES.EVENT_VOIDED) continue;
    const target = byId.get(event.payload.targetEventId);
    if (!target || target.index >= index) fail("INVALID_VOID_TARGET", "Undo can target only an earlier event.");
    if (target.event.type === EVENT_TYPES.EVENT_VOIDED) fail("VOID_OF_VOID", "An undo event cannot itself be undone.");
    if (voided.has(target.event.id)) fail("ALREADY_VOIDED", "That event has already been undone.");
    voided.add(target.event.id);
  }
  return buildKeeperSelectionTimeline(
    events.filter((event) => event.type !== EVENT_TYPES.EVENT_VOIDED && !voided.has(event.id)),
    config,
  );
}

export function snakeTeamId(order, nominationStep) {
  if (!Array.isArray(order) || order.length === 0) return null;
  const step = Math.max(0, Math.trunc(nominationStep));
  const leg = Math.floor(step / order.length);
  const offset = step % order.length;
  return leg % 2 === 0 ? order[offset] : order[order.length - 1 - offset];
}

function starterSlotsMissing(team, starterRequirements) {
  return POSITIONS.reduce(
    (total, position) => total + Math.max(0, starterRequirements[position] - team.positionCounts[position]),
    0,
  );
}

export function requiredRosterAdditions(team, config = DEFAULT_CONFIG, candidatePosition = null) {
  const counts = { ...team.positionCounts };
  const rosterCount = team.roster.length + (candidatePosition ? 1 : 0);
  if (candidatePosition) counts[candidatePosition] = (counts[candidatePosition] || 0) + 1;
  const minimumPlayersNeeded = Math.max(0, MINIMUM_ROSTER_SIZE - rosterCount);
  const missingStarters = POSITIONS.reduce(
    (total, position) => total + Math.max(0, config.starterRequirements[position] - counts[position]),
    0,
  );
  return Math.max(minimumPlayersNeeded, missingStarters);
}

export function legalMaximumBid(team, config = DEFAULT_CONFIG, candidatePosition = null) {
  const openSlots = config.rosterSize - team.roster.length;
  if (openSlots <= 0) return 0;
  let reserveAfterPurchase;
  if (candidatePosition) {
    reserveAfterPurchase = requiredRosterAdditions(team, config, candidatePosition);
  } else {
    const minimumPlayersAfter = Math.max(0, MINIMUM_ROSTER_SIZE - team.roster.length - 1);
    const missingAfterBestPurchase = Math.max(0, starterSlotsMissing(team, config.starterRequirements) - 1);
    reserveAfterPurchase = Math.max(minimumPlayersAfter, missingAfterBestPurchase);
  }
  return Math.max(0, team.cash - config.minimumBid * reserveAfterPurchase);
}

export function calculateLiveMarketState({ remainingRoomDollars, remainingOpenSlots, remainingMarketValues }, damping = 0.65) {
  if (!Number.isFinite(remainingRoomDollars) || remainingRoomDollars < 0) fail("INVALID_MARKET_CASH", "Remaining room dollars must be non-negative.");
  if (!Number.isSafeInteger(remainingOpenSlots) || remainingOpenSlots < 0) fail("INVALID_MARKET_SLOTS", "Remaining open slots must be a non-negative integer.");
  if (remainingRoomDollars < remainingOpenSlots) fail("INVALID_MARKET_RESERVE", "Room cash cannot fall below the $1-per-slot reserve.");
  if (!Array.isArray(remainingMarketValues) || remainingMarketValues.length < remainingOpenSlots) fail("INVALID_MARKET_POOL", "The remaining market pool cannot be smaller than the open-slot count.");
  if (!Number.isFinite(damping) || damping < 0 || damping > 1) fail("INVALID_MARKET_DAMPING", "Market damping must be between 0 and 1.");
  const purchasable = remainingMarketValues
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 1)
    .sort((left, right) => right - left)
    .slice(0, remainingOpenSlots);
  if (purchasable.length < remainingOpenSlots) fail("INVALID_MARKET_VALUES", "Market values must be finite and at least $1.");
  const baselineDiscretionary = purchasable.reduce((sum, value) => sum + Math.max(0, value - 1), 0);
  const cashDiscretionary = remainingRoomDollars - remainingOpenSlots;
  const rawMultiplier = baselineDiscretionary > 0 ? cashDiscretionary / baselineDiscretionary : cashDiscretionary > 0 ? 2 : 1;
  const clampedRawMultiplier = Math.max(0.5, Math.min(2, rawMultiplier));
  const dampedMultiplier = 1 + damping * (clampedRawMultiplier - 1);
  return {
    rawMultiplier,
    clampedRawMultiplier,
    dampedMultiplier,
    cashDiscretionary,
    baselineDiscretionary,
    displayPercent: Math.round((dampedMultiplier - 1) * 1000) / 10,
  };
}

export function applyLiveMarketMultiplier(baseValue, multiplier) {
  if (!Number.isFinite(baseValue) || baseValue < 1) fail("INVALID_BASE_VALUE", "Base market value must be at least $1.");
  if (!Number.isFinite(multiplier) || multiplier < 0.5 || multiplier > 2) fail("INVALID_MARKET_MULTIPLIER", "Market multiplier must be between 0.5 and 2.");
  return Math.max(1, Math.round(1 + (baseValue - 1) * multiplier));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function rankOpponentPressure({ profiles = [], state, player, liveMarketValue, userTeamId = "dogs-of-war" }) {
  if (!Array.isArray(profiles) || !profiles.length || !state?.config || !player) return [];
  if (!Number.isFinite(liveMarketValue) || liveMarketValue < 1) fail("INVALID_PRESSURE_PRICE", "Opponent pressure requires a positive live market price.");
  const activeTeams = Object.values(state.teams).filter((team) => team.openSlots > 0);
  const totalOpenSlots = activeTeams.reduce((sum, team) => sum + team.openSlots, 0);
  const averageCashPerSlot = totalOpenSlots > 0
    ? activeTeams.reduce((sum, team) => sum + team.cash, 0) / totalOpenSlots
    : 1;
  const rows = [];
  for (const profile of profiles) {
    if (profile.teamId === userTeamId) continue;
    const team = state.teams[profile.teamId];
    if (!team || team.openSlots <= 0 || team.legalMaxBid < liveMarketValue) continue;
    const positionMultiplier = profile.positionMultipliers[player.position] ?? 1;
    const historical = clamp(positionMultiplier, 0.75, 1.35);
    const affinityMatch = profile.topNflAffinity === player.nflTeam;
    const affinity = affinityMatch ? clamp(profile.topNflAffinityMultiplier, 1, 1.25) : 1;
    const starterRequirement = state.config.starterRequirements[player.position] ?? 0;
    const starterNeeded = (team.positionCounts[player.position] ?? 0) < starterRequirement;
    const need = starterNeeded ? 1.2 : 1;
    const cashPerSlot = team.cash / team.openSlots;
    const cash = clamp(cashPerSlot / averageCashPerSlot, 0.85, 1.15);
    const pressureIndex = Number((historical * affinity * need * cash).toFixed(3));
    rows.push({
      teamId: profile.teamId,
      teamName: team.name,
      pressureIndex,
      label: pressureIndex >= 1.25 ? "HIGH" : pressureIndex >= 1.05 ? "WATCH" : "LOW",
      positionMultiplier,
      affinityMatch,
      affinityMultiplierApplied: affinity,
      starterNeeded,
      cash: team.cash,
      openSlots: team.openSlots,
      legalMaxBid: team.legalMaxBid,
      sampleSeasons: profile.sampleSeasons,
      samplePurchases: profile.samplePurchases,
      confidence: profile.confidence,
      modelEffect: profile.modelEffect,
    });
  }
  return rows.sort((left, right) => right.pressureIndex - left.pressureIndex || left.teamName.localeCompare(right.teamName));
}

function nextEligibleNominator(state, startStep) {
  if (state.totalPlayers >= state.config.teams.length * state.config.rosterSize) {
    return { step: startStep, teamId: null };
  }
  let step = startStep;
  const scanLimit = state.config.teams.length * 4;
  for (let scanned = 0; scanned < scanLimit; scanned += 1) {
    const teamId = snakeTeamId(state.config.nominationOrder, step);
    const team = state.teams[teamId];
    if (team && team.roster.length < state.config.rosterSize) return { step, teamId };
    step += 1;
  }
  return { step, teamId: null };
}

function applyAcquisition(state, event, kind) {
  const payload = event.payload;
  const team = state.teams[payload.teamId];
  if (!team) fail("UNKNOWN_TEAM", `Unknown fantasy team '${payload.teamId}'.`);
  if (state.draftedPlayers[payload.playerId]) {
    fail("PLAYER_UNAVAILABLE", `${payload.playerName} is already assigned to a team.`, {
      playerId: payload.playerId,
      existingTeamId: state.draftedPlayers[payload.playerId].teamId,
    });
  }
  if (team.roster.length >= state.config.rosterSize) fail("ROSTER_FULL", `${team.name} already has 14 players.`);
  if (kind === "keeper" && team.roster.filter((player) => player.acquisitionType === "keeper").length >= 2) {
    fail("KEEPER_LIMIT", `${team.name} cannot keep more than two players.`);
  }

  const amount = kind === "keeper" ? payload.salary : payload.amount;
  const maximum = legalMaximumBid(team, state.config, payload.position);
  if (amount > maximum) {
    fail("ILLEGAL_BID", `${team.name} can spend at most $${maximum} and still complete a legal roster.`, {
      amount,
      maximum,
      teamId: team.id,
    });
  }

  const nextCounts = { ...team.positionCounts, [payload.position]: team.positionCounts[payload.position] + 1 };
  const openSlotsAfter = state.config.rosterSize - team.roster.length - 1;
  const missingStartersAfter = POSITIONS.reduce(
    (total, position) => total + Math.max(0, state.config.starterRequirements[position] - nextCounts[position]),
    0,
  );
  if (missingStartersAfter > openSlotsAfter) {
    fail(
      "STARTER_PATH_BLOCKED",
      `${team.name} must use its remaining roster slots on required starting positions.`,
      { missingStartersAfter, openSlotsAfter, position: payload.position },
    );
  }

  const rosterEntry = {
    eventId: event.id,
    playerId: payload.playerId,
    playerName: payload.playerName,
    position: payload.position,
    nflTeam: payload.nflTeam,
    price: amount,
    acquisitionType: kind,
  };
  if (kind === "keeper") rosterEntry.keeperYear = payload.keeperYear;
  team.cash -= amount;
  team.spent += amount;
  team.positionCounts = nextCounts;
  team.roster.push(rosterEntry);
  state.draftedPlayers[payload.playerId] = { teamId: team.id, eventId: event.id };
  state.totalPlayers += 1;
  state.totalCash -= amount;
  if (kind === "sale") state.saleCount += 1;
}

function baseState(config) {
  const teams = {};
  for (const configuredTeam of config.teams) {
    teams[configuredTeam.id] = {
      ...configuredTeam,
      cash: configuredTeam.startingCap,
      spent: 0,
      roster: [],
      positionCounts: emptyPositionCounts(),
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    season: SEASON,
    config,
    teams,
    draftedPlayers: {},
    totalCash: config.teams.reduce((sum, team) => sum + team.startingCap, 0),
    totalPlayers: 0,
    saleCount: 0,
    nominationStep: 0,
    currentNominatorTeamId: null,
    lastSale: null,
    keeperRightsOwners: {},
    activeEventCount: 0,
    updatedAt: null,
  };
}

export function replayDraft(rawEvents = []) {
  if (!Array.isArray(rawEvents)) fail("EVENTS_NOT_ARRAY", "Auction events must be supplied as an array.");
  const events = rawEvents.map(validateEvent);
  const byId = new Map();
  events.forEach((event, index) => {
    if (byId.has(event.id)) fail("DUPLICATE_EVENT_ID", `Event id '${event.id}' appears more than once.`);
    byId.set(event.id, { event, index });
  });

  const voided = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type !== EVENT_TYPES.EVENT_VOIDED) continue;
    const target = byId.get(event.payload.targetEventId);
    if (!target || target.index >= index) fail("INVALID_VOID_TARGET", "Undo can target only an earlier event.");
    if (target.event.type === EVENT_TYPES.EVENT_VOIDED) fail("VOID_OF_VOID", "An undo event cannot itself be undone.");
    if (voided.has(target.event.id)) fail("ALREADY_VOIDED", "That event has already been undone.");
    voided.add(target.event.id);
  }

  const operationalEvents = events.filter((event) => event.type !== EVENT_TYPES.EVENT_VOIDED && !voided.has(event.id));
  const configEvents = operationalEvents.filter((event) => event.type === EVENT_TYPES.DRAFT_CONFIGURED);
  if (configEvents.length > 1) fail("MULTIPLE_ACTIVE_CONFIGS", "Only one draft configuration may be active.");
  const configEvent = configEvents[0] || null;
  const config = validateLeagueConfig(configEvent ? configEvent.payload : clone(DEFAULT_CONFIG));
  if (configEvent) {
    const configIndex = operationalEvents.indexOf(configEvent);
    if (operationalEvents.slice(0, configIndex).length > 0) {
      fail("CONFIG_NOT_FIRST", "Draft configuration must precede every active draft event.");
    }
  }

  const state = baseState(config);
  state.keeperSelection = buildKeeperSelectionTimeline(operationalEvents, config);
  let nominationStep = 0;
  for (const event of operationalEvents) {
    if (event.type === EVENT_TYPES.DRAFT_CONFIGURED) continue;

    if (event.type === EVENT_TYPES.CAP_TRANSFERRED) {
      if (state.saleCount > 0) fail("LATE_CAP_TRANSFER", "Cap transfers must be recorded before the auction begins.");
      const fromTeam = state.teams[event.payload.fromTeamId];
      const toTeam = state.teams[event.payload.toTeamId];
      if (!fromTeam || !toTeam) fail("UNKNOWN_TEAM", "Cap transfer references an unknown team.");
      const minimumReserve = requiredRosterAdditions(fromTeam, state.config) * state.config.minimumBid;
      if (fromTeam.cash - event.payload.amount < minimumReserve) {
        fail("CAP_TRANSFER_BREAKS_ROSTER", `${fromTeam.name} would not retain enough cash to complete its roster.`);
      }
      fromTeam.cash -= event.payload.amount;
      fromTeam.startingCap -= event.payload.amount;
      toTeam.cash += event.payload.amount;
      toTeam.startingCap += event.payload.amount;
      continue;
    }

    if (event.type === EVENT_TYPES.KEEPER_RIGHTS_TRADED) {
      if (state.saleCount > 0) fail("LATE_KEEPER_RIGHTS_TRADE", "Keeper-rights trades must be recorded before the auction begins.");
      const teamA = state.teams[event.payload.teamAId];
      const teamB = state.teams[event.payload.teamBId];
      if (!teamA || !teamB) fail("UNKNOWN_TEAM", "Keeper-rights trade references an unknown team.");
      const transfers = [
        ...event.payload.teamASends.map((player) => ({ ...player, fromTeam: teamA, toTeam: teamB })),
        ...event.payload.teamBSends.map((player) => ({ ...player, fromTeam: teamB, toTeam: teamA })),
      ];
      for (const transfer of transfers) {
        if (state.draftedPlayers[transfer.playerId]) fail("RIGHTS_ALREADY_USED", `${transfer.playerName} is already assigned to a roster.`);
        const priorTransfer = state.keeperRightsOwners[transfer.playerId];
        if (priorTransfer && priorTransfer.teamId !== transfer.fromTeam.id) {
          fail("RIGHTS_SELLER_MISMATCH", `${transfer.fromTeam.name} does not currently own ${transfer.playerName}'s rights.`);
        }
      }
      const minimumReserve = requiredRosterAdditions(teamA, state.config) * state.config.minimumBid;
      if (teamA.cash - event.payload.amountFromAToB < minimumReserve) {
        fail("CAP_TRANSFER_BREAKS_ROSTER", `${teamA.name} would not retain enough cash to complete its roster.`);
      }
      teamA.cash -= event.payload.amountFromAToB;
      teamA.startingCap -= event.payload.amountFromAToB;
      teamB.cash += event.payload.amountFromAToB;
      teamB.startingCap += event.payload.amountFromAToB;
      for (const transfer of transfers) {
        state.keeperRightsOwners[transfer.playerId] = {
          teamId: transfer.toTeam.id,
          playerName: transfer.playerName,
          eventId: event.id,
        };
      }
      continue;
    }

    if (event.type === EVENT_TYPES.KEEPER_ASSIGNED) {
      if (state.saleCount > 0) fail("LATE_KEEPER", "Keepers must be assigned before auction purchases.");
      const rightsOwner = state.keeperRightsOwners[event.payload.playerId];
      if (rightsOwner && rightsOwner.teamId !== event.payload.teamId) {
        fail("KEEPER_RIGHTS_OWNER_MISMATCH", `${event.payload.playerName}'s transferred rights belong to ${state.teams[rightsOwner.teamId].name}.`);
      }
      applyAcquisition(state, event, "keeper");
      continue;
    }

    if (event.type === EVENT_TYPES.KEEPER_PASSED) {
      if (state.saleCount > 0) fail("LATE_KEEPER_PASS", "Keeper turns must be completed before auction purchases.");
      continue;
    }

    const eligible = nextEligibleNominator(state, nominationStep);
    nominationStep = eligible.step;

    if (event.type === EVENT_TYPES.NOMINATION_SKIPPED) {
      if (!eligible.teamId || event.payload.teamId !== eligible.teamId) {
        fail("WRONG_SKIP_TEAM", "Nomination skip does not match the current snake position.");
      }
      nominationStep += 1;
      continue;
    }

    if (event.type === EVENT_TYPES.PLAYER_SOLD) {
      if (!eligible.teamId || event.payload.nominatorTeamId !== eligible.teamId) {
        fail("WRONG_NOMINATOR", "Sale nominator does not match the current snake position.", {
          expected: eligible.teamId,
          received: event.payload.nominatorTeamId,
        });
      }
      applyAcquisition(state, event, "sale");
      state.lastSale = {
        eventId: event.id,
        playerId: event.payload.playerId,
        playerName: event.payload.playerName,
        position: event.payload.position,
        teamId: event.payload.teamId,
        teamName: state.teams[event.payload.teamId].name,
        amount: event.payload.amount,
        nominatorTeamId: event.payload.nominatorTeamId,
        createdAt: event.createdAt,
      };
      nominationStep += 1;
      continue;
    }
  }

  const next = nextEligibleNominator(state, nominationStep);
  state.nominationStep = next.step;
  state.currentNominatorTeamId = next.teamId;
  state.activeEventCount = operationalEvents.length;
  state.updatedAt = events.length ? events[events.length - 1].serverReceivedAt || events[events.length - 1].createdAt : null;
  for (const team of Object.values(state.teams)) {
    team.openSlots = state.config.rosterSize - team.roster.length;
    team.minimumRosterSize = MINIMUM_ROSTER_SIZE;
    team.requiredAdditions = requiredRosterAdditions(team, state.config);
    team.legalMaxBid = legalMaximumBid(team, state.config);
    team.missingStarterSlots = starterSlotsMissing(team, state.config.starterRequirements);
  }
  return state;
}

export function lastUndoableEvent(rawEvents, allowedTypes) {
  const events = rawEvents.map(validateEvent);
  if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) {
    fail("INVALID_UNDO_TYPES", "Undo lookup requires at least one allowed event type.");
  }
  const allowed = new Set(allowedTypes);
  for (const type of allowed) {
    if (![EVENT_TYPES.CAP_TRANSFERRED, EVENT_TYPES.KEEPER_RIGHTS_TRADED, EVENT_TYPES.KEEPER_ASSIGNED, EVENT_TYPES.KEEPER_PASSED, EVENT_TYPES.PLAYER_SOLD, EVENT_TYPES.NOMINATION_SKIPPED].includes(type)) {
      fail("INVALID_UNDO_TYPE", `Event type '${type}' cannot be selected for operational undo.`);
    }
  }
  const voided = new Set(events.filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED).map((event) => event.payload.targetEventId));
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (allowed.has(events[index].type) && !voided.has(events[index].id)) return events[index];
  }
  return null;
}

export function lastUndoableSale(rawEvents) {
  return lastUndoableEvent(rawEvents, [EVENT_TYPES.PLAYER_SOLD]);
}

export function mergeEventStreams(canonicalEvents, localEvents) {
  if (!Array.isArray(canonicalEvents) || !Array.isArray(localEvents)) fail("EVENTS_NOT_ARRAY", "Both event streams must be arrays.");
  const merged = canonicalEvents.map(validateEvent);
  const byId = new Map(merged.map((event) => [event.id, event]));
  for (const rawEvent of localEvents) {
    const event = validateEvent(rawEvent);
    const existing = byId.get(event.id);
    if (existing && !sameJSON(existing, event)) fail("EVENT_ID_COLLISION", `Event id '${event.id}' has conflicting contents.`);
    if (!existing) {
      if (event.type === EVENT_TYPES.DRAFT_CONFIGURED) {
        const voidedIds = new Set(
          merged
            .filter((candidate) => candidate.type === EVENT_TYPES.EVENT_VOIDED)
            .map((candidate) => candidate.payload.targetEventId),
        );
        const equivalentActiveConfiguration = merged.some(
          (candidate) => candidate.type === EVENT_TYPES.DRAFT_CONFIGURED
            && !voidedIds.has(candidate.id)
            && sameJSON(candidate.payload, event.payload),
        );
        if (equivalentActiveConfiguration) continue;
      }
      merged.push(event);
      byId.set(event.id, event);
    }
  }
  replayDraft(merged);
  return merged;
}

export function toPublicSnapshot(state, options = {}) {
  const teams = state.config.nominationOrder.map((teamId, finishIndex) => {
    const team = state.teams[teamId];
    return {
      id: team.id,
      name: team.name,
      finish: finishIndex + 1,
      startingCap: team.startingCap,
      cash: team.cash,
      spent: team.spent,
      rosterCount: team.roster.length,
      openSlots: team.openSlots,
      minimumRosterSize: MINIMUM_ROSTER_SIZE,
      requiredAdditions: team.requiredAdditions,
      legalMaxBid: team.legalMaxBid,
      positionCounts: Object.fromEntries(POSITIONS.map((position) => [position, team.positionCounts[position]])),
      players: team.roster.map((player) => ({
        playerId: player.playerId,
        playerName: player.playerName,
        position: player.position,
        price: player.price,
        acquisitionType: player.acquisitionType,
        keeperYear: player.keeperYear || null,
      })),
    };
  });
  const currentNominator = state.currentNominatorTeamId ? state.teams[state.currentNominatorTeamId] : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    season: SEASON,
    status: state.totalPlayers >= state.config.teams.length * state.config.rosterSize ? "complete" : "active",
    updatedAt: options.updatedAt || state.updatedAt,
    revision: options.revision || null,
    nominationOrderStatus: state.config.nominationOrderStatus,
    currentNominator: currentNominator ? { id: currentNominator.id, name: currentNominator.name } : null,
    totalPlayers: state.totalPlayers,
    totalCash: state.totalCash,
    lastSale: state.lastSale
      ? {
          playerName: state.lastSale.playerName,
          position: state.lastSale.position,
          teamName: state.lastSale.teamName,
          amount: state.lastSale.amount,
          createdAt: state.lastSale.createdAt,
        }
      : null,
    teams,
  };
}

const PLAYER_REQUIRED_KEYS = [
  "id",
  "name",
  "position",
  "nflTeam",
  "tier",
  "projectedPoints",
  "vbd",
  "intrinsicValue",
  "marketValue",
  "maxBid",
  "sourceRank",
  "injury",
  "sos",
  "notes",
];
const PLAYER_OPTIONAL_KEYS = ["projectionSources", "weeklyProjection"];
const PROJECTION_SOURCE_KEYS = ["source", "points", "asOf", "role", "modelEffect", "note"];
const WEEKLY_PROJECTION_KEYS = ["source", "asOf", "modelEffect", "games", "byeWeek", "points", "sourceSeasonTotal"];
const MANAGER_PROFILE_KEYS = [
  "teamId", "teamName", "sampleSeasons", "samplePurchases", "observedSpend", "reliability", "confidence",
  "positionMultipliers", "topNflAffinity", "topNflAffinityMultiplier", "modelEffect", "note",
];
const SCHEDULE_CONTEXT_KEYS = [
  "status", "asOf", "source", "modelEffect", "weightingStatus", "cbsTeamId", "division",
  "divisionRivals", "divisionWeeks", "randomWeek14Opponent", "playoffWeeks",
];
const WEEKLY_CONTEXT_KEYS = [
  "status", "asOf", "source", "modelEffect", "engineBacktestStatus", "priorityDefaultStatus",
  "defaultWeights", "suggestedScenario", "divisionWeeks", "playoffWeeks", "coveredPlayers",
  "top168Coverage", "contextFactors", "sourceManifestSha256",
];

function validateWeeklyProjection(input, projectedPoints, label) {
  if (input == null) return null;
  assertExactKeys(input, WEEKLY_PROJECTION_KEYS, [], label);
  if (input.source !== "Thunder Bowl weekly context v3" || input.modelEffect !== "none" || input.games !== 17) {
    fail("WEEKLY_PROJECTION_AUTHORITY", `${label} must remain a value-neutral 17-game Thunder Bowl context.`);
  }
  const byeWeek = assertInteger(input.byeWeek, `${label} bye week`, 1, 18);
  if (!Array.isArray(input.points) || input.points.length !== 18) {
    fail("WEEKLY_PROJECTION_WEEKS", `${label} must contain all 18 NFL weeks.`);
  }
  let nullCount = 0;
  const points = input.points.map((value, index) => {
    if (value == null) {
      nullCount += 1;
      if (index + 1 !== byeWeek) fail("WEEKLY_PROJECTION_BYE", `${label} has a blank outside its bye week.`);
      return null;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 100) {
      fail("WEEKLY_PROJECTION_POINTS", `${label} week ${index + 1} must be from 0 through 100 points.`);
    }
    return number;
  });
  if (nullCount !== 1 || points[byeWeek - 1] !== null) {
    fail("WEEKLY_PROJECTION_BYE", `${label} must contain exactly one blank matching its bye week.`);
  }
  const total = points.reduce((sum, value) => sum + (value ?? 0), 0);
  if (Math.abs(total - projectedPoints) > 0.11) {
    fail("WEEKLY_PROJECTION_TOTAL", `${label} must preserve the authoritative season projection.`);
  }
  const sourceSeasonTotal = Number(input.sourceSeasonTotal);
  if (!Number.isFinite(sourceSeasonTotal) || sourceSeasonTotal <= 0 || sourceSeasonTotal > 1000) {
    fail("WEEKLY_PROJECTION_SOURCE_TOTAL", `${label} has an invalid source season total.`);
  }
  return {
    source: input.source,
    asOf: assertTimestamp(input.asOf, `${label} asOf`),
    modelEffect: input.modelEffect,
    games: 17,
    byeWeek,
    points,
    sourceSeasonTotal,
  };
}

function validateWeeklyContext(input) {
  if (input == null) return null;
  assertExactKeys(input, WEEKLY_CONTEXT_KEYS, [], "weekly context");
  if (
    input.status !== "loaded_experimental_scenario_only"
    || input.source !== "Thunder Bowl weekly context v3"
    || input.modelEffect !== "none"
    || input.engineBacktestStatus !== "completed_time_forward_hold_2018_2025"
    || input.priorityDefaultStatus !== "baseline_only_historical_gate_failed"
  ) {
    fail("WEEKLY_CONTEXT_AUTHORITY", "Weekly context must remain an experimental, value-neutral scenario layer.");
  }
  assertExactKeys(input.defaultWeights, ["baseline", "division", "playoffs"], [], "weekly context default weights");
  if (input.defaultWeights.baseline !== 1 || input.defaultWeights.division !== 1 || input.defaultWeights.playoffs !== 1) {
    fail("WEEKLY_CONTEXT_DEFAULTS", "Weekly context defaults must reproduce the unweighted baseline exactly.");
  }
  assertExactKeys(input.suggestedScenario, ["division", "playoffs", "status"], [], "weekly context suggested scenario");
  if (
    input.suggestedScenario.division !== 1.2
    || input.suggestedScenario.playoffs !== 1.4
    || input.suggestedScenario.status !== "experimental_preview_only"
  ) {
    fail("WEEKLY_CONTEXT_SCENARIO", "The preregistered user scenario must remain a 1.20/1.40 experimental preview.");
  }
  if (!Array.isArray(input.divisionWeeks) || input.divisionWeeks.join(",") !== "1,2,12,13") {
    fail("WEEKLY_CONTEXT_DIVISION_WEEKS", "Weekly context division weeks must be 1, 2, 12, and 13.");
  }
  if (!Array.isArray(input.playoffWeeks) || input.playoffWeeks.join(",") !== "15,16,17") {
    fail("WEEKLY_CONTEXT_PLAYOFF_WEEKS", "Weekly context playoff weeks must be 15, 16, and 17.");
  }
  const factors = ["matchup", "venue", "cold_climatology", "home_away", "short_week"];
  if (!Array.isArray(input.contextFactors) || input.contextFactors.join(",") !== factors.join(",")) {
    fail("WEEKLY_CONTEXT_FACTORS", "Weekly context factor coverage changed unexpectedly.");
  }
  const top168Coverage = Number(input.top168Coverage);
  if (!Number.isFinite(top168Coverage) || top168Coverage < 0 || top168Coverage > 1) {
    fail("WEEKLY_CONTEXT_COVERAGE", "Weekly context top-168 coverage must be from 0 through 1.");
  }
  if (typeof input.sourceManifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sourceManifestSha256)) {
    fail("WEEKLY_CONTEXT_MANIFEST", "Weekly context requires a pinned SHA-256 source manifest.");
  }
  return {
    status: input.status,
    asOf: assertTimestamp(input.asOf, "weekly context asOf"),
    source: input.source,
    modelEffect: input.modelEffect,
    engineBacktestStatus: input.engineBacktestStatus,
    priorityDefaultStatus: input.priorityDefaultStatus,
    defaultWeights: { baseline: 1, division: 1, playoffs: 1 },
    suggestedScenario: { division: 1.2, playoffs: 1.4, status: "experimental_preview_only" },
    divisionWeeks: [1, 2, 12, 13],
    playoffWeeks: [15, 16, 17],
    coveredPlayers: assertInteger(input.coveredPlayers, "weekly context covered players", 1, 5000),
    top168Coverage,
    contextFactors: factors,
    sourceManifestSha256: input.sourceManifestSha256,
  };
}

function validateScheduleContext(input) {
  if (input == null) return null;
  assertExactKeys(input, SCHEDULE_CONTEXT_KEYS, [], "schedule context");
  const status = assertString(input.status, "schedule context status", 3, 40);
  const modelEffect = assertString(input.modelEffect, "schedule context model effect", 3, 20);
  const weightingStatus = assertString(input.weightingStatus, "schedule context weighting status", 3, 60);
  if (status !== "loaded_value_neutral" || modelEffect !== "none" || weightingStatus !== "disabled_historical_gate_failed_2018_2025") {
    fail("SCHEDULE_CONTEXT_AUTHORITY", "Schedule context must remain value-neutral until its historical gate passes.");
  }
  const cbsTeamId = assertInteger(input.cbsTeamId, "schedule context CBS team id", 1, 12);
  if (cbsTeamId !== 4) fail("SCHEDULE_CONTEXT_TEAM", "Schedule context must describe Dogs of War as CBS team 4.");
  const division = assertString(input.division, "schedule context division", 3, 12);
  if (!["North", "East", "South", "West"].includes(division)) fail("SCHEDULE_CONTEXT_DIVISION", "Schedule context has an unknown division.");
  if (!Array.isArray(input.divisionRivals) || input.divisionRivals.length !== 2) {
    fail("SCHEDULE_CONTEXT_RIVALS", "Schedule context must contain exactly two division rivals.");
  }
  const divisionRivals = input.divisionRivals.map((name, index) => assertString(name, `division rival ${index + 1}`, 2, 60));
  if (new Set(divisionRivals).size !== 2) fail("SCHEDULE_CONTEXT_RIVALS", "Division rivals must be unique.");
  if (!Array.isArray(input.divisionWeeks) || input.divisionWeeks.length !== 4) {
    fail("SCHEDULE_CONTEXT_WEEKS", "Schedule context must contain four division matchup weeks.");
  }
  const divisionWeeks = input.divisionWeeks.map((row, index) => {
    assertExactKeys(row, ["week", "opponent"], [], `division week ${index + 1}`);
    const opponent = assertString(row.opponent, `division week ${index + 1} opponent`, 2, 60);
    if (!divisionRivals.includes(opponent)) fail("SCHEDULE_CONTEXT_RIVALS", "A division week references a non-rival.");
    return { week: assertInteger(row.week, `division week ${index + 1}`, 1, 14), opponent };
  });
  if (divisionWeeks.map((row) => row.week).join(",") !== "1,2,12,13") {
    fail("SCHEDULE_CONTEXT_WEEKS", "Division weeks must be 1, 2, 12, and 13.");
  }
  for (const rival of divisionRivals) {
    if (divisionWeeks.filter((row) => row.opponent === rival).length !== 2) {
      fail("SCHEDULE_CONTEXT_RIVALS", "Each division rival must appear twice in division weeks.");
    }
  }
  if (!Array.isArray(input.playoffWeeks) || input.playoffWeeks.join(",") !== "15,16,17") {
    fail("SCHEDULE_CONTEXT_PLAYOFFS", "Playoff weeks must be 15, 16, and 17.");
  }
  const week14Format = assertString(input.randomWeek14Opponent, "Week 14 format", 2, 60);
  if (week14Format !== "All-play (no head-to-head opponent)") {
    fail("SCHEDULE_CONTEXT_WEEK_14", "Week 14 must remain all-play with no head-to-head opponent.");
  }
  return {
    status,
    asOf: assertTimestamp(input.asOf, "schedule context asOf"),
    source: assertString(input.source, "schedule context source", 3, 100),
    modelEffect,
    weightingStatus,
    cbsTeamId,
    division,
    divisionRivals,
    divisionWeeks,
    randomWeek14Opponent: week14Format,
    playoffWeeks: [15, 16, 17],
  };
}

const PLAYER_IDENTITY_ALIASES = new Map(Object.entries({
  andresborregales: "andyborregales",
  kenwalker: "kennethwalker",
  kennethgainwell: "kennygainwell",
  christopherbrooks: "chrisbrooks",
  chigoziemokonkwo: "chigokonkwo",
  matthewhibner: "matthibner",
  scottmiller: "scottymiller",
  mitchtrubisky: "mitchelltrubisky",
}));

function canonicalPlayerIdentity(name, position, nflTeam) {
  const normalizedName = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
  const canonicalName = PLAYER_IDENTITY_ALIASES.get(normalizedName) || normalizedName;
  const canonicalTeam = ({ ARZ: "ARI", JAC: "JAX", LA: "LAR" })[nflTeam] || nflTeam;
  return `${canonicalName}|${position}|${canonicalTeam}`;
}

export function validateDraftPack(input) {
  assertExactKeys(
    input,
    ["schemaVersion", "packId", "season", "status", "asOf", "sources", "leagueConfig", "players", "keeperCandidates"],
    ["managerProfiles", "scheduleContext", "weeklyContext", "fbgAuctionValues"],
    "draft pack",
  );
  if (input.schemaVersion !== SCHEMA_VERSION) fail("PACK_SCHEMA_MISMATCH", "Unsupported draft-pack schema.");
  if (!SUPPORTED_SEASONS.includes(input.season)) fail("PACK_SEASON_MISMATCH", "This app accepts only the isolated 2025 replay or a 2026 draft pack.");
  const packId = assertIdentifier(input.packId, "draft pack id");
  const status = assertString(input.status, "draft pack status", 3, 30);
  if (!["illustrative", "production", "practice"].includes(status)) {
    fail("INVALID_PACK_STATUS", "Draft pack status must be illustrative, practice, or production.");
  }
  const asOf = assertTimestamp(input.asOf, "draft pack asOf");
  if (!Array.isArray(input.sources)) fail("INVALID_SOURCES", "Draft pack sources must be an array.");
  const sources = input.sources.map((source, index) => {
    assertExactKeys(source, ["name", "asOf", "authority", "scoringFingerprint"], [], `source ${index + 1}`);
    return {
      name: assertString(source.name, `source ${index + 1} name`, 2, 80),
      asOf: assertTimestamp(source.asOf, `source ${index + 1} asOf`),
      authority: assertString(source.authority, `source ${index + 1} authority`, 3, 50),
      scoringFingerprint: assertString(source.scoringFingerprint, `source ${index + 1} scoring fingerprint`, 3, 120),
    };
  });
  const leagueConfig = validateLeagueConfig(input.leagueConfig);
  if (leagueConfig.season !== input.season) fail("PACK_CONFIG_SEASON_MISMATCH", "Draft pack season and league configuration season must match.");
  const scheduleContext = validateScheduleContext(input.scheduleContext);
  if (scheduleContext && input.season !== 2026) fail("SCHEDULE_CONTEXT_SEASON", "The 2026 schedule context cannot be attached to another season.");
  const weeklyContext = validateWeeklyContext(input.weeklyContext);
  if (weeklyContext && input.season !== 2026) fail("WEEKLY_CONTEXT_SEASON", "The 2026 weekly context cannot be attached to another season.");
  const configuredTeamById = new Map(leagueConfig.teams.map((team) => [team.id, team]));
  const managerProfileTeamIds = new Set();
  const managerProfiles = (input.managerProfiles || []).map((profile, index) => {
    const label = `manager profile ${index + 1}`;
    assertExactKeys(profile, MANAGER_PROFILE_KEYS, [], label);
    const teamId = assertIdentifier(profile.teamId, `${label} team id`);
    const configuredTeam = configuredTeamById.get(teamId);
    if (!configuredTeam) fail("UNKNOWN_MANAGER_PROFILE_TEAM", `${label} references unknown team '${teamId}'.`);
    if (managerProfileTeamIds.has(teamId)) fail("DUPLICATE_MANAGER_PROFILE_TEAM", `${configuredTeam.name} has more than one manager profile.`);
    managerProfileTeamIds.add(teamId);
    const teamName = assertString(profile.teamName, `${label} team name`, 2, 60);
    if (teamName !== configuredTeam.name) fail("MANAGER_PROFILE_TEAM_MISMATCH", `${label} team name does not match league configuration.`);
    const reliability = Number(profile.reliability);
    if (!Number.isFinite(reliability) || reliability < 0 || reliability > 0.5) fail("MANAGER_PROFILE_RELIABILITY", `${label} exceeds the low-confidence reliability cap.`);
    assertExactKeys(profile.positionMultipliers, POSITIONS, [], `${label} position multipliers`);
    const positionMultipliers = {};
    for (const position of POSITIONS) {
      const value = Number(profile.positionMultipliers[position]);
      if (!Number.isFinite(value) || value < 0.5 || value > 2.1) fail("MANAGER_PROFILE_MULTIPLIER", `${label} ${position} multiplier is outside the frozen range.`);
      positionMultipliers[position] = value;
    }
    const affinityMultiplier = Number(profile.topNflAffinityMultiplier);
    if (!Number.isFinite(affinityMultiplier) || affinityMultiplier < 1 || affinityMultiplier > 2.1) fail("MANAGER_PROFILE_AFFINITY", `${label} affinity multiplier is outside the frozen range.`);
    const confidence = assertString(profile.confidence, `${label} confidence`, 3, 30);
    const modelEffect = assertString(profile.modelEffect, `${label} model effect`, 3, 30);
    if (confidence !== "low_advisory_only" || modelEffect !== "advisory_only") fail("MANAGER_PROFILE_AUTHORITY", `${label} exceeds advisory-only authority.`);
    return {
      teamId,
      teamName,
      sampleSeasons: assertInteger(profile.sampleSeasons, `${label} sample seasons`, 1, 20),
      samplePurchases: assertInteger(profile.samplePurchases, `${label} sample purchases`, 20, 1000),
      observedSpend: assertInteger(profile.observedSpend, `${label} observed spend`, 1, 10000),
      reliability,
      confidence,
      positionMultipliers,
      topNflAffinity: assertString(profile.topNflAffinity, `${label} NFL affinity`, 2, 4).toUpperCase(),
      topNflAffinityMultiplier: affinityMultiplier,
      modelEffect,
      note: assertString(profile.note, `${label} note`, 3, 180),
    };
  });
  if (managerProfiles.length && managerProfiles.length !== leagueConfig.teams.length) {
    fail("INCOMPLETE_MANAGER_PROFILE_COVERAGE", `Manager profiles cover ${managerProfiles.length} teams, not all ${leagueConfig.teams.length}.`);
  }
  if (!Array.isArray(input.players) || input.players.length === 0) fail("EMPTY_PLAYER_POOL", "Draft pack must contain players.");
  const playerIds = new Set();
  const playerIdentities = new Map();
  const players = input.players.map((player, index) => {
    assertExactKeys(player, PLAYER_REQUIRED_KEYS, PLAYER_OPTIONAL_KEYS, `player ${index + 1}`);
    const id = assertIdentifier(player.id, `player ${index + 1} id`);
    if (playerIds.has(id)) fail("DUPLICATE_PLAYER_ID", `Player id '${id}' appears more than once.`);
    playerIds.add(id);
    const numeric = {};
    for (const key of ["tier", "projectedPoints", "vbd", "intrinsicValue", "marketValue", "maxBid", "sourceRank"]) {
      if (!Number.isFinite(player[key])) fail("INVALID_PLAYER_NUMBER", `Player ${index + 1} ${key} must be numeric.`);
      numeric[key] = player[key];
    }
    const name = assertString(player.name, `player ${index + 1} name`, 2, 80);
    const position = assertPosition(player.position, `player ${index + 1} position`);
    const nflTeam = assertString(player.nflTeam || "FA", `player ${index + 1} NFL team`, 2, 10).toUpperCase();
    const identity = canonicalPlayerIdentity(name, position, nflTeam);
    if (playerIdentities.has(identity)) {
      fail("DUPLICATE_PLAYER_IDENTITY", `${name} duplicates ${playerIdentities.get(identity)} after canonical identity matching.`);
    }
    playerIdentities.set(identity, name);
    const projectionSourceNames = new Set();
    const projectionSources = (player.projectionSources || []).map((source, sourceIndex) => {
      const label = `player ${index + 1} projection source ${sourceIndex + 1}`;
      assertExactKeys(source, PROJECTION_SOURCE_KEYS, [], label);
      const sourceName = assertString(source.source, `${label} name`, 2, 40);
      if (projectionSourceNames.has(sourceName)) fail("DUPLICATE_PROJECTION_SOURCE", `${name} repeats projection source '${sourceName}'.`);
      projectionSourceNames.add(sourceName);
      if (!Number.isFinite(source.points) || source.points < 0) fail("INVALID_PROJECTION_SOURCE_POINTS", `${label} points must be non-negative.`);
      const role = assertString(source.role, `${label} role`, 4, 20);
      if (!["primary", "cross-check", "supplemental"].includes(role)) fail("INVALID_PROJECTION_SOURCE_ROLE", `${label} has unsupported role '${role}'.`);
      const modelEffect = assertString(source.modelEffect, `${label} model effect`, 4, 30);
      if (!["primary_projection", "none"].includes(modelEffect)) fail("INVALID_PROJECTION_SOURCE_EFFECT", `${label} has unsupported model effect '${modelEffect}'.`);
      if (role === "supplemental" && modelEffect !== "none") fail("SUPPLEMENTAL_SOURCE_EFFECT", `${label} cannot alter the primary projection.`);
      return {
        source: sourceName,
        points: source.points,
        asOf: assertTimestamp(source.asOf, `${label} asOf`),
        role,
        modelEffect,
        note: assertString(source.note, `${label} note`, 3, 120),
      };
    });
    const primarySources = projectionSources.filter((source) => source.modelEffect === "primary_projection");
    if (projectionSources.length && primarySources.length !== 1) fail("INVALID_PRIMARY_PROJECTION_SOURCE", `${name} must have exactly one primary projection source.`);
    if (primarySources.length === 1 && Math.abs(primarySources[0].points - numeric.projectedPoints) > 0.11) {
      fail("PRIMARY_PROJECTION_MISMATCH", `${name}'s displayed projection does not match its primary source.`);
    }
    const weeklyProjection = validateWeeklyProjection(
      player.weeklyProjection,
      numeric.projectedPoints,
      `player ${index + 1} weekly projection`,
    );
    return {
      id,
      name,
      position,
      nflTeam,
      ...numeric,
      injury: assertString(player.injury, `player ${index + 1} injury`, 2, 120),
      sos: assertString(player.sos, `player ${index + 1} SOS`, 2, 120),
      notes: assertString(player.notes, `player ${index + 1} notes`, 2, 300),
      projectionSources,
      ...(weeklyProjection ? { weeklyProjection } : {}),
    };
  });
  if (weeklyContext) {
    const coveredPlayers = players.filter((player) => player.weeklyProjection).length;
    const topCount = Math.min(168, players.length);
    const top168Coverage = Number((players.slice(0, topCount).filter((player) => player.weeklyProjection).length / topCount).toFixed(6));
    if (coveredPlayers !== weeklyContext.coveredPlayers || top168Coverage !== weeklyContext.top168Coverage) {
      fail("WEEKLY_CONTEXT_COVERAGE", "Weekly context coverage does not reconcile to attached player rows.");
    }
  }
  let fbgAuctionValues;
  if (input.fbgAuctionValues !== undefined) {
    assertExactKeys(
      input.fbgAuctionValues,
      ["source", "asOf", "modelEffect", "coverage", "rankStart", "rankEnd", "reportedRows", "matchedRows", "values"],
      [],
      "FBG auction values",
    );
    const source = assertString(input.fbgAuctionValues.source, "FBG auction value source", 3, 80);
    const fbgAsOf = assertTimestamp(input.fbgAuctionValues.asOf, "FBG auction value asOf");
    const modelEffect = assertString(input.fbgAuctionValues.modelEffect, "FBG auction value model effect", 3, 20);
    if (modelEffect !== "none") fail("FBG_VALUE_AUTHORITY", "FBG auction values are comparison-only and cannot alter Thunder Bowl strategy values.");
    const rankStart = assertInteger(input.fbgAuctionValues.rankStart, "FBG auction rank start", 1, 2000);
    const rankEnd = assertInteger(input.fbgAuctionValues.rankEnd, "FBG auction rank end", rankStart, 2000);
    const reportedRows = assertInteger(input.fbgAuctionValues.reportedRows, "FBG reported rows", 1, 2000);
    const matchedRows = assertInteger(input.fbgAuctionValues.matchedRows, "FBG matched rows", 0, reportedRows);
    if (reportedRows !== rankEnd - rankStart + 1) fail("FBG_RANK_COVERAGE", "FBG reported-row count must exactly cover its stated contiguous rank range.");
    if (matchedRows !== reportedRows) fail("FBG_MATCH_COVERAGE", "Every supplied FBG auction row must resolve to exactly one protected player.");
    if (!Array.isArray(input.fbgAuctionValues.values)) fail("INVALID_FBG_VALUES", "FBG auction values must be an array.");
    const fbgPlayerIds = new Set();
    const fbgRanks = new Set();
    const values = input.fbgAuctionValues.values.map((row, index) => {
      const label = `FBG auction value ${index + 1}`;
      assertExactKeys(row, ["playerId", "rank", "value"], [], label);
      const playerId = assertIdentifier(row.playerId, `${label} player id`);
      const rank = assertInteger(row.rank, `${label} rank`, rankStart, rankEnd);
      const value = assertInteger(row.value, `${label} value`, 1, 300);
      if (!playerIds.has(playerId)) fail("UNKNOWN_FBG_PLAYER", `${label} does not resolve to the player pool.`);
      if (fbgPlayerIds.has(playerId)) fail("DUPLICATE_FBG_PLAYER", `${label} repeats a player.`);
      if (fbgRanks.has(rank)) fail("DUPLICATE_FBG_RANK", `${label} repeats rank ${rank}.`);
      fbgPlayerIds.add(playerId);
      fbgRanks.add(rank);
      return { playerId, rank, value };
    });
    if (values.length !== matchedRows) fail("FBG_MATCHED_ROWS", "FBG matched-row count does not reconcile to its values.");
    if (fbgRanks.size !== reportedRows) fail("FBG_RANK_COVERAGE", "FBG auction ranks do not completely cover the stated range.");
    fbgAuctionValues = {
      source,
      asOf: fbgAsOf,
      modelEffect,
      coverage: assertString(input.fbgAuctionValues.coverage, "FBG auction value coverage", 3, 180),
      rankStart,
      rankEnd,
      reportedRows,
      matchedRows,
      values,
    };
  }
  if (!Array.isArray(input.keeperCandidates)) fail("INVALID_KEEPERS", "keeperCandidates must be an array.");
  const keeperCandidates = input.keeperCandidates.map((candidate, index) => {
    assertExactKeys(
      candidate,
      ["playerId", "playerName", "position", "teamId", "priorSalary", "keeperSalary", "keeperYear", "marketValue", "surplus", "evidenceStatus"],
      ["selectionRound", "selectionPick"],
      `keeper candidate ${index + 1}`,
    );
    const normalized = {
      playerId: assertIdentifier(candidate.playerId, `keeper candidate ${index + 1} player id`),
      playerName: assertString(candidate.playerName, `keeper candidate ${index + 1} player name`, 2, 80),
      position: assertPosition(candidate.position, `keeper candidate ${index + 1} position`),
      teamId: assertIdentifier(candidate.teamId, `keeper candidate ${index + 1} team id`),
      priorSalary: assertInteger(candidate.priorSalary, `keeper candidate ${index + 1} prior salary`, 0, 300),
      keeperSalary: assertInteger(candidate.keeperSalary, `keeper candidate ${index + 1} keeper salary`, 0, 300),
      keeperYear: assertInteger(candidate.keeperYear, `keeper candidate ${index + 1} keeper year`, 1, 4),
      marketValue: Number(candidate.marketValue),
      surplus: Number(candidate.surplus),
      evidenceStatus: assertString(candidate.evidenceStatus, `keeper candidate ${index + 1} evidence status`, 3, 80),
    };
    if (candidate.selectionRound !== undefined) {
      normalized.selectionRound = assertInteger(candidate.selectionRound, `keeper candidate ${index + 1} selection round`, 1, 12);
    }
    if (candidate.selectionPick !== undefined) {
      normalized.selectionPick = assertString(candidate.selectionPick, `keeper candidate ${index + 1} selection pick`, 3, 12);
    }
    return normalized;
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    packId,
    season: input.season,
    status,
    asOf,
    sources,
    leagueConfig,
    players,
    keeperCandidates,
    managerProfiles,
    scheduleContext,
    weeklyContext,
    ...(fbgAuctionValues ? { fbgAuctionValues } : {}),
  };
}

export function createRecoveryBundle(pack, events, exportedAt = new Date().toISOString()) {
  const validatedPack = validateDraftPack(pack);
  const validatedEvents = events.map(validateEvent);
  replayDraft(validatedEvents);
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: `thunder-bowl-${validatedPack.season}-recovery`,
    exportedAt: assertTimestamp(exportedAt, "recovery exportedAt"),
    pack: validatedPack,
    events: validatedEvents,
  };
}

export function validateRecoveryBundle(input) {
  assertExactKeys(input, ["schemaVersion", "kind", "exportedAt", "pack", "events"], [], "recovery bundle");
  if (input.schemaVersion !== SCHEMA_VERSION) fail("RECOVERY_SCHEMA_MISMATCH", "This is not a supported Thunder Bowl recovery file.");
  const pack = validateDraftPack(input.pack);
  const expectedKind = `thunder-bowl-${pack.season}-recovery`;
  if (input.kind !== expectedKind) fail("RECOVERY_SCHEMA_MISMATCH", `This recovery file does not match the ${pack.season} room.`);
  const events = input.events.map(validateEvent);
  replayDraft(events);
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: expectedKind,
    exportedAt: assertTimestamp(input.exportedAt, "recovery exportedAt"),
    pack,
    events,
  };
}
