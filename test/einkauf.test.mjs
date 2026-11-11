// Rezept → Einkaufsliste mit Menge.
//
// Was hier festgehalten wird: 2× kochen verdoppelt die Mengen, eine Zutat mit Stückzahl
// kommt als Stück (nicht als Gramm) an, dieselbe Zutat aus zwei Rezepten wird zu EINER
// Zeile mit der Summe, Erledigtes zählt dabei nicht, und die Menge überlebt die Rundreise
// über die Server-Zeile (rows.js). Dazu: Stückzahl im Mengentext der Kochbuch-Zutat.
import "./setup.mjs";
const { Store } = await import("../js/store.js");
const { zutatenFuerEinkauf, mengeText, fuegeZusammen } = await import("../js/einkauf.js");
const { ENTITAETEN, zutatenZuZeilen, zutatenAusZeilen, stueckAus } = await import("../js/rows.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + (e ? " -> " + e : "")); fails++; } };

const rezept = {
  id: "r1", name: "Burger-Brötchen", servings: 4,
  ingredients: [
    { id: "a", name: "Eier", grams: 232, stueck: 4, per100: { kcal: 155 } },
    { id: "b", name: "Flohsamenschalen", grams: 40, per100: { kcal: 20 } },
    { id: "c", name: "Salz", grams: null, per100: null },
  ],
};

console.log("\n1) Posten aus dem Rezept");
let p = zutatenFuerEinkauf(rezept, 1);
ok("drei Posten", p.length === 3);
ok("Eier als Stück, nicht als Gramm", p[0].menge === 4 && p[0].einheit === "Stk", JSON.stringify(p[0]));
ok("Flohsamenschalen in Gramm", p[1].menge === 40 && p[1].einheit === "g");
ok("Salz ohne Menge", p[2].menge === null && p[2].einheit === null);
p = zutatenFuerEinkauf(rezept, 2);
ok("2× verdoppelt Stück", p[0].menge === 8);
ok("2× verdoppelt Gramm", p[1].menge === 80);
ok("Faktor 0 fällt auf 1 zurück", zutatenFuerEinkauf(rezept, 0)[1].menge === 40);

console.log("\n2) Anzeige");
ok("600 g", mengeText(600, "g") === "600 g", mengeText(600, "g"));
ok("1,2 kg ab 1000 g", mengeText(1200, "g") === "1,2 kg", mengeText(1200, "g"));
ok("4 Stk", mengeText(4, "Stk") === "4 Stk");
ok("Komma bei halben Stück", mengeText(1.5, "Stk") === "1,5 Stk", mengeText(1.5, "Stk"));
ok("leer ohne Menge", mengeText(null, null) === "" && mengeText(0, "g") === "");

console.log("\n3) Zusammenführen mit der Liste");
const liste = [
  { id: "1", text: "Eier", checked: false, menge: 6, einheit: "Stk" },
  { id: "2", text: "Butter", checked: true, menge: 250, einheit: "g" },
  { id: "3", text: "Sahne", checked: false, menge: null, einheit: null },
];
let e = fuegeZusammen(liste, { text: "eier", menge: 4, einheit: "Stk" });
ok("gleiche Zutat (Groß/Klein egal) wird addiert", e.aktion === "ergaenzt" && e.menge === 10, JSON.stringify(e));
e = fuegeZusammen(liste, { text: "Butter", menge: 100, einheit: "g" });
ok("erledigte Zeile zählt nicht → neu", e.aktion === "neu");
e = fuegeZusammen(liste, { text: "Sahne", menge: 200, einheit: "g" });
ok("offene Zeile ohne Menge bekommt die Menge", e.aktion === "ergaenzt" && e.menge === 200 && e.einheit === "g");
e = fuegeZusammen(liste, { text: "Eier", menge: 100, einheit: "g" });
ok("andere Einheit lässt sich nicht addieren → neu", e.aktion === "neu");
e = fuegeZusammen(liste, { text: "Sahne", menge: null, einheit: null });
ok("ohne Menge und schon drauf → vorhanden", e.aktion === "vorhanden");

console.log("\n4) Über den Store");
Store.addShoppingItem("Rinderhack");
ok("Handeintrag ohne Menge", Store.get().shoppingList[0].menge === null);
let a = Store.addShoppingPosten({ text: "Rinderhack", menge: 300, einheit: "g" });
ok("ergänzt die offene Zeile", a === "ergaenzt" && Store.get().shoppingList[0].menge === 300);
a = Store.addShoppingPosten({ text: "Rinderhack", menge: 300, einheit: "g" });
ok("zweites Rezept → 600 g, immer noch eine Zeile", a === "ergaenzt"
  && Store.get().shoppingList.filter(i => i.text === "Rinderhack").length === 1
  && Store.get().shoppingList[0].menge === 600);
const vorher = Store.get().shoppingList[0].updatedAt;
await new Promise(r => setTimeout(r, 5));
Store.addShoppingPosten({ text: "Rinderhack", menge: 100, einheit: "g" });
ok("Zeitstempel rückt vor (sonst verliert die Summe beim Abgleich)", Store.get().shoppingList[0].updatedAt >= vorher);
a = Store.addShoppingPosten({ text: "Eier", menge: 4, einheit: "Stk" });
ok("neue Zutat → neue Zeile mit Stück", a === "neu" && Store.get().shoppingList[0].einheit === "Stk");

console.log("\n5) Rundreise der Einkaufszeile über den Server");
const ctx = { haushaltId: "h" };
const zeile = ENTITAETEN.einkauf.zuZeile({ id: "x", text: "Eier", checked: false, menge: 4, einheit: "Stk", updatedAt: 1700000000000 }, ctx);
ok("Zeile trägt menge + einheit", zeile.menge === 4 && zeile.einheit === "Stk");
const zurueck = ENTITAETEN.einkauf.ausZeile({ ...zeile, erledigt: false, geaendert_am: "2023-11-14T22:13:20.000Z" });
ok("und zurück", zurueck.menge === 4 && zurueck.einheit === "Stk");
const ohne = ENTITAETEN.einkauf.zuZeile({ id: "y", text: "Salz", checked: false, updatedAt: 1 }, ctx);
ok("ohne Menge: beide Spalten leer", ohne.menge === null && ohne.einheit === null);
const halb = ENTITAETEN.einkauf.zuZeile({ id: "z", text: "Mehl", checked: false, menge: 5, einheit: null, updatedAt: 1 }, ctx);
ok("Zahl ohne Einheit wird nicht gespeichert", halb.menge === null);

console.log("\n6) Stückzahl der Rezeptzutat im Mengentext");
const z = zutatenZuZeilen(rezept, "srv");
ok("4 Eier → mengentext '4 Stk'", z[0].mengentext === "4 Stk", z[0].mengentext);
ok("ohne Stück kein Mengentext", z[1].mengentext === null);
const r = zutatenAusZeilen(z);
ok("kommt als stueck zurück", r[0].stueck === 4);
ok("ohne Stück kein Feld", !("stueck" in r[1]));
ok("stueckAus versteht Varianten", stueckAus("2 Stück") === 2 && stueckAus("1,5 St.") === 1.5 && stueckAus("200 g") === null);

console.log(fails ? `\n${fails} fehlgeschlagen.` : "\nAlles bestanden.");
process.exit(fails ? 1 : 0);
