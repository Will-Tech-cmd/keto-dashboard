// kategorie.js — zu welcher Warengruppe ein Produkt gehört.
//
// Die Favoritenliste ist über hundert Einträge lang. Sie steht nach Verwendung sortiert
// (lists.js), was das tägliche Suchen löst, aber nicht das Stöbern: "was habe ich eigentlich
// an Käse?" beantwortet keine Reihenfolge. Dafür die Kategorie.
//
// Sie wird NICHT gepflegt, sondern abgeleitet — sonst wäre jede neue Zutat Handarbeit:
//
//   1. Eingebaute Tabelle (js/foods-db.js): die Abschnitte sind die Kategorie. Immer richtig.
//   2. Alles andere (Open Food Facts, eigene Produkte): geraten aus Name und Marke.
//
// Die Reihenfolge der Regeln ist die halbe Miete, weil Produktnamen mehrere Gruppen nennen.
// Deshalb steht jede Vertauschung, die bei einer Probe über 102 echte Favoriten auffiel, als
// Beispiel in test/kategorie.test.mjs:
//
//   "Thunfisch Filets in Sonnenblumenöl"  Fisch vor Fett, sonst ist es ein Öl
//   "Käse-Paprika Puten-Wiener"           Fleisch vor Käse, sonst ist die Wurst ein Käse
//   "Marzipan Sahne Liqueur"              Getränk vor Milch, sonst ist der Likör Sahne
//   "Olivenöl"                            Fett vor Gemüse, sonst ist das Öl eine Olive
//   "Heringsfilet Eier/Senf"              Fisch vor Gewürz, sonst ist der Hering Senf
//   "Spinat Rahm Blattspinat"             Gemüse vor Milch, sonst ist der Spinat ein Rahm
//   "Ochsenbäckchen in Rotweinsauce"      Fleisch vor Getränk, sonst ist das Fleisch ein Wein
//
// Grenzen, die man kennen sollte: getippte Namen mit Tippfehler („Frischköse") sind nicht zu
// retten, und ein Name ohne Hinweis landet in "Sonstiges". Das ist gewollt — lieber ehrlich
// unsortiert als falsch einsortiert.

import { getLocalFoodByBarcode } from "./foods-db.js";

export const SONSTIGES = "Sonstiges";

/** Die Reihenfolge ist Teil der Regel: die erste Zeile, die passt, gewinnt. */
const REGELN = [
  ["Fisch", /lachs|thunfisch|hering|garnele|scampi|forelle|makrele|sardine|sardelle|kabeljau|seelachs|fischfilet|\bfisch\b/i],
  ["Fleisch & Wurst", /wurst|würstchen|wiener\b|salami|schinken|speck|bacon|steak|hähnchen|hühner|puten|truthahn|schwein|rind\b|rinder|ochsen|lamm|chorizo|kaminwurz|prosciutto|schnitzel|nacken|keule|filet|hack|gyros|döner|leberkäs/i],
  ["Getränke", /wein\b|likör|liqueur|schnaps|\bbier\b|kaffee|espresso|\btee\b|saft\b|limonade|cola|sekt\b|prosecco/i],
  ["Käse", /käse|cheddar|mozzarella|parmesan|gouda|emmentaler|burrata|\bfeta\b|camembert|brie\b|blu\b|halloumi|ricotta|raclette|bergader/i],
  ["Gewürze & Kräuter", /gewürz|pfeffer|paprikapulver|chilipulver|cayenne|oregano|basilikum|thymian|rosmarin|majoran|petersilie|curry|kümmel|koriander|senfmehl|senfkörner|ingwer|kurkuma|zimt|muskat|lorbeer|\bsalz\b|knoblauchpulver|zwiebelpulver|kräuter/i],
  ["Nüsse & Samen", /mandel|walnuss|haselnuss|macadamia|cashew|pekan|pistazie|\bnuss|nüsse|kerne|pinien|leinsamen|chiasamen|sesam|kokos/i],
  ["Fette & Saucen", /\böl\b|öl$|olivenöl|kokosöl|rapsöl|butterschmalz|schmalz|mayonnaise|remoulade|ketchup|sojasauce|soja|soia|\bsenf\b|dressing|\bsauce\b|\bsoße\b/i],
  ["Gemüse & Salat", /salat|gurke|tomate|spinat|brokkoli|blumenkohl|zucchini|aubergine|zwiebel|karotte|möhre|champignon|pilz|paprika|kohl\b|kohlrabi|bohnen|erbsen|avocado|oliven|lauch|sellerie|radieschen|rucola|spargel|fenchel|kürbis/i],
  ["Milch & Eier", /milch|sahne|rahm|joghurt|quark|skyr|butter|mascarpone|crème|creme|\beier\b|\bei\b|buttermilch|kefir/i],
  ["Obst", /erdbeere|himbeer|brombeer|heidelbeer|blaubeer|beeren|zitrone|limette|apfel|birne|orange|melone|pfirsich|rhabarber/i],
  ["Backen & Ersatz", /nudeln|tagliatelle|spaghetti|pasta|brötchen|\bbrot\b|mehl|schokolade|kakao|erythrit|xylit|süßstoff|protein|riegel|slim|low.?carb|tofu|seitan|tempeh|flohsamen/i],
];

/**
 * Die Kategorie eines Eintrags. `barcode` zieht die eingebaute Tabelle heran (dort steht sie
 * fest), `name` und `marke` sind die Rateposition für alles andere.
 */
export function kategorieFuer({ barcode = "", name = "", brand = "" } = {}) {
  const ausTabelle = getLocalFoodByBarcode(barcode);
  if (ausTabelle?.kategorie) return ausTabelle.kategorie;
  // "ohne Salz", "ohne Zucker": was ein Produkt NICHT enthält, sagt nichts über seine Gruppe.
  // "Rostmandeln (ohne Salz)" landete darüber bei den Gewürzen.
  const text = `${name} ${brand}`.toLowerCase().replace(/\bohne\s+\S+/g, " ");
  return REGELN.find(([, muster]) => muster.test(text))?.[0] || SONSTIGES;
}

/** Alle Kategorien in fester Reihenfolge — die Reiter sollen nicht springen. */
export const KATEGORIEN = [...REGELN.map(([name]) => name), SONSTIGES];

/**
 * Gruppiert Einträge und liefert nur die Kategorien zurück, in denen etwas liegt — mit der
 * Anzahl, damit die Auswahl sagen kann, was sie bringt.
 */
export function kategorienMitAnzahl(items) {
  const zaehler = new Map();
  for (const item of items) {
    const k = kategorieFuer(item);
    zaehler.set(k, (zaehler.get(k) || 0) + 1);
  }
  return KATEGORIEN.filter(k => zaehler.has(k)).map(k => ({ kategorie: k, anzahl: zaehler.get(k) }));
}
