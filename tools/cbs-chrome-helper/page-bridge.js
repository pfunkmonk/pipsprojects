(() => {
  "use strict";
  const PROTOCOL_VERSION = 1;
  const APP_SOURCE = "thunder-bowl-app";
  const HELPER_SOURCE = "thunder-bowl-cbs-helper";
  const REQUEST = "THUNDER_BOWL_CBS_CAPTURE_REQUEST";
  const RESPONSE = "THUNDER_BOWL_CBS_CAPTURE_RESPONSE";
  const FBG_REQUEST = "THUNDER_BOWL_FBG_CAPTURE_REQUEST";
  const FBG_RESPONSE = "THUNDER_BOWL_FBG_CAPTURE_RESPONSE";
  const allowedOrigins = new Set(["https://pipsprojects.com", "http://localhost:8888"]);

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== window.location.origin || !allowedOrigins.has(event.origin)) return;
    if (!data || data.source !== APP_SOURCE || ![REQUEST, FBG_REQUEST].includes(data.type) || data.protocolVersion !== PROTOCOL_VERSION || typeof data.requestId !== "string") return;
    const isFbg = data.type === FBG_REQUEST;
    chrome.runtime.sendMessage({ action: isFbg ? "capture-fbg-projections" : "capture-cbs-rosters", requestId: data.requestId, week: data.week }, (result) => {
      const runtimeError = chrome.runtime.lastError;
      window.postMessage({
        source: HELPER_SOURCE,
        type: isFbg ? FBG_RESPONSE : RESPONSE,
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
