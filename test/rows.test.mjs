// Nimmt die ECHTE Sicherung, zerlegt sie in Zeilen, übersetzt sie in Server-Schreibweise,
// wieder zurück, und vergleicht. Was hier verlorengeht, ginge beim Umzug verloren.
import fs from "node:fs";
import { zerlege, fuege, nurLokales } from "../js/entities.js";
import { ENTITAETEN, REIHENFOLGE } from "../js/rows.js";

const DATEI = process.argv[2] || process.env.KETO_SICHERUNG;
if (!DATEI) { console.log("  uebersprungen: Pfad zu einer Sicherung als Argument angeben"); process.exit(0); }
const HAUSHALT = "11111111-2222-3333-4444-555555555555";
const state = JSON.parse(fs.readFileSync(DATEI, "utf8"));

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };

// --- 1) Zerlegen ------------------------------------------------------------
const ent = zerlege(state);
console.log("\n1) Zustand -> Listen");
for (const name of REIHENFOLGE) console.log(`  ${name.padEnd(18)} ${ent[name].length}`);
ok("nichts verloren: Mahlzeiten", ent.mahlzeit.length === state.consumption.length);
ok("nichts verloren: Wasser", ent.wasser.length === state.water.length);
ok("nichts verloren: Rezepte", ent.rezept.length === state.recipes.length);
ok("Favoriten + No-Go zusammengefasst",
   ent.listen_eintrag.length === state.favorites.length + state.noGo.length);
ok("Tagesziele flach", ent.tagesziel.length ===
   Object.values(state.dayTargets).reduce((s, t) => s + Object.keys(t).length, 0));
ok("Produkt-Korrekturen vereinigt", ent.produkt_korrektur.length ===
   new Set([...Object.keys(state.ownProducts), ...Object.keys(state.fiberOverrides)]).size);

// --- 2) Hin und zurück ohne Server -----------------------------------------
console.log("\n2) Listen -> Zustand (ohne Server)");
const zurueck = fuege(ent, nurLokales(state));
// Schluesselreihenfolge ist bedeutungslos: ein alter dayTargets-Eintrag liegt als
// {fatG, kcal, ...} vor, neu gebaut wird {kcal, netCarbG, ...}. Gleiche Werte, andere
// Reihenfolge - deshalb kanonisch vergleichen statt mit rohem JSON.stringify.
const kanonisch = (v) => {
  if (Array.isArray(v)) return v.map(kanonisch);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, kanonisch(v[k])]));
  }
  return v;
};
const gleich = (a, b) => JSON.stringify(kanonisch(a)) === JSON.stringify(kanonisch(b));
const vergleich = (feld, a, b) => ok(`${feld} identisch`, gleich(a, b),
  `${JSON.stringify(a).length} vs ${JSON.stringify(b).length} Zeichen`);
vergleich("profiles", state.profiles, zurueck.profiles);
vergleich("consumption", state.consumption, zurueck.consumption);
vergleich("water", state.water, zurueck.water);
vergleich("recipes", state.recipes, zurueck.recipes);
vergleich("favorites", state.favorites, zurueck.favorites);
vergleich("shoppingList", state.shoppingList, zurueck.shoppingList);
vergleich("dayTargets", state.dayTargets, zurueck.dayTargets);
vergleich("ownProducts", state.ownProducts, zurueck.ownProducts);
ok("Verlauf unangetastet durchgereicht", zurueck.history.length === state.history.length);

// --- 3) Über die Server-Schreibweise ---------------------------------------
console.log("\n3) Listen -> Server-Zeilen -> Listen");
const ctx = { haushaltId: HAUSHALT };
const zeilen = {};
for (const name of REIHENFOLGE) {
  const def = ENTITAETEN[name];
  zeilen[name] = ent[name].map(o => def.zuZeile(o, ctx));
}

// Pflichtspalten und Wertebereiche, die das Schema prüft
const pflicht = {
  profil: ["id", "haushalt_id", "name"],
  mahlzeit: ["id", "haushalt_id", "profil_id", "datum", "name"],
  wasser: ["id", "haushalt_id", "profil_id", "datum", "ml"],
  tagesziel: ["haushalt_id", "profil_id", "datum", "kcal"],
  listen_eintrag: ["haushalt_id", "art", "barcode", "name"],
  einkauf: ["haushalt_id", "text"],
  produkt_korrektur: ["haushalt_id", "barcode"],
  rezept: ["haushalt_id", "keto_id", "titel"],
};
for (const [name, felder] of Object.entries(pflicht)) {
  const luecken = zeilen[name].filter(z => felder.some(f => z[f] == null));
  ok(`${name}: keine Pflichtspalte leer`, luecken.length === 0,
     luecken.length ? JSON.stringify(luecken[0]) : "");
}
ok("mahlzeit: immer Gramm ODER Portionen",
   zeilen.mahlzeit.every(z => z.gramm != null || z.portionen != null));
ok("mahlzeit: nie beides gleichzeitig",
   zeilen.mahlzeit.every(z => !(z.gramm != null && z.portionen != null)));
ok("mahlzeit: gültige Mahlzeit oder null",
   zeilen.mahlzeit.every(z => z.mahlzeit === null || ["breakfast","lunch","dinner","snack"].includes(z.mahlzeit)));
ok("wasser: ml > 0", zeilen.wasser.every(z => z.ml > 0));
ok("profil: Alter 1..120", zeilen.profil.every(z => z.alter_jahre >= 1 && z.alter_jahre <= 120));
ok("listen_eintrag: art nur favorit/nogo",
   zeilen.listen_eintrag.every(z => ["favorit","nogo"].includes(z.art)));
ok("Datumsangaben als YYYY-MM-DD",
   [...zeilen.mahlzeit, ...zeilen.wasser, ...zeilen.tagesziel].every(z => /^\d{4}-\d{2}-\d{2}$/.test(z.datum)));
ok("geaendert_am überall gesetzt",
   REIHENFOLGE.every(n => zeilen[n].every(z => z.geaendert_am != null)));

// Eindeutigkeit der Konfliktziele — sonst kollidiert der Upsert mit sich selbst
for (const name of REIHENFOLGE) {
  const def = ENTITAETEN[name];
  const schl = ent[name].map(o => def.schluessel(o));
  ok(`${name}: Schlüssel eindeutig (${def.konflikt})`, new Set(schl).size === schl.length,
     `${schl.length} Zeilen, ${new Set(schl).size} verschiedene`);
}

// Zurückübersetzen
const zurueckAusZeilen = {};
for (const name of REIHENFOLGE) {
  zurueckAusZeilen[name] = zeilen[name].map(z => ENTITAETEN[name].ausZeile(z));
}
const state2 = fuege(zurueckAusZeilen, nurLokales(state));

console.log("\n4) Nach der Rundreise über den Server");
const zaehle = (s) => ({
  profile: s.profiles.length, mahlzeiten: s.consumption.length, wasser: s.water.length,
  rezepte: s.recipes.length, favoriten: s.favorites.length, nogo: s.noGo.length,
  einkauf: s.shoppingList.length, eigene: Object.keys(s.ownProducts).length,
  schalter: Object.keys(s.fiberOverrides).length,
  tage: Object.values(s.dayTargets).reduce((n, t) => n + Object.keys(t).length, 0),
});
const vor = zaehle(state), nach = zaehle(state2);
console.log("  vorher:", JSON.stringify(vor));
console.log("  nachher:", JSON.stringify(nach));
for (const k of Object.keys(vor)) ok(`Anzahl ${k}`, vor[k] === nach[k], `${vor[k]} -> ${nach[k]}`);

// Die Werte, auf die es beim Tracken ankommt
const summe = (s, feld) => Math.round(s.consumption.reduce((n, e) => n + (e[feld] || 0), 0) * 10) / 10;
for (const feld of ["kcal", "netCarbs", "fat", "protein"]) {
  ok(`Summe ${feld} unverändert`, summe(state, feld) === summe(state2, feld),
     `${summe(state, feld)} -> ${summe(state2, feld)}`);
}
ok("Wassermenge unverändert",
   state.water.reduce((n, e) => n + e.ml, 0) === state2.water.reduce((n, e) => n + e.ml, 0));
ok("Mahlzeiten-Zuordnung unverändert",
   JSON.stringify(state.consumption.map(e => e.meal)) === JSON.stringify(state2.consumption.map(e => e.meal)));
ok("Mengen unverändert",
   JSON.stringify(state.consumption.map(e => e.servings ?? e.grams)) ===
   JSON.stringify(state2.consumption.map(e => e.servings ?? e.grams)));

// Die uebersetzten Zeilen NUR auf ausdruecklichen Wunsch ablegen: sie enthalten die
// echten Daten aus der Sicherung und haben neben dem Test nichts verloren. Genau das
// ist hier einmal schiefgegangen und in ein oeffentliches Repository gewandert.
if (process.argv[3]) {
  fs.writeFileSync(process.argv[3], JSON.stringify(zeilen));
  console.log(`
  Zeilen geschrieben nach ${process.argv[3]}`);
}
console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
