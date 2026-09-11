// Prüft die eingebaute Nährwerttabelle (js/foods-db.js) auf Plausibilität.
//
// Die Werte sind von Hand eingetragene Richtwerte aus Nährwerttabellen. Ein Tippfehler in
// einer Zeile fällt beim Lesen nicht auf, wirkt sich aber auf jeden Tag aus, an dem das
// Lebensmittel eingetragen wird. Zwei Prüfungen fangen die Sorte Fehler ab, die zählt:
//
//   1. Die Bestandteile können zusammen keine 100 g je 100 g überschreiten.
//   2. Die Kalorien müssen zu den Bestandteilen passen (Atwater: 4 kcal/g Kohlenhydrate und
//      Eiweiß, 9 kcal/g Fett, 2 kcal/g Ballaststoffe). Die Toleranz ist bewusst weit — die
//      Faktoren sind Näherungen, und Hersteller runden —, aber ein um den Faktor zwei
//      danebenliegender Wert kommt nicht durch.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { FOODS } = await import("../js/foods-db.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };

console.log(`\nEingebaute Tabelle: ${FOODS.length} Lebensmittel`);

const felder = ["kcal", "carbs", "fiber", "sugars", "fat", "saturatedFat", "protein", "salt"];
const unvollstaendig = FOODS.filter(f => felder.some(k => typeof f.per100[k] !== "number"));
ok("jeder Eintrag hat alle acht Werte als Zahl", unvollstaendig.length === 0,
   unvollstaendig.map(f => f.name).join(", "));

const negativ = FOODS.filter(f => felder.some(k => f.per100[k] < 0));
ok("keine negativen Werte", negativ.length === 0, negativ.map(f => f.name).join(", "));

const zuSchwer = FOODS.filter(f => {
  const p = f.per100;
  return p.carbs + p.fiber + p.fat + p.protein + p.salt > 100.5;
});
ok("Bestandteile ergeben höchstens 100 g je 100 g", zuSchwer.length === 0,
   zuSchwer.map(f => `${f.name}: ${(f.per100.carbs + f.per100.fiber + f.per100.fat + f.per100.protein + f.per100.salt).toFixed(1)} g`).join(", "));

const zuckerZuHoch = FOODS.filter(f => f.per100.sugars > f.per100.carbs + 0.05);
ok("Zucker steckt in den Kohlenhydraten", zuckerZuHoch.length === 0,
   zuckerZuHoch.map(f => `${f.name}: ${f.per100.sugars} von ${f.per100.carbs}`).join(", "));

const gesaettigtZuHoch = FOODS.filter(f => f.per100.saturatedFat > f.per100.fat + 0.05);
ok("gesättigtes Fett steckt im Fett", gesaettigtZuHoch.length === 0,
   gesaettigtZuHoch.map(f => `${f.name}: ${f.per100.saturatedFat} von ${f.per100.fat}`).join(", "));

// Atwater, mit Ballaststoffen zu 2 kcal/g. Unter 40 kcal ist die relative Abweichung
// aussagelos (Gurke: 12 gerechnet, 15 angegeben sind 25 % und trotzdem richtig) — dort
// zählt der absolute Abstand.
// Kakao ist der bekannte Sonderfall: die USDA rechnet ihn mit eigenen, niedrigeren Faktoren
// (ein Teil der Kohlenhydrate und Ballaststoffe wird nicht verwertet), deshalb stehen dort
// 228 kcal, wo Atwater 372 ergäbe. Der Wert ist richtig, die Formel passt nur nicht.
const AUSNAHMEN = { kakaopulver: "USDA rechnet Kakao mit eigenen Faktoren" };

const schief = [];
for (const f of FOODS) {
  if (AUSNAHMEN[f.slug]) continue;
  const p = f.per100;
  const gerechnet = 4 * p.carbs + 4 * p.protein + 9 * p.fat + 2 * p.fiber;
  const abstand = Math.abs(gerechnet - p.kcal);
  const relativ = p.kcal > 0 ? abstand / p.kcal : 0;
  if (abstand > 25 && relativ > 0.25) schief.push(`${f.name}: angegeben ${p.kcal}, gerechnet ${Math.round(gerechnet)}`);
}
ok("Kalorien passen zu den Bestandteilen", schief.length === 0, schief.join(" | "));

const ohnePortion = FOODS.filter(f => !(f.servingG > 0));
ok("jeder Eintrag hat eine Portionsgröße", ohnePortion.length === 0, ohnePortion.map(f => f.name).join(", "));

const slugs = FOODS.map(f => f.slug);
ok("keine doppelten Schlüssel", new Set(slugs).size === slugs.length,
   slugs.filter((s, i) => slugs.indexOf(s) !== i).join(", "));

// Die Gewürze sind neu und alle auf 5 g Portion angelegt.
const gewuerze = ["salz", "pfeffer-schwarz", "paprikapulver", "chilipulver", "knoblauchpulver",
  "zwiebelpulver", "oregano-getrocknet", "basilikum-getrocknet", "thymian-getrocknet",
  "rosmarin-getrocknet", "majoran-getrocknet", "petersilie-getrocknet", "currypulver",
  "kreuzkuemmel", "koriander-gemahlen", "kuemmel", "senfmehl", "ingwer-gemahlen", "kurkuma",
  "zimt-gemahlen", "muskatnuss", "lorbeerblaetter"];
const fehlend = gewuerze.filter(g => !slugs.includes(g));
ok(`alle ${gewuerze.length} Gewürze sind da`, fehlend.length === 0, fehlend.join(", "));
const falschePortion = gewuerze.map(g => FOODS.find(f => f.slug === g)).filter(f => f && f.servingG !== 5);
ok("Gewürze haben 5 g Portionsgröße", falschePortion.length === 0, falschePortion.map(f => `${f.name}: ${f.servingG}`).join(", "));

// Eine 5-g-Portion Gewürz soll das Tagesbudget nicht sprengen — sonst stimmt etwas nicht.
const teuer = gewuerze.map(g => FOODS.find(f => f.slug === g))
  .filter(f => f && f.per100.carbs * 0.05 > 5);
ok("5 g Gewürz bleiben unter 5 g Netto-KH", teuer.length === 0,
   teuer.map(f => `${f.name}: ${(f.per100.carbs * 0.05).toFixed(1)} g`).join(", "));

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : `\n${fails} Pruefung(en) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);
