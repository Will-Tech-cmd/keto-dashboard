// sync2.js — Abgleich Zeile für Zeile.
//
// Löst den Blob-Abgleich aus sync.js ab. Der lud bei jeder Änderung den KOMPLETTEN
// Zustand hoch, mischte serverseitig gar nichts und musste die Zusammenführung deshalb
// im Client nachbauen (applyMerge, Grabsteinkarten, Zeitstempelvergleiche je Datenart).
// Genau dort steckten die Datenverluste.
//
// Hier macht die Datenbank die Arbeit:
//   Hochladen  jede geänderte Zeile einzeln als Upsert auf ihren fachlichen Schlüssel.
//              Ein Trigger auf dem Server verwirft Schreibvorgänge, die älter sind als
//              der gespeicherte Stand — ein Gerät, das eine Woche offline war, kann
//              damit keine neuere Änderung mehr überbügeln.
//   Herunterladen  je Datenart "gib mir alles seit Zeitpunkt X". Gelöschtes kommt als
//              Zeile mit gesetztem geloescht_am; es gibt keine Grabsteine mehr im Client.
//
// Ein Durchlauf ist unterbrechbar: was nicht hochgeladen wurde, bleibt in der Outbox,
// und der Zeiger je Datenart rückt erst vor, wenn ihre Seite wirklich verarbeitet ist.

import * as db from "./db.js";
import { ENTITAETEN, REIHENFOLGE, filterFuer } from "./rows.js";
import { rest as restEcht, istAngemeldet as angemeldetEcht, AnmeldeFehler } from "./supabase.js";

// Die Server-Anbindung ist austauschbar. Im Betrieb ist es supabase.js; die Tests hängen
// hier einen kleinen PostgREST-Nachbau ein und können den Abgleich damit vollständig
// durchspielen — zwei Geräte, Löschungen, verworfene veraltete Stände — ohne Netz, ohne
// Konto und ohne die echten Daten anzufassen.
let anbindung = { rest: restEcht, istAngemeldet: angemeldetEcht };
export function setzeAnbindung(neu) { anbindung = { ...anbindung, ...neu }; }
const rest = (...args) => anbindung.rest(...args);
const istAngemeldet = () => anbindung.istAngemeldet();

/**
 * Wie viele Zeilen eine Seite beim Herunterladen höchstens hat.
 *
 * Der Zeiger ist ein Zeitstempel, und der Server setzt updated_at auf den Beginn der
 * Transaktion — alle Zeilen EINER Anweisung tragen also denselben. Wäre eine Seite voll
 * und trüge durchgehend denselben Zeitstempel, könnte der Zeiger nicht vorrücken, ohne
 * etwas zu überspringen. Die Grenze liegt deshalb weit über dem, was ein einzelner
 * Upsert je schreibt (der größte bisher: 197 Mahlzeiten beim Erstumzug); tritt der Fall
 * doch ein, bricht der Durchlauf mit einer klaren Meldung ab, statt still zu verlieren.
 */
const SEITE = 2000;

const ZEIGER = (entitaet) => `stand:${entitaet}`;
const ANFANG = "1970-01-01T00:00:00Z";

let laeuft = false;
let nochmal = false;

// ---------------------------------------------------------------------------
// Haushalt
// ---------------------------------------------------------------------------

/** Der Haushalt dieses Kontos. Einmal ermittelt, dann gemerkt. */
export async function haushaltId() {
  const gemerkt = await db.meta.lies("haushaltId");
  if (gemerkt) return gemerkt;
  const zeilen = await rest("haushalt?select=id&limit=1");
  const id = zeilen?.[0]?.id;
  if (!id) {
    throw new Error("Kein Haushalt für dieses Konto — bitte einen anlegen oder beitreten.");
  }
  await db.meta.setze("haushaltId", id);
  return id;
}

// ---------------------------------------------------------------------------
// Hochladen
// ---------------------------------------------------------------------------

/**
 * Arbeitet die Outbox ab. Ein Auftrag zeigt nur AUF eine Zeile — die aktuelle Fassung
 * wird hier geholt. Wer eine Mahlzeit fünfmal korrigiert, bevor das Netz wieder da ist,
 * schickt am Ende einmal den letzten Stand.
 *
 * Ist die Zeile lokal nicht mehr da, war sie zwischenzeitlich gelöscht: dann steht in
 * der Outbox ohnehin eine Löschung, die den Upsert überholt hat.
 */
async function hochladen(ctx) {
  const roh = await db.outboxAlle();
  if (roh.length === 0) return { gesendet: 0, geloescht: 0 };

  const { auftraege, ueberholt } = db.fasseZusammen(roh);
  await db.outboxEntfernen(ueberholt);

  let gesendet = 0, geloescht = 0, verworfen = 0;
  const erledigt = [];

  for (const entitaet of REIHENFOLGE) {
    const def = ENTITAETEN[entitaet];
    const meine = auftraege.filter(a => a.entitaet === entitaet);
    if (meine.length === 0) continue;

    // --- Anlegen und Ändern, gebündelt in einer Anfrage ---
    const anlegen = meine.filter(a => a.art === "upsert");
    if (anlegen.length > 0) {
      const vorhanden = new Map((await db.alle(entitaet)).map(x => [String(x.schluessel), x.wert]));
      const paare = anlegen
        .map(a => ({ a, objekt: vorhanden.get(String(a.schluessel)) }))
        .filter(p => p.objekt);
      if (paare.length > 0) {
        // return=representation, nicht minimal: der Server schickt zurück, was er
        // WIRKLICH gespeichert hat. Das ist nicht immer das, was wir geschickt haben —
        // der Wächter-Trigger verwirft eine Fassung, die älter ist als die vorhandene,
        // und liefert für diese Zeile gar nichts zurück.
        //
        // Ohne diesen Rückweg bliebe der veraltete Stand lokal für immer stehen: der
        // Zeiger fürs Herunterladen liegt bereits hinter dieser Zeile, weil der Server
        // sie ja nicht angefasst hat. Sie käme nie wieder vorbei.
        const gespeichert = await rest(`${def.tabelle}?on_conflict=${def.konflikt}`, {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(paare.map(p => def.zuZeile(p.objekt, ctx))),
        }) || [];

        await uebernehme(entitaet, gespeichert);

        // Was nicht zurückkam, hat der Server abgewiesen — dessen Fassung ist neuer.
        const angekommen = new Set(gespeichert.map(z => String(def.schluessel(def.ausZeile(z)))));
        const abgewiesen = paare
          .map(p => String(p.a.schluessel))
          .filter(k => !angekommen.has(k));
        for (const k of abgewiesen) {
          const zeilen = await rest(`${def.tabelle}?select=*&${filterFuer(entitaet, k, ctx)}`);
          await uebernehme(entitaet, zeilen || []);
          verworfen++;
        }
        gesendet += paare.length - abgewiesen.length;
      }
      // Aufträge auf Zeilen, die es lokal nicht mehr gibt, sind erledigt: die
      // zugehörige Löschung steht weiter unten in derselben Runde.
      erledigt.push(...anlegen.map(a => a.nr));
    }

    // --- Löschen ist ein Setzen von geloescht_am ---
    for (const a of meine.filter(a => a.art === "loeschen")) {
      const jetzt = new Date().toISOString();
      await rest(`${def.tabelle}?${filterFuer(entitaet, a.schluessel, ctx)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ geloescht_am: jetzt, geaendert_am: jetzt }),
      });
      erledigt.push(a.nr);
      geloescht++;
    }
  }

  await db.outboxEntfernen(erledigt);
  return { gesendet, geloescht, verworfen };
}

/**
 * Schreibt Server-Zeilen in die lokale Ablage — gelöschte werden entfernt statt
 * gespeichert. Gemeinsam benutzt vom Hochladen (Rückmeldung des Servers) und vom
 * Herunterladen, damit beide Wege dieselbe Zeile gleich behandeln.
 */
async function uebernehme(entitaet, zeilen) {
  const def = ENTITAETEN[entitaet];
  const schreiben = [];
  const loeschen = [];
  for (const zeile of zeilen || []) {
    const objekt = def.ausZeile(zeile);
    const schluessel = String(def.schluessel(objekt));
    if (zeile.geloescht_am) loeschen.push(schluessel);
    else schreiben.push({ schluessel, wert: objekt });
  }
  // Datenarten, deren Serverzeile das App-Objekt nur zum Teil beschreibt (siehe `teilweise`
  // in rows.js), ergänzen das Vorhandene, statt es zu ersetzen. Ohne das verlöre ein Rezept
  // beim ersten Hochladen seine Zutaten: der Server schickt seine Zeile zurück, und in der
  // stehen sie nicht — sie liegen in einer eigenen Tabelle.
  //
  // Nur für diese Datenarten, nicht allgemein: bei der Mahlzeit ist die Zuordnung
  // "entweder Gramm ODER Portionen" eine echte Aussage, und ein Verschmelzen ließe beide
  // Felder gleichzeitig stehen.
  if (def.teilweise && schreiben.length) {
    const vorhanden = new Map((await db.alle(entitaet)).map(x => [String(x.schluessel), x.wert]));
    for (const e of schreiben) {
      const alt = vorhanden.get(e.schluessel);
      if (alt) e.wert = { ...alt, ...e.wert };
    }
  }

  if (schreiben.length) await db.schreibe(entitaet, schreiben);
  if (loeschen.length) await db.entferne(entitaet, loeschen);
  return { geschrieben: schreiben.length, entfernt: loeschen.length };
}

// ---------------------------------------------------------------------------
// Herunterladen
// ---------------------------------------------------------------------------

/**
 * Holt je Datenart alles, was sich seit dem letzten Mal geändert hat, und spielt es
 * lokal ein. Zeilen, zu denen dieses Gerät noch etwas Ungesendetes in der Outbox hat,
 * bleiben unangetastet — sonst überschriebe der Server eine Eingabe, die noch gar nicht
 * bei ihm war. Beim nächsten Durchlauf geht sie hoch und der Server entscheidet.
 */
async function herunterladen(ctx) {
  const offen = new Set((await db.outboxAlle()).map(e => `${e.entitaet} ${e.schluessel}`));
  let neu = 0, entfernt = 0;

  for (const entitaet of REIHENFOLGE) {
    const def = ENTITAETEN[entitaet];
    let zeiger = await db.meta.lies(ZEIGER(entitaet), ANFANG);

    for (;;) {
      const pfad = `${def.tabelle}?select=*` +
        `&haushalt_id=eq.${encodeURIComponent(ctx.haushaltId)}` +
        `&updated_at=gt.${encodeURIComponent(zeiger)}` +
        `&order=updated_at.asc&limit=${SEITE}`;
      const zeilen = await rest(pfad);
      if (!zeilen || zeilen.length === 0) break;

      if (zeilen.length === SEITE && zeilen[0].updated_at === zeilen[zeilen.length - 1].updated_at) {
        throw new Error(
          `Abgleich von ${entitaet}: ${SEITE} Zeilen mit demselben Zeitstempel — der Zeiger ` +
          `kann nicht vorrücken. Der Seitenwechsel müsste auf einen zusammengesetzten ` +
          `Schlüssel umgestellt werden.`);
      }

      // Zeilen, zu denen hier noch etwas Ungesendetes liegt, bleiben unangetastet.
      const uebernehmbar = zeilen.filter(zeile => {
        const schluessel = String(def.schluessel(def.ausZeile(zeile)));
        return !offen.has(`${entitaet} ${schluessel}`);
      });
      const bilanz = await uebernehme(entitaet, uebernehmbar);
      neu += bilanz.geschrieben;
      entfernt += bilanz.entfernt;

      zeiger = zeilen[zeilen.length - 1].updated_at;
      await db.meta.setze(ZEIGER(entitaet), zeiger);
      if (zeilen.length < SEITE) break;
    }
  }
  return { neu, entfernt };
}

// ---------------------------------------------------------------------------

/**
 * Ein vollständiger Durchlauf: erst das Eigene hoch, dann das Fremde herunter.
 *
 * Diese Reihenfolge mit Absicht — wer zuerst herunterlädt, überschreibt womöglich eine
 * lokale Änderung, die der Server noch gar nicht kennen konnte.
 *
 * Die gerade hochgeladenen Zeilen kommen beim Herunterladen gleich wieder mit: ihr
 * updated_at liegt jetzt hinter dem Zeiger. Das ist gewollt und kostet wenig — so sieht
 * das Gerät, was der Server tatsächlich gespeichert hat, samt der Fälle, in denen der
 * Wächter-Trigger die eigene Fassung als veraltet verworfen hat.
 */
export async function abgleichen() {
  if (!istAngemeldet()) throw new AnmeldeFehler("Nicht angemeldet.");
  if (laeuft) { nochmal = true; return null; }
  laeuft = true;
  try {
    const ctx = { haushaltId: await haushaltId() };
    const hoch = await hochladen(ctx);
    const runter = await herunterladen(ctx);
    await db.meta.setze("letzterAbgleich", Date.now());
    return { ...hoch, ...runter };
  } finally {
    laeuft = false;
    if (nochmal) { nochmal = false; abgleichen().catch(() => {}); }
  }
}

/** Alle Zeiger zurücksetzen — der nächste Durchlauf holt alles neu. Für den Notfall
 * und für den ersten Durchlauf nach dem Umzug. */
export async function zeigerZuruecksetzen() {
  for (const entitaet of REIHENFOLGE) await db.meta.setze(ZEIGER(entitaet), ANFANG);
}

export async function letzterAbgleich() {
  return db.meta.lies("letzterAbgleich", null);
}
