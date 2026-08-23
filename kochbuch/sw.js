// sw.js — eigener Service Worker des Kochbuchs, unabhängig vom sw.js der Keto-App. Registriert
// mit Scope "kochbuch/" (Standard bei der Registrierung aus diesem Verzeichnis) — laut
// Spezifikation gewinnt bei überlappenden Scopes ohnehin der genauere, das sw.js der Keto-App
// steigt für /kochbuch/-Pfade zusätzlich früh aus (siehe dort).

const CACHE_NAME = "kochbuch-v5";
const SCOPE = self.registration.scope;
const SUPABASE_HOST = "viedjnpmvnkufoysuxvl.supabase.co";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/kochbuch.css",
  "./js/app.js",
  "./js/config.js",
  "./js/api.js",
  "./js/cache.js",
  "./js/identity.js",
  "./js/keto-bridge.js",
  "./js/keto-sync-import.js",
  "./js/ui.js",
  "./js/views/login.js",
  "./js/views/liste.js",
  "./js/views/rezept.js",
  "./js/views/editor.js",
  "./js/views/import.js",
  "../js/ingredient-parser.js",
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
  const isAppShell = url.origin === self.location.origin;
  const isFoto = url.hostname === SUPABASE_HOST && url.pathname.includes("/storage/v1/object/public/");

  if (isFoto) {
    // Network-first: aktuelle Fotos bevorzugen, im Offline-Fall auf den Cache zurückfallen —
    // damit bereits geöffnete Rezepte ihre Bilder auch ohne Verbindung zeigen.
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(request, clone)); }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (isAppShell) {
    event.respondWith(isCode(url) ? networkFirst(request) : cacheFirst(request));
  }
  // Alle anderen Anfragen (Supabase REST/Auth) laufen ungecached durchs Netz — die App selbst
  // hält dafür einen eigenen Lese-Cache im localStorage (js/cache.js).
});

function isCode(url) {
  return url.pathname.endsWith("/") || /\.(html|css|js|webmanifest)$/.test(url.pathname);
}

function networkFirst(request) {
  const cached = caches.match(request);
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (res && !settled) { settled = true; resolve(res); } };
    const timer = setTimeout(() => cached.then(done), 5000);

    fetch(request, { cache: "no-cache" })
      .then((res) => {
        clearTimeout(timer);
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          done(res);
          return;
        }
        // Fehlerstatus: fetch() lehnt nicht ab, der .catch() unten greift also nicht. Lieber die
        // letzte funktionierende Fassung aus dem Cache als eine kaputte Seite.
        cached.then(c => done(c || res));
      })
      .catch(() => {
        clearTimeout(timer);
        cached.then(c => c ? done(c) : done(Response.error()));
      });
  });
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((res) => {
      if (res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(request, clone)); }
      return res;
    });
  });
}
