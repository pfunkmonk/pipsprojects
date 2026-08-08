import { humanRehearsalStatus } from "./human-rehearsal.mjs?v=20260805g";
import { personalBoardEvidenceStatus } from "./personal-board-exchange.mjs?v=20260805g";

const EXPECTED_SEASON = 2026;
const EXPECTED_TEAMS = 12;
const EXPECTED_ROSTER_SIZE = 14;
const EXPECTED_MINIMUM_BID = 1;
const MINIMUM_PLAYER_POOL = EXPECTED_TEAMS * EXPECTED_ROSTER_SIZE;
const RECENT_PACK_HOURS = 24;
const RECENT_STATUS_HOURS = 2;
const RECENT_MORNING_INTELLIGENCE_HOURS = 6;
const RECENT_RECOVERY_HOURS = 24;

function finiteTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hoursSince(value, now) {
  const timestamp = finiteTimestamp(value);
  return timestamp === null ? Number.POSITIVE_INFINITY : Math.max(0, (now - timestamp) / 3_600_000);
}

function wholeHours(value) {
  if (!Number.isFinite(value)) return "unknown age";
  if (value < 1) return "under one hour old";
  return `${Math.floor(value)} hour${Math.floor(value) === 1 ? "" : "s"} old`;
}

function result(id, label, status, detail) {
  if (!["pass", "warning", "block"].includes(status)) throw new Error(`Unsupported readiness status '${status}'.`);
  return { id, label, status, detail };
}

function teamValues(state) {
  return state?.config?.teams?.map((team) => state.teams?.[team.id]).filter(Boolean) || [];
}

export function buildDraftReadinessReport({
  pack,
  state,
  mode = "draft-room",
  now = new Date().toISOString(),
  online = false,
  cloudReachable = false,
  ledgerGeneration = null,
  ledgerStale = false,
  offlineVerifierReady = false,
  displayBoardUrl = null,
  recoveryExportedAt = null,
  personalBoardDecisionCount = 0,
  personalBoardFingerprint = null,
  personalBoardBackupEvidence = null,
  liveStatusCapturedAt = null,
  liveStatusCount = 0,
  morningIntelligenceCapturedAt = null,
  morningIntelligencePackId = null,
  morningIntelligencePlayersScanned = 0,
  morningIntelligenceStaleSources = 0,
  humanRehearsalEvidence = null,
} = {}) {
  if (!pack || !state) throw new Error("Draft readiness requires the validated pack and replayed ledger state.");
  const nowTimestamp = finiteTimestamp(now);
  if (nowTimestamp === null) throw new Error("Draft readiness requires a valid current timestamp.");
  const checks = [];
  const teams = teamValues(state);
  const config = pack.leagueConfig || state.config;
  const ledgerConfigMatchesPack = JSON.stringify(state.config) === JSON.stringify(config);

  checks.push(mode === "draft-room"
    ? result("room-mode", "Real 2026 room", "pass", "This is the cloud-synchronized 2026 draft room.")
    : result("room-mode", "Real 2026 room", "block", `${mode === "practice-auction" ? "Auto-auction practice" : "2025 replay"} is isolated training mode, not the live ledger.`));

  const rulesExact = pack.season === EXPECTED_SEASON
    && config?.season === EXPECTED_SEASON
    && config?.teams?.length === EXPECTED_TEAMS
    && config?.rosterSize === EXPECTED_ROSTER_SIZE
    && config?.minimumBid === EXPECTED_MINIMUM_BID
    && ledgerConfigMatchesPack;
  checks.push(rulesExact
    ? result("league-contract", "League rules contract", "pass", "2026 · 12 teams · 14 roster spots · $1 minimum bid.")
    : result("league-contract", "League rules contract", "block", ledgerConfigMatchesPack
      ? "Season, team count, roster size, or minimum bid differs from the approved Thunder Bowl rules."
      : "The saved ledger configuration differs from the validated pack. Start a clean ledger before recording draft activity."));

  checks.push(pack.status === "production"
    ? result("pack-authority", "Promoted draft pack", "pass", `${pack.packId} is marked production.`)
    : result("pack-authority", "Promoted draft pack", "block", `${pack.packId} is a ${pack.status} pack. Refresh and promote the final dated pack before leaving for the draft.`));

  const keeperTeamIds = new Set((pack.keeperCandidates || []).map((candidate) => candidate.teamId));
  const poolCovered = pack.players?.length >= MINIMUM_PLAYER_POOL && keeperTeamIds.size === EXPECTED_TEAMS;
  checks.push(poolCovered
    ? result("pack-coverage", "Player and keeper coverage", "pass", `${pack.players.length} players and keeper evidence for all 12 teams.`)
    : result("pack-coverage", "Player and keeper coverage", "block", "The player pool is too small or keeper evidence does not cover every team."));

  const packAge = hoursSince(pack.asOf, nowTimestamp);
  checks.push(packAge <= RECENT_PACK_HOURS
    ? result("pack-freshness", "Pack freshness", "pass", `Pack is ${wholeHours(packAge)} (${new Date(pack.asOf).toLocaleString("en-US")}).`)
    : result("pack-freshness", "Pack freshness", "warning", `Pack is ${wholeHours(packAge)}. Refresh Footballguys, CBS, keepers, and team assets on draft morning.`));

  const sourcesDated = Array.isArray(pack.sources)
    && pack.sources.length >= 2
    && pack.sources.every((source) => finiteTimestamp(source.asOf) !== null && typeof source.authority === "string" && source.authority.length > 0);
  checks.push(sourcesDated
    ? result("source-provenance", "Source timestamps", "pass", `${pack.sources.length} source snapshots carry dates and authority labels.`)
    : result("source-provenance", "Source timestamps", "block", "A source is missing its timestamp or authority label."));

  const provisionalCaps = config.teams.filter((team) => team.capStatus === "provisional");
  checks.push(provisionalCaps.length === 0
    ? result("team-caps", "Starting team caps", "pass", "No team cap is marked provisional.")
    : result("team-caps", "Starting team caps", "warning", `${provisionalCaps.map((team) => team.name).join(", ")} still has a provisional starting cap.`));

  checks.push(config.nominationOrderStatus === "verified" && config.verifiedPrefixCount === EXPECTED_TEAMS
    ? result("nomination-order", "Nomination order", "pass", "All 12 positions are verified; the repeating snake can be trusted.")
    : result("nomination-order", "Nomination order", "warning", `Only ${config.verifiedPrefixCount || 0} of 12 starting positions are verified.`));

  const illegalTeam = teams.find((team) => team.roster.length > EXPECTED_ROSTER_SIZE
    || team.openSlots < 0
    || team.cash < team.openSlots * EXPECTED_MINIMUM_BID
    || team.legalMaxBid < 0);
  checks.push(!illegalTeam && teams.length === EXPECTED_TEAMS
    ? result("ledger-legality", "Local ledger legality", "pass", `${state.totalPlayers} rostered players; every team can still complete a legal roster.`)
    : result("ledger-legality", "Local ledger legality", "block", illegalTeam ? `${illegalTeam.name} cannot complete a legal roster.` : "The ledger does not contain exactly 12 teams."));

  if (ledgerStale) {
    checks.push(result("cloud-generation", "Cloud ledger generation", "block", "This tab belongs to an archived generation. Load the current cloud rehearsal before recording."));
  } else if (mode === "draft-room" && (!Number.isSafeInteger(ledgerGeneration) || ledgerGeneration < 1)) {
    checks.push(result("cloud-generation", "Cloud ledger generation", "block", "No current positive cloud-ledger generation is saved on this laptop."));
  } else {
    checks.push(result("cloud-generation", "Cloud ledger generation", "pass", mode === "draft-room" ? `Generation ${ledgerGeneration} is current.` : "Training ledger is intentionally local-only."));
  }

  checks.push(offlineVerifierReady
    ? result("offline-unlock", "Offline unlock", "pass", "This laptop has a saved local access verifier.")
    : result("offline-unlock", "Offline unlock", "block", "Sign in successfully while online on this laptop before draft day."));

  checks.push(displayBoardUrl
    ? result("projector-link", "Second-screen link", "pass", "A separately authorized public-board link is saved locally.")
    : result("projector-link", "Second-screen link", "warning", "Open or copy the public board once while online so the display link is saved."));

  const recoveryAge = hoursSince(recoveryExportedAt, nowTimestamp);
  checks.push(recoveryAge <= RECENT_RECOVERY_HOURS
    ? result("recovery-export", "Emergency recovery file", "pass", `The most recent download is ${wholeHours(recoveryAge)}.`)
    : result("recovery-export", "Emergency recovery file", "warning", recoveryExportedAt ? `The most recent download is ${wholeHours(recoveryAge)}.` : "No recovery download is recorded on this laptop yet."));

  const personalBoardBackup = personalBoardEvidenceStatus(personalBoardBackupEvidence, {
    season: EXPECTED_SEASON,
    decisionCount: personalBoardDecisionCount,
    fingerprint: personalBoardFingerprint,
    now,
  });
  checks.push(personalBoardBackup.current
    ? result("personal-board-backup", "Private personal-board transfer", "pass", personalBoardBackup.reason)
    : result("personal-board-backup", "Private personal-board transfer", "warning", `${personalBoardBackup.reason} Download private JSON in Admin & data, then import it on the MacBook.`));

  const statusAge = hoursSince(liveStatusCapturedAt, nowTimestamp);
  checks.push(statusAge <= RECENT_STATUS_HOURS && liveStatusCount >= 600
    ? result("live-status", "Current injury/depth snapshot", "pass", `${liveStatusCount} matched players; snapshot is ${wholeHours(statusAge)}.`)
    : result("live-status", "Current injury/depth snapshot", "warning", liveStatusCapturedAt ? `${liveStatusCount} matched players; snapshot is ${wholeHours(statusAge)}.` : "No saved live injury/depth snapshot is available."));

  const morningAge = hoursSince(morningIntelligenceCapturedAt, nowTimestamp);
  const morningComplete = morningIntelligencePackId === pack.packId
    && morningIntelligencePlayersScanned === pack.players.length
    && morningIntelligenceStaleSources === 0;
  checks.push(morningComplete && morningAge <= RECENT_MORNING_INTELLIGENCE_HOURS
    ? result("morning-intelligence", "Offline player-intelligence lockbox", "pass", `${morningIntelligencePlayersScanned} players scanned; lockbox is ${wholeHours(morningAge)}.`)
    : result("morning-intelligence", "Offline player-intelligence lockbox", "warning", morningIntelligenceCapturedAt
      ? `${morningIntelligencePlayersScanned} players scanned; lockbox is ${wholeHours(morningAge)}${morningIntelligenceStaleSources ? ` and used ${morningIntelligenceStaleSources} stale source${morningIntelligenceStaleSources === 1 ? "" : "s"}` : ""}. Run the full morning capture again.`
      : "No complete draft-morning player-intelligence capture is stored on this laptop."));

  const rehearsal = humanRehearsalStatus(humanRehearsalEvidence, config, { now });
  checks.push(rehearsal.current
    ? result("human-rehearsal", "Human-paced two-screen rehearsal", "pass", rehearsal.reason)
    : result("human-rehearsal", "Human-paced two-screen rehearsal", "warning", `${rehearsal.reason} Complete and seal the seven-step Admin checklist.`));

  checks.push(online && cloudReachable
    ? result("network-path", "Online synchronization", "pass", "The cloud path is reachable; offline fallback remains available.")
    : result("network-path", "Online synchronization", "warning", "Cloud is not currently reachable. Local drafting remains available, but reconnect before leaving if possible."));

  const blocks = checks.filter((check) => check.status === "block").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const passes = checks.length - blocks - warnings;
  return {
    schemaVersion: 1,
    generatedAt: new Date(nowTimestamp).toISOString(),
    packId: pack.packId,
    mode,
    overall: blocks ? "blocked" : warnings ? "review" : "ready",
    counts: { blocks, warnings, passes, total: checks.length },
    checks,
    modelEffect: "none",
    ledgerEffect: "none",
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function emergencyTeamCard(team, rosterSize) {
  const roster = [...team.players];
  while (roster.length < rosterSize) roster.push(null);
  const counts = ["QB", "RB", "WR", "TE", "K", "DST"].map((position) => `${position} ${team.positionCounts[position] || 0}`).join(" · ");
  const rows = roster.slice(0, rosterSize).map((player, index) => player
    ? `<tr><td>${index + 1}</td><td>${escapeHtml(player.playerName)}</td><td>${escapeHtml(player.position)}</td><td>$${Number(player.price)}</td></tr>`
    : `<tr class="blank"><td>${index + 1}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join("");
  const legalMaximum = Number(team.openSlots) > 0
    ? Math.max(0, Number(team.cash) - Math.max(0, Number(team.openSlots) - 1))
    : 0;
  return `<article class="team-card">
    <header><h2>${escapeHtml(team.name)}</h2><strong>$${Number(team.cash)} left</strong></header>
    <p class="team-meta">${team.openSlots} open · max $${legalMaximum} · ${escapeHtml(counts)}</p>
    <table><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>$</th></tr></thead><tbody>${rows}</tbody></table>
  </article>`;
}

export function buildEmergencyBoardHtml(snapshot, { packId, generatedAt = new Date().toISOString(), rosterSize = EXPECTED_ROSTER_SIZE } = {}) {
  if (!snapshot || snapshot.season !== EXPECTED_SEASON || !Array.isArray(snapshot.teams) || snapshot.teams.length !== EXPECTED_TEAMS) {
    throw new Error("Emergency board requires the validated 12-team 2026 public-safe snapshot.");
  }
  if (!Number.isSafeInteger(rosterSize) || rosterSize !== EXPECTED_ROSTER_SIZE) throw new Error("Emergency board roster size must be 14.");
  const timestamp = finiteTimestamp(generatedAt);
  if (timestamp === null) throw new Error("Emergency board requires a valid timestamp.");
  const cards = snapshot.teams.map((team) => emergencyTeamCard(team, rosterSize)).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Thunder Bowl 2026 Emergency Board</title>
<link rel="stylesheet" href="/thunder-bowl/emergency-print.css?v=20260805g"></head>
<body><header class="page-header"><div><p>THUNDER BOWL 2026</p><h1>Local emergency roster &amp; budget board</h1></div><div class="instructions"><strong>Print with Command-P</strong><span>Continue recording players and prices by hand if the application becomes unavailable.</span></div></header>
<dl class="snapshot-meta"><div><dt>Generated</dt><dd>${escapeHtml(new Date(timestamp).toLocaleString("en-US"))}</dd></div><div><dt>Pack</dt><dd>${escapeHtml(packId || "unknown")}</dd></div><div><dt>Rostered</dt><dd>${Number(snapshot.totalPlayers)} / ${EXPECTED_TEAMS * EXPECTED_ROSTER_SIZE}</dd></div><div><dt>Room cash</dt><dd>$${Number(snapshot.totalCash)}</dd></div></dl>
<main class="team-grid">${cards}</main>
<footer>Private local fallback · roster, price, cash, and position counts only · no projections or strategy</footer></body></html>`;
}
