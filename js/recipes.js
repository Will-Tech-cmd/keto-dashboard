// recipes.js — Rezept-Verwaltung, Nährwert-Summierung, Zutaten-Text-Parser, OCR-Import.
import { Store } from "./store.js";
import { calcNetCarbs } from "./keto.js";
import { getActiveDateKey } from "./consumption.js";

function round1(v) {
  return v == null ? null : Math.round(v * 10) / 10;
}

export function createRecipe(name, servings) {
  const recipe = {
    id: crypto.randomUUID(),
    name: name.trim() || "Neues Rezept",
    servings: servings && servings > 0 ? servings : 1,
    ingredients: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  Store.saveRecipe(recipe);
  return recipe;
}

export function updateRecipeMeta(recipeId, patch) {
  const recipe = Store.getRecipe(recipeId);
  if (!recipe) return null;
  Object.assign(recipe, patch, { updatedAt: Date.now() });
  Store.saveRecipe(recipe);
  return recipe;
}

export function deleteRecipe(recipeId) {
  Store.deleteRecipe(recipeId);
}

/** ingredient: { name, grams, per100, likelyUsLabel } — per100 wird als Schnappschuss übernommen. */
export function addIngredient(recipeId, ingredient) {
  const recipe = Store.getRecipe(recipeId);
  if (!recipe) return null;
  recipe.ingredients.push({
    id: crypto.randomUUID(),
    name: ingredient.name,
    grams: ingredient.grams,
    per100: ingredient.per100,
    likelyUsLabel: !!ingredient.likelyUsLabel,
  });
  recipe.updatedAt = Date.now();
  Store.saveRecipe(recipe);
  return recipe;
}

export function removeIngredient(recipeId, ingredientId) {
  const recipe = Store.getRecipe(recipeId);
  if (!recipe) return null;
  recipe.ingredients = recipe.ingredients.filter(i => i.id !== ingredientId);
  recipe.updatedAt = Date.now();
  Store.saveRecipe(recipe);
  return recipe;
}

export function updateIngredient(recipeId, ingredientId, patch) {
  const recipe = Store.getRecipe(recipeId);
  if (!recipe) return null;
  const ing = recipe.ingredients.find(i => i.id === ingredientId);
  if (!ing) return null;
  Object.assign(ing, patch);
  recipe.updatedAt = Date.now();
  Store.saveRecipe(recipe);
  return recipe;
}

/** Summierte Nährwerte über alle Zutaten (gesamtes Rezept, nicht pro Portion). */
export function calcRecipeTotals(recipe) {
  return recipe.ingredients.reduce((acc, ing) => {
    const scale = (ing.grams || 0) / 100;
    const netCarbs100 = calcNetCarbs(ing.per100, { subtractFiber: ing.likelyUsLabel });
    return {
      kcal: acc.kcal + (ing.per100.kcal != null ? ing.per100.kcal * scale : 0),
      netCarbs: acc.netCarbs + (netCarbs100 != null ? netCarbs100 * scale : 0),
      fat: acc.fat + (ing.per100.fat != null ? ing.per100.fat * scale : 0),
      protein: acc.protein + (ing.per100.protein != null ? ing.per100.protein * scale : 0),
    };
  }, { kcal: 0, netCarbs: 0, fat: 0, protein: 0 });
}

export function calcPerServing(recipe) {
  const totals = calcRecipeTotals(recipe);
  const s = recipe.servings || 1;
  return {
    kcal: round1(totals.kcal / s),
    netCarbs: round1(totals.netCarbs / s),
    fat: round1(totals.fat / s),
    protein: round1(totals.protein / s),
  };
}

/** Trägt N Portionen eines Rezepts als "gegessen" für das aktive Profil am aktiven Planungstag ein. */
export function logRecipeConsumption(recipe, servings, meal = null) {
  const perServing = calcPerServing(recipe);
  const profile = Store.getActiveProfile();
  const entry = {
    id: crypto.randomUUID(),
    profileId: profile.id,
    barcode: `recipe:${recipe.id}`,
    name: recipe.name,
    servings,
    meal,
    dateKey: getActiveDateKey(),
    kcal: round1(perServing.kcal * servings),
    netCarbs: round1(perServing.netCarbs * servings),
    fat: round1(perServing.fat * servings),
    protein: round1(perServing.protein * servings),
    at: Date.now(),
  };
  Store.addConsumption(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Zutaten-Text-Parser: wandelt eingefügten/erkannten Text in strukturierte
// Zeilen um (Menge, Einheit, Name). Wird sowohl für den Bild-Import (OCR-Text)
// als auch für manuelles Text-Einfügen verwendet.
// ---------------------------------------------------------------------------

const UNIT_GRAMS = {
  g: 1, gr: 1, gramm: 1,
  kg: 1000, kilo: 1000, kilogramm: 1000,
  ml: 1, milliliter: 1,
  l: 1000, liter: 1000,
  el: 15, essl: 15, esslöffel: 15,
  tl: 5, teel: 5, teelöffel: 5,
  zehe: 5, zehen: 5,
  prise: 1, prisen: 1,
};

const SIZE_QUALIFIERS = /\b(kleine[rs]?|mittlere[rs]?|große[rs]?|groß)\b/gi;
const LEADING_DESCRIPTORS = /\b(geriebene[rs]?|gehackte[rs]?|frische[rs]?|getrocknete[rs]?|gewürfelte[rs]?|gepresste[rs]?|gemahlene[rs]?|geschmolzene[rs]?|zuckerfreie[rn]?|weiche[rs]?)\b/gi;
const TRAILING_DESCRIPTORS = /[,\s]+\b(fein gehackt|gehackt|gewürfelt|gepresst|gerieben|geraspelt|in scheiben|zum garnieren|nach geschmack|frisch|getrocknet)\b.*$/i;

// Aufzählungszeichen am Zeilenanfang (Rezept-Vorlagen, OCR): "- 150g Mandeln" -> "150g Mandeln"
const BULLET_PREFIX = /^\s*[-–—•*·]\s*/;
// Abschnittsüberschriften ohne Menge überspringen: "Zutaten:", "Boden:", "Füllung:" …
const SECTION_HEADER = /^[^\d]*:\s*$/;
// Klammerzusätze wie "(geschmolzen)" oder "(ggf mehr oder weniger …)" sind keine Zutat.
const PAREN_CONTENT = /\([^)]*\)/g;
// Mengenbereiche auf den kleineren Wert reduzieren: "1-2 TL" -> "1 TL" (im Review anpassbar).
const QUANTITY_RANGE = /^(\d+(?:[.,]\d+)?)\s*[-–]\s*\d+(?:[.,]\d+)?(?=\s)/;
// Mengen-Zusatzwörter vor der eigentlichen Einheit: "1 gehäufter EL" -> "1 EL"
const HEAP_QUALIFIER = /^(gehäufte[rn]?|gestrichene[rn]?)\s+/i;

function parseIngredientLine(rawLine) {
  const raw = rawLine.trim();
  if (!raw) return null;

  let cleaned = raw.replace(BULLET_PREFIX, "").trim();
  if (!cleaned || SECTION_HEADER.test(cleaned)) return null;

  cleaned = cleaned.replace(PAREN_CONTENT, "").replace(/\s{2,}/g, " ").trim();
  if (!cleaned) return null;

  cleaned = cleaned.replace(QUANTITY_RANGE, "$1");
  cleaned = cleaned.replace(TRAILING_DESCRIPTORS, "").trim() || cleaned;

  const m = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*(.+)$/);
  if (!m) {
    return { raw, quantity: null, unit: null, grams: null, name: cleanName(cleaned) };
  }
  const quantity = parseFloat(m[1].replace(",", "."));
  const rest = m[2].trim().replace(HEAP_QUALIFIER, "");

  const unitMatch = rest.match(/^([a-zA-ZäöüÄÖÜß]+)\.?\s+(.+)$/);
  if (unitMatch && UNIT_GRAMS[unitMatch[1].toLowerCase()] != null) {
    const unit = unitMatch[1].toLowerCase();
    const name = cleanName(unitMatch[2]);
    return { raw, quantity, unit, grams: +(quantity * UNIT_GRAMS[unit]).toFixed(0), name };
  }

  return { raw, quantity, unit: null, grams: null, name: cleanName(rest) };
}

function cleanName(name) {
  return name
    .replace(SIZE_QUALIFIERS, "")
    .replace(LEADING_DESCRIPTORS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Zerlegt mehrzeiligen Zutaten-Text (aus OCR oder Einfügen) in Kandidaten-Zeilen. */
export function parseIngredientText(text) {
  return text
    .split(/\r?\n+/)
    .map(parseIngredientLine)
    .filter(Boolean)
    .filter(entry => entry.name.length > 1);
}

// ---------------------------------------------------------------------------
// OCR-Bild-Import (Tesseract.js, vollständig lokal vendort — keine Cloud-API,
// keine Kosten, funktioniert nach dem ersten Laden auch offline).
// ---------------------------------------------------------------------------

let workerPromise = null;

function getWorker(onStatus) {
  if (!workerPromise) {
    workerPromise = (async () => {
      onStatus?.("Texterkennung wird geladen …");
      const { default: Tesseract } = await import("../vendor/tesseract/tesseract.esm.min.js");
      const worker = await Tesseract.createWorker("deu", 1, {
        workerPath: new URL("../vendor/tesseract/worker.min.js", import.meta.url).href,
        corePath: new URL("../vendor/tesseract/", import.meta.url).href,
        langPath: new URL("../vendor/tesseract/", import.meta.url).href,
        gzip: false,
      });
      return worker;
    })().catch(err => {
      workerPromise = null; // bei Fehler erneuten Versuch beim nächsten Aufruf erlauben
      throw err;
    });
  }
  return workerPromise;
}

/** Erkennt Text aus einer Bilddatei (File/Blob). Wirft bei Fehlern, UI fängt das ab. */
export async function recognizeImageText(file, onStatus) {
  const worker = await getWorker(onStatus);
  onStatus?.("Text wird erkannt …");
  const { data } = await worker.recognize(file);
  return data.text;
}
