import { POSITIONS } from "./state-engine.mjs?v=20260828a";

const DISPLAY_POSITIONS = Object.freeze([...POSITIONS]);

function canonicalTeam(value) {
  return ({ ARZ: "ARI", JAC: "JAX", LA: "LAR" })[String(value || "").toUpperCase()] || String(value || "").toUpperCase();
}

function canonicalPosition(value) {
  const normalized = String(value || "").toUpperCase();
  return normalized === "PK" ? "K" : normalized;
}

function normalizedName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function buildRoomTeamCards({ state, candidatePosition = null, legalMaximumFor } = {}) {
  if (!state?.config?.nominationOrder || !state?.teams || typeof legalMaximumFor !== "function") return [];
  const position = DISPLAY_POSITIONS.includes(candidatePosition) ? candidatePosition : null;
  return state.config.nominationOrder
    .map((teamId) => state.teams[teamId])
    .filter(Boolean)
    .map((team) => {
      const countsAfter = { ...team.positionCounts };
      if (position) countsAfter[position] = (countsAfter[position] || 0) + 1;
      const openSlotsAfter = state.config.rosterSize - team.roster.length - 1;
      const missingStartersAfter = DISPLAY_POSITIONS.reduce(
        (total, slot) => total + Math.max(0, state.config.starterRequirements[slot] - (countsAfter[slot] || 0)),
        0,
      );
      const canDraftCandidate = team.roster.length < state.config.rosterSize && (!position || missingStartersAfter <= openSlotsAfter);
      return {
        id: team.id,
        name: team.name,
        cash: team.cash,
        rosterCount: team.roster.length,
        openSlots: team.openSlots,
        candidatePosition: position,
        canDraftCandidate,
        legalMaximum: canDraftCandidate ? legalMaximumFor(team, position) : 0,
        positionCounts: Object.fromEntries(DISPLAY_POSITIONS.map((slot) => [slot, Number(team.positionCounts?.[slot]) || 0])),
        isCurrentNominator: team.id === state.currentNominatorTeamId,
      };
    });
}

export function orderedRoster(team) {
  if (!team?.roster) return [];
  const positionOrder = new Map(DISPLAY_POSITIONS.map((position, index) => [position, index]));
  return [...team.roster].sort((left, right) => {
    const acquisition = Number(right.acquisitionType === "keeper") - Number(left.acquisitionType === "keeper");
    if (acquisition) return acquisition;
    const position = (positionOrder.get(left.position) ?? 99) - (positionOrder.get(right.position) ?? 99);
    if (position) return position;
    return String(left.playerName).localeCompare(String(right.playerName));
  });
}

export function savedDepthChartForPlayer(player, researchSnapshot) {
  const team = canonicalTeam(player?.nflTeam);
  const position = canonicalPosition(player?.position);
  if (!player || !researchSnapshot?.depthChart?.entries || position === "DST") {
    return { team, position, selected: null, entries: [], available: false };
  }
  const entries = researchSnapshot.depthChart.entries
    .filter((entry) => canonicalTeam(entry.nflTeam) === team && canonicalPosition(entry.position) === position)
    .sort((left, right) => left.depthOrder - right.depthOrder || String(left.playerName).localeCompare(String(right.playerName)));
  const selectedName = normalizedName(player.playerName || player.name);
  return {
    team,
    position,
    selected: entries.find((entry) => normalizedName(entry.playerName) === selectedName) || null,
    entries,
    available: entries.length > 0,
  };
}

export { DISPLAY_POSITIONS };
