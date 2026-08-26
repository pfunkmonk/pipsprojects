import { playerSearchScore } from "../player-search.mjs?v=20260811h";

const ALLOWED_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);
const ALLOWED_ACQUISITION_TYPES = new Set(["keeper", "auction"]);
const ALLOWED_STATUSES = new Set(["active", "voided"]);
const ALLOWED_SALARY_LEDGER_KINDS = new Set(["opening", "bonus", "adjustment", "trade", "keeper", "auction"]);
const STANDARD_STARTING_CAP = 100;
const PRE_AUCTION_BONUS_LABELS = new Map([
  [6, "1st Place Loser's Bracket"],
  [4, "2nd Place Loser's Bracket"],
  [2, "3rd Place Loser's Bracket"],
]);

function validPublicText(value, maximumLength = 200) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

export function assertPublicSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") throw new Error("Public snapshot is required.");
  if (!Number.isInteger(snapshot.season)) throw new Error("Snapshot season is invalid.");
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) throw new Error("Snapshot revision is invalid.");
  if (!Number.isInteger(snapshot.rosterSize) || snapshot.rosterSize < 1) throw new Error("Roster size is invalid.");
  if (snapshot.minimumRosterSize !== undefined && (!Number.isInteger(snapshot.minimumRosterSize) || snapshot.minimumRosterSize < 1 || snapshot.minimumRosterSize > snapshot.rosterSize)) throw new Error("Minimum roster size is invalid.");
  if (!Number.isInteger(snapshot.keeperSlots) || snapshot.keeperSlots < 0 || snapshot.keeperSlots > snapshot.rosterSize) throw new Error("Keeper slot count is invalid.");
  if (!Array.isArray(snapshot.teams) || snapshot.teams.length === 0) throw new Error("Ordered teams are required.");
  if (!Array.isArray(snapshot.assignments)) throw new Error("Assignments are required.");
  if (snapshot.finishedTeamIds !== undefined && !Array.isArray(snapshot.finishedTeamIds)) throw new Error("Finished-team state is invalid.");
  if (snapshot.auditEvents !== undefined && !Array.isArray(snapshot.auditEvents)) throw new Error("Audit events are invalid.");
  if (snapshot.availablePlayers !== undefined && !Array.isArray(snapshot.availablePlayers)) throw new Error("Available players are invalid.");
  if (snapshot.displayBoardUrl !== undefined && (typeof snapshot.displayBoardUrl !== "string" || !snapshot.displayBoardUrl.startsWith("/thunder-bowl/board/") && !snapshot.displayBoardUrl.startsWith("https://") && !snapshot.displayBoardUrl.startsWith("http://localhost"))) throw new Error("Display-board URL is invalid.");
  if (snapshot.clock !== undefined) {
    const clock = snapshot.clock;
    if (!clock || typeof clock !== "object" || !["running", "paused"].includes(clock.status)) throw new Error("Nomination clock is invalid.");
    if (!Number.isInteger(clock.durationMs) || clock.durationMs < 15_000 || clock.durationMs > 600_000) throw new Error("Nomination clock duration is invalid.");
    if (!Number.isFinite(clock.remainingMs) || clock.remainingMs < 0 || clock.remainingMs > clock.durationMs) throw new Error("Nomination clock remaining time is invalid.");
    if (clock.deadline !== null && (!Number.isSafeInteger(clock.deadline) || clock.deadline < 0)) throw new Error("Nomination clock deadline is invalid.");
    if (!Number.isSafeInteger(clock.serverNow) || clock.serverNow < 0) throw new Error("Nomination clock server time is invalid.");
  }
  if (snapshot.starterRequirements !== undefined) {
    if (!snapshot.starterRequirements || typeof snapshot.starterRequirements !== "object" || Array.isArray(snapshot.starterRequirements)) throw new Error("Starter requirements are invalid.");
    for (const [position, count] of Object.entries(snapshot.starterRequirements)) {
      if (!ALLOWED_POSITIONS.has(position) || !Number.isInteger(count) || count < 0 || count > snapshot.rosterSize) throw new Error(`Starter requirement is invalid: ${position}`);
    }
  }

  const teamIds = new Set();
  for (const team of snapshot.teams) {
    if (!validPublicText(team?.id, 100) || !validPublicText(team?.name) || !Number.isInteger(team.startingCap) || team.startingCap < 0) throw new Error("A team record is invalid.");
    if (team.capAdjustment !== undefined && !Number.isInteger(team.capAdjustment)) throw new Error("A team cap adjustment is invalid.");
    if (team.logoUrl !== undefined && (typeof team.logoUrl !== "string" || (!team.logoUrl.startsWith("/") && !team.logoUrl.startsWith("https://")))) throw new Error("A team logo URL is invalid.");
    if (team.salaryLedger !== undefined) {
      if (!Array.isArray(team.salaryLedger) || !team.salaryLedger.length || team.salaryLedger.length > 100) throw new Error("A team salary ledger is invalid.");
      const entryIds = new Set();
      let priorBalance = 0;
      team.salaryLedger.forEach((entry, index) => {
        if (!validPublicText(entry?.id, 140) || !validPublicText(entry.label) || !ALLOWED_SALARY_LEDGER_KINDS.has(entry.kind)) throw new Error("A salary ledger entry is invalid.");
        if (entryIds.has(entry.id)) throw new Error(`Duplicate salary ledger entry: ${entry.id}`);
        if (!Number.isInteger(entry.delta) || entry.delta < -300 || entry.delta > 300 || !Number.isInteger(entry.balance) || entry.balance < 0 || entry.balance > 3600) throw new Error("Salary ledger dollars are invalid.");
        if (entry.balance !== priorBalance + entry.delta) throw new Error("A salary ledger running balance does not reconcile.");
        if (index === 0 && entry.kind !== "opening") throw new Error("A salary ledger must begin with its opening cap.");
        entryIds.add(entry.id);
        priorBalance = entry.balance;
      });
    }
    if (teamIds.has(team.id)) throw new Error(`Duplicate team: ${team.id}`);
    teamIds.add(team.id);
  }

  const activePlayers = new Set();
  const activeTeamCounts = new Map();
  const assignmentIds = new Set();
  for (const assignment of snapshot.assignments) {
    if (!validPublicText(assignment?.id, 100) || !validPublicText(assignment.playerId, 100) || !validPublicText(assignment.playerName) || !validPublicText(assignment.nflTeam, 20) || !teamIds.has(assignment.teamId)) throw new Error("An assignment record is invalid.");
    if (assignmentIds.has(assignment.id)) throw new Error(`Duplicate assignment: ${assignment.id}`);
    assignmentIds.add(assignment.id);
    if (!ALLOWED_POSITIONS.has(assignment.position)) throw new Error(`Invalid position: ${assignment.position}`);
    if (assignment.byeWeek !== undefined && assignment.byeWeek !== null && (!Number.isInteger(assignment.byeWeek) || assignment.byeWeek < 1 || assignment.byeWeek > 18)) throw new Error("Assignment bye week is invalid.");
    if (!Number.isInteger(assignment.price) || assignment.price < 1) throw new Error("Assignment price must be a positive whole dollar.");
    if (!ALLOWED_ACQUISITION_TYPES.has(assignment.acquisitionType)) throw new Error("Assignment acquisition type is invalid.");
    if (!ALLOWED_STATUSES.has(assignment.status)) throw new Error("Assignment status is invalid.");
    if (assignment.acquisitionType === "keeper" && (!Number.isInteger(assignment.contractYear) || assignment.contractYear < 1 || assignment.contractYear > 3)) throw new Error("Keeper contract year must be Year 1, Year 2, or Year 3.");
    if (assignment.acquisitionType === "auction" && assignment.contractYear !== null) throw new Error("Auction purchases cannot have a keeper contract year.");
    if (assignment.status === "active") {
      if (activePlayers.has(assignment.playerId)) throw new Error(`Duplicate active player: ${assignment.playerId}`);
      activePlayers.add(assignment.playerId);
      activeTeamCounts.set(assignment.teamId, (activeTeamCounts.get(assignment.teamId) || 0) + 1);
    }
  }

  for (const [teamId, count] of activeTeamCounts) {
    if (count > snapshot.rosterSize) throw new Error(`${teamId} exceeds the roster limit.`);
  }
  for (const team of snapshot.teams) {
    if (!team.salaryLedger) continue;
    const finalBalance = team.salaryLedger.at(-1)?.balance;
    if (finalBalance !== teamSummary(snapshot, team.id).remainingCap) throw new Error(`${team.name}'s salary ledger does not match its board balance.`);
  }
  for (const teamId of snapshot.finishedTeamIds || []) {
    if (!teamIds.has(teamId)) throw new Error(`Unknown finished team: ${teamId}`);
  }
  const playerIds = new Set();
  for (const player of snapshot.availablePlayers || []) {
    if (!validPublicText(player?.id, 100) || !validPublicText(player.name) || !ALLOWED_POSITIONS.has(player.position) || !validPublicText(player.nflTeam, 20)) throw new Error("An available-player record is invalid.");
    if (player.byeWeek !== undefined && player.byeWeek !== null && (!Number.isInteger(player.byeWeek) || player.byeWeek < 1 || player.byeWeek > 18)) throw new Error("An available-player bye week is invalid.");
    if (playerIds.has(player.id)) throw new Error(`Duplicate available player: ${player.id}`);
    playerIds.add(player.id);
  }
  if (snapshot.stagedNomination !== undefined && snapshot.stagedNomination !== null) {
    const player = snapshot.stagedNomination;
    if (!validPublicText(player.id, 100) || !validPublicText(player.name) || !ALLOWED_POSITIONS.has(player.position) || !validPublicText(player.nflTeam, 20)) throw new Error("Staged nomination is invalid.");
    if (player.byeWeek !== undefined && player.byeWeek !== null && (!Number.isInteger(player.byeWeek) || player.byeWeek < 1 || player.byeWeek > 18)) throw new Error("Staged nomination bye week is invalid.");
  }
  return snapshot;
}

export function activeAssignments(snapshot) {
  return snapshot.assignments.filter((assignment) => assignment.status === "active");
}

export function orderedTeamAssignments(snapshot, teamId) {
  return activeAssignments(snapshot)
    .filter((assignment) => assignment.teamId === teamId)
    .sort((left, right) => {
      const leftKeeper = left.acquisitionType === "keeper" ? 0 : 1;
      const rightKeeper = right.acquisitionType === "keeper" ? 0 : 1;
      return leftKeeper - rightKeeper || Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.playerName.localeCompare(right.playerName);
    });
}

export function teamSummary(snapshot, teamId) {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new Error(`Unknown team: ${teamId}`);
  const assignments = orderedTeamAssignments(snapshot, teamId);
  const spent = assignments.reduce((sum, assignment) => sum + assignment.price, 0);
  const adjustedCap = team.startingCap + (Number(team.capAdjustment) || 0);
  const remainingCap = adjustedCap - spent;
  const openSlots = snapshot.rosterSize - assignments.length;
  const missingStarters = missingStarterPositions(starterRequirements(snapshot), positionCounts(assignments));
  const minimumPlayersNeeded = Math.max(0, minimumRosterSize(snapshot) - assignments.length);
  const minimumRequiredAdditions = Math.max(minimumPlayersNeeded, missingStarters.length);
  const minimumRequiredAfterBestPurchase = Math.max(0, minimumRequiredAdditions - 1);
  const legalMaxBid = openSlots > 0 ? Math.max(0, remainingCap - minimumRequiredAfterBestPurchase) : 0;
  return { team, assignments, spent, adjustedCap, remainingCap, openSlots, legalMaxBid, minimumPlayersNeeded, minimumRequiredAdditions, missingStarters, isFinished: (snapshot.finishedTeamIds || []).includes(teamId) };
}

export function teamSalaryLedger(snapshot, teamId) {
  const summary = teamSummary(snapshot, teamId);
  if (Array.isArray(summary.team.salaryLedger)) {
    return { entries: summary.team.salaryLedger.map((entry) => ({ ...entry })), detailed: true };
  }

  const entries = [{
    id: `opening:${teamId}`,
    kind: "opening",
    label: "Starting salary cap",
    delta: STANDARD_STARTING_CAP,
    balance: STANDARD_STARTING_CAP,
  }];
  const capAdjustment = summary.adjustedCap - STANDARD_STARTING_CAP;
  if (capAdjustment) {
    entries.push({
      id: `current-adjustment:${teamId}`,
      kind: capAdjustment > 0 ? "bonus" : "adjustment",
      label: PRE_AUCTION_BONUS_LABELS.get(capAdjustment) || "Pre-auction cap and trade adjustments",
      delta: capAdjustment,
      balance: entries.at(-1).balance + capAdjustment,
    });
  }
  [...summary.assignments]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.playerName.localeCompare(right.playerName))
    .forEach((assignment) => entries.push({
      id: assignment.id,
      kind: assignment.acquisitionType,
      label: `${assignment.acquisitionType === "keeper" ? "Keep" : "Draft"} ${assignment.playerName}`,
      delta: -assignment.price,
      balance: entries.at(-1).balance - assignment.price,
    }));
  return { entries, detailed: false };
}

function starterRequirements(snapshot) {
  return snapshot.starterRequirements || { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };
}

export function minimumRosterSize(snapshot) {
  return snapshot.minimumRosterSize ?? snapshot.rosterSize;
}

function positionCounts(assignments) {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  for (const assignment of assignments) counts[assignment.position] = (counts[assignment.position] || 0) + 1;
  return counts;
}

function missingStarterPositions(requirements, counts) {
  const missing = [];
  for (const [position, required] of Object.entries(requirements)) {
    for (let index = counts[position] || 0; index < required; index += 1) missing.push(position);
  }
  return missing;
}

export function evaluatePurchase(snapshot, { playerId, teamId, price }) {
  assertPublicSnapshot(snapshot);
  const player = snapshot.availablePlayers?.find((candidate) => candidate.id === playerId);
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  const amount = Number(price);
  if (!player) return { legal: false, code: "PLAYER_REQUIRED", message: "Choose an available player." };
  if (!team) return { legal: false, code: "TEAM_REQUIRED", message: "Choose the purchasing team." };
  if ((snapshot.finishedTeamIds || []).includes(team.id)) return { legal: false, code: "TEAM_FINISHED", message: `${team.name} is marked finished. Reopen that team before recording another purchase.` };
  if (!Number.isInteger(amount) || amount < 1) return { legal: false, code: "PRICE_REQUIRED", message: "Enter a positive whole-dollar price." };
  if (activeAssignments(snapshot).some((assignment) => assignment.playerId === player.id)) {
    return { legal: false, code: "PLAYER_UNAVAILABLE", message: `${player.name} is already assigned to a team.` };
  }

  const summary = teamSummary(snapshot, team.id);
  if (summary.openSlots <= 0) return { legal: false, code: "ROSTER_FULL", message: `${team.name} already has a full ${snapshot.rosterSize}-player roster.` };
  const cashAfter = summary.remainingCap - amount;
  const openSlotsAfter = summary.openSlots - 1;
  const nextAssignments = [...summary.assignments, { ...player, playerId: player.id, playerName: player.name, teamId: team.id, price: amount, acquisitionType: "auction", contractYear: null, status: "active" }];
  const missingStarters = missingStarterPositions(starterRequirements(snapshot), positionCounts(nextAssignments));
  const minimumPlayersNeeded = Math.max(0, minimumRosterSize(snapshot) - nextAssignments.length);
  const minimumReserve = Math.max(minimumPlayersNeeded, missingStarters.length);
  const playerSpecificLegalMaxBid = Math.max(0, summary.remainingCap - minimumReserve);
  const problems = [];

  if (cashAfter < 0) problems.push(`${team.name} has only $${summary.remainingCap} remaining`);
  else if (cashAfter < minimumReserve) problems.push(`$${amount} would leave ${team.name} with $${cashAfter}, but at least $${minimumReserve} must remain to reach a legal ${minimumRosterSize(snapshot)}-player roster with every required position`);
  if (missingStarters.length > openSlotsAfter) {
    problems.push(`only ${openSlotsAfter} roster spot${openSlotsAfter === 1 ? "" : "s"} would remain, but ${team.name} would still need ${missingStarters.join(" and ")}`);
  }
  if (problems.length) {
    return {
      legal: false,
      code: cashAfter < minimumReserve ? "INSUFFICIENT_ROSTER_RESERVE" : "STARTER_PATH_BLOCKED",
      message: `${problems.join(". ")}. Maximum legal bid for ${player.name} is $${playerSpecificLegalMaxBid}.`,
      legalMaxBid: playerSpecificLegalMaxBid,
    };
  }
  return { legal: true, code: "LEGAL", message: "Purchase is legal.", legalMaxBid: playerSpecificLegalMaxBid };
}

export function assertLeagueLegality(snapshot) {
  assertPublicSnapshot(snapshot);
  const requirements = starterRequirements(snapshot);
  for (const team of snapshot.teams) {
    const summary = teamSummary(snapshot, team.id);
    if (summary.assignments.length > snapshot.rosterSize) throw new Error(`${team.name} exceeds the roster limit.`);
    if (summary.remainingCap < summary.minimumRequiredAdditions) throw new Error(`${team.name} does not retain $1 for every player still required to reach a legal roster.`);
    const missing = missingStarterPositions(requirements, positionCounts(summary.assignments));
    if (missing.length > summary.openSlots) throw new Error(`${team.name} has ${summary.openSlots} open roster spots but still needs ${missing.join(" and ")}.`);
  }
  return snapshot;
}

export function evaluateDraftCompletion(snapshot) {
  try { assertLeagueLegality(snapshot); } catch (error) { return { complete: false, problems: [error.message], teams: [] }; }
  const teams = snapshot.teams.map((team) => {
    const summary = teamSummary(snapshot, team.id);
    const problems = [];
    if (summary.assignments.length < minimumRosterSize(snapshot)) problems.push(`needs ${minimumRosterSize(snapshot) - summary.assignments.length} more player${minimumRosterSize(snapshot) - summary.assignments.length === 1 ? "" : "s"}`);
    if (summary.missingStarters.length) problems.push(`still needs ${summary.missingStarters.join(" and ")}`);
    if (summary.remainingCap < 0) problems.push(`is $${Math.abs(summary.remainingCap)} over cap`);
    return { teamId: team.id, teamName: team.name, complete: problems.length === 0, playerCount: summary.assignments.length, problems };
  });
  const problems = teams.filter((team) => !team.complete).map((team) => `${team.teamName} ${team.problems.join(" and ")}.`);
  return { complete: problems.length === 0, problems, teams };
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function currentBoardCsv(snapshot) {
  assertPublicSnapshot(snapshot);
  const rows = [["Team", "Player", "Draft Price", "Contract Year"]];
  for (const team of snapshot.teams) {
    for (const assignment of orderedTeamAssignments(snapshot, team.id)) {
      rows.push([
        team.name,
        assignment.playerName,
        assignment.price,
        assignment.acquisitionType === "keeper" ? `Year ${assignment.contractYear}` : "",
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function downloadBoardCsv(snapshot, filename = `thunder-bowl-${snapshot.season}-draft-board.csv`) {
  const url = URL.createObjectURL(new Blob([`${currentBoardCsv(snapshot)}\n`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function currentAuditCsv(snapshot) {
  assertPublicSnapshot(snapshot);
  const rows = [["Time", "Action", "Player", "Team", "Price", "Status", "Operator", "Reference"]];
  for (const assignment of [...snapshot.assignments].sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))) {
    const team = snapshot.teams.find((candidate) => candidate.id === assignment.teamId);
    rows.push([assignment.updatedAt, assignment.actorLabel || (assignment.acquisitionType === "keeper" ? "Loaded keeper" : "Recorded sale"), assignment.playerName, team?.name || assignment.teamId, assignment.price, assignment.status, assignment.actorLabel || "System", assignment.id]);
  }
  for (const event of snapshot.auditEvents || []) {
    const team = snapshot.teams.find((candidate) => candidate.id === event.teamId);
    rows.push([event.createdAt, event.action, event.playerName || "", team?.name || event.teamId || "", event.price ?? "", event.status || "", event.actorLabel || "Auctioneer", event.id || ""]);
  }
  return rows.slice(1).sort((left, right) => Date.parse(left[0]) - Date.parse(right[0])).reduce((all, row) => all.concat([row]), [rows[0]]).map((row) => row.map(csvCell).join(",")).join("\n");
}

export function downloadAuditCsv(snapshot, filename = `thunder-bowl-${snapshot.season}-auction-audit.csv`) {
  const url = URL.createObjectURL(new Blob([`${currentAuditCsv(snapshot)}\n`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function publicPlayerSearch(players, query) {
  const needle = String(query || "").trim();
  return players
    .map((player) => ({ player, score: playerSearchScore(player, needle) }))
    .filter(({ score }) => score !== null)
    .sort((left, right) => (needle ? right.score - left.score : 0) || left.player.name.localeCompare(right.player.name))
    .map(({ player }) => player);
}
