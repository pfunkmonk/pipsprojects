const LAST_LEAGUE_KEYS = Object.freeze({
  organizer: "pips-draft-day-last-organizer-league",
  auctioneer: "pips-draft-day-last-auctioneer-league",
  board: "pips-draft-day-last-board-league",
});

const SHARED_LAST_LEAGUE_KEY = "pips-draft-day-last-league";
const OFFLINE_ROLES = new Set(["auctioneer", "board"]);

function roleKey(role) {
  const key = LAST_LEAGUE_KEYS[role];
  if (!key) throw new Error("Draft Day browser role is invalid.");
  return key;
}

export function verifierKey(role, leagueCode) {
  if (!OFFLINE_ROLES.has(role)) throw new Error("That Draft Day role does not use an offline verifier.");
  return `pips-draft-day-${role}-verifier-${leagueCode}`;
}

export function rememberLeague(storage, role, leagueCode) {
  try {
    storage.setItem(roleKey(role), leagueCode);
    storage.setItem(SHARED_LAST_LEAGUE_KEY, leagueCode);
  } catch { /* A live session remains usable when browser persistence is unavailable. */ }
}

export function rememberedLeague(storage, role) {
  try { return storage.getItem(roleKey(role)) || storage.getItem(SHARED_LAST_LEAGUE_KEY) || ""; }
  catch { return ""; }
}

export function saveVerifier(storage, role, leagueCode, verifier) {
  try { storage.setItem(verifierKey(role, leagueCode), verifier); }
  catch { /* Offline fallback is unavailable, but the live authenticated session still works. */ }
}

export function savedVerifier(storage, role, leagueCode) {
  try { return storage.getItem(verifierKey(role, leagueCode)); }
  catch { return null; }
}

export function clearRememberedAccess(storage, leagueCode = "") {
  try {
    for (const key of [...Object.values(LAST_LEAGUE_KEYS), SHARED_LAST_LEAGUE_KEY]) storage.removeItem(key);
    if (leagueCode) {
      for (const role of OFFLINE_ROLES) storage.removeItem(verifierKey(role, leagueCode));
    }
  } catch { /* The server cookie remains the authoritative logout boundary. */ }
}
