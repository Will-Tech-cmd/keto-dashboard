// modus.js — welcher Speicherweg auf diesem Gerät gilt.
//
// Der zeilenweise Speicher (db.js + sync2.js) läuft eine Zeit lang NEBEN dem alten
// JSON-Klumpen, nicht statt seiner. Der Schalter steht standardmäßig aus: wer nichts
// tut, benutzt weiter genau den Weg, der heute in Betrieb ist.
//
// Bewusst im localStorage und nicht in IndexedDB: store.js muss beim Start sofort
// wissen, welchen Weg es nimmt — noch bevor irgendetwas Asynchrones passiert ist.
//
// Der Schalter gehört auf ALLE Geräte eines Haushalts. Solange ein Gerät noch den
// Klumpen abgleicht und ein anderes schon Zeilen, sehen die beiden voneinander nichts;
// verloren geht dabei nichts (jedes Gerät behält seinen vollständigen Stand), aber
// Neues kommt erst wieder an, wenn beide auf demselben Weg sind.

const SCHLUESSEL = "keto-dashboard-zeilenmodus";

export function zeilenModus() {
  try {
    return localStorage.getItem(SCHLUESSEL) === "an";
  } catch {
    return false;
  }
}

export function setzeZeilenModus(an) {
  try {
    if (an) localStorage.setItem(SCHLUESSEL, "an");
    else localStorage.removeItem(SCHLUESSEL);
  } catch { /* kein localStorage: dann bleibt es beim Standard */ }
}
