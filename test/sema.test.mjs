// Sema (sema/): Rechnen, Sieben-Tage-Grenze, Sucheingabe und Austausch zwischen zwei Geräten.
//
// Die Akzeptanzkriterien aus der Spezifikation, soweit sie ohne Browser prüfbar sind: die
// Knoppers-Rechnung, „Birne 50 g“, die Summe aus ungerundeten Werten und dass ein Export auf
// Gerät A beim Import auf Gerät B alle Favoriten ankommen lässt — ohne Bs eigene zu löschen.
const L = await import("../sema/js/logik.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };

console.log("\nSucheingabe zerlegen");
ok("„Birne 50 g“", JSON.stringify(L.sucheZerlegen("Birne 50 g")) === '{"name":"Birne","gramm":50}', JSON.stringify(L.sucheZerlegen("Birne 50 g")));
ok("„Birne, 50g“", L.sucheZerlegen("Birne, 50g").gramm === 50);
ok("Komma als Dezimaltrenner", L.sucheZerlegen("Reis 12,5 g").gramm === 12.5);
ok("ohne Zahl bleibt gramm null", L.sucheZerlegen("Brezel").gramm === null);
ok("Zahl im Namen ist keine Menge", L.sucheZerlegen("7-Korn-Brot").name === "7-Korn-Brot");
ok("nur eine Zahl ist kein Name", L.sucheZerlegen("50").name === "50" && L.sucheZerlegen("50").gramm === null);

console.log("\nKnoppers: 52,6 g KH/100 g, 1 Stück = 20 g, 3 Stück");
const kh = 3 * 20 * 52.6 / 100;
ok("31,56 g → angezeigt 32", L.r0(kh) === "32", L.r0(kh));

console.log("\nSumme aus ungerundeten Werten");
// Fünf mal 1,4 g: einzeln gerundet je 1 → 5; richtig ist 7.
const fuenf = Array.from({ length: 5 }, () => ({ kh: 1.4 }));
ok("5 × 1,4 g ergibt 7, nicht 5", L.r0(L.summeKh(fuenf)) === "7", L.r0(L.summeKh(fuenf)));

console.log("\nFavoriten: KH je 100 g oder je Portion");
const eis = { name: "Kugel Eis", unit: "Kugel", portionG: 50, kh100: 24, khPortion: null };
const waffel = { name: "Waffel", unit: "Stück", portionG: null, kh100: null, khPortion: 9 };
ok("Eis: 50 g × 24 % = 12 g", L.favKhJePortion(eis) === 12);
ok("Waffel: 9 g je Stück", L.favKhJePortion(waffel) === 9);
ok("Eis 80 g → 19,2 g", L.favKhFuerGramm(eis, 80) === 19.2);
ok("Waffel ohne Gewicht: Gramm nicht umrechenbar", L.favKhFuerGramm(waffel, 30) === null);
ok("Portionstext", L.favPortionText(eis, 1.5) === "1,5 Kugel (75 g)", L.favPortionText(eis, 1.5));

console.log("\nSieben Tage behalten");
const heute = "2026-10-02";
const e = (date) => ({ id: date, date, kh: 1 });
const rest = L.altesEntfernen([e("2026-09-25"), e("2026-09-26"), e("2026-10-01"), e(heute)], heute);
ok("26.9. bleibt (7. Tag), 25.9. fällt weg", rest.map(x => x.date).join() === "2026-09-26,2026-10-01,2026-10-02", rest.map(x => x.date).join());
ok("Vortag über Monatsgrenze", L.tagVerschieben("2026-10-01", -1) === "2026-09-30");
ok("Vortag über Zeitumstellung (25.10.)", L.tagVerschieben("2026-10-26", -1) === "2026-10-25");

console.log("\nFoto: Gewicht verteilen und Spanne");
const komps = [{ name: "Vanilleeis", gramm: 80, kh100: 24 }, { name: "Sahne", gramm: 20, kh100: 3 }];
const verteilt = L.aufGewichtVerteilen(komps, 150);
ok("Summe = gewogenes Gewicht", Math.abs(verteilt.reduce((a, k) => a + k.gramm, 0) - 150) < 1e-9);
ok("Verhältnis bleibt 4:1", Math.abs(verteilt[0].gramm / verteilt[1].gramm - 4) < 1e-9);
ok("ohne Gewicht unverändert", L.aufGewichtVerteilen(komps, 0) === komps);
const sp = L.fotoSpanne([{ kh: 10, konfidenz: 0.8 }, { kh: 5, konfidenz: 0.5 }]);
ok("Spanne 10,5–19,5 um 15", sp.summe === 15 && Math.abs(sp.min - 10.5) < 1e-9 && Math.abs(sp.max - 19.5) < 1e-9, JSON.stringify(sp));

console.log("\nExport auf Gerät A, Import auf Gerät B");
const a = {
  favs: [
    { id: "a1", name: "Milchschnitte", unit: "Stück", portionG: 28, kh100: 30, updatedAt: 200 },
    { id: "g1", name: "Müsli", unit: "Portion", portionG: 25, kh100: 64, updatedAt: 300 },
  ],
  profil: { name: "Sema", gewicht: "18,5", gewichtDatum: "2026-07-12T10:00:00.000Z" },
  einstellungen: { anbieter: "OpenAI", keys: { OpenAI: "sk-geheim" } },
};
const datei = JSON.parse(JSON.stringify(L.exportDaten(a)));
ok("API-Key steht NICHT in der Datei", !JSON.stringify(datei).includes("sk-geheim"));
ok("Datei wird erkannt", L.importPruefen(datei) === datei);
let wirft = false; try { L.importPruefen({ favs: [] }); } catch { wirft = true; }
ok("fremde Datei wird abgelehnt", wirft);
const b = [
  { id: "b1", name: "Brezel", unit: "Brezel", portionG: 60, kh100: 53, updatedAt: 100 },
  { id: "g1", name: "Müsli (alt)", unit: "Portion", portionG: 25, kh100: 60, updatedAt: 100 },
];
const { favs, geaendert } = L.favsZusammenfuehren(b, datei.favs);
ok("alle Favoriten von A sind auf B", datei.favs.every(f => favs.some(x => x.id === f.id && x.name === f.name)));
ok("Bs eigener Favorit bleibt", favs.some(x => x.id === "b1"));
ok("jüngere Fassung gewinnt", favs.find(x => x.id === "g1").name === "Müsli");
ok("2 übernommen", geaendert === 2, geaendert);
const zurueck = L.favsZusammenfuehren(favs, b);
ok("älterer Rückimport überschreibt nichts", zurueck.geaendert === 0 && zurueck.favs.find(x => x.id === "g1").name === "Müsli");

console.log("\nLebensmittel-Liste: Startwerte");
const { GRUNDDATEN, GRUND_VERSION } = await import("../sema/js/grunddaten.js");
ok("Version gesetzt", GRUND_VERSION >= 1);
ok("ids eindeutig", new Set(GRUNDDATEN.map(g => g.id)).size === GRUNDDATEN.length);
ok("kein Startwert ist bestätigt", GRUNDDATEN.every(g => g.verifiziert === false && g.updatedAt === 0));
ok("alle Werte 0–100 oder Platzhalter", GRUNDDATEN.every(g => g.kh100 === null || (g.kh100 >= 0 && g.kh100 <= 100)));
const beilagen = GRUNDDATEN.filter(g => g.kategorie === "Beilage");
ok("jede Beilage nennt roh/gekocht", beilagen.length > 0 && beilagen.every(g => g.zustand === "roh" || g.zustand === "gekocht"));
const elternwert = { ...GRUNDDATEN[0], kh100: 13, verifiziert: true, updatedAt: 500 };
const erg = L.grundErgaenzen([elternwert], GRUNDDATEN);
ok("Ergänzen fügt nur Fehlendes hinzu", erg.liste.length === GRUNDDATEN.length && erg.neu === GRUNDDATEN.length - 1);
ok("Elternwert wird nicht überschrieben", erg.liste.find(g => g.id === elternwert.id).kh100 === 13);
ok("Name zeigt Zustand", L.grundName({ name: "Reis", zustand: "gekocht" }) === "Reis (gekocht)");
ok("Platzhalter hat keinen Wert", !L.grundHatWert({ kh100: null }) && L.grundHatWert({ kh100: 0 }));

console.log("\nBekannte Werte finden");
const quellen = {
  favs: [{ name: "Vanilleeis", kh100: 24 }],
  grund: [{ name: "Reis", zustand: "gekocht", kh100: 28, verifiziert: true }, { name: "Banane", zustand: "roh", kh100: 20, verifiziert: false }],
  produkte: [],
};
ok("Favorit vor allem anderen", L.bekanntenWertFinden("Vanilleeis", quellen)?.kh100 === 24);
ok("Zustand im Namen stört nicht", L.bekanntenWertFinden("Reis", quellen)?.kh100 === 28);
ok("Richtwert als letzte Quelle", L.bekanntenWertFinden("Banane", quellen)?.quelle === "Richtwert");
ok("„Ei“ passt nicht auf „Eis“", L.bekanntenWertFinden("Ei", quellen) === null);
// Gefunden im Browsertest: „Reis (roh)“ bekam den Wert von gekochtem Reis (28 statt 78).
const reis = { favs: [], produkte: [], grund: [
  { name: "Reis", zustand: "gekocht", kh100: 28, verifiziert: false },
  { name: "Reis", zustand: "roh", kh100: 78, verifiziert: false },
] };
ok("„Reis (roh)“ → 78, nicht gekocht", L.bekanntenWertFinden("Reis (roh)", reis)?.kh100 === 78, JSON.stringify(L.bekanntenWertFinden("Reis (roh)", reis)));
ok("„Reis gekocht“ → 28", L.bekanntenWertFinden("Reis gekocht", reis)?.kh100 === 28);
ok("bloß „Reis“ ist mehrdeutig → kein Wert", L.bekanntenWertFinden("Reis", reis) === null);
ok("Abweichung 30 % erkannt", L.abweichung(26, 20) > L.KI_ABWEICHUNG_GRENZE);
ok("Abweichung 10 % ok", L.abweichung(22, 20) <= L.KI_ABWEICHUNG_GRENZE);

console.log("\nPlausibilität");
ok("120 g KH je 100 g gewarnt", L.plausibilitaet({ kh100: 120 }).length === 1);
ok("1,5 kg gewarnt", L.plausibilitaet({ gramm: 1500 }).length === 1);
ok("normaler Wert still", L.plausibilitaet({ kh100: 12, gramm: 80 }).length === 0);
ok("Grenze leer = aus", !L.mahlzeitUeberGrenze(500, ""));
ok("Grenze 60 bei 61 g", L.mahlzeitUeberGrenze(61, "60") && !L.mahlzeitUeberGrenze(60, "60"));

console.log("\nTeilverzehr");
const apfel = { id: "x", name: "Apfel", kh: 12, gramm: 100 };
const halb = L.teilVerzehr(apfel, 0.5);
ok("½ → 6 g, Ursprung 12 g", halb.kh === 6 && halb.khUrspruenglich === 12 && halb.anteil === 0.5);
ok("zweimal ½ bleibt ½ (bezieht sich auf die Eingabe)", L.teilVerzehr(halb, 0.5).kh === 6);
ok("½ → ¾ korrigierbar", L.teilVerzehr(halb, 0.75).kh === 9);
const ganz = L.teilVerzehr(halb, 1);
ok("„alles“ stellt die Eingabe her", ganz.kh === 12 && ganz.anteil === undefined && ganz.khUrspruenglich === undefined);
ok("Rest 30 g von 100 g → 70 %", L.anteilAusRest(100, "30") === 0.7);
ok("Rest schwerer als Portion → 0", L.anteilAusRest(100, 150) === 0);
ok("ohne Ausgangsgewicht kein Anteil", L.anteilAusRest(null, 30) === null);

console.log("\nEigenes Gericht");
// 100 g Milchreis roh (78 %), 500 g Milch (4,8 %), 30 g Zucker (100 %), fertig 600 g
const mr = L.rezeptRechnen([{ gStr: "100", kh100Str: "78" }, { gStr: "500", kh100Str: "4,8" }, { gStr: "30", kh100Str: "100" }], "600");
ok("KH gesamt 132 g", Math.abs(mr.khGesamt - 132) < 1e-9, mr.khGesamt);
ok("22 g KH je 100 g fertig", Math.abs(mr.kh100 - 22) < 1e-9, mr.kh100);
ok("ohne Endgewicht kein Wert", L.rezeptRechnen([{ gStr: "100", kh100Str: "78" }], "").kh100 === null);

console.log("\nBehälter");
ok("320 − 180 = 140", L.taraAbziehen("320", 180) === 140);
ok("nie negativ", L.taraAbziehen("100", 180) === 0);

console.log("\nTeilen");
const t0 = new Date(2026, 9, 13, 10, 15).getTime();
const text = L.teilenText({ titel: "Sema · Di", eintraege: [
  { meal: "Snack", name: "Apfel", amount: "80 g", kh: 4.5, khUrspruenglich: 9, anteil: 0.5, createdAt: t0, src: "fav" },
  { meal: "Snack", name: "Waffel", amount: "1 Stück", kh: 12, createdAt: t0 + 60000, src: "ki" },
] });
ok("Uhrzeit des ersten Eintrags", text.includes("10:15 Snack: 17 g KH"), text);
ok("Teilverzehr markiert", text.includes("½ gegessen, eingegeben 9 g"), text);
ok("KI markiert", text.includes("KI geschätzt"), text);

console.log("\nExport/Import mit Liste und Behältern");
const grund = [{ id: "g-apfel", name: "Apfel", kh100: 11.4, updatedAt: 0 }, { id: "g-birne", name: "Birne", kh100: 12, verifiziert: true, updatedAt: 900 }];
const d2 = JSON.parse(JSON.stringify(L.exportDaten({ ...a, grund, behaelter: [{ id: "b", name: "Vesperbox", gramm: 180, updatedAt: 1 }] })));
ok("nur geänderte Listenwerte im Export", d2.grund.length === 1 && d2.grund[0].id === "g-birne");
ok("Behälter im Export", d2.behaelter.length === 1);
const alt1 = L.importPruefen({ format: "sema-backup", version: 1, favs: [] });
ok("Version-1-Datei bleibt lesbar", Array.isArray(alt1.grund) && Array.isArray(alt1.behaelter));
const zg = L.listenZusammenfuehren(grund.map(g => g.id === "g-birne" ? { ...g, verifiziert: false, updatedAt: 0 } : g), d2.grund);
ok("Bestätigung kommt auf dem zweiten Gerät an", zg.favs.find(g => g.id === "g-birne").verifiziert === true);

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : `\n${fails} Pruefung(en) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);
