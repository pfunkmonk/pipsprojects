export const DRAFT_DAY_SCHEMA_VERSION = 1;
export const DEFAULT_POSITION_RULES = Object.freeze([
  { id: "QB", label: "QB", minimum: 1, maximum: 3 },
  { id: "RB", label: "RB", minimum: 2, maximum: 8 },
  { id: "WR", label: "WR", minimum: 2, maximum: 8 },
  { id: "TE", label: "TE", minimum: 1, maximum: 3 },
  { id: "K", label: "K", minimum: 1, maximum: 2 },
  { id: "DST", label: "DST", minimum: 1, maximum: 2 },
]);

const EVENT_TYPES = new Set([
  "SALE_RECORDED",
  "SALE_CORRECTED",
  "SALE_VOIDED",
  "SALE_RESTORED",
  "CUSTOM_PLAYER_ADDED",
  "DRAFT_STATUS_CHANGED",
]);

function integer(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be a whole number from ${minimum} through ${maximum}.`);
  }
  return number;
}

function text(value, label, maximum = 100) {
  const result = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!result || result.length > maximum) throw new Error(`${label} is required and must be ${maximum} characters or fewer.`);
  return result;
}

function optionalText(value, maximum = 30) {
  const result = String(value ?? "").trim().replace(/\s+/g, " ");
  if (result.length > maximum) throw new Error(`Text must be ${maximum} characters or fewer.`);
  return result;
}

export function positionMaximum(rule, rosterMaximum) {
  return rule?.maximum == null ? rosterMaximum : rule.maximum;
}

export function safeId(value, label = "Id") {
  const result = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}

export function normalizeLeagueCode(value) {
  const compact = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 8) throw new Error("League code must contain eight letters or numbers.");
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export function normalizePlayer(value, label = "Player") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return {
    id: safeId(value.id, `${label} id`),
    name: text(value.name, `${label} name`, 100),
    position: text(value.position, `${label} position`, 20).toUpperCase(),
    nflTeam: optionalText(value.nflTeam, 20).toUpperCase() || "FA",
  };
}

export function playerIdentity(player) {
  return String(player?.id || `${player?.name || ""}|${player?.position || ""}`)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function playerNameIdentity(player) {
  return `${String(player?.name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "")}|${String(player?.position || "").toUpperCase()}`;
}

function samePlayer(left, right) {
  return playerIdentity(left) === playerIdentity(right) || playerNameIdentity(left) === playerNameIdentity(right);
}

export function normalizeLeagueConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("League setup is invalid.");
  const leagueName = text(input.leagueName, "League name", 80);
  const season = integer(input.season, "Season", 2020, 2100);
  const minimumBid = integer(input.minimumBid, "Minimum bid", 1, 1_000);
  const bidIncrement = integer(input.bidIncrement, "Bid increment", 1, 1_000);
  const rosterMinimum = integer(input.rosterMinimum, "Roster minimum", 1, 100);
  const rosterMaximum = integer(input.rosterMaximum, "Roster maximum", rosterMinimum, 100);
  const budgetMode = input.budgetMode === "pre-keeper" ? "pre-keeper" : "current-cash";
  const nominationMode = ["snake", "linear", "manual"].includes(input.nominationMode) ? input.nominationMode : "snake";

  if (!Array.isArray(input.positionRules) || input.positionRules.length < 1 || input.positionRules.length > 20) {
    throw new Error("Add between one and twenty roster positions.");
  }
  const positionRules = input.positionRules.map((rule, index) => {
    const id = text(rule?.id, `Position ${index + 1} abbreviation`, 20).toUpperCase().replace(/\s+/g, "-");
    if (!/^[A-Z0-9][A-Z0-9+/_-]{0,19}$/.test(id)) throw new Error(`Position ${index + 1} abbreviation is invalid.`);
    const label = text(rule?.label || id, `Position ${id} label`, 30);
    const minimum = integer(rule?.minimum, `${id} minimum`, 0, rosterMaximum);
    const maximumInput = rule?.maximum;
    const maximum = maximumInput == null || String(maximumInput).trim() === ""
      ? null
      : integer(maximumInput, `${id} maximum`, minimum, rosterMaximum);
    return { id, label, minimum, maximum };
  });
  if (new Set(positionRules.map((rule) => rule.id)).size !== positionRules.length) throw new Error("Position abbreviations must be unique.");
  const minimumByPosition = positionRules.reduce((sum, rule) => sum + rule.minimum, 0);
  const maximumByPosition = positionRules.reduce((sum, rule) => sum + positionMaximum(rule, rosterMaximum), 0);
  if (minimumByPosition > rosterMaximum) throw new Error("Position minimums require more players than the roster maximum allows.");
  if (maximumByPosition < rosterMinimum) throw new Error("Position maximums cannot accommodate the roster minimum.");

  if (!Array.isArray(input.teams) || input.teams.length < 2 || input.teams.length > 20) throw new Error("Add between two and twenty teams.");
  const teams = input.teams.map((team, index) => ({
    id: safeId(team?.id || `team-${index + 1}`, `Team ${index + 1} id`),
    name: text(team?.name, `Team ${index + 1} name`, 60),
    enteredPool: integer(team?.enteredPool, `${team?.name || `Team ${index + 1}`} salary pool`, 1, 1_000_000),
  }));
  if (new Set(teams.map((team) => team.id)).size !== teams.length) throw new Error("Team ids must be unique.");
  if (new Set(teams.map((team) => team.name.toLowerCase())).size !== teams.length) throw new Error("Team names must be unique.");

  const teamIds = new Set(teams.map((team) => team.id));
  const positionIds = new Set(positionRules.map((rule) => rule.id));
  const keepers = input.keepersEnabled === false ? [] : (Array.isArray(input.keepers) ? input.keepers : []).map((keeper, index) => {
    const player = normalizePlayer(keeper?.player, `Keeper ${index + 1}`);
    if (!positionIds.has(player.position)) throw new Error(`${player.name} uses a position that is not in the roster rules.`);
    const teamId = safeId(keeper?.teamId, `${player.name} fantasy team`);
    if (!teamIds.has(teamId)) throw new Error(`${player.name} is assigned to an unknown fantasy team.`);
    return {
      id: safeId(keeper?.id || `keeper-${index + 1}`, `${player.name} keeper id`),
      player,
      teamId,
      salary: integer(keeper?.salary, `${player.name} keeper salary`, 0, 1_000_000),
    };
  });
  if (new Set(keepers.map((keeper) => playerIdentity(keeper.player))).size !== keepers.length) throw new Error("A player cannot be kept by more than one team.");

  const keeperSalaryByTeam = Object.fromEntries(teams.map((team) => [team.id, 0]));
  for (const keeper of keepers) keeperSalaryByTeam[keeper.teamId] += keeper.salary;
  const normalizedTeams = teams.map((team) => ({
    ...team,
    auctionBudget: budgetMode === "pre-keeper" ? team.enteredPool - keeperSalaryByTeam[team.id] : team.enteredPool,
  }));
  for (const team of normalizedTeams) {
    if (team.auctionBudget < 0) throw new Error(`${team.name}'s keeper salaries exceed its starting pool.`);
  }

  const nominationOrder = Array.isArray(input.nominationOrder) && input.nominationOrder.length
    ? input.nominationOrder.map((teamId) => safeId(teamId, "Nomination team"))
    : normalizedTeams.map((team) => team.id);
  if (nominationOrder.length !== normalizedTeams.length || new Set(nominationOrder).size !== normalizedTeams.length || nominationOrder.some((id) => !teamIds.has(id))) {
    throw new Error("Nomination order must contain every team exactly once.");
  }

  const config = {
    schemaVersion: DRAFT_DAY_SCHEMA_VERSION,
    leagueName,
    season,
    minimumBid,
    bidIncrement,
    rosterMinimum,
    rosterMaximum,
    budgetMode,
    nominationMode,
    positionRules,
    teams: normalizedTeams,
    keepers,
    nominationOrder,
  };
  validateInitialAffordability(config);
  return config;
}

function positionCounts(assignments, teamId) {
  const counts = {};
  for (const assignment of assignments) {
    if (assignment.status !== "active" || assignment.teamId !== teamId) continue;
    counts[assignment.position] = (counts[assignment.position] || 0) + 1;
  }
  return counts;
}

function requiredAdditionalSlots(config, assignments, teamId) {
  const active = assignments.filter((assignment) => assignment.status === "active" && assignment.teamId === teamId);
  const counts = positionCounts(assignments, teamId);
  const positionDeficits = config.positionRules.reduce((sum, rule) => sum + Math.max(0, rule.minimum - (counts[rule.id] || 0)), 0);
  return Math.max(0, config.rosterMinimum - active.length, positionDeficits);
}

function keeperAssignments(config, createdAt) {
  return config.keepers.map((keeper) => ({
    id: keeper.id,
    playerId: keeper.player.id,
    playerName: keeper.player.name,
    position: keeper.player.position,
    nflTeam: keeper.player.nflTeam,
    teamId: keeper.teamId,
    price: keeper.salary,
    acquisitionType: "keeper",
    status: "active",
    createdAt,
    updatedAt: createdAt,
  }));
}

function validateInitialAffordability(config) {
  const assignments = keeperAssignments(config, new Date(0).toISOString());
  for (const team of config.teams) {
    const roster = assignments.filter((assignment) => assignment.teamId === team.id);
    if (roster.length > config.rosterMaximum) throw new Error(`${team.name} has more keepers than its roster maximum.`);
    const counts = positionCounts(assignments, team.id);
    for (const rule of config.positionRules) {
      if ((counts[rule.id] || 0) > positionMaximum(rule, config.rosterMaximum)) throw new Error(`${team.name} has too many ${rule.label} keepers.`);
    }
    const reserve = requiredAdditionalSlots(config, assignments, team.id) * config.minimumBid;
    if (team.auctionBudget < reserve) throw new Error(`${team.name} needs at least $${reserve} to complete its minimum roster after keepers.`);
  }
}

export function normalizeDraftDayEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Draft event is invalid.");
  const type = text(value.type, "Draft event type", 40);
  if (!EVENT_TYPES.has(type)) throw new Error("Draft event type is not supported.");
  const event = {
    id: safeId(value.id, "Draft event id"),
    type,
    createdAt: new Date(value.createdAt).toISOString(),
    actor: optionalText(value.actor || "Auctioneer", 40) || "Auctioneer",
  };
  if (type === "SALE_RECORDED") {
    event.player = normalizePlayer(value.player);
    event.teamId = safeId(value.teamId, "Buying team");
    event.price = integer(value.price, "Winning price", 1, 1_000_000);
    event.nominatorTeamId = value.nominatorTeamId ? safeId(value.nominatorTeamId, "Nominator") : null;
  } else if (type === "SALE_CORRECTED") {
    event.targetId = safeId(value.targetId, "Corrected sale");
    event.player = normalizePlayer(value.player);
    event.teamId = safeId(value.teamId, "Buying team");
    event.price = integer(value.price, "Winning price", 1, 1_000_000);
  } else if (type === "SALE_VOIDED" || type === "SALE_RESTORED") {
    event.targetId = safeId(value.targetId, "Sale");
  } else if (type === "CUSTOM_PLAYER_ADDED") {
    event.player = normalizePlayer(value.player);
  } else if (type === "DRAFT_STATUS_CHANGED") {
    if (!["live", "complete"].includes(value.status)) throw new Error("Draft status is invalid.");
    event.status = value.status;
  }
  return event;
}

export function validateLeagueDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored league is invalid.");
  const leagueCode = normalizeLeagueCode(value.leagueCode);
  const revision = integer(value.revision, "League revision", 0, Number.MAX_SAFE_INTEGER);
  const nominationStep = integer(value.nominationStep ?? 0, "Nomination step", 0, Number.MAX_SAFE_INTEGER);
  const createdAt = new Date(value.createdAt).toISOString();
  const updatedAt = new Date(value.updatedAt).toISOString();
  const config = normalizeLeagueConfig({ ...value.config, keepersEnabled: true });
  const events = Array.isArray(value.events) ? value.events.map(normalizeDraftDayEvent) : [];
  if (events.length > 10_000) throw new Error("Draft event history is too large.");
  if (new Set(events.map((event) => event.id)).size !== events.length) throw new Error("Draft event ids must be unique.");
  const completedIdempotencyKeys = Array.isArray(value.completedIdempotencyKeys)
    ? value.completedIdempotencyKeys.map((key) => text(key, "Idempotency key", 100)).slice(-2_000)
    : [];
  const access = value.access && typeof value.access === "object" ? value.access : null;
  if (!access?.admin || !access?.auctioneer || !access?.board) throw new Error("League access configuration is missing.");
  const document = { schemaVersion: DRAFT_DAY_SCHEMA_VERSION, leagueCode, revision, nominationStep, createdAt, updatedAt, config, events, completedIdempotencyKeys, access };
  snapshotFromDocument(document);
  return document;
}

function applyEvents(document) {
  const assignments = new Map(keeperAssignments(document.config, document.createdAt).map((assignment) => [assignment.id, assignment]));
  const customPlayers = new Map(document.config.keepers.map((keeper) => [keeper.player.id, keeper.player]));
  let draftStatus = "live";
  for (const event of document.events) {
    if (event.type === "SALE_RECORDED") {
      assignments.set(event.id, {
        id: event.id,
        playerId: event.player.id,
        playerName: event.player.name,
        position: event.player.position,
        nflTeam: event.player.nflTeam,
        teamId: event.teamId,
        price: event.price,
        acquisitionType: "auction",
        status: "active",
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      });
    } else if (event.type === "SALE_CORRECTED") {
      const target = assignments.get(event.targetId);
      if (!target || target.acquisitionType !== "auction") throw new Error("A correction targets an unknown auction sale.");
      assignments.set(event.targetId, {
        ...target,
        playerId: event.player.id,
        playerName: event.player.name,
        position: event.player.position,
        nflTeam: event.player.nflTeam,
        teamId: event.teamId,
        price: event.price,
        status: "active",
        updatedAt: event.createdAt,
      });
    } else if (event.type === "SALE_VOIDED") {
      const target = assignments.get(event.targetId);
      if (!target || target.acquisitionType !== "auction") throw new Error("An undo targets an unknown auction sale.");
      assignments.set(event.targetId, { ...target, status: "voided", updatedAt: event.createdAt });
    } else if (event.type === "SALE_RESTORED") {
      const target = assignments.get(event.targetId);
      if (!target || target.acquisitionType !== "auction") throw new Error("A restore targets an unknown auction sale.");
      assignments.set(event.targetId, { ...target, status: "active", updatedAt: event.createdAt });
    } else if (event.type === "CUSTOM_PLAYER_ADDED") {
      customPlayers.set(event.player.id, event.player);
    } else if (event.type === "DRAFT_STATUS_CHANGED") {
      draftStatus = event.status;
    }
  }
  return { assignments: [...assignments.values()], customPlayers: [...customPlayers.values()], draftStatus };
}

function nextNominator(config, nominationStep) {
  if (config.nominationMode === "manual" || !config.nominationOrder.length) return null;
  const length = config.nominationOrder.length;
  if (config.nominationMode === "linear") return config.nominationOrder[nominationStep % length];
  const cycle = Math.floor(nominationStep / length);
  const index = nominationStep % length;
  return cycle % 2 === 0 ? config.nominationOrder[index] : config.nominationOrder[length - 1 - index];
}

function teamState(config, assignments, team) {
  const active = assignments.filter((assignment) => assignment.status === "active" && assignment.teamId === team.id);
  const auctionSpend = active.filter((assignment) => assignment.acquisitionType === "auction").reduce((sum, assignment) => sum + assignment.price, 0);
  const keeperSpend = active.filter((assignment) => assignment.acquisitionType === "keeper").reduce((sum, assignment) => sum + assignment.price, 0);
  const remainingBudget = team.auctionBudget - auctionSpend;
  const counts = positionCounts(active, team.id);
  const requiredSlots = requiredAdditionalSlots(config, active, team.id);
  const legalMaxBid = Math.max(0, remainingBudget - Math.max(0, requiredSlots - 1) * config.minimumBid);
  const minimumsMet = config.positionRules.every((rule) => (counts[rule.id] || 0) >= rule.minimum);
  return {
    id: team.id,
    name: team.name,
    enteredPool: team.enteredPool,
    auctionBudget: team.auctionBudget,
    remainingBudget,
    auctionSpend,
    keeperSpend,
    rosterCount: active.length,
    openSlots: Math.max(0, config.rosterMaximum - active.length),
    requiredSlots,
    legalMaxBid: active.length >= config.rosterMaximum ? 0 : legalMaxBid,
    positionCounts: counts,
    canFinish: active.length >= config.rosterMinimum && minimumsMet && remainingBudget >= 0,
  };
}

function validateActiveState(config, assignments) {
  const active = assignments.filter((assignment) => assignment.status === "active");
  const identities = active.map((assignment) => playerIdentity({ id: assignment.playerId, name: assignment.playerName, position: assignment.position }));
  if (new Set(identities).size !== identities.length) throw new Error("A player cannot appear on two active rosters.");
  const nameIdentities = active.map((assignment) => playerNameIdentity({ name: assignment.playerName, position: assignment.position }));
  if (new Set(nameIdentities).size !== nameIdentities.length) throw new Error("A player cannot appear on two active rosters under different ids.");
  const positionRules = new Map(config.positionRules.map((rule) => [rule.id, rule]));
  const teamIds = new Set(config.teams.map((team) => team.id));
  for (const assignment of active) {
    if (!teamIds.has(assignment.teamId)) throw new Error("An assignment uses an unknown team.");
    if (!positionRules.has(assignment.position)) throw new Error(`${assignment.playerName} uses a position outside the league rules.`);
    if (assignment.acquisitionType === "auction") {
      if (assignment.price < config.minimumBid || (assignment.price - config.minimumBid) % config.bidIncrement !== 0) {
        throw new Error(`${assignment.playerName}'s price does not follow the league bid rules.`);
      }
    }
  }
  for (const team of config.teams) {
    const state = teamState(config, assignments, team);
    if (state.rosterCount > config.rosterMaximum) throw new Error(`${team.name} is already at its roster maximum.`);
    if (state.remainingBudget < 0) throw new Error(`${team.name} does not have enough money.`);
    for (const rule of config.positionRules) {
      if ((state.positionCounts[rule.id] || 0) > positionMaximum(rule, config.rosterMaximum)) throw new Error(`${team.name} is already at its ${rule.label} maximum.`);
    }
    if (state.remainingBudget < state.requiredSlots * config.minimumBid) {
      throw new Error(`${team.name} must reserve $${state.requiredSlots * config.minimumBid} to complete a legal roster.`);
    }
  }
}

export function snapshotFromDocument(documentValue) {
  const document = documentValue.config ? documentValue : validateLeagueDocument(documentValue);
  const { assignments, customPlayers, draftStatus } = applyEvents(document);
  validateActiveState(document.config, assignments);
  return {
    schemaVersion: DRAFT_DAY_SCHEMA_VERSION,
    leagueCode: document.leagueCode,
    revision: document.revision,
    updatedAt: document.updatedAt,
    draftStatus,
    nominationStep: document.nominationStep,
    currentNominatorTeamId: nextNominator(document.config, document.nominationStep),
    config: document.config,
    teams: document.config.teams.map((team) => teamState(document.config, assignments, team)),
    assignments,
    customPlayers,
    events: document.events.map((event) => ({ ...event })),
  };
}

export function publicSnapshot(snapshot) {
  return {
    schemaVersion: DRAFT_DAY_SCHEMA_VERSION,
    leagueCode: snapshot.leagueCode,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    draftStatus: snapshot.draftStatus,
    currentNominatorTeamId: snapshot.currentNominatorTeamId,
    config: {
      leagueName: snapshot.config.leagueName,
      season: snapshot.config.season,
      minimumBid: snapshot.config.minimumBid,
      rosterMinimum: snapshot.config.rosterMinimum,
      rosterMaximum: snapshot.config.rosterMaximum,
      positionRules: snapshot.config.positionRules,
      teams: snapshot.config.teams.map(({ id, name }) => ({ id, name })),
    },
    teams: snapshot.teams,
    assignments: snapshot.assignments.filter((assignment) => assignment.status === "active"),
  };
}

export function saleLegality(snapshot, input) {
  try {
    const player = normalizePlayer(input?.player);
    const teamId = safeId(input?.teamId, "Buying team");
    const price = integer(input?.price, "Winning price", 1, 1_000_000);
    const team = snapshot.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new Error("Choose a buying team.");
    if (snapshot.draftStatus === "complete") throw new Error("Reopen the draft before recording another sale.");
    if (snapshot.assignments.some((assignment) => assignment.status === "active" && samePlayer({ id: assignment.playerId, name: assignment.playerName, position: assignment.position }, player))) {
      throw new Error(`${player.name} is already assigned.`);
    }
    const rule = snapshot.config.positionRules.find((candidate) => candidate.id === player.position);
    if (!rule) throw new Error(`${player.position} is not a configured roster position.`);
    if (team.rosterCount >= snapshot.config.rosterMaximum) throw new Error(`${team.name} is at its roster maximum.`);
    if ((team.positionCounts[player.position] || 0) >= positionMaximum(rule, snapshot.config.rosterMaximum)) throw new Error(`${team.name} is at its ${rule.label} maximum.`);
    if (price < snapshot.config.minimumBid) throw new Error(`The minimum bid is $${snapshot.config.minimumBid}.`);
    if ((price - snapshot.config.minimumBid) % snapshot.config.bidIncrement !== 0) throw new Error(`Prices must follow the $${snapshot.config.bidIncrement} bid increment.`);
    const activeForTeam = snapshot.assignments.filter((assignment) => assignment.status === "active" && assignment.teamId === teamId);
    const candidate = {
      id: "candidate-sale",
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      teamId,
      price,
      acquisitionType: "auction",
      status: "active",
    };
    const candidateAssignments = [...snapshot.assignments.filter((assignment) => assignment.status === "active"), candidate];
    const configTeam = snapshot.config.teams.find((value) => value.id === teamId);
    const after = teamState(snapshot.config, candidateAssignments, configTeam);
    const candidateLegalMax = Math.max(0, team.remainingBudget - after.requiredSlots * snapshot.config.minimumBid);
    if (price > candidateLegalMax || after.remainingBudget < after.requiredSlots * snapshot.config.minimumBid) {
      throw new Error(`${team.name} can bid at most $${candidateLegalMax} on this player and still complete a legal roster.`);
    }
    return { legal: true, player, team, price, after, legalMaxBid: candidateLegalMax, activeForTeam };
  } catch (error) {
    const team = snapshot?.teams?.find((candidate) => candidate.id === input?.teamId);
    return { legal: false, message: error.message, legalMaxBid: team?.legalMaxBid ?? 0 };
  }
}

export function applyCommand(documentValue, input, options = {}) {
  const document = validateLeagueDocument(documentValue);
  const type = text(input?.type, "Command type", 40);
  const idempotencyKey = text(input?.idempotencyKey, "Idempotency key", 100);
  if (document.completedIdempotencyKeys.includes(idempotencyKey)) return document;
  if (!Number.isInteger(input?.expectedRevision) || input.expectedRevision !== document.revision) {
    const error = new Error("Another auction action was saved first. Refresh and retry.");
    error.code = "REVISION_CONFLICT";
    error.status = 409;
    throw error;
  }
  const now = options.now || new Date().toISOString();
  const actor = options.actor || "Auctioneer";
  let config = document.config;
  let nominationStep = document.nominationStep;
  let events = [...document.events];
  const before = snapshotFromDocument(document);

  if (type === "record-sale") {
    const legality = saleLegality(before, input);
    if (!legality.legal) throw new Error(legality.message);
    const event = normalizeDraftDayEvent({
      id: input.eventId || `sale-${crypto.randomUUID()}`,
      type: "SALE_RECORDED",
      createdAt: now,
      actor,
      player: legality.player,
      teamId: legality.team.id,
      price: legality.price,
      nominatorTeamId: before.currentNominatorTeamId,
    });
    events.push(event);
    nominationStep += 1;
  } else if (type === "correct-sale") {
    const targetId = safeId(input.targetId, "Corrected sale");
    const target = before.assignments.find((assignment) => assignment.id === targetId && assignment.acquisitionType === "auction");
    if (!target || target.status !== "active") throw new Error("Choose an active auction sale to correct.");
    const event = normalizeDraftDayEvent({ id: input.eventId || `correction-${crypto.randomUUID()}`, type: "SALE_CORRECTED", targetId, player: input.player, teamId: input.teamId, price: input.price, createdAt: now, actor });
    events.push(event);
  } else if (type === "void-sale" || type === "restore-sale") {
    const targetId = safeId(input.targetId, "Sale");
    const target = before.assignments.find((assignment) => assignment.id === targetId && assignment.acquisitionType === "auction");
    if (!target) throw new Error("That auction sale does not exist.");
    if (type === "void-sale" && target.status !== "active") throw new Error("That sale is already undone.");
    if (type === "restore-sale" && target.status === "active") throw new Error("That sale is already active.");
    events.push(normalizeDraftDayEvent({ id: input.eventId || `${type}-${crypto.randomUUID()}`, type: type === "void-sale" ? "SALE_VOIDED" : "SALE_RESTORED", targetId, createdAt: now, actor }));
  } else if (type === "add-player") {
    const player = normalizePlayer(input.player);
    if (before.customPlayers.some((candidate) => candidate.id === player.id)) throw new Error("That custom player already exists.");
    events.push(normalizeDraftDayEvent({ id: input.eventId || `player-${crypto.randomUUID()}`, type: "CUSTOM_PLAYER_ADDED", player, createdAt: now, actor }));
  } else if (type === "finish-draft" || type === "reopen-draft") {
    if (type === "finish-draft") {
      const incomplete = before.teams.filter((team) => !team.canFinish);
      if (incomplete.length) throw new Error(`These teams do not yet meet their roster minimums: ${incomplete.map((team) => team.name).join(", ")}.`);
    }
    events.push(normalizeDraftDayEvent({ id: input.eventId || `status-${crypto.randomUUID()}`, type: "DRAFT_STATUS_CHANGED", status: type === "finish-draft" ? "complete" : "live", createdAt: now, actor }));
  } else if (type === "replace-setup") {
    if (options.role !== "admin") throw new Error("Only the organizer can change league setup.");
    if (before.assignments.some((assignment) => assignment.acquisitionType === "auction")) throw new Error("League setup is locked after the first auction sale.");
    config = normalizeLeagueConfig(input.config);
    events = events.filter((event) => ["CUSTOM_PLAYER_ADDED"].includes(event.type));
    nominationStep = 0;
  } else {
    throw new Error("That draft command is not supported.");
  }

  const next = {
    ...document,
    config,
    events,
    nominationStep,
    revision: document.revision + 1,
    updatedAt: now,
    completedIdempotencyKeys: [...document.completedIdempotencyKeys, idempotencyKey].slice(-2_000),
  };
  snapshotFromDocument(next);
  return next;
}

export function optimisticSnapshot(snapshotValue, input) {
  const document = {
    schemaVersion: DRAFT_DAY_SCHEMA_VERSION,
    leagueCode: snapshotValue.leagueCode,
    revision: snapshotValue.revision,
    nominationStep: snapshotValue.nominationStep || 0,
    createdAt: snapshotValue.createdAt || snapshotValue.updatedAt,
    updatedAt: snapshotValue.updatedAt,
    config: snapshotValue.config,
    events: snapshotValue.events || [],
    completedIdempotencyKeys: [],
    access: { admin: { salt: "local", hash: "local" }, auctioneer: { salt: "local", hash: "local" }, board: { salt: "local", hash: "local" } },
  };
  const next = applyCommand(document, { ...input, expectedRevision: document.revision }, { now: new Date().toISOString(), actor: "Auctioneer (pending)", role: "admin" });
  const result = snapshotFromDocument(next);
  result.revision = snapshotValue.revision;
  result.pending = true;
  return result;
}

export function draftCsv(snapshot) {
  const rows = [["League", "Season", "Player", "Position", "NFL Team", "Fantasy Team", "Price", "Type", "Status", "Recorded"]];
  for (const assignment of snapshot.assignments) {
    const team = snapshot.config.teams.find((candidate) => candidate.id === assignment.teamId);
    rows.push([snapshot.config.leagueName, snapshot.config.season, assignment.playerName, assignment.position, assignment.nflTeam, team?.name || assignment.teamId, assignment.price, assignment.acquisitionType, assignment.status, assignment.createdAt]);
  }
  const escape = (value) => {
    let string = String(value ?? "");
    if (/^[=+\-@]/.test(string)) string = `'${string}`;
    return `"${string.replaceAll('"', '""')}"`;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\r\n");
}
