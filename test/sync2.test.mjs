import "fake-indexeddb/auto";
const db = await import("../js/db.js");
const fake = await import("./supabase-fake.mjs");
const sync = await import("../js/sync2.js");
sync.setzeAnbindung({ rest: fake.rest, istAngemeldet: () => true });

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };
const H = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const P = "11111111-1111-1111-1111-111111111111";

async function frisch() {
  fake.zuruecksetzen();
  await db.loescheAlles();
  fake.fremdesGeraetSchreibt("haushalt", { id: H });
  await db.meta.setze("haushaltId", H);
}

// Zeile lokal anlegen wie store.js es tun wird: schreiben + Auftrag in die Outbox
async function lokalAnlegen(entitaet, schluessel, wert) {
  await db.schreibe(entitaet, [{ schluessel, wert }]);
  await db.outboxAnhaengen(entitaet, schluessel, "upsert");
}
async function lokalLoeschen(entitaet, schluessel) {
  await db.entferne(entitaet, schluessel);
  await db.outboxAnhaengen(entitaet, schluessel, "loeschen");
}
const serverZeilen = (t) => [...(fake.tabellen.get(t)?.values() || [])];

// ---------------------------------------------------------------------------
console.log("\n1) Hochladen: was in der Outbox steht, landet auf dem Server");
await frisch();
await lokalAnlegen("profil", P, { id: P, name: "Wilhelm", sex: "male", age: 37, updatedAt: 1000 });
await lokalAnlegen("mahlzeit", "m1", { id: "m1", profileId: P, dateKey: "2026-08-24",
  name: "Butter", grams: 20, kcal: 149, meal: "breakfast", at: 2000 });
await lokalAnlegen("wasser", "w1", { id: "w1", profileId: P, dateKey: "2026-08-24", ml: 500, at: 2100 });
let e = await sync.abgleichen();
ok("zwei plus ein Profil gesendet", e.gesendet === 3, JSON.stringify(e));
ok("Profil auf dem Server", serverZeilen("profil").length === 1);
ok("Mahlzeit auf dem Server", serverZeilen("mahlzeit")[0].name === "Butter");
ok("Gramm richtig uebersetzt", serverZeilen("mahlzeit")[0].gramm === 20);
ok("Profil-Fremdschluessel gesetzt", serverZeilen("mahlzeit")[0].profil_id === P);
ok("Outbox leer", (await db.outboxAlle()).length === 0);

console.log("\n2) Profile werden VOR den Mahlzeiten gesendet");
const reihenfolge = fake.verlauf.filter(v => v.methode === "POST").map(v => v.name);
ok("profil vor mahlzeit", reihenfolge.indexOf("profil") < reihenfolge.indexOf("mahlzeit"),
   reihenfolge.join(" -> "));

console.log("\n3) Zweiter Durchlauf ohne Aenderung schickt nichts");
const vorher = fake.verlauf.length;
e = await sync.abgleichen();
ok("nichts gesendet", e.gesendet === 0 && e.geloescht === 0, JSON.stringify(e));
ok("nur Leseanfragen", fake.verlauf.slice(vorher).every(v => v.methode === "GET"));

console.log("\n4) Herunterladen: was das andere Geraet geschrieben hat");
fake.fremdesGeraetSchreibt("mahlzeit", {
  id: "m2", haushalt_id: H, profil_id: P, datum: "2026-08-24", mahlzeit: "lunch",
  name: "Ei", gramm: 60, portionen: null, kcal: 78, netto_kh: 0.3, fett: 5, eiweiss: 7,
  erfasst_am: new Date(3000).toISOString(), geaendert_am: new Date(3000).toISOString(),
});
e = await sync.abgleichen();
const lokal = await db.alle("mahlzeit");
ok("jetzt zwei Mahlzeiten lokal", lokal.length === 2, String(lokal.length));
const m2 = lokal.find(x => x.schluessel === "m2").wert;
ok("in App-Schreibweise zurueckuebersetzt", m2.grams === 60 && m2.profileId === P && m2.meal === "lunch",
   JSON.stringify(m2));
ok("keine Portionen erfunden", m2.servings === undefined, JSON.stringify(m2));

console.log("\n5) Loeschen wandert als geloescht_am hoch und kommt als Entfernung zurueck");
await lokalLoeschen("mahlzeit", "m1");
e = await sync.abgleichen();
ok("eine Loeschung gesendet", e.geloescht === 1, JSON.stringify(e));
const serverM1 = serverZeilen("mahlzeit").find(z => z.id === "m1");
ok("Server hat geloescht_am gesetzt", !!serverM1.geloescht_am);
ok("Zeile bleibt auf dem Server stehen", !!serverM1);
ok("lokal weg", (await db.alle("mahlzeit")).length === 1);

console.log("\n6) Ein zweites Geraet erfaehrt von der Loeschung");
await db.meta.setze("stand:mahlzeit", "1970-01-01T00:00:00Z");   // wie ein frisches Geraet
await db.schreibe("mahlzeit", [{ schluessel: "m1", wert: { id: "m1", name: "wieder da" } }]);
e = await sync.abgleichen();
ok("geloeschte Zeile wird lokal entfernt",
   !(await db.alle("mahlzeit")).some(x => x.schluessel === "m1"),
   JSON.stringify((await db.alle("mahlzeit")).map(x => x.schluessel)));

console.log("\n7) Eigene ungesendete Aenderung wird nicht ueberschrieben");
await frisch();
await lokalAnlegen("einkauf", "e1", { id: "e1", text: "Milch", checked: false, updatedAt: 5000 });
await sync.abgleichen();
// Das andere Geraet aendert dieselbe Zeile ...
fake.fremdesGeraetSchreibt("einkauf", {
  id: "e1", haushalt_id: H, text: "Sahne", erledigt: false,
  geaendert_am: new Date(6000).toISOString(),
});
// ... und hier wird sie gleichzeitig bearbeitet, aber noch nicht gesendet
await db.schreibe("einkauf", [{ schluessel: "e1", wert: { id: "e1", text: "Butter", checked: true, updatedAt: 7000 } }]);
await db.outboxAnhaengen("einkauf", "e1", "upsert");
await sync.abgleichen();
const e1 = (await db.alle("einkauf")).find(x => x.schluessel === "e1").wert;
ok("die eigene, neuere Fassung gewinnt", e1.text === "Butter", JSON.stringify(e1));
ok("und steht auch auf dem Server", serverZeilen("einkauf")[0].text === "Butter",
   JSON.stringify(serverZeilen("einkauf")[0]));

console.log("\n8) Waechter-Trigger: ein veralteter Stand wird abgewiesen");
await frisch();
await lokalAnlegen("einkauf", "e2", { id: "e2", text: "aktuell", checked: false, updatedAt: 9000 });
await sync.abgleichen();
// Geraet, das lange offline war, schickt seinen alten Stand
await db.schreibe("einkauf", [{ schluessel: "e2", wert: { id: "e2", text: "uralt", checked: false, updatedAt: 100 } }]);
await db.outboxAnhaengen("einkauf", "e2", "upsert");
await sync.abgleichen();
ok("Server behaelt die neuere Fassung", serverZeilen("einkauf")[0].text === "aktuell",
   JSON.stringify(serverZeilen("einkauf")[0]));
ok("und das Geraet bekommt sie zurueck",
   (await db.alle("einkauf")).find(x => x.schluessel === "e2").wert.text === "aktuell");

console.log("\n9) Favorit -> No-Go ist eine Zeile, nicht zwei");
await frisch();
await lokalAnlegen("listen_eintrag", "4001", { barcode: "4001", art: "favorit", name: "Cola", addedAt: 1000 });
await sync.abgleichen();
await db.schreibe("listen_eintrag", [{ schluessel: "4001", wert: { barcode: "4001", art: "nogo", name: "Cola", updatedAt: 2000 } }]);
await db.outboxAnhaengen("listen_eintrag", "4001", "upsert");
await sync.abgleichen();
ok("eine Zeile auf dem Server", serverZeilen("listen_eintrag").length === 1);
ok("art gewechselt", serverZeilen("listen_eintrag")[0].art === "nogo");
ok("lokal genau ein Eintrag", (await db.alle("listen_eintrag")).length === 1);

console.log("\n10) Tagesziel ueber (Profil, Datum)");
await frisch();
await lokalAnlegen("tagesziel", `${P}|2026-08-24`,
  { profileId: P, dateKey: "2026-08-24", kcal: 2000, netCarbG: 20, fatG: 150, proteinG: 100, frozenAt: 1000 });
await sync.abgleichen();
ok("angelegt", serverZeilen("tagesziel").length === 1);
// dasselbe Ziel vom anderen Geraet, mit anderem Wert
fake.fremdesGeraetSchreibt("tagesziel", {
  haushalt_id: H, profil_id: P, datum: "2026-08-24", kcal: 1800, netto_kh_g: 20,
  fett_g: 130, eiweiss_g: 100, geaendert_am: new Date(9999).toISOString(),
});
ok("weiterhin eine Zeile, keine Dublette", serverZeilen("tagesziel").length === 1);
await sync.abgleichen();
const tz = (await db.alle("tagesziel"))[0].wert;
ok("neuerer Wert kommt an", tz.kcal === 1800, JSON.stringify(tz));

console.log("\n11) Zeiger: nur Neues wird geholt");
await frisch();
for (let i = 0; i < 5; i++) {
  await lokalAnlegen("wasser", "w" + i, { id: "w" + i, profileId: P, dateKey: "2026-08-24", ml: 200, at: 1000 + i });
}
await sync.abgleichen();
const stand = await db.meta.lies("stand:wasser");
ok("Zeiger gesetzt", !!stand && stand !== "1970-01-01T00:00:00Z", String(stand));
const vorGet = fake.verlauf.filter(v => v.methode === "GET" && v.name === "wasser").length;
await sync.abgleichen();
const nachGet = fake.verlauf.filter(v => v.methode === "GET" && v.name === "wasser").length;
ok("beim zweiten Mal wird abgefragt, aber nichts geliefert", nachGet > vorGet);
ok("lokal weiterhin fuenf", (await db.alle("wasser")).length === 5);

console.log("\n12) Unterbrochener Durchlauf verliert nichts");
await frisch();
await lokalAnlegen("einkauf", "x1", { id: "x1", text: "Brot", checked: false, updatedAt: 1000 });
const echtesRest = fake.rest;
let gescheitert = false;
try {
  // Netz faellt beim Hochladen aus
  const modul = await import("./supabase-fake.mjs");
  const alt = modul.rest;
  Object.defineProperty(modul, "rest", { value: async () => { throw new Error("Netz weg"); }, configurable: true });
  await sync.abgleichen().catch(() => { gescheitert = true; });
  Object.defineProperty(modul, "rest", { value: alt, configurable: true });
} catch { gescheitert = true; }
ok("Auftrag bleibt in der Outbox", (await db.outboxAlle()).length >= 1,
   String((await db.outboxAlle()).length));
await sync.abgleichen();
ok("nach dem naechsten Versuch ist er drauf", serverZeilen("einkauf").some(z => z.text === "Brot"));
ok("Outbox jetzt leer", (await db.outboxAlle()).length === 0);

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
