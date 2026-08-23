// keto-bridge.js — liest Rezepte direkt aus dem localStorage der Keto-App (gleiche Origin,
// Pfad .../kochbuch/ liegt unterhalb von .../) und schreibt Zutaten zurück auf deren
// Einkaufsliste. Bewusst ohne Import von js/store.js: dessen Modul-Ladezeit würde selbst schon
// einen Zustand anlegen, wenn die Keto-App auf diesem Gerät noch nie geöffnet wurde. Hier wird
// stattdessen gezielt nur gelesen bzw. ein separater Inbox-Schlüssel beschrieben, den die
// Keto-App selbst beim nächsten Start abholt (js/store.js, `drainKochbuchInbox`).

import { createRezeptHead, forceUpdateRezeptHead, replaceZutaten } from "./api.js";

const KETO_STATE_KEY = "keto-dashboard-v1";
const INBOX_KEY = "keto-dashboard-inbox";

function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }

function calcNetCarbs100(per100, subtractFiber) {
  if (!per100 || per100.carbs == null) return null;
  if (subtractFiber && per100.fiber != null) return Math.max(per100.carbs - per100.fiber, 0);
  return per100.carbs;
}

/** Nährwerte pro Portion — dieselbe Rechnung wie js/recipes.js:calcPerServing() der Keto-App. */
export function calcPerServingNutrition(recipe) {
  const totals = (recipe.ingredients || []).reduce((acc, ing) => {
    const scale = (ing.grams || 0) / 100;
    const netCarbs100 = calcNetCarbs100(ing.per100, ing.likelyUsLabel);
    return {
      kcal: acc.kcal + (ing.per100?.kcal != null ? ing.per100.kcal * scale : 0),
      netCarbs: acc.netCarbs + (netCarbs100 != null ? netCarbs100 * scale : 0),
      fat: acc.fat + (ing.per100?.fat != null ? ing.per100.fat * scale : 0),
      protein: acc.protein + (ing.per100?.protein != null ? ing.per100.protein * scale : 0),
    };
  }, { kcal: 0, netCarbs: 0, fat: 0, protein: 0 });
  const s = recipe.servings || 1;
  return {
    kcal: round1(totals.kcal / s), netCarbs: round1(totals.netCarbs / s),
    fat: round1(totals.fat / s), protein: round1(totals.protein / s),
  };
}

/** Alle Rezepte aus der Keto-App auf diesem Gerät — leer, wenn sie hier nie geöffnet wurde. */
export function readKetoRecipes() {
  try {
    const raw = localStorage.getItem(KETO_STATE_KEY);
    if (!raw) return [];
    const state = JSON.parse(raw);
    return Array.isArray(state.recipes) ? state.recipes : [];
  } catch { return []; }
}

export function readKetoRecipe(id) {
  return readKetoRecipes().find(r => r.id === id) || null;
}

/** Liest Rezepte aus einer Datei im Format von Store.exportRecipesJSON() ("Nur Rezepte teilen"). */
export function parseKetoRecipesFile(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!parsed || !Array.isArray(parsed.recipes)) {
    throw new Error("Keine gültige Keto-Dashboard-Rezeptdatei.");
  }
  return parsed.recipes.filter(r => r && r.id && r.name && Array.isArray(r.ingredients));
}

/** Baut aus einem Keto-Rezept die Felder für kochbuch_rezepte + kochbuch_zutaten. */
export function buildImportPayload(ketoRecipe) {
  return {
    kopf: {
      keto_id: ketoRecipe.id,
      titel: ketoRecipe.name,
      portionen: ketoRecipe.servings || 1,
      naehrwerte: calcPerServingNutrition(ketoRecipe),
      naehrwerte_manuell: false,
      quelle: "keto-app",
      keto_updated_at: ketoRecipe.updatedAt ? new Date(ketoRecipe.updatedAt).toISOString() : null,
    },
    zutaten: (ketoRecipe.ingredients || []).map((ing, i) => ({
      pos: i,
      abschnitt: null,
      name: ing.name,
      gramm: ing.grams ?? null,
      mengentext: null,
      per100: ing.per100 || null,
      likely_us_label: !!ing.likelyUsLabel,
    })),
  };
}

/**
 * Schreibt ein Keto-Rezept ins Kochbuch — anlegen oder aktualisieren. Gibt dessen Kochbuch-id
 * zurück. Geteilt vom automatischen Abgleich (keto-sync-import.js) und vom Knopf "Übernehmen"
 * (views/import.js), damit beide Wege dieselbe Reihenfolge einhalten:
 *
 * erst die Kopfdaten OHNE keto_updated_at, dann die Zutaten, und GANZ ZULETZT der Zeitstempel.
 * Der ist die Marke "dieses Rezept ist auf dem Stand der Keto-App". Stünde er schon vor den
 * Zutaten da, hinterließe ein Verbindungsabbruch dazwischen ein Rezept mit leerer oder
 * veralteter Zutatenliste, das jeder weitere Durchlauf als "schon erledigt" überspringt — es
 * würde nie wieder repariert.
 */
export async function writeKetoRecipe(ketoRecipe, existing, wer) {
  const { kopf, zutaten } = buildImportPayload(ketoRecipe);
  const { keto_updated_at, ...kopfOhneStempel } = kopf;

  let rezeptId;
  if (existing) {
    await forceUpdateRezeptHead(existing.id, { ...kopfOhneStempel, geaendert_von: wer });
    rezeptId = existing.id;
  } else {
    const created = await createRezeptHead({ ...kopfOhneStempel, erstellt_von: wer, geaendert_von: wer });
    rezeptId = created.id;
  }
  await replaceZutaten(rezeptId, zutaten);
  await forceUpdateRezeptHead(rezeptId, { keto_updated_at });
  return rezeptId;
}

/**
 * Legt Zutatennamen in der Inbox der Keto-App ab — sie übernimmt sie beim nächsten Start in
 * die eigene Einkaufsliste. Kein direktes Schreiben in keto-dashboard-v1: ein offener Tab der
 * Keto-App würde dessen Zustand sonst beim nächsten eigenen Speichern wieder überschreiben.
 */
export function pushToKetoShoppingList(names) {
  let existing = [];
  try { existing = JSON.parse(localStorage.getItem(INBOX_KEY)) || []; } catch { /* startet leer */ }
  localStorage.setItem(INBOX_KEY, JSON.stringify([...existing, ...names]));
}
