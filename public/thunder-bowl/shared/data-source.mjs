import { ADDON_CONFIG, demoMode } from "./addon-config.mjs";
import { createDemoSource } from "./demo-store.mjs";
import { assertPublicSnapshot } from "./public-core.mjs";

function errorFromResponse(response, fallback) {
  return response.json().catch(() => ({})).then((body) => {
    const error = new Error(body.error || fallback);
    error.status = response.status;
    error.code = body.code || null;
    return error;
  });
}

function createLiveSource(scope) {
  let pollId = null;
  return {
    async login(code) {
      const response = await fetch(ADDON_CONFIG.auctioneerAuthUrl, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
      });
      if (!response.ok) throw await errorFromResponse(response, "Auctioneer access failed.");
    },
    async snapshot() {
      const url = scope === "auctioneer" ? ADDON_CONFIG.auctioneerSnapshotUrl : `${ADDON_CONFIG.boardSnapshotUrl}${window.location.search}`;
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw await errorFromResponse(response, "Live auction state is unavailable.");
      return assertPublicSnapshot(await response.json());
    },
    async command(command) {
      const response = await fetch(ADDON_CONFIG.auctioneerCommandsUrl, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
      });
      if (!response.ok) throw await errorFromResponse(response, "The auction change was rejected.");
      return assertPublicSnapshot(await response.json());
    },
    subscribe(callback) {
      pollId = window.setInterval(callback, ADDON_CONFIG.pollIntervalMs);
      return () => window.clearInterval(pollId);
    },
  };
}

export function createDataSource(scope) {
  return demoMode() ? createDemoSource() : createLiveSource(scope);
}
