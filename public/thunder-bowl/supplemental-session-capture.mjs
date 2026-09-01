export const SUPPLEMENTAL_CAPTURE_PROTOCOL_VERSION = 1;
export const SUPPLEMENTAL_APP_SOURCE = "thunder-bowl-app";
export const SUPPLEMENTAL_HELPER_SOURCE = "thunder-bowl-cbs-helper";

export const SUPPLEMENTAL_PROVIDERS = Object.freeze({
  fantasyPros: Object.freeze({
    request: "THUNDER_BOWL_FANTASYPROS_CAPTURE_REQUEST",
    response: "THUNDER_BOWL_FANTASYPROS_CAPTURE_RESPONSE",
    source: "FantasyPros authenticated weekly component projections capture",
    origin: "https://www.fantasypros.com",
    pathname: "/nfl/projections/qb.php",
    minimumRows: 400,
    maximumRows: 800,
  }),
  pff: Object.freeze({
    request: "THUNDER_BOWL_PFF_CAPTURE_REQUEST",
    response: "THUNDER_BOWL_PFF_CAPTURE_RESPONSE",
    source: "PFF authenticated weekly component projections capture",
    origin: "https://www.pff.com",
    pathname: "/fantasy/projections",
    minimumRows: 200,
    maximumRows: 800,
  }),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateSupplementalSessionCapture(input, {
  provider,
  expectedSeason = 2026,
  expectedWeek = null,
} = {}) {
  const config = SUPPLEMENTAL_PROVIDERS[provider];
  assert(config, "The premium projection provider is unsupported.");
  assert(isPlainObject(input), `${provider} account capture is not an object.`);
  assert(input.schemaVersion === 1, `${provider} account capture has an unsupported schema.`);
  assert(input.provider === provider && input.source === config.source, `${provider} account capture has an unexpected source.`);
  assert(input.modelEffect === "none", `${provider} account capture attempted to gain model authority.`);
  assert(input.authenticated === true, `${provider} did not confirm a signed-in account view.`);
  if (provider === "fantasyPros") assert(input.accountLeague === "Thunder Bowl", "FantasyPros did not confirm the signed-in Thunder Bowl league view.");
  assert(Number.isFinite(Date.parse(input.capturedAt)), `${provider} account capture has an invalid timestamp.`);
  assert(Number.isFinite(Date.parse(input.providerAsOf)), `${provider} account capture has an invalid provider timestamp.`);
  assert(input.season === expectedSeason, `${provider} account capture is for the wrong season.`);
  assert(Number.isSafeInteger(input.week) && input.week >= 1 && input.week <= 18, `${provider} account capture has an invalid week.`);
  if (expectedWeek !== null) assert(input.week === expectedWeek, `${provider} account capture is for Week ${input.week}, not Week ${expectedWeek}.`);
  const pageUrl = new URL(input.pageUrl);
  assert(pageUrl.origin === config.origin && pageUrl.pathname === config.pathname, `${provider} account capture came from the wrong projection page.`);
  assert(Array.isArray(input.rows) && input.rows.length >= config.minimumRows && input.rows.length <= config.maximumRows, `${provider} account capture has unsafe player coverage.`);
  assert(input.rows.every(isPlainObject), `${provider} account capture contains a malformed player row.`);
  return input;
}

export function requestSupplementalProjectionCapture({
  provider,
  targetWindow = window,
  origin = window.location.origin,
  timeoutMs = 90_000,
  week = 1,
} = {}) {
  const config = SUPPLEMENTAL_PROVIDERS[provider];
  if (!config) return Promise.reject(new Error("The premium projection provider is unsupported."));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      targetWindow.removeEventListener("message", onMessage);
      reject(new Error(`The updated helper did not answer the ${provider} request. Install or reload the current Thunder Bowl Data Helper, then try again.`));
    }, timeoutMs);
    function onMessage(event) {
      const data = event.data;
      if (event.source !== targetWindow || event.origin !== origin || !isPlainObject(data)) return;
      if (data.source !== SUPPLEMENTAL_HELPER_SOURCE || data.type !== config.response || data.protocolVersion !== SUPPLEMENTAL_CAPTURE_PROTOCOL_VERSION || data.requestId !== requestId) return;
      clearTimeout(timeout);
      targetWindow.removeEventListener("message", onMessage);
      if (!data.ok) reject(new Error(typeof data.error === "string" ? data.error : `${provider} helper capture failed.`));
      else resolve(validateSupplementalSessionCapture(data.capture, { provider, expectedWeek: week }));
    }
    targetWindow.addEventListener("message", onMessage);
    targetWindow.postMessage({
      source: SUPPLEMENTAL_APP_SOURCE,
      type: config.request,
      protocolVersion: SUPPLEMENTAL_CAPTURE_PROTOCOL_VERSION,
      requestId,
      week,
    }, origin);
  });
}
