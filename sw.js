// sw.js — cached die App-Shell für Offline-Start, holt Open-Food-Facts-Daten network-first
// (mit Cache-Fallback, damit bereits gescannte Produkte auch offline funktionieren).
//
// Code (HTML/CSS/JS) ebenfalls network-first: sonst liefert der Cache beim Neuladen die alte
// Fassung aus und die frisch heruntergeladene wird erst beim ÜBERNÄCHSTEN Laden sichtbar.
// Große, unveränderliche Dateien (Schrift, Symbole, vendor/) bleiben cache-first.

const CACHE_NAME = "keto-dashboard-v63";
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
  "./js/off-beitrag.js",
  "./js/foods-db.js",
  "./js/keto.js",
  "./js/consumption.js",
  "./js/recipes.js",
  "./js/ingredient-parser.js",
  "./js/sync.js",
  // Zeilenweiser Speicher und Abgleich (modus.js schaltet um; Standard ist noch der alte Weg).
  // Muessen mit in den Vorrat: store.js importiert sie beim Start, auch wenn der Schalter aus ist.
  "./js/modus.js",
  "./js/ablage.js",
  "./js/db.js",
  "./js/rows.js",
  "./js/entities.js",
  "./js/umzug.js",
  "./js/supabase.js",
  "./js/sync2.js",
  "./js/scanner.js",
  "./js/lists.js",
  "./js/analysis.js",
  "./js/ai.js",
  "./js/teller.js",
  "./js/planer.js",
  "./js/ui.js",
  "./js/product-editor.js",
  "./js/views/start.js",
  "./js/views/scan.js",
  "./js/views/profile.js",
  "./js/views/recipes.js",
  "./js/views/onboarding.js",
  "./js/views/planer.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./vendor/dom-to-image-more/dom-to-image-more.min.js",
  "./vendor/manrope/manrope-variable.woff2",
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
  // Das Kochbuch (kochbuch/) ist eine eigene App mit eigenem Service Worker und eigenem
  // CACHE_NAME. Dessen genauerer Scope gewinnt zwar ohnehin laut Spezifikation, aber dieser
  // frühe Ausstieg macht die Trennung explizit und unabhängig von Registrierungsreihenfolge.
  if (url.pathname.includes("/kochbuch/")) return;
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
    event.respondWith(isCode(url) ? networkFirst(request) : cacheFirst(request));
  }
});

/** Ändert sich diese Datei mit jedem Update? Nur dann lohnt der Umweg übers Netz. */
function isCode(url) {
  if (url.pathname.includes("/vendor/")) return false;
  return url.pathname.endsWith("/")
    || /\.(html|css|js|webmanifest)$/.test(url.pathname);
}

/**
 * Erst das Netz, nach 3 Sekunden oder bei Fehler der Cache. `cache: "no-cache"` erzwingt eine
 * Rückfrage beim Server statt einer Antwort aus dem HTTP-Cache des Browsers — dank ETag ist das
 * in der Regel ein 304 ohne Datenübertragung. Jede erfolgreiche Antwort frischt den Cache auf,
 * auch wenn zwischenzeitlich schon die gecachte Fassung ausgeliefert wurde.
 */
function networkFirst(request) {
  // 5s statt kurzer angesetzt: bei 2G/3G reißt ein knapperer Timeout den Nutzer sonst mitten
  // im Laden auf den (dann veralteten) Cache-Stand zurück, obwohl das Netz noch geantwortet hätte.
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
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          done(res);
          // Falls der Timeout schon mit der Cache-Fassung geantwortet hat: nichts weiter zu tun,
          // der Cache ist jetzt aktuell und der nächste Aufruf bekommt den neuen Stand.
          return;
        }
        // Antwort MIT Fehlerstatus (z.B. 503 während eines Deploys). fetch() lehnt dabei nicht
        // ab, der .catch() unten greift also nicht — ohne diesen Zweig bekäme die Seite die 503
        // ausgeliefert und stünde weiß da, obwohl eine funktionierende Fassung im Cache liegt.
        cached.then(c => done(c || res));
      })
      .catch(() => {
        clearTimeout(timer);
        cached.then(c => c ? done(c) : done(Response.error()));
      });
  });
}

/** Cache-first für alles, was sich nicht ändert. Bei Cache-Miss (z.B. lazy geladene
 * Tesseract-Dateien beim ersten Bild-Import) wandert die Antwort zusätzlich in den Cache. */
function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((res) => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      }
      return res;
    });
  });
}

// Die App fragt hier nach, welcher Stand tatsächlich ausliefert — im Profil-Tab sichtbar.
self.addEventListener("message", (event) => {
  if (event.data?.type === "version") {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});
