// supabase.js — Anmeldung und Anfragen an das Supabase-Projekt.
//
// Herausgelöst aus sync.js, damit der neue zeilenweise Abgleich (sync2.js) dieselbe
// Sitzung benutzt, ohne dass ich am laufenden Blob-Abgleich etwas ändern muss. sync.js
// führt bis zur Umstellung noch seine eigene Fassung — doppelt, aber ohne Risiko für
// den Betrieb. Mit sync.js verschwindet auch die Dopplung.

const SUPABASE_URL = "https://viedjnpmvnkufoysuxvl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpZWRqbnBtdm5rdWZveXN1eHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwODg0MTcsImV4cCI6MjEwMjY2NDQxN30.VRZ05x3wIr-6CKgwwSggFnQjpB3bHt5qF0HdcfQh26c";

export const REST = `${SUPABASE_URL}/rest/v1`;
export const AUTH = `${SUPABASE_URL}/auth/v1`;

const SESSION_KEY = "keto-dashboard-sync-session";

export class AnmeldeFehler extends Error {}

function sitzungLesen() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function sitzungSchreiben(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
export function sitzungVerwerfen() { localStorage.removeItem(SESSION_KEY); }
export function istAngemeldet() { return !!sitzungLesen()?.refresh_token; }

function merke(daten) {
  sitzungSchreiben({
    access_token: daten.access_token,
    refresh_token: daten.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (daten.expires_in || 3600),
  });
}

export async function anmelden(email, passwort) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: passwort }),
  });
  const daten = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) throw new AnmeldeFehler("Falsches Zugangswort.");
    throw new Error(daten.msg || "Anmeldung fehlgeschlagen — keine Verbindung zum Server?");
  }
  merke(daten);
}

async function erneuern() {
  const s = sitzungLesen();
  if (!s?.refresh_token) throw new AnmeldeFehler("Nicht angemeldet.");
  const res = await fetch(`${AUTH}/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) {
    sitzungVerwerfen();
    throw new AnmeldeFehler("Anmeldung abgelaufen — bitte Zugangswort erneut eingeben.");
  }
  merke(await res.json());
}

async function frischesToken() {
  const s = sitzungLesen();
  if (!s?.access_token) throw new AnmeldeFehler("Nicht angemeldet.");
  // 60 Sekunden Sicherheitsabstand, damit eine Anfrage nicht mitten in der Übertragung
  // mit einem gerade abgelaufenen Token ankommt.
  if (s.expires_at - Math.floor(Date.now() / 1000) < 60) await erneuern();
  return sitzungLesen().access_token;
}

export async function anfrage(url, opts = {}, { wiederholt = false } = {}) {
  const token = await frischesToken();
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
  if (res.status === 401 && !wiederholt) {
    await erneuern();
    return anfrage(url, opts, { wiederholt: true });
  }
  if (res.status === 401) throw new AnmeldeFehler("Anmeldung abgelaufen — bitte Zugangswort erneut eingeben.");
  return res;
}

/**
 * Anfrage an PostgREST mit Fehlerprüfung. Wirft mit der Meldung des Servers — die ist
 * bei einem verletzten Fremdschlüssel oder einer Prüfregel deutlich hilfreicher als ein
 * nacktes "Serverfehler".
 */
export async function rest(pfad, opts = {}) {
  const res = await anfrage(`${REST}/${pfad}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let hinweis = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      hinweis = [j.message, j.details, j.hint].filter(Boolean).join(" — ") || hinweis;
    } catch { /* kein JSON, Rohtext reicht */ }
    const fehler = new Error(`Serverfehler ${res.status}: ${hinweis || "unbekannt"}`);
    fehler.status = res.status;
    throw fehler;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
