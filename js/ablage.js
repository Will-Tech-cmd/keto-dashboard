// ablage.js — der zeilenweise Speicher aus Sicht von store.js.
//
// store.js hält den Zustand weiter als EIN Objekt im Arbeitsspeicher. Alle Lesezugriffe
// (Store.get(), getConsumption(), …) bleiben deshalb synchron und keine einzige View
// muss angefasst werden. Nur der Weg auf die Platte ändert sich.
//
// Und der geht nicht mehr über "schreib den ganzen Klumpen neu", sondern über einen
// Vergleich: was hat sich seit dem letzten Speichern an den einzelnen Zeilen geändert?
// Genau die werden geschrieben und in die Outbox gelegt.
//
// Warum ein Vergleich und nicht ein Vermerk an jeder ändernden Store-Methode?
//
//   Weil ein Vermerk vergessen werden kann. store.js hat gut zwei Dutzend schreibende
//   Methoden; eine davon ohne Vermerk, und die Änderung stünde im Arbeitsspeicher, wäre
//   aber nach dem nächsten Start weg — und zwar still. Der Vergleich kann das nicht:
//   was im Zustand steht, steht danach auch in der Ablage.
//
//   Der Preis ist ein JSON.stringify je Zeile bei jedem Speichern, also rund 350 kleine
//   statt einem großen. Gemessen im Browser bei 345 Zeilen (200 Mahlzeiten, 20 Rezepte,
//   400 Produkte im Cache): rund 2 ms je Vergleich gegenüber gut 1 ms für den ganzen
//   Klumpen als Zeichenkette. Also nicht billiger, sondern eher etwas teurer — aber
//   einmal alle 250 ms und weit unter dem, was ein Bild auf der Startseite kostet.
//
//   Was dafür wegfällt: das Schreiben von 189 KB für eine Zeileänderung, die 5-MB-Grenze
//   des localStorage — und der Absturz an dieser Grenze, nach dem gar nichts mehr
//   gespeichert wird.

import * as db from "./db.js";
import { ENTITAETEN, REIHENFOLGE } from "./rows.js";
import { zerlege, fuege, NUR_LOKAL } from "./entities.js";

/** Zeichen fuer "steht gar nicht in der Ablage" — siehe laden(). */
const FEHLT = Symbol("fehlt");

/** Der zuletzt geschriebene Stand: Datenart -> Schlüssel -> Textfassung der Zeile. */
let stand = null;

/**
 * Schlüsselreihenfolge-unabhängige Textfassung.
 *
 * Ein Objekt, das über den Server gelaufen ist (rows.js: ausZeile), hat seine Felder in
 * einer anderen Reihenfolge als dasselbe Objekt aus der App. Ein nacktes JSON.stringify
 * hielte die beiden für verschieden und schriebe bei jedem Start alles noch einmal hoch.
 */
function stabil(wert) {
  if (wert === null || typeof wert !== "object") return JSON.stringify(wert) ?? "null";
  if (Array.isArray(wert)) return "[" + wert.map(stabil).join(",") + "]";
  const schluessel = Object.keys(wert).sort();
  return "{" + schluessel.map(k => JSON.stringify(k) + ":" + stabil(wert[k])).join(",") + "}";
}

/** Zustand -> Datenart -> Schlüssel -> { objekt, text }. */
function schnappschuss(state) {
  const listen = zerlege(state);
  const karte = new Map();
  for (const entitaet of REIHENFOLGE) {
    const def = ENTITAETEN[entitaet];
    const m = new Map();
    for (const objekt of listen[entitaet] || []) {
      const k = def.schluessel(objekt);
      if (k == null) continue; // unvollständige Zeile, gehört nicht in die Ablage
      m.set(String(k), { objekt, text: stabil(objekt) });
    }
    karte.set(entitaet, m);
  }
  return karte;
}

/**
 * Merkt sich einen Zustand als "steht so in der Ablage", ohne etwas zu schreiben.
 * Für den Start und für alles, was gerade erst aus der Ablage gelesen wurde — sonst
 * hielte der nächste Vergleich den komplett geladenen Zustand für lauter Änderungen.
 */
export function merkeStand(state) {
  stand = schnappschuss(state);
}

/** Liest den ganzen Zustand aus der Ablage. `basis` füllt, was dort (noch) nicht steht. */
export async function laden(basis = {}) {
  const entitaeten = {};
  for (const entitaet of REIHENFOLGE) entitaeten[entitaet] = await db.werte(entitaet);

  // FEHLT statt undefined oder null: db.lokal.lies() liefert fuer einen nicht vorhandenen
  // Schluessel den Ersatzwert, und der ist standardmaessig null. Ohne eigenes Zeichen
  // ueberschriebe ein nie geschriebenes Feld den Wert aus `basis` mit null — und ein
  // state.tombstones === null bringt die erste Loeschung zu Fall.
  const lokal = {};
  for (const feld of NUR_LOKAL) {
    const wert = await db.lokal.lies(feld, FEHLT);
    if (wert !== FEHLT) lokal[feld] = wert;
  }
  return fuege(entitaeten, { ...basis, ...lokal });
}

/** Steht überhaupt schon etwas in der Ablage? */
export async function istBefuellt() {
  for (const entitaet of REIHENFOLGE) {
    if ((await db.werte(entitaet)).length > 0) return true;
  }
  return false;
}

/**
 * Schreibt, was sich seit dem letzten Mal geändert hat.
 *
 * `lokaleFelder` sind die nicht abgeglichenen Teile des Zustands (Verlauf, Produkt-Cache,
 * zuletzt gescannt …), die diesmal angefasst wurden. Die werden nicht verglichen, sondern
 * auf Zuruf geschrieben: der Produkt-Cache allein ist größer als alles andere zusammen,
 * und ihn bei jedem Wassereintrag durchzurechnen wäre genau die Verschwendung, die dieser
 * Umbau abschaffen soll.
 *
 * `eigeneAenderung` entscheidet über die Outbox. false ist für alles, was gerade erst vom
 * Server kam — das muss nicht auf demselben Weg wieder hinaus.
 */
export async function schreibe(state, { lokaleFelder = [], eigeneAenderung = true } = {}) {
  const neu = schnappschuss(state);
  const auftraege = [];

  for (const entitaet of REIHENFOLGE) {
    const alt = stand?.get(entitaet) || new Map();
    const jetzt = neu.get(entitaet);

    const zuSchreiben = [];
    for (const [schluessel, eintrag] of jetzt) {
      const vorher = alt.get(schluessel);
      if (vorher && vorher.text === eintrag.text) continue;
      zuSchreiben.push({ schluessel, wert: eintrag.objekt });
      auftraege.push({ entitaet, schluessel, art: "upsert" });
    }

    const zuLoeschen = [];
    for (const schluessel of alt.keys()) {
      if (jetzt.has(schluessel)) continue;
      zuLoeschen.push(schluessel);
      auftraege.push({ entitaet, schluessel, art: "loeschen" });
    }

    if (zuSchreiben.length) await db.schreibe(entitaet, zuSchreiben);
    if (zuLoeschen.length) await db.entferne(entitaet, zuLoeschen);
  }

  for (const feld of new Set(lokaleFelder)) {
    if (NUR_LOKAL.includes(feld)) await db.lokal.setze(feld, state[feld]);
  }

  if (eigeneAenderung) {
    for (const a of auftraege) await db.outboxAnhaengen(a.entitaet, a.schluessel, a.art);
  }

  // Erst jetzt: bricht oben etwas ab, gilt der alte Stand weiter und der nächste
  // Durchlauf schreibt dieselben Zeilen noch einmal. Lieber zweimal als gar nicht.
  stand = neu;
  return auftraege;
}
