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
  // Im Zeilenmodus pflegt die Keto-App die Rezeptzeilen selbst (js/sync2.js) — samt
  // Zutaten. Der Klumpen in keto_sync_state wird dann nicht mehr fortgeschrieben und ist
  // eingefroren; ihn darüberzuspielen ergäbe zwei Schreiber auf denselben Zeilen.
  //
  // Die Marke gilt für DIESES Gerät: das Kochbuch liegt unter derselben Herkunft wie die
  // Keto-App und liest ihren Schalter direkt (wie keto-bridge.js den Zustand). Ein Gerät,
  // dessen Keto-App noch den alten Weg geht, importiert also weiter — und das ist richtig,
  // denn dort schreibt niemand sonst die Zeilen.
  try {
    if (localStorage.getItem("keto-dashboard-zeilenmodus") === "an") {
      return { imported: 0, updated: 0, uebersprungen: "Zeilenmodus" };
    }
  } catch { /* kein localStorage: dann eben importieren */ }

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
