const CACHE_VERSION = "thunder-bowl-shell-v49";
const APP_SHELL = [
  "/thunder-bowl/",
  "/thunder-bowl/index.html",
  "/thunder-bowl/public.html",
  "/thunder-bowl/app.css?v=20260805g",
  "/thunder-bowl/app.mjs?v=20260805g",
  "/thunder-bowl/public-board.mjs?v=20260805g",
  "/thunder-bowl/state-engine.mjs?v=20260805g",
  "/thunder-bowl/storage.mjs?v=20260805g",
  "/thunder-bowl/practice-engine.mjs?v=20260805g",
  "/thunder-bowl/player-annotations.mjs?v=20260805g",
  "/thunder-bowl/personal-board-exchange.mjs?v=20260805g",
  "/thunder-bowl/draft-readiness.mjs?v=20260805g",
  "/thunder-bowl/player-search.mjs?v=20260805g",
  "/thunder-bowl/keeper-board.mjs?v=20260805g",
  "/thunder-bowl/draft-history.mjs?v=20260805g",
  "/thunder-bowl/decision-context.mjs?v=20260805g",
  "/thunder-bowl/human-rehearsal.mjs?v=20260805g",
  "/thunder-bowl/priority-weights.mjs?v=20260805g",
  "/thunder-bowl/cbs-roster-snapshot.mjs?v=20260805g",
  "/thunder-bowl/emergency-print.css?v=20260805g",
  "/thunder-bowl/sample-draft-pack.json",
  "/thunder-bowl/manifest.webmanifest?v=20260805g"
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
    const fallback = pathname.endsWith("/board") || pathname.endsWith("/public.html")
      ? "/thunder-bowl/public.html"
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
