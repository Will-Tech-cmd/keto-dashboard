import "fake-indexeddb/auto";
import fs from "node:fs";
const DB = await import("../js/db.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };

console.log("\n1) Oeffnen und Speicher anlegen");
ok("IndexedDB verfuegbar", DB.istVerfuegbar());
const db = await DB.oeffne();
const namen = [...db.objectStoreNames].sort();
ok("alle Speicher da", namen.join() ===
   ["einkauf","listen_eintrag","lokal","mahlzeit","meta","outbox","produkt_korrektur","profil","rezept","tagesziel","wasser"].sort().join(),
   namen.join());
ok("zweites Oeffnen liefert dieselbe Verbindung", (await DB.oeffne()) === db);

console.log("\n2) Schreiben und Lesen");
await DB.schreibe("mahlzeit", [
  { schluessel: "a", wert: { id: "a", name: "Butter", kcal: 149 } },
  { schluessel: "b", wert: { id: "b", name: "Ei", kcal: 78 } },
]);
const gelesen = await DB.alle("mahlzeit");
ok("zwei Zeilen zurueck", gelesen.length === 2, String(gelesen.length));
ok("Schluessel erhalten", gelesen.map(g => g.schluessel).sort().join() === "a,b");
ok("Werte erhalten", gelesen.find(g => g.schluessel === "b").wert.kcal === 78);
ok("werte() liefert nur die Werte", (await DB.werte("mahlzeit")).length === 2);

console.log("\n3) Aktualisieren und Entfernen");
await DB.schreibe("mahlzeit", [{ schluessel: "a", wert: { id: "a", name: "Butter", kcal: 200 } }]);
ok("ueberschreibt statt zu verdoppeln", (await DB.werte("mahlzeit")).length === 2);
ok("neuer Wert da", (await DB.alle("mahlzeit")).find(g => g.schluessel === "a").wert.kcal === 200);
await DB.entferne("mahlzeit", "a");
ok("entfernt", (await DB.werte("mahlzeit")).length === 1);
await DB.entferne("mahlzeit", []);           // darf nicht knallen
ok("leeres Entfernen ist harmlos", true);

console.log("\n4) ersetze() ist atomar");
await DB.schreibe("einkauf", [{ schluessel: "x", wert: { text: "alt" } }]);
await DB.ersetze("einkauf", [
  { schluessel: "y", wert: { text: "neu1" } },
  { schluessel: "z", wert: { text: "neu2" } },
]);
const eink = await DB.alle("einkauf");
ok("alter Inhalt weg, neuer da", eink.length === 2 && eink.every(e => e.schluessel !== "x"),
   JSON.stringify(eink.map(e => e.schluessel)));

console.log("\n5) lokal und meta");
await DB.lokal.setze("history", [{ id: 1 }, { id: 2 }]);
ok("lokal gelesen", (await DB.lokal.lies("history")).length === 2);
ok("lokal Ersatzwert", (await DB.lokal.lies("gibtsnicht", "leer")) === "leer");
ok("lokal null bleibt null", (await DB.lokal.lies("gibtsnicht")) === null);
await DB.meta.setze("stand:mahlzeit", "2026-08-24T00:00:00Z");
ok("meta gelesen", (await DB.meta.lies("stand:mahlzeit")) === "2026-08-24T00:00:00Z");
// false und 0 duerfen nicht als "fehlt" durchgehen
await DB.lokal.setze("onboarded", false);
ok("false wird nicht zum Ersatzwert", (await DB.lokal.lies("onboarded", true)) === false);
await DB.meta.setze("null-wert", 0);
ok("0 wird nicht zum Ersatzwert", (await DB.meta.lies("null-wert", 99)) === 0);

console.log("\n6) Outbox");
await DB.outboxAnhaengen("mahlzeit", "m1");
await DB.outboxAnhaengen("mahlzeit", "m2");
await DB.outboxAnhaengen("mahlzeit", "m1");           // dieselbe Zeile nochmal geaendert
await DB.outboxAnhaengen("einkauf", "e1", "loeschen");
const roh = await DB.outboxAlle();
ok("vier Auftraege", roh.length === 4, String(roh.length));
ok("fortlaufend nummeriert", roh.every(e => typeof e.nr === "number"));

const { auftraege, ueberholt } = DB.fasseZusammen(roh);
ok("zusammengefasst auf drei", auftraege.length === 3, String(auftraege.length));
ok("ein ueberholter Auftrag", ueberholt.length === 1, JSON.stringify(ueberholt));
ok("m1 nur einmal, und zwar der juengste",
   auftraege.filter(a => a.schluessel === "m1").length === 1 &&
   auftraege.find(a => a.schluessel === "m1").nr === Math.max(...roh.filter(e => e.schluessel === "m1").map(e => e.nr)));
ok("Loeschung bleibt Loeschung",
   auftraege.find(a => a.entitaet === "einkauf").art === "loeschen");

// Angelegt, dann geloescht -> muss als Loeschung enden, nicht als Anlage
await DB.outboxAnhaengen("wasser", "w9", "upsert");
await DB.outboxAnhaengen("wasser", "w9", "loeschen");
const z2 = DB.fasseZusammen(await DB.outboxAlle());
ok("angelegt+geloescht endet als Loeschung",
   z2.auftraege.find(a => a.schluessel === "w9").art === "loeschen");
// ... und andersherum: geloescht, dann neu angelegt
await DB.outboxAnhaengen("wasser", "w9", "upsert");
const z3 = DB.fasseZusammen(await DB.outboxAlle());
ok("geloescht+neu angelegt endet als Anlage",
   z3.auftraege.find(a => a.schluessel === "w9").art === "upsert");

// Anzahl ausrechnen statt raten: zwischen fasseZusammen() und hier sind noch
// Auftraege dazugekommen.
const vorEntfernen = (await DB.outboxAlle()).length;
await DB.outboxEntfernen(ueberholt);
const nachEntfernen = (await DB.outboxAlle()).length;
ok("ueberholte entfernt", nachEntfernen === vorEntfernen - ueberholt.length,
   `${vorEntfernen} - ${ueberholt.length} != ${nachEntfernen}`);

console.log("\n7) Menge: 500 Zeilen in einer Transaktion");
const viele = Array.from({ length: 500 }, (_, i) => ({ schluessel: "k" + i, wert: { i, text: "x".repeat(200) } }));
const t0 = Date.now();
await DB.schreibe("listen_eintrag", viele);
const dauer = Date.now() - t0;
ok(`500 Zeilen geschrieben (${dauer} ms)`, (await DB.werte("listen_eintrag")).length === 500);

console.log("\n8) Neu oeffnen: alles noch da");
(await DB.oeffne()).close();
// Modul neu laden, damit die zwischengespeicherte Verbindung weg ist
const DB2 = await import("../js/db.js?frisch=1");
ok("Einkauf ueberlebt", (await DB2.werte("einkauf")).length === 2);
ok("meta ueberlebt", (await DB2.meta.lies("stand:mahlzeit")) === "2026-08-24T00:00:00Z");
ok("Outbox ueberlebt", (await DB2.outboxAlle()).length === nachEntfernen,
   `${nachEntfernen} erwartet, ${(await DB2.outboxAlle()).length} gefunden`);

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
