// Prueft die neue Nährwert-Rechnung gegen die ECHTEN Zeilen des Vanilla Cheesecake
// aus kochbuch_zutaten — dieselben Zahlen, die Postgres oben ausgerechnet hat.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { calcPerServingFromZutaten, calcPerServingNutrition } = await import("../kochbuch/js/keto-bridge.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };

const zutaten = [
  { name: "o 150g Speisequark",        gramm: 1,   per100: { fat: 11,   kcal: 176, carbs: 3.4, fiber: 0,    protein: 12 } },
  { name: "o 50g Sahniger Frischkäse", gramm: 50,  per100: { fat: 34,   kcal: 342, carbs: 3,   fiber: 0,    protein: 5 } },
  { name: "o _15g Leinsamen (oder",    gramm: 15,  per100: { fat: 42,   kcal: 534, carbs: 1.6, fiber: 27.3, protein: 18 } },
  { name: "o 115g Mandeln",            gramm: 115, per100: { fat: 49.9, kcal: 579, carbs: 9.3, fiber: 12.5, protein: 21.2 } },
];

const n = calcPerServingFromZutaten(zutaten, 1);
console.log("\nVanilla Cheesecake, 4 Zutaten, 1 Portion");
console.log("  berechnet:", JSON.stringify(n));
ok("kcal 918.7 (wie Postgres und wie die Keto-App)", n.kcal === 918.7, String(n.kcal));
ok("Fett 80.8",    n.fat === 80.8,       String(n.fat));
ok("Eiweiß 29.7",  n.protein === 29.7,   String(n.protein));
ok("Netto-KH 12.5", n.netCarbs === 12.5, String(n.netCarbs));

console.log("\nPortionen werden geteilt");
const zwei = calcPerServingFromZutaten(zutaten, 2);
ok("2 Portionen -> halbe Werte", zwei.kcal === 459.4, String(zwei.kcal));
ok("0 Portionen faellt auf 1 zurueck", calcPerServingFromZutaten(zutaten, 0).kcal === 918.7);
ok("null Portionen faellt auf 1 zurueck", calcPerServingFromZutaten(zutaten, null).kcal === 918.7);

console.log("\nRandfaelle");
ok("leere Liste -> 0", calcPerServingFromZutaten([], 1).kcal === 0);
ok("undefined -> 0", calcPerServingFromZutaten(undefined, 1).kcal === 0);
// 115 g x 579/100 = 665,85 -> Math.round(665.85*10)/10 ergibt in Gleitkomma 665.8.
// Erwartung an der Rechnung ausgerichtet, nicht am Kopfrechnen.
ok("Zutat ohne per100 wird uebersprungen",
   calcPerServingFromZutaten([{ gramm: 100, per100: null }, zutaten[3]], 1).kcal === 665.8,
   String(calcPerServingFromZutaten([{ gramm: 100, per100: null }, zutaten[3]], 1).kcal));
ok("Zutat ohne Menge zaehlt 0",
   calcPerServingFromZutaten([{ gramm: null, per100: { kcal: 500 } }], 1).kcal === 0);
ok("gramm als Text ('115') wird gerechnet",
   calcPerServingFromZutaten([{ gramm: "115", per100: { kcal: 579 } }], 1).kcal === 665.8,
   String(calcPerServingFromZutaten([{ gramm: "115", per100: { kcal: 579 } }], 1).kcal));

console.log("\nUS-Etikett: Ballaststoffe abziehen");
const eu = calcPerServingFromZutaten([{ gramm: 100, per100: { carbs: 30, fiber: 10, kcal: 0 } }], 1);
const us = calcPerServingFromZutaten([{ gramm: 100, per100: { carbs: 30, fiber: 10, kcal: 0 }, likely_us_label: true }], 1);
ok("EU: 30 g KH bleiben 30", eu.netCarbs === 30, String(eu.netCarbs));
ok("US: 30 - 10 = 20", us.netCarbs === 20, String(us.netCarbs));

console.log("\nBeide Eingangsformate liefern dasselbe");
const alsKetoRezept = {
  servings: 1,
  ingredients: zutaten.map(z => ({ grams: z.gramm, per100: z.per100, likelyUsLabel: false })),
};
ok("calcPerServingNutrition == calcPerServingFromZutaten",
   JSON.stringify(calcPerServingNutrition(alsKetoRezept)) === JSON.stringify(n));

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
