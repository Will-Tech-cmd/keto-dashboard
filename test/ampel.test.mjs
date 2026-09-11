// Die Ampel bewertet eine PORTION, nicht 100 g.
//
// Die Grenzwerte (bei Keto 5 g grün, 10 g gelb) stehen neben einem Tagesbudget von rund 20 g
// Netto-KH. Eine Portion mit 5 g ist ein Viertel des Tages — das soll der Punkt sagen. Je
// 100 g zu bewerten ging an der Frage vorbei, sobald eine Portion viel kleiner ist: 5 g
// Oregano kosten 1,3 g, die Zeile stand aber auf Rot, weil 100 g Oregano 26,5 g hätten.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { ketoGrade, evaluateProduct } = await import("../js/keto.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };

const keto = { green: 5, yellow: 10 };

console.log("\nOhne Portionsgröße bleibt es bei 100 g");
ok("0.6 g -> grün", ketoGrade(0.6, keto) === "green");
ok("7 g -> gelb", ketoGrade(7, keto) === "yellow");
ok("26.5 g -> rot", ketoGrade(26.5, keto) === "red");
ok("null -> grau", ketoGrade(null, keto) === "gray");
ok("servingG null zählt wie ohne", ketoGrade(26.5, keto, null) === "red");
ok("servingG 0 zählt wie ohne", ketoGrade(26.5, keto, 0) === "red");

console.log("\nMit Portionsgröße zählt die Portion");
// 5 g Oregano: 26.5 * 5/100 = 1.325 g
ok("Oregano 26.5 g je 100 g, Portion 5 g -> grün", ketoGrade(26.5, keto, 5) === "green",
   ketoGrade(26.5, keto, 5));
// Knoblauchpulver ist das teuerste Gewürz: 63.7 * 5/100 = 3.2 g
ok("Knoblauchpulver 63.7 g, Portion 5 g -> grün", ketoGrade(63.7, keto, 5) === "green");
// Eine große Portion kann eine Zeile auch schlechter machen — das ist der Sinn der Sache.
ok("Naturjoghurt 4.7 g je 100 g, Portion 150 g (7.05 g) -> gelb", ketoGrade(4.7, keto, 150) === "yellow",
   ketoGrade(4.7, keto, 150));
ok("Vollmilch 4.8 g je 100 g, Portion 200 g (9.6 g) -> gelb", ketoGrade(4.8, keto, 200) === "yellow");
ok("Karotten 6 g je 100 g, Portion 80 g (4.8 g) -> grün", ketoGrade(6, keto, 80) === "green");
// Genau auf der Grenze zählt noch als bestanden.
ok("genau 5 g je Portion -> grün", ketoGrade(10, keto, 50) === "green");
ok("knapp darüber -> gelb", ketoGrade(10.2, keto, 50) === "yellow");

console.log("\nevaluateProduct nimmt die Portionsgröße des Produkts");
const oregano = {
  barcode: "local:oregano-getrocknet", name: "Oregano getrocknet", servingSize: "5 g",
  likelyUsLabel: false, per100: { kcal: 265, carbs: 26.5, fiber: 42.5, fat: 4.3, protein: 9 },
};
const ziele = { gradeThresholds: keto, netCarbG: 20 };
const e = evaluateProduct(oregano, ziele);
ok("Ampel grün", e.grade === "green", e.grade);
ok("Netto-KH je 100 g bleibt 26.5", e.netCarbs100 === 26.5, String(e.netCarbs100));
ok("je Portion 1.3", e.netCarbsServing === 1.3, String(e.netCarbsServing));
ok("6 % des Tageslimits", e.pctOfDailyLimit === 7 || e.pctOfDailyLimit === 6, String(e.pctOfDailyLimit));

const ohnePortion = { ...oregano, servingSize: "" };
ok("ohne Portionsgröße wieder rot", evaluateProduct(ohnePortion, ziele).grade === "red");

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : `\n${fails} Pruefung(en) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);
