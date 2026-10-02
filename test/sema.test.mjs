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

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : `\n${fails} Pruefung(en) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);
