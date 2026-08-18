// profiles.js — Berechnung der individuellen Keto-Zielwerte aus Körperdaten.
import { Store, dateKeyOf } from "./store.js";

/**
 * Grundumsatz (BMR).
 * Ist ein Körperfettanteil bekannt, wird Katch-McArdle verwendet (genauer bei Low-Carb/Keto,
 * da es auf der fettfreien Masse basiert statt auf einer geschlechtsabhängigen Pauschale).
 * Sonst Mifflin-St Jeor als solider Standard.
 */
function calcBMR(p) {
  const { sex, age, heightCm, weightKg, bodyFatPct } = p;
  if (bodyFatPct != null && bodyFatPct > 0 && bodyFatPct < 70) {
    const leanMassKg = weightKg * (1 - bodyFatPct / 100);
    return 370 + 21.6 * leanMassKg;
  }
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

function leanMassKg(p) {
  if (p.bodyFatPct != null && p.bodyFatPct > 0 && p.bodyFatPct < 70) {
    return p.weightKg * (1 - p.bodyFatPct / 100);
  }
  // Ohne bekannten Körperfettanteil: konservative Schätzung als Berechnungsgrundlage fürs Eiweiß.
  return p.weightKg * (p.sex === "male" ? 0.8 : 0.75);
}

const GOAL_LABELS = { lose: "Abnehmen", maintain: "Halten", gain: "Muskelaufbau" };
const ACTIVITY_LABELS = {
  1.2: "Kaum Bewegung (Bürojob, kein Sport)",
  1.375: "Leicht aktiv (1–3× Sport/Woche)",
  1.55: "Mäßig aktiv (3–5× Sport/Woche)",
  1.725: "Sehr aktiv (6–7× Sport/Woche, körperliche Arbeit)",
};

/**
 * Vollständige Makro-Zielwerte für ein Profil.
 * Rückgabe in Gramm/Tag sowie als grobe Prozentverteilung der Kalorien.
 */
export function calcTargets(p) {
  const bmr = calcBMR(p);
  const tdee = bmr * p.activity;

  let kcal = tdee;
  if (p.goal === "lose") kcal = tdee * (1 - p.deficitPct / 100);
  else if (p.goal === "gain") kcal = tdee * 1.1;

  const lean = leanMassKg(p);
  const proteinG = Math.round(lean * p.proteinFactor);
  const netCarbG = Math.round(p.netCarbLimitG);

  const proteinKcal = proteinG * 4;
  const carbKcal = netCarbG * 4;
  const fatKcal = Math.max(kcal - proteinKcal - carbKcal, 0);
  const fatG = Math.round(fatKcal / 9);

  kcal = Math.round(proteinKcal + carbKcal + fatKcal);

  const totalKcal = kcal || 1;
  return {
    kcal,
    proteinG,
    fatG,
    netCarbG,
    percent: {
      protein: Math.round((proteinKcal / totalKcal) * 100),
      fat: Math.round((fatKcal / totalKcal) * 100),
      carbs: Math.round((carbKcal / totalKcal) * 100),
    },
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    dietType: p.dietType,
    gradeThresholds: p.gradeThresholds,
  };
}

/**
 * Zielwerte für einen bestimmten Tag.
 *
 * Profildaten ändern sich (Gewicht, Ziel, Aktivität) — ohne Schnappschuss würden dadurch
 * rückwirkend auch alle vergangenen Tage und die 30-Tage-Auswertung neu bewertet, was die
 * Historie verfälscht. Deshalb:
 *   - heute/Zukunft  -> aktuelle Berechnung, und der Schnappschuss wird nachgeführt
 *   - Vergangenheit  -> eingefrorener Schnappschuss (Rückfall: aktuelle Werte, falls der
 *                       Tag noch aus der Zeit vor dieser Funktion stammt)
 *
 * Der Schnappschuss wird beim Eintragen und bei jedem Anzeigen des heutigen Tages
 * nachgeführt, sodass am Tagesende der zuletzt gültige Stand festgehalten ist.
 */
export function getTargetsForDate(profile, dateKey) {
  const live = calcTargets(profile);
  const todayKey = dateKeyOf(Date.now());

  if (dateKey >= todayKey) {
    Store.setDayTargets(profile.id, dateKey, {
      kcal: live.kcal, netCarbG: live.netCarbG, fatG: live.fatG, proteinG: live.proteinG,
    });
    return live;
  }

  const frozen = Store.getDayTargets(profile.id, dateKey);
  if (!frozen) return live;
  // Nur die Mengen sind historisch; Ampelgrenzen/Ernährungsform bleiben die aktuellen,
  // damit die Bewertung überall nach denselben Maßstäben erfolgt.
  return { ...live, ...frozen, isFrozen: true };
}

export const Goals = GOAL_LABELS;
export const ActivityLevels = ACTIVITY_LABELS;
