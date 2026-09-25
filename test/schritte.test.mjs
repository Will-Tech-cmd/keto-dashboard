// Schritte und der Vergleich im Haushalt.
//
// Der Punkt dieser Datei ist der Unterschied zwischen "weniger gelaufen" und "noch nichts
// eingetragen". Mit 0 zu rechnen, wo nichts steht, würde dem Partner einen Rückstand
// andichten, den niemand gemessen hat — und genau das behauptet ein Vergleich, der die
// Lücke nicht kennt.
import "./setup.mjs";

const { Store } = await import("../js/store.js");
const { schritteAm, schnitt, vergleich, vergleichSatz, zahl } = await import("../js/schritte.js");

let fails = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  PASS " + name);
  else { console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); fails++; }
};

const ICH = Store.getActiveProfile().id;
const SIE = "22222222-2222-4222-8222-222222222222";

console.log("\n1) Eintragen, überschreiben, löschen");
Store.setSteps(ICH, "2026-09-25", 8412);
ok("eingetragen", schritteAm(ICH, "2026-09-25") === 8412, String(schritteAm(ICH, "2026-09-25")));
ok("fremder Tag bleibt leer", schritteAm(ICH, "2026-09-24") === null);
const erst = Store.getStepsFor(ICH, "2026-09-25").at;
Store.setSteps(ICH, "2026-09-25", 9000);
ok("überschreibt statt zu verdoppeln", Store.getSteps().filter(s => s.dateKey === "2026-09-25" && s.profileId === ICH).length === 1);
ok("Erfassungszeitpunkt bleibt stehen", Store.getStepsFor(ICH, "2026-09-25").at === erst);
Store.setSteps(ICH, "2026-09-24", 7500.6);
ok("auf ganze Schritte gerundet", schritteAm(ICH, "2026-09-24") === 7501, String(schritteAm(ICH, "2026-09-24")));
Store.removeSteps(ICH, "2026-09-24");
ok("gelöscht", schritteAm(ICH, "2026-09-24") === null);
ok("mit Grabstein", !!Store.get().tombstones.steps[`${ICH}|2026-09-24`]);

console.log("\n2) Schnitt zählt nur Tage MIT Eintrag");
for (const [tag, n] of [["2026-09-20", 6000], ["2026-09-21", 10000], ["2026-09-22", 8000]]) Store.setSteps(ICH, tag, n);
ok("Schnitt über drei eingetragene Tage", schnitt(ICH, { heute: "2026-09-22", tage: 7 }) === 8000,
   String(schnitt(ICH, { heute: "2026-09-22", tage: 7 })));
ok("Tage ohne Eintrag ziehen ihn nicht auf null",
   schnitt(ICH, { heute: "2026-09-22", tage: 7 }) === 8000);
ok("ohne jeden Eintrag kein Schnitt", schnitt(SIE, { heute: "2026-09-22", tage: 7 }) === null);

console.log("\n3) Vergleich — und die Lücke");
Store.setSteps(SIE, "2026-09-25", 10203);
let v = vergleich(ICH, SIE, "2026-09-25");
ok("beide da: Partner vorne", v.vorne === "partner", v.vorne);
ok("Abstand stimmt", v.abstand === 1203, String(v.abstand));
ok("Satz nennt den Namen", vergleichSatz(v, "Sandra") === "1.203 Schritte hinter Sandra.",
   vergleichSatz(v, "Sandra"));

Store.setSteps(ICH, "2026-09-25", 12000);
v = vergleich(ICH, SIE, "2026-09-25");
ok("ich vorne", v.vorne === "ich" && v.abstand === 1797, JSON.stringify(v));

Store.setSteps(ICH, "2026-09-25", 10203);
v = vergleich(ICH, SIE, "2026-09-25");
ok("Gleichstand", v.vorne === "gleich" && v.abstand === 0, JSON.stringify(v));
ok("Satz beim Gleichstand", vergleichSatz(v, "Sandra") === "Gleichstand mit Sandra.");

// Der eigentliche Grund für dieses Testfile:
v = vergleich(ICH, SIE, "2026-09-22");   // nur ich habe an diesem Tag etwas
ok("fehlender Partnerwert ist kein Rückstand", v.vorne === "offen", v.vorne);
ok("kein erfundener Abstand", v.abstand === null);
ok("Satz sagt, wer fehlt", vergleichSatz(v, "Sandra") === "Sandra hat für heute noch nichts eingetragen.",
   vergleichSatz(v, "Sandra"));

v = vergleich(ICH, SIE, "2026-09-19");   // niemand hat etwas
ok("beide leer", v.vorne === "offen" && v.meine === null && v.seine === null);
ok("Satz bei beidseitiger Leere",
   vergleichSatz(v, "Sandra") === "Für heute hat noch niemand Schritte eingetragen.");

v = vergleich(ICH, null, "2026-09-25");  // es gibt gar keinen Partner
ok("ohne Partner bleibt es offen", v.vorne === "offen" && v.seine === null);

console.log("\n4) Darstellung");
ok("Tausenderpunkte", zahl(10203) === "10.203", zahl(10203));
ok("nichts wird zum Gedankenstrich", zahl(null) === "–");

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : `\n${fails} Pruefung(en) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);
