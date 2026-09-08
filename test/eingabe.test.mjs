// Zahlen aus Eingabefeldern.
//
// Hintergrund: die Zahlenfelder der App waren `type="number"`. Dessen `value` ist laut Norm
// eine Zahl mit Punkt — ein getipptes Komma macht das Feld leer. Auf einer deutschen
// Tastatur liegt die Kommataste unter dem Daumen, und die Folge war eine Fehlermeldung
// „bitte eine Zahl eingeben" ohne jeden Hinweis, woran es lag.
//
// Seitdem sind die Felder `type="text"` mit `inputmode="decimal"`, ein Zuhörer in ui.js
// macht aus dem getippten Komma sofort einen Punkt (das lässt sich hier ohne Dokument nicht
// prüfen — dafür steht der Browsertest), und zahlAus() nimmt beides an.
import "./setup.mjs";
const { zahlAus } = await import("../js/ui.js");

let fails = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  PASS " + name);
  else { console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); fails++; }
};

console.log("\n1) Komma wie Punkt");
ok("82,4", zahlAus("82,4") === 82.4);
ok("82.4", zahlAus("82.4") === 82.4);
ok("ganze Zahl", zahlAus("90") === 90);
ok("negativ", zahlAus("-1,5") === -1.5);
ok("null bleibt null", zahlAus("0") === 0);

console.log("\n2) Was keine Zahl ist, ist keine Zahl");
for (const [was, roh] of [["leer", ""], ["nur Leerzeichen", "   "], ["Text", "abc"],
                          ["undefined", undefined], ["null", null], ["nur Komma", ","]]) {
  ok(was, zahlAus(roh) === null, JSON.stringify(zahlAus(roh)));
}

console.log("\n3) Keine stille 0");
// Der eigentliche Fehler von vorher: ein leeres Feld durfte nie als 0 durchgehen — eine
// Mahlzeit mit 0 g oder ein Gewicht von 0 kg sieht aus wie eine Messung.
ok("leeres Feld ist nicht 0", zahlAus("") !== 0);
ok("Text ist nicht 0", zahlAus("abc") !== 0);

console.log("\n4) Was der Browser sonst noch liefert");
ok("Leerzeichen aussen", zahlAus("  82,4  ") === 82.4);
ok("Einheit dahinter wird abgeschnitten", zahlAus("82,4 kg") === 82.4);
ok("fuehrender Punkt", zahlAus(",5") === 0.5);
ok("Zahl statt Zeichenkette", zahlAus(82.4) === 82.4);

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : `\n${fails} Pruefung(en) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);
