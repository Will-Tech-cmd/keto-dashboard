// Beitrag an Open Food Facts — was gesendet werden darf, was gesendet wird, und wie die
// Antwort gedeutet wird.
//
// Der wichtigste Teil sind die drei Verbote: keine erfundenen Barcodes, keine Produkte ohne
// Nährwerte, nichts ohne ausdrückliche Handlung. Ein Beitrag ist öffentlich und dauerhaft;
// was hier durchrutscht, steht danach in einer Datenbank, die weltweit gelesen wird.
import "./setup.mjs";
const b = await import("../js/off-beitrag.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + (e ? " -> " + e : "")); fails++; } };

const echt = {
  barcode: "26445212", name: "Paprika Chilli Frischkäse", brand: "Lindenhof",
  quantity: "150 g", servingSize: "30 g", ingredientsText: "Frischkäse, Paprika, Chili",
  per100: { kcal: 239, carbs: 3.1, sugars: 2.8, fiber: 0, fat: 22, saturatedFat: 15, protein: 7.5, salt: 1.1 },
};

console.log("\n1) Erfundene Barcodes duerfen die Datenbank nie erreichen");
ok("Platzhalter erkannt", !b.istEchterBarcode("eigen-m2x9a1b2"));
ok("zu kurz erkannt", !b.istEchterBarcode("1234567"));
ok("zu lang erkannt", !b.istEchterBarcode("123456789012345"));
ok("Buchstaben erkannt", !b.istEchterBarcode("2644521a"));
ok("EAN-8 gilt", b.istEchterBarcode("20223939"));
ok("EAN-13 gilt", b.istEchterBarcode("2248028003834"));
const mitPlatzhalter = b.pruefeBeitrag({ ...echt, barcode: "eigen-abc123" });
ok("pruefeBeitrag lehnt Platzhalter ab", !mitPlatzhalter.moeglich);
ok("und nennt den Grund", /Barcode/.test(mitPlatzhalter.grund), mitPlatzhalter.grund);

console.log("\n2) Ohne Zahlen kein Beitrag");
ok("alle Naehrwerte leer -> nein",
   !b.pruefeBeitrag({ ...echt, per100: { kcal: null, carbs: null, fat: null, protein: null } }).moeglich);
ok("nur kcal reicht",
   b.pruefeBeitrag({ ...echt, per100: { kcal: 239, carbs: null, fat: null, protein: null } }).moeglich);
ok("ohne Namen -> nein", !b.pruefeBeitrag({ ...echt, name: "" }).moeglich);
ok("Platzhaltername -> nein", !b.pruefeBeitrag({ ...echt, name: "Unbekanntes Produkt" }).moeglich);
ok("vollstaendiges Produkt -> ja", b.pruefeBeitrag(echt).moeglich);

console.log("\n3) Was gesendet wuerde");
const f = Object.fromEntries(b.baueBeitrag(echt));
ok("Barcode", f.code === "26445212");
ok("Name", f.product_name === "Paprika Chilli Frischkäse" && f.product_name_de === f.product_name);
ok("Marke", f.brands === "Lindenhof");
ok("Portionsgroesse", f.serving_size === "30 g");
ok("Sprache deutsch", f.lc === "de");
ok("Bezug je 100 g", f.nutrition_data_per === "100g");
ok("kcal mit eigener Einheit", f["nutriment_energy-kcal"] === "239" && f["nutriment_energy-kcal_unit"] === "kcal");
ok("KH in Gramm", f.nutriment_carbohydrates === "3.1" && f.nutriment_carbohydrates_unit === "g");
ok("gesaettigte Fette", f["nutriment_saturated-fat"] === "15");
ok("Ballaststoffe 0 wird mitgeschickt", f.nutriment_fiber === "0");
// Der Bauplan ist das, was die Vorschau zeigt. Zugangsdaten gehoeren da nicht hinein --
// sonst stuenden sie in einer Ansicht, die man jemandem ueber die Schulter zeigt.
ok("keine Zugangsdaten im Bauplan", !("password" in f) && !("user_id" in f));

console.log("\n4) Fehlende Angaben werden weggelassen, nicht als leer gesendet");
const duenn = Object.fromEntries(b.baueBeitrag({
  barcode: "20223939", name: "Mozzarella", per100: { kcal: 159, carbs: null, fat: 12, protein: 18 },
}));
ok("keine Marke -> kein Feld", !("brands" in duenn));
ok("keine Portionsgroesse -> kein Feld", !("serving_size" in duenn));
ok("KH null -> kein Feld", !("nutriment_carbohydrates" in duenn));
ok("Fett vorhanden -> Feld da", duenn.nutriment_fat === "12");

console.log("\n5) Vorschau zeigt lesbare Bezeichnungen");
const v = b.vorschau(echt);
const alsText = v.map(x => x.was).join(", ");
ok("Barcode lesbar benannt", alsText.includes("Barcode"));
ok("kcal lesbar benannt", alsText.includes("kcal je 100 g"), alsText);
ok("keine rohen Feldnamen", !alsText.includes("nutriment_"), alsText);

console.log("\n6) Antwort deuten");
const erfolg = b.deuteAntwort(JSON.stringify({ status: 1, status_verbose: "fields saved" }), 200, "26445212");
ok("Erfolg erkannt", erfolg.barcode === "26445212" && /saved/.test(erfolg.meldung));
// Genau die Seite, die der Testserver von Open Food Facts bei falschem Passwort liefert.
try {
  b.deuteAntwort("<html><body><h1>Error</h1><p>Incorrect user name or password.</p></body></html>", 200, "1");
  ok("falsches Passwort erkannt", false, "kein Fehler geworfen");
} catch (e) {
  ok("falsches Passwort erkannt", /Passwort/.test(e.message), e.message);
}
try {
  b.deuteAntwort(JSON.stringify({ status: 0, status_verbose: "no code or invalid code" }), 200, "1");
  ok("Ablehnung durchgereicht", false);
} catch (e) {
  ok("Ablehnung im Klartext", /invalid code/.test(e.message), e.message);
}
try {
  b.deuteAntwort("<html>Gateway Timeout</html>", 504, "1");
  ok("unerwartete Antwort erkannt", false);
} catch (e) {
  ok("unerwartete Antwort nennt den Status", /504/.test(e.message), e.message);
}

console.log("\n7) Ohne hinterlegtes Konto wird nichts gesendet");
b.loescheZugang();
ok("kein Zugang gemeldet", !b.hatZugang());
try { await b.sendeBeitrag(echt); ok("sendeBeitrag wirft", false, "kein Fehler"); }
catch (e) { ok("sendeBeitrag wirft ohne Konto", /Konto/.test(e.message), e.message); }
b.setzeZugang("wilhelm", "geheim");
ok("Zugang gemerkt", b.hatZugang() && b.benutzername() === "wilhelm");
b.loescheZugang();
ok("Zugang loeschbar", !b.hatZugang() && b.benutzername() === "");

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
