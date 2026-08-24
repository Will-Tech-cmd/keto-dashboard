// keto.js — Keto-Bewertung: Netto-Kohlenhydrate, Ampel, Zutaten-Warnungen.

// Zutaten, die auf hohen Blutzucker-wirksamen Kohlenhydratanteil hindeuten.
// Reihenfolge: spezifischere Begriffe zuerst, damit die Warnung präziser benannt wird.
const SUGAR_WARNINGS = [
  { pattern: /glucose[-\s]?fructose[-\s]?sirup/i, label: "Glukose-Fruktose-Sirup" },
  { pattern: /glukosesirup|glucosesirup/i, label: "Glukosesirup" },
  { pattern: /maltodextrin/i, label: "Maltodextrin" },
  { pattern: /dextrose|traubenzucker/i, label: "Dextrose/Traubenzucker" },
  { pattern: /agavendicksaft/i, label: "Agavendicksaft" },
  { pattern: /honig/i, label: "Honig" },
  { pattern: /laktose/i, label: "Laktose" },
  { pattern: /modifizierte st(ä|a)rke/i, label: "Modifizierte Stärke" },
  { pattern: /(?<!mais)st(ä|a)rke/i, label: "Stärke" },
  { pattern: /maltit/i, label: "Maltit (wirkt blutzuckerrelevant)" },
  { pattern: /\bzucker\b/i, label: "Zucker" },
];

// Zuckeralkohole, die manche Nutzer:innen von den Netto-KH abziehen (außer Maltit).
const SUGAR_ALCOHOL_PATTERN = /erythrit|xylit|sorbit(?!ol-frei)|isomalt/i;

export function findIngredientWarnings(ingredientsText) {
  if (!ingredientsText) return [];
  const found = [];
  const seen = new Set();
  for (const { pattern, label } of SUGAR_WARNINGS) {
    if (pattern.test(ingredientsText) && !seen.has(label)) {
      found.push(label);
      seen.add(label);
    }
  }
  return found;
}

export function hasSugarAlcohols(ingredientsText) {
  return !!ingredientsText && SUGAR_ALCOHOL_PATTERN.test(ingredientsText);
}

/**
 * Netto-Kohlenhydrate pro 100g.
 * EU-Etiketten (Regelfall bei uns) weisen Kohlenhydrate bereits OHNE Ballaststoffe aus,
 * US-Etiketten dagegen inklusive. Wir ziehen Ballaststoffe daher nur ab, wenn das Produkt
 * als US-Ware erkannt wurde, oder wenn die Nutzerin/der Nutzer das manuell umschaltet.
 */
export function calcNetCarbs(per100, { subtractFiber = false } = {}) {
  if (per100.carbs == null) return null;
  if (subtractFiber && per100.fiber != null) {
    return Math.max(per100.carbs - per100.fiber, 0);
  }
  return per100.carbs;
}

// Ernährungsformen mit Standard-Ampelgrenzwerten (g Netto-KH je 100g). Beim Wechsel der
// Ernährungsform im Profil werden diese als Vorschlag übernommen, bleiben aber frei editierbar.
export const DIET_TYPES = {
  keto: { label: "Keto", defaultThresholds: { green: 5, yellow: 10 } },
  lowcarb: { label: "Low-Carb", defaultThresholds: { green: 15, yellow: 30 } },
  other: { label: "Sonstiges", defaultThresholds: { green: 15, yellow: 30 } },
};

const DEFAULT_THRESHOLDS = DIET_TYPES.keto.defaultThresholds;

export function ketoGrade(netCarbs100, thresholds = DEFAULT_THRESHOLDS) {
  if (netCarbs100 == null) return "gray";
  if (netCarbs100 <= thresholds.green) return "green";
  if (netCarbs100 <= thresholds.yellow) return "yellow";
  return "red";
}

export const GRADE_LABEL = {
  green: "Empfohlen",
  yellow: "In Maßen",
  red: "Nicht empfohlen",
  gray: "Keine Angabe",
};

/**
 * Vollständige Bewertung eines Produkts inkl. Portionsbezug und Tageslimit-Anteil.
 * @param {object} product  normalisiertes Produkt aus off.js
 * @param {object} profileTargets  Rückgabe aus profiles.js calcTargets()
 * @param {object} opts  { subtractFiber, servingGrams }
 */
export function evaluateProduct(product, profileTargets, opts = {}) {
  const subtractFiber = opts.subtractFiber ?? product.likelyUsLabel;
  const netCarbs100 = calcNetCarbs(product.per100, { subtractFiber });
  const grade = ketoGrade(netCarbs100, profileTargets?.gradeThresholds);

  const servingGrams = opts.servingGrams ?? parseServingGrams(product.servingSize);
  const netCarbsServing = netCarbs100 != null && servingGrams
    ? +(netCarbs100 * servingGrams / 100).toFixed(1)
    : null;

  const pctOfDailyLimit = netCarbsServing != null && profileTargets?.netCarbG
    ? Math.round((netCarbsServing / profileTargets.netCarbG) * 100)
    : null;

  const warnings = findIngredientWarnings(product.ingredientsText);
  const sugarAlcohols = hasSugarAlcohols(product.ingredientsText);
  const plausibility = checkKcalPlausibility(product.per100);

  return {
    netCarbs100,
    netCarbsServing,
    servingGrams,
    pctOfDailyLimit,
    grade,
    gradeLabel: GRADE_LABEL[grade],
    warnings,
    sugarAlcohols,
    subtractFiber,
    fiberAvailable: product.per100.fiber != null,
    plausibility,
  };
}

/**
 * Grobe Plausibilitätsprüfung: passen die angegebenen kcal zu den Makros?
 * Nutzt die einfachen Atwater-Faktoren (Kohlenhydrate 4, Fett 9, Eiweiß 4 kcal/g) auf die
 * deklarierten Werte, ohne Annahmen über EU/US-Ballaststoff-Konvention zu treffen — damit
 * funktioniert der Check unabhängig davon, ob Ballaststoffe in "carbs" enthalten sind oder
 * nicht. Ballaststoffe fließen zusätzlich mit ~2 kcal/g ein (Atwater-Faktor für Ballaststoffe):
 * die deklarierte Energie schließt sie ein, auch wenn sie in "carbs" nicht mitgezählt werden
 * (EU-Konvention) — ohne diesen Anteil meldet die Prüfung bei ballaststoffreichen Produkten
 * (z.B. Flohsamenschalen) eine Abweichung, die es gar nicht gibt.
 * Bei mehr als 20% Abweichung ist ein Erfassungsfehler in den Rohdaten wahrscheinlich
 * (z.B. Kommafehler oder vertauschte/doppelt gezählte Werte).
 * Liefert null, wenn plausibel oder Daten fehlen.
 */
export function checkKcalPlausibility(per100) {
  const { kcal, carbs, fat, protein, fiber } = per100;
  if (kcal == null || carbs == null || fat == null || protein == null) return null;
  const calculated = carbs * 4 + (fiber || 0) * 2 + fat * 9 + protein * 4;
  if (calculated <= 0) return null;
  const deviationPct = Math.round((Math.abs(kcal - calculated) / calculated) * 100);
  if (deviationPct <= 20) return null;
  return { calculatedKcal: Math.round(calculated), deviationPct };
}

/** Versucht aus "30 g", "1 Riegel (45g)" etc. eine Grammzahl zu extrahieren. */
export function parseServingGrams(servingSize) {
  if (!servingSize) return null;
  const m = String(servingSize).match(/(\d+(?:[.,]\d+)?)\s*g/i);
  if (!m) return null;
  return parseFloat(m[1].replace(",", "."));
}

// ---------------------------------------------------------------------------
// Nährwerte eines Rezepts
//
// Hier und nicht in recipes.js: die Rechnung braucht nichts außer calcNetCarbs, und sie
// wird an drei Stellen gebraucht — in der App, beim Eintragen, und beim Abgleich für die
// Spalte, aus der das Kochbuch seine Kacheln zeichnet. recipes.js hängt am Store und am
// Bild-Import; von dort aus wäre sie für rows.js nicht erreichbar, ohne einen Ring zu
// schließen. recipes.js reicht beide unverändert weiter.
// ---------------------------------------------------------------------------

const rundeAufEineStelle = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** Summierte Nährwerte über alle Zutaten (gesamtes Rezept, nicht pro Portion). */
export function calcRecipeTotals(recipe) {
  return (recipe?.ingredients || []).reduce((acc, ing) => {
    const scale = (ing.grams || 0) / 100;
    const per100 = ing.per100 || {};
    const netCarbs100 = calcNetCarbs(per100, { subtractFiber: ing.likelyUsLabel });
    return {
      kcal: acc.kcal + (per100.kcal != null ? per100.kcal * scale : 0),
      netCarbs: acc.netCarbs + (netCarbs100 != null ? netCarbs100 * scale : 0),
      fat: acc.fat + (per100.fat != null ? per100.fat * scale : 0),
      protein: acc.protein + (per100.protein != null ? per100.protein * scale : 0),
    };
  }, { kcal: 0, netCarbs: 0, fat: 0, protein: 0 });
}

/** Nährwerte je Portion. */
export function calcPerServing(recipe) {
  const totals = calcRecipeTotals(recipe);
  const s = recipe?.servings || 1;
  return {
    kcal: rundeAufEineStelle(totals.kcal / s),
    netCarbs: rundeAufEineStelle(totals.netCarbs / s),
    fat: rundeAufEineStelle(totals.fat / s),
    protein: rundeAufEineStelle(totals.protein / s),
  };
}
