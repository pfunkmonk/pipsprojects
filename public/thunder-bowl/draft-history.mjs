import { EVENT_TYPES, replayDraft, validateEvent } from "./state-engine.mjs?v=20260810b";

const ACTIVE_EXPORT_TYPES = new Set([
  EVENT_TYPES.CAP_TRANSFERRED,
  EVENT_TYPES.KEEPER_RIGHTS_TRADED,
  EVENT_TYPES.KEEPER_ASSIGNED,
  EVENT_TYPES.KEEPER_PASSED,
  EVENT_TYPES.PLAYER_SOLD,
  EVENT_TYPES.NOMINATION_SKIPPED,
]);

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildDraftHistoryRows({ events, pack }) {
  if (!pack || typeof pack !== "object") throw new Error("Draft history requires the active validated pack.");
  if (!Array.isArray(events)) throw new Error("Draft history requires an event array.");
  const state = replayDraft(events);
  const validated = events.map(validateEvent);
  const teamName = (teamId) => state.teams[teamId]?.name || teamId || "";
  const voided = new Set(
    validated
      .filter((event) => event.type === EVENT_TYPES.EVENT_VOIDED)
      .map((event) => event.payload.targetEventId),
  );
  const active = validated.filter(
    (event) => ACTIVE_EXPORT_TYPES.has(event.type) && !voided.has(event.id),
  );
  const keeperSlotByEventId = new Map(
    state.keeperSelection.slots
      .filter((slot) => slot.eventId)
      .map((slot) => [slot.eventId, slot]),
  );
  let saleNumber = 0;
  return active.map((event, index) => {
    const payload = event.payload;
    const slot = keeperSlotByEventId.get(event.id) || null;
    const row = {
      season: pack.season,
      packId: pack.packId,
      packAsOf: pack.asOf,
      sequence: index + 1,
      eventType: event.type,
      saleNumber: "",
      selectionRound: slot?.round || payload.round || payload.selectionRound || "",
      selectionPick: slot?.pick || "",
      teamId: "",
      teamName: "",
      otherTeamId: "",
      otherTeamName: "",
      playerId: payload.playerId || "",
      playerName: payload.playerName || "",
      position: payload.position || "",
      nflTeam: payload.nflTeam || "",
      amount: payload.amount || payload.salary || "",
      keeperYear: payload.keeperYear || "",
      nominatorTeamId: payload.nominatorTeamId || "",
      nominatorTeamName: payload.nominatorTeamId ? teamName(payload.nominatorTeamId) : "",
      openingBid: payload.openingBid || "",
      detail: payload.reason || payload.source || "",
      eventId: event.id,
      createdAt: event.createdAt,
    };
    if (event.type === EVENT_TYPES.CAP_TRANSFERRED) {
      row.teamId = payload.fromTeamId;
      row.teamName = teamName(payload.fromTeamId);
      row.otherTeamId = payload.toTeamId;
      row.otherTeamName = teamName(payload.toTeamId);
    } else if (event.type === EVENT_TYPES.KEEPER_RIGHTS_TRADED) {
      row.teamId = payload.teamAId;
      row.teamName = teamName(payload.teamAId);
      row.otherTeamId = payload.teamBId;
      row.otherTeamName = teamName(payload.teamBId);
      row.playerId = [...payload.teamASends, ...payload.teamBSends].map((player) => player.playerId).join(" / ");
      row.playerName = [
        ...payload.teamASends.map((player) => `${player.playerName} A→B`),
        ...payload.teamBSends.map((player) => `${player.playerName} B→A`),
      ].join(" / ");
      row.amount = payload.amountFromAToB;
      row.detail = "Atomic multi-player keeper-rights and cap trade";
    } else {
      row.teamId = payload.teamId;
      row.teamName = teamName(payload.teamId);
    }
    if (event.type === EVENT_TYPES.PLAYER_SOLD) {
      saleNumber += 1;
      row.saleNumber = saleNumber;
    }
    return row;
  });
}

export function draftHistoryCsv(rows) {
  if (!Array.isArray(rows)) throw new Error("Draft history CSV requires an array.");
  const columns = [
    ["Season", "season"],
    ["Pack ID", "packId"],
    ["Pack As Of", "packAsOf"],
    ["Sequence", "sequence"],
    ["Event Type", "eventType"],
    ["Sale Number", "saleNumber"],
    ["Keeper Round", "selectionRound"],
    ["Keeper Pick", "selectionPick"],
    ["Team", "teamName"],
    ["Team ID", "teamId"],
    ["Other Team", "otherTeamName"],
    ["Other Team ID", "otherTeamId"],
    ["Player", "playerName"],
    ["Player ID", "playerId"],
    ["Pos", "position"],
    ["NFL Team", "nflTeam"],
    ["Price / Amount", "amount"],
    ["Keeper Year", "keeperYear"],
    ["Nominator", "nominatorTeamName"],
    ["Nominator ID", "nominatorTeamId"],
    ["Opening Bid", "openingBid"],
    ["Reason / Source", "detail"],
    ["Event ID", "eventId"],
    ["Created At", "createdAt"],
  ];
  const body = rows.map((row) => columns.map(([, key]) => csvCell(row[key])).join(","));
  return `${columns.map(([label]) => csvCell(label)).join(",")}\r\n${body.length ? `${body.join("\r\n")}\r\n` : ""}`;
}
