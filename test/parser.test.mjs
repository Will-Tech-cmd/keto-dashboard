import { parseIngredientText } from "../js/ingredient-parser.js";

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };
const eine = (zeile) => parseIngredientText(zeile)[0] || null;

console.log("\nOCR-Aufzaehlungszeichen 'o' (das echte Rezept aus dem Kochbuch)");
for (const [zeile, name, gramm] of [
  ["o 150g Speisequark", "Speisequark", 150],
  ["o 50g Sahniger Frischkäse", "Sahniger Frischkäse", 50],
  ["o 115g Mandeln", "Mandeln", 115],
  ["O 200 g Sahne", "Sahne", 200],
]) {
  const e = eine(zeile);
  ok(`"${zeile}" -> ${gramm} g ${name}`, e && e.name === name && e.grams === gramm,
     e ? `${e.grams} g "${e.name}"` : "nicht erkannt");
}

console.log("\nDarf NICHT als Aufzaehlungszeichen gelten");
for (const [zeile, name] of [
  ["Olivenöl 20 g", "Olivenöl"],
  ["Oregano", "Oregano"],
  ["100 g Oliven", "Oliven"],
]) {
  const e = eine(zeile);
  ok(`"${zeile}" behaelt den Namen`, e && e.name === name, e ? `"${e.name}"` : "nicht erkannt");
}

console.log("\nBisheriges Verhalten unveraendert");
for (const [zeile, name, gramm] of [
  // "zuckerfreie" faellt als LEADING_DESCRIPTOR weg — so gewollt, wie bei "geriebene"/"frische".
  ["- 150g zuckerfreie Schokolade", "Schokolade", 150],
  ["4. -Eier", "Eier", null],
  ["• 2 EL Öl", "Öl", 30],
  ["150g Mandeln", "Mandeln", 150],
  ["Eier 100g", "Eier", 100],
  ["1 gehäufter EL Kakao", "Kakao", 15],
  ["1-2 TL Salz", "Salz", 5],
]) {
  const e = eine(zeile);
  ok(`"${zeile}" -> ${gramm} g ${name}`, e && e.name === name && e.grams === gramm,
     e ? `${e.grams} g "${e.name}"` : "nicht erkannt");
}

console.log("\nAbschnittsueberschriften weiter ueberspringen");
ok("'Zutaten:' wird verworfen", parseIngredientText("Zutaten:").length === 0);
ok("'o Boden:' wird verworfen", parseIngredientText("o Boden:").length === 0,
   JSON.stringify(parseIngredientText("o Boden:")));

// Auf TikTok und Instagram steht vor jeder Zutat ein Emoji. Die Texterkennung macht daraus
// Zeichensalat ("&)" aus einem Steak, "@®" aus einem Ei) — die Zeile fiel damit durch beide
// Mengen-Muster und landete samt Menge als Name in der Liste.
console.log("\nZeichensalat aus erkannten Emoji am Zeilenanfang");
for (const [zeile, name, gramm] of [
  ["&) 300g Rinderhack", "Rinderhack", 300],
  ["@® 6Eier", "Eier", null],
  ["&® 300g Eisbergsalat", "Eisbergsalat", 300],
  ["„60 g Cheddar", "Cheddar", 60],
  ["\u{1F969} 300 g Rinderhack", "Rinderhack", 300],
]) {
  const e = eine(zeile);
  ok(`"${zeile}" -> ${gramm ?? "?"} g ${name}`, e && e.name === name && e.grams === gramm,
     e ? `${e.grams} g "${e.name}"` : "nicht erkannt");
}
ok("eine Zeile aus lauter Sonderzeichen wird nicht zur Zutat",
   parseIngredientText("&)(/%$ ---").length === 0, JSON.stringify(parseIngredientText("&)(/%$ ---")));

console.log("\nKein exponentielles Zuruecksetzen bei langer Strichfolge");
const start = process.hrtime.bigint();
parseIngredientText("-".repeat(2000) + "x");
const ms = Number(process.hrtime.bigint() - start) / 1e6;
ok(`2000 Striche in ${ms.toFixed(1)} ms`, ms < 200, `${ms.toFixed(1)} ms`);

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
