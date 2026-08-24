// Die Verdrahtung: store.js auf der zeilenweisen Ablage.
//
// Geprüft wird das, was beim Umschalten schiefgehen könnte:
//   - der Start liest den alten Klumpen ein und zieht ihn um
//   - eine Eingabe schreibt GENAU ihre Zeile, nicht alles
//   - eine Löschung kommt als Löschung in der Outbox an
//   - nur-lokale Teile (Verlauf, Produkt-Cache) landen nicht im Abgleich
//   - ein Neustart findet alles wieder und meldet nichts doppelt an
//   - nach einem Abgleich zeigt die offene App den Stand des Servers
//   - Empfangenes löst keinen Rückversand aus (die alte Endlosschleife)
//   - der Schalter geht in beide Richtungen, ohne dass etwas verlorengeht
import "fake-indexeddb/auto";

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + (e ? " -> " + e : "")); fails++; } };
const flush = () => new Promise(r => setTimeout(r, 400)); // persist ist 250ms verzögert

// --- localStorage mit einem Bestand, wie ihn ein benutztes Gerät hat -------------------
const PROFIL = "11111111-1111-4111-8111-111111111111";
const bestand = {
  schemaVersion: 1,
  onboarded: true,
  profiles: [{
    id: PROFIL, name: "Wilhelm", sex: "male", age: 40, heightCm: 180, weightKg: 80,
    bodyFatPct: null, activity: 1.375, goal: "lose", deficitPct: 15, proteinFactor: 1.6,
    netCarbLimitG: 20, dietType: "keto", gradeThresholds: { green: 5, yellow: 10 },
    waterTargetMl: 2500, appearance: "system", ringStyle: "rings", updatedAt: 1000,
  }],
  activeProfileId: PROFIL,
  favorites: [{ barcode: "4001", name: "Butter", addedAt: 900, updatedAt: 900 }],
  noGo: [],
  shoppingList: [],
  ownProducts: {},
  cache: {},
  recent: [],
  history: [],
  consumption: [
    { id: "m1", profileId: PROFIL, dateKey: "2026-08-20", at: 1000, name: "Ei", barcode: "1", grams: 60, kcal: 90, netCarbs: 0.5, fat: 6, protein: 8, meal: "breakfast", servingG: null },
  ],
  water: [],
  dayTargets: {},
  fiberOverrides: {},
  fiberOverridesAt: {},
  recipes: [],
  tombstones: {},
};

const mem = new Map([
  ["keto-dashboard-v1", JSON.stringify(bestand)],
  ["keto-dashboard-zeilenmodus", "an"],
]);
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: k => { mem.delete(k); },
};

const db = await import("../js/db.js");
const fake = await import("./supabase-fake.mjs");
const sync2 = await import("../js/sync2.js");
sync2.setzeAnbindung({ rest: fake.rest, istAngemeldet: () => true });

const H = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
fake.fremdesGeraetSchreibt("haushalt", { id: H });
await db.meta.setze("haushaltId", H);

const store1 = await import("../js/store.js");
const { Store } = store1;

// Aufträge NICHT wegräumen, sondern mitzählen: was hier gelöscht würde, fehlte später beim
// Hochladen — und der Test prüfte am Ende einen Server, der nie etwas gesehen hat.
let marke = 0;
async function neueAuftraege() {
  const alle = await db.outboxAlle();
  const neue = alle.filter(e => e.nr > marke);
  marke = alle.reduce((m, e) => Math.max(m, e.nr), marke);
  return neue.map(e => `${e.entitaet}/${e.schluessel}/${e.art}`);
}
const serverZeilen = (t) => [...(fake.tabellen.get(t)?.values() || [])];

// ---------------------------------------------------------------------------
console.log("\n1) Start: Umzug aus dem Klumpen, danach liest die App aus der Ablage");
const start = await store1.bereit();
ok("Zeilenmodus aktiv", start.modus === "zeilen", JSON.stringify(start));
ok("istZeilenModus()", store1.istZeilenModus() === true);
ok("Profil da", Store.getActiveProfile()?.name === "Wilhelm");
ok("Mahlzeit da", Store.getConsumption().length === 1);
ok("Favorit da", Store.isInList("favorites", "4001"));
ok("Mahlzeit als Zeile in IndexedDB", (await db.werte("mahlzeit")).length === 1);
ok("alter Klumpen bleibt liegen", localStorage.getItem("keto-dashboard-v1") !== null);
const nachUmzug = await neueAuftraege();
ok("Umzug meldet Profil, Mahlzeit und Favorit an", nachUmzug.length === 3, JSON.stringify(nachUmzug));

console.log("\n2) Erster Abgleich: der Bestand geht hoch");
const e0 = await sync2.abgleichen();
ok("drei Zeilen gesendet", e0.gesendet === 3, JSON.stringify(e0));
ok("Outbox leer", (await db.outboxAlle()).length === 0);
marke = 0;
ok("Mahlzeit auf dem Server", serverZeilen("mahlzeit").length === 1);
ok("Favorit auf dem Server", serverZeilen("listen_eintrag").length === 1);

console.log("\n3) Eine Eingabe schreibt GENAU ihre Zeile");
Store.addWater({ id: "w1", profileId: PROFIL, dateKey: "2026-08-20", at: 2000, ml: 300 });
await flush();
let auftraege = await neueAuftraege();
ok("genau ein Auftrag", auftraege.length === 1, JSON.stringify(auftraege));
ok("und zwar der Wassereintrag", auftraege[0] === "wasser/w1/upsert", JSON.stringify(auftraege));
ok("Wasser in der Ablage", (await db.werte("wasser")).length === 1);
ok("Mahlzeit unberuehrt", (await db.werte("mahlzeit")).length === 1);

console.log("\n4) Aendern einer Mahlzeit betrifft nur diese Mahlzeit");
Store.updateConsumption({ ...Store.getConsumption()[0], grams: 120, kcal: 180 });
await flush();
auftraege = await neueAuftraege();
ok("genau ein Auftrag", auftraege.length === 1, JSON.stringify(auftraege));
ok("auf die Mahlzeit", auftraege[0] === "mahlzeit/m1/upsert", JSON.stringify(auftraege));
ok("neuer Wert in der Ablage", (await db.werte("mahlzeit"))[0].kcal === 180);

console.log("\n5) Loeschen wird als Loeschung gemeldet");
Store.removeConsumption("m1");
await flush();
auftraege = await neueAuftraege();
ok("als loeschen gemeldet", auftraege.length === 1 && auftraege[0] === "mahlzeit/m1/loeschen", JSON.stringify(auftraege));
ok("Zeile aus der Ablage raus", (await db.werte("mahlzeit")).length === 0);

console.log("\n6) Nur-Lokales bleibt lokal");
Store.cacheProduct("4001", { product_name: "Butter", nutriments: {} });
Store.addHistoryEntry({ id: "h1", barcode: "4001", name: "Butter", at: 3000 });
Store.pushRecent("4001");
await flush();
auftraege = await neueAuftraege();
ok("kein Abgleichs-Auftrag", auftraege.length === 0, JSON.stringify(auftraege));
ok("Produkt-Cache liegt lokal", Object.keys(await db.lokal.lies("cache", {})).length === 1);
ok("Verlauf liegt lokal", (await db.lokal.lies("history", [])).length === 1);
ok("zuletzt gescannt liegt lokal", (await db.lokal.lies("recent", [])).length === 1);

console.log("\n7) Ein zweiter Start findet alles wieder");
const offenVorNeustart = (await db.outboxAlle()).length;
const store2 = await import("../js/store.js?neustart=1");
await store2.bereit();
ok("Profil wieder da", store2.Store.getActiveProfile()?.name === "Wilhelm");
ok("Wassereintrag wieder da", store2.Store.getWater().length === 1);
ok("geloeschte Mahlzeit bleibt weg", store2.Store.getConsumption().length === 0);
ok("Favorit wieder da", store2.Store.isInList("favorites", "4001"));
ok("Produkt-Cache wieder da", store2.Store.getCachedProduct("4001")?.product_name === "Butter");
ok("Verlauf wieder da", store2.Store.getHistory().length === 1);
ok("Neustart meldet nichts zusaetzlich an", (await db.outboxAlle()).length === offenVorNeustart,
   `${offenVorNeustart} -> ${(await db.outboxAlle()).length}`);

console.log("\n8) Abgleich: das Offene geht hoch, Loeschung inklusive");
const e1 = await sync2.abgleichen();
ok("ein Upsert gesendet (Wasser)", e1.gesendet === 1, JSON.stringify(e1));
ok("eine Loeschung gesendet (Mahlzeit)", e1.geloescht === 1, JSON.stringify(e1));
ok("nichts verworfen", e1.verworfen === 0, JSON.stringify(e1));
ok("Outbox leer", (await db.outboxAlle()).length === 0);
ok("Wasser auf dem Server", serverZeilen("wasser").length === 1);
ok("Mahlzeit auf dem Server als geloescht", serverZeilen("mahlzeit")[0]?.geloescht_am != null);

console.log("\n9) Das andere Geraet traegt etwas ein — die offene App zeigt es");
fake.fremdesGeraetSchreibt("wasser", {
  id: "w2", haushalt_id: H, profil_id: PROFIL, datum: "2026-08-21",
  zeitpunkt: new Date(4000).toISOString(), ml: 500, geaendert_am: new Date(4000).toISOString(),
});
const e2 = await sync2.abgleichen();
ok("heruntergeladen", e2.neu >= 1, JSON.stringify(e2));
ok("vor dem Neuladen kennt die App es noch nicht", store2.Store.getWater().length === 1);
const geladen = await store2.neuLadenAusAblage();
ok("neu geladen", geladen === true);
ok("jetzt zwei Wassereintraege", store2.Store.getWater().length === 2,
   JSON.stringify(store2.Store.getWater().map(w => w.id)));
ok("Menge des fremden Eintrags stimmt", store2.Store.getWater().find(w => w.id === "w2")?.ml === 500);

console.log("\n10) Empfangenes loest keinen Rueckversand aus (die alte Endlosschleife)");
await flush();
ok("kein Auftrag durchs Neuladen", (await db.outboxAlle()).length === 0,
   JSON.stringify(await neueAuftraege()));
const e3 = await sync2.abgleichen();
ok("naechster Abgleich sendet nichts", e3.gesendet === 0 && e3.geloescht === 0, JSON.stringify(e3));
await store2.neuLadenAusAblage();
await flush();
ok("und danach immer noch nichts", (await db.outboxAlle()).length === 0);

console.log("\n11) Zurueck auf den bisherigen Speicher — nichts geht verloren");
store2.Store.addShoppingItem("Sahne");
await flush();
await store2.wechsleModus(false);
const klumpen = JSON.parse(localStorage.getItem("keto-dashboard-v1"));
ok("Schalter steht auf aus", localStorage.getItem("keto-dashboard-zeilenmodus") === null);
ok("Einkaufszettel im Klumpen", klumpen.shoppingList.some(i => i.text === "Sahne"));
ok("beide Wassereintraege im Klumpen", klumpen.water.length === 2, String(klumpen.water.length));
ok("Profil im Klumpen", klumpen.profiles[0].name === "Wilhelm");
ok("Produkt-Cache im Klumpen", Object.keys(klumpen.cache).length === 1);
ok("Verlauf im Klumpen", klumpen.history.length === 1);

console.log("\n12) Und wieder zurueck auf den neuen — ebenfalls vollstaendig");
await store2.wechsleModus(true);
ok("Schalter steht auf an", localStorage.getItem("keto-dashboard-zeilenmodus") === "an");
const store3 = await import("../js/store.js?neustart=2");
await store3.bereit();
ok("Zeilenmodus aktiv", store3.istZeilenModus() === true);
ok("Einkaufszettel da", store3.Store.get().shoppingList.some(i => i.text === "Sahne"));
ok("beide Wassereintraege da", store3.Store.getWater().length === 2);
ok("Produkt-Cache da", store3.Store.getCachedProduct("4001")?.product_name === "Butter");
ok("alles zum Hochladen angemeldet", (await db.outboxAlle()).length > 0);

console.log("\n13) Und der Abgleich danach findet keinen Streit");
const e4 = await sync2.abgleichen();
ok("nichts verworfen", e4.verworfen === 0, JSON.stringify(e4));
ok("Server kennt beide Wassereintraege", serverZeilen("wasser").filter(z => !z.geloescht_am).length === 2,
   JSON.stringify(serverZeilen("wasser").map(z => z.id)));
ok("Server kennt den Einkaufszettel", serverZeilen("einkauf").length === 1);

console.log("\n13b) Ein Rezept behaelt seine Zutaten ueber den Abgleich");
// Der Server kennt nur Titel, Portionen und Zeitstempel eines Rezepts — die Zutaten liegen
// in einer eigenen Tabelle, die am zeilenweisen Abgleich nicht teilnimmt. Ohne besondere
// Behandlung ueberschriebe die zurueckkommende Serverzeile das lokale Rezept und alle
// Zutaten waeren weg. Genau das ist hier passiert, bevor rows.js `teilweise` bekam.
store3.Store.saveRecipe({
  id: "r-zutaten", name: "Cheesecake", servings: 8, createdAt: 5000, updatedAt: 6000,
  notes: "Ofen 160 Grad",
  ingredients: [
    { name: "Frischkaese", grams: 400, per100: { kcal: 250, netCarbs: 3, fat: 24, protein: 6 } },
    { name: "Ei", grams: 120, per100: { kcal: 140, netCarbs: 1, fat: 10, protein: 12 } },
  ],
});
await flush();
await sync2.abgleichen();
await store3.neuLadenAusAblage();
const r = store3.Store.getRecipe("r-zutaten");
ok("Rezept noch da", !!r);
ok("Zutaten ueberleben das Hochladen", r?.ingredients?.length === 2,
   JSON.stringify(r?.ingredients?.length));
ok("Notiz ueberlebt", r?.notes === "Ofen 160 Grad", String(r?.notes));
ok("createdAt ueberlebt", r?.createdAt === 5000, String(r?.createdAt));
ok("und die id vom Server kam dazu", !!r?.serverId, String(r?.serverId));
ok("Titel und Portionen vom Server", r?.name === "Cheesecake" && r?.servings === 8);
ok("jede Zutat hat jetzt eine id", r?.ingredients?.every(z => !!z.id),
   JSON.stringify(r?.ingredients?.map(z => z.id)));

// Der Rueckweg (Server -> App) muss dasselbe ergeben, was hier stand. Tut er das nicht,
// sieht der Vergleich in ablage.js bei JEDEM Abgleich eine Aenderung, meldet sie in die
// Outbox, laedt sie hoch, bekommt sie wieder anders zurueck — und die App synchronisiert
// im Kreis, ohne dass jemand etwas eingetragen hat. Genau die Schleife, die schon einmal da war.
console.log("\n13c) Der Rundlauf beruhigt sich");
await flush();
const offenNachRundlauf = (await db.outboxAlle()).length;
const eRuhe1 = await sync2.abgleichen();
await store3.neuLadenAusAblage();
await flush();
const eRuhe2 = await sync2.abgleichen();
await store3.neuLadenAusAblage();
await flush();
ok("zweiter Durchlauf sendet nichts", eRuhe2.gesendet === 0 && eRuhe2.geloescht === 0,
   JSON.stringify(eRuhe2));
ok("Outbox bleibt leer", (await db.outboxAlle()).length === 0,
   JSON.stringify((await db.outboxAlle()).map(e => e.entitaet + "/" + e.art)));
ok("Zutaten immer noch vollstaendig",
   store3.Store.getRecipe("r-zutaten")?.ingredients?.length === 2,
   String(store3.Store.getRecipe("r-zutaten")?.ingredients?.length));
ok("und unveraendert",
   store3.Store.getRecipe("r-zutaten")?.ingredients?.map(z => z.name).join("|") === "Frischkaese|Ei",
   store3.Store.getRecipe("r-zutaten")?.ingredients?.map(z => z.name).join("|"));

console.log("\n14) Frisches Geraet, dessen Ablage der Abgleich vor dem Start gefuellt hat");
// Der gefaehrliche Fall: der Umzugsvermerk fehlt (nie umgezogen), aber es stehen schon
// Zeilen da. Wuerde jetzt umgezogen, raeumte ersetze() genau die wieder weg.
await db.loescheAlles();
await db.meta.setze("haushaltId", H);
mem.delete("keto-dashboard-v1");            // wirklich frisch: kein alter Klumpen
localStorage.setItem("keto-dashboard-zeilenmodus", "an");
const e5 = await sync2.abgleichen();
ok("alles vom Server geholt", e5.neu > 0, JSON.stringify(e5));
const store4 = await import("../js/store.js?neustart=3");
await store4.bereit();
ok("Zeilenmodus aktiv", store4.istZeilenModus() === true);
ok("Profil vom Server, nicht die Vorgabe", store4.Store.getActiveProfile()?.name === "Wilhelm",
   store4.Store.getActiveProfile()?.name);
ok("nur EIN Profil (keine Vorgabeprofile dazu)", store4.Store.get().profiles.length === 1,
   String(store4.Store.get().profiles.length));
ok("beide Wassereintraege ueberleben den Start", store4.Store.getWater().length === 2,
   String(store4.Store.getWater().length));
ok("Einkaufszettel ueberlebt den Start", store4.Store.get().shoppingList.length === 1);
ok("nichts faelschlich zum Hochladen angemeldet", (await db.outboxAlle()).length === 0,
   JSON.stringify((await db.outboxAlle()).map(e => e.entitaet + "/" + e.art)));

console.log("\n15) Frisches Geraet ganz ohne Server: Vorgabeprofile bleiben zuhause");
await db.loescheAlles();
sync2.setzeAnbindung({ rest: async () => [], istAngemeldet: () => true });
const store5 = await import("../js/store.js?neustart=4");
await store5.bereit();
ok("Vorgabeprofile stehen bereit", store5.Store.get().profiles.length === 2,
   String(store5.Store.get().profiles.length));
ok("aber nichts davon wird angemeldet", (await db.outboxAlle()).length === 0,
   JSON.stringify((await db.outboxAlle()).map(e => e.entitaet + "/" + e.art)));
store5.Store.setOnboarded();
store5.Store.updateProfile(store5.Store.get().profiles[0].id, { name: "Sandra" });
await flush();
const angemeldet = (await db.outboxAlle()).map(e => e.entitaet + "/" + e.art);
ok("erst die Einrichtung meldet ein Profil an",
   angemeldet.length === 1 && angemeldet[0] === "profil/upsert", JSON.stringify(angemeldet));

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
