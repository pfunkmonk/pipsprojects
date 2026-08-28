import { evaluateDraftCompletion } from "../../../public/thunder-bowl/shared/public-core.mjs";
import { snakeTeamId } from "../../../public/thunder-bowl/shared/nomination-order.mjs";

const ACQUISITION_TYPES = new Set(["KEEPER_ASSIGNED", "PLAYER_SOLD"]);
const CLOCK_DURATIONS = new Set([120_000, 90_000, 60_000, 45_000, 30_000]);
const DEFAULT_CLOCK = Object.freeze({ status: "paused", durationMs: 120_000, remainingMs: 120_000, deadline: null });
const STANDARD_STARTING_CAP = 100;
const PRE_AUCTION_BONUS_LABELS = new Map([
  [6, "1st Place Loser's Bracket"],
  [4, "2nd Place Loser's Bracket"],
  [2, "3rd Place Loser's Bracket"],
]);

function requireInteger(value, label, minimum = 1) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) throw new Error(`${label} must be a whole number of at least ${minimum}.`);
  return number;
}

function requireText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    nflTeam: player.nflTeam,
    byeWeek: Number.isInteger(player?.weeklyProjection?.byeWeek)
      ? player.weeklyProjection.byeWeek
      : (Number.isInteger(player?.byeWeek) ? player.byeWeek : null),
  };
}

function voidedEventIds(events, eventTypes) {
  return new Set(events.filter((event) => event.type === eventTypes.EVENT_VOIDED).map((event) => event.payload.targetEventId));
}

function activeConfiguration(events, stateEngine) {
  const state = stateEngine.replayDraft(events);
  return { state, config: state.config };
}

function orderedTeams(config, state, salaryLedgers) {
  return config.nominationOrder.map((teamId) => {
    const configured = config.teams.find((team) => team.id === teamId);
    const live = state.teams[teamId];
    return {
      id: configured.id,
      name: configured.name,
      startingCap: live.startingCap,
      capAdjustment: 0,
      salaryLedger: salaryLedgers[teamId] || [],
      ...(configured.logoUrl ? { logoUrl: configured.logoUrl } : {}),
    };
  });
}

function appendSalaryLedgerEntry(ledgers, teamId, entry) {
  const ledger = ledgers[teamId];
  if (!ledger) throw new Error(`Salary ledger references unknown team '${teamId}'.`);
  const priorBalance = ledger.at(-1)?.balance ?? 0;
  ledger.push({ ...entry, balance: priorBalance + entry.delta });
}

function teamNameById(config, teamId) {
  return config.teams.find((team) => team.id === teamId)?.name || teamId;
}

function tradeAssetLabel(players = []) {
  const names = players.map((player) => player.playerName).filter(Boolean);
  if (!names.length) return "keeper rights";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function transactionReason(reason) {
  const text = String(reason || "").trim();
  if (!text) return "";
  return /^for\b/i.test(text) ? ` ${text}` : ` for ${text}`;
}

export function buildSalaryLedgers({ events, eventTypes, config, state }) {
  const ledgers = Object.fromEntries(config.teams.map((team) => [team.id, [{
    id: `opening:${team.id}`,
    kind: "opening",
    label: "Starting salary cap",
    delta: STANDARD_STARTING_CAP,
    balance: STANDARD_STARTING_CAP,
  }]]));

  for (const team of config.teams) {
    const adjustment = team.startingCap - STANDARD_STARTING_CAP;
    if (!adjustment) continue;
    appendSalaryLedgerEntry(ledgers, team.id, {
      id: `pre-auction:${team.id}`,
      kind: adjustment > 0 ? "bonus" : "adjustment",
      label: PRE_AUCTION_BONUS_LABELS.get(adjustment) || "Pre-auction cap adjustment",
      delta: adjustment,
    });
  }

  const voided = voidedEventIds(events, eventTypes);
  const operationalEvents = events.filter((event) => event.type !== eventTypes.EVENT_VOIDED && !voided.has(event.id));
  for (const event of operationalEvents) {
    if (event.type === eventTypes.CAP_TRANSFERRED) {
      const fromName = teamNameById(config, event.payload.fromTeamId);
      const toName = teamNameById(config, event.payload.toTeamId);
      const reason = transactionReason(event.payload.reason);
      appendSalaryLedgerEntry(ledgers, event.payload.fromTeamId, {
        id: `${event.id}:out`, kind: "trade", label: `To ${toName}${reason}`, delta: -event.payload.amount,
      });
      appendSalaryLedgerEntry(ledgers, event.payload.toTeamId, {
        id: `${event.id}:in`, kind: "trade", label: `From ${fromName}${reason}`, delta: event.payload.amount,
      });
      continue;
    }
    if (event.type === eventTypes.KEEPER_RIGHTS_TRADED && event.payload.amountFromAToB > 0) {
      const teamAName = teamNameById(config, event.payload.teamAId);
      const teamBName = teamNameById(config, event.payload.teamBId);
      const asset = tradeAssetLabel(event.payload.teamBSends);
      appendSalaryLedgerEntry(ledgers, event.payload.teamAId, {
        id: `${event.id}:out`, kind: "trade", label: `To ${teamBName} for ${asset}`, delta: -event.payload.amountFromAToB,
      });
      appendSalaryLedgerEntry(ledgers, event.payload.teamBId, {
        id: `${event.id}:in`, kind: "trade", label: `From ${teamAName} for ${asset}`, delta: event.payload.amountFromAToB,
      });
      continue;
    }
    if (event.type === eventTypes.KEEPER_ASSIGNED) {
      appendSalaryLedgerEntry(ledgers, event.payload.teamId, {
        id: event.id, kind: "keeper", label: `Keep ${event.payload.playerName}`, delta: -event.payload.salary,
      });
      continue;
    }
    if (event.type === eventTypes.PLAYER_SOLD) {
      appendSalaryLedgerEntry(ledgers, event.payload.teamId, {
        id: event.id, kind: "auction", label: `Draft ${event.payload.playerName}`, delta: -event.payload.amount,
      });
    }
  }

  for (const team of config.teams) {
    const ledgerBalance = ledgers[team.id].at(-1)?.balance;
    const authoritativeCash = state.teams[team.id]?.cash;
    if (Number.isInteger(authoritativeCash) && ledgerBalance !== authoritativeCash) {
      throw new Error(`${team.name}'s public salary ledger does not reconcile to its authoritative cash balance.`);
    }
  }
  return ledgers;
}

function liveClock(clock, now = Date.now()) {
  const source = clock || DEFAULT_CLOCK;
  const remainingMs = source.status === "running" ? Math.max(0, source.deadline - now) : source.remainingMs;
  return { ...source, remainingMs, serverNow: now };
}

function operationalState(context) {
  const finishedTeamIds = new Set();
  let stagedNomination = null;
  let clock = { ...DEFAULT_CLOCK };
  for (const event of context.operationalEvents || []) {
    if (event.type === "TEAM_FINISHED") finishedTeamIds.add(event.teamId);
    if (event.type === "TEAM_REOPENED") finishedTeamIds.delete(event.teamId);
    if (event.type === "NOMINATION_STAGED") stagedNomination = event.player;
    if (event.type === "NOMINATION_CLEARED") stagedNomination = null;
    if (event.type === "CLOCK_UPDATED") clock = event.clock;
  }
  return { finishedTeamIds, stagedNomination, clock: liveClock(clock) };
}

function nominatorFromStep(state, finishedTeamIds, startStep) {
  for (let step = startStep; step < startStep + state.config.nominationOrder.length * 3; step += 1) {
    const teamId = snakeTeamId(state.config.nominationOrder, step);
    if (!finishedTeamIds.has(teamId) && state.teams[teamId]?.roster.length < state.config.rosterSize) return { teamId, step };
  }
  return { teamId: null, step: startStep };
}

function operation(type, fields = {}, actorLabel = "Auctioneer") {
  return { id: globalThis.crypto?.randomUUID?.() || `operation-${Date.now()}-${Math.random()}`, type, ...fields, createdAt: new Date().toISOString(), actorLabel };
}

function assignmentFromEvent(event, status, actorLabel = null, draftPlayer = null) {
  const keeper = event.type === "KEEPER_ASSIGNED";
  const player = draftPlayer ? publicPlayer(draftPlayer) : null;
  return {
    id: event.id,
    playerId: event.payload.playerId,
    playerName: event.payload.playerName,
    position: event.payload.position,
    nflTeam: event.payload.nflTeam,
    byeWeek: Number.isInteger(event.payload.byeWeek) ? event.payload.byeWeek : player?.byeWeek ?? null,
    teamId: event.payload.teamId,
    price: keeper ? event.payload.salary : event.payload.amount,
    acquisitionType: keeper ? "keeper" : "auction",
    contractYear: keeper ? event.payload.keeperYear : null,
    status,
    createdAt: event.createdAt,
    updatedAt: event.serverReceivedAt || event.createdAt,
    actorLabel: actorLabel || (String(event.deviceId).startsWith("auctioneer") ? "Auctioneer" : "Command center"),
  };
}

function insertAfterEvent(events, targetId, insertedEvent) {
  const next = [...events];
  const index = next.findIndex((event) => event.id === targetId);
  if (index < 0) throw new Error("The target assignment is no longer in the native ledger.");
  next.splice(index + 1, 0, insertedEvent);
  return next;
}

function playerForCommand(draftPack, playerId) {
  const player = draftPack.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("That player is not present in the current draft pack.");
  return publicPlayer(player);
}

function targetAcquisition(events, assignmentId, eventTypes) {
  const target = events.find((event) => event.id === assignmentId);
  if (!target || !ACQUISITION_TYPES.has(target.type)) throw new Error("That assignment does not exist.");
  const voided = voidedEventIds(events, eventTypes);
  return { target, isVoided: voided.has(target.id) };
}

function voidReason(action, targetId) {
  return `Auctioneer ${action} ${targetId}`.slice(0, 120);
}

function commandAlreadyCompleted(context, idempotencyKey) {
  const completed = context.completedIdempotencyKeys;
  if (Array.isArray(completed)) return completed.includes(idempotencyKey);
  if (completed instanceof Set) return completed.has(idempotencyKey);
  return Boolean(completed && typeof completed === "object" && completed[idempotencyKey]);
}

export function createNativeLedgerService({ adapter, stateEngine, deviceId = "auctioneer-console" }) {
  if (!adapter?.load || !adapter?.commitCanonical) throw new Error("The native ledger adapter requires load and commitCanonical functions.");
  if (!stateEngine?.replayDraft || !stateEngine?.createEvent || !stateEngine?.EVENT_TYPES) throw new Error("The Thunder Bowl state engine is required.");
  const eventTypes = stateEngine.EVENT_TYPES;

  async function loadContext() {
    const context = await adapter.load();
    if (!Array.isArray(context?.events) || !context?.draftPack || !Number.isInteger(context.generation)) throw new Error("The ledger adapter returned an invalid context.");
    stateEngine.replayDraft(context.events);
    return context;
  }

  function snapshotFromContext(context) {
    const { state, config } = activeConfiguration(context.events, stateEngine);
    const voided = voidedEventIds(context.events, eventTypes);
    const salaryLedgers = buildSalaryLedgers({ events: context.events, eventTypes, config, state });
    const operations = operationalState(context);
    const current = nominatorFromStep(state, operations.finishedTeamIds, state.nominationStep);
    const next = current.teamId ? nominatorFromStep(state, operations.finishedTeamIds, current.step + 1) : { teamId: null };
    return {
      season: config.season,
      revision: context.generation,
      updatedAt: context.updatedAt || state.updatedAt || new Date().toISOString(),
      rosterSize: config.rosterSize,
      minimumRosterSize: config.minimumRosterSize ?? (Object.values(config.starterRequirements || {}).reduce((sum, count) => sum + Number(count || 0), 0) || config.rosterSize),
      keeperSlots: 2,
      keepersFinalized: Boolean(state.keeperFinalization),
      keeperFinalizedAt: state.keeperFinalization?.finalizedAt || null,
      starterRequirements: { ...config.starterRequirements },
      currentNominatorTeamId: current.teamId,
      nextNominatorTeamId: next.teamId,
      finishedTeamIds: [...operations.finishedTeamIds],
      stagedNomination: operations.stagedNomination,
      clock: operations.clock,
      auditEvents: (context.operationalEvents || []).filter((event) => !["NOMINATION_CLEARED", "CLOCK_UPDATED"].includes(event.type)).map((event) => ({ id: event.id, action: event.type === "TEAM_FINISHED" ? "Marked team finished" : event.type === "TEAM_REOPENED" ? (event.actorLabel === "System" ? "Automatically reopened after correction" : "Reopened team") : "Nominated", teamId: event.teamId || null, playerName: event.player?.name || null, createdAt: event.createdAt, actorLabel: event.actorLabel || "Auctioneer" })),
      teams: orderedTeams(config, state, salaryLedgers),
      availablePlayers: context.draftPack.players.map(publicPlayer),
      assignments: context.events
        .filter((event) => ACQUISITION_TYPES.has(event.type))
        .map((event) => assignmentFromEvent(
          event,
          voided.has(event.id) ? "voided" : "active",
          context.actorLabels?.[event.id],
          context.draftPack.players.find((player) => player.id === event.payload.playerId),
        )),
    };
  }

  async function snapshot() {
    return snapshotFromContext(await loadContext());
  }

  async function commit(context, nextEvents, idempotencyKey, operationalEvents = context.operationalEvents || []) {
    stateEngine.replayDraft(nextEvents);
    const committed = await adapter.commitCanonical({
      events: nextEvents,
      operationalEvents,
      expectedGeneration: context.generation,
      idempotencyKey,
      actorRole: "auctioneer",
    });
    return snapshotFromContext(committed || await loadContext());
  }

  function createReplacement(target, command, draftPack) {
    const player = playerForCommand(draftPack, requireText(command.playerId, "Player"));
    const teamId = requireText(command.teamId, "Team");
    const price = requireInteger(command.price, "Price");
    if (target.type === eventTypes.KEEPER_ASSIGNED) {
      return stateEngine.createEvent(eventTypes.KEEPER_ASSIGNED, {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        teamId,
        salary: price,
        keeperYear: requireInteger(command.contractYear, "Keeper contract year"),
        selectionRound: target.payload.selectionRound,
        source: "Auctioneer correction",
      }, { deviceId, createdAt: target.createdAt });
    }
    return stateEngine.createEvent(eventTypes.PLAYER_SOLD, {
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      teamId,
      amount: price,
      nominatorTeamId: target.payload.nominatorTeamId,
    }, { deviceId, createdAt: target.createdAt });
  }

  function assertAuctioneerMayChangeAssignment(target, context) {
    if (target.type !== eventTypes.KEEPER_ASSIGNED) return;
    const state = stateEngine.replayDraft(context.events);
    if (state.keeperFinalization) {
      const error = new Error("The final 2026 keeper set is organizer-locked. Keeper corrections must be made in the private Command Center.");
      error.code = "KEEPERS_FINALIZED";
      error.status = 403;
      throw error;
    }
  }

  async function command(input) {
    const type = requireText(input?.type, "Command type");
    const idempotencyKey = requireText(input?.idempotencyKey, "Idempotency key");
    const context = await loadContext();
    if (commandAlreadyCompleted(context, idempotencyKey)) return snapshotFromContext(context);
    let nextEvents = [...context.events];
    const nextOperationalEvents = [...(context.operationalEvents || [])];

    if (type === "record-sale") {
      let state = stateEngine.replayDraft(nextEvents);
      const finished = operationalState({ operationalEvents: nextOperationalEvents }).finishedTeamIds;
      for (let count = 0; count < state.config.nominationOrder.length * 3 && finished.has(state.currentNominatorTeamId); count += 1) {
        nextEvents.push(stateEngine.createEvent(eventTypes.NOMINATION_SKIPPED, { teamId: state.currentNominatorTeamId, reason: "Team declared finished" }, { deviceId }));
        state = stateEngine.replayDraft(nextEvents);
      }
      if (!state.currentNominatorTeamId || finished.has(state.currentNominatorTeamId)) throw new Error("Every team is marked finished. Reopen a team before recording another sale.");
      const player = playerForCommand(context.draftPack, requireText(input.playerId, "Player"));
      const event = stateEngine.createEvent(eventTypes.PLAYER_SOLD, {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        teamId: requireText(input.teamId, "Team"),
        amount: requireInteger(input.price, "Price"),
        nominatorTeamId: state.currentNominatorTeamId,
      }, { deviceId });
      nextEvents.push(event);
      nextOperationalEvents.push(operation("NOMINATION_CLEARED"));
      const durationMs = operationalState({ operationalEvents: nextOperationalEvents }).clock.durationMs;
      nextOperationalEvents.push(operation("CLOCK_UPDATED", { clock: { status: "running", durationMs, remainingMs: durationMs, deadline: Date.now() + durationMs } }));
    } else if (type === "stage-nomination") {
      const player = playerForCommand(context.draftPack, requireText(input.playerId, "Player"));
      const snapshot = snapshotFromContext(context);
      if (snapshot.assignments.some((assignment) => assignment.status === "active" && assignment.playerId === player.id)) throw new Error("Choose an available player to nominate.");
      nextOperationalEvents.push(operation("NOMINATION_STAGED", { player }));
      const currentClock = operationalState({ operationalEvents: nextOperationalEvents }).clock;
      nextOperationalEvents.push(operation("CLOCK_UPDATED", { clock: { status: "paused", durationMs: currentClock.durationMs, remainingMs: currentClock.remainingMs, deadline: null } }));
    } else if (type === "clear-nomination") {
      nextOperationalEvents.push(operation("NOMINATION_CLEARED"));
    } else if (type === "update-clock") {
      const action = requireText(input.action, "Clock action");
      const currentClock = operationalState({ operationalEvents: nextOperationalEvents }).clock;
      const now = Date.now();
      let clock;
      if (action === "pause") {
        clock = { status: "paused", durationMs: currentClock.durationMs, remainingMs: currentClock.remainingMs, deadline: null };
      } else if (action === "resume") {
        const remainingMs = currentClock.remainingMs > 0 ? currentClock.remainingMs : currentClock.durationMs;
        clock = { status: "running", durationMs: currentClock.durationMs, remainingMs, deadline: now + remainingMs };
      } else if (action === "reset") {
        clock = { status: "paused", durationMs: currentClock.durationMs, remainingMs: currentClock.durationMs, deadline: null };
      } else if (action === "set-duration") {
        const durationMs = requireInteger(input.durationMs, "Clock duration", 15_000);
        if (!CLOCK_DURATIONS.has(durationMs)) throw new Error("Choose one of the supported nomination-clock lengths.");
        clock = currentClock.status === "running"
          ? { status: "running", durationMs, remainingMs: durationMs, deadline: now + durationMs }
          : { status: "paused", durationMs, remainingMs: durationMs, deadline: null };
      } else {
        throw new Error("Unsupported nomination-clock action.");
      }
      nextOperationalEvents.push(operation("CLOCK_UPDATED", { clock }));
    } else if (type === "mark-team-finished") {
      const teamId = requireText(input.teamId, "Team");
      const snapshot = snapshotFromContext(context);
      const completion = evaluateDraftCompletion(snapshot).teams.find((team) => team.teamId === teamId);
      if (!completion?.complete) throw new Error(`${completion?.teamName || "That team"} cannot finish yet: ${completion?.problems.join("; ") || "its roster is not legal"}.`);
      nextOperationalEvents.push(operation("TEAM_FINISHED", { teamId }));
      let state = stateEngine.replayDraft(nextEvents);
      const finished = operationalState({ operationalEvents: nextOperationalEvents }).finishedTeamIds;
      for (let count = 0; count < state.config.nominationOrder.length * 3 && finished.has(state.currentNominatorTeamId); count += 1) {
        nextEvents.push(stateEngine.createEvent(eventTypes.NOMINATION_SKIPPED, { teamId: state.currentNominatorTeamId, reason: "Team declared finished" }, { deviceId }));
        state = stateEngine.replayDraft(nextEvents);
      }
    } else if (type === "reopen-team") {
      const teamId = requireText(input.teamId, "Team");
      nextOperationalEvents.push(operation("TEAM_REOPENED", { teamId }));
    } else if (type === "correct-assignment") {
      const { target, isVoided } = targetAcquisition(nextEvents, input.assignmentId, eventTypes);
      assertAuctioneerMayChangeAssignment(target, context);
      if (isVoided) throw new Error("Restore this assignment before editing it.");
      const replacement = createReplacement(target, input, context.draftPack);
      nextEvents = insertAfterEvent(nextEvents, target.id, replacement);
      nextEvents.push(stateEngine.createEvent(eventTypes.EVENT_VOIDED, { targetEventId: target.id, reason: voidReason("corrected", target.id) }, { deviceId }));
    } else if (type === "reconcile-assignments") {
      if (!Array.isArray(input.changes) || input.changes.length < 2) throw new Error("Choose at least two assignments to reconcile.");
      const targetIds = new Set();
      const corrections = input.changes.map((change) => {
        if (targetIds.has(change.assignmentId)) throw new Error("An assignment can appear only once in a reconciliation.");
        targetIds.add(change.assignmentId);
        const { target, isVoided } = targetAcquisition(nextEvents, change.assignmentId, eventTypes);
        assertAuctioneerMayChangeAssignment(target, context);
        if (isVoided) throw new Error("Every reconciled assignment must still be active.");
        return { target, replacement: createReplacement(target, change, context.draftPack) };
      });
      for (const correction of corrections) {
        nextEvents = insertAfterEvent(nextEvents, correction.target.id, correction.replacement);
      }
      for (const correction of corrections) {
        nextEvents.push(stateEngine.createEvent(eventTypes.EVENT_VOIDED, {
          targetEventId: correction.target.id,
          reason: voidReason("reconciled", correction.target.id),
        }, { deviceId }));
      }
    } else if (type === "void-assignment") {
      const { target, isVoided } = targetAcquisition(nextEvents, input.assignmentId, eventTypes);
      assertAuctioneerMayChangeAssignment(target, context);
      if (isVoided) throw new Error("That assignment is already undone.");
      const placeholder = target.type === eventTypes.PLAYER_SOLD
        ? stateEngine.createEvent(eventTypes.NOMINATION_SKIPPED, { teamId: target.payload.nominatorTeamId, reason: voidReason("voided", target.id) }, { deviceId, createdAt: target.createdAt })
        : stateEngine.createEvent(eventTypes.KEEPER_PASSED, { teamId: target.payload.teamId, round: target.payload.selectionRound, reason: voidReason("voided", target.id) }, { deviceId, createdAt: target.createdAt });
      nextEvents = insertAfterEvent(nextEvents, target.id, placeholder);
      nextEvents.push(stateEngine.createEvent(eventTypes.EVENT_VOIDED, { targetEventId: target.id, reason: voidReason("voided", target.id) }, { deviceId }));
    } else if (type === "restore-assignment") {
      const { target, isVoided } = targetAcquisition(nextEvents, input.assignmentId, eventTypes);
      assertAuctioneerMayChangeAssignment(target, context);
      if (!isVoided) throw new Error("That assignment is already active.");
      const placeholderReason = voidReason("voided", target.id);
      const placeholder = nextEvents.find((event) => event.payload?.reason === placeholderReason && [eventTypes.NOMINATION_SKIPPED, eventTypes.KEEPER_PASSED].includes(event.type));
      if (!placeholder) throw new Error("This assignment was superseded by a correction and cannot be restored independently.");
      const restored = stateEngine.createEvent(target.type, target.payload, { deviceId, createdAt: target.createdAt });
      nextEvents = insertAfterEvent(nextEvents, placeholder.id, restored);
      nextEvents.push(stateEngine.createEvent(eventTypes.EVENT_VOIDED, { targetEventId: placeholder.id, reason: voidReason("restored", target.id) }, { deviceId }));
    } else {
      throw new Error("Unsupported auctioneer command.");
    }
    const candidateContext = { ...context, events: nextEvents, operationalEvents: nextOperationalEvents };
    const completion = evaluateDraftCompletion(snapshotFromContext(candidateContext));
    const completeByTeam = new Map(completion.teams.map((team) => [team.teamId, team.complete]));
    for (const teamId of operationalState(candidateContext).finishedTeamIds) {
      if (!completeByTeam.get(teamId)) nextOperationalEvents.push(operation("TEAM_REOPENED", { teamId }, "System"));
    }
    return commit(context, nextEvents, idempotencyKey, nextOperationalEvents);
  }

  return { snapshot, command };
}
