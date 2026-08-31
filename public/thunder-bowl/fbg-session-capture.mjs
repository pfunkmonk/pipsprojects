export const FBG_CAPTURE_PROTOCOL_VERSION = 1;
export const FBG_CAPTURE_REQUEST = "THUNDER_BOWL_FBG_CAPTURE_REQUEST";
export const FBG_CAPTURE_RESPONSE = "THUNDER_BOWL_FBG_CAPTURE_RESPONSE";
export const FBG_APP_SOURCE = "thunder-bowl-app";
export const FBG_HELPER_SOURCE = "thunder-bowl-cbs-helper";
export const FBG_CAPTURE_SOURCE = "Footballguys authenticated weekly projections download";
export const FBG_CAPTURE_MODEL_EFFECT = "none";

const FBG_ORIGIN = "https://www.footballguys.com";
const NATIVE_HEADER = "id,name,pos,team,set-id,set-userid,set-name,ssn-gms,ssn-ssn,pass-2pt,pass-att,pass-cmp,pass-1d,pass-int,pass-sck,pass-td,pass-yds,rush-2pt,rush-car,rush-1d,rush-td,rush-yds,rec-2pt,rec-1d,rec-rec,rec-tgt,rec-td,rec-yds,fum-lost,kck-xpa,kck-xpc,kck-xpm,kck-fga,kck-fgc,kck-fgm,idp-2pr,idp-ast,idp-blk,idp-fmr,idp-fmf,idp-int,idp-pd,idp-sck,idp-saf,idp-tac,idp-tfl,idp-td,tmd-2pr,tmd-blk,tmd-fmf,tmd-fmr,tmd-int,tmd-pa,tmd-sck,tmd-saf,tmd-td,tmd-ya,pr-td,pr-yds,kr-td,kr-yds";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateFbgSessionCapture(input, { expectedSeason = 2026, expectedWeek = null } = {}) {
  assert(isPlainObject(input), "Footballguys account capture is not an object.");
  assert(input.schemaVersion === 1, "Footballguys account capture has an unsupported schema.");
  assert(input.source === FBG_CAPTURE_SOURCE, "Footballguys account capture has an unexpected source.");
  assert(input.modelEffect === FBG_CAPTURE_MODEL_EFFECT, "Footballguys account capture attempted to gain model authority.");
  assert(input.authenticated === true && input.accountLeague === "Thunder Bowl", "Footballguys did not confirm the signed-in Thunder Bowl subscriber view.");
  assert(Number.isFinite(Date.parse(input.capturedAt)), "Footballguys account capture has an invalid timestamp.");
  assert(Number.isFinite(Date.parse(input.providerAsOf)), "Footballguys account capture has an invalid provider timestamp.");
  assert(input.season === expectedSeason, `Footballguys account capture is for ${input.season || "an unknown season"}, not ${expectedSeason}.`);
  assert(Number.isSafeInteger(input.week) && input.week >= 1 && input.week <= 18, "Footballguys account capture has an invalid week.");
  if (expectedWeek !== null) assert(input.week === expectedWeek, `Footballguys account capture is for Week ${input.week}, not Week ${expectedWeek}.`);
  const pageUrl = new URL(input.pageUrl);
  const downloadUrl = new URL(input.downloadUrl);
  assert(pageUrl.origin === FBG_ORIGIN && pageUrl.pathname === "/projections/duration/weekly", "Footballguys account capture came from the wrong projection page.");
  assert(downloadUrl.origin === FBG_ORIGIN && downloadUrl.pathname === `/projections/download/weekly/all/${expectedSeason}/${input.week}`, "Footballguys account capture came from the wrong download.");
  assert(typeof input.csv === "string" && input.csv.length > NATIVE_HEADER.length && input.csv.length <= 2_000_000, "Footballguys account capture is not a safe CSV download.");
  assert(input.csv.replace(/^\uFEFF/, "").startsWith(`${NATIVE_HEADER}\n`) || input.csv.replace(/^\uFEFF/, "").startsWith(`${NATIVE_HEADER}\r\n`), "Footballguys changed its official weekly download columns; account capture stopped safely.");
  return input;
}

export function requestFbgProjectionCapture({ targetWindow = window, origin = window.location.origin, timeoutMs = 45_000, week = 1 } = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      targetWindow.removeEventListener("message", onMessage);
      reject(new Error("The updated helper did not answer the Footballguys request. Install or reload the current Thunder Bowl Data Helper, then try again."));
    }, timeoutMs);
    function onMessage(event) {
      const data = event.data;
      if (event.source !== targetWindow || event.origin !== origin || !isPlainObject(data)) return;
      if (data.source !== FBG_HELPER_SOURCE || data.type !== FBG_CAPTURE_RESPONSE || data.protocolVersion !== FBG_CAPTURE_PROTOCOL_VERSION || data.requestId !== requestId) return;
      clearTimeout(timeout);
      targetWindow.removeEventListener("message", onMessage);
      if (!data.ok) reject(new Error(typeof data.error === "string" ? data.error : "Footballguys helper could not capture the member projections."));
      else resolve(validateFbgSessionCapture(data.capture, { expectedWeek: week }));
    }
    targetWindow.addEventListener("message", onMessage);
    targetWindow.postMessage({
      source: FBG_APP_SOURCE,
      type: FBG_CAPTURE_REQUEST,
      protocolVersion: FBG_CAPTURE_PROTOCOL_VERSION,
      requestId,
      week,
    }, origin);
  });
}
