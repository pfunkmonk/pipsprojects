import { assertLeagueLegality, assertPublicSnapshot, evaluateDraftCompletion, evaluatePurchase } from "./public-core.mjs";
import { snakeTeamId } from "./nomination-order.mjs";

const qaFullBoardMode = new URLSearchParams(window.location.search).get("qa") === "full";
const STORAGE_KEY = qaFullBoardMode ? "thunder-bowl-auctioneer-addon-demo-full-v1" : "thunder-bowl-auctioneer-addon-demo-v1";
const CHANNEL_NAME = "thunder-bowl-auctioneer-addon-demo";
const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
const DEFAULT_CLOCK = { status: "paused", durationMs: 120_000, remainingMs: 120_000, deadline: null, serverNow: Date.now() };

const teams = [
  ["orange-crush", "Orange Crush", 100], ["the-hobbits", "The Hobbits", 100], ["crime-and-punishment", "Crime and Punishment", 100],
  ["t-dogs", "T-Dogs", 100], ["super-suckers", "Super Suckers", 100], ["angry-face", "Angry Face", 100],
  ["goon-skwad", "Goon Skwad", 106], ["dogs-of-war", "Dogs of War", 104], ["el-guapo", "El Guapo", 102],
  ["the-bungles", "The Bungles", 100], ["big-head", "Big Head", 100], ["three-amigos", "Three Amigos", 100],
].map(([id, name, startingCap]) => ({ id, name, startingCap, capAdjustment: 0 }));

// The demo board mirrors the official 2026 schedule so its sticker preview is
// representative without coupling the live public board to a second data feed.
const DEMO_BYE_WEEKS = Object.freeze({
  ARI: 14, ATL: 11, BAL: 13, BUF: 7, CAR: 5, CHI: 10, CIN: 6, CLE: 11,
  DAL: 14, DEN: 10, DET: 6, GB: 11, HOU: 8, IND: 13, JAX: 7, KC: 5,
  LAC: 7, LAR: 11, LV: 13, MIA: 6, MIN: 6, NE: 11, NO: 8, NYG: 8,
  NYJ: 13, PHI: 10, PIT: 9, SEA: 11, SF: 8, TB: 10, TEN: 9, WAS: 7,
});

const playerRows = [
  ["justin-herbert", "Justin Herbert", "QB", "LAC"], ["nico-collins", "Nico Collins", "WR", "HOU"], ["jahmyr-gibbs", "Jahmyr Gibbs", "RB", "DET"],
  ["sam-laporta", "Sam LaPorta", "TE", "DET"], ["justin-jefferson", "Justin Jefferson", "WR", "MIN"], ["brock-bowers", "Brock Bowers", "TE", "LV"],
  ["saquon-barkley", "Saquon Barkley", "RB", "PHI"], ["ceedee-lamb", "CeeDee Lamb", "WR", "DAL"], ["josh-allen", "Josh Allen", "QB", "BUF"],
  ["amon-ra-st-brown", "Amon-Ra St. Brown", "WR", "DET"], ["bijan-robinson", "Bijan Robinson", "RB", "ATL"], ["malik-nabers", "Malik Nabers", "WR", "NYG"],
  ["jamar-chase", "Ja'Marr Chase", "WR", "CIN"], ["devon-achane", "De'Von Achane", "RB", "MIA"], ["puka-nacua", "Puka Nacua", "WR", "LAR"],
  ["breece-hall", "Breece Hall", "RB", "NYJ"], ["christian-mccaffrey", "Christian McCaffrey", "RB", "SF"], ["brian-thomas", "Brian Thomas Jr.", "WR", "JAX"],
  ["jaxon-smith-njigba", "Jaxon Smith-Njigba", "WR", "SEA"], ["kyren-williams", "Kyren Williams", "RB", "LAR"], ["aj-brown", "A.J. Brown", "WR", "PHI"],
  ["josh-downs", "Josh Downs", "WR", "IND"], ["garrett-wilson", "Garrett Wilson", "WR", "NYJ"], ["jameson-williams", "Jameson Williams", "WR", "DET"],
  ["joe-burrow", "Joe Burrow", "QB", "CIN"], ["lamar-jackson", "Lamar Jackson", "QB", "BAL"], ["jayden-daniels", "Jayden Daniels", "QB", "WAS"],
  ["derrick-henry", "Derrick Henry", "RB", "BAL"], ["jalen-hurts", "Jalen Hurts", "QB", "PHI"], ["patrick-mahomes", "Patrick Mahomes", "QB", "KC"],
  ["caleb-williams", "Caleb Williams", "QB", "CHI"], ["jonathan-taylor", "Jonathan Taylor", "RB", "IND"], ["baker-mayfield", "Baker Mayfield", "QB", "TB"],
  ["bo-nix", "Bo Nix", "QB", "DEN"], ["cj-stroud", "C.J. Stroud", "QB", "HOU"], ["kyler-murray", "Kyler Murray", "QB", "ARI"],
  ["dk-metcalf", "DK Metcalf", "WR", "PIT"], ["josh-jacobs", "Josh Jacobs", "RB", "GB"], ["trey-mcbride", "Trey McBride", "TE", "ARI"],
  ["mike-evans", "Mike Evans", "WR", "TB"], ["george-kittle", "George Kittle", "TE", "SF"], ["chuba-hubbard", "Chuba Hubbard", "RB", "CAR"],
  ["terry-mclaurin", "Terry McLaurin", "WR", "WAS"], ["drake-london", "Drake London", "WR", "ATL"], ["kenneth-walker", "Kenneth Walker", "RB", "SEA"],
  ["travis-kelce", "Travis Kelce", "TE", "KC"], ["bucky-irving", "Bucky Irving", "RB", "TB"], ["dandre-swift", "D'Andre Swift", "RB", "CHI"],
  ["james-cook", "James Cook", "RB", "BUF"], ["tee-higgins", "Tee Higgins", "WR", "CIN"], ["george-pickens", "George Pickens", "WR", "DAL"],
  ["david-montgomery", "David Montgomery", "RB", "DET"], ["davante-adams", "Davante Adams", "WR", "LAR"], ["dj-moore", "DJ Moore", "WR", "CHI"],
  ["james-conner", "James Conner", "RB", "ARI"], ["mark-andrews", "Mark Andrews", "TE", "BAL"], ["devonta-smith", "DeVonta Smith", "WR", "PHI"],
  ["alvin-kamara", "Alvin Kamara", "RB", "NO"], ["david-njoku", "David Njoku", "TE", "CLE"], ["tony-pollard", "Tony Pollard", "RB", "TEN"],
  ["chris-boswell", "Chris Boswell", "K", "PIT"], ["49ers-dst", "49ers", "DST", "SF"], ["eagles-dst", "Eagles", "DST", "PHI"],
  ["ravens-dst", "Ravens", "DST", "BAL"], ["jake-bates", "Jake Bates", "K", "DET"], ["steelers-dst", "Steelers", "DST", "PIT"],
].map(([id, name, position, nflTeam]) => ({ id, name, position, nflTeam, byeWeek: DEMO_BYE_WEEKS[nflTeam] ?? null }));

const seedAssignments = [
  ["jahmyr-gibbs", "orange-crush", 24, 2], ["sam-laporta", "orange-crush", 8, 1], ["justin-jefferson", "the-hobbits", 31, 3], ["brock-bowers", "the-hobbits", 11, 2],
  ["saquon-barkley", "crime-and-punishment", 27, 2], ["ceedee-lamb", "crime-and-punishment", 25, 1], ["josh-allen", "t-dogs", 17, 3], ["amon-ra-st-brown", "t-dogs", 26, 2],
  ["bijan-robinson", "super-suckers", 29, 2], ["malik-nabers", "super-suckers", 18, 1], ["jamar-chase", "angry-face", 28, 3], ["devon-achane", "angry-face", 19, 2],
  ["puka-nacua", "goon-skwad", 22, 2], ["breece-hall", "goon-skwad", 17, 1], ["justin-herbert", "dogs-of-war", 4, 3], ["nico-collins", "dogs-of-war", 14, 2],
  ["christian-mccaffrey", "el-guapo", 21, 3], ["brian-thomas", "el-guapo", 15, 1], ["jaxon-smith-njigba", "the-bungles", 19, 2], ["kyren-williams", "the-bungles", 18, 1],
  ["aj-brown", "big-head", 23, 3], ["josh-downs", "big-head", 7, 1], ["garrett-wilson", "three-amigos", 20, 2], ["jameson-williams", "three-amigos", 8, 1],
];

function playerById(playerId) {
  return playerRows.find((player) => player.id === playerId);
}

function assignment(playerId, teamId, price, contractYear, index) {
  const player = playerById(playerId);
  const createdAt = new Date(Date.UTC(2026, 7, 7, 18, index)).toISOString();
  return {
    id: `demo-assignment-${index + 1}`,
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    nflTeam: player.nflTeam,
    byeWeek: player.byeWeek,
    teamId,
    price,
    acquisitionType: "keeper",
    contractYear,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    actorLabel: "League setup",
  };
}

function initialSnapshot() {
  if (qaFullBoardMode) return fullQaSnapshot();
  return refreshNomination({
    season: 2026,
    revision: 1,
    updatedAt: new Date().toISOString(),
    rosterSize: 14,
    minimumRosterSize: 8,
    keeperSlots: 2,
    starterRequirements: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    teams,
    availablePlayers: playerRows,
    assignments: seedAssignments.map((row, index) => assignment(...row, index)),
    finishedTeamIds: [],
    stagedNomination: null,
    clock: { ...DEFAULT_CLOCK, serverNow: Date.now() },
    auditEvents: [],
    nominationCursor: 0,
  });
}

function fullQaSnapshot() {
  const positionPattern = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DST", "RB", "WR", "TE", "QB", "RB", "WR"];
  const players = [];
  const assignments = [];
  teams.forEach((team, teamIndex) => positionPattern.forEach((position, slotIndex) => {
    const player = {
      id: `qa-player-${teamIndex + 1}-${slotIndex + 1}`,
      name: slotIndex === 8 ? `Extraordinarily Long Player ${teamIndex + 1}` : `QA Player ${teamIndex + 1}-${slotIndex + 1}`,
      position,
      nflTeam: ["DEN", "MIN", "BUF", "PHI"][slotIndex % 4],
    };
    player.byeWeek = DEMO_BYE_WEEKS[player.nflTeam];
    players.push(player);
    assignments.push({
      id: `qa-assignment-${teamIndex + 1}-${slotIndex + 1}`,
      playerId: player.id, playerName: player.name, position: player.position, nflTeam: player.nflTeam, byeWeek: player.byeWeek,
      teamId: team.id, price: 1, acquisitionType: slotIndex < 2 ? "keeper" : "auction",
      contractYear: slotIndex < 2 ? slotIndex + 1 : null, status: "active",
      createdAt: new Date(Date.UTC(2026, 7, 7, 18, teamIndex, slotIndex)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 7, 7, 18, teamIndex, slotIndex)).toISOString(), actorLabel: "Full-board QA fixture",
    });
  }));
  return {
    season: 2026, revision: 168, updatedAt: new Date().toISOString(), rosterSize: 14, minimumRosterSize: 8, keeperSlots: 2,
    starterRequirements: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 },
    currentNominatorTeamId: null, nextNominatorTeamId: null, teams, availablePlayers: players, assignments,
    finishedTeamIds: [], stagedNomination: null, clock: { ...DEFAULT_CLOCK, serverNow: Date.now() }, auditEvents: [], nominationCursor: 144,
  };
}

function refreshNomination(snapshot) {
  const finished = new Set(snapshot.finishedTeamIds || []);
  const order = teams.map((team) => team.id);
  snapshot.nominationCursor ??= snapshot.assignments.filter((assignment) => assignment.acquisitionType === "auction").length;
  let cursor = snapshot.nominationCursor;
  for (let count = 0; count < teams.length * 3 && finished.has(snakeTeamId(order, cursor)); count += 1) cursor += 1;
  snapshot.nominationCursor = cursor;
  snapshot.currentNominatorTeamId = finished.size === teams.length ? null : snakeTeamId(order, cursor);
  let nextCursor = cursor + 1;
  for (let count = 0; count < teams.length * 3 && finished.has(snakeTeamId(order, nextCursor)); count += 1) nextCursor += 1;
  snapshot.nextNominatorTeamId = finished.size === teams.length ? null : snakeTeamId(order, nextCursor);
  return snapshot;
}

function readSnapshot() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const snapshot = saved ? JSON.parse(saved) : initialSnapshot();
  snapshot.finishedTeamIds ||= [];
  snapshot.stagedNomination ??= null;
  snapshot.clock ||= { ...DEFAULT_CLOCK, serverNow: Date.now() };
  if (snapshot.clock.status === "running") snapshot.clock.remainingMs = Math.max(0, snapshot.clock.deadline - Date.now());
  snapshot.clock.serverNow = Date.now();
  snapshot.auditEvents ||= [];
  refreshNomination(snapshot);
  assertPublicSnapshot(snapshot);
  assertLeagueLegality(snapshot);
  return structuredClone(snapshot);
}

function writeSnapshot(snapshot) {
  snapshot.revision += 1;
  snapshot.updatedAt = new Date().toISOString();
  snapshot.clock.serverNow = Date.now();
  refreshNomination(snapshot);
  assertPublicSnapshot(snapshot);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  channel?.postMessage({ type: "snapshot", revision: snapshot.revision });
  window.dispatchEvent(new CustomEvent("thunder-bowl-demo-update"));
  return structuredClone(snapshot);
}

function nextId() {
  return globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function applyCommand(command) {
  const snapshot = readSnapshot();
  const now = new Date().toISOString();
  if (command.type === "record-sale") {
    const player = playerById(command.playerId);
    if (!player) throw new Error("Choose a valid available player.");
    const legality = evaluatePurchase(snapshot, command);
    if (!legality.legal) throw new Error(legality.message);
    snapshot.assignments.push({
      id: nextId(), playerId: player.id, playerName: player.name, position: player.position, nflTeam: player.nflTeam,
      teamId: command.teamId, price: Number(command.price), acquisitionType: "auction", contractYear: null,
      status: "active", createdAt: now, updatedAt: now, actorLabel: "Auctioneer",
    });
    snapshot.nominationCursor = (snapshot.nominationCursor || 0) + 1;
    snapshot.stagedNomination = null;
    snapshot.clock = { status: "running", durationMs: snapshot.clock.durationMs, remainingMs: snapshot.clock.durationMs, deadline: Date.now() + snapshot.clock.durationMs, serverNow: Date.now() };
  } else if (command.type === "stage-nomination") {
    const player = playerById(command.playerId);
    if (!player || snapshot.assignments.some((assignment) => assignment.status === "active" && assignment.playerId === player.id)) throw new Error("Choose an available player to nominate.");
    snapshot.stagedNomination = { ...player, updatedAt: now };
    snapshot.clock = { ...snapshot.clock, status: "paused", deadline: null, serverNow: Date.now() };
    snapshot.auditEvents.push({ id: nextId(), action: "Nominated", playerName: player.name, playerId: player.id, createdAt: now, actorLabel: "Auctioneer" });
  } else if (command.type === "clear-nomination") {
    snapshot.stagedNomination = null;
  } else if (command.type === "update-clock") {
    if (command.action === "pause") snapshot.clock = { ...snapshot.clock, status: "paused", deadline: null, serverNow: Date.now() };
    else if (command.action === "resume") {
      const remainingMs = snapshot.clock.remainingMs > 0 ? snapshot.clock.remainingMs : snapshot.clock.durationMs;
      snapshot.clock = { ...snapshot.clock, status: "running", remainingMs, deadline: Date.now() + remainingMs, serverNow: Date.now() };
    } else if (command.action === "reset") snapshot.clock = { status: "paused", durationMs: snapshot.clock.durationMs, remainingMs: snapshot.clock.durationMs, deadline: null, serverNow: Date.now() };
    else if (command.action === "set-duration" && [120_000, 90_000, 60_000, 45_000, 30_000].includes(Number(command.durationMs))) {
      const durationMs = Number(command.durationMs);
      snapshot.clock = snapshot.clock.status === "running"
        ? { status: "running", durationMs, remainingMs: durationMs, deadline: Date.now() + durationMs, serverNow: Date.now() }
        : { status: "paused", durationMs, remainingMs: durationMs, deadline: null, serverNow: Date.now() };
    } else throw new Error("Unsupported nomination-clock action.");
  } else if (command.type === "mark-team-finished") {
    const completion = evaluateDraftCompletion(snapshot).teams.find((team) => team.teamId === command.teamId);
    if (!completion?.complete) throw new Error(`${completion?.teamName || "That team"} cannot finish yet: ${completion?.problems.join("; ") || "its roster is not legal"}.`);
    if (!snapshot.finishedTeamIds.includes(command.teamId)) snapshot.finishedTeamIds.push(command.teamId);
    snapshot.auditEvents.push({ id: nextId(), action: "Marked team finished", teamId: command.teamId, createdAt: now, actorLabel: "Auctioneer" });
  } else if (command.type === "reopen-team") {
    snapshot.finishedTeamIds = snapshot.finishedTeamIds.filter((teamId) => teamId !== command.teamId);
    snapshot.auditEvents.push({ id: nextId(), action: "Reopened team", teamId: command.teamId, createdAt: now, actorLabel: "Auctioneer" });
  } else if (command.type === "reconcile-assignments") {
    if (!Array.isArray(command.changes) || command.changes.length < 2) throw new Error("Choose at least two assignments to reconcile.");
    const targetIds = new Set();
    for (const change of command.changes) {
      if (targetIds.has(change.assignmentId)) throw new Error("An assignment can appear only once in a reconciliation.");
      targetIds.add(change.assignmentId);
      const target = snapshot.assignments.find((candidate) => candidate.id === change.assignmentId && candidate.status === "active");
      if (!target) throw new Error("A selected assignment is no longer active.");
      const player = playerById(change.playerId);
      if (!player) throw new Error("Choose a valid player for every correction.");
      Object.assign(target, {
        playerId: player.id, playerName: player.name, position: player.position, nflTeam: player.nflTeam,
        teamId: change.teamId, price: Number(change.price),
        contractYear: target.acquisitionType === "keeper" ? Number(change.contractYear) : null,
        updatedAt: now, actorLabel: "Auctioneer · reconciled",
      });
    }
  } else {
    const target = snapshot.assignments.find((candidate) => candidate.id === command.assignmentId);
    if (!target) throw new Error("That assignment no longer exists.");
    if (command.type === "void-assignment") {
      target.status = "voided";
      target.updatedAt = now;
      target.actorLabel = "Auctioneer · undone";
    } else if (command.type === "restore-assignment") {
      target.status = "active";
      target.updatedAt = now;
      target.actorLabel = "Auctioneer · restored";
    } else if (command.type === "correct-assignment") {
      const player = playerById(command.playerId);
      if (!player) throw new Error("Choose a valid player.");
      Object.assign(target, {
        playerId: player.id, playerName: player.name, position: player.position, nflTeam: player.nflTeam,
        teamId: command.teamId, price: Number(command.price),
        contractYear: target.acquisitionType === "keeper" ? Number(command.contractYear) : null,
        updatedAt: now, actorLabel: "Auctioneer · corrected",
      });
    } else {
      throw new Error("Unsupported demo command.");
    }
  }
  const completionByTeam = new Map(evaluateDraftCompletion(snapshot).teams.map((team) => [team.teamId, team]));
  for (const teamId of [...snapshot.finishedTeamIds]) {
    if (!completionByTeam.get(teamId)?.complete) {
      snapshot.finishedTeamIds = snapshot.finishedTeamIds.filter((candidate) => candidate !== teamId);
      snapshot.auditEvents.push({ id: nextId(), action: "Automatically reopened after correction", teamId, createdAt: now, actorLabel: "System" });
    }
  }
  return writeSnapshot(snapshot);
}

export function createDemoSource() {
  return {
    async login(code) {
      if (String(code) !== "2026") throw new Error("Incorrect demo access code.");
    },
    async snapshot() { return readSnapshot(); },
    async command(command) { return applyCommand(command); },
    subscribe(callback) {
      const onChannel = () => callback();
      const onStorage = (event) => { if (event.key === STORAGE_KEY) callback(); };
      const onCustom = () => callback();
      const pollId = window.setInterval(callback, 1500);
      channel?.addEventListener("message", onChannel);
      window.addEventListener("storage", onStorage);
      window.addEventListener("thunder-bowl-demo-update", onCustom);
      return () => {
        window.clearInterval(pollId);
        channel?.removeEventListener("message", onChannel);
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("thunder-bowl-demo-update", onCustom);
      };
    },
    reset() {
      localStorage.removeItem(STORAGE_KEY);
      channel?.postMessage({ type: "reset" });
      return readSnapshot();
    },
  };
}
