// sw.js — eigener Service Worker von Sema, Scope "sema/". Unabhängig von sw.js der Keto-App und
// kochbuch/sw.js; das sw.js der Keto-App steigt für /sema/-Pfade früh aus.
//
// Beim Aufräumen löscht er NUR die eigenen Caches (Präfix "sema-"). Alle drei Apps teilen sich
// einen Origin und damit eine Cache-Liste — ein „alles außer meinem löschen“ räumte die Vorräte
// der anderen Apps mit ab (so stand es früher in den beiden anderen Service Workern).

const CACHE_PREFIX = "sema-";
const CACHE_NAME = "sema-v1";
const SCOPE = self.registration.scope;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/organic.css",
  "./css/sema.css",
  "./js/app.js",
  "./js/logik.js",
  "./js/speicher.js",
  "./js/off.js",
  "./js/ki.js",
  "../js/scanner.js",
  "../vendor/zxing/reader.js",
  "../vendor/zxing/zxing-library.min.js",
  "../vendor/caprasimo/caprasimo-latin.woff2",
  "../vendor/figtree/figtree-variable-latin.woff2",
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
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Fremde Dienste (Open Food Facts, KI) laufen ungecached durchs Netz: gescannte Produkte
  // merkt sich die App selbst in IndexedDB, KI-Antworten sollen nie aus einem Cache kommen.
  if (url.origin !== self.location.origin) return;
  event.respondWith(isCode(url) ? networkFirst(request) : cacheFirst(request));
});

function isCode(url) {
  return url.pathname.endsWith("/") || /\.(html|css|js|webmanifest)$/.test(url.pathname);
}

// Code network-first (sonst erscheint eine neue Fassung erst beim übernächsten Laden), mit
// Zeitlimit, damit ein schlechtes Netz in der Kita den Start nicht blockiert.
function networkFirst(request) {
  const cached = caches.open(CACHE_NAME).then(c => c.match(request));
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (res && !settled) { settled = true; resolve(res); } };
    const timer = setTimeout(() => cached.then(done), 4000);
    fetch(request, { cache: "no-cache" })
      .then((res) => {
        clearTimeout(timer);
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          done(res);
          return;
        }
        cached.then(c => done(c || res));
      })
      .catch(() => {
        clearTimeout(timer);
        cached.then(c => done(c || Response.error()));
      });
  });
}

function cacheFirst(request) {
  return caches.open(CACHE_NAME).then(c => c.match(request)).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((res) => {
      if (res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(request, clone)); }
      return res;
    });
  });
}
