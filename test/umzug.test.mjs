// Der ganze Weg mit den ECHTEN Daten: alter localStorage-Klumpen -> IndexedDB ->
// Abgleich -> Server -> zweites Geraet -> zurueck in die Schreibweise der App.
import "fake-indexeddb/auto";
import fs from "node:fs";

const SICHERUNG = process.argv[2] || process.env.KETO_SICHERUNG;
if (!SICHERUNG) { console.log("  uebersprungen: Pfad zu einer Sicherung als Argument angeben"); process.exit(0); }
const roh = fs.readFileSync(SICHERUNG, "utf8");
const state = JSON.parse(roh);

// localStorage nachbilden, damit umzug.js den alten Zustand findet
const speicher = new Map([["keto-dashboard-v1", roh]]);
globalThis.localStorage = {
  getItem: k => (speicher.has(k) ? speicher.get(k) : null),
  setItem: (k, v) => speicher.set(k, String(v)),
  removeItem: k => speicher.delete(k),
};

const db = await import("../js/db.js");
const fake = await import("./supabase-fake.mjs");
const umzug = await import("../js/umzug.js");
const sync = await import("../js/sync2.js");
sync.setzeAnbindung({ rest: fake.rest, istAngemeldet: () => true });
const { fuege, nurLokales } = await import("../js/entities.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };
const H = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
fake.fremdesGeraetSchreibt("haushalt", { id: H });
await db.meta.setze("haushaltId", H);
const serverZeilen = (t) => [...(fake.tabellen.get(t)?.values() || [])];

console.log("\n1) Umzug aus dem localStorage");
const t0 = Date.now();
const { bilanz } = await umzug.umzugFallsNoetig({ serverHatSchonDaten: false });
console.log("  ", JSON.stringify(bilanz), `in ${Date.now() - t0} ms`);
ok("Profile", bilanz.profil === state.profiles.length);
ok("Mahlzeiten", bilanz.mahlzeit === state.consumption.length);
ok("Wasser", bilanz.wasser === state.water.length);
ok("Rezepte", bilanz.rezept === state.recipes.length);
ok("Listen", bilanz.listen_eintrag === state.favorites.length + state.noGo.length);
ok("Einkauf", bilanz.einkauf === state.shoppingList.length);
ok("Tagesziele", bilanz.tagesziel ===
   Object.values(state.dayTargets).reduce((s, t) => s + Object.keys(t).length, 0));
ok("alter Schluessel bleibt liegen", localStorage.getItem("keto-dashboard-v1") !== null);
ok("Marke gesetzt", await umzug.istUmgezogen());

console.log("\n2) Was nicht abgeglichen wird, liegt lokal");
ok("Verlauf lokal", (await db.lokal.lies("history"))?.length === state.history.length);
ok("Produkt-Cache lokal", Object.keys((await db.lokal.lies("cache")) || {}).length ===
   Object.keys(state.cache || {}).length, String(Object.keys((await db.lokal.lies("cache")) || {}).length));
ok("aktives Profil lokal", (await db.lokal.lies("activeProfileId")) === state.activeProfileId);
ok("Grabsteine wandern NICHT mit", (await db.lokal.lies("tombstones")) === null);

console.log("\n3) Zweiter Umzug macht nichts kaputt");
const nochmal = await umzug.umzugFallsNoetig({ serverHatSchonDaten: false });
ok("wird uebersprungen", nochmal.uebersprungen === "schon umgezogen", JSON.stringify(nochmal));
ok("Mahlzeiten unveraendert", (await db.werte("mahlzeit")).length === state.consumption.length);

console.log("\n4) Erster Abgleich: alles hoch");
const e1 = await sync.abgleichen();
console.log("  ", JSON.stringify(e1));
const gesamt = Object.values(bilanz).reduce((a, b) => a + b, 0);
ok(`alle ${gesamt} Zeilen gesendet`, e1.gesendet === gesamt, `${e1.gesendet} von ${gesamt}`);
ok("nichts verworfen", e1.verworfen === 0);
ok("Outbox leer", (await db.outboxAlle()).length === 0);
ok("Mahlzeiten auf dem Server", serverZeilen("mahlzeit").length === state.consumption.length);
ok("Rezepte auf dem Server", serverZeilen("kochbuch_rezepte").length === state.recipes.length);
ok("Favoriten auf dem Server", serverZeilen("listen_eintrag").length === state.favorites.length);

console.log("\n5) Nährwerte haben die Reise unbeschadet ueberstanden");
const summeApp = (feld) => Math.round(state.consumption.reduce((n, x) => n + (x[feld] || 0), 0) * 10) / 10;
const summeServer = (spalte) => Math.round(serverZeilen("mahlzeit").reduce((n, z) => n + (Number(z[spalte]) || 0), 0) * 10) / 10;
for (const [app, server] of [["kcal","kcal"],["netCarbs","netto_kh"],["fat","fett"],["protein","eiweiss"]]) {
  ok(`Summe ${app}: ${summeApp(app)}`, summeApp(app) === summeServer(server),
     `${summeApp(app)} != ${summeServer(server)}`);
}
ok("Wassermenge",
   state.water.reduce((n, x) => n + x.ml, 0) === serverZeilen("wasser").reduce((n, z) => n + z.ml, 0));

console.log("\n6) Zweiter Abgleich holt alles wieder und aendert nichts");
const e2 = await sync.abgleichen();
ok("nichts gesendet", e2.gesendet === 0, JSON.stringify(e2));
ok("Mahlzeiten lokal unveraendert", (await db.werte("mahlzeit")).length === state.consumption.length);
ok("Favoriten lokal unveraendert", (await db.werte("listen_eintrag")).length === state.favorites.length);

console.log("\n7) Frisches zweites Geraet holt sich alles vom Server");
await db.loescheAlles();
await db.meta.setze("haushaltId", H);
const e3 = await sync.abgleichen();
console.log("  ", JSON.stringify(e3));
ok("nichts hochgeladen", e3.gesendet === 0);
ok(`${gesamt} Zeilen heruntergeladen`, e3.neu === gesamt, `${e3.neu} von ${gesamt}`);

console.log("\n8) Aus den Zeilen wieder ein Zustand fuer die App");
const entitaeten = {};
for (const t of ["profil","mahlzeit","wasser","tagesziel","listen_eintrag","einkauf","produkt_korrektur","rezept"]) {
  entitaeten[t] = await db.werte(t);
}
const wieder = fuege(entitaeten, nurLokales(state));
const zaehle = (s) => ({
  profile: s.profiles.length, mahlzeiten: s.consumption.length, wasser: s.water.length,
  rezepte: s.recipes.length, favoriten: s.favorites.length, einkauf: s.shoppingList.length,
  eigene: Object.keys(s.ownProducts).length, schalter: Object.keys(s.fiberOverrides).length,
  tage: Object.values(s.dayTargets).reduce((n, t) => n + Object.keys(t).length, 0),
});
const vor = zaehle(state), nach = zaehle(wieder);
console.log("  vorher :", JSON.stringify(vor));
console.log("  nachher:", JSON.stringify(nach));
for (const k of Object.keys(vor)) ok(`Anzahl ${k}`, vor[k] === nach[k], `${vor[k]} -> ${nach[k]}`);
const s2 = (feld) => Math.round(wieder.consumption.reduce((n, x) => n + (x[feld] || 0), 0) * 10) / 10;
for (const feld of ["kcal","netCarbs","fat","protein"]) {
  ok(`Summe ${feld} nach der ganzen Reise`, summeApp(feld) === s2(feld), `${summeApp(feld)} -> ${s2(feld)}`);
}
const einTag = "2026-08-22";
const vorTag = state.consumption.filter(x => x.dateKey === einTag).length;
const nachTag = wieder.consumption.filter(x => x.dateKey === einTag).length;
ok(`Mahlzeiten am ${einTag}: ${vorTag}`, vorTag === nachTag, `${vorTag} -> ${nachTag}`);

console.log("\n9) Rezept-Mahlzeiten behalten ihre Zuordnung");
const rezeptEintraege = (s) => s.consumption.filter(x => String(x.barcode || "").startsWith("recipe:"));
ok("gleich viele", rezeptEintraege(state).length === rezeptEintraege(wieder).length,
   `${rezeptEintraege(state).length} -> ${rezeptEintraege(wieder).length}`);
ok("Portionen statt Gramm", rezeptEintraege(wieder).every(x => x.servings != null && x.grams === undefined));

console.log("\n10) Rezepte kennen jetzt ihre Kochbuch-id");
const mitServerId = wieder.recipes.filter(r => r.serverId);
ok("serverId vom Server uebernommen", mitServerId.length === wieder.recipes.length,
   `${mitServerId.length} von ${wieder.recipes.length}`);

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
