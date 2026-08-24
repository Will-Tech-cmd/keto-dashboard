// titelbild.js — ein Titelbild für Rezepte, die noch keines haben.
//
// Zweiundzwanzig graue Kästen mit demselben Teller-Symbol sehen aus wie ein Fehler. Statt
// dessen bekommt jedes Rezept eine eigene Kachel: ein Farbverlauf, der sich aus dem Titel
// ableitet, und ein Symbol nach Art des Gerichts.
//
// Zwei Eigenschaften sind wichtig:
//
//   Es bleibt gleich.  Die Farbe kommt aus dem Titel, nicht aus dem Zufall — dasselbe Rezept
//                      hat auf jedem Gerät und nach jedem Neuladen dieselbe Kachel. Man
//                      erkennt es in der Liste wieder, ohne den Namen zu lesen.
//   Es tritt zurück.   Sobald ein echtes Foto hochgeladen ist, wird die Kachel nicht mehr
//                      gezeichnet. Sie ist ein Platzhalter, kein Gestaltungselement.
//
// Bewusst keine erfundenen Fotos: ein Stockbild von „Cheesecake" zeigt einen Kuchen mit
// Zucker und Keksboden — nicht den hier hinterlegten mit Mandelboden. Hübsch und falsch ist
// schlechter als offensichtlich schematisch.

/**
 * Farbpaare für den Verlauf. Bewusst eine feste, kleine Auswahl statt einer Rechnung über
 * den ganzen Farbkreis: gerechnete Farbtöne ergeben einen Setzkasten, eine kuratierte Reihe
 * ergibt ein Set. Alle gedämpft und leicht warm, damit sie neben dem Terrakotta des
 * Kochbuchs stehen können, ohne sich zu beißen.
 */
const VERLAEUFE = [
  ["#c87a4e", "#e3ad7a"], // Terrakotta
  ["#8a9a5b", "#b9c489"], // Olive
  ["#a05c6b", "#cc909b"], // Altrosa
  ["#5f7f7a", "#93b3ad"], // Salbei
  ["#b08344", "#d9b579"], // Senf
  ["#7d6a94", "#ab9bc0"], // Pflaume
  ["#5c7a99", "#93b0c9"], // Denim
  ["#9c5f42", "#c99172"], // Kupfer
  ["#6b8f6e", "#9fbfa1"], // Waldgrün
  ["#a8724f", "#cfa27f"], // Karamell
];

/**
 * Symbol nach Art des Gerichts. Die Reihenfolge zählt: „Cheesecake" enthält „Käse", ist aber
 * ein Kuchen — spezifischere Begriffe stehen deshalb vorn.
 */
const SYMBOLE = [
  [/cheesecake|tiramisu|kuchen|torte|muffin/i, "🍰"],
  [/quark|joghurt|nachtisch|pudding|creme|sahne/i, "🍮"],
  [/beere|himbeer|erdbeer|obst/i, "🫐"],
  [/kaffee|espresso|tee|shake|drink/i, "☕"],
  [/brot|waffel|pfannkuchen|toast|semmel|brötchen/i, "🥖"],
  [/rührei|omelett|\bei\b|eier/i, "🍳"],
  [/döner|kebab|burger|wrap/i, "🌯"],
  [/hähnchen|hänchen|pute|geflügel|huhn/i, "🍗"],
  [/hack|bolognese|rind|steak|gulasch|auflauf/i, "🍖"],
  [/wurst|speck|bacon|schinken|krakauer|salami/i, "🥓"],
  [/fisch|lachs|thunfisch|garnele/i, "🐟"],
  [/salat|gurke|spinat|zucchini|gemüse|kohl/i, "🥗"],
  [/käse|mozzarella|feta|emmentaler/i, "🧀"],
  [/suppe|eintopf|soße|sauce/i, "🍲"],
];

const STANDARD_SYMBOL = "🍽️";

/**
 * Kleine, stabile Streuung über den Titel. Kein kryptografischer Anspruch — nur die Zusage,
 * dass derselbe Titel immer dieselbe Zahl ergibt, auf jedem Gerät und in jedem Browser.
 */
function streuwert(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Das Symbol für einen Rezepttitel. */
export function titelbildSymbol(titel) {
  const t = String(titel || "");
  for (const [muster, symbol] of SYMBOLE) if (muster.test(t)) return symbol;
  return STANDARD_SYMBOL;
}

/**
 * Die beiden Farben des Verlaufs, als Inline-Stil für ein Element mit der Klasse
 * `kb-cover`. Das eigentliche Zeichnen macht das Stylesheet — hier kommen nur die zwei
 * Werte her, damit die Kachel im dunklen Erscheinungsbild dort gedämpft werden kann.
 */
export function titelbildStil(titel) {
  const [a, b] = VERLAEUFE[streuwert(String(titel || "")) % VERLAEUFE.length];
  return `--cover-a:${a};--cover-b:${b}`;
}

/**
 * Fertiges Attribut-Paar für ein Kachel-Element: entweder das echte Foto oder die erzeugte
 * Kachel. Eine Stelle, an der beides entschieden wird — Liste und Detailansicht sollen nicht
 * auseinanderlaufen.
 */
export function titelbildAttribute(titel, fotoUrl) {
  if (fotoUrl) {
    return { klasse: "", stil: `background-image:url('${fotoUrl}')`, symbol: "" };
  }
  return { klasse: "kb-cover", stil: titelbildStil(titel), symbol: titelbildSymbol(titel) };
}
