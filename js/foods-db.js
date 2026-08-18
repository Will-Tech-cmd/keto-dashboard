// foods-db.js — kuratierte, offline verfügbare Nährwerttabelle für gängige Grundnahrungsmittel
// (Eier, Fleisch, Fisch, Käse, Gemüse, Nüsse, Fette). Werte pro 100g, Richtwerte auf Basis
// gängiger Nährwerttabellen. "carbs" folgt der EU-Etikett-Konvention (bereits ohne Ballaststoffe).

function food(name, per100, servingG, aliases = []) {
  const slug = name.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return { slug, name, aliases, servingG, per100 };
}

// per100: { kcal, carbs, fiber, sugars, fat, saturatedFat, protein, salt }
export const FOODS = [
  // Eier & Milchprodukte
  food("Eier", { kcal: 155, carbs: 1.1, fiber: 0, sugars: 1.1, fat: 11, saturatedFat: 3.1, protein: 13, salt: 0.35 }, 58, ["Ei"]),
  food("Eigelb", { kcal: 322, carbs: 3.6, fiber: 0, sugars: 0.6, fat: 27, saturatedFat: 9.6, protein: 16, salt: 0.1 }, 18),
  food("Eiweiß", { kcal: 52, carbs: 0.7, fiber: 0, sugars: 0.7, fat: 0.2, saturatedFat: 0, protein: 11, salt: 0.4 }, 33, ["Eiklar"]),
  food("Butter", { kcal: 741, carbs: 0.6, fiber: 0, sugars: 0.6, fat: 83, saturatedFat: 51, protein: 0.7, salt: 0.8 }, 10),
  food("Schlagsahne", { kcal: 292, carbs: 3.4, fiber: 0, sugars: 3.4, fat: 30, saturatedFat: 19, protein: 2.2, salt: 0.05 }, 30, ["Sahne"]),
  food("Crème fraîche", { kcal: 292, carbs: 3.3, fiber: 0, sugars: 3.3, fat: 30, saturatedFat: 19, protein: 2.4, salt: 0.1 }, 30, ["Creme fraiche"]),
  food("Frischkäse", { kcal: 342, carbs: 3, fiber: 0, sugars: 3, fat: 34, saturatedFat: 21, protein: 5, salt: 0.6 }, 30),
  food("Naturjoghurt", { kcal: 66, carbs: 4.7, fiber: 0, sugars: 4.7, fat: 3.5, saturatedFat: 2.3, protein: 3.5, salt: 0.1 }, 150, ["Joghurt"]),
  food("Sahnequark", { kcal: 176, carbs: 3.4, fiber: 0, sugars: 3.4, fat: 11, saturatedFat: 7, protein: 12, salt: 0.1 }, 125, ["Quark"]),
  food("Vollmilch", { kcal: 64, carbs: 4.8, fiber: 0, sugars: 4.8, fat: 3.5, saturatedFat: 2.3, protein: 3.3, salt: 0.1 }, 200, ["Milch"]),

  // Käse
  food("Gouda", { kcal: 356, carbs: 0, fiber: 0, sugars: 0, fat: 28, saturatedFat: 18, protein: 25, salt: 2.0 }, 30),
  food("Emmentaler", { kcal: 380, carbs: 0, fiber: 0, sugars: 0, fat: 30, saturatedFat: 19, protein: 28, salt: 0.8 }, 30),
  food("Parmesan", { kcal: 402, carbs: 0, fiber: 0, sugars: 0, fat: 29, saturatedFat: 19, protein: 36, salt: 1.6 }, 20),
  food("Mozzarella", { kcal: 280, carbs: 1, fiber: 0, sugars: 1, fat: 22, saturatedFat: 15, protein: 20, salt: 0.6 }, 100),
  food("Feta", { kcal: 264, carbs: 1.5, fiber: 0, sugars: 1.5, fat: 21, saturatedFat: 15, protein: 17, salt: 3.0 }, 50),
  food("Camembert", { kcal: 300, carbs: 0.5, fiber: 0, sugars: 0.5, fat: 24, saturatedFat: 15, protein: 20, salt: 1.8 }, 30),
  food("Ziegenfrischkäse", { kcal: 280, carbs: 2, fiber: 0, sugars: 2, fat: 24, saturatedFat: 16, protein: 14, salt: 1.0 }, 30, ["Ziegenkäse"]),
  food("Hüttenkäse", { kcal: 98, carbs: 3.4, fiber: 0, sugars: 3.4, fat: 4.3, saturatedFat: 2.7, protein: 12, salt: 0.7 }, 100),
  food("Halloumi", { kcal: 320, carbs: 2, fiber: 0, sugars: 2, fat: 25, saturatedFat: 18, protein: 22, salt: 2.5 }, 100),

  // Fleisch & Wurst
  food("Hähnchenbrust", { kcal: 110, carbs: 0, fiber: 0, sugars: 0, fat: 1.6, saturatedFat: 0.4, protein: 23, salt: 0.1 }, 150),
  food("Hähnchenschenkel", { kcal: 216, carbs: 0, fiber: 0, sugars: 0, fat: 15.5, saturatedFat: 4.3, protein: 18.6, salt: 0.2 }, 150),
  food("Putenbrust", { kcal: 104, carbs: 0, fiber: 0, sugars: 0, fat: 1, saturatedFat: 0.3, protein: 24, salt: 0.1 }, 150),
  food("Rinderhackfleisch", { kcal: 218, carbs: 0, fiber: 0, sugars: 0, fat: 15, saturatedFat: 6.5, protein: 20, salt: 0.15 }, 150, ["Hackfleisch"]),
  food("Rumpsteak", { kcal: 195, carbs: 0, fiber: 0, sugars: 0, fat: 11, saturatedFat: 4.5, protein: 22, salt: 0.1 }, 200, ["Steak"]),
  food("Schweinebauch", { kcal: 398, carbs: 0, fiber: 0, sugars: 0, fat: 38, saturatedFat: 14, protein: 12, salt: 0.1 }, 150),
  food("Schweineschnitzel", { kcal: 143, carbs: 0, fiber: 0, sugars: 0, fat: 4.5, saturatedFat: 1.6, protein: 24, salt: 0.1 }, 150),
  food("Speck", { kcal: 541, carbs: 1.4, fiber: 0, sugars: 0, fat: 42, saturatedFat: 15, protein: 37, salt: 2.0 }, 20, ["Bacon"]),
  food("Salami", { kcal: 407, carbs: 1.6, fiber: 0, sugars: 0.5, fat: 34, saturatedFat: 13, protein: 22, salt: 3.5 }, 30),
  food("Kochschinken", { kcal: 105, carbs: 0.5, fiber: 0, sugars: 0.5, fat: 3, saturatedFat: 1, protein: 18, salt: 2.2 }, 50),
  food("Lammkotelett", { kcal: 282, carbs: 0, fiber: 0, sugars: 0, fat: 23, saturatedFat: 10, protein: 18, salt: 0.15 }, 150),
  food("Ente", { kcal: 337, carbs: 0, fiber: 0, sugars: 0, fat: 28.4, saturatedFat: 9.7, protein: 19, salt: 0.1 }, 150),
  food("Leberwurst", { kcal: 326, carbs: 1.5, fiber: 0, sugars: 0.5, fat: 29, saturatedFat: 11, protein: 14, salt: 1.8 }, 30),
  food("Bratwurst", { kcal: 296, carbs: 1.5, fiber: 0, sugars: 0.5, fat: 26, saturatedFat: 10, protein: 13, salt: 1.6 }, 100),
  food("Cabanossi", { kcal: 400, carbs: 1, fiber: 0, sugars: 0.5, fat: 33, saturatedFat: 13, protein: 22, salt: 3.2 }, 50),

  // Fisch & Meeresfrüchte
  food("Lachs", { kcal: 208, carbs: 0, fiber: 0, sugars: 0, fat: 13, saturatedFat: 3.1, protein: 20, salt: 0.1 }, 150),
  food("Thunfisch (in Öl)", { kcal: 198, carbs: 0, fiber: 0, sugars: 0, fat: 8.2, saturatedFat: 1.6, protein: 29, salt: 0.4 }, 100, ["Thunfisch"]),
  food("Garnelen", { kcal: 99, carbs: 0.3, fiber: 0, sugars: 0, fat: 1.7, saturatedFat: 0.3, protein: 20.9, salt: 1.5 }, 120),
  food("Makrele (geräuchert)", { kcal: 262, carbs: 0, fiber: 0, sugars: 0, fat: 20, saturatedFat: 4.5, protein: 19, salt: 1.6 }, 100, ["Makrele"]),
  food("Kabeljau", { kcal: 82, carbs: 0, fiber: 0, sugars: 0, fat: 0.7, saturatedFat: 0.1, protein: 18, salt: 0.2 }, 150),
  food("Matjes", { kcal: 216, carbs: 3, fiber: 0, sugars: 3, fat: 15, saturatedFat: 3, protein: 17, salt: 2.5 }, 100, ["Hering"]),

  // Fette & Öle
  food("Olivenöl", { kcal: 884, carbs: 0, fiber: 0, sugars: 0, fat: 100, saturatedFat: 14, protein: 0, salt: 0 }, 10),
  food("Kokosöl", { kcal: 862, carbs: 0, fiber: 0, sugars: 0, fat: 99.9, saturatedFat: 87, protein: 0, salt: 0 }, 10),
  food("Ghee", { kcal: 897, carbs: 0, fiber: 0, sugars: 0, fat: 99.8, saturatedFat: 62, protein: 0.2, salt: 0 }, 10, ["Butterschmalz"]),
  food("Rapsöl", { kcal: 884, carbs: 0, fiber: 0, sugars: 0, fat: 100, saturatedFat: 7, protein: 0, salt: 0 }, 10),
  food("Mayonnaise", { kcal: 680, carbs: 1.5, fiber: 0, sugars: 1, fat: 75, saturatedFat: 6, protein: 1, salt: 1.0 }, 15),

  // Gemüse
  food("Avocado", { kcal: 160, carbs: 1.8, fiber: 6.7, sugars: 0.7, fat: 15, saturatedFat: 2.1, protein: 2, salt: 0.01 }, 150),
  food("Spinat", { kcal: 23, carbs: 1.4, fiber: 2.2, sugars: 0.4, fat: 0.4, saturatedFat: 0.1, protein: 2.9, salt: 0.1 }, 100),
  food("Brokkoli", { kcal: 34, carbs: 4, fiber: 2.6, sugars: 1.7, fat: 0.4, saturatedFat: 0.1, protein: 2.8, salt: 0.03 }, 150),
  food("Blumenkohl", { kcal: 25, carbs: 3, fiber: 2, sugars: 2, fat: 0.3, saturatedFat: 0.1, protein: 1.9, salt: 0.03 }, 150),
  food("Zucchini", { kcal: 17, carbs: 1.5, fiber: 1, sugars: 1.5, fat: 0.3, saturatedFat: 0.1, protein: 1.2, salt: 0.01 }, 150),
  food("Gurke", { kcal: 12, carbs: 1.8, fiber: 0.5, sugars: 1.7, fat: 0.1, saturatedFat: 0, protein: 0.6, salt: 0.01 }, 100, ["Salatgurke", "Gurken"]),
  food("Paprika", { kcal: 31, carbs: 4.6, fiber: 1.7, sugars: 4, fat: 0.4, saturatedFat: 0.1, protein: 1, salt: 0 }, 100),
  food("Tomaten", { kcal: 18, carbs: 2.9, fiber: 1.2, sugars: 2.6, fat: 0.2, saturatedFat: 0, protein: 0.9, salt: 0 }, 100, ["Tomate"]),
  food("Rucola", { kcal: 25, carbs: 2.1, fiber: 1.6, sugars: 2, fat: 0.7, saturatedFat: 0.1, protein: 2.6, salt: 0.02 }, 50),
  food("Feldsalat", { kcal: 21, carbs: 1.6, fiber: 1.5, sugars: 0.4, fat: 0.4, saturatedFat: 0, protein: 2, salt: 0.03 }, 50),
  food("Champignons", { kcal: 22, carbs: 0.9, fiber: 1, sugars: 0.4, fat: 0.3, saturatedFat: 0, protein: 3.1, salt: 0.01 }, 100),
  food("Aubergine", { kcal: 25, carbs: 2.6, fiber: 3, sugars: 2.4, fat: 0.2, saturatedFat: 0, protein: 1, salt: 0 }, 150),
  food("Grüne Bohnen", { kcal: 31, carbs: 3.4, fiber: 2.7, sugars: 1.4, fat: 0.2, saturatedFat: 0, protein: 1.8, salt: 0 }, 150),
  food("Sauerkraut", { kcal: 19, carbs: 1.4, fiber: 2.2, sugars: 1.1, fat: 0.2, saturatedFat: 0, protein: 1, salt: 1.2 }, 100),
  food("Radieschen", { kcal: 16, carbs: 1.9, fiber: 1.6, sugars: 1.9, fat: 0.1, saturatedFat: 0, protein: 0.8, salt: 0.05 }, 50),
  food("Karotten", { kcal: 35, carbs: 6, fiber: 2.9, sugars: 4.7, fat: 0.2, saturatedFat: 0, protein: 0.7, salt: 0.08 }, 100, ["Karotte", "Möhren", "Möhre"]),
  food("Zwiebeln", { kcal: 27, carbs: 5, fiber: 1.7, sugars: 4.2, fat: 0.1, saturatedFat: 0, protein: 1.2, salt: 0 }, 50, ["Zwiebel"]),
  food("Sellerie", { kcal: 16, carbs: 1.4, fiber: 1.6, sugars: 1.4, fat: 0.2, saturatedFat: 0, protein: 0.8, salt: 0.1 }, 100),
  food("Fenchel", { kcal: 31, carbs: 3.9, fiber: 3.1, sugars: 3.9, fat: 0.2, saturatedFat: 0, protein: 1.2, salt: 0.15 }, 150),
  food("Kohlrabi", { kcal: 27, carbs: 3.5, fiber: 3.6, sugars: 2.6, fat: 0.2, saturatedFat: 0, protein: 1.7, salt: 0.02 }, 150),
  food("Rotkohl", { kcal: 30, carbs: 4.3, fiber: 3.4, sugars: 3.7, fat: 0.2, saturatedFat: 0, protein: 1.4, salt: 0.02 }, 100),
  food("Chicorée", { kcal: 17, carbs: 1.7, fiber: 3, sugars: 0.3, fat: 0.2, saturatedFat: 0, protein: 1, salt: 0.01 }, 100),

  // Nüsse & Samen
  food("Mandeln", { kcal: 579, carbs: 9.3, fiber: 12.5, sugars: 4.4, fat: 49.9, saturatedFat: 3.8, protein: 21.2, salt: 0 }, 30),
  food("Walnüsse", { kcal: 654, carbs: 7, fiber: 6.7, sugars: 2.6, fat: 65, saturatedFat: 6.1, protein: 15, salt: 0 }, 30),
  food("Macadamianüsse", { kcal: 718, carbs: 5.2, fiber: 8.6, sugars: 4.6, fat: 76, saturatedFat: 12, protein: 7.9, salt: 0 }, 30),
  food("Paranüsse", { kcal: 656, carbs: 4.2, fiber: 7.5, sugars: 2.3, fat: 66, saturatedFat: 15.1, protein: 14.3, salt: 0 }, 30),
  food("Haselnüsse", { kcal: 628, carbs: 7, fiber: 9.7, sugars: 4.3, fat: 61, saturatedFat: 4.5, protein: 15, salt: 0 }, 30),
  food("Chiasamen", { kcal: 486, carbs: 1.7, fiber: 34.4, sugars: 0, fat: 31, saturatedFat: 3.3, protein: 17, salt: 0.02 }, 15),
  food("Leinsamen", { kcal: 534, carbs: 1.6, fiber: 27.3, sugars: 0.3, fat: 42, saturatedFat: 3.7, protein: 18, salt: 0.03 }, 15),
  food("Kokosraspeln", { kcal: 660, carbs: 6.4, fiber: 16, sugars: 6.4, fat: 65, saturatedFat: 57, protein: 7, salt: 0.03 }, 20),
  food("Pekannüsse", { kcal: 691, carbs: 4, fiber: 9.4, sugars: 4, fat: 72, saturatedFat: 6.2, protein: 9, salt: 0 }, 30),

  // Sonstiges
  food("Oliven (grün)", { kcal: 145, carbs: 3.8, fiber: 3.3, sugars: 0.5, fat: 15, saturatedFat: 2, protein: 1, salt: 3.5 }, 30, ["Oliven"]),
  food("Tofu", { kcal: 76, carbs: 0.7, fiber: 0.3, sugars: 0.5, fat: 4.8, saturatedFat: 0.7, protein: 8, salt: 0.01 }, 100),
  food("Knoblauch", { kcal: 149, carbs: 28, fiber: 2.1, sugars: 1, fat: 0.5, saturatedFat: 0.1, protein: 6.4, salt: 0.02 }, 5, ["Knoblauchzehe", "Knoblauchzehen"]),

  // Keto-Backen (für Rezept-Import)
  food("Kakaopulver", { kcal: 228, carbs: 25, fiber: 33, sugars: 1.8, fat: 14, saturatedFat: 8.5, protein: 20, salt: 0.02 }, 5, ["Kakao"]),
  food("Erythrit", { kcal: 0, carbs: 0, fiber: 0, sugars: 0, fat: 0, saturatedFat: 0, protein: 0, salt: 0 }, 10, ["Puder-Erythrit", "Erythritol"]),
  food("Zuckerfreie Schokolade", { kcal: 550, carbs: 10, fiber: 10, sugars: 1, fat: 45, saturatedFat: 27, protein: 8, salt: 0.02 }, 20),
  food("Vanilleextrakt", { kcal: 12, carbs: 0.1, fiber: 0, sugars: 0.1, fat: 0, saturatedFat: 0, protein: 0, salt: 0 }, 5, ["Vanillearoma", "Vanilleessenz"]),
  food("Mandelmehl", { kcal: 610, carbs: 8, fiber: 11, sugars: 3, fat: 52, saturatedFat: 4.5, protein: 24, salt: 0.01 }, 30),
  food("Kokosmehl", { kcal: 400, carbs: 21, fiber: 39, sugars: 7, fat: 13, saturatedFat: 11, protein: 19, salt: 0.4 }, 20),
  food("Flohsamenschalen", { kcal: 220, carbs: 3, fiber: 85, sugars: 0, fat: 1, saturatedFat: 0, protein: 3, salt: 0.02 }, 10),
  food("Mascarpone", { kcal: 429, carbs: 4, fiber: 0, sugars: 4, fat: 44, saturatedFat: 29, protein: 5, salt: 0.1 }, 30),
  food("Skyr", { kcal: 63, carbs: 4, fiber: 0, sugars: 4, fat: 0.2, saturatedFat: 0.1, protein: 11, salt: 0.1 }, 150),
];

/** Sucht in der lokalen Tabelle nach Namen/Aliassen, beste Treffer (startsWith) zuerst. */
export function searchLocalFoods(term) {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const starts = [];
  const contains = [];
  for (const item of FOODS) {
    const names = [item.name, ...item.aliases].map(n => n.toLowerCase());
    if (names.some(n => n.startsWith(q))) starts.push(item);
    else if (names.some(n => n.includes(q))) contains.push(item);
  }
  return [...starts, ...contains].slice(0, 12).map(toLocalProduct);
}

/** Normalisiert für den Vergleich: Umlaute, Kleinschreibung, Satzzeichen raus, Leerraum glätten. */
function normalizeForMatch(s) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein-Distanz (Anzahl Einfüge-/Lösch-/Ersetz-Schritte zwischen zwei Wörtern). */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

// Wie viele Tippfehler toleriert werden, gestaffelt nach Wortlänge — bei kurzen Wörtern
// bedeutet 1 falscher Buchstabe schon ein anderes Wort, bei langen ist mehr Toleranz sicher.
function maxTypoDistance(wordLen) {
  if (wordLen >= 8) return 2;
  if (wordLen >= 4) return 1;
  return 0; // unter 4 Zeichen: keine Toleranz, sonst zu viele Fehlalarme
}
// Teilwort-Treffer erst ab dieser Länge zulassen. Das ist die zentrale Korrektur gegen die
// "Ei"-Katastrophe: der 2-Zeichen-Alias "Ei" darf nicht mehr jedes Wort mit "ei" treffen
// ("Heidelbeeren", "Reis", "Feigen" wurden vorher alle fälschlich zu "Eier").
const MIN_SUBSTRING_LEN = 5;

/**
 * Unscharfe Zutaten-Erkennung für den Rezept-Import, mit Trefferqualität für die Prüfansicht:
 *   "exact"     — Name/Alias entspricht der Zutat exakt (nach Normalisierung)
 *   "word"      — Name/Alias ist eines der Wörter in der Zutatenbezeichnung
 *   "substring" — Name/Alias steckt als Teilstring in der Zutat oder umgekehrt (ab 5 Zeichen)
 *   "fuzzy"     — ein Wort der Zutat unterscheidet sich nur durch 1-2 Tippfehler von Name/Alias
 * Liefert { product, quality } oder null.
 */
export function bestLocalFoodMatch(ingredientName) {
  const q = normalizeForMatch(ingredientName);
  if (!q) return null;
  const qWords = q.split(" ");

  let exact = null;
  let word = null;
  let sub = null, subLen = 0;
  let fuzzy = null, fuzzyDist = Infinity;

  outer:
  for (const item of FOODS) {
    for (const cand of [item.name, ...item.aliases]) {
      const c = normalizeForMatch(cand);
      if (!c) continue;

      if (c === q) { exact = item; break outer; }
      if (!word && qWords.includes(c)) word = item;
      if (c.length >= MIN_SUBSTRING_LEN && (q.includes(c) || c.includes(q)) && c.length > subLen) {
        sub = item;
        subLen = c.length;
      }
      if (c.length >= 4) {
        for (const w of qWords) {
          const dist = levenshtein(w, c);
          if (dist > 0 && dist <= maxTypoDistance(c.length) && dist < fuzzyDist) {
            fuzzy = item;
            fuzzyDist = dist;
          }
        }
      }
    }
  }

  const hit = exact || word || sub || fuzzy;
  if (!hit) return null;
  const quality = exact ? "exact" : word ? "word" : sub ? "substring" : "fuzzy";
  return { product: toLocalProduct(hit), quality };
}

/** Löst einen Pseudo-Barcode "local:<slug>" auf ein lokales Produkt auf, oder null. */
export function getLocalFoodByBarcode(barcode) {
  if (!barcode || !barcode.startsWith("local:")) return null;
  const slug = barcode.slice("local:".length);
  const item = FOODS.find(f => f.slug === slug);
  return item ? toLocalProduct(item) : null;
}

function toLocalProduct(item) {
  return {
    barcode: `local:${item.slug}`,
    source: "local",
    name: item.name,
    brand: "",
    quantity: "",
    servingSize: item.servingG ? `${item.servingG}g` : "",
    nutriscoreGrade: null,
    ingredientsText: "",
    likelyUsLabel: false,
    per100: item.per100,
  };
}
