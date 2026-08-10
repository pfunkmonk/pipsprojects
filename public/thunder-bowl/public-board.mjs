import { POSITIONS, replayDraft, toPublicSnapshot } from "./state-engine.mjs?v=20260810b";

const byId = (id) => document.getElementById(id);
const currency = (value) => `$${Math.round(Number(value) || 0).toLocaleString("en-US")}`;
const teamBoard = byId("team-board");
const displayLogin = byId("display-login");
const displayForm = byId("display-login-form");
const displayTokenInput = byId("display-token");
const connectionChip = byId("public-connection");
const CACHE_KEY = "tb26LastPublicSnapshot";
const TOKEN_KEY = "tb26DisplayToken";
const PUBLIC_TEAM_ORDER = [
  "orange-crush", "the-hobbits", "crime-and-punishment", "t-dogs",
  "super-suckers", "angry-face", "goon-skwad", "dogs-of-war",
  "el-guapo", "the-bungles", "big-head", "three-amigos",
];

let displayToken = new URL(window.location.href).searchParams.get("token") || localStorage.getItem(TOKEN_KEY) || "";
let snapshot = toPublicSnapshot(replayDraft([]));
let etag = null;
let pollTimer = null;
let lastSuccessAt = null;
let requestInFlight = false;
const draftChannel = "BroadcastChannel" in window ? new BroadcastChannel("thunder-bowl-2026") : null;

function setConnection(message, status = "warning") {
  connectionChip.textContent = message;
  connectionChip.classList.toggle("status-good", status === "good");
  connectionChip.classList.toggle("status-warning", status === "warning");
  connectionChip.classList.toggle("status-danger", status === "danger");
}

function positionLine(counts) {
  return POSITIONS.map((position) => `${position} ${counts[position] || 0}`).join(" · ");
}

function playerRow(player) {
  const row = document.createElement("article");
  row.className = "public-player";
  const kind = document.createElement("span");
  kind.className = `public-player-kind is-${player.acquisitionType === "keeper" ? "keeper" : "draft"}`;
  kind.textContent = player.acquisitionType === "keeper" ? "KEEP" : "DRAFT";
  const label = document.createElement("strong");
  label.textContent = player.playerName;
  const position = document.createElement("span");
  position.className = "public-player-position";
  position.textContent = player.position;
  const price = document.createElement("span");
  price.className = "public-price";
  price.textContent = currency(player.price);
  row.append(kind, label, position, price);
  return row;
}

function teamCard(team) {
  const card = document.createElement("article");
  card.className = `team-card${team.id === "dogs-of-war" ? " is-dogs" : ""}`;
  const header = document.createElement("header");
  header.className = "team-card-header";
  const titleLine = document.createElement("div");
  titleLine.className = "team-card-title";
  const finish = document.createElement("span");
  finish.className = "team-finish";
  finish.textContent = `#${team.finish || "–"}`;
  const title = document.createElement("h2");
  title.textContent = team.name;
  titleLine.append(finish, title);
  const budgets = document.createElement("div");
  budgets.className = "team-budgets";
  const starting = document.createElement("span");
  const startingLabel = document.createElement("small");
  startingLabel.textContent = "START";
  const startingValue = document.createElement("strong");
  startingValue.textContent = currency(team.startingCap ?? (team.cash + team.spent));
  starting.append(startingLabel, startingValue);
  const current = document.createElement("span");
  current.className = "team-cash";
  const currentLabel = document.createElement("small");
  currentLabel.textContent = "CURRENT";
  const currentValue = document.createElement("strong");
  currentValue.textContent = currency(team.cash);
  current.append(currentLabel, currentValue);
  budgets.append(starting, current);
  const meta = document.createElement("div");
  meta.className = "team-card-meta";
  const rosterCount = document.createElement("span");
  rosterCount.textContent = `${team.rosterCount}/14 players`;
  const positions = document.createElement("span");
  positions.className = "position-counts";
  positions.textContent = positionLine(team.positionCounts);
  meta.append(rosterCount, positions);
  header.append(titleLine, budgets, meta);

  const roster = document.createElement("div");
  roster.className = "public-roster";
  if (team.players.length) {
    team.players.forEach((player) => roster.append(playerRow(player)));
  } else {
    const empty = document.createElement("div");
    empty.className = "public-empty";
    empty.textContent = "Waiting for keepers";
    roster.append(empty);
  }
  card.append(header, roster);
  return card;
}

function render() {
  teamBoard.replaceChildren();
  const orderIndex = new Map(PUBLIC_TEAM_ORDER.map((teamId, index) => [teamId, index]));
  [...snapshot.teams]
    .sort((left, right) => (Number(left.finish) || orderIndex.get(left.id) + 1) - (Number(right.finish) || orderIndex.get(right.id) + 1))
    .forEach((team, index) => teamBoard.append(teamCard({ ...team, finish: index + 1 })));
  byId("public-nominator").textContent = snapshot.currentNominator?.name || (snapshot.status === "complete" ? "Draft complete" : "Waiting");
  byId("public-last-sale").textContent = snapshot.lastSale
    ? `${snapshot.lastSale.playerName} ${currency(snapshot.lastSale.amount)}`
    : "—";
  byId("public-room-cash").textContent = currency(snapshot.totalCash);
  const updateTime = snapshot.updatedAt ? new Date(snapshot.updatedAt) : lastSuccessAt;
  byId("public-updated").textContent = updateTime
    ? `Updated ${updateTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
    : "No live update received";
}

function saveSnapshot(value) {
  snapshot = value;
  localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  render();
}

function loadCachedSnapshot() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cached?.schemaVersion === 1 && Array.isArray(cached.teams) && cached.teams.length === 12) snapshot = cached;
  } catch {
    localStorage.removeItem(CACHE_KEY);
  }
  render();
}

async function fetchSnapshot() {
  if (!displayToken || requestInFlight) return;
  requestInFlight = true;
  try {
    const headers = etag ? { "If-None-Match": etag } : {};
    const response = await fetch(`/api/thunder-bowl/public?token=${encodeURIComponent(displayToken)}`, {
      cache: "no-store",
      headers,
    });
    if (response.status === 304) {
      lastSuccessAt = new Date();
      setConnection("Live", "good");
      return;
    }
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem(TOKEN_KEY);
      displayToken = "";
      showDisplayLogin("That display token is not valid.", true);
      return;
    }
    if (!response.ok) throw new Error(`Public sync returned ${response.status}.`);
    etag = response.headers.get("ETag") || etag;
    lastSuccessAt = new Date();
    saveSnapshot(await response.json());
    setConnection("Live", "good");
  } catch {
    setConnection(navigator.onLine ? "Reconnecting…" : "Offline — last board retained", "warning");
  } finally {
    requestInFlight = false;
  }
}

function showDisplayLogin(message = "", error = false) {
  displayLogin.hidden = false;
  teamBoard.hidden = true;
  byId("display-login-status").textContent = message;
  byId("display-login-status").classList.toggle("is-error", error);
  displayTokenInput.focus();
}

function openBoard() {
  displayLogin.hidden = true;
  teamBoard.hidden = false;
  localStorage.setItem(TOKEN_KEY, displayToken);
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("token");
  history.replaceState(null, "", cleanUrl);
  void fetchSnapshot();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") void fetchSnapshot();
  }, 1000);
}

displayForm.addEventListener("submit", (event) => {
  event.preventDefault();
  displayToken = displayTokenInput.value.trim();
  if (!displayToken) return;
  displayTokenInput.value = "";
  openBoard();
});

byId("public-fullscreen").addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    setConnection("Full-screen request blocked", "warning");
  }
});
byId("public-print").addEventListener("click", () => window.print());
window.addEventListener("online", () => void fetchSnapshot());
window.addEventListener("offline", () => setConnection("Offline — last board retained", "warning"));
draftChannel?.addEventListener("message", (event) => {
  if (displayToken && event.data?.type === "PUBLIC_SNAPSHOT" && event.data.snapshot?.teams?.length === 12) {
    saveSnapshot(event.data.snapshot);
    setConnection(navigator.onLine ? "Live · local update" : "Local update", "good");
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch(() => null);
loadCachedSnapshot();
if (displayToken) openBoard();
else showDisplayLogin();
