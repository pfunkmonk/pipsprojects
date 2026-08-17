import { normalizeLeagueCode } from "../core.mjs";
import { nflTeamDetails } from "../nfl-teams.mjs";

const byId = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const LAST_BOARD_LEAGUE_KEY = "pips-draft-day-last-board-league";
let snapshot = null;
let leagueCode = "";
let refreshInFlight = false;
let lastSuccess = 0;
let channel = null;

function cacheKey() { return `pips-draft-day-board-${leagueCode}`; }
function channelName() { return `pips-draft-day-${leagueCode}`; }
function verifierKey(code) { return `pips-draft-day-board-verifier-${code}`; }
async function accessVerifier(value) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pips-draft-day-board|${value}`)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function setStatus(element, message, error = false) { element.textContent = message; element.classList.toggle("is-error", error); element.classList.toggle("is-success", Boolean(message) && !error); }

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || "The Draft Board is unavailable."); error.status = response.status; throw error; }
  return body;
}

function orderedAssignments(teamId) {
  return snapshot.assignments.filter((assignment) => assignment.teamId === teamId && assignment.status === "active").sort((left, right) => {
    if (left.acquisitionType !== right.acquisitionType) return left.acquisitionType === "keeper" ? -1 : 1;
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
}

function render() {
  if (!snapshot) return;
  byId("board-title").textContent = snapshot.config.leagueName; byId("board-season").textContent = `${snapshot.config.season} · PIP'S DRAFT DAY TOOL`;
  const current = snapshot.teams.find((team) => team.id === snapshot.currentNominatorTeamId);
  byId("nominator-line").textContent = snapshot.draftStatus === "complete" ? "Draft complete" : current ? `${current.name} is next to nominate` : "Nomination order is not being tracked";
  const nomination = snapshot.nominatedPlayer; const nominationOverlay = byId("nomination-overlay"); nominationOverlay.hidden = !nomination;
  if (nomination) {
    const teamDetails = stickerTeam(nomination); const nominationCard = byId("nomination-card");
    nominationCard.className = `nomination-card ${positionClass(nomination.position)}`;
    byId("nomination-position").textContent = nomination.position; byId("nomination-player").textContent = nomination.name;
    byId("nomination-team").textContent = `${teamDetails.fullName} · ${teamDetails.byeWeek == null ? "Bye —" : `Bye ${teamDetails.byeWeek}`}`;
  }
  const grid = byId("board-grid"); grid.replaceChildren();
  const columns = snapshot.teams.length <= 12 ? snapshot.teams.length : Math.ceil(snapshot.teams.length / 2);
  grid.style.setProperty("--team-columns", columns); grid.style.setProperty("--roster-rows", snapshot.config.rosterMaximum);
  for (const team of snapshot.teams) {
    const card = document.createElement("article"); card.className = "board-team"; card.classList.toggle("is-nominating", team.id === snapshot.currentNominatorTeamId && snapshot.draftStatus !== "complete");
    const header = document.createElement("header"); const title = document.createElement("h2"); title.textContent = team.name;
    const meta = document.createElement("div"); const cash = document.createElement("b"); cash.textContent = `$${team.remainingBudget}`; const counts = document.createElement("span"); counts.textContent = `${team.rosterCount}/${snapshot.config.rosterMaximum} · MAX $${team.legalMaxBid}`; meta.append(cash, counts); header.append(title, meta);
    const roster = document.createElement("div"); roster.className = "board-roster";
    const assignments = orderedAssignments(team.id);
    for (let index = 0; index < snapshot.config.rosterMaximum; index += 1) {
      const assignment = assignments[index]; const row = document.createElement("div"); row.className = "board-player";
      if (assignment) {
        const teamDetails = stickerTeam(assignment); const keeper = assignment.acquisitionType === "keeper";
        row.classList.add("has-player", positionClass(assignment.position)); row.classList.toggle("is-keeper", keeper);
        const byeLabel = teamDetails.byeWeek == null ? "Bye not available" : `Bye week ${teamDetails.byeWeek}`;
        row.setAttribute("aria-label", `${assignment.playerName}, ${assignment.position}, ${teamDetails.fullName}, ${byeLabel}, $${assignment.price}${keeper ? ", keeper" : ""}`);
        row.title = `${teamDetails.fullName} (${assignment.nflTeam}) · ${byeLabel}${keeper ? " · Keeper" : ""}`;
        const pos = document.createElement("span"); pos.className = "pos"; pos.textContent = assignment.position;
        const playerInfo = document.createElement("span"); playerInfo.className = "player-info";
        const name = document.createElement("span"); name.className = "name"; name.textContent = assignment.playerName;
        const meta = document.createElement("span"); meta.className = "player-meta";
        const nflTeam = document.createElement("span"); nflTeam.className = "nfl-team"; nflTeam.textContent = teamDetails.shortName; nflTeam.dataset.code = assignment.nflTeam;
        const bye = document.createElement("span"); bye.className = "bye-week"; bye.textContent = teamDetails.byeWeek == null ? "BYE —" : `BYE ${teamDetails.byeWeek}`; bye.dataset.compact = teamDetails.byeWeek == null ? "B—" : `B${teamDetails.byeWeek}`;
        meta.append(nflTeam, bye); playerInfo.append(name, meta);
        const priceWrap = document.createElement("span"); priceWrap.className = "assignment-price";
        const price = document.createElement("span"); price.className = "price"; price.textContent = `$${assignment.price}`; priceWrap.append(price);
        if (keeper) { const flag = document.createElement("span"); flag.className = "keeper-flag"; flag.textContent = "KEEPER"; flag.dataset.compact = "KEEP"; priceWrap.append(flag); }
        row.append(pos, playerInfo, priceWrap);
      }
      roster.append(row);
    }
    card.append(header, roster); grid.append(card);
  }
  const sold = snapshot.assignments.filter((assignment) => assignment.acquisitionType === "auction").length;
  const time = new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  byId("board-status").textContent = `Updated ${time} · ${sold} auction purchases · ${snapshot.assignments.filter((assignment) => assignment.acquisitionType === "keeper").length} keepers`;
  byId("connection-state").textContent = "LIVE"; byId("connection-state").classList.remove("is-error");
  try { localStorage.setItem(cacheKey(), JSON.stringify(snapshot)); } catch { /* Live board remains usable without local persistence. */ }
}

function attachChannel() {
  channel?.close(); channel = new BroadcastChannel(channelName()); channel.addEventListener("message", (event) => {
    if (event.data?.leagueCode !== leagueCode) return;
    if (!snapshot || event.data.revision >= snapshot.revision) { snapshot = event.data; lastSuccess = Date.now(); render(); byId("connection-state").textContent = "LOCAL LIVE"; }
  });
}

function positionClass(position) {
  return `position-${String(position || "other").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other"}`;
}

function stickerTeam(assignment) {
  const team = nflTeamDetails(assignment.nflTeamName || assignment.nflTeam);
  return {
    fullName: assignment.nflTeamName || team.name,
    shortName: assignment.nflTeamShortName || team.shortName,
    byeWeek: assignment.byeWeek ?? team.byeWeek,
  };
}

function announceBoardPresence() {
  channel?.postMessage({ type: "board-heartbeat", leagueCode, sentAt: new Date().toISOString() });
}

async function refresh() {
  if (refreshInFlight || !leagueCode) return;
  refreshInFlight = true;
  try {
    const next = await request(`/api/draft-day/snapshot?role=board&league=${encodeURIComponent(leagueCode)}`); lastSuccess = Date.now();
    if (!snapshot || next.revision !== snapshot.revision) { snapshot = next; render(); }
    else { byId("connection-state").textContent = "LIVE"; byId("connection-state").classList.remove("is-error"); }
  } catch (error) {
    if (error.status === 401) { byId("board-app").hidden = true; byId("login-panel").hidden = false; setStatus(byId("login-status"), "Draft Board sign-in expired. Enter the board code again.", true); }
    else { byId("connection-state").textContent = navigator.onLine ? "CONNECTION LOST" : "OFFLINE"; byId("connection-state").classList.add("is-error"); }
  } finally { refreshInFlight = false; }
}

async function openBoard(code) {
  leagueCode = normalizeLeagueCode(code); byId("league-code").value = leagueCode; attachChannel();
  let usingCache = false;
  try { snapshot = await request(`/api/draft-day/snapshot?role=board&league=${encodeURIComponent(leagueCode)}`); lastSuccess = Date.now(); }
  catch (error) {
    if (error.status === 401) throw error;
    try { snapshot = localStorage.getItem(verifierKey(leagueCode)) ? JSON.parse(localStorage.getItem(cacheKey()) || "null") : null; } catch { snapshot = null; }
    if (!snapshot) throw error; usingCache = true;
  }
  byId("login-panel").hidden = true; byId("board-app").hidden = false; render(); announceBoardPresence(); window.setInterval(() => void refresh(), 1_200); window.setInterval(announceBoardPresence, 2_000);
  if (usingCache) { byId("connection-state").textContent = "OFFLINE CACHE"; byId("connection-state").classList.add("is-error"); }
}

async function restoreBoardSession(value) {
  if (!value) return false;
  byId("login-panel").hidden = true;
  try {
    const code = normalizeLeagueCode(value); byId("league-code").value = code; setStatus(byId("login-status"), "Restoring Draft Board session…");
    await openBoard(code); localStorage.setItem(LAST_BOARD_LEAGUE_KEY, code); localStorage.setItem("pips-draft-day-last-league", code); return true;
  } catch (error) {
    byId("login-panel").hidden = false; setStatus(byId("login-status"), error.status === 401 ? "Enter the Draft Board code to open this league." : error.message, error.status !== 401); return false;
  }
}

byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); setStatus(byId("login-status"), "Opening the board…");
  try {
    const code = normalizeLeagueCode(byId("league-code").value);
    await request("/api/draft-day/auth", { method: "POST", body: JSON.stringify({ leagueCode: code, role: "board", code: byId("access-code").value }) });
    localStorage.setItem(verifierKey(code), await accessVerifier(byId("access-code").value));
    localStorage.setItem(LAST_BOARD_LEAGUE_KEY, code); localStorage.setItem("pips-draft-day-last-league", code); await openBoard(code);
  } catch (error) {
    try { const code = normalizeLeagueCode(byId("league-code").value); const verified = localStorage.getItem(verifierKey(code)) === await accessVerifier(byId("access-code").value); const cached = JSON.parse(localStorage.getItem(`pips-draft-day-board-${code}`) || "null"); if (verified && cached) { leagueCode = code; snapshot = cached; attachChannel(); byId("login-panel").hidden = true; byId("board-app").hidden = false; render(); byId("connection-state").textContent = "OFFLINE CACHE"; byId("connection-state").classList.add("is-error"); return; } } catch { /* Show the original sign-in error. */ }
    setStatus(byId("login-status"), error.message, true);
  }
});
byId("fullscreen-board").addEventListener("click", async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await byId("board-app").requestFullscreen(); });
window.addEventListener("offline", () => { byId("connection-state").textContent = "OFFLINE"; byId("connection-state").classList.add("is-error"); });
window.addEventListener("online", () => void refresh());
const initialLeague = query.get("league") || localStorage.getItem(LAST_BOARD_LEAGUE_KEY) || localStorage.getItem("pips-draft-day-last-league") || ""; byId("league-code").value = initialLeague;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../service-worker.js").catch(() => {});
void restoreBoardSession(initialLeague);
