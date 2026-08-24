// db.js — lokale Ablage in IndexedDB.
//
// Löst den einen großen JSON-Klumpen im localStorage ab. Der hatte drei Probleme, die
// sich nicht wegprogrammieren ließen: rund 5 MB Grenze für die ganze Herkunft, jedes
// Speichern schrieb den KOMPLETTEN Zustand neu, und beim Überlaufen wirft der Browser
// eine Ausnahme, nach der stillschweigend gar nichts mehr gesichert wird.
//
// Hier liegt jede Zeile einzeln. Eine eingetragene Mahlzeit schreibt eine Zeile, nicht
// 250 KB. Der Platz ist nicht mehr eine Frage von Kilobyte, sondern von Speicherplatz.
//
// Drei Verwaltungs-Speicher kommen dazu:
//   lokal   was nie zum Server wandert — Verlauf, Produkt-Cache, zuletzt gescannt,
//           aktives Profil (Entscheidung B0.2)
//   outbox  eigene Änderungen, die der Server noch nicht hat
//   meta    Abgleichs-Zeiger je Datenart, Haushalts-id, Schemastand
//
// Bewusst ohne Fremdbibliothek: die App hat keinen Bauschritt und keine npm-Abhängigkeiten,
// und für Öffnen, Lesen, Schreiben und Löschen ist die rohe API überschaubar genug.

const DB_NAME = "keto-dashboard";
const DB_VERSION = 1;

/** Datenspeicher — Schlüssel ist der fachliche Schlüssel aus rows.js. */
export const DATEN_SPEICHER = [
  "profil", "mahlzeit", "wasser", "tagesziel",
  "listen_eintrag", "einkauf", "produkt_korrektur", "rezept",
];

const VERWALTUNG = ["lokal", "meta"];
const OUTBOX = "outbox";

let dbPromise = null;

/** Eine IDB-Anfrage als Promise. */
function warte(anfrage) {
  return new Promise((erfuellen, ablehnen) => {
    anfrage.onsuccess = () => erfuellen(anfrage.result);
    anfrage.onerror = () => ablehnen(anfrage.error);
  });
}

/** Eine Transaktion als Promise — erfüllt sich, wenn sie wirklich durch ist. */
function warteAufTransaktion(tx) {
  return new Promise((erfuellen, ablehnen) => {
    tx.oncomplete = () => erfuellen();
    tx.onerror = () => ablehnen(tx.error);
    tx.onabort = () => ablehnen(tx.error || new Error("Transaktion abgebrochen"));
  });
}

export function istVerfuegbar() {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

export function oeffne() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((erfuellen, ablehnen) => {
    if (!istVerfuegbar()) {
      ablehnen(new Error("IndexedDB steht hier nicht zur Verfügung."));
      return;
    }
    const anfrage = indexedDB.open(DB_NAME, DB_VERSION);
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result;
      for (const name of [...DATEN_SPEICHER, ...VERWALTUNG]) {
        // Schlüssel stehen außerhalb des Werts (kein keyPath): die Datenart bestimmt,
        // was der Schlüssel ist — mal die id, mal der Barcode, mal Profil+Datum.
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      if (!db.objectStoreNames.contains(OUTBOX)) {
        db.createObjectStore(OUTBOX, { keyPath: "nr", autoIncrement: true });
      }
    };
    anfrage.onsuccess = () => {
      const db = anfrage.result;
      // Ein anderer Tab will auf eine neuere Fassung hoch: Verbindung freigeben, sonst
      // bleibt er hängen. Der eigene Tab lädt sich beim nächsten Zugriff neu.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      erfuellen(db);
    };
    anfrage.onerror = () => { dbPromise = null; ablehnen(anfrage.error); };
    anfrage.onblocked = () => ablehnen(new Error("Eine andere Fassung der App ist noch offen."));
  });
  return dbPromise;
}

/** Alle Zeilen eines Speichers als { schluessel, wert }. */
export async function alle(speicher) {
  const db = await oeffne();
  const tx = db.transaction(speicher, "readonly");
  const s = tx.objectStore(speicher);
  const [werte, schluessel] = await Promise.all([warte(s.getAll()), warte(s.getAllKeys())]);
  return werte.map((wert, i) => ({ schluessel: schluessel[i], wert }));
}

/** Nur die Werte — der übliche Fall beim Laden in den Speicher. */
export async function werte(speicher) {
  const db = await oeffne();
  const tx = db.transaction(speicher, "readonly");
  return warte(tx.objectStore(speicher).getAll());
}

/**
 * Schreibt mehrere Einträge in EINER Transaktion. Ein Aufruf je Zeile wäre um
 * Größenordnungen langsamer — beim erstmaligen Umzug sind es ein paar hundert.
 */
export async function schreibe(speicher, eintraege) {
  if (!eintraege || eintraege.length === 0) return;
  const db = await oeffne();
  const tx = db.transaction(speicher, "readwrite");
  const s = tx.objectStore(speicher);
  for (const { schluessel, wert } of eintraege) s.put(wert, schluessel);
  await warteAufTransaktion(tx);
}

export async function entferne(speicher, schluessel) {
  const liste = Array.isArray(schluessel) ? schluessel : [schluessel];
  if (liste.length === 0) return;
  const db = await oeffne();
  const tx = db.transaction(speicher, "readwrite");
  const s = tx.objectStore(speicher);
  for (const k of liste) s.delete(k);
  await warteAufTransaktion(tx);
}

export async function leere(speicher) {
  const db = await oeffne();
  const tx = db.transaction(speicher, "readwrite");
  tx.objectStore(speicher).clear();
  await warteAufTransaktion(tx);
}

/**
 * Ersetzt den Inhalt eines Speichers vollständig — Leeren und Schreiben in EINER
 * Transaktion. Getrennt ausgeführt bliebe der Speicher bei einem Abbruch dazwischen
 * leer zurück, und das wäre stiller Datenverlust.
 */
export async function ersetze(speicher, eintraege) {
  const db = await oeffne();
  const tx = db.transaction(speicher, "readwrite");
  const s = tx.objectStore(speicher);
  s.clear();
  for (const { schluessel, wert } of eintraege || []) s.put(wert, schluessel);
  await warteAufTransaktion(tx);
}

// ---------------------------------------------------------------------------
// lokal und meta — beides einfache Schlüssel/Wert-Ablagen
// ---------------------------------------------------------------------------
async function lies(speicher, schluessel, ersatz = null) {
  const db = await oeffne();
  const tx = db.transaction(speicher, "readonly");
  const wert = await warte(tx.objectStore(speicher).get(schluessel));
  return wert === undefined ? ersatz : wert;
}

async function setze(speicher, schluessel, wert) {
  await schreibe(speicher, [{ schluessel, wert }]);
}

export const lokal = {
  lies: (k, ersatz) => lies("lokal", k, ersatz),
  setze: (k, v) => setze("lokal", k, v),
};

export const meta = {
  lies: (k, ersatz) => lies("meta", k, ersatz),
  setze: (k, v) => setze("meta", k, v),
};

// ---------------------------------------------------------------------------
// Outbox — was dieses Gerät geändert hat und der Server noch nicht kennt.
//
// Ein Eintrag zeigt nur AUF eine Zeile, er kopiert sie nicht: beim Hochladen wird die
// aktuelle Fassung aus dem Speicher geholt. Wer eine Mahlzeit fünfmal korrigiert, bevor
// das Netz wieder da ist, schickt am Ende einmal den letzten Stand statt fünf Fassungen.
// ---------------------------------------------------------------------------
export async function outboxAnhaengen(entitaet, schluessel, art = "upsert") {
  const db = await oeffne();
  const tx = db.transaction(OUTBOX, "readwrite");
  tx.objectStore(OUTBOX).put({ entitaet, schluessel: String(schluessel), art, at: Date.now() });
  await warteAufTransaktion(tx);
}

export async function outboxAlle() {
  const db = await oeffne();
  const tx = db.transaction(OUTBOX, "readonly");
  return warte(tx.objectStore(OUTBOX).getAll());
}

export async function outboxEntfernen(nummern) {
  if (!nummern || nummern.length === 0) return;
  const db = await oeffne();
  const tx = db.transaction(OUTBOX, "readwrite");
  const s = tx.objectStore(OUTBOX);
  for (const nr of nummern) s.delete(nr);
  await warteAufTransaktion(tx);
}

/**
 * Fasst die Outbox zusammen: je (Datenart, Schlüssel) bleibt die LETZTE Absicht übrig,
 * und die verdrängten Einträge werden mitgeliefert, damit der Aufrufer sie nach
 * erfolgreichem Hochladen mit wegräumen kann.
 *
 * Reihenfolge zählt: "angelegt, dann gelöscht" muss als Löschung enden, nicht als
 * Anlage. Die Nummer ist fortlaufend, also ist die höchste die jüngste.
 */
export function fasseZusammen(eintraege) {
  const letzte = new Map();
  for (const e of [...eintraege].sort((a, b) => a.nr - b.nr)) {
    letzte.set(`${e.entitaet}\u0000${e.schluessel}`, e);
  }
  const behalten = new Set([...letzte.values()].map(e => e.nr));
  return {
    auftraege: [...letzte.values()],
    ueberholt: eintraege.filter(e => !behalten.has(e.nr)).map(e => e.nr),
  };
}

/** Nur für Tests und den Notfall: die ganze Datenbank verwerfen. */
export async function loescheAlles() {
  if (dbPromise) { (await dbPromise).close(); dbPromise = null; }
  await new Promise((erfuellen, ablehnen) => {
    const anfrage = indexedDB.deleteDatabase(DB_NAME);
    anfrage.onsuccess = () => erfuellen();
    anfrage.onerror = () => ablehnen(anfrage.error);
    anfrage.onblocked = () => erfuellen();
  });
}
