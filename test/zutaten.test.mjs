// Zutaten wandern mit dem Rezept — in beide Richtungen.
//
// Der Fall, der das ausgelöst hat: im Kochbuch wurde eine Zutat gelöscht, die Keto-App
// erfuhr davon nie. Der Server führt die Zutaten in einer eigenen Tabelle, die am
// zeilenweisen Abgleich (Zeiger über updated_at) nicht selbst teilnehmen kann — sie
// wandern deshalb als Teil des Rezepts mit, und wer den Rezeptkopf gewinnt, gewinnt
// seine Zutatenliste.
import "fake-indexeddb/auto";

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + (e ? " -> " + e : "")); fails++; } };

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: k => { mem.delete(k); },
};

const db = await import("../js/db.js");
const fake = await import("./supabase-fake.mjs");
const sync2 = await import("../js/sync2.js");
const { zutatenAusZeilen } = await import("../js/rows.js");
const { calcPerServing } = await import("../js/keto.js");
sync2.setzeAnbindung({ rest: fake.rest, istAngemeldet: () => true });

const H = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
fake.fremdesGeraetSchreibt("haushalt", { id: H });
await db.meta.setze("haushaltId", H);

const zutaten = (t) => [...(fake.tabellen.get("kochbuch_zutaten")?.values() || [])]
  .filter(z => !t || z.rezept_id === t);
const rezeptZeile = () => [...(fake.tabellen.get("kochbuch_rezepte")?.values() || [])][0];

const REZEPT = {
  id: "r1", name: "Vanilla Cheesecake", servings: 8, createdAt: 1000, updatedAt: 2000,
  ingredients: [
    { id: "z-quark", name: "Speisequark", grams: 150, per100: { kcal: 67, fat: 0.2, carbs: 4, fiber: 0, protein: 12 }, likelyUsLabel: false },
    { id: "z-sahne", name: "Schlagsahne", grams: 100, per100: { kcal: 292, fat: 30, carbs: 3.2, fiber: 0, protein: 2.4 }, likelyUsLabel: false },
    { id: "z-speck", name: "Speck", grams: 70, per100: { kcal: 386, fat: 30, carbs: 1, fiber: 0, protein: 26.4 }, likelyUsLabel: false },
  ],
};

const legeAn = async (rezept) => {
  await db.schreibe("rezept", [{ schluessel: rezept.id, wert: rezept }]);
  await db.outboxAnhaengen("rezept", rezept.id, "upsert");
};

// ---------------------------------------------------------------------------
console.log("\n1) Hochladen legt die Zutatenzeilen an");
await legeAn(REZEPT);
const e1 = await sync2.abgleichen();
ok("Rezept gesendet", e1.gesendet === 1, JSON.stringify(e1));
ok("drei Zutatenzeilen auf dem Server", zutaten().length === 3, String(zutaten().length));
ok("alle haengen am Rezept", zutaten().every(z => z.rezept_id === rezeptZeile().id));
ok("die ids der App sind erhalten",
   zutaten().map(z => z.id).sort().join(",") === "z-quark,z-sahne,z-speck",
   zutaten().map(z => z.id).sort().join(","));
ok("Reihenfolge als pos festgehalten",
   zutaten().sort((a, b) => a.pos - b.pos).map(z => z.name).join("|") === "Speisequark|Schlagsahne|Speck",
   zutaten().sort((a, b) => a.pos - b.pos).map(z => z.name).join("|"));
ok("Naehrwerte mitgewandert", zutaten().find(z => z.id === "z-sahne")?.per100?.kcal === 292);
// Aus dieser Spalte zeichnet das Kochbuch seine Kacheln. Fehlte sie, staende dort nichts.
const erwartet = calcPerServing(REZEPT);
ok("Rezeptzeile traegt die Naehrwerte je Portion",
   rezeptZeile()?.naehrwerte?.kcal === erwartet.kcal,
   JSON.stringify([rezeptZeile()?.naehrwerte, erwartet]));
ok("und zwar alle vier Werte",
   JSON.stringify(rezeptZeile()?.naehrwerte) === JSON.stringify(erwartet),
   JSON.stringify(rezeptZeile()?.naehrwerte));

console.log("\n2) Erneutes Hochladen legt nichts doppelt an");
await db.outboxAnhaengen("rezept", "r1", "upsert");
await sync2.abgleichen();
ok("immer noch drei Zeilen", zutaten().length === 3, String(zutaten().length));
ok("lokal immer noch drei Zutaten", (await db.werte("rezept"))[0].ingredients.length === 3);

console.log("\n3) Eine Zutat entfernen entfernt genau ihre Zeile");
const ohneSpeck = {
  ...(await db.werte("rezept"))[0],
  updatedAt: 3000,
  ingredients: (await db.werte("rezept"))[0].ingredients.filter(z => z.id !== "z-speck"),
};
await db.schreibe("rezept", [{ schluessel: "r1", wert: ohneSpeck }]);
await db.outboxAnhaengen("rezept", "r1", "upsert");
await sync2.abgleichen();
ok("nur noch zwei Zeilen", zutaten().length === 2, String(zutaten().length));
ok("und der Speck ist es, der fehlt", !zutaten().some(z => z.id === "z-speck"),
   zutaten().map(z => z.name).join(","));
ok("die anderen behalten ihre ids", zutaten().map(z => z.id).sort().join(",") === "z-quark,z-sahne");

console.log("\n4) Ein frisches Geraet bekommt das Rezept MIT Zutaten");
await db.loescheAlles();
await db.meta.setze("haushaltId", H);
const e4 = await sync2.abgleichen();
ok("heruntergeladen", e4.neu === 1, JSON.stringify(e4));
const geholt = (await db.werte("rezept"))[0];
ok("Rezept da", geholt?.name === "Vanilla Cheesecake");
ok("mit zwei Zutaten", geholt?.ingredients?.length === 2, JSON.stringify(geholt?.ingredients?.length));
ok("in der richtigen Reihenfolge",
   geholt.ingredients.map(z => z.name).join("|") === "Speisequark|Schlagsahne",
   geholt.ingredients.map(z => z.name).join("|"));
ok("mit Mengen", geholt.ingredients[0].grams === 150, String(geholt.ingredients[0].grams));
ok("mit Naehrwerten", geholt.ingredients[1].per100?.kcal === 292);
ok("mit denselben ids wie auf dem anderen Geraet",
   geholt.ingredients.map(z => z.id).join(",") === "z-quark,z-sahne",
   geholt.ingredients.map(z => z.id).join(","));

console.log("\n5) Der Fall von gestern: im Kochbuch geloescht, kommt in Keto an");
// Das Kochbuch nimmt eine Zutat aus der eigenen Tabelle und rührt den Kopf an.
fake.tabellen.get("kochbuch_zutaten").delete("z-sahne");
const kopf = rezeptZeile();
fake.fremdesGeraetSchreibt("kochbuch_rezepte", {
  ...kopf,
  // Das Kochbuch fasst keto_updated_at NICHT an — es hat ja nicht die Keto-App geändert.
  geaendert_am: new Date(Date.parse(kopf.geaendert_am) + 60000).toISOString(),
});
const e5 = await sync2.abgleichen();
ok("die Aenderung kam an", e5.neu === 1, JSON.stringify(e5));
const nachKochbuch = (await db.werte("rezept"))[0];
ok("nur noch eine Zutat in der Keto-App", nachKochbuch.ingredients.length === 1,
   JSON.stringify(nachKochbuch.ingredients.map(z => z.name)));
ok("und zwar der Quark", nachKochbuch.ingredients[0].name === "Speisequark");

console.log("\n6) Ein Rezept ohne keto_id (im Kochbuch entstanden) kommt NICHT als Bruchstueck an");
fake.fremdesGeraetSchreibt("kochbuch_rezepte", {
  id: "srv-nur-kochbuch", keto_id: null, haushalt_id: H, titel: "Nur im Kochbuch",
  portionen: 2, geaendert_am: new Date(9_000_000).toISOString(),
});
await sync2.abgleichen();
const alleRezepte = await db.werte("rezept");
ok("kein Rezept mit der id null", !alleRezepte.some(r => r.id == null || String(r.id) === "null"),
   JSON.stringify(alleRezepte.map(r => r.id)));
ok("das eigene Rezept ist unberuehrt", alleRezepte.length === 1 && alleRezepte[0].id === "r1",
   JSON.stringify(alleRezepte.map(r => r.id)));

console.log("\n7) Uebersetzung hin und zurueck verliert nichts");
const hin = (await import("../js/rows.js")).zutatenZuZeilen(REZEPT, "srv-x");
const zurueck = zutatenAusZeilen(hin);
ok("gleiche Anzahl", zurueck.length === REZEPT.ingredients.length);
ok("Feld fuer Feld gleich",
   JSON.stringify(zurueck) === JSON.stringify(REZEPT.ingredients),
   JSON.stringify(zurueck));

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
