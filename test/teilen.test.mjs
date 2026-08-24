// Einen Eintrag ans andere Profil weiterreichen.
//
// Der Kern ist eine Kopie, kein neues Ausrechnen: was bei ihm steht, steht auch bei ihr —
// und bleibt dort stehen, wenn sich am Produkt oder am Rezept später etwas ändert. Genau
// diese Eigenschaft wird hier festgehalten, weil sie beim Lesen des Codes nicht ins Auge
// springt und beim nächsten Umbau leicht verlorengeht.
import "./setup.mjs";
const { Store } = await import("../js/store.js");
const { otherProfiles, copyConsumptionTo, logConsumption } = await import("../js/consumption.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + (e ? " -> " + e : "")); fails++; } };

const profile = Store.get().profiles;
const ich = Store.getActiveProfile();
const sie = profile.find(p => p.id !== ich.id);

console.log("\n1) Wer kommt in Frage");
ok("zwei Profile im Standardzustand", profile.length === 2, String(profile.length));
ok("das andere ist nicht das aktive", otherProfiles().length === 1 && otherProfiles()[0].id === sie.id);

console.log("\n2) Die Kopie ist Wort fuer Wort dieselbe Mahlzeit");
const produkt = {
  barcode: "4001", name: "Butter", brand: "Kerrygold", servingSize: "10 g",
  per100: { kcal: 741, carbs: 0.6, fiber: 0, fat: 82, protein: 0.7 },
};
const eigen = logConsumption(produkt, 20, "breakfast");
const [kopie] = copyConsumptionTo(eigen, [sie.id]);
ok("eine Kopie entstanden", !!kopie);
ok("anderes Profil", kopie.profileId === sie.id);
ok("eigene id", kopie.id !== eigen.id);
for (const feld of ["name", "barcode", "grams", "servingG", "meal", "dateKey", "kcal", "netCarbs", "fat", "protein", "at"]) {
  ok(`${feld} gleich (${JSON.stringify(eigen[feld])})`, kopie[feld] === eigen[feld],
     `${JSON.stringify(eigen[feld])} != ${JSON.stringify(kopie[feld])}`);
}
ok("beide im Speicher", Store.getConsumption().filter(e => e.name === "Butter").length === 2);

console.log("\n3) Nichts wird neu gerechnet");
// Dasselbe Produkt mit anderen Werten: eine spaetere Korrektur am Produkt darf die
// bereits eingetragene Mahlzeit nicht ruehren — bei ihm nicht und bei ihr auch nicht.
const geaendert = { ...produkt, per100: { ...produkt.per100, kcal: 900 } };
const spaeter = logConsumption(geaendert, 20, "breakfast");
ok("der neue Eintrag rechnet mit den neuen Werten", spaeter.kcal === 180, String(spaeter.kcal));
ok("die alte Kopie bleibt bei den alten", Store.getConsumption().find(e => e.id === kopie.id).kcal === eigen.kcal,
   String(Store.getConsumption().find(e => e.id === kopie.id).kcal));

console.log("\n4) Kein Weiterreichen an sich selbst");
const nichts = copyConsumptionTo(eigen, [eigen.profileId]);
ok("erzeugt nichts", nichts.length === 0, JSON.stringify(nichts.length));
const leer = copyConsumptionTo(eigen, []);
ok("leere Liste erzeugt nichts", leer.length === 0);

console.log("\n5) updatedAt wandert nicht mit");
// Sonst gaelte die Kopie sofort als "nachtraeglich geaendert" und schluege beim Abgleich
// eine echte Aenderung des anderen Geraets.
const bearbeitet = { ...eigen, updatedAt: Date.now() };
const [k2] = copyConsumptionTo(bearbeitet, [sie.id]);
ok("die Kopie hat kein updatedAt", k2.updatedAt === undefined, String(k2.updatedAt));

console.log("\n6) Mehrere Ziele auf einmal");
Store.get().profiles.push({ ...sie, id: "drittes-profil", name: "Drittes" });
const mehrere = copyConsumptionTo(eigen, [sie.id, "drittes-profil"]);
ok("zwei Kopien", mehrere.length === 2, String(mehrere.length));
ok("verschiedene Profile", new Set(mehrere.map(k => k.profileId)).size === 2);
ok("verschiedene ids", new Set(mehrere.map(k => k.id)).size === 2);
ok("otherProfiles kennt jetzt zwei", otherProfiles().length === 2, String(otherProfiles().length));

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
