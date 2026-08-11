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

export function ketoGrade(netCarbs100) {
  if (netCarbs100 == null) return "gray";
  if (netCarbs100 <= 5) return "green";
  if (netCarbs100 <= 10) return "yellow";
  return "red";
}

export const GRADE_LABEL = {
  green: "Keto-tauglich",
  yellow: "In Maßen",
  red: "Nicht keto",
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
  const grade = ketoGrade(netCarbs100);

  const servingGrams = opts.servingGrams ?? parseServingGrams(product.servingSize);
  const netCarbsServing = netCarbs100 != null && servingGrams
    ? +(netCarbs100 * servingGrams / 100).toFixed(1)
    : null;

  const pctOfDailyLimit = netCarbsServing != null && profileTargets?.netCarbG
    ? Math.round((netCarbsServing / profileTargets.netCarbG) * 100)
    : null;

  const warnings = findIngredientWarnings(product.ingredientsText);
  const sugarAlcohols = hasSugarAlcohols(product.ingredientsText);

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
  };
}

/** Versucht aus "30 g", "1 Riegel (45g)" etc. eine Grammzahl zu extrahieren. */
export function parseServingGrams(servingSize) {
  if (!servingSize) return null;
  const m = String(servingSize).match(/(\d+(?:[.,]\d+)?)\s*g/i);
  if (!m) return null;
  return parseFloat(m[1].replace(",", "."));
}
