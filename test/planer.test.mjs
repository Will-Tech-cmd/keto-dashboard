// Der Essensplaner.
//
// Zwei Dinge werden hier festgehalten, weil sie beim Lesen des Codes nicht ins Auge springen
// und beim nächsten Umbau leicht verlorengehen:
//
//   1. Das Netto-KH-Limit ist eine Grenze, keine Zielgröße. Ein Plan, der es reißt, darf gar
//      nicht erst vorgeschlagen werden — auch dann nicht, wenn er alle anderen Werte besser
//      trifft.
//   2. Der Zufall ist gesetzt. Derselbe Startwert muss denselben Plan ergeben, sonst ist ein
//      Fehlverhalten einmal zu sehen und nie wieder.
import "./setup.mjs";
const { Store } = await import("../js/store.js");
const p = await import("../js/planer.js");
const { rankFrequentItems } = await import("../js/consumption.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + (e ? " -> " + e : "")); fails++; } };

const ich = Store.getActiveProfile();

const ZIELE = { kcal: 1900, netCarbG: 20, fatG: 150, proteinG: 110 };
const MAHLZEITEN = ["breakfast", "lunch", "dinner"];
const TAGE = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];

/** Ein Katalogeintrag von Hand — so kommt der Motor ohne Store und ohne echte Daten aus. */
function rezept(name, per, { anzahl = 5, slots = {} } = {}) {
  const gewicht = {};
  for (const s of p.SLOTS) gewicht[s] = Math.max(0.15, (slots[s] || 0) / Math.max(1, anzahl));
  return {
    key: `recipe:${name}`, name, istRezept: true, recipeId: name, barcode: null,
    per, einheit: "portion", schritt: 0.25, min: 0.5, max: 2, standard: 1,
    servingG: 300, anzahl, gewicht, favorit: false,
  };
}
function produkt(name, per, { anzahl = 5, slots = {}, favorit = false } = {}) {
  const gewicht = {};
  for (const s of p.SLOTS) gewicht[s] = Math.max(0.15, (slots[s] || 0) / Math.max(1, anzahl));
  return {
    key: name, name, istRezept: false, recipeId: null, barcode: name,
    per, einheit: "gramm", schritt: 10, min: 20, max: 200, standard: 60,
    servingG: 30, anzahl, gewicht, favorit,
  };
}

const KATALOG = [
  rezept("Ketobrot", { kcal: 320, netCarbs: 3.2, fat: 26, protein: 14 }, { anzahl: 8, slots: { breakfast: 7 } }),
  rezept("Cheeseburger Auflauf", { kcal: 640, netCarbs: 6.1, fat: 48, protein: 40 }, { anzahl: 9, slots: { dinner: 8 } }),
  rezept("Zucchini Omelett", { kcal: 410, netCarbs: 4.0, fat: 32, protein: 24 }, { anzahl: 6, slots: { lunch: 4, breakfast: 2 } }),
  rezept("Putenbrust mit Brokkoli", { kcal: 520, netCarbs: 5.5, fat: 34, protein: 45 }, { anzahl: 7, slots: { lunch: 6 } }),
  rezept("Lachs mit Spinat", { kcal: 560, netCarbs: 2.8, fat: 42, protein: 38 }, { anzahl: 5, slots: { dinner: 5 } }),
  produkt("Gouda", { kcal: 356, netCarbs: 0, fat: 27, protein: 25 }, { anzahl: 12, slots: { breakfast: 6, snack: 4 } }),
  produkt("Butter", { kcal: 741, netCarbs: 0.6, fat: 82, protein: 0.7 }, { anzahl: 10, slots: { breakfast: 8 } }),
  produkt("Avocado", { kcal: 160, netCarbs: 1.8, fat: 15, protein: 2 }, { anzahl: 6, slots: { lunch: 3, snack: 3 }, favorit: true }),
  produkt("Krakauer", { kcal: 320, netCarbs: 1.0, fat: 28, protein: 16 }, { anzahl: 8, slots: { dinner: 4, snack: 4 } }),
];

const plan = (saat = 42, mahlzeiten = MAHLZEITEN, dateKeys = TAGE, katalog = KATALOG) =>
  p.erstellePlan({ katalog, ziele: ZIELE, dateKeys, mahlzeiten, saat });

// ---------------------------------------------------------------------------
console.log("\n1) Das KH-Limit ist eine Grenze, keine Zielgroesse");
{
  let ueber = 0;
  for (let saat = 1; saat <= 25; saat++) {
    for (const tag of plan(saat)) if (tag.summe.netCarbs > ZIELE.netCarbG + 1e-9) ueber++;
  }
  ok("in 100 geplanten Tagen keiner ueber dem Limit", ueber === 0, `${ueber} daneben`);
  ok("bewerteTag verwirft alles ueber dem Limit",
     p.bewerteTag({ kcal: 1900, netCarbs: 20.1, fat: 150, protein: 110 }, ZIELE) === Infinity);
  ok("genau auf dem Limit ist noch gueltig",
     Number.isFinite(p.bewerteTag({ kcal: 1900, netCarbs: 20, fat: 150, protein: 110 }, ZIELE)));
  // Zu wenig Eiweiss wiegt doppelt: sonst schlaegt "20 g drunter" genauso zu Buche wie
  // "20 g drueber", und der Planer laesst im Defizit die Muskulatur zahlen.
  const zuWenig = p.bewerteTag({ kcal: 1900, netCarbs: 15, fat: 150, protein: 90 }, ZIELE);
  const zuViel = p.bewerteTag({ kcal: 1900, netCarbs: 15, fat: 150, protein: 130 }, ZIELE);
  ok("zu wenig Eiweiss wiegt schwerer als zu viel", zuWenig > zuViel, `${zuWenig} vs ${zuViel}`);
}

// ---------------------------------------------------------------------------
console.log("\n2) Die Zielwerte werden getroffen");
{
  const tage = plan(7);
  const abw = tage.map(t => Math.abs(t.summe.kcal - ZIELE.kcal) / ZIELE.kcal);
  const schlimmste = Math.max(...abw);
  ok("jeder Tag hat alle drei Mahlzeiten",
     tage.every(t => MAHLZEITEN.every(m => (t.mahlzeiten[m] || []).length > 0)));
  ok("kcal je Tag hoechstens 20% daneben", schlimmste <= 0.2, `${Math.round(schlimmste * 100)}%`);
  ok("kein Tag ist als ueber dem Limit markiert", tage.every(t => !t.ueberLimit));
  ok("die Summe passt zu den Zeilen", tage.every(t => {
    const nach = p.summeAusZeilen(Object.values(t.mahlzeiten).flat());
    return Math.abs(nach.kcal - t.summe.kcal) < 0.01;
  }));
}

// ---------------------------------------------------------------------------
console.log("\n3) Vier Tage sind nicht viermal derselbe Tag");
{
  const tage = plan(11);
  const abende = tage.map(t => t.mahlzeiten.dinner.map(z => z.key).join("+"));
  ok("kein Abendessen zweimal hintereinander",
     abende.every((a, i) => i === 0 || a !== abende[i - 1]), abende.join(" | "));
  const alle = tage.flatMap(t => Object.values(t.mahlzeiten).flat().map(z => z.key));
  ok("mindestens 5 verschiedene Gerichte ueber 4 Tage", new Set(alle).size >= 5, String(new Set(alle).size));
  ok("an einem Tag nichts doppelt", tage.every(t => {
    const keys = Object.values(t.mahlzeiten).flat().map(z => z.key);
    return new Set(keys).size === keys.length;
  }));
}

// ---------------------------------------------------------------------------
console.log("\n4) Derselbe Startwert, derselbe Plan");
{
  const a = JSON.stringify(plan(99));
  const b = JSON.stringify(plan(99));
  const c = JSON.stringify(plan(100));
  ok("zweimal gewuerfelt, zweimal dasselbe", a === b);
  ok("anderer Startwert, anderer Plan", a !== c);
}

// ---------------------------------------------------------------------------
console.log("\n5) Grenzfaelle");
{
  const leer = plan(1, MAHLZEITEN, TAGE, []);
  ok("leerer Katalog wirft nicht", leer.length === 4);
  ok("und liefert leere Tage", leer.every(t => t.leer && t.summe.kcal === 0));

  const einer = plan(1, MAHLZEITEN, ["2026-09-01"], [KATALOG[0]]);
  ok("ein einziger Kandidat reicht fuer einen Slot", einer[0].mahlzeiten.breakfast.length === 1);
  ok("und wird nicht in zwei Slots gestellt",
     Object.values(einer[0].mahlzeiten).flat().length === 1);

  // Nur Kohlenhydrate im Katalog: dann gibt es keinen gueltigen Tag. Lieber den knappsten
  // zeigen und es dazusagen, als vor einer leeren Seite zu stehen.
  const nurKh = plan(3, ["dinner"], ["2026-09-01"], [
    produkt("Nudeln", { kcal: 350, netCarbs: 70, fat: 1.5, protein: 12 }, { anzahl: 3 }),
  ]);
  ok("nur KH im Katalog -> Plan trotzdem da", nurKh[0].mahlzeiten.dinner.length === 1);
  ok("und ist als ueber dem Limit markiert", nurKh[0].ueberLimit === true);
}

// ---------------------------------------------------------------------------
console.log("\n6) Anteile");
{
  const drei = p.anteileFuer(MAHLZEITEN);
  ok("drei Slots ergeben zusammen 1",
     Math.abs(Object.values(drei).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const vier = p.anteileFuer([...MAHLZEITEN, "snack"]);
  ok("mit Snack ebenfalls 1",
     Math.abs(Object.values(vier).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  ok("Snack ist der kleinste Anteil", vier.snack < vier.breakfast);
  // Wer nur abends plant, plant den ganzen Tag dorthin — sonst bekaeme das Abendessen
  // vierzig Prozent und der Rest bliebe unbeachtet liegen.
  ok("nur ein Slot bekommt den ganzen Tag", p.anteileFuer(["dinner"]).dinner === 1);
}

// ---------------------------------------------------------------------------
console.log("\n7) Eine Zeile tauschen aendert nur diese Zeile");
{
  const tag = plan(5, MAHLZEITEN, ["2026-09-01"])[0];
  const vorher = JSON.parse(JSON.stringify(tag.mahlzeiten));
  const neu = p.tauscheZeile(tag, "dinner", 0, { katalog: KATALOG, saat: 4242 });
  ok("Abendessen hat sich geaendert", neu.mahlzeiten.dinner[0].key !== vorher.dinner[0].key);
  ok("Fruehstueck unangetastet",
     JSON.stringify(neu.mahlzeiten.breakfast) === JSON.stringify(vorher.breakfast));
  ok("Mittag unangetastet",
     JSON.stringify(neu.mahlzeiten.lunch) === JSON.stringify(vorher.lunch));
  ok("das Neue stand noch nicht auf dem Tag",
     !Object.values(vorher).flat().some(z => z.key === neu.mahlzeiten.dinner[0].key));
  ok("die Summe wurde nachgezogen",
     Math.abs(p.summeAusZeilen(Object.values(neu.mahlzeiten).flat()).kcal - neu.summe.kcal) < 0.01);
  ok("das urspruengliche Objekt blieb unveraendert",
     JSON.stringify(tag.mahlzeiten) === JSON.stringify(vorher));
}

// ---------------------------------------------------------------------------
console.log("\n8) Uebernehmen schreibt vorgemerkte Eintraege");
{
  const tage = plan(21, MAHLZEITEN, ["2026-09-01", "2026-09-02"]);
  const zeilen = tage.flatMap(t => Object.values(t.mahlzeiten).flat());
  const eintraege = p.uebernehmePlan(tage, ich.id);
  ok("je Planzeile ein Eintrag", eintraege.length === zeilen.length, `${eintraege.length}/${zeilen.length}`);
  ok("alle als geplant markiert", eintraege.every(e => e.planned === true));
  ok("Datum uebernommen", eintraege.every(e => e.dateKey === "2026-09-01" || e.dateKey === "2026-09-02"));
  ok("Mahlzeit gesetzt", eintraege.every(e => MAHLZEITEN.includes(e.meal)));
  // Rezepte tragen "recipe:<id>" — daran haengt die Schnellauswahl im Eintragen-Sheet.
  const rez = eintraege.filter(e => e.barcode.startsWith("recipe:"));
  ok("Rezepte fuehren Portionen, keine Gramm",
     rez.length > 0 && rez.every(e => e.servings != null && e.grams === undefined));
  const prod = eintraege.filter(e => !e.barcode.startsWith("recipe:"));
  ok("Produkte fuehren Gramm, keine Portionen",
     prod.every(e => e.grams != null && e.servings === undefined));
  // Die Zahl aus dem Plan ist die Zahl im Tag — nicht neu gerechnet.
  const erste = eintraege[0];
  const passende = zeilen.find(z => z.name === erste.name && z.menge === (erste.servings ?? erste.grams));
  ok("Naehrwerte unveraendert uebernommen", !!werteGleich(passende, erste), JSON.stringify(erste));

  ok("geplanteEintraege findet sie", p.geplanteEintraege(ich.id).length === eintraege.length);
  ok("nach Tag gefiltert", p.geplanteEintraege(ich.id, "2026-09-01").every(e => e.dateKey === "2026-09-01"));
}

function werteGleich(zeile, eintrag) {
  return zeile && zeile.kcal === eintrag.kcal && zeile.netCarbs === eintrag.netCarbs;
}

// ---------------------------------------------------------------------------
console.log("\n9) Geplantes zaehlt nicht als gegessen");
{
  // rankFrequentItems fuettert die Schnellauswahl. Waeren geplante Eintraege dabei, wuerde
  // der Planer sich selbst bestaerken: was er fuer Donnerstag vorschlaegt, gaelte ab sofort
  // als "isst du oft" und kaeme beim naechsten Plan noch haeufiger.
  const { frequent, recent } = rankFrequentItems(ich.id, "dinner", { maxFrequent: 20, maxRecent: 20 });
  const geplant = new Set(p.geplanteEintraege(ich.id).map(e => e.barcode));
  const drin = [...frequent, ...recent].filter(i => geplant.has(i.key));
  ok("kein geplanter Eintrag in der Schnellauswahl", drin.length === 0, drin.map(i => i.name).join(", "));
}

// ---------------------------------------------------------------------------
console.log("\n10) Verwerfen raeumt nur Vorgemerktes weg");
{
  const echt = {
    id: crypto.randomUUID(), profileId: ich.id, barcode: "1234", name: "Wirklich gegessen",
    grams: 100, servingG: null, meal: "dinner", dateKey: "2026-09-01",
    kcal: 100, netCarbs: 1, fat: 5, protein: 5, at: Date.now(),
  };
  Store.addConsumption(echt);
  const weg = p.verwirfPlan(ich.id, "2026-09-01");
  ok("die vorgemerkten sind weg", weg > 0 && p.geplanteEintraege(ich.id, "2026-09-01").length === 0);
  ok("der echte Eintrag steht noch",
     Store.getConsumption().some(e => e.id === echt.id), "geloescht");
  ok("der zweite Tag ist unangetastet", p.geplanteEintraege(ich.id, "2026-09-02").length > 0);
  Store.removeConsumption(echt.id);
  p.verwirfPlan(ich.id, "2026-09-02");
}

// ---------------------------------------------------------------------------
console.log("\n11) Zutaten fuer den Einkauf");
{
  const r = {
    id: crypto.randomUUID(), name: "Testauflauf", servings: 4,
    ingredients: [
      { id: "a", name: "Hackfleisch", grams: 500, per100: { kcal: 250, carbs: 0, fat: 20, protein: 18 } },
      { id: "b", name: "Gouda", grams: 200, per100: { kcal: 356, carbs: 0, fat: 27, protein: 25 } },
      { id: "c", name: "Salz", grams: 0, per100: { kcal: 0, carbs: 0, fat: 0, protein: 0 } },
    ],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  Store.saveRecipe(r);
  const zeile = (menge) => ({
    key: `recipe:${r.id}`, name: r.name, istRezept: true, recipeId: r.id, barcode: null,
    menge, einheit: "portion", servingG: 175, kcal: 0, netCarbs: 0, fat: 0, protein: 0,
  });
  const produktZeile = {
    key: "9999", name: "Gouda", istRezept: false, recipeId: null, barcode: "9999",
    menge: 30, einheit: "gramm", servingG: 30, kcal: 0, netCarbs: 0, fat: 0, protein: 0,
  };
  const testPlan = [
    { dateKey: "2026-09-01", mahlzeiten: { dinner: [zeile(2)] } },
    { dateKey: "2026-09-02", mahlzeiten: { dinner: [zeile(1)], breakfast: [produktZeile] } },
  ];
  const zutaten = p.zutatenFuerPlan(testPlan);
  const finde = (n) => zutaten.find(z => z.name === n);
  // 2 Portionen von 4 = die Haelfte des Rezepts, dazu 1 Portion = ein Viertel: 500 * 0.75.
  ok("Rezeptmengen auf die Portionen heruntergerechnet", finde("Hackfleisch")?.gramm === 375,
     String(finde("Hackfleisch")?.gramm));
  // Gouda kommt aus dem Rezept (200 * 0.75 = 150) UND als Produkt (30) — eine Zeile, 180 g.
  ok("gleiche Namen ueber die Tage addiert", finde("Gouda")?.gramm === 180, String(finde("Gouda")?.gramm));
  ok("Zutat ohne Menge bleibt drin", !!finde("Salz") && finde("Salz").gramm === 0);
  ok("alphabetisch sortiert", zutaten.map(z => z.name).join(",") === "Gouda,Hackfleisch,Salz",
     zutaten.map(z => z.name).join(","));
  ok("Text mit Menge", p.einkaufsText({ name: "Gouda", gramm: 180 }) === "Gouda 180 g");
  ok("Text ohne Menge", p.einkaufsText({ name: "Salz", gramm: 0 }) === "Salz");

  const gesetzt = p.aufEinkaufsliste(zutaten);
  ok("drei Zeilen auf der Einkaufsliste", gesetzt === 3, String(gesetzt));
  const nochmal = p.aufEinkaufsliste(zutaten);
  ok("beim zweiten Mal nichts doppelt", nochmal === 0, String(nochmal));
  // Andere Menge, gleicher Name: beim Einkaufen eine Zeile, nicht zwei.
  ok("andere Menge zaehlt als dieselbe Zeile",
     p.aufEinkaufsliste([{ name: "Gouda", gramm: 500 }]) === 0);
  Store.deleteRecipe(r.id);
}

// ---------------------------------------------------------------------------
console.log("\n12) planTage");
{
  const tage = p.planTage("2026-09-29", 4);
  ok("vier aufeinanderfolgende Tage",
     tage.join(",") === "2026-09-29,2026-09-30,2026-10-01,2026-10-02", tage.join(","));
}

// ---------------------------------------------------------------------------
console.log("\n13) Ein Vorschlag von aussen darf nichts einschleusen");
{
  const echterKey = KATALOG[1].key;
  const vorschlag = [
    { tag: "2026-09-01", mahlzeit: "dinner", katalogKey: echterKey, menge: 1 },
    // Alles Folgende muss verworfen werden.
    { tag: "2026-09-01", mahlzeit: "dinner", katalogKey: "recipe:Pizza Salami", menge: 1 },
    { tag: "2026-09-09", mahlzeit: "dinner", katalogKey: KATALOG[0].key, menge: 1 },
    { tag: "2026-09-01", mahlzeit: "brunch", katalogKey: KATALOG[0].key, menge: 1 },
    { tag: "2026-09-01", mahlzeit: "lunch", katalogKey: echterKey, menge: 1 },
    // Formal gueltig, als Mahlzeit unsinnig: die Menge wird in die Grenzen gezwungen.
    { tag: "2026-09-02", mahlzeit: "dinner", katalogKey: KATALOG[4].key, menge: 12 },
  ];
  const gebaut = p.ausVorschlag(vorschlag, {
    katalog: KATALOG, ziele: ZIELE, dateKeys: ["2026-09-01", "2026-09-02"], mahlzeiten: MAHLZEITEN,
  });
  const tag1 = gebaut[0];
  ok("der gueltige Eintrag kam an", tag1.mahlzeiten.dinner.length === 1);
  ok("unbekannter Schluessel verworfen",
     !Object.values(tag1.mahlzeiten).flat().some(z => z.name === "Pizza Salami"));
  ok("unbekannter Tag verworfen", gebaut.length === 2);
  ok("unbekannte Mahlzeit verworfen", (tag1.mahlzeiten.breakfast || []).length === 0);
  ok("dasselbe Gericht nicht zweimal am Tag", tag1.mahlzeiten.lunch.length === 0);
  const zuViel = gebaut[1].mahlzeiten.dinner[0];
  ok("Menge in die Grenzen gezwungen", zuViel.menge === KATALOG[4].max, String(zuViel.menge));
  // Die Zahlen stammen aus dem Katalog, nicht aus der Antwort — dieselbe Rechnung wie ueberall.
  ok("Naehrwerte selbst gerechnet",
     zuViel.kcal === p.naehrwerte(KATALOG[4], KATALOG[4].max).kcal, String(zuViel.kcal));
  ok("Summe gesetzt", Math.abs(gebaut[0].summe.kcal - tag1.mahlzeiten.dinner[0].kcal) < 0.01);

  const nurMuell = p.ausVorschlag(
    [{ tag: "2026-09-01", mahlzeit: "dinner", katalogKey: "gibtsnicht", menge: 1 }],
    { katalog: KATALOG, ziele: ZIELE, dateKeys: ["2026-09-01"], mahlzeiten: MAHLZEITEN }
  );
  ok("nur Unbekanntes -> leerer Tag, kein Absturz", nurMuell[0].leer === true);
  ok("leerer Vorschlag wirft nicht",
     p.ausVorschlag(null, { katalog: KATALOG, ziele: ZIELE, dateKeys: ["2026-09-01"], mahlzeiten: MAHLZEITEN })[0].leer);
}

// ---------------------------------------------------------------------------
console.log("\n14) Bestaetigen");
{
  const { bestaetigeGeplant, bestaetigeMahlzeit, getConsumptionForDate, sumConsumption } =
    await import("../js/consumption.js");

  const tage = plan(77, MAHLZEITEN, ["2026-09-05"]);
  const eintraege = p.uebernehmePlan(tage, ich.id);
  const summeVorher = sumConsumption(getConsumptionForDate(ich.id, "2026-09-05"));

  const einer = eintraege.find(e => e.meal === "dinner");
  const nachher = bestaetigeGeplant(einer.id);
  ok("die Marke ist weg", !!nachher && !("planned" in nachher));
  ok("in der Ablage ebenfalls", !Store.getConsumption().find(e => e.id === einer.id).planned);
  ok("updatedAt gesetzt", Store.getConsumption().find(e => e.id === einer.id).updatedAt > 0);
  ok("at unveraendert", Store.getConsumption().find(e => e.id === einer.id).at === einer.at);
  // Bestaetigen rechnet nichts neu: die Tagessumme darf sich dadurch nicht bewegen.
  const summeNachher = sumConsumption(getConsumptionForDate(ich.id, "2026-09-05"));
  ok("die Tagessumme bleibt gleich",
     Math.abs(summeNachher.kcal - summeVorher.kcal) < 0.01 &&
     Math.abs(summeNachher.netCarbs - summeVorher.netCarbs) < 0.01);
  ok("zweimal bestaetigen tut nichts", bestaetigeGeplant(einer.id) === null);

  const offen = getConsumptionForDate(ich.id, "2026-09-05").filter(e => e.planned && e.meal === "breakfast").length;
  const anzahl = bestaetigeMahlzeit(ich.id, "2026-09-05", "breakfast");
  ok("ganze Mahlzeit auf einmal", anzahl === offen && offen > 0, anzahl + "/" + offen);
  ok("Fruehstueck ist durch",
     getConsumptionForDate(ich.id, "2026-09-05").filter(e => e.planned && e.meal === "breakfast").length === 0);
  ok("Mittag steht noch als Plan",
     getConsumptionForDate(ich.id, "2026-09-05").some(e => e.planned && e.meal === "lunch"));

  // Ein bestaetigter Eintrag ist wieder ein normaler und darf die Schnellauswahl fuettern.
  const { frequent, recent } = rankFrequentItems(ich.id, "dinner", { maxFrequent: 20, maxRecent: 20 });
  ok("der bestaetigte taucht in der Schnellauswahl auf",
     [...frequent, ...recent].some(i => i.key === einer.barcode), einer.name);

  p.verwirfPlan(ich.id, "2026-09-05");
  for (const e of getConsumptionForDate(ich.id, "2026-09-05")) Store.removeConsumption(e.id);
}

// ---------------------------------------------------------------------------
console.log("\n15) Eiweiss ist das Ziel, Fett ist der Rest");
{
  const note = (kcal, netCarbs, fat, protein) => p.bewerteTag({ kcal, netCarbs, fat, protein }, ZIELE);
  const genau = note(1900, 15, 150, 110);

  // Der Korridor: bis zehn Gramm unter dem Ziel ist getroffen, nicht verfehlt.
  ok("5 g unter dem Ziel kostet nichts", note(1900, 15, 150, 105) === genau, String(note(1900, 15, 150, 105)));
  ok("genau 10 g unter kostet nichts", note(1900, 15, 150, 100) === genau);
  ok("15 g unter kostet", note(1900, 15, 150, 95) > genau);
  ok("darunter wird es stetig schlimmer", note(1900, 15, 150, 80) > note(1900, 15, 150, 95));
  ok("ueber dem Ziel kostet ebenfalls", note(1900, 15, 150, 130) > genau);
  // Gleicher Abstand, unterschiedliches Gewicht: zu wenig geht im Defizit an die Muskulatur.
  ok("20 g zu wenig wiegt schwerer als 20 g zu viel",
     note(1900, 15, 150, 90) > note(1900, 15, 150, 130));

  // Fett ist bei festen Kalorien, KH und Eiweiss rechnerisch bestimmt — es noch einmal zu
  // bewerten hiesse, dieselbe Abweichung zweimal zu zaehlen.
  ok("Fett aendert die Note nicht", note(1900, 15, 60, 110) === genau && note(1900, 15, 260, 110) === genau);
  ok("Kalorien zaehlen weiterhin", note(1500, 15, 150, 110) > genau);
  ok("KH ueber dem Limit bleibt ungueltig", note(1900, 21, 150, 110) === Infinity);
}

// ---------------------------------------------------------------------------
console.log("\n16) Die uebliche Portion ist der Median, nicht die letzte");
{
  const barcode = "77001";
  Store.cacheProduct(barcode, {
    barcode, name: "Testkaese", brand: "", servingSize: "30 g",
    per100: { kcal: 350, carbs: 0, fiber: 0, fat: 27, protein: 25 },
  });
  const iss = (gramm, vorTagen) => Store.addConsumption({
    id: crypto.randomUUID(), profileId: ich.id, barcode, name: "Testkaese", grams: gramm,
    servingG: 30, meal: "breakfast", dateKey: "2026-08-0" + (vorTagen % 9 + 1),
    kcal: 3.5 * gramm, netCarbs: 0, fat: 0.27 * gramm, protein: 0.25 * gramm,
    at: Date.now() - vorTagen * 86400000,
  });
  [40, 40, 50, 40, 40].forEach((g, i) => iss(g, i + 1));
  const finde = () => p.sammleKatalog(ich.id).find(k => k.key === barcode);
  ok("Median der ueblichen Mengen", finde().standard === 40, String(finde().standard));

  // Ein einzelner Ausreisser — etwa eine bestaetigte, aber grosszuegige Planportion — darf
  // die uebliche Menge NICHT verschieben. Sonst schaukelt sich der naechste Plan daran hoch.
  iss(200, 0);
  ok("ein Ausreisser verschiebt sie nicht", finde().standard === 40, String(finde().standard));
  ok("und damit auch die Obergrenze nicht", finde().max === 60, String(finde().max));

  // Isst man wirklich mehrfach mehr, zieht der Median nach — das ist dann die richtige Auskunft.
  [200, 200, 200].forEach((g, i) => iss(g, i + 20));
  ok("mehrfach mehr zieht ihn nach", finde().standard > 40, String(finde().standard));

  for (const e of Store.getConsumption().filter(e => e.barcode === barcode)) Store.removeConsumption(e.id);
}

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
