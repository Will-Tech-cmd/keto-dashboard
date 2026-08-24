// umzug.js — vom localStorage-Klumpen in die zeilenweise Ablage.
//
// Läuft genau einmal je Gerät. Danach ist IndexedDB die Wahrheit, und der alte Schlüssel
// bleibt unangetastet liegen: solange nicht sicher ist, dass alles gut gegangen ist, wird
// nichts weggeworfen. Aufräumen ist ein eigener, späterer Schritt.
//
// Der Umzug ist wiederholbar. Bricht er ab (Tab geschlossen, Speicher voll), startet er
// beim nächsten Mal von vorn; geschrieben wird je Datenart in einem Rutsch, und die
// Fertig-Marke fällt erst ganz am Ende.

import * as db from "./db.js";
import { zerlege, nurLokales } from "./entities.js";
import { ENTITAETEN, REIHENFOLGE } from "./rows.js";

const ALTER_SCHLUESSEL = "keto-dashboard-v1";
const MARKE = "umzugFertig";

/** Ist der Umzug auf diesem Gerät schon gelaufen? */
export async function istUmgezogen() {
  return (await db.meta.lies(MARKE, null)) != null;
}

/** Der alte Zustand, falls es ihn noch gibt. */
export function alterZustand() {
  try {
    const roh = localStorage.getItem(ALTER_SCHLUESSEL);
    if (!roh) return null;
    const geparst = JSON.parse(roh);
    return geparst && typeof geparst === "object" && Array.isArray(geparst.profiles) ? geparst : null;
  } catch {
    return null;
  }
}

/**
 * Schiebt einen Zustand in die zeilenweise Ablage.
 *
 * `alsEigeneAenderung` entscheidet über die Outbox — und damit darüber, ob dieses Gerät
 * seinen Bestand für den Server als eigene Änderung anmeldet:
 *
 *   true   das erste Gerät. Sein Bestand ist der Bestand und muss hoch.
 *   false  jedes weitere. Dessen Zeilen liegen schon auf dem Server (die Geräte haben
 *          sich über den alten Abgleich längst getroffen), und ein zweites Hochladen mit
 *          womöglich älteren Zeitstempeln würde nur den Wächter-Trigger beschäftigen.
 *
 * Wer der Erste ist, entscheidet nicht die App: es ist der Aufrufer, der beim Server
 * nachsieht, ob dort schon etwas liegt.
 */
export async function umziehen(state, { alsEigeneAenderung = true } = {}) {
  const entitaeten = zerlege(state);
  const bilanz = {};

  for (const entitaet of REIHENFOLGE) {
    const def = ENTITAETEN[entitaet];
    const eintraege = entitaeten[entitaet].map(objekt => ({
      schluessel: String(def.schluessel(objekt)),
      wert: objekt,
    }));
    // ersetze() statt schreibe(): ein zweiter Anlauf nach einem Abbruch soll nicht auf
    // Halbfertigem aufsetzen.
    await db.ersetze(entitaet, eintraege);
    if (alsEigeneAenderung) {
      for (const e of eintraege) await db.outboxAnhaengen(entitaet, e.schluessel, "upsert");
    }
    bilanz[entitaet] = eintraege.length;
  }

  // Alles, was nie zum Server wandert, kommt unverändert mit (Entscheidung B0.2).
  const lokal = nurLokales(state);
  for (const [feld, wert] of Object.entries(lokal)) {
    if (feld === "tombstones") continue; // gibt es im Zeilenmodell nicht mehr
    await db.lokal.setze(feld, wert);
  }

  await db.meta.setze(MARKE, { at: Date.now(), bilanz });
  return bilanz;
}

/**
 * Der ganze Vorgang für den Start der App: nichts zu tun, wenn schon umgezogen oder wenn
 * es gar keinen alten Zustand gibt (frisch installiertes Gerät).
 */
export async function umzugFallsNoetig({ serverHatSchonDaten = false } = {}) {
  if (await istUmgezogen()) return { uebersprungen: "schon umgezogen" };
  const state = alterZustand();
  if (!state) {
    // Nichts umzuziehen, aber die Marke setzen: sonst wird bei jedem Start gesucht.
    await db.meta.setze(MARKE, { at: Date.now(), bilanz: {} });
    return { uebersprungen: "kein alter Zustand" };
  }
  return { bilanz: await umziehen(state, { alsEigeneAenderung: !serverHatSchonDaten }) };
}

/** Nur für Tests und den Notfall. */
export async function markeLoeschen() {
  await db.meta.setze(MARKE, null);
}
