import { POSITIONS } from "./state-engine.mjs?v=20260828a";

export const PRACTICE_SCHEMA_VERSION = 1;
export const USER_TEAM_ID = "dogs-of-war";
export const PRACTICE_TICK_MS = 1000;
export const QUIET_TICKS_TO_SALE = 3;

const POSITION_TARGETS = Object.freeze({ QB: 2, RB: 4, WR: 4, TE: 2, K: 1, DST: 1 });
const POSITION_CAPS = Object.freeze({ QB: 3, RB: 6, WR: 6, TE: 3, K: 1, DST: 1 });

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function stableUnit(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function exactKeys(value, required) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === required.length
    && required.every((key) => key in value);
}

function averageCashPerSlot(state) {
  const active = Object.values(state.teams).filter((team) => team.openSlots > 0);
  const slots = active.reduce((sum, team) => sum + team.openSlots, 0);
  return slots ? active.reduce((sum, team) => sum + team.cash, 0) / slots : 1;
}

function missingStarterSlots(team, config) {
  return POSITIONS.reduce(
    (sum, position) => sum + Math.max(0, config.starterRequirements[position] - (team.positionCounts[position] || 0)),
    0,
  );
}

export function canPracticeTeamRoster(state, teamId, player) {
  const team = state?.teams?.[teamId];
  if (!team || !player || team.openSlots <= 0 || team.legalMaxBid < 1) return false;
  const positionCount = team.positionCounts[player.position] || 0;
  if (positionCount >= POSITION_CAPS[player.position]) return false;
  const starterNeeded = positionCount < state.config.starterRequirements[player.position];
  return team.openSlots > missingStarterSlots(team, state.config) || starterNeeded;
}

export function profileBidCeiling({ profile, state, player, liveMarketValue, seed = "practice", difficulty = 1 }) {
  const team = state?.teams?.[profile?.teamId];
  if (!team || !player || profile.teamId === USER_TEAM_ID || team.openSlots <= 0) return 0;
  if (!Number.isFinite(liveMarketValue) || liveMarketValue < 1) throw new Error("Practice market value must be at least $1.");
  if (!Number.isFinite(difficulty) || difficulty < 0.85 || difficulty > 1.15) throw new Error("Practice difficulty must be 0.85-1.15.");
  const positionCount = team.positionCounts[player.position] || 0;
  if (!canPracticeTeamRoster(state, profile.teamId, player)) return 0;
  const starterNeeded = positionCount < state.config.starterRequirements[player.position];

  const reliability = clamp(Number(profile.reliability) || 0, 0, 0.75);
  const observedPosition = clamp(Number(profile.positionMultipliers?.[player.position]) || 1, 0.6, 1.5);
  const historical = 1 + reliability * (observedPosition - 1);
  const observedAffinity = profile.topNflAffinity === player.nflTeam
    ? clamp(Number(profile.topNflAffinityMultiplier) || 1, 1, 1.4)
    : 1;
  const affinity = 1 + reliability * (observedAffinity - 1);
  const target = POSITION_TARGETS[player.position];
  const need = starterNeeded ? 1.16 : positionCount < target ? 1.04 : 0.86;
  const cash = clamp((team.cash / team.openSlots) / averageCashPerSlot(state), 0.88, 1.12);
  const jitter = 0.94 + stableUnit(`${seed}:${profile.teamId}:${player.id}`) * 0.12;
  const discretionary = Math.max(0, liveMarketValue - 1);
  const modeled = Math.round(1 + discretionary * historical * affinity * need * cash * jitter * difficulty);
  return clamp(modeled, 1, team.legalMaxBid);
}

export function rankPracticeBidders({ profiles, state, player, liveMarketValue, currentBid, leaderTeamId, seed, difficulty = 1 }) {
  const nextBid = currentBid + 1;
  return profiles
    .filter((profile) => profile.teamId !== USER_TEAM_ID && profile.teamId !== leaderTeamId)
    .map((profile) => {
      const ceiling = profileBidCeiling({ profile, state, player, liveMarketValue, seed, difficulty });
      const urgency = ceiling - nextBid + stableUnit(`${seed}:${profile.teamId}:${player.id}:${currentBid}`) * 0.25;
      return { teamId: profile.teamId, teamName: state.teams[profile.teamId]?.name || profile.teamName, ceiling, urgency };
    })
    .filter((row) => row.ceiling >= nextBid)
    .sort((left, right) => right.urgency - left.urgency || left.teamId.localeCompare(right.teamId));
}

export function nextAutomatedBid(context) {
  const bidder = rankPracticeBidders(context)[0];
  return bidder ? { ...bidder, amount: context.currentBid + 1 } : null;
}

export function choosePracticeNominee({ profiles, state, players, liveValues, nominatorTeamId, selectedPlayerId = null, seed = "practice" }) {
  const available = players.filter((player) => !state.draftedPlayers[player.id] && canPracticeTeamRoster(state, nominatorTeamId, player));
  if (!available.length) return null;
  if (nominatorTeamId === USER_TEAM_ID && selectedPlayerId) {
    const selected = available.find((player) => player.id === selectedPlayerId);
    if (selected) return selected;
  }
  const profile = profiles.find((row) => row.teamId === nominatorTeamId)
    || { teamId: nominatorTeamId, reliability: 0, positionMultipliers: {}, topNflAffinity: "", topNflAffinityMultiplier: 1 };
  const candidates = available.map((player) => {
    const liveMarketValue = liveValues.get(player.id) || Math.max(1, Math.round(player.marketValue));
    const ceiling = nominatorTeamId === USER_TEAM_ID
      ? Math.min(state.teams[USER_TEAM_ID]?.legalMaxBid || 1, liveMarketValue)
      : profileBidCeiling({ profile, state, player, liveMarketValue, seed });
    const nominationNoise = 0.92 + stableUnit(`${seed}:nominate:${nominatorTeamId}:${player.id}`) * 0.16;
    return { player, score: ceiling * nominationNoise + Math.max(0, player.vbd || 0) * 0.015 };
  });
  candidates.sort((left, right) => right.score - left.score || left.player.name.localeCompare(right.player.name));
  return candidates[0]?.player || null;
}

export function createPracticeSession({ practiceId, player, nominatorTeamId, createdAt = new Date().toISOString() }) {
  return validatePracticeSession({
    schemaVersion: PRACTICE_SCHEMA_VERSION,
    practiceId,
    status: "active",
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    nflTeam: player.nflTeam,
    nominatorTeamId,
    currentBid: 1,
    leaderTeamId: nominatorTeamId,
    quietTicks: QUIET_TICKS_TO_SALE,
    userPassed: false,
    paused: false,
    bidSequence: 0,
    createdAt,
    activity: [{ sequence: 0, teamId: nominatorTeamId, amount: 1, kind: "nomination" }],
  });
}

export function validatePracticeSession(input) {
  const keys = [
    "schemaVersion", "practiceId", "status", "playerId", "playerName", "position", "nflTeam",
    "nominatorTeamId", "currentBid", "leaderTeamId", "quietTicks", "userPassed", "paused",
    "bidSequence", "createdAt", "activity",
  ];
  if (!exactKeys(input, keys) || input.schemaVersion !== PRACTICE_SCHEMA_VERSION) throw new Error("Practice session schema mismatch.");
  if (!/^[A-Za-z0-9._:-]{6,120}$/.test(input.practiceId) || !/^[A-Za-z0-9._:-]{2,120}$/.test(input.playerId)) throw new Error("Practice session identifiers are invalid.");
  if (!POSITIONS.includes(input.position) || input.status !== "active") throw new Error("Practice session player/status is invalid.");
  if (!Number.isInteger(input.currentBid) || input.currentBid < 1 || input.currentBid > 300) throw new Error("Practice bid is invalid.");
  if (!Number.isInteger(input.quietTicks) || input.quietTicks < 0 || input.quietTicks > QUIET_TICKS_TO_SALE) throw new Error("Practice quiet clock is invalid.");
  if (!Number.isInteger(input.bidSequence) || input.bidSequence < 0 || typeof input.userPassed !== "boolean" || typeof input.paused !== "boolean") throw new Error("Practice control state is invalid.");
  if (!Number.isFinite(Date.parse(input.createdAt)) || !Array.isArray(input.activity) || input.activity.length > 40) throw new Error("Practice session history is invalid.");
  for (const row of input.activity) {
    if (!exactKeys(row, ["sequence", "teamId", "amount", "kind"]) || !Number.isInteger(row.sequence) || !Number.isInteger(row.amount)) {
      throw new Error("Practice bid activity is invalid.");
    }
  }
  return JSON.parse(JSON.stringify(input));
}

export function applyPracticeBid(session, { teamId, amount, kind = "bid" }) {
  const next = validatePracticeSession(session);
  if (amount !== next.currentBid + 1 || teamId === next.leaderTeamId) throw new Error("Practice bids must advance exactly $1 from a different team.");
  next.currentBid = amount;
  next.leaderTeamId = teamId;
  next.quietTicks = QUIET_TICKS_TO_SALE;
  next.bidSequence += 1;
  next.activity = [...next.activity, { sequence: next.bidSequence, teamId, amount, kind }].slice(-12);
  return validatePracticeSession(next);
}

export function advanceQuietClock(session) {
  const next = validatePracticeSession(session);
  if (!next.paused) next.quietTicks = Math.max(0, next.quietTicks - 1);
  return validatePracticeSession(next);
}
