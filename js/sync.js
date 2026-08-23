// sync.js — optionale Online-Synchronisierung über Supabase, für wer das gemeinsame
// Kochbuch-Zugangswort kennt (siehe kochbuch/). Standardmäßig AUS: ohne Aktivierung läuft die
// App exakt wie zuvor, komplett ohne Netzwerkzugriff — das Datenschutz-Versprechen der App
// gilt unverändert für alle, die diese Option nicht einschalten.
//
// Konfliktfrei durch Wiederverwendung: statt einer eigenen Merge-Logik nutzt syncNow() genau
// dieselbe Vereinigung wie der manuelle Datei-Abgleich (Store.mergeJSONQuiet), nur automatisch
// über das Netz statt per Datei-Versand. Der Server hält dafür nur einen einzigen JSON-Blob
// (Tabelle keto_sync_state, eine Zeile "haushalt") — kein eigenes Datenmodell auf der Server-
// seite, das mit dem lokalen Schema synchron gehalten werden müsste.
import { Store, onStoreChange } from "./store.js";

const SUPABASE_URL = "https://viedjnpmvnkufoysuxvl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpZWRqbnBtdm5rdWZveXN1eHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwODg0MTcsImV4cCI6MjEwMjY2NDQxN30.VRZ05x3wIr-6CKgwwSggFnQjpB3bHt5qF0HdcfQh26c";
const SHARED_ACCOUNT_EMAIL = "kochbuch@keto-dashboard.app";
const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH = `${SUPABASE_URL}/auth/v1`;
const ROW_ID = "haushalt";

const ENABLED_KEY = "keto-dashboard-sync-enabled";
const SESSION_KEY = "keto-dashboard-sync-session";
const LAST_SYNC_KEY = "keto-dashboard-sync-last";
// "Auf diesem Gerät gibt es Änderungen, die der Server noch nicht hat." Bewusst im
// localStorage statt nur im Speicher: eine Eingabe kurz vor dem Schließen der App wäre sonst
// beim nächsten Start nicht mehr als noch zu sendende Änderung erkennbar.
const DIRTY_KEY = "keto-dashboard-sync-dirty";
// Wie oft im Vordergrund nachgesehen wird, ob das andere Gerät etwas geschickt hat.
const PULL_INTERVAL_MS = 60000;
// Schreibt das andere Gerät zwischen unserem Lesen und Schreiben, wird der Durchlauf wiederholt.
const MAX_SYNC_ATTEMPTS = 3;

export class SyncAuthError extends Error {}

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

export function isSyncEnabled() {
  return localStorage.getItem(ENABLED_KEY) === "true";
}

/** Angemeldet, aber die Sitzung ist weg (z.B. Refresh-Token nach langer Pause abgelaufen) —
 * die Profil-Ansicht zeigt in diesem Fall "Erneut anmelden" statt "Aktivieren". */
export function needsReauth() {
  return isSyncEnabled() && !loadSession()?.refresh_token;
}

export function getLastSyncAt() {
  const raw = localStorage.getItem(LAST_SYNC_KEY);
  return raw ? Number(raw) : null;
}

export async function enableSync(password) {
  await login(password);
  localStorage.setItem(ENABLED_KEY, "true");
  markDirty(); // der bisherige Stand dieses Geräts muss einmal komplett hoch
  startAutoPull();
  await syncNow();
}

export function disableSync() {
  localStorage.removeItem(ENABLED_KEY);
  localStorage.removeItem(DIRTY_KEY);
  stopAutoPull();
  clearSession();
}

// Die Marke ist ein Zähler, keine Ja/Nein-Fahne: wird während des Hochladens etwas
// eingetragen, steht danach ein anderer Wert da und die Marke bleibt stehen — sonst gälte die
// neue Änderung als mitgesendet und bliebe für immer liegen.
function markDirty() {
  localStorage.setItem(DIRTY_KEY, String(Number(localStorage.getItem(DIRTY_KEY) || 0) + 1));
}
function pendingPushMark() { return localStorage.getItem(DIRTY_KEY); }
function clearPendingPush(mark) {
  if (localStorage.getItem(DIRTY_KEY) === mark) localStorage.removeItem(DIRTY_KEY);
}

async function login(password) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: SHARED_ACCOUNT_EMAIL, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) throw new SyncAuthError("Falsches Zugangswort.");
    throw new Error("Anmeldung fehlgeschlagen — keine Verbindung zum Server?");
  }
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  });
}

async function refreshSession() {
  const s = loadSession();
  if (!s?.refresh_token) throw new SyncAuthError("Nicht angemeldet.");
  const res = await fetch(`${AUTH}/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) { clearSession(); throw new SyncAuthError("Anmeldung abgelaufen — bitte Zugangswort erneut eingeben."); }
  const data = await res.json();
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  });
}

async function ensureFreshToken() {
  const s = loadSession();
  if (!s?.access_token) throw new SyncAuthError("Nicht angemeldet.");
  if (s.expires_at - Math.floor(Date.now() / 1000) < 60) await refreshSession();
  return loadSession().access_token;
}

async function authedFetch(url, opts = {}, { retried = false } = {}) {
  const token = await ensureFreshToken();
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
    });
  } catch {
    throw new Error("Keine Verbindung zum Server.");
  }
  if (res.status === 401 && !retried) {
    await refreshSession();
    return authedFetch(url, opts, { retried: true });
  }
  if (res.status === 401) throw new SyncAuthError("Anmeldung abgelaufen — bitte Zugangswort erneut eingeben.");
  return res;
}

let syncing = false;
let queued = false;

/**
 * Ein Durchlauf: lesen, einmischen, schreiben. Gibt false zurück, wenn zwischen Lesen und
 * Schreiben ein anderes Gerät geschrieben hat — dann ist der ganze Durchlauf zu wiederholen,
 * weil unsere Fassung dessen Änderungen noch nicht kennt.
 */
async function syncOnce() {
  const res = await authedFetch(`${REST}/keto_sync_state?id=eq.${ROW_ID}&select=daten`);
  if (!res.ok) {
    // Lesen fehlgeschlagen (Serverfehler, geänderte Zugriffsregeln). Auf keinen Fall trotzdem
    // schreiben: unser Stand kennt die Gegenseite dann nicht und bügelte sie glatt.
    throw new Error(`Serverstand nicht lesbar (Status ${res.status}) — es wird nichts überschrieben.`);
  }
  const rows = await res.json();
  const remote = rows[0]?.daten || null;
  if (remote) Store.mergeJSONQuiet(JSON.stringify(remote));

  // Nur hochladen, wenn es hier wirklich etwas Neues gibt. Sonst schriebe jeder Blick auf den
  // Server denselben Stand sinnlos zurück — bei einem Zustand von einigen hundert Kilobyte ist
  // das der Unterschied zwischen "kaum spürbar" und "läuft das Datenvolumen leer".
  const mark = pendingPushMark();
  if (!mark) return true;

  const version = Number(remote?.syncVersion) || 0;
  const wer = Store.getActiveProfile()?.name || null;
  // Die Versionsnummer wandert IM Datensatz mit, statt in einer eigenen Spalte: so braucht es
  // keine Änderung am Tabellenschema. applyMerge() kennt das Feld nicht und lässt es liegen.
  const daten = { ...JSON.parse(Store.exportJSON()), syncVersion: version + 1 };

  if (!remote) {
    // Allererster Abgleich überhaupt — die Zeile gibt es noch gar nicht.
    const insert = await authedFetch(`${REST}/keto_sync_state?on_conflict=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: ROW_ID, daten, geaendert_von: wer }),
    });
    if (!insert.ok) throw new Error(`Hochladen fehlgeschlagen (Status ${insert.status}).`);
    clearPendingPush(mark);
    return true;
  }

  // Optimistische Sperre: der PATCH greift nur, solange dort noch die Version steht, die wir
  // eben gelesen haben. Ohne sie gewinnt bei zwei gleichzeitigen Abgleichen schlicht der
  // spätere Schreibvorgang — und alles, was das andere Gerät zwischendurch hochgeladen hat,
  // wäre weg. Bestandsdaten kennen das Feld noch nicht, dort greift is.null.
  const erwartet = version === 0 ? "is.null" : `eq.${version}`;
  const patch = await authedFetch(
    `${REST}/keto_sync_state?id=eq.${ROW_ID}&daten->>syncVersion=${erwartet}&select=id`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ daten, geaendert_von: wer }),
    }
  );
  if (!patch.ok) throw new Error(`Hochladen fehlgeschlagen (Status ${patch.status}).`);
  const geschrieben = await patch.json().catch(() => []);
  if (!Array.isArray(geschrieben) || geschrieben.length === 0) return false; // jemand war schneller

  clearPendingPush(mark);
  return true;
}

/**
 * Holt den Server-Stand, mischt ihn lokal ein (wie ein manueller Datei-Import) und schreibt
 * den vereinten Stand zurück, FALLS dieses Gerät etwas beizusteuern hat. Wirft bei
 * fehlender/ungültiger Anmeldung eine SyncAuthError — Aufrufer, die das dem Menschen zeigen
 * wollen, fangen die spezifisch ab.
 */
export async function syncNow() {
  if (!isSyncEnabled()) return;
  if (syncing) { queued = true; return; }
  syncing = true;
  try {
    let fertig = false;
    for (let versuch = 1; versuch <= MAX_SYNC_ATTEMPTS && !fertig; versuch++) {
      fertig = await syncOnce();
    }
    if (!fertig) throw new Error("Das andere Gerät war schneller — gleich noch einmal versuchen.");
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } finally {
    syncing = false;
    if (queued) { queued = false; syncNow().catch(() => {}); }
  }
}

let pushTimer = null;

/** Nach lokalen Änderungen mit etwas Verzögerung synchronisieren, statt bei jeder einzelnen
 * Eingabe — dieselbe Überlegung wie beim 250ms-Debounce des lokalen Speicherns in store.js,
 * nur mit größerem Abstand, weil hier ein Netzwerk-Roundtrip dranhängt. */
export function scheduleSync() {
  if (!isSyncEnabled()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { syncNow().catch(() => {}); }, 4000);
}

// Nur EIGENE Änderungen stoßen einen Push an. Der frühere Versuch, das über ein Flag rund um
// Store.mergeJSONQuiet() zu lösen, ging ins Leere: das Speichern ist um 250ms verzögert, das
// Flag war beim Eintreffen des Ereignisses längst wieder zurückgesetzt. Jeder empfangene
// Abgleich löste deshalb einen Push aus, dieser den nächsten Abgleich — die App synchronisierte
// alle vier Sekunden endlos im Kreis, ohne dass jemand etwas eingetragen hatte.
onStoreChange((origin) => {
  if (origin !== "local") return;
  markDirty();
  scheduleSync();
});

// ---------------------------------------------------------------------------
// Nachsehen, ob das andere Gerät etwas geschickt hat. Das übernahm bisher versehentlich die
// Endlosschleife oben — jetzt bewusst, und nur solange die App im Vordergrund ist. Ohne einen
// laufenden Push (siehe oben) ist ein Durchlauf eine einzelne, kleine Leseanfrage.
// ---------------------------------------------------------------------------
let pullTimer = null;

function stopAutoPull() {
  clearInterval(pullTimer);
  pullTimer = null;
}

function startAutoPull() {
  stopAutoPull();
  if (!isSyncEnabled()) return;
  pullTimer = setInterval(() => {
    if (document.visibilityState === "visible") syncNow().catch(() => {});
  }, PULL_INTERVAL_MS);
}

if (typeof document !== "undefined") {
  // Zurück aus dem Hintergrund: sofort nachsehen, statt bis zum nächsten Intervall zu warten —
  // das ist der Moment, in dem man wissen will, was der andere eingetragen hat.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isSyncEnabled()) syncNow().catch(() => {});
  });
  startAutoPull();
}
