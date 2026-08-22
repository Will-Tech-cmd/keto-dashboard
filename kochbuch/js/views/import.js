// views/import.js — Rezepte aus der Keto-App übernehmen: direkt aus deren localStorage (nur
// auf demselben Gerät/Browser verfügbar) oder aus einer geteilten Rezept-Datei (funktioniert
// auf jedem Gerät — der Weg für das zweite Handy).
import { readKetoRecipes, buildImportPayload, parseKetoRecipesFile } from "../keto-bridge.js";
import { findByKetoId, createRezeptHead, forceUpdateRezeptHead, replaceZutaten } from "../api.js";
import { getWhoAmI } from "../identity.js";
import { esc, showToast } from "../ui.js";

export async function renderImport(container, { onBack, onImported, preselectKetoId }) {
  const local = readKetoRecipes();

  container.innerHTML = `
    <div class="kb-detail-head">
      <button class="kb-icon-btn" id="backBtn" aria-label="Zurück">‹</button>
      <div class="kb-detail-title">Aus der Keto-App übernehmen</div>
      <span style="width:36px"></span>
    </div>
    <div class="kb-detail-body">
      ${local.length ? `
        <h2 class="kb-section-title">Auf diesem Gerät</h2>
        <ul class="kb-import-list" id="localList">
          ${local.map(r => `
            <li>
              <span>${esc(r.name)}</span>
              <button type="button" class="kb-btn kb-btn-secondary kb-btn-small" data-id="${esc(r.id)}">Übernehmen</button>
            </li>
          `).join("")}
        </ul>
      ` : `<p class="kb-hint">Auf diesem Gerät sind in der Keto-App keine Rezepte gespeichert. Nutze den Datei-Import unten — Export in der Keto-App unter Profil → „Nur Rezepte“.</p>`}

      <h2 class="kb-section-title">Aus einer Datei</h2>
      <p class="kb-hint">Für das andere Handy: in der Keto-App unter Profil → „Nur Rezepte" exportieren/teilen, Datei hier wählen.</p>
      <input type="file" id="fileInput" accept=".txt,.json,text/plain,application/json,application/octet-stream" style="display:none">
      <button class="kb-btn kb-btn-secondary" id="fileBtn">📄 Datei wählen</button>
      <div id="fileList" style="margin-top:10px"></div>
    </div>
  `;

  container.querySelector("#backBtn").addEventListener("click", onBack);

  container.querySelector("#localList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-id]");
    if (!btn) return;
    const recipe = local.find(r => r.id === btn.dataset.id);
    if (recipe) importOne(recipe, btn);
  });

  container.querySelector("#fileBtn").addEventListener("click", () => container.querySelector("#fileInput").click());
  container.querySelector("#fileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const recipes = parseKetoRecipesFile(text);
      renderFileList(recipes);
    } catch (err) {
      showToast(err.message || "Datei konnte nicht gelesen werden");
    }
  });

  function renderFileList(recipes) {
    const el = container.querySelector("#fileList");
    if (recipes.length === 0) {
      el.innerHTML = `<p class="kb-hint">Keine Rezepte in der Datei gefunden.</p>`;
      return;
    }
    el.innerHTML = `
      <ul class="kb-import-list">
        ${recipes.map(r => `
          <li>
            <span>${esc(r.name)}</span>
            <button type="button" class="kb-btn kb-btn-secondary kb-btn-small" data-id="${esc(r.id)}">Übernehmen</button>
          </li>
        `).join("")}
      </ul>
    `;
    el.querySelector("ul").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-id]");
      if (!btn) return;
      const recipe = recipes.find(r => r.id === btn.dataset.id);
      if (recipe) importOne(recipe, btn);
    });
  }

  async function importOne(recipe, btn) {
    btn.disabled = true;
    btn.textContent = "…";
    try {
      const existing = await findByKetoId(recipe.id);
      const { kopf, zutaten } = buildImportPayload(recipe);
      const wer = getWhoAmI();
      let rezeptId;
      if (existing) {
        await forceUpdateRezeptHead(existing.id, { ...kopf, geaendert_von: wer });
        rezeptId = existing.id;
      } else {
        const created = await createRezeptHead({ ...kopf, erstellt_von: wer, geaendert_von: wer });
        rezeptId = created.id;
      }
      await replaceZutaten(rezeptId, zutaten);
      showToast(existing ? "Aktualisiert — Zubereitung & Fotos blieben erhalten" : "Übernommen");
      btn.textContent = "✓ Im Kochbuch";
      onImported(rezeptId);
    } catch (err) {
      showToast(err.message || "Import fehlgeschlagen — offline?");
      btn.disabled = false;
      btn.textContent = "Übernehmen";
    }
  }

  // Direkter Sprung aus dem Editor-Knopf der Keto-App (kochbuch/?import=<id>): sofort übernehmen.
  if (preselectKetoId) {
    const recipe = local.find(r => r.id === preselectKetoId);
    const btn = recipe && container.querySelector(`#localList button[data-id="${CSS.escape(preselectKetoId)}"]`);
    if (recipe && btn) importOne(recipe, btn);
    else if (!recipe) showToast("Rezept nicht in diesem Browser gefunden — nutze den Datei-Import");
  }
}
