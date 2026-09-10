(() => {
  "use strict";
  const PROTOCOL_VERSION = 2;
  const HELPER_VERSION = "0.10.4";
  const APP_SOURCE = "thunder-bowl-app";
  const DRAFT_DAY_APP_SOURCE = "pips-draft-day-app";
  const HELPER_SOURCE = "thunder-bowl-cbs-helper";
  const REQUEST = "THUNDER_BOWL_CBS_CAPTURE_REQUEST";
  const RESPONSE = "THUNDER_BOWL_CBS_CAPTURE_RESPONSE";
  const FBG_REQUEST = "THUNDER_BOWL_FBG_CAPTURE_REQUEST";
  const FBG_RESPONSE = "THUNDER_BOWL_FBG_CAPTURE_RESPONSE";
  const FANTASYPROS_REQUEST = "THUNDER_BOWL_FANTASYPROS_CAPTURE_REQUEST";
  const FANTASYPROS_RESPONSE = "THUNDER_BOWL_FANTASYPROS_CAPTURE_RESPONSE";
  const PFF_REQUEST = "THUNDER_BOWL_PFF_CAPTURE_REQUEST";
  const PFF_RESPONSE = "THUNDER_BOWL_PFF_CAPTURE_RESPONSE";
  const DRAFT_DAY_SETUP_REQUEST = "PIPS_DRAFT_DAY_CBS_SETUP_REQUEST";
  const DRAFT_DAY_SETUP_RESPONSE = "PIPS_DRAFT_DAY_CBS_SETUP_RESPONSE";
  const allowedOrigins = new Set(["https://pipsprojects.com", "http://localhost:8888"]);

  const sendRuntime = (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (result) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        const error = new Error(runtimeError.message || "The helper background worker stopped before answering.");
        error.transientHelperFailure = true;
        reject(error);
      }
      else resolve(result);
    });
  });

  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function sendStage(message) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await sendRuntime(message);
        if (!result?.ok) throw new Error(result?.error || "The helper stage failed safely.");
        return result;
      } catch (error) {
        lastError = error;
        if (!error?.transientHelperFailure || attempt === 2) throw error;
        await pause(250);
      }
    }
    throw lastError;
  }

  async function captureCbsInStages(data) {
    const common = { requestId: data.requestId, week: data.week, expectedHelperVersion: HELPER_VERSION };
    const roster = await sendStage({ ...common, action: "capture-cbs-roster-base" });
    if (!roster.snapshot) throw new Error("CBS returned no roster snapshot.");
    const schedule = await sendStage({ ...common, action: "capture-cbs-schedule" });
    if (!schedule.rawLeagueSchedule) throw new Error("CBS returned no league schedule.");
    const fab = await sendStage({ ...common, action: "capture-cbs-fab" });
    const preview = await sendStage({ ...common, action: "capture-cbs-preview", teams: roster.snapshot.teams });
    const weeklyProjections = [];
    const projectionErrors = [];
    for (const position of ["QB", "RB", "WR", "TE", "K", "DST"]) {
      try {
        const result = await sendStage({ ...common, action: "capture-cbs-position", position });
        if (!Array.isArray(result.rows) || !result.rows.length) throw new Error(`CBS returned no ${position} rows.`);
        weeklyProjections.push(...result.rows);
      } catch (error) {
        projectionErrors.push({ position, error: error?.message || String(error) });
      }
    }
    const safeProjectionCoverage = projectionErrors.length === 0 && weeklyProjections.length >= 100;
    return {
      ok: true,
      helperVersion: HELPER_VERSION,
      snapshot: {
        ...roster.snapshot,
        rawLeagueSchedule: schedule.rawLeagueSchedule,
        rawScoringPreview: preview.rawScoringPreview,
        ...(fab.fabState ? { fabState: fab.fabState } : {}),
        projectionCount: safeProjectionCoverage ? weeklyProjections.length : 0,
        ...(safeProjectionCoverage ? { weeklyProjections } : {}),
      },
    };
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== window.location.origin || !allowedOrigins.has(event.origin)) return;
    const thunderRequest = data?.source === APP_SOURCE && [REQUEST, FBG_REQUEST, FANTASYPROS_REQUEST, PFF_REQUEST].includes(data?.type);
    const draftDayRequest = data?.source === DRAFT_DAY_APP_SOURCE && data?.type === DRAFT_DAY_SETUP_REQUEST;
    if (!data || (!thunderRequest && !draftDayRequest) || data.protocolVersion !== PROTOCOL_VERSION || data.expectedHelperVersion !== HELPER_VERSION || typeof data.requestId !== "string") return;
    const isFbg = data.type === FBG_REQUEST;
    const isFantasyPros = data.type === FANTASYPROS_REQUEST;
    const isPff = data.type === PFF_REQUEST;
    const isDraftDaySetup = data.type === DRAFT_DAY_SETUP_REQUEST;
    const action = isDraftDaySetup ? "capture-draft-day-cbs-setup" : isFbg ? "capture-fbg-projections" : isFantasyPros ? "capture-fantasypros-projections" : isPff ? "capture-pff-projections" : "capture-cbs-rosters";
    const responseType = isDraftDaySetup ? DRAFT_DAY_SETUP_RESPONSE : isFbg ? FBG_RESPONSE : isFantasyPros ? FANTASYPROS_RESPONSE : isPff ? PFF_RESPONSE : RESPONSE;
    const post = (result, runtimeError = null) => window.postMessage({
      source: HELPER_SOURCE,
      type: responseType,
      protocolVersion: PROTOCOL_VERSION,
      helperVersion: HELPER_VERSION,
      requestId: data.requestId,
      ok: Boolean(result?.ok) && !runtimeError,
      snapshot: result?.snapshot,
      capture: result?.capture,
      setup: result?.setup,
      error: runtimeError?.message || result?.error,
    }, event.origin);
    chrome.runtime.sendMessage({ action: "helper-version" }, (versionResult) => {
      const versionError = chrome.runtime.lastError;
      if (versionError || versionResult?.helperVersion !== HELPER_VERSION) {
        post({ ok: false, error: "The Thunder Bowl Data Helper background worker is stale. Click Reload on the extension once, then retry." });
        return;
      }
      if (data.type === REQUEST) {
        captureCbsInStages(data).then((result) => post(result)).catch((error) => post({ ok: false, error: error?.message || String(error) }));
        return;
      }
      chrome.runtime.sendMessage({ action, requestId: data.requestId, week: data.week, expectedHelperVersion: HELPER_VERSION }, (result) => post(result, chrome.runtime.lastError));
    });
  });
})();
