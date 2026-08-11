// sw.js — cached die App-Shell für Offline-Start, holt Open-Food-Facts-Daten network-first
// (mit Cache-Fallback, damit bereits gescannte Produkte auch offline funktionieren).

const CACHE_NAME = "keto-dashboard-v3";
const SCOPE = self.registration.scope; // funktioniert auch unter einem Unterpfad wie /keto-dashboard/

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/store.js",
  "./js/profiles.js",
  "./js/off.js",
  "./js/foods-db.js",
  "./js/keto.js",
  "./js/consumption.js",
  "./js/scanner.js",
  "./js/lists.js",
  "./js/ui.js",
  "./js/views/start.js",
  "./js/views/scan.js",
  "./js/views/profile.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
].map(p => new URL(p, SCOPE).toString());

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isOff = url.hostname.endsWith("openfoodfacts.org");
  const isAppShell = url.origin === self.location.origin;

  if (isOff) {
    // Network-first: aktuelle Daten bevorzugen, bei Fehler auf Cache zurückfallen (offline-fähig).
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (isAppShell) {
    // Cache-first für die App-Shell selbst, Netzwerk als Fallback.
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
  }
});
