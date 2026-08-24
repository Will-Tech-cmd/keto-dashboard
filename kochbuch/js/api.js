// api.js — Zugriff auf Supabase per rohem fetch, ohne supabase-js: das würde entweder ein CDN
// (verbietet die CSP dieser App) oder Vendoring einer recht großen Bibliothek bedeuten. Für den
// Umfang hier (Login, PostgREST-CRUD, Storage-Upload) ist das direkt machbar.
import { SUPABASE_URL, SUPABASE_ANON_KEY, SHARED_ACCOUNT_EMAIL, PHOTOS_BUCKET } from "./config.js";

const SESSION_KEY = "kochbuch-session";
const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH = `${SUPABASE_URL}/auth/v1`;
const STORAGE = `${SUPABASE_URL}/storage/v1`;

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

export function isLoggedIn() {
  return !!loadSession()?.refresh_token;
}

export function logout() {
  clearSession();
}

/** Meldet mit dem gemeinsamen Zugangswort an. Wirft mit einem sprechenden Fehlertext. */
export async function login(password) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: SHARED_ACCOUNT_EMAIL, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) throw new Error("Falsches Zugangswort.");
    throw new Error("Anmeldung fehlgeschlagen — keine Verbindung zum Server?");
  }
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  });
}

/** Ändert das gemeinsame Zugangswort (im Profil-Bereich der App aufrufbar). */
export async function changePassword(newPassword) {
  const res = await authedFetch(`${AUTH}/user`, {
    method: "PUT",
    body: JSON.stringify({ password: newPassword }),
  });
  if (!res.ok) {
    // Ohne diese Prüfung meldete die App "Zugangswort geändert" auch dann, wenn Supabase
    // abgelehnt hat (zu kurz, identisch zum alten) — man hätte das neue Wort weitergegeben,
    // es hätte nirgends funktioniert, und im Zweifel sperren sich beide Geräte aus.
    const body = await res.json().catch(() => ({}));
    throw new Error(body.msg || body.error_description || `Ändern fehlgeschlagen (Status ${res.status}).`);
  }
}

async function refreshSession() {
  const s = loadSession();
  if (!s?.refresh_token) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${AUTH}/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) { clearSession(); throw new Error("Anmeldung abgelaufen."); }
  const data = await res.json();
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  });
}

async function ensureFreshToken() {
  const s = loadSession();
  if (!s?.access_token) throw new Error("Nicht angemeldet.");
  // 60s Sicherheitsabstand, damit ein Request nicht mitten in der Übertragung mit einem
  // gerade abgelaufenen Token ankommt.
  if (s.expires_at - Math.floor(Date.now() / 1000) < 60) await refreshSession();
  return loadSession().access_token;
}

/** fetch mit Anmelde-Headern, erneuert das Token bei Bedarf einmalig und wiederholt bei 401. */
async function authedFetch(url, opts = {}, { retried = false } = {}) {
  let token;
  try {
    token = await ensureFreshToken();
  } catch (e) {
    throw new AuthError(e.message);
  }
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        ...(opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}),
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
  if (res.status === 401) { clearSession(); throw new AuthError("Anmeldung abgelaufen."); }
  return res;
}

export class AuthError extends Error {}

async function restFetch(path, opts = {}) {
  const res = await authedFetch(`${REST}/${path}`, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Serverfehler (${res.status}): ${body.slice(0, 200) || "unbekannt"}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const sortByPos = (a, b) => (a.pos ?? 0) - (b.pos ?? 0);

// ---------------------------------------------------------------------------
// Rezepte lesen
// ---------------------------------------------------------------------------

// kochbuch_rezepte hat zwei Fremdschlüssel zu kochbuch_bilder (die Bilder-Liste über
// kochbuch_bilder.rezept_id und das einzelne titelbild_id) — PostgREST kann die Beziehung
// deshalb nicht mehr von selbst erraten (Fehler PGRST201) und braucht den Constraint-Namen.
// kochbuch_zutaten nur mit dem Namen: die Übersicht sucht darin mit (das Suchfeld verspricht
// "Rezept oder Zutat"), die Mengen und Nährwerte braucht sie dafür nicht.
const LIST_SELECT = "id,titel,untertitel,portionen,vorbereitung_min,koch_min,schwierigkeit,tags,bewertung,zuletzt_gekocht,naehrwerte,updated_at,titelbild_id,kochbuch_bilder!kochbuch_bilder_rezept_id_fkey(id,pfad),kochbuch_zutaten(name)";
const DETAIL_SELECT = "*,kochbuch_zutaten(*),kochbuch_schritte(*),kochbuch_bilder!kochbuch_bilder_rezept_id_fkey(*),kochbuch_kommentare(*)";

export async function listRezepte() {
  const rows = await restFetch(`kochbuch_rezepte?select=${LIST_SELECT}&geloescht_am=is.null&order=updated_at.desc`);
  return rows.map(r => ({
    ...r,
    titelbild: r.kochbuch_bilder?.find(b => b.id === r.titelbild_id) || r.kochbuch_bilder?.[0] || null,
  }));
}

export async function getRezept(id) {
  const rows = await restFetch(`kochbuch_rezepte?select=${DETAIL_SELECT}&id=eq.${id}&geloescht_am=is.null`);
  const r = rows?.[0];
  if (!r) return null;
  r.kochbuch_zutaten.sort(sortByPos);
  r.kochbuch_schritte.sort(sortByPos);
  r.kochbuch_kommentare.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return r;
}

/**
 * Alle schon aus der Keto-App übernommenen Rezepte als Karte keto_id -> Kopfdaten. Eine einzige
 * Abfrage statt einer pro Rezept: der automatische Abgleich lief bei jedem Start der App sonst
 * mit einer Anfrage je Rezept nacheinander durch (bei 60 Rezepten mehrere Sekunden Mobilfunk).
 */
export async function listKetoIdMap() {
  const rows = await restFetch(
    "kochbuch_rezepte?select=id,keto_id,keto_updated_at&keto_id=not.is.null&geloescht_am=is.null"
  );
  return new Map((rows || []).map(r => [r.keto_id, r]));
}

export async function findByKetoId(ketoId) {
  const rows = await restFetch(`kochbuch_rezepte?select=id,updated_at,keto_updated_at&keto_id=eq.${ketoId}&geloescht_am=is.null`);
  return rows?.[0] || null;
}

/**
 * Rezepte aus dem Blob, den die Keto-App bei aktivierter Synchronisierung nach
 * keto_sync_state schreibt (js/sync.js dort) — select=daten->recipes lässt Postgres nur das
 * gebrauchte Teilstück herausschneiden, statt Profile/Verlauf/Listen mit zu übertragen.
 * Leeres Array, wenn dort noch niemand synchronisiert hat.
 */
export async function fetchKetoSyncRecipes() {
  const rows = await restFetch(`keto_sync_state?select=recipes:daten->recipes&id=eq.haushalt`);
  return Array.isArray(rows?.[0]?.recipes) ? rows[0].recipes : [];
}

// ---------------------------------------------------------------------------
// Rezept anlegen / ändern
// ---------------------------------------------------------------------------

/** Legt ein neues Rezept an (Kopfdaten) und liefert die vollständige Zeile zurück. */
export async function createRezeptHead(felder) {
  const rows = await restFetch("kochbuch_rezepte", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(felder),
  });
  return rows[0];
}

/**
 * Ändert Kopfdaten eines Rezepts — mit optimistischer Sperre über `updated_at`: kommt die
 * andere Person zwischen Laden und Speichern zuvor, meldet ein leeres Ergebnis den Konflikt,
 * statt die fremde Änderung stillschweigend zu überschreiben.
 */
export async function updateRezeptHead(id, felder, expectedUpdatedAt) {
  const rows = await restFetch(
    `kochbuch_rezepte?id=eq.${id}&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(felder) }
  );
  return rows[0] || null; // null = Konflikt, jemand hat zwischenzeitlich gespeichert
}

/** Erzwingt das Speichern ohne Konfliktprüfung — nachdem die Nutzerin/der Nutzer das bewusst bestätigt hat. */
export async function forceUpdateRezeptHead(id, felder) {
  const rows = await restFetch(`kochbuch_rezepte?id=eq.${id}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(felder),
  });
  return rows[0];
}

export async function softDeleteRezept(id) {
  await restFetch(`kochbuch_rezepte?id=eq.${id}`, {
    method: "PATCH", body: JSON.stringify({ geloescht_am: new Date().toISOString() }),
  });
}

/**
 * Ersetzt alle Zeilen einer Unterliste (Zutaten, Schritte) durch die übergebenen — einfacher
 * als granulares Diffen für v1.
 *
 * Erst schreiben, dann die alten Zeilen entfernen. PostgREST kennt keine Transaktion über zwei
 * Anfragen hinweg: bei "erst löschen, dann schreiben" steht das Rezept nach einem
 * Verbindungsabbruch dazwischen ohne jede Zutat da — und beim automatischen Abgleich fiele das
 * nicht einmal auf. Andersherum bleiben im schlimmsten Fall doppelte Zeilen stehen: sichtbar,
 * ärgerlich, aber nichts ist verloren, und das nächste Speichern räumt auf.
 */
async function replaceRows(tabelle, rezeptId, zeilen) {
  const alte = await restFetch(`${tabelle}?rezept_id=eq.${rezeptId}&select=id`);
  if (zeilen.length > 0) {
    await restFetch(tabelle, {
      method: "POST",
      body: JSON.stringify(zeilen.map((z, i) => ({ ...z, rezept_id: rezeptId, pos: i }))),
    });
  }
  const alteIds = (alte || []).map(r => r.id);
  if (alteIds.length > 0) {
    await restFetch(`${tabelle}?id=in.(${alteIds.join(",")})`, { method: "DELETE" });
  }
}

export function replaceZutaten(rezeptId, zutaten) {
  return replaceRows("kochbuch_zutaten", rezeptId, zutaten);
}

export function replaceSchritte(rezeptId, schritte) {
  return replaceRows("kochbuch_schritte", rezeptId, schritte);
}

export async function addKommentar(rezeptId, autor, text) {
  const rows = await restFetch("kochbuch_kommentare", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ rezept_id: rezeptId, autor, text }),
  });
  return rows[0];
}

// ---------------------------------------------------------------------------
// Fotos (Supabase Storage)
// ---------------------------------------------------------------------------

export function publicFotoUrl(pfad) {
  return `${STORAGE}/object/public/${PHOTOS_BUCKET}/${pfad}`;
}

/** Lädt ein Bild hoch und legt die zugehörige Datenbankzeile an. Gibt die neue Bilderzeile zurück. */
export async function uploadFoto(rezeptId, blob, { breite, hoehe } = {}) {
  const pfad = `${rezeptId}/${crypto.randomUUID()}.jpg`;
  const res = await authedFetch(`${STORAGE}/object/${PHOTOS_BUCKET}/${pfad}`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
  if (!res.ok) throw new Error("Foto-Upload fehlgeschlagen.");
  const rows = await restFetch("kochbuch_bilder", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ rezept_id: rezeptId, pfad, breite: breite || null, hoehe: hoehe || null }),
  });
  return rows[0];
}

export async function deleteFoto(bild) {
  await authedFetch(`${STORAGE}/object/${PHOTOS_BUCKET}`, {
    method: "DELETE",
    body: JSON.stringify({ prefixes: [bild.pfad] }),
  });
  await restFetch(`kochbuch_bilder?id=eq.${bild.id}`, { method: "DELETE" });
}

export async function setTitelbild(rezeptId, bildId) {
  await restFetch(`kochbuch_rezepte?id=eq.${rezeptId}`, {
    method: "PATCH", body: JSON.stringify({ titelbild_id: bildId }),
  });
}
