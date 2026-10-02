// speicher.js — IndexedDB als schlichter Schlüssel-Wert-Speicher.
//
// Eine eigene Datenbank „sema“, getrennt von der Keto-App auf demselben Origin. Ein Objekt-
// speicher mit wenigen großen Werten (favs, eintraege, profil, …) statt Tabellen je Art:
// es sind höchstens ein paar hundert Einträge, und ein Abgleich Zeile für Zeile ist laut
// Spezifikation ausdrücklich kein Ziel. IndexedDB statt localStorage, weil die Spezifikation
// es so vorgibt und weil localStorage synchron ist und bei größeren Werten die Oberfläche
// blockiert. dauerhaftAnfragen() bittet den Browser, die Daten nicht bei Platzmangel zu räumen.

const DB_NAME = "sema";
const STORE = "kv";

let dbPromise = null;

function oeffnen() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function lesen(schluessel, ersatz) {
  const db = await oeffnen();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(schluessel);
    req.onsuccess = () => resolve(req.result === undefined ? ersatz : req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function schreiben(schluessel, wert) {
  const db = await oeffnen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(wert, schluessel);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function dauerhaftAnfragen() {
  navigator.storage?.persist?.().catch(() => {});
}
