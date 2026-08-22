// recipes.js — Rezept-Verwaltung, Nährwert-Summierung, Zutaten-Text-Parser, OCR-Import.
import { Store } from "./store.js";
import { calcNetCarbs } from "./keto.js";
import { getActiveDateKey } from "./consumption.js";
import { downscaleImageIfNeeded } from "./ui.js";
import { parseIngredientText } from "./ingredient-parser.js";

// Re-export: views/recipes.js und die Kochbuch-App importieren beide denselben Parser.
export { parseIngredientText };

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
  // Portionsgewicht als Schnappschuss mitschreiben: spätere Rezeptänderungen sollen den
  // bereits eingetragenen Tag nicht rückwirkend verändern — genauso wie die Nährwerte unten.
  const totalGrams = recipe.ingredients.reduce((sum, i) => sum + (i.grams || 0), 0);
  const entry = {
    id: crypto.randomUUID(),
    profileId: profile.id,
    barcode: `recipe:${recipe.id}`,
    name: recipe.name,
    servings,
    servingG: totalGrams > 0 ? Math.round(totalGrams / (recipe.servings || 1)) : null,
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
  onStatus?.("Bild wird vorbereitet …");
  const prepared = await downscaleImageIfNeeded(file);
  onStatus?.("Text wird erkannt …");
  const { data } = await worker.recognize(prepared);
  return data.text;
}
