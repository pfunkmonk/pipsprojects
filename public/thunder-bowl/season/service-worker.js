const CACHE_VERSION = "thunder-bowl-season-v58";
const APP_SHELL = [
  "/thunder-bowl/season/",
  "/thunder-bowl/season/index.html",
  "/thunder-bowl/season/favicon.svg?v=20260831a",
  "/thunder-bowl/season/manifest.webmanifest?v=20260831a",
  "/thunder-bowl/season/season.css?v=20260912b",
  "/thunder-bowl/season/season.mjs?v=20260918a",
  "/thunder-bowl/season/season-kickoff.mjs?v=20260910a",
  "/thunder-bowl/season/season-evidence.mjs?v=20260914a",
  "/thunder-bowl/season/season-news.mjs?v=20260901b",
  "/thunder-bowl/season/season-trade-ranking.mjs?v=20260901a",
  "/thunder-bowl/cbs-roster-snapshot.mjs?v=20260918a",
  "/thunder-bowl/cbs-schedule-normalize.mjs",
  "/thunder-bowl/cbs-scoring-preview-normalize.mjs",
  "/thunder-bowl/fbg-session-capture.mjs?v=20260918a",
  "/thunder-bowl/supplemental-session-capture.mjs?v=20260918a",
  "/thunder-bowl/storage.mjs?v=20260823a",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("thunder-bowl-season-") && key !== CACHE_VERSION)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallback = null) {
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
    if (fallback) return caches.match(fallback);
    throw new Error(`Offline season asset is not cached: ${request.url}`);
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "/thunder-bowl/season/index.html"));
    return;
  }
  if (url.pathname.startsWith("/thunder-bowl/season/") || [
    "/thunder-bowl/cbs-roster-snapshot.mjs",
    "/thunder-bowl/cbs-schedule-normalize.mjs",
    "/thunder-bowl/cbs-scoring-preview-normalize.mjs",
    "/thunder-bowl/fbg-session-capture.mjs",
    "/thunder-bowl/supplemental-session-capture.mjs",
    "/thunder-bowl/storage.mjs",
  ].includes(url.pathname)) event.respondWith(networkFirst(event.request));
});
