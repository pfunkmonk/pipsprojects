import { EVENT_TYPES, validateEvent } from "./state-engine.mjs?v=20260810e";

export const KEEPER_PROMOTION_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.CAP_TRANSFERRED,
  EVENT_TYPES.KEEPER_RIGHTS_TRADED,
  EVENT_TYPES.KEEPER_ASSIGNED,
  EVENT_TYPES.KEEPER_PASSED,
]);

const ALLOWED_TYPES = new Set([...KEEPER_PROMOTION_EVENT_TYPES, EVENT_TYPES.EVENT_VOIDED]);

function semanticEvent(event) {
  const { serverReceivedAt: _serverReceivedAt, ...stable } = event;
  return stable;
}

function indexUnique(events, label) {
  const byId = new Map();
  for (const input of events) {
    const event = validateEvent(input);
    if (byId.has(event.id)) throw new Error(`${label} repeats event ID ${event.id}.`);
    byId.set(event.id, event);
  }
  return byId;
}

export function buildKeeperSandboxPromotion({ officialEvents = [], sandboxEvents = [] } = {}) {
  if (!Array.isArray(officialEvents) || !Array.isArray(sandboxEvents)) {
    throw new Error("Keeper sandbox publication requires official and sandbox event arrays.");
  }
  const officialById = indexUnique(officialEvents, "Official ledger");
  const sandboxById = indexUnique(sandboxEvents, "Prediction sandbox");

  for (const event of sandboxById.values()) {
    if (!ALLOWED_TYPES.has(event.type)) throw new Error(`Prediction sandbox event ${event.id} has forbidden type ${event.type}.`);
    const official = officialById.get(event.id);
    if (official && JSON.stringify(semanticEvent(official)) !== JSON.stringify(semanticEvent(event))) {
      throw new Error(`Event ID ${event.id} differs between the prediction sandbox and official ledger.`);
    }
  }

  const combinedById = new Map([...officialById, ...sandboxById]);
  for (const event of sandboxById.values()) {
    if (event.type !== EVENT_TYPES.EVENT_VOIDED) continue;
    const target = combinedById.get(event.payload.targetEventId);
    if (!target || !KEEPER_PROMOTION_EVENT_TYPES.includes(target.type)) {
      throw new Error(`Sandbox correction ${event.id} does not target a keeper setup action.`);
    }
  }

  const pendingEvents = [...sandboxById.values()].filter((event) => !officialById.has(event.id));
  const voidedIds = new Set(
    [...officialById.values(), ...sandboxById.values()]
      .filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED)
      .map((event) => event.payload.targetEventId),
  );
  const reviewItems = pendingEvents.flatMap((event) => {
    if (KEEPER_PROMOTION_EVENT_TYPES.includes(event.type)) {
      return voidedIds.has(event.id) ? [] : [{ kind: "add", event, target: null }];
    }
    const target = combinedById.get(event.payload.targetEventId);
    return officialById.has(target.id) ? [{ kind: "remove", event, target }] : [];
  });

  return {
    pendingEvents,
    reviewItems,
    counts: {
      ledgerEvents: pendingEvents.length,
      keepers: reviewItems.filter((item) => item.kind === "add" && item.event.type === EVENT_TYPES.KEEPER_ASSIGNED).length,
      trades: reviewItems.filter((item) => item.kind === "add" && [EVENT_TYPES.KEEPER_RIGHTS_TRADED, EVENT_TYPES.CAP_TRANSFERRED].includes(item.event.type)).length,
      passes: reviewItems.filter((item) => item.kind === "add" && item.event.type === EVENT_TYPES.KEEPER_PASSED).length,
      removals: reviewItems.filter((item) => item.kind === "remove").length,
    },
  };
}
