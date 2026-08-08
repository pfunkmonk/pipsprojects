export const HUMAN_REHEARSAL_SCHEMA_VERSION = 1;
export const HUMAN_REHEARSAL_MAX_AGE_DAYS = 30;

export const HUMAN_REHEARSAL_ITEMS = Object.freeze([
  Object.freeze({ id: "full-auction", label: "Completed a full 12-team mock auction at realistic speaking and entry speed." }),
  Object.freeze({ id: "second-screen", label: "Projected the public board on a second computer and saw purchases update within about one second." }),
  Object.freeze({ id: "wifi-loss", label: "Deliberately disconnected Wi-Fi during active bidding." }),
  Object.freeze({ id: "offline-actions", label: "While offline, searched, recorded a sale, and used Undo successfully." }),
  Object.freeze({ id: "reconnect", label: "Reconnected and verified queued events merged without duplicates or lost corrections." }),
  Object.freeze({ id: "recovery-import", label: "Downloaded a recovery bundle and successfully restored it during the rehearsal." }),
  Object.freeze({ id: "noisy-room", label: "Operated the MacBook at the intended zoom while bidding, talking, and tracking the room alone." }),
]);

function finiteTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function rehearsalConfigSignature(config) {
  if (!config || typeof config !== "object") throw new TypeError("Human rehearsal evidence requires a league configuration.");
  const teams = Array.isArray(config.teams) ? config.teams : [];
  const starters = Object.fromEntries(Object.entries(config.starterRequirements || {}).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify({
    season: Number(config.season),
    rulesVersion: String(config.rulesVersion || ""),
    rosterSize: Number(config.rosterSize),
    minimumBid: Number(config.minimumBid),
    starterRequirements: starters,
    teams: teams.map((team) => ({ id: team.id, startingCap: Number(team.startingCap) })),
    nominationOrder: [...(config.nominationOrder || [])],
    nominationOrderStatus: String(config.nominationOrderStatus || ""),
    verifiedPrefixCount: Number(config.verifiedPrefixCount || 0),
  });
}

export function createHumanRehearsalEvidence({ checks, leagueConfig, completedAt = new Date().toISOString() } = {}) {
  const timestamp = finiteTimestamp(completedAt);
  if (timestamp === null) throw new TypeError("Human rehearsal completion time must be a valid timestamp.");
  const normalizedChecks = {};
  for (const item of HUMAN_REHEARSAL_ITEMS) {
    if (checks?.[item.id] !== true) throw new TypeError(`Human rehearsal item '${item.id}' is not complete.`);
    normalizedChecks[item.id] = true;
  }
  return {
    schemaVersion: HUMAN_REHEARSAL_SCHEMA_VERSION,
    source: "human-attested Thunder Bowl rehearsal",
    completedAt: new Date(timestamp).toISOString(),
    configSignature: rehearsalConfigSignature(leagueConfig),
    checks: normalizedChecks,
    itemCount: HUMAN_REHEARSAL_ITEMS.length,
    modelEffect: "none",
    ledgerEffect: "none",
  };
}

export function humanRehearsalStatus(evidence, leagueConfig, { now = new Date().toISOString(), maxAgeDays = HUMAN_REHEARSAL_MAX_AGE_DAYS } = {}) {
  const nowTimestamp = finiteTimestamp(now);
  if (nowTimestamp === null) throw new TypeError("Human rehearsal status requires a valid current timestamp.");
  const invalid = (reason) => ({ current: false, completedAt: null, ageDays: null, reason, modelEffect: "none", ledgerEffect: "none" });
  if (!evidence) return invalid("No human-paced rehearsal certificate is saved on this laptop.");
  if (evidence.schemaVersion !== HUMAN_REHEARSAL_SCHEMA_VERSION
    || evidence.source !== "human-attested Thunder Bowl rehearsal"
    || evidence.modelEffect !== "none"
    || evidence.ledgerEffect !== "none"
    || evidence.itemCount !== HUMAN_REHEARSAL_ITEMS.length) return invalid("The saved rehearsal certificate failed its evidence contract.");
  if (evidence.configSignature !== rehearsalConfigSignature(leagueConfig)) return invalid("The league configuration changed after the saved rehearsal.");
  if (Object.keys(evidence.checks || {}).length !== HUMAN_REHEARSAL_ITEMS.length
    || HUMAN_REHEARSAL_ITEMS.some((item) => evidence.checks?.[item.id] !== true)) return invalid("The saved rehearsal certificate is missing a required physical test.");
  const completedTimestamp = finiteTimestamp(evidence.completedAt);
  if (completedTimestamp === null || completedTimestamp > nowTimestamp + 5 * 60 * 1000) return invalid("The saved rehearsal completion time is invalid.");
  const ageDays = Math.max(0, (nowTimestamp - completedTimestamp) / 86_400_000);
  if (ageDays > maxAgeDays) return { ...invalid(`The rehearsal certificate is ${Math.floor(ageDays)} days old; repeat it before draft day.`), completedAt: evidence.completedAt, ageDays };
  return {
    current: true,
    completedAt: evidence.completedAt,
    ageDays,
    reason: `All ${HUMAN_REHEARSAL_ITEMS.length} human-paced outage and recovery actions were attested ${ageDays < 1 ? "today" : `${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? "" : "s"} ago`}.`,
    modelEffect: "none",
    ledgerEffect: "none",
  };
}
