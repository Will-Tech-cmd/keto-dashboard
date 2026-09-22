// Prüft die abgeleiteten Warengruppen (js/kategorie.js).
//
// Die Fälle stammen nicht aus dem Kopf, sondern aus einem Durchlauf über 102 echte Favoriten.
// Jede Zeile hier ist eine Vertauschung, die dabei aufgefallen ist: Produktnamen nennen
// regelmäßig zwei Gruppen ("Thunfisch … in Sonnenblumenöl"), und dann entscheidet die
// Reihenfolge der Regeln. Ohne diese Beispiele ist jede Umsortierung ein Blindflug.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { kategorieFuer, KATEGORIEN, kategorienMitAnzahl, SONSTIGES } = await import("../js/kategorie.js");
const { FOODS } = await import("../js/foods-db.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };
const kat = (name, brand = "", barcode = "") => kategorieFuer({ name, brand, barcode });

console.log("\nDie eingebaute Tabelle entscheidet selbst");
ok("jeder Eintrag der Tabelle hat eine Kategorie", FOODS.every(f => f.kategorie), 
   FOODS.filter(f => !f.kategorie).map(f => f.name).join(", "));
ok("nur bekannte Kategorien", FOODS.every(f => KATEGORIEN.includes(f.kategorie)),
   [...new Set(FOODS.map(f => f.kategorie))].filter(k => !KATEGORIEN.includes(k)).join(", "));
ok("Butter ist Milch, nicht Fett", kat("Butter", "", "local:butter") === "Milch & Eier",
   kat("Butter", "", "local:butter"));
ok("Olivenöl ist Fett", kat("Olivenöl", "", "local:olivenoel") === "Fette & Saucen");
ok("Oregano ist Gewürz", kat("Oregano getrocknet", "", "local:oregano-getrocknet") === "Gewürze & Kräuter");
ok("die Tabelle schlägt den Namen", kat("Muskatnuss", "", "local:muskatnuss") === "Gewürze & Kräuter",
   kat("Muskatnuss", "", "local:muskatnuss"));

console.log("\nReihenfolge der Regeln — jede Zeile war einmal falsch");
for (const [name, brand, erwartet] of [
  ["Thunfisch Filets in Sonnenblumenöl", "Lidl, Nixe", "Fisch"],          // Fisch vor Fett
  ["Käse-Paprika Puten-Wiener", "Kaufland Classic", "Fleisch & Wurst"],   // Fleisch vor Käse
  ["Marzipan Sahne Liqueur", "Niederegger", "Getränke"],                  // Getränk vor Milch
  ["Ochsenbäckchen in Rotweinsauce", "REWE", "Fleisch & Wurst"],          // Fleisch vor Getränk
  ["Heringsfilet Eier/Senf", "Almare", "Fisch"],                          // Fisch vor Gewürz
  ["Spinat Rahm Blattspinat", "K-Classic", "Gemüse & Salat"],             // Gemüse vor Milch
  ["Rostmandeln (ohne Salz)", "Maryland", "Nüsse & Samen"],               // "ohne X" zählt nicht
  ["Wiener Würstchen", "Dulano", "Fleisch & Wurst"],                      // Umlaut in "Würstchen"
  ["Schinkenwürstchen", "Lidl Dulano", "Fleisch & Wurst"],
  ["Primitivo Rotwein", "Doppio Passo", "Getränke"],
  ["Räucherling, Schweinefilet, kalt geräuchert", "Radeberger", "Fleisch & Wurst"],
  ["Bio Kokos-Chips", "NaturGut Penny", "Nüsse & Samen"],
  ["Bavaria Blu - Der Sanfte", "Bergader", "Käse"],
  ["SOS SOIA", "Kikkoman", "Fette & Saucen"],
  ["Nudeln Slim", "Kajnok", "Backen & Ersatz"],
  ["Zucchini Nudeln", "", "Gemüse & Salat"],                              // Gemüse vor Ersatz
  ["Eisbergsalat", "Kaufland", "Gemüse & Salat"],
  ["Creme Fraiche", "Milprima", "Milch & Eier"],
]) {
  const ist = kat(name, brand);
  ok(`"${name}" -> ${erwartet}`, ist === erwartet, ist);
}

console.log("\nOhne Hinweis lieber unsortiert als falsch");
ok("Fantasiename -> Sonstiges", kat("Zzyzx Blubb", "Marke") === SONSTIGES, kat("Zzyzx Blubb", "Marke"));
ok("leerer Name -> Sonstiges", kat("") === SONSTIGES);

console.log("\nGruppieren zählt und behält die feste Reihenfolge");
const liste = [
  { name: "Gouda", barcode: "local:gouda" },
  { name: "Parmesan", barcode: "local:parmesan" },
  { name: "Bacon in Streifen", brand: "Ja!" },
];
const gruppen = kategorienMitAnzahl(liste);
ok("zwei Gruppen", gruppen.length === 2, JSON.stringify(gruppen));
ok("Fleisch steht vor Käse (feste Reihenfolge)", gruppen[0].kategorie === "Fleisch & Wurst", JSON.stringify(gruppen));
ok("Käse zählt 2", gruppen.find(g => g.kategorie === "Käse")?.anzahl === 2, JSON.stringify(gruppen));
ok("leere Gruppen fallen weg", !gruppen.some(g => g.anzahl === 0));

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : `\n${fails} Pruefung(en) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);
