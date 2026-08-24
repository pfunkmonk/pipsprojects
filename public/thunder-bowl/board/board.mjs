import { createDataSource } from "../shared/data-source.mjs";
import { assertPublicSnapshot, downloadBoardCsv, orderedTeamAssignments, teamSummary } from "../shared/public-core.mjs";
import { PROJECTOR_STALE_AFTER_MS, writeProjectorPresence } from "../shared/projector-presence.mjs";
import { clockFromSnapshot, formatNominationClock } from "../shared/nomination-clock.mjs?v=20260808-cloud";
import { calculateBoardGeometry } from "./board-layout.mjs";

const source = createDataSource("board");
const OFFLINE_SNAPSHOT_KEY = "thunder-bowl-public-board-snapshot-v1";
const app = document.getElementById("board-app");
const board = document.getElementById("team-board");
const status = document.getElementById("board-status");
const connection = document.getElementById("connection-state");
let snapshot = null;
let refreshInFlight = false;
let visibleRosterRows = 0;
let lastSuccessfulRefresh = 0;
let lastRefreshError = null;
let renderedRevision = null;
const knownAuctionSaleIds = new Set();
let spotlightTimer = null;

function splitName(name) {
  const bits = name.trim().split(/\s+/);
  return bits.length === 1 ? ["", name] : [`${bits[0][0]}.`, bits.slice(1).join(" ")];
}

function sticker(assignment, isNew = false) {
  const [first, last] = splitName(assignment.playerName);
  const byeLabel = Number.isInteger(assignment.byeWeek) ? `BYE ${assignment.byeWeek}` : "BYE —";
  const element = document.createElement("article");
  element.className = `player-sticker${assignment.acquisitionType === "keeper" ? " is-keeper" : ""}${isNew ? " is-new-sale" : ""}`;
  element.dataset.assignmentId = assignment.id;
  element.dataset.pos = assignment.position;
  element.setAttribute("aria-label", `${assignment.playerName}, ${assignment.position}, ${assignment.nflTeam}, ${byeLabel.toLowerCase()}, $${assignment.price}${assignment.contractYear ? `, keeper year ${assignment.contractYear}` : ""}`);
  const meta = document.createElement("span");
  meta.className = "sticker-meta";
  const playerMeta = document.createElement("span");
  playerMeta.textContent = `${assignment.position} · ${assignment.nflTeam} · ${byeLabel}`;
  const price = document.createElement("b");
  price.textContent = `$${assignment.price}`;
  meta.append(playerMeta, price);
  const name = document.createElement("span");
  name.className = "player-name";
  const firstName = document.createElement("small");
  firstName.textContent = first;
  name.append(firstName, document.createTextNode(last));
  element.append(meta, name);
  if (assignment.contractYear) {
    const keeper = document.createElement("span");
    keeper.className = "keeper-tag";
    keeper.textContent = `K · Y${assignment.contractYear}`;
    element.append(keeper);
  }
  return element;
}

function sizeBoard() {
  if (!snapshot || !visibleRosterRows) return;
  const topbar = app.querySelector(".board-topbar");
  const footer = document.getElementById("board-status");
  const lastSale = document.getElementById("last-sale-strip");
  const fullBoardHeight = app.clientHeight - topbar.offsetHeight - lastSale.offsetHeight - footer.offsetHeight;
  const geometry = calculateBoardGeometry({
    availableHeight: fullBoardHeight,
    boardWidth: board.clientWidth,
    teamCount: snapshot.teams.length,
    totalRosterRows: snapshot.rosterSize,
    visibleRosterRows,
  });
  board.style.height = `${geometry.boardHeight}px`;
  board.style.setProperty("--team-column-width", `${geometry.teamColumnWidth}px`);
  board.style.setProperty("--roster-row-height", `${geometry.rosterRowHeight}px`);
  board.style.setProperty("--header-row-height", `${geometry.headerRowHeight}px`);
}

function activeAuctionSales() {
  return (snapshot?.assignments || [])
    .filter((assignment) => assignment.status === "active" && assignment.acquisitionType === "auction")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function renderLiveStatus(auctionSales = activeAuctionSales()) {
  const time = new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  status.textContent = `Updated ${time} · ${auctionSales.length} sold · ${averageSalePace(auctionSales)} · Keepers pinned at the top`;
  connection.textContent = "LIVE";
  connection.classList.remove("is-error");
}

function render() {
  assertPublicSnapshot(snapshot);
  board.replaceChildren();
  board.style.gridTemplateColumns = `repeat(${snapshot.teams.length}, minmax(0, 1fr))`;
  const maximumAuctionRows = Math.max(0, ...snapshot.teams.map((team) =>
    orderedTeamAssignments(snapshot, team.id).filter((assignment) => assignment.acquisitionType === "auction").length));
  visibleRosterRows = Math.min(snapshot.rosterSize, snapshot.keeperSlots + maximumAuctionRows);
  const auctionSales = activeAuctionSales();
  const isSubsequentUpdate = renderedRevision !== null && snapshot.revision !== renderedRevision;
  const newSale = isSubsequentUpdate ? auctionSales.find((sale) => !knownAuctionSaleIds.has(sale.id)) : null;
  const newSaleId = newSale?.id || null;
  for (const team of snapshot.teams) {
    const summary = teamSummary(snapshot, team.id);
    const assignments = orderedTeamAssignments(snapshot, team.id);
    const keepers = assignments.filter((assignment) => assignment.acquisitionType === "keeper").slice(0, snapshot.keeperSlots);
    const auction = assignments.filter((assignment) => assignment.acquisitionType === "auction");
    const slots = [...keepers, ...Array(Math.max(0, snapshot.keeperSlots - keepers.length)).fill(null), ...auction];
    while (slots.length < visibleRosterRows) slots.push(null);

    const column = document.createElement("section");
    column.className = "team-column";
    const isNominating = team.id === snapshot.currentNominatorTeamId && !snapshot.stagedNomination && !summary.isFinished;
    column.classList.toggle("is-nominating", isNominating);
    if (isNominating) column.setAttribute("aria-label", `${team.name} is nominating now`);
    column.style.gridTemplateRows = `1.42fr repeat(${visibleRosterRows}, minmax(0, 1fr))`;
    const header = document.createElement("header");
    header.className = "team-header";
    if (team.logoUrl) {
      const logo = document.createElement("img");
      logo.className = "team-logo";
      logo.src = team.logoUrl;
      logo.alt = "";
      logo.referrerPolicy = "no-referrer";
      logo.decoding = "async";
      header.append(logo);
    }
    const teamName = document.createElement("h2");
    teamName.textContent = team.name;
    const capLeft = document.createElement("div");
    capLeft.className = "cap-left";
    capLeft.textContent = `$${summary.remainingCap} LEFT`;
    const teamMeta = document.createElement("div");
    teamMeta.className = "team-meta";
    teamMeta.textContent = summary.isFinished ? `FINISHED • $${summary.remainingCap} UNSPENT` : isNominating ? `NOMINATING NOW • MAX $${summary.legalMaxBid}` : `MAX $${summary.legalMaxBid} • UP TO ${summary.openSlots} MORE`;
    header.classList.toggle("is-finished", summary.isFinished);
    header.append(teamName, capLeft, teamMeta);
    column.append(header);
    slots.slice(0, visibleRosterRows).forEach((assignment, index) => {
      const slot = document.createElement("div");
      slot.className = `roster-slot${index === snapshot.keeperSlots - 1 ? " keeper-boundary" : ""}`;
      if (assignment) slot.append(sticker(assignment, assignment.id === newSaleId));
      column.append(slot);
    });
    board.append(column);
  }
  sizeBoard();
  renderLiveStatus(auctionSales);
  const lastSaleItems = document.getElementById("last-sale-items");
  lastSaleItems.replaceChildren();
  const recentSales = auctionSales.slice(0, 3);
  if (!recentSales.length) {
    const item = document.createElement("li");
    item.textContent = "No auction purchases recorded yet";
    lastSaleItems.append(item);
  } else {
    recentSales.forEach((sale, index) => {
      const item = document.createElement("li");
      const rank = document.createElement("b");
      rank.textContent = index === 0 ? "NEW" : `${index + 1}`;
      item.append(rank, document.createTextNode(`${sale.playerName} → ${snapshot.teams.find((team) => team.id === sale.teamId)?.name || sale.teamId} · $${sale.price}`));
      lastSaleItems.append(item);
    });
  }
  const nominationBanner = document.getElementById("nominated-player");
  const nominatedText = document.getElementById("nominated-player-text");
  nominationBanner.hidden = !snapshot.stagedNomination;
  if (snapshot.stagedNomination) {
    nominatedText.textContent = snapshot.stagedNomination.name;
    document.getElementById("nominated-player-detail").textContent = `${snapshot.stagedNomination.position} · ${snapshot.stagedNomination.nflTeam}`;
  }
  if (newSale) showSaleSpotlight(newSale);
  auctionSales.forEach((sale) => knownAuctionSaleIds.add(sale.id));
  renderedRevision = snapshot.revision;
}

function showSaleSpotlight(assignment) {
  const spotlight = document.getElementById("sale-spotlight");
  document.getElementById("spotlight-player").textContent = assignment.playerName;
  document.getElementById("spotlight-result").textContent = `${snapshot.teams.find((team) => team.id === assignment.teamId)?.name || assignment.teamId} · $${assignment.price}`;
  spotlight.hidden = false;
  if (spotlightTimer) window.clearTimeout(spotlightTimer);
  spotlightTimer = window.setTimeout(() => { spotlight.hidden = true; }, 2400);
}

function renderClock() {
  const state = clockFromSnapshot(snapshot?.clock);
  const clock = document.getElementById("board-clock");
  clock.querySelector("strong").textContent = formatNominationClock(state.remainingMs);
  clock.querySelector("span").textContent = state.remainingMs <= 0 ? "TIME" : state.status.toUpperCase();
  clock.classList.toggle("is-expired", state.remainingMs <= 0);
}

function averageSalePace(sales) {
  if (sales.length < 2) return "pace starts after the second sale";
  const times = sales.map((sale) => Date.parse(sale.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
  if (times.length < 2) return "pace unavailable";
  const seconds = Math.max(1, Math.round((times.at(-1) - times[0]) / 1000 / (times.length - 1)));
  return `average ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} per sale`;
}

function projectionFits() {
  return app.scrollWidth <= app.clientWidth + 1
    && app.scrollHeight <= app.clientHeight + 1
    && board.scrollWidth <= board.clientWidth + 1
    && board.scrollHeight <= board.clientHeight + 1;
}

function updateReliability() {
  const dataFresh = Boolean(lastSuccessfulRefresh && Date.now() - lastSuccessfulRefresh <= PROJECTOR_STALE_AFTER_MS && !lastRefreshError);
  const warning = document.getElementById("stale-board-warning");
  warning.hidden = dataFresh;
  if (!dataFresh) {
    connection.textContent = "CONNECTION LOST";
    connection.classList.add("is-error");
  } else if (snapshot) {
    renderLiveStatus();
  }
  writeProjectorPresence({
    dataFresh,
    revision: snapshot?.revision ?? null,
    fullscreen: Boolean(document.fullscreenElement),
    noOverflow: projectionFits(),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    visibleRosterRows,
  });
}

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const next = await source.snapshot();
    try { localStorage.setItem(OFFLINE_SNAPSHOT_KEY, JSON.stringify(next)); } catch { /* The live board remains usable without persistence. */ }
    lastSuccessfulRefresh = Date.now();
    lastRefreshError = null;
    if (!snapshot || next.revision !== snapshot.revision) {
      snapshot = next;
      render();
    }
  } catch (error) {
    lastRefreshError = error;
    if (error?.status === 401 && !new URLSearchParams(window.location.search).has("demo")) {
      window.location.replace("/thunder-bowl/draft-board/");
      return;
    }
    if (!snapshot) {
      try {
        const cached = JSON.parse(localStorage.getItem(OFFLINE_SNAPSHOT_KEY) || "null");
        if (cached) {
          snapshot = assertPublicSnapshot(cached);
          render();
        }
      } catch { /* A malformed cache is ignored; the board fails visibly. */ }
    }
    connection.textContent = "OFFLINE";
    connection.classList.add("is-error");
    status.textContent = error.message;
  } finally {
    refreshInFlight = false;
    updateReliability();
  }
}

document.getElementById("fullscreen-board").addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await app.requestFullscreen();
});
document.addEventListener("fullscreenchange", updateReliability);
document.getElementById("export-board").addEventListener("click", () => snapshot && downloadBoardCsv(snapshot));
document.getElementById("print-board").addEventListener("click", () => window.print());
source.subscribe(() => void refresh());
window.addEventListener("resize", () => { sizeBoard(); updateReliability(); });
window.setInterval(updateReliability, 1000);
window.setInterval(renderClock, 250);
renderClock();
void refresh();
