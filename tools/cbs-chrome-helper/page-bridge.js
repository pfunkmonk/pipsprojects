(() => {
  "use strict";
  const PROTOCOL_VERSION = 1;
  const APP_SOURCE = "thunder-bowl-app";
  const HELPER_SOURCE = "thunder-bowl-cbs-helper";
  const REQUEST = "THUNDER_BOWL_CBS_CAPTURE_REQUEST";
  const RESPONSE = "THUNDER_BOWL_CBS_CAPTURE_RESPONSE";
  const FBG_REQUEST = "THUNDER_BOWL_FBG_CAPTURE_REQUEST";
  const FBG_RESPONSE = "THUNDER_BOWL_FBG_CAPTURE_RESPONSE";
  const FANTASYPROS_REQUEST = "THUNDER_BOWL_FANTASYPROS_CAPTURE_REQUEST";
  const FANTASYPROS_RESPONSE = "THUNDER_BOWL_FANTASYPROS_CAPTURE_RESPONSE";
  const PFF_REQUEST = "THUNDER_BOWL_PFF_CAPTURE_REQUEST";
  const PFF_RESPONSE = "THUNDER_BOWL_PFF_CAPTURE_RESPONSE";
  const allowedOrigins = new Set(["https://pipsprojects.com", "http://localhost:8888"]);

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== window.location.origin || !allowedOrigins.has(event.origin)) return;
    if (!data || data.source !== APP_SOURCE || ![REQUEST, FBG_REQUEST, FANTASYPROS_REQUEST, PFF_REQUEST].includes(data.type) || data.protocolVersion !== PROTOCOL_VERSION || typeof data.requestId !== "string") return;
    const isFbg = data.type === FBG_REQUEST;
    const isFantasyPros = data.type === FANTASYPROS_REQUEST;
    const isPff = data.type === PFF_REQUEST;
    const action = isFbg ? "capture-fbg-projections" : isFantasyPros ? "capture-fantasypros-projections" : isPff ? "capture-pff-projections" : "capture-cbs-rosters";
    const responseType = isFbg ? FBG_RESPONSE : isFantasyPros ? FANTASYPROS_RESPONSE : isPff ? PFF_RESPONSE : RESPONSE;
    chrome.runtime.sendMessage({ action, requestId: data.requestId, week: data.week }, (result) => {
      const runtimeError = chrome.runtime.lastError;
      window.postMessage({
        source: HELPER_SOURCE,
        type: responseType,
        protocolVersion: PROTOCOL_VERSION,
        requestId: data.requestId,
        ok: Boolean(result?.ok) && !runtimeError,
        snapshot: result?.snapshot,
        capture: result?.capture,
        error: runtimeError?.message || result?.error,
      }, event.origin);
    });
  });
})();
