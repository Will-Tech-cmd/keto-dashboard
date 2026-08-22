// keto-sync-import.js — übernimmt automatisch alle Rezepte aus der Online-Synchronisierung
// der Keto-App (js/sync.js dort), sobald mindestens ein Gerät sie aktiviert hat. Ersetzt für
// diesen Fall die manuelle "Übernehmen"-Klickerei in views/import.js, die weiterhin als
// Rückfalloption bestehen bleibt (Gerät ohne Keto-Sync, oder bevor der erste Sync-Tick lief).
import { fetchKetoSyncRecipes, findByKetoId, createRezeptHead, forceUpdateRezeptHead, replaceZutaten } from "./api.js";
import { buildImportPayload } from "./keto-bridge.js";
import { getWhoAmI } from "./identity.js";

/**
 * Gleicht alle Rezepte aus dem Keto-Sync-Blob ins Kochbuch — legt neue an, aktualisiert
 * geänderte (Zutaten & Nährwerte, Zubereitung/Fotos/Notizen bleiben unberührt), lässt
 * unveränderte in Ruhe. Liefert Zähler für eine Meldung an den Menschen, falls gewünscht.
 */
export async function syncRezepteFromKetoSync() {
  const recipes = await fetchKetoSyncRecipes();
  let imported = 0, updated = 0;
  const wer = getWhoAmI();

  for (const recipe of recipes) {
    if (!recipe?.id || !recipe.name || !Array.isArray(recipe.ingredients)) continue;
    const existing = await findByKetoId(recipe.id);
    const ketoUpdatedAt = recipe.updatedAt || 0;
    const knownUpdatedAt = existing?.keto_updated_at ? new Date(existing.keto_updated_at).getTime() : 0;
    if (existing && ketoUpdatedAt <= knownUpdatedAt) continue; // schon auf diesem Stand

    const { kopf, zutaten } = buildImportPayload(recipe);
    let rezeptId;
    if (existing) {
      await forceUpdateRezeptHead(existing.id, { ...kopf, geaendert_von: wer });
      rezeptId = existing.id;
      updated++;
    } else {
      const created = await createRezeptHead({ ...kopf, erstellt_von: wer, geaendert_von: wer });
      rezeptId = created.id;
      imported++;
    }
    await replaceZutaten(rezeptId, zutaten);
  }

  return { imported, updated };
}
