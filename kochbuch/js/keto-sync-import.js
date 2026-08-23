// keto-sync-import.js — übernimmt automatisch alle Rezepte aus der Online-Synchronisierung
// der Keto-App (js/sync.js dort), sobald mindestens ein Gerät sie aktiviert hat. Ersetzt für
// diesen Fall die manuelle "Übernehmen"-Klickerei in views/import.js, die weiterhin als
// Rückfalloption bestehen bleibt (Gerät ohne Keto-Sync, oder bevor der erste Sync-Tick lief).
import { fetchKetoSyncRecipes, listKetoIdMap } from "./api.js";
import { writeKetoRecipe } from "./keto-bridge.js";
import { getWhoAmI } from "./identity.js";

/**
 * Gleicht alle Rezepte aus dem Keto-Sync-Blob ins Kochbuch — legt neue an, aktualisiert
 * geänderte (Zutaten & Nährwerte, Zubereitung/Fotos/Notizen bleiben unberührt), lässt
 * unveränderte in Ruhe. Liefert Zähler für eine Meldung an den Menschen, falls gewünscht.
 */
export async function syncRezepteFromKetoSync() {
  const recipes = await fetchKetoSyncRecipes();
  if (recipes.length === 0) return { imported: 0, updated: 0 };

  // Einmal nachschlagen, was hier schon liegt — statt einer Abfrage je Rezept.
  const bekannt = await listKetoIdMap();
  let imported = 0, updated = 0;
  const wer = getWhoAmI();

  for (const recipe of recipes) {
    if (!recipe?.id || !recipe.name || !Array.isArray(recipe.ingredients)) continue;
    const existing = bekannt.get(recipe.id) || null;
    const ketoUpdatedAt = recipe.updatedAt || 0;
    const knownUpdatedAt = existing?.keto_updated_at ? new Date(existing.keto_updated_at).getTime() : 0;
    if (existing && ketoUpdatedAt <= knownUpdatedAt) continue; // schon auf diesem Stand

    await writeKetoRecipe(recipe, existing, wer);
    if (existing) updated++; else imported++;
  }

  return { imported, updated };
}
