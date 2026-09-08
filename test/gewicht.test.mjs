// Gewichtsverlauf: Trendrechnung, Schwellen und der Abgleich mit dem Defizit.
//
// Der Punkt dieser Datei ist nicht die Formel — kleinste Quadrate sind kleinste Quadrate.
// Geprüft wird, dass die App den Mund hält, solange die Daten nichts hergeben: zwei
// Messungen von gestern und heute dürfen keine Wochenrate ergeben, und ein Tag mit
// Wasserausschlag darf den Trend nicht kippen.
import "./setup.mjs";

const { Store } = await import("../js/store.js");
const {
  kgProWoche, erwarteteKgProWoche, gewichtsBericht, trendSatz, zielAbgleichSatz, tagesnummer,
} = await import("../js/gewicht.js");

let fails = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  PASS " + name);
  else { console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); fails++; }
};
const nah = (a, b, eps = 0.05) => a != null && Math.abs(a - b) <= eps;

const profil = Store.getActiveProfile();
const P = profil.id;
Store.updateProfile(P, {
  sex: "male", age: 40, heightCm: 180, weightKg: 90, bodyFatPct: null,
  activity: 1.375, goal: "lose", deficitPct: 15,
});

console.log("\n1) Tagesnummer zaehlt Kalendertage, auch ueber die Zeitumstellung");
ok("29.03. -> 30.03. ist ein Tag", tagesnummer("2026-03-30") - tagesnummer("2026-03-29") === 1);
ok("Monatsgrenze", tagesnummer("2026-04-01") - tagesnummer("2026-03-31") === 1);
ok("Jahreswechsel", tagesnummer("2027-01-01") - tagesnummer("2026-12-31") === 1);

console.log("\n2) Steigung in kg je Woche");
ok("ohne Punkte kein Trend", kgProWoche([]) === null);
ok("ein Punkt ergibt keine Steigung", kgProWoche([{ dateKey: "2026-09-01", kg: 90 }]) === null);
ok("alle Punkte am selben Tag ergeben keine Steigung",
   kgProWoche([{ dateKey: "2026-09-01", kg: 90 }, { dateKey: "2026-09-01", kg: 91 }]) === null);

const gerade = [];
for (let i = 0; i <= 28; i += 7) gerade.push({ dateKey: `2026-09-${String(1 + i).padStart(2, "0")}`, kg: 90 - i * 0.1 });
ok("0,1 kg am Tag sind 0,7 kg die Woche", nah(kgProWoche(gerade), -0.7), String(kgProWoche(gerade)));

// Ein einzelner Ausreisser (Wasser nach einem salzigen Abend) darf den Trend nicht kippen.
const mitAusreisser = gerade.map((p, i) => (i === 2 ? { ...p, kg: p.kg + 1.5 } : p));
ok("ein Ausreisser von +1,5 kg dreht den Trend nicht um",
   kgProWoche(mitAusreisser) < -0.4, String(kgProWoche(mitAusreisser)));

console.log("\n3) Erwartete Rate aus dem Defizit");
const erwartet = erwarteteKgProWoche(Store.getActiveProfile());
ok("Defizit -> negative Rate", erwartet < 0, String(erwartet));
ok("Groessenordnung plausibel (0,2 bis 1,5 kg/Woche)", Math.abs(erwartet) > 0.2 && Math.abs(erwartet) < 1.5, String(erwartet));
Store.updateProfile(P, { goal: "maintain" });
ok("Halten -> keine erwartete Aenderung", nah(erwarteteKgProWoche(Store.getActiveProfile()), 0, 0.001));
Store.updateProfile(P, { goal: "lose" });

console.log("\n4) Zu wenig Daten heisst: keine Rate");
const HEUTE = "2026-09-30";
Store.setWeight(P, "2026-09-29", { kg: 90.5 });
Store.setWeight(P, "2026-09-30", { kg: 90.0 });
let b = gewichtsBericht(Store.getActiveProfile(), { heute: HEUTE });
ok("zwei Messungen an zwei Tagen ergeben keinen Trend", b.genugDaten === false && b.kgProWoche === null);
ok("der letzte Wert steht trotzdem da", b.letzter?.kg === 90);
ok("der Satz sagt, was fehlt", trendSatz(b).startsWith("Für einen Trend fehlen noch"), trendSatz(b));
ok("ohne Trend kein Zielabgleich", zielAbgleichSatz(Store.getActiveProfile(), b) === "");

console.log("\n5) Genug Daten: Trend, Satz und Zielabgleich");
// Vier Wochen, jede Woche 0,5 kg runter — sauber im Fenster von 28 Tagen.
for (const [tag, kg] of [["2026-09-02", 92.0], ["2026-09-09", 91.5], ["2026-09-16", 91.0], ["2026-09-23", 90.5]]) {
  Store.setWeight(P, tag, { kg });
}
b = gewichtsBericht(Store.getActiveProfile(), { heute: HEUTE });
ok("jetzt reicht es fuer einen Trend", b.genugDaten === true);
ok("rund -0,5 kg je Woche", nah(b.kgProWoche, -0.5, 0.12), String(b.kgProWoche));
ok("Satz nennt die Richtung", trendSatz(b).includes("ab"), trendSatz(b));
ok("Zielabgleich sagt etwas", zielAbgleichSatz(Store.getActiveProfile(), b).length > 0);
ok("Veraenderung im Fenster ist negativ", b.veraenderung < 0, String(b.veraenderung));

console.log("\n6) Ein Tag, ein Wert");
Store.setWeight(P, "2026-09-30", { kg: 89.4, bodyFatPct: 22 });
const amTag = Store.getWeights().filter(w => w.profileId === P && w.dateKey === "2026-09-30");
ok("zweimal gewogen bleibt eine Zeile", amTag.length === 1, JSON.stringify(amTag));
ok("der zweite Wert gilt", amTag[0].kg === 89.4);
ok("Koerperfett wird uebernommen", amTag[0].bodyFatPct === 22);
ok("at bleibt der erste Zeitpunkt", amTag[0].at <= amTag[0].updatedAt);

console.log("\n7) Loeschen hinterlaesst einen Grabstein");
Store.removeWeight(P, "2026-09-30");
ok("weg aus der Liste", Store.getWeight(P, "2026-09-30") === null);
ok("Grabstein steht", Store.get().tombstones.weights[`${P}|2026-09-30`] > 0);
Store.setWeight(P, "2026-09-30", { kg: 89.0 });
ok("derselbe Tag laesst sich wieder befuellen", Store.getWeight(P, "2026-09-30")?.kg === 89);

console.log("\n8) Zukunft und fremde Profile bleiben draussen");
Store.setWeight("fremd", "2026-09-28", { kg: 60 });
Store.setWeight(P, "2026-10-15", { kg: 88 });
b = gewichtsBericht(Store.getActiveProfile(), { heute: HEUTE });
ok("fremdes Profil zaehlt nicht mit", !b.alle.some(p => p.kg === 60));
ok("spaeterer Tag ist nicht der letzte Wert", b.letzter?.dateKey <= HEUTE, JSON.stringify(b.letzter));
ok("und nicht im Trendfenster", !b.fenster.some(p => p.dateKey > HEUTE));

console.log("\n9) Klassischer Speicherweg: zwei Geraete fuehren denselben Tag zusammen");
// Der Zeilenmodus regelt das auf dem Server (siehe sync2.test.mjs). Im Klumpenmodus
// entscheidet applyMerge() im Client — und muss zum selben Ergebnis kommen: ein Tag, ein
// Wert, die spaetere Fassung gewinnt.
const meiner = JSON.parse(Store.exportJSON());
const anderes = JSON.parse(JSON.stringify(meiner));
const meinTag = { profileId: P, dateKey: "2026-10-01", kg: 88.0, bodyFatPct: null, at: 1000, updatedAt: 1000 };
const seinTag = { profileId: P, dateKey: "2026-10-01", kg: 87.2, bodyFatPct: null, at: 1000, updatedAt: 9000 };
const seinEigener = { profileId: P, dateKey: "2026-10-02", kg: 87.0, bodyFatPct: null, at: 2000, updatedAt: 2000 };
Store.importJSON(JSON.stringify({ ...meiner, weights: [meinTag] }));
Store.mergeJSONQuiet(JSON.stringify({ ...anderes, weights: [seinTag, seinEigener] }));
const zusammen = Store.getWeights().filter(w => w.profileId === P && w.dateKey.startsWith("2026-10"));
ok("ein Eintrag je Tag", zusammen.length === 2, JSON.stringify(zusammen));
ok("die spaetere Fassung gewinnt", zusammen.find(w => w.dateKey === "2026-10-01")?.kg === 87.2,
   JSON.stringify(zusammen));
ok("der fremde Tag kommt dazu", zusammen.some(w => w.dateKey === "2026-10-02" && w.kg === 87));

console.log("\n10) Eine Loeschung ueberlebt den naechsten Abgleich");
const serverStand = Store.exportJSON();          // kennt beide Tage
Store.removeWeight(P, "2026-10-02");
Store.mergeJSONQuiet(serverStand);               // das andere Geraet weiss noch nichts davon
ok("der geloeschte Tag bleibt weg", Store.getWeight(P, "2026-10-02") === null,
   JSON.stringify(Store.getWeights().filter(w => w.dateKey === "2026-10-02")));
ok("der andere Tag ist unberuehrt", Store.getWeight(P, "2026-10-01")?.kg === 87.2);

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : `\n${fails} Pruefung(en) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);
