// planer.js — einen Essensplan für die nächsten Tage zusammenstellen.
//
// Die Grundidee steht schon in der App, sie war nur nie benannt: die Startseite kann seit
// jeher auf zukünftige Tage blättern und dort eintragen. Ein Plan ist deshalb keine neue
// Datenart, sondern ein Tag, der gefüllt ist, bevor er da ist — dieselben Mahlzeiten-Zeilen,
// derselbe Nährwert-Schnappschuss, dieselben Ringe, derselbe Abgleich. Der einzige
// Unterschied ist `planned: true` am Eintrag, und der verschwindet beim Bestätigen.
//
// Diese Datei hat zwei Hälften:
//
//   KATALOG   was überhaupt in Frage kommt — eigene Rezepte, was wirklich gegessen wird,
//             Favoriten. Braucht den Store.
//   MOTOR     wie daraus ein Tag wird. Braucht nur den Katalog und die Zielwerte, sonst
//             nichts — dadurch mit einem handgeschriebenen Katalog prüfbar.
//
// Was der Motor NICHT tut: Essen erfinden. Er wählt aus dem aus, was der Haushalt hat und
// isst. Das ist keine Einschränkung, sondern der Grund, warum die Nährwerte stimmen: jede
// Zahl im Plan stammt aus einem eigenen Rezept oder einem gescannten Etikett.

import { Store, shiftDateKey } from "./store.js";
import { calcPerServing, parseServingGrams } from "./keto.js";
import { getProductOffline, nutriSnapshot } from "./off.js";

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** Reihenfolge der Slots — dieselbe wie überall sonst in der App. */
export const SLOTS = ["breakfast", "lunch", "dinner", "snack"];

/**
 * Wie sich das Tagesbudget auf die Mahlzeiten verteilt.
 *
 * Keine Wissenschaft, sondern die übliche Aufteilung: mittags und abends das Meiste, morgens
 * spürbar weniger. Sie ist nur der Startwert für die Mengenrechnung — bewertet wird am Ende
 * immer der ganze Tag, nicht der einzelne Slot.
 */
const ANTEILE = {
  ohneSnack: { breakfast: 0.25, lunch: 0.35, dinner: 0.40 },
  mitSnack: { breakfast: 0.22, lunch: 0.33, dinner: 0.33, snack: 0.12 },
};

export function anteileFuer(mahlzeiten) {
  const roh = mahlzeiten.includes("snack") ? ANTEILE.mitSnack : ANTEILE.ohneSnack;
  // Werden nicht alle Slots geplant, muss sich der Rest die volle Portion teilen — sonst
  // bekäme "nur Abendessen" ein Vierzigstel des Tages.
  const summe = mahlzeiten.reduce((s, m) => s + (roh[m] || 0), 0) || 1;
  return Object.fromEntries(mahlzeiten.map(m => [m, (roh[m] || 0) / summe]));
}

// ===========================================================================
// KATALOG
// ===========================================================================

/** Nährwerte je Einheit: bei Rezepten je Portion, bei Produkten je 100 g. */
function hatWerte(per) {
  return !!per && per.kcal != null && per.netCarbs != null;
}

/** Menge -> Faktor auf `per`. Portionen zählen direkt, Gramm beziehen sich auf 100 g. */
export function faktor(kandidat, menge) {
  return kandidat.einheit === "portion" ? menge : menge / 100;
}

/** Die vier Werte eines Vorschlags bei dieser Menge. */
export function naehrwerte(kandidat, menge) {
  const f = faktor(kandidat, menge);
  const p = kandidat.per;
  return {
    kcal: round1((p.kcal || 0) * f),
    netCarbs: round1((p.netCarbs || 0) * f),
    fat: round1((p.fat || 0) * f),
    protein: round1((p.protein || 0) * f),
  };
}

/**
 * Wie oft dieses Lebensmittel zu welcher Tageszeit gegessen wurde.
 *
 * Dieselbe Kennzahl wie in rankFrequentItems (consumption.js), samt der Untergrenze von 0.15:
 * was man sonst nie zum Frühstück isst, verschwindet nicht ganz, es rutscht nur nach hinten.
 * Ohne die Untergrenze bliebe ein Slot leer, für den noch nie etwas eingetragen wurde — und
 * der allererste Plan eines neuen Profils hätte gar keine Mahlzeiten.
 */
/**
 * Die übliche Menge dieses Lebensmittels — der Median, nicht die zuletzt genommene.
 *
 * Das ist kein Detail. Der Planer schlägt eine Menge vor, man bestätigt sie beim Essen, und
 * damit wäre sie beim nächsten Plan die "letzte Menge" und dürfte wieder das Anderthalbfache
 * davon werden. Über ein paar Runden schaukelt sich so aus 150 g Avocado 300 g auf, ohne dass
 * je jemand etwas dazu gesagt hätte. Der Median bewegt sich dagegen erst, wenn man wirklich
 * mehrfach mehr isst — und das ist dann auch die richtige Auskunft.
 */
function uebliche(mengen) {
  const sortiert = [...mengen].filter(m => m > 0).sort((a, b) => a - b);
  if (sortiert.length === 0) return null;
  const mitte = Math.floor(sortiert.length / 2);
  return sortiert.length % 2 ? sortiert[mitte] : (sortiert[mitte - 1] + sortiert[mitte]) / 2;
}

function mahlzeitGewichte(zaehler, gesamt) {
  const g = {};
  for (const slot of SLOTS) g[slot] = Math.max(0.15, (zaehler[slot] || 0) / gesamt);
  return g;
}

/**
 * Was für diesen Haushalt in Frage kommt.
 *
 * Drei Quellen, absteigend nach Verlässlichkeit der Nährwerte:
 *   Rezepte    aus den eigenen Zutaten gerechnet, Portionen frei skalierbar
 *   Verlauf    was tatsächlich gegessen wird, mit der zuletzt genommenen Menge
 *   Favoriten  bewusst gemerkt, auch wenn es (noch) selten auf dem Teller lag
 *
 * No-Go fliegt hart raus. Und was gar keine Nährwerte hat, kommt nicht in den Katalog: ein
 * Vorschlag ohne Zahlen wäre in einem Plan, der Zielwerte treffen soll, wertlos.
 */
export function sammleKatalog(profileId, { tage = 60 } = {}) {
  const state = Store.get();
  const nein = new Set((state.noGo || []).map(n => n.barcode));
  const favoriten = new Map((state.favorites || []).map(f => [f.barcode, f]));
  const cutoff = Date.now() - tage * 86400000;

  // --- Verlauf zusammenfassen: je Schlüssel Häufigkeit, Slot-Verteilung, letzte Menge ---
  const ausVerlauf = new Map();
  for (const e of state.consumption || []) {
    if (e.profileId !== profileId || !e.barcode || e.planned) continue;
    if ((e.at || 0) < cutoff) continue;
    const cur = ausVerlauf.get(e.barcode)
      || { anzahl: 0, slots: {}, mengen: [], letztAm: 0, name: e.name };
    cur.anzahl++;
    if (e.meal) cur.slots[e.meal] = (cur.slots[e.meal] || 0) + 1;
    const menge = e.servings != null ? e.servings : e.grams;
    if (menge > 0) cur.mengen.push(menge);
    if ((e.at || 0) >= cur.letztAm) {
      cur.letztAm = e.at || 0;
      cur.name = e.name;
    }
    ausVerlauf.set(e.barcode, cur);
  }

  const katalog = [];

  // --- Rezepte ---
  for (const rezept of state.recipes || []) {
    const per = calcPerServing(rezept);
    if (!hatWerte(per)) continue;
    const key = `recipe:${rezept.id}`;
    if (nein.has(key)) continue;
    const verlauf = ausVerlauf.get(key);
    const gesamtGramm = (rezept.ingredients || []).reduce((s, i) => s + (i.grams || 0), 0);
    katalog.push({
      key,
      name: rezept.name,
      istRezept: true,
      recipeId: rezept.id,
      barcode: null,
      per,
      einheit: "portion",
      schritt: 0.25,
      // Höchstens anderthalb Portionen. Zwei wären rechnerisch bequem — der Motor füllt eine
      // Lücke am liebsten dort, wo eine Zahl schon steht — aber "1,5 Portionen Lachs mit
      // Spinat (675 g)" ist keine Mahlzeit mehr, sondern eine Rechnung mit Namen.
      min: 0.5,
      max: 1.5,
      standard: uebliche(verlauf?.mengen || []) || 1,
      servingG: gesamtGramm > 0 ? Math.round(gesamtGramm / (rezept.servings || 1)) : null,
      anzahl: verlauf?.anzahl || 0,
      gewicht: mahlzeitGewichte(verlauf?.slots || {}, Math.max(1, verlauf?.anzahl || 0)),
      favorit: false,
    });
  }

  // --- Produkte aus Verlauf und Favoriten ---
  for (const barcode of new Set([...ausVerlauf.keys(), ...favoriten.keys()])) {
    if (!barcode || barcode.startsWith("recipe:") || nein.has(barcode)) continue;
    const produkt = getProductOffline(barcode);
    const favorit = favoriten.get(barcode);
    const per = produkt ? nutriSnapshot(produkt) : (favorit?.nutri100 || null);
    if (!hatWerte(per)) continue;
    const verlauf = ausVerlauf.get(barcode);
    // Die zuletzt genommene Menge ist die ehrlichste Portionsangabe, die es gibt — sie kommt
    // aus dem eigenen Verhalten. Sonst die Packungsportion, sonst 100 g.
    //
    // Der Spielraum darum herum ist bewusst eng (die Hälfte bis das Anderthalbfache). Beim
    // ersten Durchlauf war er doppelt so weit, und weil der Motor die Menge immer gegen das
    // Slot-Budget hochrechnet, landete er verlässlich an der Obergrenze: 300 g Avocado zu
    // Mittag, 40 g Butter zum Frühstück. Rechnerisch tadellos, als Essen Unsinn.
    const basis = uebliche(verlauf?.mengen || [])
      || (produkt ? parseServingGrams(produkt.servingSize) : null)
      || 100;
    katalog.push({
      key: barcode,
      name: produkt?.name || favorit?.name || verlauf?.name || "Unbenannt",
      istRezept: false,
      recipeId: null,
      barcode,
      per,
      einheit: "gramm",
      schritt: 10,
      min: Math.max(10, Math.round(basis * 0.5 / 10) * 10),
      max: Math.max(20, Math.round(basis * 1.5 / 10) * 10),
      standard: Math.max(10, Math.round(basis / 10) * 10),
      servingG: produkt ? parseServingGrams(produkt.servingSize) : null,
      anzahl: verlauf?.anzahl || 0,
      gewicht: mahlzeitGewichte(verlauf?.slots || {}, Math.max(1, verlauf?.anzahl || 0)),
      favorit: !!favorit,
    });
  }

  return katalog;
}

// ===========================================================================
// MOTOR
// ===========================================================================

/**
 * Gesetzter Zufall (mulberry32).
 *
 * Kein Selbstzweck: "Tauschen" ist damit ein Weiterzählen des Startwerts für genau einen Slot
 * statt eines neuen Plans, und der Test bekommt reproduzierbare Ergebnisse. Ohne festen
 * Startwert wäre ein Fehlverhalten einmal zu sehen und nie wieder.
 */
export function zufall(saat) {
  let a = saat >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ein Los aus gewichteten Kandidaten. Gewicht <= 0 nimmt nicht teil. */
function ziehe(kandidaten, gewichte, wuerfel) {
  const summe = gewichte.reduce((s, g) => s + Math.max(0, g), 0);
  if (summe <= 0) return null;
  let ziel = wuerfel() * summe;
  for (let i = 0; i < kandidaten.length; i++) {
    ziel -= Math.max(0, gewichte[i]);
    if (ziel <= 0) return kandidaten[i];
  }
  return kandidaten[kandidaten.length - 1];
}

/** Wie wahrscheinlich ist dieser Kandidat in diesem Slot? */
function gewichtVon(kandidat, slot, strafe) {
  return kandidat.gewicht[slot]
    * (1 + Math.log1p(kandidat.anzahl))
    * (kandidat.favorit ? 1.3 : 1)
    * (strafe.get(kandidat.key) ?? 1);
}

/** Menge auf die Schrittweite runden und in die Grenzen zwingen. */
function passeMenge(kandidat, menge) {
  const gerundet = Math.round(menge / kandidat.schritt) * kandidat.schritt;
  const begrenzt = Math.min(kandidat.max, Math.max(kandidat.min, gerundet));
  // Gleitkomma: 0.1 + 0.2 gilt auch für Viertelportionen.
  return Math.round(begrenzt / kandidat.schritt) * kandidat.schritt;
}

/** Welche Menge dieses Kandidaten träfe `kcalBudget` am ehesten? */
function mengeFuerBudget(kandidat, kcalBudget) {
  const jeEinheit = kandidat.einheit === "portion" ? kandidat.per.kcal : kandidat.per.kcal / 100;
  if (!jeEinheit || jeEinheit <= 0) return passeMenge(kandidat, kandidat.standard);
  return passeMenge(kandidat, kcalBudget / jeEinheit);
}

/**
 * Ein Slot: ein Hauptgericht, bei Bedarf eine kleine Ergänzung.
 *
 * `strafe` bewertet Wiederholung über die Tage hinweg (siehe erstellePlan). `gesperrt` sind
 * Schlüssel, die an diesem Tag schon vorkommen — zweimal dasselbe an einem Tag ist kein Plan,
 * sondern ein Versehen.
 */
const ZEILEN_JE_SLOT = 3;

function baueSlot(katalog, slot, budget, { wuerfel, strafe, gesperrt }) {
  const kandidaten = katalog.filter(k => !gesperrt.has(k.key));
  if (kandidaten.length === 0) return [];

  const haupt = ziehe(kandidaten, kandidaten.map(k => gewichtVon(k, slot, strafe)), wuerfel);
  if (!haupt) return [];

  const zeilen = [{ kandidat: haupt, menge: mengeFuerBudget(haupt, budget.kcal) }];
  gesperrt.add(haupt.key);

  // Bleibt ein Viertel des Slots frei, kommt eine weitere Zeile dazu — bis zu dreien.
  //
  // Die Lücke MUSS über weitere Zeilen geschlossen werden, nicht über größere Portionen:
  // die Mengen sind eng begrenzt (siehe sammleKatalog), und ein Frühstück ist ohnehin eher
  // Brot, Butter und Käse als dreimal so viel Brot. Vorher waren hier zwei Zeilen erlaubt,
  // und der Rest wurde in die Menge der ersten gedrückt.
  for (let n = 1; n < ZEILEN_JE_SLOT; n++) {
    const rest = budget.kcal - zeilen.reduce((s, z) => s + naehrwerte(z.kandidat, z.menge).kcal, 0);
    if (rest <= budget.kcal * 0.25) break;
    const uebrig = kandidaten.filter(k => !gesperrt.has(k.key));
    if (uebrig.length === 0) break;
    const beilage = ziehe(uebrig, uebrig.map(k => gewichtVon(k, slot, strafe)), wuerfel);
    if (!beilage) break;
    zeilen.push({ kandidat: beilage, menge: mengeFuerBudget(beilage, rest) });
    gesperrt.add(beilage.key);
  }
  return zeilen;
}

/**
 * Wie weit das Eiweiß vom Ziel abweichen darf, ohne dass es als verfehlt gilt.
 *
 * Zehn Gramm nach BEIDEN Seiten. Man plant kein Gramm genau, und ein Tag mit 112 oder 126 g
 * gegen ein Ziel von 118 g ist kein schlechterer Tag.
 */
const EIWEISS_FENSTER_G = 10;

/**
 * Wie gut trifft dieser Tag die Vorgaben? Kleiner ist besser.
 *
 * Vier Größen, und jede mit ihrer eigenen Art von Vorgabe — das ist der Punkt:
 *
 *   NETTO-KH   eine harte GRENZE.
 *   FETT       ebenfalls eine harte GRENZE, kein Ziel. Darunter zu bleiben kostet nichts.
 *   EIWEISS    eine Zahl, die getroffen werden SOLL, mit zehn Gramm Spielraum nach oben wie
 *              nach unten. Zu wenig geht im Defizit an die Muskulatur und wiegt außerhalb
 *              des Fensters schwerer als zu viel.
 *   KALORIEN   der Rahmen, symmetrisch.
 *
 * Die beiden Grenzen sind absichtlich Ausschlüsse und keine Aufschläge. Als Aufschlag mit
 * doppeltem Gewicht gemessen: an 52 von 120 gewürfelten Tagen lag das Fett trotzdem darüber,
 * weil sich Fettgrenze und Eiweißziel bei festen Kalorien gegenseitig bedingen und der Motor
 * dann eben tauschte. Eine Grenze, die in 43 % der Fälle nachgibt, ist keine.
 *
 * Fett war zwischenzeitlich als Zielwert drin, mit Abweichung in beide Richtungen. Das war
 * doppelt gezählt — bei festgelegten Kalorien, Kohlenhydraten und Eiweiß ergibt sich das
 * Fett aus kcal = 4·KH + 4·Eiweiß + 9·Fett von selbst — und es zog jeden Plan ein Stück in
 * Richtung "fetter", weil mehr Fett die billigste Art war, die Fettnote zu senken. Als reine
 * Obergrenze ist es beides nicht: unterhalb sagt es nichts, oberhalb sagt es genau das, was
 * es soll.
 */
export function bewerteTag(summe, ziele) {
  if (summe.netCarbs > ziele.netCarbG) return Infinity;
  if (ziele.fatG > 0 && summe.fat > ziele.fatG) return Infinity;
  const rel = (ist, soll) => (soll > 0 ? Math.abs(ist - soll) / soll : 0);

  const unten = Math.max(0, ziele.proteinG - EIWEISS_FENSTER_G);
  const oben = ziele.proteinG + EIWEISS_FENSTER_G;
  let eiweiss = 0;
  if (summe.protein < unten) eiweiss = (unten - summe.protein) / (ziele.proteinG || 1) * 2.5;
  else if (summe.protein > oben) eiweiss = (summe.protein - oben) / (ziele.proteinG || 1);

  return rel(summe.kcal, ziele.kcal) * 1.0
    + rel(summe.netCarbs, ziele.netCarbG) * 1.5
    + eiweiss * 8.0;
}

/**
 * Ersatzmaßstab, wenn KEIN Anlauf innerhalb der Grenzen blieb: der am wenigsten schlimme Tag.
 * Zählt nur, um wie viel die beiden Grenzen gerissen sind — die Zielwerte sind in dieser Lage
 * ohnehin nicht mehr das Problem.
 */
function bewerteNotfall(summe, ziele) {
  const ueber = (ist, grenze) => (grenze > 0 ? Math.max(0, ist - grenze) / grenze : 0);
  const rel = (ist, soll) => (soll > 0 ? Math.abs(ist - soll) / soll : 0);
  return ueber(summe.netCarbs, ziele.netCarbG) * 3
    + ueber(summe.fat, ziele.fatG) * 2
    + rel(summe.kcal, ziele.kcal) * 0.5;
}

const VERSUCHE = 500;

/**
 * Die engere Wahl: welche Anläufe am Ende noch zur Auswahl stehen.
 *
 * Ohne sie wäre "Neu würfeln" wirkungslos — bei fünfhundert Anläufen findet der Motor jedes
 * Mal dasselbe Optimum, egal mit welchem Startwert. Tage, die sich um wenige Prozent der Note
 * unterscheiden, sind aber praktisch gleich gut; welchen man davon bekommt, darf der Zufall
 * entscheiden.
 *
 * Die Spanne ist RELATIV, nicht absolut. Eine absolute hängt an den Gewichten der Note: als
 * das Eiweiß von 1.4 auf 8.0 stieg, spreizten sich die Noten, und dieselbe Spanne fasste
 * plötzlich nur noch einen einzigen Anlauf. Die Mindestzahl von zwei ist der Rückfall, damit
 * "Neu würfeln" auch in einem sehr engen Katalog etwas tut.
 *
 * Was das kostet, am echten Katalog dieses Haushalts gemessen (120 gewürfelte Tage je
 * Profil): nimmt man immer nur den einen besten Tag, liegt das Eiweiß an 10 Tagen außerhalb
 * seiner ±10 g; mit der engeren Wahl an 14 bis 17. Die harten Grenzen — Kohlenhydrate und
 * Fett — bleiben in beiden Fällen bei null Überschreitungen. Vier Tage mehr mit leicht
 * danebenliegendem Eiweiß sind der Preis dafür, dass ein zweiter Tipp einen anderen Plan
 * ergibt; das ist er wert.
 */
const GLEICH_GUT_REL = 0.15;
const GLEICH_GUT_ABS = 0.02;
const ENGERE_WAHL_MIN = 2;

// ---------------------------------------------------------------------------
// Aufschläge auf die Tagesnote
//
// Eine Lektion, die dieser Motor dreimal erteilt hat und die deshalb hier oben steht:
//
//     WAS ZÄHLEN SOLL, MUSS IN DIE NOTE — NICHT NUR IN DIE ZIEHUNG.
//
// Die Gewichte in `gewichtVon` machen etwas unwahrscheinlich. `baueTag` nimmt aber den
// besten aus zweihundert Anläufen, und in zweihundert Anläufen kommt auch das
// Unwahrscheinliche vor. Trifft es die Zielwerte am genauesten, gewinnt es. So kamen der
// Reihe nach heraus: dreimal derselbe Auflauf hintereinander, 300 g Avocado zu Mittag, und
// Putenbrust mit Brokkoli zum Frühstück — jedes Mal rechnerisch der beste Tag.
//
// Alle drei Aufschläge wiegen deshalb mit dem Anteil an der Tagesenergie: eine Ungereimtheit
// am Hauptgericht wiegt schwer, dieselbe an 20 g Butter fast nichts.
// ---------------------------------------------------------------------------

/**
 * Aufschlag auf die Tagesnote für alles, was in den letzten Tagen schon dastand.
 *
 * Die Strafe in `gewichtVon` allein reicht dafür NICHT: sie macht ein Gericht beim Würfeln
 * unwahrscheinlich, aber `baueTag` nimmt am Ende den besten von zweihundert Anläufen — und
 * wenn das Gericht von gestern die Zielwerte nun einmal am genauesten trifft, gewinnt es
 * trotzdem, denn in einem der zweihundert Anläufe kommt es sicher vor. Gemessen: drei Abende
 * hintereinander derselbe Auflauf. Abwechslung muss deshalb die Note kosten, nicht nur die
 * Wahrscheinlichkeit.
 *
 * Entscheidend ist dabei der Anteil an der Tagesenergie, nicht die bloße Zeile. Butter,
 * Käse und Eier isst man jeden Tag, und daran ist nichts langweilig — beim ABENDESSEN
 * dreimal hintereinander derselbe Auflauf ist es sehr wohl. Ein erster Anlauf, der jede
 * Wiederholung gleich teuer machte, verdrängte deshalb die Grundnahrungsmittel aus dem Plan
 * und ließ die Hauptgerichte trotzdem stehen. Der Anteil an der Tagesenergie unterscheidet
 * beides von selbst: 900 kcal Auflauf wiegen schwer, 20 g Butter fast nichts.
 */
const WIEDERHOLUNGS_KOSTEN = 3.0;

function wiederholungsAufschlag(zeilen, strafe, tagesKcal) {
  if (!(tagesKcal > 0)) return 0;
  return zeilen.reduce((s, z) => {
    const anteil = (naehrwerte(z.kandidat, z.menge).kcal || 0) / tagesKcal;
    return s + (1 - (strafe.get(z.kandidat.key) ?? 1)) * WIEDERHOLUNGS_KOSTEN * anteil;
  }, 0);
}

/**
 * Aufschlag für ein Gericht, das zu dieser Tageszeit sonst nicht auf dem Tisch steht.
 *
 * `gewicht[slot]` ist der Anteil der bisherigen Einträge, der auf diesen Slot fiel, mit einer
 * Untergrenze von 0.15 (sonst bliebe ein Slot ohne Verlauf für immer leer). Genau diese
 * Untergrenze machte den Weg frei für Putenbrust mit Brokkoli am Morgen: unwahrscheinlich,
 * aber eben nicht unmöglich — und energetisch passte es hervorragend.
 */
const SLOT_KOSTEN = 1.2;

function slotAufschlag(zeilen, tagesKcal) {
  if (!(tagesKcal > 0)) return 0;
  return zeilen.reduce((s, z) => {
    const anteil = (naehrwerte(z.kandidat, z.menge).kcal || 0) / tagesKcal;
    return s + (1 - z.kandidat.gewicht[z.slot]) * SLOT_KOSTEN * anteil;
  }, 0);
}

/**
 * Aufschlag für Portionen, die von der üblichen abweichen.
 *
 * Dasselbe Muster wie beim Wiederholungsaufschlag, und aus demselben Grund: die Mengenrechnung
 * skaliert immer gegen das Slot-Budget und landet deshalb gern an der Obergrenze. Ohne einen
 * Preis dafür gewinnt der Anlauf, der die Zielwerte um zwei Prozent besser trifft — mit einer
 * anderthalbfachen Portion. Mit ihm gewinnt der, der stattdessen etwas dazustellt.
 *
 * Bewusst mild (0.15 je voller Abweichung, also höchstens 0.075 je Zeile): die Zielwerte
 * bleiben das Wichtigere. Es geht nur darum, unter zwei fast gleich guten Tagen den
 * essbareren zu wählen.
 */
const PORTIONS_KOSTEN = 0.15;

function portionsAufschlag(zeilen) {
  return zeilen.reduce((s, z) => {
    const ueblich = z.kandidat.standard || 1;
    return s + (Math.abs(z.menge - ueblich) / ueblich) * PORTIONS_KOSTEN;
  }, 0);
}

/**
 * Einen Tag zusammenstellen — viele Anläufe, der beste gewinnt.
 *
 * Warum Anläufe und keine Optimierung: die Aufgabe ist ein Rucksackproblem mit vier
 * Nebenbedingungen, und eine echte Lösung wäre für zwei Dutzend Rezepte erheblich mehr Code,
 * als sie wert ist. Gewürfelt zu suchen hat außerdem den erwünschten Nebeneffekt, dass jeder
 * Tag anders aussieht.
 *
 * Fünfhundert Anläufe, gemessen am echten Katalog dieses Haushalts (rund 90 Einträge): mit
 * zweihundert lag das Eiweiß an 25 von 120 Tagen außerhalb seines Fensters, mit fünfhundert
 * an 10. Der Suchraum ist enger, als er aussieht — Fettgrenze und Eiweißziel bedingen sich
 * bei festen Kalorien gegenseitig, es gibt also nur einen schmalen Korridor. Ein Vier-Tage-
 * Plan kostet damit rund 90 ms; das merkt niemand.
 */
export function baueTag(katalog, ziele, mahlzeiten, { saat, strafe = new Map() }) {
  const anteile = anteileFuer(mahlzeiten);
  // Nach Zusammensetzung, nicht nach Anlauf: von fünfhundert Würfen sind viele Wort für Wort
  // derselbe Tag. Ohne diese Zusammenfassung besteht die engere Wahl am Ende aus vier Kopien
  // desselben Plans, und "Neu würfeln" ändert nichts.
  const gueltige = new Map();
  let besteNote = Infinity;
  let notfall = null;
  let notNote = Infinity;

  for (let versuch = 0; versuch < VERSUCHE; versuch++) {
    const wuerfel = zufall(saat + versuch * 7919);
    const gesperrt = new Set();
    const slots = {};
    for (const slot of mahlzeiten) {
      const budget = { kcal: ziele.kcal * anteile[slot] };
      slots[slot] = baueSlot(katalog, slot, budget, { wuerfel, strafe, gesperrt });
    }
    // Die Zeilen tragen ihren Slot mit: die Aufschläge unten müssen wissen, zu welcher
    // Tageszeit ein Gericht steht, und `slots` allein sagt das nur über die Verschachtelung.
    const alle = mahlzeiten.flatMap(m => slots[m].map(z => ({ ...z, slot: m })));
    if (alle.length === 0) continue;
    const summe = alle.reduce((acc, z) => {
      const n = naehrwerte(z.kandidat, z.menge);
      return {
        kcal: acc.kcal + (n.kcal || 0),
        netCarbs: acc.netCarbs + (n.netCarbs || 0),
        fat: acc.fat + (n.fat || 0),
        protein: acc.protein + (n.protein || 0),
      };
    }, { kcal: 0, netCarbs: 0, fat: 0, protein: 0 });

    const note = bewerteTag(summe, ziele)
      + wiederholungsAufschlag(alle, strafe, summe.kcal)
      + slotAufschlag(alle, summe.kcal)
      + portionsAufschlag(alle);
    if (Number.isFinite(note)) {
      const kennung = alle.map(z => `${z.slot}:${z.kandidat.key}:${z.menge}`).sort().join("|");
      const bisher = gueltige.get(kennung);
      if (!bisher || note < bisher.note) gueltige.set(kennung, { note, slots });
      if (note < besteNote) besteNote = note;
    }
    const nNote = bewerteNotfall(summe, ziele);
    if (nNote < notNote) { notNote = nNote; notfall = slots; }
  }

  // Unter allen, die praktisch gleich gut sind, entscheidet der Startwert.
  const sortiert = [...gueltige.values()].sort((a, b) => a.note - b.note);
  const inSpanne = sortiert.filter(g => g.note <= besteNote * (1 + GLEICH_GUT_REL) + GLEICH_GUT_ABS).length;
  const engereWahl = sortiert.slice(0, Math.max(inSpanne, Math.min(ENGERE_WAHL_MIN, sortiert.length)));
  const bester = engereWahl.length
    ? engereWahl[Math.floor(zufall(saat + 31)() * engereWahl.length)].slots
    : null;

  // Kein einziger Anlauf blieb im KH-Limit — dann lieber den knappsten Plan zeigen und das
  // dazusagen, als gar keinen. Wer nur Brot und Nudeln im Katalog hat, soll sehen, woran es
  // liegt, statt vor einer leeren Seite zu stehen.
  const gewaehlt = bester || notfall;
  return gewaehlt ? { slots: gewaehlt, ueberLimit: !bester } : null;
}

/**
 * Der ganze Plan über mehrere Tage.
 *
 * Die Strafe sorgt für Abwechslung: was gestern auf dem Tisch stand, ist heute unwahrscheinlich
 * und übermorgen wieder normal. Ohne sie stünden vier Mal dieselben Frikadellen da — der Motor
 * würfelt schließlich jeden Tag aus demselben Topf.
 */
export function erstellePlan({ katalog, ziele, dateKeys, mahlzeiten, saat = 1 }) {
  const tage = [];
  const zuletzt = new Map(); // key -> Index des Tages, an dem es zuletzt vorkam
  for (let i = 0; i < dateKeys.length; i++) {
    const strafe = new Map();
    for (const [key, tag] of zuletzt) {
      const abstand = i - tag;
      if (abstand <= 1) strafe.set(key, 0.15);
      else if (abstand === 2) strafe.set(key, 0.5);
    }
    const gebaut = baueTag(katalog, ziele, mahlzeiten, { saat: saat + i * 104729, strafe });
    if (!gebaut) {
      tage.push(leererTag(dateKeys[i], ziele, mahlzeiten));
      continue;
    }
    for (const slot of mahlzeiten) {
      for (const z of gebaut.slots[slot] || []) zuletzt.set(z.kandidat.key, i);
    }
    tage.push(baueTagesplan(dateKeys[i], gebaut, ziele, mahlzeiten));
  }
  return tage;
}

function leererTag(dateKey, ziele, mahlzeiten) {
  return {
    dateKey,
    mahlzeiten: Object.fromEntries(mahlzeiten.map(m => [m, []])),
    summe: { kcal: 0, netCarbs: 0, fat: 0, protein: 0 },
    ziele,
    ueberLimit: false,
    leer: true,
  };
}

/** Aus den gewürfelten Zeilen die Form, mit der Ansicht und Übernahme arbeiten. */
function baueTagesplan(dateKey, gebaut, ziele, mahlzeiten) {
  const mahl = {};
  for (const slot of mahlzeiten) {
    mahl[slot] = (gebaut.slots[slot] || []).map(z => zurZeile(z.kandidat, z.menge));
  }
  const alle = mahlzeiten.flatMap(m => mahl[m]);
  return {
    dateKey,
    mahlzeiten: mahl,
    summe: summeAusZeilen(alle),
    ziele,
    ueberLimit: gebaut.ueberLimit,
    leer: alle.length === 0,
  };
}

/**
 * Eine Planzeile — alles, was Anzeige UND Übernahme brauchen, ohne noch einmal im Katalog
 * nachschlagen zu müssen. Der Katalog ist ein Zwischenergebnis; der Plan soll für sich stehen.
 */
export function zurZeile(kandidat, menge) {
  return {
    key: kandidat.key,
    name: kandidat.name,
    istRezept: kandidat.istRezept,
    recipeId: kandidat.recipeId,
    barcode: kandidat.barcode,
    menge,
    einheit: kandidat.einheit,
    servingG: kandidat.servingG,
    ...naehrwerte(kandidat, menge),
  };
}

export function summeAusZeilen(zeilen) {
  return zeilen.reduce((acc, z) => ({
    kcal: acc.kcal + (z.kcal || 0),
    netCarbs: acc.netCarbs + (z.netCarbs || 0),
    fat: acc.fat + (z.fat || 0),
    protein: acc.protein + (z.protein || 0),
  }), { kcal: 0, netCarbs: 0, fat: 0, protein: 0 });
}

/**
 * Eine einzelne Zeile austauschen — und nur sie.
 *
 * Wer "Tauschen" tippt, will dieses eine Gericht loswerden, nicht den Plan. Der Rest des Tages
 * bleibt deshalb unangetastet; die Tagessumme verschiebt sich dabei zwangsläufig, und genau
 * das zeigt die Ansicht dann auch an.
 */
export function tauscheZeile(tag, slot, index, { katalog, saat }) {
  const zeilen = tag.mahlzeiten[slot] || [];
  const alt = zeilen[index];
  if (!alt) return tag;

  // Alles, was heute schon auf dem Plan steht, ist tabu — die Zeile, die weg soll, inbegriffen.
  const gesperrt = new Set(Object.values(tag.mahlzeiten).flat().map(z => z.key));
  const kandidaten = katalog.filter(k => !gesperrt.has(k.key));
  if (kandidaten.length === 0) return tag;

  const leer = new Map();
  const neu = ziehe(kandidaten, kandidaten.map(k => gewichtVon(k, slot, leer)), zufall(saat));
  if (!neu) return tag;

  // Dieselbe Energie wie die Zeile, die geht — ein Tausch soll den Tag nicht umwerfen.
  const neueZeilen = [...zeilen];
  neueZeilen[index] = zurZeile(neu, mengeFuerBudget(neu, alt.kcal || 0));
  const mahlzeiten = { ...tag.mahlzeiten, [slot]: neueZeilen };
  const alle = Object.values(mahlzeiten).flat();
  const summe = summeAusZeilen(alle);
  return {
    ...tag,
    mahlzeiten,
    summe,
    // Beide Grenzen, nicht nur die Kohlenhydrate: nach einem Tausch kann auch das Fett
    // darüber liegen, und dann gehört es genauso dazugesagt.
    ueberLimit: summe.netCarbs > tag.ziele.netCarbG
      || (tag.ziele.fatG > 0 && summe.fat > tag.ziele.fatG),
    leer: alle.length === 0,
  };
}

/** Die Tage, für die geplant wird. */
export function planTage(startDateKey, anzahl) {
  return Array.from({ length: anzahl }, (_, i) => shiftDateKey(startDateKey, i));
}

/**
 * Einen Vorschlag von außen (Gemini, siehe ai.js) in einen Plan verwandeln.
 *
 * Hier steht die Regel, die das Ganze sicher macht: **das Modell wählt aus, die App rechnet.**
 * Der Vorschlag besteht nur aus Verweisen auf den Katalog und Mengen. Ein Schlüssel, den der
 * Katalog nicht kennt, wird verworfen — er wäre Essen, das dieser Haushalt nicht hat. Und
 * jede Zahl im fertigen Plan kommt aus `naehrwerte()`, nie aus der Antwort: sonst stünde im
 * Tagesprotokoll irgendwann eine Kalorienzahl, die ein Sprachmodell geschätzt hat.
 *
 * Mengen werden in die Grenzen des Kandidaten gezwungen. Auch das ist kein Misstrauen um
 * seiner selbst willen: "3 Portionen Auflauf" wäre eine formal gültige Antwort und trotzdem
 * keine Mahlzeit.
 */
export function ausVorschlag(vorschlag, { katalog, ziele, dateKeys, mahlzeiten }) {
  const nachKey = new Map(katalog.map(k => [k.key, k]));
  const tage = dateKeys.map(dateKey => ({
    dateKey,
    mahlzeiten: Object.fromEntries(mahlzeiten.map(m => [m, []])),
  }));
  const nachDatum = new Map(tage.map(t => [t.dateKey, t]));

  for (const e of vorschlag || []) {
    const tag = nachDatum.get(e.tag);
    const kandidat = nachKey.get(e.katalogKey);
    if (!tag || !kandidat || !mahlzeiten.includes(e.mahlzeit)) continue;
    // Zweimal dasselbe an einem Tag ist kein Plan, sondern ein Versehen — auch dann, wenn
    // es aus einer anderen Quelle kommt.
    if (Object.values(tag.mahlzeiten).flat().some(z => z.key === kandidat.key)) continue;
    tag.mahlzeiten[e.mahlzeit].push(zurZeile(kandidat, passeMenge(kandidat, Number(e.menge) || kandidat.standard)));
  }

  return tage.map(t => {
    const alle = Object.values(t.mahlzeiten).flat();
    const summe = summeAusZeilen(alle);
    return {
      ...t,
      summe,
      ziele,
      ueberLimit: summe.netCarbs > ziele.netCarbG || (ziele.fatG > 0 && summe.fat > ziele.fatG),
      leer: alle.length === 0,
    };
  });
}

// ===========================================================================
// ÜBERNEHMEN, VERWERFEN, EINKAUFEN
// ===========================================================================

/** Vorgemerkte, noch nicht bestätigte Einträge eines Profils (optional nur an einem Tag). */
export function geplanteEintraege(profileId, dateKey = null) {
  return Store.getConsumption().filter(e =>
    e.planned && e.profileId === profileId && (dateKey == null || e.dateKey === dateKey)
  );
}

/**
 * Den Plan in echte Einträge überführen.
 *
 * Die Nährwerte kommen aus dem Plan und werden NICHT neu gerechnet: was auf dem Bildschirm
 * stand, steht danach im Tag. Änderte sich zwischen Anzeigen und Übernehmen ein Rezept, wäre
 * alles andere eine stille Abweichung von dem, was man gesehen und bestätigt hat — dieselbe
 * Regel wie beim Weiterreichen an das zweite Profil (siehe consumption.js).
 */
export function uebernehmePlan(plan, profileId) {
  const eintraege = [];
  const jetzt = Date.now();
  for (const tag of plan) {
    for (const [slot, zeilen] of Object.entries(tag.mahlzeiten)) {
      for (const z of zeilen) {
        const eintrag = {
          id: crypto.randomUUID(),
          profileId,
          // Rezepte tragen weiterhin "recipe:<id>" — daran hängt die Schnellauswahl.
          barcode: z.istRezept ? `recipe:${z.recipeId}` : z.barcode,
          name: z.name,
          servingG: z.servingG ?? null,
          meal: slot,
          dateKey: tag.dateKey,
          kcal: z.kcal,
          netCarbs: z.netCarbs,
          fat: z.fat,
          protein: z.protein,
          at: jetzt,
          planned: true,
        };
        if (z.einheit === "portion") eintrag.servings = z.menge;
        else eintrag.grams = z.menge;
        Store.addConsumption(eintrag);
        eintraege.push(eintrag);
      }
    }
  }
  return eintraege;
}

/** Vorgemerktes eines Tages wieder wegräumen. Bestätigtes bleibt unangetastet. */
export function verwirfPlan(profileId, dateKey) {
  const weg = geplanteEintraege(profileId, dateKey);
  for (const e of weg) Store.removeConsumption(e.id);
  return weg.length;
}

/**
 * Was man dafür einkaufen muss.
 *
 * Rezepte werden in ihre Zutaten aufgelöst und auf die geplante Portionszahl heruntergerechnet
 * (die Zutatenmengen gelten für das ganze Rezept, nicht für eine Portion). Gleiche Namen über
 * alle Tage addieren sich — sonst stünde "Eier" viermal auf der Liste und man kauft dreimal
 * zu wenig.
 */
/** Sammelt Namen und Mengen und fasst gleiche Namen zusammen. */
function zutatenSammler() {
  const summe = new Map();
  return {
    merke(name, gramm) {
      const schluessel = String(name || "").trim().toLowerCase();
      if (!schluessel) return;
      const cur = summe.get(schluessel) || { name: String(name).trim(), gramm: 0 };
      cur.gramm += gramm || 0;
      summe.set(schluessel, cur);
    },
    fertig() {
      return [...summe.values()]
        .map(z => ({ name: z.name, gramm: Math.round(z.gramm) }))
        .sort((a, b) => a.name.localeCompare(b.name, "de"));
    },
  };
}

/**
 * Die Zutaten eines Rezepts für eine bestimmte Portionszahl.
 *
 * Die Mengen in einem Rezept gelten für das GANZE Rezept, nicht für eine Portion — wer eine
 * von vier Portionen plant, braucht ein Viertel davon. Auch der Bearbeiten-Dialog auf der
 * Startseite rechnet darüber (siehe consumption.js).
 */
export function zutatenFuerRezept(rezept, portionen) {
  const sammler = zutatenSammler();
  const anteil = portionen / (rezept?.servings || 1);
  for (const zutat of rezept?.ingredients || []) sammler.merke(zutat.name, (zutat.grams || 0) * anteil);
  return sammler.fertig();
}

export function zutatenFuerPlan(plan) {
  const sammler = zutatenSammler();
  for (const tag of plan) {
    for (const zeilen of Object.values(tag.mahlzeiten)) {
      for (const z of zeilen) {
        if (!z.istRezept) { sammler.merke(z.name, z.menge); continue; }
        const rezept = Store.getRecipe(z.recipeId);
        // Rezept nicht (mehr) da: wenigstens der Name auf die Liste, statt es zu verschlucken.
        if (!rezept) { sammler.merke(z.name, 0); continue; }
        for (const zutat of zutatenFuerRezept(rezept, z.menge)) sammler.merke(zutat.name, zutat.gramm);
      }
    }
  }
  return sammler.fertig();
}

/** "Hähnchenbrustfilet 400 g" — was ohne Menge geführt wird (Gewürze), bleibt ohne Zahl. */
export function einkaufsText(zutat) {
  return zutat.gramm > 0 ? `${zutat.name} ${zutat.gramm} g` : zutat.name;
}

/** Der Name ohne die angehängte Menge — "Eier 240 g" und "Eier" sind dieselbe Zeile. */
function ohneMenge(text) {
  return String(text).replace(/\s+\d+([.,]\d+)?\s*g$/i, "").trim().toLowerCase();
}

/**
 * Zutaten auf die Einkaufsliste. Was offen schon draufsteht, kommt nicht noch einmal —
 * verglichen wird über den Namen, nicht über die Menge: "Eier 240 g" und "Eier 180 g" sind
 * beim Einkaufen eine Zeile, nicht zwei.
 */
export function aufEinkaufsliste(zutaten) {
  const offen = new Set(
    Store.get().shoppingList.filter(i => !i.checked).map(i => ohneMenge(i.text))
  );
  let gesetzt = 0;
  for (const zutat of zutaten) {
    const text = einkaufsText(zutat);
    if (offen.has(ohneMenge(text))) continue;
    Store.addShoppingItem(text);
    offen.add(ohneMenge(text));
    gesetzt++;
  }
  return gesetzt;
}
