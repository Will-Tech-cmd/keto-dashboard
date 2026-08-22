// cache.js — letzter bekannter Serverstand im localStorage, damit die Liste und bereits
// geöffnete Rezepte auch ohne Verbindung sichtbar bleiben. Bewusst nur zum Lesen: Schreiben
// braucht in v1 eine Verbindung (siehe README, Abschnitt "Kochbuch" → "Offline").

const LIST_KEY = "kochbuch-cache-liste";
const REZEPT_PREFIX = "kochbuch-cache-rezept-";

export function saveListeCache(rows) {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(rows)); } catch { /* voller Speicher o.ä. — Cache ist nur ein Komfort */ }
}
export function loadListeCache() {
  try { return JSON.parse(localStorage.getItem(LIST_KEY)) || null; } catch { return null; }
}

export function saveRezeptCache(rezept) {
  try { localStorage.setItem(REZEPT_PREFIX + rezept.id, JSON.stringify(rezept)); } catch { /* siehe oben */ }
}
export function loadRezeptCache(id) {
  try { return JSON.parse(localStorage.getItem(REZEPT_PREFIX + id)) || null; } catch { return null; }
}
