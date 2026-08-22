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
  await syncNow();
}

export function disableSync() {
  localStorage.removeItem(ENABLED_KEY);
  clearSession();
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
let applyingRemote = false; // während des Einmischens ausgelöste Änderungen sollen keinen zweiten Sync-Tick anstoßen

/**
 * Holt den Server-Stand, mischt ihn lokal ein (wie ein manueller Datei-Import) und schreibt
 * den vereinten Stand zurück. Wirft bei fehlender/ungültiger Anmeldung eine SyncAuthError —
 * Aufrufer, die das dem Menschen zeigen wollen, fangen die spezifisch ab.
 */
export async function syncNow() {
  if (!isSyncEnabled()) return;
  if (syncing) { queued = true; return; }
  syncing = true;
  try {
    const res = await authedFetch(`${REST}/keto_sync_state?id=eq.${ROW_ID}&select=daten`);
    if (res.ok) {
      const rows = await res.json();
      if (rows[0]?.daten) {
        applyingRemote = true;
        try { Store.mergeJSONQuiet(JSON.stringify(rows[0].daten)); }
        finally { applyingRemote = false; }
      }
    }

    const daten = JSON.parse(Store.exportJSON());
    const wer = Store.getActiveProfile()?.name || null;
    await authedFetch(`${REST}/keto_sync_state?on_conflict=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: ROW_ID, daten, geaendert_von: wer }),
    });
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
  if (!isSyncEnabled() || applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { syncNow().catch(() => {}); }, 4000);
}

onStoreChange(scheduleSync);
