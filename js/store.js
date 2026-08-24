// store.js — zentrale Datenhaltung: der Zustand im Arbeitsspeicher, plus der Weg auf die Platte.
//
// Zwei Wege, umschaltbar (modus.js), Standard ist der erste:
//
//   Klumpen  alles als EIN JSON unter einem localStorage-Schlüssel. Der gewachsene Weg.
//   Zeilen   jede Datenart einzeln in IndexedDB (ablage.js), Änderungen über eine Outbox
//            an den zeilenweisen Abgleich (sync2.js).
//
// Was sich NICHT ändert: der Zustand liegt in beiden Fällen komplett im Arbeitsspeicher und
// wird synchron gelesen. Store.get() und alles darunter bleibt Wort für Wort gleich, keine
// einzige View muss etwas davon wissen. Nur der Start ist im Zeilenmodus asynchron (siehe
// bereit()) — genau eine Stelle, in app.js.

import { zeilenModus, setzeZeilenModus } from "./modus.js";
import * as ablage from "./ablage.js";
import * as db from "./db.js";
import * as umzug from "./umzug.js";
import { nurLokales } from "./entities.js";

const KEY = "keto-dashboard-v1";
const SCHEMA_VERSION = 1;

function defaultProfile(name) {
  return {
    id: crypto.randomUUID(),
    name,
    // Eingabedaten
    sex: "female",          // "female" | "male"
    age: 35,
    heightCm: 170,
    weightKg: 70,
    bodyFatPct: null,       // optional, aktiviert Katch-McArdle
    activity: 1.375,        // PAL
    goal: "lose",           // "lose" | "maintain" | "gain"
    deficitPct: 15,         // nur relevant bei goal = "lose"
    proteinFactor: 1.6,     // g je kg fettfreier Masse
    netCarbLimitG: 20,      // Tagesbudget Netto-KH (frei editierbar)
    dietType: "keto",       // "keto" | "lowcarb" | "other" -> steuert Ampel-Standardwerte
    gradeThresholds: { green: 5, yellow: 10 }, // g Netto-KH je 100g, frei editierbar
    waterTargetMl: 2500,    // Tagesziel Trinkmenge (frei editierbar), unabhängig von den Makro-Zielen
    appearance: "system",   // "system" | "light" | "dark" — schlägt bei explizitem Wert die Systemeinstellung
    ringStyle: "rings",     // "rings" (2x2) | "row" (vier in einer Reihe) | "concentric" (ein Ring, vier Bahnen)
  };
}

function defaultState() {
  const p1 = defaultProfile("Profil 1");
  const p2 = defaultProfile("Profil 2");
  p2.sex = "female";
  return {
    schemaVersion: SCHEMA_VERSION,
    onboarded: false, // steuert den Ersteinrichtungs-Dialog ("Wie heißt du?") bei neuen Geräten
    profiles: [p1, p2],
    activeProfileId: p1.id,
    favorites: [],     // { barcode, name, brand, addedAt, netCarbs100, grade }
    noGo: [],
    shoppingList: [],  // { id, text, checked, barcode? }
    ownProducts: {},   // barcode -> product object (manuell angelegt)
    cache: {},         // barcode -> { product, fetchedAt }
    recent: [],        // zuletzt gescannte barcodes, neueste zuerst
    history: [],        // { id, barcode, name, brand, grade, netCarbs100, source, profileName, at }
    consumption: [],    // { id, profileId, barcode, name, grams|servings, servingG, meal, dateKey, kcal, netCarbs, fat, protein, at }
    water: [],          // { id, profileId, dateKey, ml, at }
    recipes: [],         // { id, name, servings, ingredients: [{id,name,grams,per100,likelyUsLabel}], createdAt, updatedAt }
    fiberOverrides: {},  // barcode -> true|false|null (null = bewusst zurückgesetzt), überschreibt die EU/US-Erkennung
    // Zeitpunkt der letzten Änderung je Schalter — ohne ihn kann ein Abgleich nicht
    // entscheiden, welche der beiden Fassungen die neuere ist (siehe applyMerge()).
    fiberOverridesAt: {}, // barcode -> Zeitstempel
    dayTargets: {},      // profileId -> { dateKey -> { kcal, netCarbG, fatG, proteinG } }, friert vergangene Tage ein
    // Löschungen, damit ein Merge (Datei-Import oder Online-Sync) sie nicht aus der jeweils
    // anderen, noch ahnungslosen Seite wieder aufleben lässt — siehe applyMerge(). id/barcode
    // -> Zeitpunkt der Löschung; historyClearedAt ist ein einzelner Schnitt statt vieler
    // Einzel-Einträge, weil clearHistory() ohnehin alles auf einmal leert.
    tombstones: {
      consumption: {}, water: {}, shoppingList: {}, recipes: {}, favorites: {}, noGo: {},
      historyClearedAt: 0,
    },
  };
}

/** Lokales Datum (nicht UTC) als "YYYY-MM-DD" — Schlüssel für Tagesplanung/Auswertung. */
export function dateKeyOf(timestamp) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Der dateKey `deltaDays` Tage neben `dateKey` — über den lokalen Kalender statt über feste
 * 24-Stunden-Schritte. `Date.now() - i * 86400000` verschluckt an der Zeitumstellung einen
 * Kalendertag: steht die Uhr zwischen 0:00 und 1:00, landet der Schritt über die Märznacht
 * hinweg im vorvergangenen Tag, und der Tag der Umstellung fehlt in Auswertung und Bericht.
 */
export function shiftDateKey(dateKey, deltaDays) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return dateKeyOf(new Date(y, m - 1, d + deltaDays).getTime());
}

const HISTORY_LIMIT = 500;
const CONSUMPTION_LIMIT = 1000;
// Sicherung des Stands unmittelbar vor einem Import/Abgleich — bewusst ein eigener Schlüssel,
// damit sie nicht selbst wieder überschrieben oder mitexportiert wird.
const PREMERGE_KEY = "keto-dashboard-premerge";

// Nach dieser Frist gilt eine Löschung als überall angekommen und der Grabstein wird
// weggeräumt — sonst wächst die Karte unbegrenzt und frisst irgendwann das Speicherkontingent
// (siehe writeNow()). Der Preis: ein Gerät, das länger als diese Frist gar nicht abgeglichen
// hat, bringt bereits gelöschte Einträge beim nächsten Mal noch einmal mit.
const TOMBSTONE_TTL_MS = 180 * 86400000;
// Obergrenze für den Produkt-Cache. Er ist reiner Komfort (jederzeit von Open Food Facts
// nachladbar), macht aber den Großteil der Datenmenge aus — ohne Deckel läuft der localStorage
// irgendwann über und ab da wird NICHTS mehr gespeichert, auch keine Mahlzeit mehr.
const CACHE_LIMIT = 400;

/** Die Listen, deren Löschungen über einen Grabstein festgehalten werden — je mit dem Feld,
 * das einen Eintrag identifiziert, und dem Zeitpunkt seiner letzten Änderung. */
const TOMBSTONED = [
  { name: "consumption", keyOf: e => e.id, timeOf: e => e.updatedAt || e.at || 0 },
  { name: "water", keyOf: e => e.id, timeOf: e => e.at || 0 },
  { name: "shoppingList", keyOf: e => e.id, timeOf: e => e.updatedAt || 0 },
  { name: "recipes", keyOf: e => e.id, timeOf: e => e.updatedAt || e.createdAt || 0 },
  { name: "favorites", keyOf: e => e.barcode, timeOf: e => e.updatedAt || e.addedAt || 0 },
  { name: "noGo", keyOf: e => e.barcode, timeOf: e => e.updatedAt || e.addedAt || 0 },
];
const TOMBSTONED_BY_NAME = Object.fromEntries(TOMBSTONED.map(t => [t.name, t]));

// ACHTUNG: alles, was load() -> migrate() braucht, muss OBERHALB dieser Zeile stehen.
// Funktionsdeklarationen werden hochgezogen, const/let NICHT — eine Konstante weiter unten
// wirft hier einen "Cannot access before initialization" und die App startet mit leeren Daten.
let state = load();

/** Ergänzt Bestandsdaten (egal ob aus localStorage geladen oder importiert) um Felder, die
 * es zum Speicherzeitpunkt noch nicht gab — ohne vorhandene Werte anzutasten. */
/**
 * Gilt ein Eintrag als gelöscht? Nur, wenn die Löschung NEUER ist als der Eintrag selbst.
 * Ohne diesen Vergleich gälte ein Grabstein für immer: ein Produkt, das einmal von den
 * Favoriten entfernt und später wieder aufgenommen wurde, verschwände beim nächsten Abgleich
 * sofort wieder, weil sein Barcode noch in der Grabstein-Karte steht.
 */
function isDeleted(tombMap, key, entryTime) {
  const deletedAt = (tombMap || {})[key];
  return deletedAt != null && deletedAt >= (entryTime || 0);
}

/** Behält nur die zuletzt geholten CACHE_LIMIT Produkte. */
function prunedCache(cache) {
  const entries = Object.entries(cache || {});
  if (entries.length <= CACHE_LIMIT) return cache || {};
  entries.sort((a, b) => (b[1]?.fetchedAt || 0) - (a[1]?.fetchedAt || 0));
  return Object.fromEntries(entries.slice(0, CACHE_LIMIT));
}

function migrate(parsed) {
  const base = defaultState();
  const merged = { ...base, ...parsed };
  // Grabstein-Karten vollständig machen: Sicherungen aus der Zeit vor einzelnen Karten (oder
  // vor den Grabsteinen überhaupt) hätten sonst Lücken, über die applyMerge() stolperte.
  merged.tombstones = { ...base.tombstones, ...(parsed.tombstones || {}) };
  const tombCutoff = Date.now() - TOMBSTONE_TTL_MS;
  for (const { name } of TOMBSTONED) {
    merged.tombstones[name] = Object.fromEntries(
      Object.entries(merged.tombstones[name] || {}).filter(([, at]) => at > tombCutoff)
    );
  }
  merged.fiberOverrides = merged.fiberOverrides || {};
  merged.fiberOverridesAt = merged.fiberOverridesAt || {};
  // Bestandsdaten von vor Einführung des Onboardings: nicht nachträglich zur
  // Ersteinrichtung zwingen, nur wirklich neue Geräte sollen den Dialog sehen.
  if (parsed.onboarded === undefined) merged.onboarded = true;
  // Bestehende Profile (vor Einführung der Ernährungsform) um die neuen Felder ergänzen,
  // ohne ihre sonstigen Werte anzutasten.
  merged.profiles = merged.profiles.map(p => ({
    dietType: "keto",
    gradeThresholds: { green: 5, yellow: 10 },
    waterTargetMl: 2500,
    appearance: "system",
    ringStyle: "rings",
    ...p,
  }));
  // Verbrauchs-Einträge von vor Tagesplanung/Mahlzeiten: dateKey aus dem Zeitstempel
  // ableiten, damit sie weiterhin ihrem ursprünglichen Tag zugeordnet bleiben.
  merged.consumption = merged.consumption.map(e => ({
    meal: null,
    servingG: null,
    ...e,
    dateKey: e.dateKey || dateKeyOf(e.at),
  }));
  merged.cache = prunedCache(merged.cache);
  return merged;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.schemaVersion) return defaultState();
    // Platz für künftige Migrationen anhand schemaVersion
    return migrate(parsed);
  } catch (e) {
    console.warn("Store: konnte gespeicherte Daten nicht lesen, starte neu.", e);
    return defaultState();
  }
}

// Persistieren wird debounced: ein schneller Klick-Ausbruch (z.B. 5× "+200 ml Wasser") soll nicht
// 5 synchrone localStorage-Schreibvorgänge auslösen. Beim Verlassen der App (Tab wechseln,
// schließen) wird sofort geschrieben — sonst ginge eine Änderung kurz vor dem Schließen verloren.
let persistTimer = null;
// Stammt die noch nicht geschriebene Änderung von diesem Gerät, oder kam sie gerade über den
// Abgleich herein? Nur eigene Änderungen dürfen einen neuen Push auslösen — sonst schaukeln
// sich Empfangen und Senden endlos gegenseitig hoch (siehe sync.js).
let pendingIsLocal = false;

// Gilt der zeilenweise Speicher? Wird in bereit() festgelegt und danach nicht mehr geändert.
let zeilen = false;

// Nur für den Zeilenmodus: welche der nicht abgeglichenen Teile (Verlauf, Produkt-Cache,
// zuletzt gescannt …) seit dem letzten Schreiben angefasst wurden. Die werden auf Zuruf
// geschrieben statt verglichen — der Produkt-Cache allein ist größer als alles andere
// zusammen (siehe ablage.js).
const angefassteLokale = new Set();

// Schreibvorgänge laufen nacheinander. Ohne diese Kette könnten sich zwei Durchläufe
// überholen und der ältere Stand am Ende gewinnen.
let schreibLauf = Promise.resolve();

function writeNow() {
  clearTimeout(persistTimer);
  persistTimer = null;
  const origin = pendingIsLocal ? "local" : "remote";
  pendingIsLocal = false;
  const felder = [...angefassteLokale];
  angefassteLokale.clear();

  if (zeilen) {
    schreibLauf = schreibLauf
      .then(() => ablage.schreibe(state, { lokaleFelder: felder, eigeneAenderung: origin === "local" }))
      .then(
        () => { changeListeners.forEach(fn => fn(origin)); },
        (e) => {
          // Die Felder zurück in die Merkliste: der nächste Durchlauf soll sie noch einmal
          // versuchen, statt sie stillschweigend fallen zu lassen.
          for (const f of felder) angefassteLokale.add(f);
          console.warn("Store: persistieren fehlgeschlagen", e);
          persistErrorListeners.forEach(fn => fn(e));
        }
      );
    return;
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    // Kein Platz mehr. Der Produkt-Cache ist das einzige, was gefahrlos wegkann — er lässt
    // sich jederzeit nachladen. Danach ein zweiter Versuch; scheitert auch der, muss der
    // Mensch das erfahren, statt dass ab hier stillschweigend nichts mehr gespeichert wird.
    state.cache = {};
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e2) {
      console.warn("Store: persistieren fehlgeschlagen", e2);
      persistErrorListeners.forEach(fn => fn(e2));
      return;
    }
  }
  changeListeners.forEach(fn => fn(origin));
}

/**
 * Speichern anmelden. Die genannten Felder sind die NICHT abgeglichenen Teile des Zustands,
 * die diese Änderung angefasst hat (siehe NUR_LOKAL in entities.js) — im Klumpenmodus ohne
 * Bedeutung, im Zeilenmodus die Ansage, was außer den Zeilen noch geschrieben werden muss.
 */
function persist(...lokaleFelder) {
  pendingIsLocal = true;
  for (const f of lokaleFelder) angefassteLokale.add(f);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(writeNow, 250);
}

/** Wie persist(), markiert die Änderung aber NICHT als "von hier" — für alles, was gerade erst
 * über den Abgleich hereinkam und deshalb nicht sofort wieder hochgeladen werden muss. Eine
 * daneben noch offene eigene Änderung bleibt dabei als solche stehen und wird weiterhin
 * gepusht: pendingIsLocal wird hier bewusst nur nicht gesetzt, nicht zurückgenommen. */
function persistFromRemote(...lokaleFelder) {
  for (const f of lokaleFelder) angefassteLokale.add(f);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(writeNow, 250);
}

// ---------------------------------------------------------------------------
// Start im Zeilenmodus
// ---------------------------------------------------------------------------

let bereitschaft = null;

/**
 * Bringt den Zustand in den Speicher und legt den Speicherweg fest. Muss einmal vor der
 * ersten Benutzung abgewartet werden (app.js) — danach ist wieder alles synchron.
 *
 * Im Klumpenmodus ist nichts zu tun: der Zustand steht seit dem Laden dieses Moduls.
 * Im Zeilenmodus wird beim ersten Mal umgezogen und danach aus IndexedDB gelesen.
 *
 * Geht dabei etwas schief, bleibt es beim Klumpen. Ein Fehler in der neuen Ablage darf
 * niemanden vor eine leere App setzen.
 */
export function bereit() {
  if (!bereitschaft) bereitschaft = starte();
  return bereitschaft;
}

async function starte() {
  if (!zeilenModus()) return { modus: "klumpen" };
  if (!db.istVerfuegbar()) {
    console.warn("Store: IndexedDB steht nicht zur Verfügung — bleibe beim bisherigen Speicher.");
    return { modus: "klumpen", grund: "IndexedDB fehlt" };
  }
  try {
    let bilanz = null;
    if (!(await umzug.istUmgezogen())) {
      if (await ablage.istBefuellt()) {
        // Es stehen schon Zeilen da, aber der Umzugsvermerk fehlt — dann hat sie ein
        // Abgleich hineingeschrieben, nicht dieses Gerät. NICHT umziehen: der Umzug
        // ersetzt jede Datenart komplett und räumte das gerade Geholte wieder weg.
        await umzug.markeSetzen();
      } else {
        // Bewusst der bereits geladene und ergänzte Zustand, nicht der rohe localStorage-Text:
        // so wandern auch die Felder mit, die migrate() gerade erst nachgetragen hat.
        //
        // alsEigeneAenderung nur bei einem eingerichteten Gerät: die beiden Vorgabeprofile
        // eines frisch installierten haben auf dem Server nichts verloren. Sie liegen lokal
        // und gehen erst hoch, wenn jemand sie zu echten Profilen macht.
        bilanz = await umzug.umziehen(state, { alsEigeneAenderung: !!state.onboarded });
      }
    }
    // migrate() auch hier: es füllt jedes Feld, das die Ablage (noch) nicht kennt, mit
    // seinem Standardwert. Ohne das käme ein Zustand mit fehlenden Teilen durch — und die
    // fällt erst dort auf, wo jemand sie benutzt.
    const geladen = migrate(await ablage.laden(nurLokales(state)));
    // Ein frisches Gerät hat noch nichts in der Ablage. Dann bleiben die Vorgabeprofile aus
    // defaultState() stehen, bis die Ersteinrichtung echte daraus macht — der erste
    // Vergleich schreibt sie dann.
    state = geladen.profiles.length > 0
      ? geladen
      : { ...geladen, profiles: state.profiles, activeProfileId: state.activeProfileId };
    ablage.merkeStand(state);
    zeilen = true;
    return { modus: "zeilen", bilanz };
  } catch (e) {
    console.warn("Store: Zeilenmodus nicht startbar — bleibe beim bisherigen Speicher.", e);
    return { modus: "klumpen", grund: String((e && e.message) || e) };
  }
}

/**
 * Liest den Zustand neu aus der Ablage — nach einem Abgleich, der dort direkt geschrieben hat
 * (sync2.js kennt store.js nicht und soll es auch nicht kennen).
 *
 * Vorher wird ein noch offenes eigenes Speichern zu Ende gebracht: sonst überschriebe der
 * frisch geladene Stand eine Eingabe, die noch in der 250ms-Verzögerung hängt.
 *
 * Gibt zurück, ob wirklich neu geladen wurde.
 */
export async function neuLadenAusAblage() {
  if (!zeilen) return false;
  if (persistTimer) writeNow();
  await schreibLauf;
  const geladen = migrate(await ablage.laden(nurLokales(state)));
  // Leere Ablage bei vollem Speicher heißt nicht "alles gelöscht", sondern "da ist etwas
  // schiefgegangen". Dann lieber nichts tun.
  if (geladen.profiles.length === 0 && state.profiles.length > 0) return false;
  state = geladen;
  ablage.merkeStand(state);
  changeListeners.forEach(fn => fn("remote"));
  return true;
}

/** Welcher Speicherweg gilt gerade wirklich? (Nicht dasselbe wie der Schalter: fällt der
 * Zeilenmodus beim Start aus, steht der Schalter auf "an" und hier trotzdem false.) */
export function istZeilenModus() {
  return zeilen;
}

/**
 * Schaltet den Speicherweg um und schreibt den aktuellen Stand in die jeweils andere Ablage.
 * Danach muss die Seite neu geladen werden — der laufende Zustand hängt an Modulvariablen,
 * die sich nicht sinnvoll mittendrin umstellen lassen.
 *
 * In beide Richtungen, und in beiden Fällen mit dem, was gerade im Speicher steht. Der
 * Schalter ist damit gefahrlos hin und her bedienbar; ohne dieses Umschreiben wäre die
 * jeweils andere Ablage veraltet und Eingaben verschwänden beim Zurückschalten.
 */
export async function wechsleModus(an) {
  if (!!an === zeilenModus()) return false;
  if (persistTimer) writeNow();
  await schreibLauf;
  if (an) {
    if (!db.istVerfuegbar()) throw new Error("IndexedDB steht auf diesem Gerät nicht zur Verfügung.");
    await umzug.markeLoeschen();
    await umzug.umziehen(state, { alsEigeneAenderung: true });
    ablage.merkeStand(state);
    setzeZeilenModus(true);
  } else {
    localStorage.setItem(KEY, JSON.stringify(state));
    setzeZeilenModus(false);
  }
  // Auch hier umstellen, nicht nur den Schalter: normalerweise lädt die Seite gleich neu,
  // aber solange sie das nicht getan hat, muss ein weiteres persist() schon in die neue
  // Ablage gehen — sonst landet die nächste Eingabe in der gerade verlassenen.
  zeilen = !!an;
  return true;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && persistTimer) writeNow();
  });
  window.addEventListener("pagehide", () => { if (persistTimer) writeNow(); });
}

/** Prüft eine Backup-Datei und gibt den Inhalt zurück. Wirft mit klarer Meldung bei Unfug. */
function parseBackup(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Bewusst nicht "keine gültige JSON-Datei": Backups werden als .txt exportiert (damit sie
    // sich über WhatsApp teilen lassen), die Meldung ließ Nutzer nach einer .json-Datei suchen.
    throw new Error("Das ist keine Backup-Datei aus dieser App.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.profiles)) {
    throw new Error("Ungültige Datei: kein gültiges Keto-Dashboard-Backup.");
  }
  return parsed;
}

/** Legt den aktuellen Stand als Sicherung ab, damit ein Import rückgängig gemacht werden kann. */
function savePreMergeBackup() {
  try {
    const { cache, ...withoutCache } = state;
    localStorage.setItem(PREMERGE_KEY, JSON.stringify({ at: Date.now(), snapshot: withoutCache }));
  } catch (e) {
    // Kein Platz mehr im Speicher: der Import soll trotzdem laufen, nur eben ohne Netz.
    console.warn("Sicherung vor dem Zusammenführen konnte nicht angelegt werden.", e);
  }
}

/** Felder, in denen sich zwei Fassungen desselben Profils unterscheiden (ohne updatedAt). */
function diffProfiles(mine, theirs) {
  const out = [];
  for (const t of theirs || []) {
    const m = (mine || []).find(p => p.id === t.id);
    if (!m) continue;
    const fields = Object.keys({ ...m, ...t })
      .filter(k => k !== "updatedAt" && JSON.stringify(m[k]) !== JSON.stringify(t[k]));
    if (fields.length) out.push({ id: t.id, name: m.name, fields, local: m, file: t });
  }
  return out;
}

/**
 * Vereint einen eingehenden Zustand (aus Datei-Import oder Online-Sync) mit dem lokalen
 * Zustand — union über IDs, jüngerer Zeitstempel gewinnt bei Kollisionen. Geteilt von
 * Store.mergeJSON() (mit Sicherung) und Store.mergeJSONQuiet() (ohne, für sync.js).
 */
/** Vereint zwei Tombstone-Karten (id/barcode -> Löschzeitpunkt) — bei Kollision gewinnt der
 * spätere Zeitpunkt, auch wenn beide Seiten dieselbe id schon mal gelöscht haben. */
function mergeTombstoneMap(mine, theirs) {
  const merged = { ...mine };
  for (const [key, at] of Object.entries(theirs || {})) {
    if (!merged[key] || at > merged[key]) merged[key] = at;
  }
  return merged;
}

function applyMerge(incoming, profileChoice) {
  const unionById = (mine, theirs) => {
    const map = new Map((mine || []).map(x => [x.id, x]));
    for (const x of theirs || []) if (!map.has(x.id)) map.set(x.id, x);
    return [...map.values()];
  };
  const byTimeDesc = (a, b) => (b.at || 0) - (a.at || 0);

  // Löschungen zuerst zusammenführen: eine auf einer Seite gelöschte id darf die Vereinigung
  // unten nicht wieder aufleben lassen, nur weil sie der anderen Seite noch fehlt.
  const tomb = state.tombstones;
  const incomingTomb = incoming.tombstones || {};
  tomb.consumption = mergeTombstoneMap(tomb.consumption, incomingTomb.consumption);
  tomb.water = mergeTombstoneMap(tomb.water, incomingTomb.water);
  tomb.shoppingList = mergeTombstoneMap(tomb.shoppingList, incomingTomb.shoppingList);
  tomb.recipes = mergeTombstoneMap(tomb.recipes, incomingTomb.recipes);
  tomb.favorites = mergeTombstoneMap(tomb.favorites, incomingTomb.favorites);
  tomb.noGo = mergeTombstoneMap(tomb.noGo, incomingTomb.noGo);
  tomb.historyClearedAt = Math.max(tomb.historyClearedAt || 0, incomingTomb.historyClearedAt || 0);

  /**
   * Vereint eine Liste: gleicher Schlüssel -> die zeitlich neuere Fassung gewinnt (Mengen,
   * Haken und Nährwerte lassen sich nachträglich ändern, siehe rescaleConsumption /
   * toggleShoppingItem / updateListEntry), Unbekanntes kommt dazu, Gelöschtes bleibt draußen.
   *
   * Der Grabstein zählt nur, wenn er NEUER ist als die Fassung, die gerade vorliegt — sonst
   * bliebe ein einmal gelöschter Schlüssel für immer gesperrt und ein wieder aufgenommener
   * Favorit verschwände beim nächsten Abgleich sofort erneut (siehe isDeleted()).
   */
  const mergeList = (name) => {
    const { keyOf, timeOf } = TOMBSTONED_BY_NAME[name];
    const map = new Map((state[name] || []).map(e => [keyOf(e), e]));
    for (const e of incoming[name] || []) {
      const key = keyOf(e);
      if (key == null) continue;
      const mine = map.get(key);
      if (!mine || timeOf(e) > timeOf(mine)) map.set(key, e);
    }
    return [...map.values()].filter(e => !isDeleted(tomb[name], keyOf(e), timeOf(e)));
  };

  state.consumption = mergeList("consumption").sort(byTimeDesc).slice(0, CONSUMPTION_LIMIT);
  state.water = mergeList("water").sort(byTimeDesc);
  state.shoppingList = mergeList("shoppingList");
  state.recipes = mergeList("recipes").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  state.favorites = mergeList("favorites");
  state.noGo = mergeList("noGo");

  // Der Verlauf ist ein reines Protokoll ohne Bearbeitung — Vereinigung reicht, Löschungen
  // gibt es dort nur als einen Schnitt über alles (clearHistory).
  state.history = unionById(state.history, incoming.history)
    .filter(e => (e.at || 0) > tomb.historyClearedAt)
    .sort(byTimeDesc).slice(0, HISTORY_LIMIT);

  // Eigene Produkte: je Barcode gewinnt die zuletzt bearbeitete Fassung (updatedAt aus
  // saveOwnProduct). Vorher behielt jedes Gerät stur seine eigene — eine Korrektur, die auf dem
  // zweiten Handy gemacht wurde, kam damit nie an und beide überschrieben sich abwechselnd.
  const own = { ...state.ownProducts };
  for (const [barcode, product] of Object.entries(incoming.ownProducts || {})) {
    const mine = own[barcode];
    if (!mine || (product?.updatedAt || 0) > (mine.updatedAt || 0)) own[barcode] = product;
  }
  state.ownProducts = own;

  // Ballaststoff-Schalter genauso, mit dem Zeitstempel aus der Parallel-Karte. Ein bewusst
  // zurückgesetzter Schalter steht als null drin statt zu fehlen — sonst ließe sich
  // "zurückgesetzt" nicht von "kennt diesen Barcode noch nicht" unterscheiden.
  const incomingFiberAt = incoming.fiberOverridesAt || {};
  for (const [barcode, value] of Object.entries(incoming.fiberOverrides || {})) {
    const known = Object.prototype.hasOwnProperty.call(state.fiberOverrides, barcode);
    const theirAt = incomingFiberAt[barcode] || 0;
    if (!known || theirAt > (state.fiberOverridesAt[barcode] || 0)) {
      state.fiberOverrides[barcode] = value;
      state.fiberOverridesAt[barcode] = theirAt;
    }
  }

  // Eingefrorene Tagesziele je Profil und Tag — neuere Fassung gewinnt (frozenAt). Zwei
  // Geräte können denselben Tag zu unterschiedlichen Zeitpunkten einfrieren, wenn eine
  // Profil-Änderung erst nach Mitternacht ankommt; ohne frozenAt auf beiden Seiten (alte
  // Bestandsdaten) gewinnt weiterhin lokal, wie bisher.
  for (const [profileId, days] of Object.entries(incoming.dayTargets || {})) {
    const mineDays = state.dayTargets[profileId] || (state.dayTargets[profileId] = {});
    for (const [dateKey, targets] of Object.entries(days)) {
      const mine = mineDays[dateKey];
      if (!mine || (targets.frozenAt || 0) > (mine.frozenAt || 0)) mineDays[dateKey] = targets;
    }
  }

  // Profile: je Profil entscheidet updatedAt, sonst die Wahl aus dem Dialog.
  for (const incomingProfile of incoming.profiles || []) {
    const i = state.profiles.findIndex(p => p.id === incomingProfile.id);
    if (i < 0) { state.profiles.push(incomingProfile); continue; }
    const mine = state.profiles[i];
    const bothStamped = mine.updatedAt != null && incomingProfile.updatedAt != null;
    const takeFile = bothStamped
      ? incomingProfile.updatedAt > mine.updatedAt
      : profileChoice[incomingProfile.id] === "file";
    if (takeFile) state.profiles[i] = incomingProfile;
  }
}

// Wird nach jedem tatsächlichen Schreiben nach localStorage aufgerufen (siehe writeNow()) —
// sync.js hängt sich hier ein, um nach lokalen Änderungen automatisch zu synchronisieren.
// Bewusst generisch statt sync-spezifisch: store.js weiß nichts von Supabase.
const changeListeners = [];
const persistErrorListeners = [];

/** `fn(origin)` — origin ist "local" (Änderung von diesem Gerät) oder "remote" (kam gerade über
 * den Abgleich herein). sync.js pusht nur bei "local"; ohne diese Unterscheidung löst jedes
 * Einmischen sofort wieder einen Push aus und die Synchronisierung läuft endlos im Kreis. */
export function onStoreChange(fn) {
  changeListeners.push(fn);
}

/** `fn(error)` — selbst nach dem Leeren des Produkt-Cache lässt sich nichts mehr speichern.
 * Die App muss das zeigen, statt ab hier stillschweigend nichts mehr zu sichern. */
export function onPersistError(fn) {
  persistErrorListeners.push(fn);
}

/**
 * Ersetzt den kompletten Zustand — für "Datei gewinnt" und "Letzten Import rückgängig machen".
 *
 * Alles, was danach fehlt, wird als Löschung vermerkt. Ohne diese Grabsteine wäre ein Ersetzen
 * bei aktivierter Online-Synchronisierung wirkungslos: der nächste Abgleich holte den noch
 * vollständigen Serverstand und vereinigte ihn wieder mit dem gerade bereinigten Gerät — das
 * Ersetzen wäre Sekunden später von selbst rückgängig gemacht, ohne dass es jemand merkt.
 *
 * Der Produkt-Cache wird übernommen statt verworfen: er steht in keiner Sicherung (siehe
 * exportJSON) und die Listen stünden sonst ohne Nährwerte da, bis alles neu geladen ist.
 */
function replaceStateWith(next) {
  const now = Date.now();
  for (const { name, keyOf } of TOMBSTONED) {
    const keep = new Set((next[name] || []).map(keyOf));
    for (const entry of state[name] || []) {
      const key = keyOf(entry);
      if (key == null || keep.has(key)) continue;
      if (!(next.tombstones[name][key] > now)) next.tombstones[name][key] = now;
    }
  }
  next.cache = prunedCache({ ...state.cache, ...next.cache });
  state = next;
  persist("history", "cache", "recent", "activeProfileId", "onboarded", "schemaVersion", "tombstones");
}

export const Store = {
  get() {
    return state;
  },

  isOnboarded() {
    return !!state.onboarded;
  },
  setOnboarded() {
    state.onboarded = true;
    persist("onboarded");
  },

  getActiveProfile() {
    return state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0];
  },

  setActiveProfile(id) {
    state.activeProfileId = id;
    persist("activeProfileId");
  },

  updateProfile(id, patch) {
    const p = state.profiles.find(pr => pr.id === id);
    if (!p) return;
    // Zeitstempel mitführen, damit ein späterer Abgleich zwischen zwei Geräten selbst
    // entscheiden kann, welche Fassung der Einstellungen die neuere ist.
    Object.assign(p, patch, { updatedAt: Date.now() });
    persist();
  },

  /**
   * Entfernt ein Profil — gedacht, um doppelte Profile aufzuräumen, die durch einen ersten
   * Sync/Import zwischen zwei bereits unabhängig voneinander eingerichteten Geräten entstehen
   * (jedes Gerät legt bei der Ersteinrichtung eigene Profil-IDs an; eine Vereinigung über die
   * ID erkennt "meins" und "ihres" deshalb nicht automatisch als dasselbe Profil). Lässt sich
   * nicht auf das aktive oder das letzte verbleibende Profil anwenden. Gibt zurück, ob es
   * geklappt hat.
   */
  deleteProfile(id) {
    if (state.profiles.length <= 1) return false;
    if (id === state.activeProfileId) return false;
    const before = state.profiles.length;
    state.profiles = state.profiles.filter(p => p.id !== id);
    if (state.profiles.length === before) return false;
    persist();
    return true;
  },

  // --- Produkt-Cache (Open Food Facts Antworten) ---
  cacheProduct(barcode, product) {
    state.cache[barcode] = { product, fetchedAt: Date.now() };
    state.cache = prunedCache(state.cache);
    persist("cache");
  },
  getCachedProduct(barcode) {
    return state.cache[barcode]?.product || null;
  },

  // --- Ballaststoff-Schalter (pro Barcode, überschreibt EU/US-Standarderkennung) ---
  setFiberOverride(barcode, subtractFiber) {
    state.fiberOverrides[barcode] = subtractFiber;
    state.fiberOverridesAt[barcode] = Date.now();
    persist();
  },
  getFiberOverride(barcode) {
    const value = state.fiberOverrides[barcode];
    return value == null ? undefined : value;
  },
  clearFiberOverride(barcode) {
    // Nicht löschen, sondern als "bewusst zurückgesetzt" (null) festhalten — ein entfernter
    // Schlüssel ließe sich beim Abgleich nicht von "kennt diesen Barcode noch nicht"
    // unterscheiden und der alte Wert käme vom anderen Gerät sofort zurück.
    state.fiberOverrides[barcode] = null;
    state.fiberOverridesAt[barcode] = Date.now();
    persist();
  },

  // --- Zielwert-Schnappschüsse je Tag (damit Profiländerungen die Historie nicht rückwirkend verfälschen) ---
  setDayTargets(profileId, dateKey, targets) {
    if (!state.dayTargets[profileId]) state.dayTargets[profileId] = {};
    const existing = state.dayTargets[profileId][dateKey];
    // Nur schreiben, wenn sich wirklich etwas ändert — spart unnötige persist()-Aufrufe
    // beim häufigen Neuzeichnen der Startseite.
    if (existing && existing.kcal === targets.kcal && existing.netCarbG === targets.netCarbG
      && existing.fatG === targets.fatG && existing.proteinG === targets.proteinG) return;
    // frozenAt: wird der Tag später auf einem zweiten Gerät eingefroren (z.B. weil Profil-
    // Änderungen erst nach Mitternacht dort ankommen), entscheidet der Zeitpunkt, welche
    // Fassung beim Abgleich gewinnt — siehe applyMerge().
    state.dayTargets[profileId][dateKey] = { ...targets, frozenAt: Date.now() };
    persist();
  },
  getDayTargets(profileId, dateKey) {
    return state.dayTargets[profileId]?.[dateKey] || null;
  },

  // --- eigene, manuell angelegte Produkte ---
  saveOwnProduct(barcode, product) {
    // updatedAt zentral hier, damit ein späterer Abgleich erkennt, welche der beiden Fassungen
    // die neuere ist (siehe applyMerge) — egal über welchen Weg das Produkt gespeichert wurde.
    state.ownProducts[barcode] = { ...product, updatedAt: Date.now() };
    persist();
  },
  getOwnProduct(barcode) {
    return state.ownProducts[barcode] || null;
  },

  // --- zuletzt gescannt ---
  pushRecent(barcode) {
    state.recent = [barcode, ...state.recent.filter(b => b !== barcode)].slice(0, 10);
    persist("recent");
  },
  getRecent() {
    return state.recent;
  },

  // --- Such-/Scan-Verlauf (nur Protokoll, keine Mengen/Kalorien-Tracking) ---
  addHistoryEntry(entry) {
    state.history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
    persist("history");
  },
  getHistory() {
    return state.history;
  },
  clearHistory() {
    state.history = [];
    state.tombstones.historyClearedAt = Date.now();
    persist("history", "tombstones");
  },

  // --- Verbrauch (Mengen, die als "gegessen" eingetragen wurden) ---
  addConsumption(entry) {
    state.consumption = [entry, ...state.consumption].slice(0, CONSUMPTION_LIMIT);
    persist();
  },
  getConsumption() {
    return state.consumption;
  },
  removeConsumption(id) {
    state.consumption = state.consumption.filter(e => e.id !== id);
    state.tombstones.consumption[id] = Date.now();
    persist();
  },
  /** Ersetzt einen bestehenden Verbrauchseintrag (z.B. nachträglich angepasste Menge) —
   * updatedAt wird hier zentral gesetzt, damit ein späterer Abgleich zwischen zwei Geräten
   * erkennt, welche Fassung die neuere ist (siehe applyMerge). */
  updateConsumption(entry) {
    const i = state.consumption.findIndex(e => e.id === entry.id);
    if (i >= 0) { state.consumption[i] = { ...entry, updatedAt: Date.now() }; persist(); }
  },

  // --- Wasser (getrennt vom Makro-Verbrauch, kein historisches Einfrieren nötig) ---
  addWater(entry) {
    state.water = [entry, ...state.water].slice(0, 2000);
    persist();
  },
  getWater() {
    return state.water;
  },
  removeWater(id) {
    state.water = state.water.filter(e => e.id !== id);
    state.tombstones.water[id] = Date.now();
    persist();
  },

  // --- Rezepte ---
  saveRecipe(recipe) {
    const i = state.recipes.findIndex(r => r.id === recipe.id);
    if (i >= 0) state.recipes[i] = recipe; else state.recipes.unshift(recipe);
    persist();
  },
  getRecipe(id) {
    return state.recipes.find(r => r.id === id) || null;
  },
  getRecipes() {
    return state.recipes;
  },
  deleteRecipe(id) {
    state.recipes = state.recipes.filter(r => r.id !== id);
    state.tombstones.recipes[id] = Date.now();
    persist();
  },

  // --- Favoriten / No-Go ---
  addToList(listName, entry) {
    const list = state[listName];
    const idx = list.findIndex(e => e.barcode === entry.barcode);
    const stamped = { ...entry, updatedAt: Date.now() };
    if (idx >= 0) list[idx] = stamped; else list.unshift(stamped);
    // Ein Produkt kann nicht gleichzeitig auf Favoriten UND No-Go stehen
    // Das Entfernen aus der anderen Liste braucht einen Grabstein: ohne ihn holt der nächste
    // Abgleich den Eintrag von der noch ahnungslosen Gegenseite zurück und das Produkt stünde
    // auf Favoriten UND No-Go gleichzeitig.
    const other = listName === "favorites" ? "noGo" : "favorites";
    if (state[other].some(e => e.barcode === entry.barcode)) {
      state.tombstones[other][entry.barcode] = stamped.updatedAt;
      state[other] = state[other].filter(e => e.barcode !== entry.barcode);
    }
    persist();
  },
  /** Ergänzt/ändert einzelne Felder eines Listeneintrags (z.B. nachgefüllte Nährwerte). */
  updateListEntry(listName, barcode, patch) {
    const item = state[listName].find(e => e.barcode === barcode);
    if (!item) return;
    Object.assign(item, patch, { updatedAt: Date.now() });
    persist();
  },
  /**
   * Wie updateListEntry, aber OHNE updatedAt anzufassen — für Werte, die die App beim Anzeigen
   * aus dem nachträgt, was ohnehin auf dem Gerät liegt (siehe lists.js: nutriOf). Mit
   * Zeitstempel machte schon das bloße Öffnen der Liste diese Fassung zur "neueren" und
   * überschriebe beim nächsten Abgleich eine echte Änderung des anderen Geräts.
   */
  backfillListEntry(listName, barcode, patch) {
    const item = state[listName].find(e => e.barcode === barcode);
    if (!item) return;
    Object.assign(item, patch);
    persist();
  },
  removeFromList(listName, barcode) {
    state[listName] = state[listName].filter(e => e.barcode !== barcode);
    state.tombstones[listName][barcode] = Date.now();
    persist();
  },
  isInList(listName, barcode) {
    return state[listName].some(e => e.barcode === barcode);
  },

  // --- Einkaufsliste ---
  addShoppingItem(text, barcode = null) {
    state.shoppingList.unshift({ id: crypto.randomUUID(), text, checked: false, barcode, updatedAt: Date.now() });
    persist();
  },
  toggleShoppingItem(id) {
    const item = state.shoppingList.find(i => i.id === id);
    if (item) { item.checked = !item.checked; item.updatedAt = Date.now(); }
    persist();
  },
  removeShoppingItem(id) {
    state.shoppingList = state.shoppingList.filter(i => i.id !== id);
    state.tombstones.shoppingList[id] = Date.now();
    persist();
  },
  clearCheckedShoppingItems() {
    const now = Date.now();
    for (const item of state.shoppingList) {
      if (item.checked) state.tombstones.shoppingList[item.id] = now;
    }
    state.shoppingList = state.shoppingList.filter(i => !i.checked);
    persist();
  },

  /**
   * Holt Zutaten ab, die das Kochbuch (kochbuch/) unter einem eigenen Schlüssel abgelegt hat
   * ("Zutaten auf die Einkaufsliste" dort), und übernimmt sie in die eigene Einkaufsliste.
   * Über einen separaten Inbox-Schlüssel statt direktem Schreiben in den App-Zustand: ein
   * offener Keto-Tab würde dessen Zustand sonst beim eigenen nächsten Speichern überschreiben.
   * Gibt die Anzahl übernommener Einträge zurück (0 = nichts zu tun).
   */
  drainKochbuchInbox() {
    const KOCHBUCH_INBOX_KEY = "keto-dashboard-inbox";
    let names;
    try { names = JSON.parse(localStorage.getItem(KOCHBUCH_INBOX_KEY)); } catch { names = null; }
    if (!Array.isArray(names) || names.length === 0) return 0;
    for (const text of names) {
      if (typeof text === "string" && text.trim()) {
        state.shoppingList.unshift({
          id: crypto.randomUUID(), text: text.trim(), checked: false, barcode: null,
          updatedAt: Date.now(),
        });
      }
    }
    localStorage.removeItem(KOCHBUCH_INBOX_KEY);
    persist();
    return names.length;
  },

  // --- Export / Import ---
  /**
   * Backup ohne den Produkt-Cache: der macht ~68% der Dateigröße aus, lässt sich aber
   * jederzeit neu von Open Food Facts laden. Ohne ihn schrumpft ein typisches Backup von
   * ~640 KB auf ~45 KB — wichtig fürs Teilen. Beim Import ergänzt migrate() das Feld wieder.
   */
  exportJSON() {
    const { cache, ...withoutCache } = state;
    return JSON.stringify(withoutCache, null, 2);
  },
  importJSON(json) {
    const parsed = parseBackup(json);
    savePreMergeBackup();
    replaceStateWith(migrate(parsed));
  },

  /** Prüft eine Backup-Datei und liefert den geparsten Inhalt — für die Vorschau im Dialog. */
  parseBackup(json) {
    return parseBackup(json);
  },

  /**
   * Was würde ein Zusammenführen mit dieser Datei bewirken? Reine Vorschau, ändert nichts.
   * Damit kann der Dialog echte Zahlen zeigen statt allgemeiner Warnungen.
   */
  previewMerge(incoming) {
    const countNew = (mine, theirs, key) => {
      const known = new Set((mine || []).map(key));
      return (theirs || []).filter(x => !known.has(key(x))).length;
    };
    const byId = x => x.id;
    const myRecipeNames = new Set(state.recipes.map(r => r.name.trim().toLowerCase()));
    const myRecipeIds = new Set(state.recipes.map(r => r.id));

    return {
      consumption: countNew(state.consumption, incoming.consumption, byId),
      water: countNew(state.water, incoming.water, byId),
      history: countNew(state.history, incoming.history, byId),
      recipes: countNew(state.recipes, incoming.recipes, byId),
      favorites: countNew(state.favorites, incoming.favorites, f => f.barcode),
      noGo: countNew(state.noGo, incoming.noGo, f => f.barcode),
      shoppingList: countNew(state.shoppingList, incoming.shoppingList, byId),
      // Rezepte mit gleicher id werden aktualisiert statt doppelt angelegt.
      recipesUpdated: (incoming.recipes || []).filter(r => myRecipeIds.has(r.id)).length,
      // Gleicher Name, andere id = unabhängig voneinander angelegt. Lässt sich nicht
      // automatisch zusammenlegen, ohne zu raten — deshalb nur ankündigen.
      recipeNameClashes: [...new Set((incoming.recipes || [])
        .filter(r => !myRecipeIds.has(r.id) && myRecipeNames.has(r.name.trim().toLowerCase()))
        .map(r => r.name.trim()))],
      // Was ein "Datei gewinnt" kosten würde.
      losesOnReplace: {
        consumption: countNew(incoming.consumption, state.consumption, byId),
        recipes: countNew(incoming.recipes, state.recipes, byId),
        favorites: countNew(incoming.favorites, state.favorites, f => f.barcode),
        shoppingList: countNew(incoming.shoppingList, state.shoppingList, byId),
      },
      profileDiffs: diffProfiles(state.profiles, incoming.profiles),
    };
  },

  /**
   * Führt eine Backup-Datei mit dem lokalen Stand zusammen, statt ihn zu ersetzen.
   *
   * Die IDs sind Zufalls-UUIDs — zwei Geräte erzeugen nie dieselbe. Eine Vereinigung über die
   * ID ist deshalb verlustfrei: was auf beiden Geräten liegt, stammt aus demselben Ursprung und
   * ist identisch; alles andere ist neu und kommt dazu.
   *
   * `profileChoice` bestimmt je Profil-ID, wessen Einstellungen gelten sollen ("local" oder
   * "file"). Profile tragen erst seit Kurzem ein `updatedAt`; wo beide Seiten eines haben,
   * entscheidet das neuere automatisch, sonst bleibt es bei der Wahl aus dem Dialog.
   */
  mergeJSON(json, { profileChoice = {} } = {}) {
    const incoming = parseBackup(json);
    savePreMergeBackup();
    applyMerge(incoming, profileChoice);
    persist("history", "cache", "recent", "activeProfileId", "onboarded", "schemaVersion", "tombstones");
  },

  /**
   * Wie mergeJSON(), aber ohne die Sicherung vor dem Zusammenführen anzulegen — für die
   * automatische Online-Synchronisierung (sync.js), die im Hintergrund und oft mehrmals pro
   * Minute mischt. Die "Letzten Import rückgängig machen"-Sicherung bleibt damit dem
   * bewussten, manuellen Datei-Import vorbehalten, statt bei jedem Sync-Tick überschrieben
   * zu werden.
   */
  mergeJSONQuiet(json, { profileChoice = {} } = {}) {
    const incoming = parseBackup(json);
    applyMerge(incoming, profileChoice);
    persistFromRemote("history", "cache", "recent", "activeProfileId", "onboarded", "schemaVersion", "tombstones");
  },

  // --- Sicherung vor dem letzten Zusammenführen ---
  hasPreMergeBackup() {
    return !!localStorage.getItem(PREMERGE_KEY);
  },
  getPreMergeInfo() {
    try {
      const raw = localStorage.getItem(PREMERGE_KEY);
      return raw ? { at: JSON.parse(raw).at } : null;
    } catch { return null; }
  },
  /** Stellt den Stand von unmittelbar vor dem letzten Import/Abgleich wieder her. */
  restorePreMergeBackup() {
    const raw = localStorage.getItem(PREMERGE_KEY);
    if (!raw) return false;
    const { snapshot } = JSON.parse(raw);
    replaceStateWith(migrate(snapshot));
    localStorage.removeItem(PREMERGE_KEY);
    return true;
  },

  /**
   * Schlanker Export nur der Rezepte (ohne Profile, Verlauf, Listen) zum gezielten Teilen
   * einzelner Rezepte, statt des kompletten Backups. Nährwerte stecken bereits in jeder
   * Zutat (per100), die Datei ist also für sich allein importierbar.
   */
  exportRecipesJSON() {
    return JSON.stringify({ schemaVersion: SCHEMA_VERSION, recipes: state.recipes }, null, 2);
  },
  /**
   * Fügt Rezepte HINZU statt das ganze Backup zu ersetzen — anders als importJSON().
   * Rezepte mit bereits vorhandener id werden aktualisiert (z.B. beim erneuten Teilen einer
   * Änderung), alle anderen werden neu angelegt. Bestehende Rezepte bleiben unangetastet.
   */
  importRecipesJSON(json) {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.recipes)) {
      throw new Error("Ungültige Datei: keine Keto-Dashboard-Rezeptdatei.");
    }
    let added = 0, updated = 0;
    for (const r of parsed.recipes) {
      if (!r || !r.id || !r.name || !Array.isArray(r.ingredients)) continue;
      const i = state.recipes.findIndex(x => x.id === r.id);
      if (i >= 0) { state.recipes[i] = r; updated++; } else { state.recipes.unshift(r); added++; }
    }
    persist();
    return { added, updated };
  },

  raw: () => state,
};
