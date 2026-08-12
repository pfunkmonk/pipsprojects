const CACHE_VERSION = "thunder-bowl-shell-v94";
const APP_SHELL = [
  "/thunder-bowl/",
  "/thunder-bowl/index.html",
  "/thunder-bowl/public.html",
  "/thunder-bowl/favicon.svg?v=20260808h",
  "/thunder-bowl/auctioneer/",
  "/thunder-bowl/auctioneer/index.html",
  "/thunder-bowl/auctioneer/auctioneer.css",
  "/thunder-bowl/auctioneer/auctioneer-enhancements.css",
  "/thunder-bowl/auctioneer/auctioneer-illegal.css",
  "/thunder-bowl/auctioneer/auctioneer-clear.css",
  "/thunder-bowl/auctioneer/auctioneer-mission.css",
  "/thunder-bowl/auctioneer/auctioneer-sticky-sale.css",
  "/thunder-bowl/auctioneer/auctioneer.mjs?v=20260811a",
  "/thunder-bowl/draft-board/",
  "/thunder-bowl/draft-board/index.html",
  "/thunder-bowl/draft-board/draft-board.css",
  "/thunder-bowl/draft-board/draft-board.mjs",
  "/thunder-bowl/guides/",
  "/thunder-bowl/guides/index.html",
  "/thunder-bowl/guides/guides.css",
  "/thunder-bowl/guides/guides.mjs",
  "/thunder-bowl/board.html",
  "/thunder-bowl/board/board.css",
  "/thunder-bowl/board/board-reliability.css",
  "/thunder-bowl/board/board-elite.css",
  "/thunder-bowl/board/board-transactions.css",
  "/thunder-bowl/board/board.mjs",
  "/thunder-bowl/shared/addon-config.mjs",
  "/thunder-bowl/shared/clock-alert-policy.mjs",
  "/thunder-bowl/shared/data-source.mjs",
  "/thunder-bowl/shared/demo-store.mjs",
  "/thunder-bowl/shared/nomination-clock.mjs?v=20260808-cloud",
  "/thunder-bowl/shared/nomination-order.mjs",
  "/thunder-bowl/shared/projector-presence.mjs",
  "/thunder-bowl/shared/public-core.mjs",
  "/thunder-bowl/shared/readiness.mjs",
  "/thunder-bowl/shared/shell-safety.css",
  "/thunder-bowl/vendor/qrcode-generator.js",
  "/thunder-bowl/app.css?v=20260811b",
  "/thunder-bowl/app.mjs?v=20260811c",
  "/thunder-bowl/public-board.mjs?v=20260805g",
  "/thunder-bowl/state-engine.mjs?v=20260810e",
  "/thunder-bowl/storage.mjs?v=20260805g",
  "/thunder-bowl/practice-engine.mjs?v=20260805g",
  "/thunder-bowl/player-annotations.mjs?v=20260805g",
  "/thunder-bowl/personal-board-exchange.mjs?v=20260805g",
  "/thunder-bowl/draft-readiness.mjs?v=20260810a",
  "/thunder-bowl/automated-rehearsal-evidence.mjs?v=20260810a",
  "/thunder-bowl/player-search.mjs?v=20260811h",
  "/thunder-bowl/keeper-board.mjs?v=20260808k",
  "/thunder-bowl/keeper-scenario.mjs?v=20260808i",
  "/thunder-bowl/auction-demand.mjs?v=20260809a",
  "/thunder-bowl/auction-intelligence.mjs?v=20260811b",
  "/thunder-bowl/auction-telemetry.mjs?v=20260809a",
  "/thunder-bowl/fbg-configuration.mjs?v=20260808a",
  "/thunder-bowl/draft-history.mjs?v=20260808g",
  "/thunder-bowl/decision-context.mjs?v=20260811b",
  "/thunder-bowl/roster-safety.mjs?v=20260811b",
  "/thunder-bowl/nomination-assistant.mjs?v=20260810a",
  "/thunder-bowl/position-run.mjs?v=20260810a",
  "/thunder-bowl/projection-lab.mjs?v=20260809c",
  "/thunder-bowl/human-rehearsal.mjs?v=20260805g",
  "/thunder-bowl/priority-weights.mjs?v=20260810b",
  "/thunder-bowl/league-setup.mjs?v=20260809a",
  "/thunder-bowl/cbs-roster-snapshot.mjs?v=20260805g",
  "/thunder-bowl/sales-entry-mode.mjs?v=20260808a",
  "/thunder-bowl/emergency-print.css?v=20260805g",
  "/thunder-bowl/sample-draft-pack.json",
  "/thunder-bowl/manifest.webmanifest?v=20260808h"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("thunder-bowl-shell-") && key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_VERSION);
    cache.put(request, response.clone());
    return response;
  } catch {
    const pathname = new URL(request.url).pathname;
    const fallback = pathname.startsWith("/thunder-bowl/board")
      ? "/thunder-bowl/board.html"
      : pathname.startsWith("/thunder-bowl/guides")
        ? "/thunder-bowl/guides/index.html"
      : pathname.startsWith("/thunder-bowl/draft-board")
        ? "/thunder-bowl/draft-board/index.html"
      : pathname.startsWith("/thunder-bowl/auctioneer")
        ? "/thunder-bowl/auctioneer/index.html"
        : "/thunder-bowl/index.html";
    return caches.match(fallback);
  }
}

async function staticResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error(`Offline asset is not cached: ${request.url}`);
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(navigationResponse(event.request));
    return;
  }
  if (url.pathname.startsWith("/thunder-bowl/")) event.respondWith(staticResponse(event.request));
});
