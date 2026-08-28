import { assertLeagueLegality, assertPublicSnapshot, currentBoardCsv } from "./public-core.mjs";
import { projectorPresenceIsFresh } from "./projector-presence.mjs";

const PRIVATE_FIELD_PATTERN = /^(vbd|projectedpoints|marketvalue|maxbid|personalmax|stealprice|tag|tags|note|notes|tier|target|avoid|research|keepersurplus)$/i;

function containsPrivateField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsPrivateField);
  return Object.entries(value).some(([key, child]) => PRIVATE_FIELD_PATTERN.test(key) || containsPrivateField(child));
}

function check(id, label, ok, detail) {
  return { id, label, ok: Boolean(ok), detail };
}

export function evaluateDraftReadiness(snapshot, presence, options = {}) {
  const expectedTeamCount = options.expectedTeamCount ?? 12;
  const checks = [];
  let structureError = null;
  try {
    assertPublicSnapshot(snapshot);
    assertLeagueLegality(snapshot);
  } catch (error) {
    structureError = error.message;
  }

  checks.push(check("cloud", "Live auction data", options.cloudReady && !structureError, structureError || "Cloud snapshot loaded and league rules pass."));
  const uniqueTeamIds = new Set(snapshot?.teams?.map((team) => team.id) || []);
  checks.push(check("teams", "Nomination-order teams", snapshot?.teams?.length === expectedTeamCount && uniqueTeamIds.size === expectedTeamCount,
    `${snapshot?.teams?.length || 0} of ${expectedTeamCount} unique teams loaded in server order.`));

  const keeperOverflow = snapshot?.teams?.find((team) => snapshot.assignments.filter((assignment) => assignment.status === "active" && assignment.teamId === team.id && assignment.acquisitionType === "keeper").length > snapshot.keeperSlots);
  checks.push(check("keepers", "Keeper setup", !keeperOverflow, keeperOverflow ? `${keeperOverflow.name} exceeds the keeper-row limit.` : "Keeper assignments fit the reserved rows."));
  const activeKeeperCount = snapshot?.assignments?.filter((assignment) => assignment.status === "active" && assignment.acquisitionType === "keeper").length || 0;
  checks.push(check("keeper-finalization", "Final keeper authority", snapshot?.keepersFinalized === true,
    snapshot?.keepersFinalized === true ? `${activeKeeperCount} active keepers are organizer-locked and auctioneer read-only.` : "Finalize the official keeper set in the private Command Center before draft day."));
  checks.push(check("players", "Public player search", Array.isArray(snapshot?.availablePlayers) && snapshot.availablePlayers.length > 0,
    `${snapshot?.availablePlayers?.length || 0} sanitized players available.`));
  checks.push(check("privacy", "Public-data privacy boundary", snapshot && !containsPrivateField(snapshot),
    snapshot && !containsPrivateField(snapshot) ? "No private evaluation field names detected." : "A private evaluation field name was detected."));

  let csvOk;
  try { csvOk = currentBoardCsv(snapshot).startsWith('"Team","Player","Draft Price","Contract Year"'); } catch { csvOk = false; }
  checks.push(check("csv", "CSV export", csvOk, csvOk ? "Corrected active assignments export in the required format." : "CSV generation failed."));

  const projectorFresh = projectorPresenceIsFresh(presence);
  checks.push(check("projector", "Projector heartbeat", projectorFresh && presence?.dataFresh,
    !projectorFresh ? "No current projector heartbeat." : presence?.dataFresh ? `Projector is displaying revision ${presence.revision}.` : "Projector is open but its auction data is stale."));
  checks.push(check("fit", "Projection fits the screen", projectorFresh && presence?.noOverflow,
    presence ? `${presence.viewportWidth || "?"}×${presence.viewportHeight || "?"} · ${presence.noOverflow ? "no overflow" : "overflow detected"}.` : "Open the projector board to measure it."));
  checks.push(check("fullscreen", "Projector full screen", projectorFresh && presence?.fullscreen,
    presence?.fullscreen ? "Full-screen projection is active." : "Put the projector board into full screen."));
  checks.push(check("sound", "Confirmation sound", options.audioConfirmed, options.audioConfirmed ? "Sound confirmed by the auctioneer." : "Use Test sound, then confirm you heard it."));
  checks.push(check("zoom", "Projector zoom at 100%", options.zoomConfirmed, options.zoomConfirmed ? "Browser zoom confirmed manually." : "Confirm the projector browser zoom is 100%."));

  return { ready: checks.every((item) => item.ok), passed: checks.filter((item) => item.ok).length, total: checks.length, checks };
}
