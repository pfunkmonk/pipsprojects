const CACHE = "pips-draft-day-shell-20260830a";
const SHELL = [
  "/draft-day/",
  "/draft-day/index.html",
  "/draft-day/app.css?v=20260830a",
  "/draft-day/shell-safety.css",
  "/draft-day/core.mjs",
  "/draft-day/nfl-teams.mjs",
  "/draft-day/session-storage.mjs",
  "/draft-day/setup.mjs?v=20260830a",
  "/draft-day/favicon.svg",
  "/draft-day/manifest.webmanifest",
  "/draft-day/player-pool.json",
  "/draft-day/guide/",
  "/draft-day/guide/index.html",
  "/draft-day/auctioneer/",
  "/draft-day/auctioneer/index.html",
  "/draft-day/auctioneer/auctioneer.mjs?v=20260830a",
  "/draft-day/board/",
  "/draft-day/board/index.html",
  "/draft-day/board/board.mjs?v=20260830a",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("pips-draft-day-shell-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (!url.pathname.startsWith("/draft-day/")) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) { const clone = response.clone(); void caches.open(CACHE).then((cache) => cache.put(event.request, clone)); }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname))));
});
