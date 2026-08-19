// views/recipes.js — Rezepte: Liste, Editor, Zutatensuche, Bild-/Text-Import mit Review.
import { Store } from "../store.js";
import { lookupProduct, searchProductsByName, searchOwnProducts } from "../off.js";
import { searchLocalFoods, bestLocalFoodMatch } from "../foods-db.js";
import { calcNetCarbs, ketoGrade, GRADE_LABEL } from "../keto.js";
import { calcTargets } from "../profiles.js";
import {
  createRecipe, updateRecipeMeta, deleteRecipe, addIngredient, removeIngredient,
  updateIngredient, calcRecipeTotals, calcPerServing, logRecipeConsumption,
  parseIngredientText, recognizeImageText,
} from "../recipes.js";
import { suggestMeal, mealChipsHtml, wireMealChips, getActiveDateKey, dateLabel } from "../consumption.js";
import { startScanner, stopScanner, isScannerSupported } from "../scanner.js";
import { showToast, esc, bindBackClose } from "../ui.js";
import { hasApiKey, recognizeIngredientsFromText, recognizeIngredientsFromImage, describeAiError } from "../ai.js";

let openRecipeId = null;
let reviewRows = null; // Kandidaten aus Bild-/Text-Import, während der Review-Phase

/** Ampel-Grenzwerte des aktiven Profils (Ernährungsform), für konsistente Bewertung. */
function activeThresholds() {
  return calcTargets(Store.getActiveProfile()).gradeThresholds;
}

export function renderRecipes(container) {
  if (openRecipeId && Store.getRecipe(openRecipeId)) {
    renderEditor(container, openRecipeId);
  } else {
    openRecipeId = null;
    renderList(container);
  }
}

let recipeFilter = "";

function renderList(container) {
  const recipes = Store.getRecipes();
  container.innerHTML = `
    <h1 class="section-title">Rezepte</h1>
    <button class="btn" id="newRecipeBtn">➕ Neues Rezept</button>
    ${recipes.length > 0 ? `
      <input type="text" id="recipeSearch" placeholder="🔎 Rezept oder Zutat suchen …"
        autocomplete="off" value="${esc(recipeFilter)}" style="margin-top:12px">
    ` : ""}
    <div id="recipeListBody" style="margin-top:12px"></div>
  `;

  container.querySelector("#newRecipeBtn").addEventListener("click", () => {
    const recipe = createRecipe("Neues Rezept", 4);
    openRecipeId = recipe.id;
    renderEditor(container, recipe.id);
  });

  const search = container.querySelector("#recipeSearch");
  search?.addEventListener("input", () => {
    recipeFilter = search.value;
    renderRecipeRows(container);
  });

  renderRecipeRows(container);
}

/** Sucht in Rezeptnamen UND Zutaten, damit z.B. "Hack" den Cheeseburger-Auflauf findet. */
function matchesRecipe(recipe, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (recipe.name.toLowerCase().includes(q)) return true;
  return recipe.ingredients.some(i => i.name.toLowerCase().includes(q));
}

function renderRecipeRows(container) {
  const body = container.querySelector("#recipeListBody");
  const all = Store.getRecipes();

  if (all.length === 0) {
    body.innerHTML = `<div class="empty-state"><span class="emoji">🍳</span>Noch keine Rezepte angelegt.</div>`;
    return;
  }

  const recipes = all.filter(r => matchesRecipe(r, recipeFilter));
  if (recipes.length === 0) {
    body.innerHTML = `<div class="empty-state"><span class="emoji">🔎</span>Kein Rezept passt zu „${esc(recipeFilter)}".</div>`;
    return;
  }

  body.innerHTML = recipes.map(r => {
    const perServing = calcPerServing(r);
    const grade = ketoGrade(perServing.netCarbs, activeThresholds());
    return `
      <div class="list-item" data-id="${r.id}" style="cursor:pointer">
        <span class="badge ${grade}" style="flex-shrink:0">${{ green: "🟢", yellow: "🟡", red: "🔴", gray: "⚪" }[grade]}</span>
        <div class="info">
          <div class="name">${esc(r.name)}</div>
          <div class="meta" title="${r.ingredients.length} Zutaten, ${r.servings} Portionen">${perServing.kcal != null ? Math.round(perServing.kcal) : "–"} kcal · ${perServing.netCarbs ?? "–"} g KH</div>
        </div>
        <button class="icon-btn" data-action="addToday" title="Zum Tag hinzufügen">🍽️</button>
        <button class="icon-btn" data-action="delete" title="Löschen">🗑️</button>
      </div>
    `;
  }).join("");

  body.querySelectorAll(".list-item").forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
      e.stopPropagation();
      const recipe = Store.getRecipe(id);
      if (confirm(`Rezept „${recipe.name}" wirklich löschen?`)) {
        deleteRecipe(id);
        renderList(container); // komplett neu, damit das Suchfeld beim letzten Rezept verschwindet
        showToast("Rezept gelöscht");
      }
    });
    row.querySelector('[data-action="addToday"]').addEventListener("click", (e) => {
      e.stopPropagation();
      openServingsModal(Store.getRecipe(id));
    });
    row.addEventListener("click", () => {
      openRecipeId = id;
      renderEditor(container, id);
    });
  });
}

function openServingsModal(recipe) {
  const perServing = calcPerServing(recipe);
  let selectedMeal = suggestMeal();
  const dayLabel = dateLabel(getActiveDateKey());
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">${esc(recipe.name)}</h2>
      <p class="hint">Rezept ergibt ${recipe.servings} Portionen à ${perServing.kcal ?? "–"} kcal. Wie viele davon zu „${esc(dayLabel)}" hinzufügen?</p>
      <label for="servingsInput">Portionen</label>
      <input type="number" id="servingsInput" value="1" min="0.25" step="0.25">
      <p class="hint" id="servingsPreview" style="margin-top:8px"></p>
      ${mealChipsHtml(selectedMeal)}
      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn secondary" id="servingsCancel">Abbrechen</button>
        <button type="button" class="btn" id="servingsConfirm">Eintragen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  wireMealChips(overlay, (meal) => { selectedMeal = meal; });

  const input = overlay.querySelector("#servingsInput");
  const preview = overlay.querySelector("#servingsPreview");
  const updatePreview = () => {
    const val = parseFloat(input.value);
    if (!val || val <= 0) { preview.textContent = ""; return; }
    preview.textContent = `→ ${round1((perServing.kcal ?? 0) * val)} kcal · ${round1((perServing.netCarbs ?? 0) * val)} g Netto-KH werden eingetragen`;
  };
  input.addEventListener("input", updatePreview);
  updatePreview();

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#servingsCancel").addEventListener("click", close);
  overlay.querySelector("#servingsConfirm").addEventListener("click", () => {
    const servings = parseFloat(input.value);
    if (!servings || servings <= 0) { showToast("Bitte eine gültige Anzahl angeben"); return; }
    logRecipeConsumption(recipe, servings, selectedMeal);
    showToast(`${servings} Portion(en) „${recipe.name}" eingetragen`);
    close();
  });
  input.focus();
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function renderEditor(container, recipeId) {
  const recipe = Store.getRecipe(recipeId);
  if (!recipe) { openRecipeId = null; renderList(container); return; }
  reviewRows = null;

  container.innerHTML = `
    <div class="editor-topbar">
      <button class="btn ghost" id="backBtn" style="padding:0 4px">← Zurück</button>
      <button class="btn" id="saveBtn">✓ Speichern</button>
    </div>

    <div class="card">
      <label for="recName">Name</label>
      <input type="text" id="recName" value="${esc(recipe.name)}">
      <label for="recServings">Portionen</label>
      <input type="number" id="recServings" value="${recipe.servings}" min="1" step="1">
    </div>

    <div class="card" id="totalsCard"></div>

    <h2 class="section-title">Zutaten</h2>
    <div id="ingredientList"></div>
    <button class="btn ghost" id="ingToShoppingBtn" style="margin-bottom:14px">🛒 Zutaten auf Einkaufsliste</button>

    <div class="card">
      <label for="ingSearchInput">Zutat suchen und hinzufügen</label>
      <input type="text" id="ingSearchInput" placeholder="z.B. Rinderhackfleisch, Bacon …" autocomplete="off">
      <div id="ingSearchResults" style="margin-top:8px"></div>
      ${isScannerSupported() ? `<button class="btn secondary" id="scanIngBtn" style="margin-top:10px">📷 Zutat scannen</button>` : ""}
      <button class="btn ghost" id="manualIngToggle" style="margin-top:10px">✏️ Zutat manuell eintragen</button>
      <div id="manualIngWrap" style="display:none;margin-top:10px"></div>
    </div>

    <h2 class="section-title">Aus Bild oder Text importieren</h2>
    <div class="card">
      <p class="hint" style="margin-top:0">Foto einer Zutatenliste (z.B. Screenshot) einlesen, oder Text direkt einfügen. Ergebnis kannst du danach prüfen und korrigieren.${hasApiKey() ? " Optional per KI (Gemini) erkennen lassen — genauer bei unbekannten Zutaten, braucht aber Internet." : ""}</p>
      <input type="file" id="recipeImageInput" accept="image/*" style="display:none">
      <div class="btn-row">
        <button class="btn secondary" id="importImageBtn">📷 Bild wählen</button>
        <button class="btn secondary" id="importTextBtn">📋 Text einfügen</button>
      </div>
      <div id="importStatus" class="hint" style="margin-top:8px"></div>
      <div id="textPasteWrap" style="display:none;margin-top:10px"></div>
    </div>

    <div id="reviewWrap"></div>

    <button class="btn ghost" id="deleteRecipeBtn" style="margin-top:20px">🗑️ Rezept löschen</button>
  `;

  const closeEditor = bindBackClose(() => {
    openRecipeId = null;
    renderList(container);
  });
  container.querySelector("#backBtn").addEventListener("click", closeEditor);

  container.querySelector("#saveBtn").addEventListener("click", () => {
    const name = container.querySelector("#recName").value.trim() || "Rezept";
    const s = parseInt(container.querySelector("#recServings").value, 10);
    updateRecipeMeta(recipeId, { name, servings: s > 0 ? s : 1 });
    renderTotals(container, recipeId);
    showToast("Rezept gespeichert");
  });

  container.querySelector("#recName").addEventListener("change", (e) => {
    updateRecipeMeta(recipeId, { name: e.target.value.trim() || "Rezept" });
  });
  container.querySelector("#recServings").addEventListener("change", (e) => {
    const s = parseInt(e.target.value, 10);
    updateRecipeMeta(recipeId, { servings: s > 0 ? s : 1 });
    renderTotals(container, recipeId);
  });

  container.querySelector("#deleteRecipeBtn").addEventListener("click", () => {
    if (confirm(`Rezept „${recipe.name}" wirklich löschen?`)) {
      deleteRecipe(recipeId);
      closeEditor();
      showToast("Rezept gelöscht");
    }
  });

  container.querySelector("#scanIngBtn")?.addEventListener("click", () => {
    openIngredientScanner(recipeId, () => {
      renderIngredientList(container, recipeId);
      renderTotals(container, recipeId);
    });
  });

  container.querySelector("#ingToShoppingBtn").addEventListener("click", () => {
    const current = Store.getRecipe(recipeId);
    if (current.ingredients.length === 0) { showToast("Noch keine Zutaten in diesem Rezept"); return; }
    const added = addIngredientsToShoppingList(current.ingredients);
    showToast(added > 0 ? `${added} Zutat(en) auf die Einkaufsliste gesetzt` : "Bereits alle auf der Einkaufsliste");
  });

  renderTotals(container, recipeId);
  renderIngredientList(container, recipeId);
  wireIngredientSearch(container, recipeId);
  wireManualIngredient(container, recipeId);
  wireImport(container, recipeId);
}

/** Fügt Zutatennamen zur Einkaufsliste hinzu, ohne bereits vorhandene Einträge zu duplizieren. */
function addIngredientsToShoppingList(ingredients) {
  const existingNames = new Set(Store.get().shoppingList.map(i => i.text.toLowerCase()));
  let added = 0;
  for (const ing of ingredients) {
    if (existingNames.has(ing.name.toLowerCase())) continue;
    Store.addShoppingItem(ing.name);
    existingNames.add(ing.name.toLowerCase());
    added++;
  }
  return added;
}

function renderTotals(container, recipeId) {
  const recipe = Store.getRecipe(recipeId);
  const perServing = calcPerServing(recipe);
  const grade = ketoGrade(perServing.netCarbs, activeThresholds());
  container.querySelector("#totalsCard").innerHTML = `
    <h2>Pro Portion</h2>
    <span class="badge ${grade}" style="margin-bottom:8px;display:inline-flex">${{ green: "🟢", yellow: "🟡", red: "🔴", gray: "⚪" }[grade]} ${esc(GRADE_LABEL[grade])}</span>
    <div class="grid-2">
      <div class="stat"><div class="val">${perServing.kcal ?? "–"}</div><div class="lbl">kcal</div></div>
      <div class="stat"><div class="val">${perServing.netCarbs ?? "–"} g</div><div class="lbl">Netto-KH</div></div>
      <div class="stat"><div class="val">${perServing.fat ?? "–"} g</div><div class="lbl">Fett</div></div>
      <div class="stat"><div class="val">${perServing.protein ?? "–"} g</div><div class="lbl">Eiweiß</div></div>
    </div>
  `;
}

function renderIngredientList(container, recipeId) {
  const recipe = Store.getRecipe(recipeId);
  const el = container.querySelector("#ingredientList");
  if (recipe.ingredients.length === 0) {
    el.innerHTML = `<div class="empty-state"><span class="emoji">🥄</span>Noch keine Zutaten. Unten suchen, manuell eintragen oder importieren.</div>`;
    return;
  }
  el.innerHTML = recipe.ingredients.map(ing => {
    const netCarbs100 = calcNetCarbs(ing.per100, { subtractFiber: ing.likelyUsLabel });
    const scale = (ing.grams || 0) / 100;
    const kcal = ing.per100.kcal != null ? Math.round(ing.per100.kcal * scale) : null;
    const nc = netCarbs100 != null ? +(netCarbs100 * scale).toFixed(1) : null;
    return `
      <div class="list-item" data-id="${ing.id}">
        <div class="info">
          <div class="name">${esc(ing.name)}</div>
          <div class="meta">${kcal ?? "–"} kcal · ${nc ?? "–"} g Netto-KH</div>
        </div>
        <input type="number" class="ing-grams-input" value="${ing.grams}" min="0" style="width:64px;text-align:right;min-height:36px">
        <span class="hint" style="margin:0 4px">g</span>
        <button class="icon-btn" data-action="remove" title="Entfernen">🗑️</button>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".list-item").forEach(row => {
    const ingId = row.dataset.id;
    row.querySelector(".ing-grams-input").addEventListener("change", (e) => {
      const g = parseFloat(e.target.value);
      updateIngredient(recipeId, ingId, { grams: g >= 0 ? g : 0 });
      renderIngredientList(container, recipeId);
      renderTotals(container, recipeId);
    });
    row.querySelector('[data-action="remove"]').addEventListener("click", () => {
      removeIngredient(recipeId, ingId);
      renderIngredientList(container, recipeId);
      renderTotals(container, recipeId);
    });
  });
}

function wireIngredientSearch(container, recipeId) {
  const input = container.querySelector("#ingSearchInput");
  const resultsEl = container.querySelector("#ingSearchResults");
  let debounceTimer = null;
  let requestSeq = 0;

  const runSearch = async () => {
    const term = input.value.trim();
    const seq = ++requestSeq;
    if (term.length < 2) { resultsEl.innerHTML = ""; return; }

    const own = searchOwnProducts(term);
    const local = searchLocalFoods(term).filter(p => !own.some(o => o.name.toLowerCase() === p.name.toLowerCase()));
    const offline = [...own, ...local];
    renderIngSearchResults(offline, false);

    const online = await searchProductsByName(term);
    if (seq !== requestSeq) return;
    const seenNames = new Set(offline.map(p => p.name.toLowerCase()));
    const combined = [...offline, ...online.filter(p => !seenNames.has(p.name.toLowerCase()))];
    renderIngSearchResults(combined, true);
  };

  const SOURCE_ICON = { local: "🥑", own: "📝" };
  const SOURCE_LABEL = { local: "Grundnahrungsmittel", own: "Eigenes Produkt" };

  function renderIngSearchResults(items, isFinal) {
    if (items.length === 0) {
      resultsEl.innerHTML = isFinal ? `<p class="hint">Keine Treffer.</p>` : `<p class="hint">Suche …</p>`;
      return;
    }
    resultsEl.innerHTML = items.map((p, i) => `
      <div class="list-item" data-idx="${i}" style="cursor:pointer">
        <span style="flex-shrink:0">${SOURCE_ICON[p.source] || "🏷️"}</span>
        <div class="info">
          <div class="name">${esc(p.name)}</div>
          <div class="meta">${p.brand ? esc(p.brand) + " · " : ""}${SOURCE_LABEL[p.source] || "Open Food Facts"}</div>
        </div>
      </div>
    `).join("") + (!isFinal ? `<p class="hint">Suche weitere Online-Treffer …</p>` : "");

    resultsEl.querySelectorAll(".list-item").forEach(row => {
      row.addEventListener("click", () => {
        const p = items[Number(row.dataset.idx)];
        const grams = guessGrams(p);
        addIngredient(recipeId, { name: p.name, grams, per100: p.per100, likelyUsLabel: p.likelyUsLabel });
        input.value = "";
        resultsEl.innerHTML = "";
        renderIngredientList(container, recipeId);
        renderTotals(container, recipeId);
        showToast(`${p.name} hinzugefügt`);
      });
    });
  }

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 350);
  });
}

function guessGrams(product) {
  const m = String(product.servingSize || "").match(/(\d+(?:[.,]\d+)?)\s*g/i);
  return m ? parseFloat(m[1].replace(",", ".")) : 100;
}

/**
 * Zutaten per Barcode einscannen. Bleibt nach jedem Treffer offen und startet den Scanner neu,
 * damit man beim Kochen mehrere Packungen hintereinander durchziehen kann, ohne den Dialog
 * jedes Mal neu zu öffnen. Die Mengen sind Schätzwerte (Portionsangabe der Packung, sonst
 * 100 g) und werden anschließend in der Zutatenliste angepasst — genau wie bei der Textsuche.
 */
function openIngredientScanner(recipeId, onAdded) {
  const added = [];
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">Zutat scannen</h2>
      <p class="hint">Barcode ins Bild halten. Nach jedem Treffer geht es direkt weiter — mehrere Zutaten nacheinander sind kein Problem.</p>
      <div class="scan-wrap" style="margin-top:12px">
        <video id="ingScanVideo" playsinline muted></video>
        <div class="scan-frame"></div>
        <div class="scan-status" id="ingScanStatus">Kamera wird gestartet …</div>
      </div>
      <div id="ingScanAdded"></div>
      <button type="button" class="btn" id="ingScanDone" style="margin-top:4px">Fertig</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const video = overlay.querySelector("#ingScanVideo");
  const statusEl = overlay.querySelector("#ingScanStatus");
  const addedEl = overlay.querySelector("#ingScanAdded");
  const setStatus = (text) => { statusEl.textContent = text; };

  const close = bindBackClose(() => { stopScanner(); overlay.remove(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#ingScanDone").addEventListener("click", () => {
    close();
    if (added.length > 0) showToast(`${added.length} Zutat(en) hinzugefügt`);
  });

  const renderAdded = () => {
    if (added.length === 0) { addedEl.innerHTML = ""; return; }
    addedEl.innerHTML = `
      <p class="hint" style="margin-top:12px">Hinzugefügt:</p>
      ${added.map(a => `
        <div class="list-item" style="padding:8px 12px">
          <div class="info">
            <div class="name">${esc(a.name)}</div>
            <div class="meta">${a.grams} g — Menge später in der Liste anpassen</div>
          </div>
        </div>
      `).join("")}
    `;
  };

  const scanNext = () => {
    startScanner(video, handleCode, setStatus).catch(err => {
      console.error("Zutaten-Scanner konnte nicht gestartet werden:", err);
      setStatus("Kamerazugriff fehlgeschlagen — Berechtigung prüfen.");
    });
  };

  async function handleCode(barcode) {
    setStatus("Produkt wird gesucht …");
    try {
      const product = await lookupProduct(barcode);
      const grams = guessGrams(product);
      addIngredient(recipeId, {
        name: product.name,
        grams,
        per100: product.per100,
        likelyUsLabel: product.likelyUsLabel,
      });
      added.push({ name: product.name, grams });
      renderAdded();
      onAdded?.();
      setStatus(`${product.name} hinzugefügt — nächsten Barcode scannen`);
    } catch (err) {
      setStatus(err.notFound
        ? "Produkt nicht gefunden — nächsten Barcode scannen oder unten von Hand suchen."
        : "Produktsuche fehlgeschlagen (offline?) — nächsten Barcode scannen.");
    }
    // Scanner stoppt sich nach jedem Treffer selbst (siehe scanner.js) — für die nächste
    // Zutat neu starten, solange der Dialog offen ist.
    if (document.body.contains(overlay)) scanNext();
  }

  scanNext();
}

function wireManualIngredient(container, recipeId) {
  container.querySelector("#manualIngToggle").addEventListener("click", () => {
    const wrap = container.querySelector("#manualIngWrap");
    const show = wrap.style.display === "none";
    wrap.style.display = show ? "block" : "none";
    if (!show) return;
    wrap.innerHTML = `
      <label>Name</label><input type="text" id="miName">
      <div class="field-row">
        <div><label>Menge (g)</label><input type="number" id="miGrams" value="100"></div>
        <div><label>kcal /100g</label><input type="number" id="miKcal"></div>
      </div>
      <div class="field-row">
        <div><label>Kohlenhydrate /100g</label><input type="number" step="0.1" id="miCarbs"></div>
        <div><label>Fett /100g</label><input type="number" step="0.1" id="miFat"></div>
      </div>
      <div class="field-row">
        <div><label>Eiweiß /100g</label><input type="number" step="0.1" id="miProtein"></div>
        <div><label>Ballaststoffe /100g</label><input type="number" step="0.1" id="miFiber"></div>
      </div>
      <button class="btn" id="miSave" style="margin-top:12px">Zutat hinzufügen</button>
    `;
    wrap.querySelector("#miSave").addEventListener("click", () => {
      const val = (id) => wrap.querySelector(id).value;
      const name = val("#miName").trim();
      if (!name) { showToast("Bitte einen Namen eingeben"); return; }
      const num = (raw) => { const n = parseFloat(raw); return Number.isNaN(n) ? null : n; };
      addIngredient(recipeId, {
        name,
        grams: num(val("#miGrams")) ?? 100,
        per100: {
          kcal: num(val("#miKcal")), carbs: num(val("#miCarbs")), fiber: num(val("#miFiber")),
          sugars: null, fat: num(val("#miFat")), saturatedFat: null, protein: num(val("#miProtein")), salt: null,
        },
        likelyUsLabel: false,
      });
      wrap.style.display = "none";
      renderIngredientList(container, recipeId);
      renderTotals(container, recipeId);
      showToast(`${name} hinzugefügt`);
    });
  });
}

// ---------------------------------------------------------------------------
// Bild-/Text-Import mit Review
// ---------------------------------------------------------------------------

function wireImport(container, recipeId) {
  const statusEl = container.querySelector("#importStatus");
  const fileInput = container.querySelector("#recipeImageInput");
  const withAi = hasApiKey();

  container.querySelector("#importImageBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    statusEl.textContent = "Texterkennung wird geladen … (beim ersten Mal ca. 5 MB Download)";
    try {
      const text = await recognizeImageText(file, (s) => { statusEl.textContent = s; });
      statusEl.textContent = "";
      if (!text.trim()) {
        showToast("Kein Text im Bild erkannt");
        return;
      }
      startReview(container, recipeId, text);
    } catch (err) {
      console.error("OCR fehlgeschlagen:", err);
      statusEl.textContent = "";
      showToast("Texterkennung fehlgeschlagen — bitte Text manuell einfügen oder Zutaten von Hand eintragen.");
    }
  });

  container.querySelector("#importTextBtn").addEventListener("click", () => {
    const wrap = container.querySelector("#textPasteWrap");
    const show = wrap.style.display === "none";
    wrap.style.display = show ? "block" : "none";
    if (!show) return;
    wrap.innerHTML = `
      <label for="pasteText">Zutatenliste einfügen (eine Zutat pro Zeile)</label>
      <textarea id="pasteText" rows="6" style="width:100%;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);padding:10px;font:inherit"></textarea>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" id="pasteParseBtn">Zeilen prüfen</button>
        ${withAi ? `<button class="btn secondary" id="pasteAiBtn">🤖 Mit KI erkennen</button>` : ""}
      </div>
    `;
    wrap.querySelector("#pasteParseBtn").addEventListener("click", () => {
      const text = wrap.querySelector("#pasteText").value;
      if (!text.trim()) { showToast("Bitte Text einfügen"); return; }
      wrap.style.display = "none";
      startReview(container, recipeId, text);
    });
    wrap.querySelector("#pasteAiBtn")?.addEventListener("click", async () => {
      const text = wrap.querySelector("#pasteText").value;
      if (!text.trim()) { showToast("Bitte Text einfügen"); return; }
      statusEl.textContent = "🤖 Gemini analysiert den Text …";
      try {
        const ingredients = await recognizeIngredientsFromText(text);
        statusEl.textContent = "";
        if (!ingredients.length) { showToast("KI hat keine Zutaten erkannt"); return; }
        wrap.style.display = "none";
        startReviewFromAI(container, recipeId, ingredients);
      } catch (err) {
        statusEl.textContent = "";
        showToast(describeAiError(err));
      }
    });
  });

  if (withAi) wireAiImageImport(container, recipeId, statusEl);
}

function wireAiImageImport(container, recipeId, statusEl) {
  const card = container.querySelector("#importTextBtn").closest(".card");
  const btn = document.createElement("button");
  btn.className = "btn ghost";
  btn.id = "importAiImageBtn";
  btn.style.marginTop = "8px";
  btn.textContent = "🤖 Bild direkt mit KI auswerten";
  card.querySelector(".btn-row").insertAdjacentElement("afterend", btn);

  const aiFileInput = document.createElement("input");
  aiFileInput.type = "file";
  aiFileInput.accept = "image/*";
  aiFileInput.style.display = "none";
  card.appendChild(aiFileInput);

  btn.addEventListener("click", () => aiFileInput.click());
  aiFileInput.addEventListener("change", async () => {
    const file = aiFileInput.files[0];
    aiFileInput.value = "";
    if (!file) return;
    statusEl.textContent = "🤖 Gemini liest das Bild …";
    try {
      const ingredients = await recognizeIngredientsFromImage(file);
      statusEl.textContent = "";
      if (!ingredients.length) { showToast("KI hat keine Zutaten im Bild erkannt"); return; }
      startReviewFromAI(container, recipeId, ingredients);
    } catch (err) {
      statusEl.textContent = "";
      showToast(describeAiError(err));
    }
  });
}

/** Baut die Prüfansicht direkt aus den von der KI gelieferten, bereits fertigen Werten auf. */
function startReviewFromAI(container, recipeId, ingredients) {
  reviewRows = ingredients.map(i => ({
    id: crypto.randomUUID(),
    raw: i.name,
    name: i.name,
    grams: i.grams > 0 ? i.grams : null,
    per100: i.per100,
    likelyUsLabel: false,
    matchedName: i.name,
    matchQuality: "ai",
  }));
  renderReview(container, recipeId);
}

function startReview(container, recipeId, text) {
  const parsed = parseIngredientText(text);
  reviewRows = parsed.map(p => {
    const match = bestLocalFoodMatch(p.name);
    const product = match?.product;
    return {
      id: crypto.randomUUID(),
      raw: p.raw,
      name: p.name,
      grams: p.grams ?? (product && p.quantity != null ? guessGrams(product) * p.quantity : null),
      per100: product ? product.per100 : null,
      likelyUsLabel: product ? product.likelyUsLabel : false,
      matchedName: product ? product.name : null,
      // "exact"/"word" = zuverlässig, "substring"/"fuzzy" = Vermutung -> in der Prüfansicht markieren.
      matchQuality: match ? match.quality : null,
    };
  });
  renderReview(container, recipeId);
}

const UNCERTAIN_MATCH = new Set(["substring", "fuzzy"]);

function matchLabelText(r) {
  if (r.matchQuality === "ai") return `🤖 KI-Schätzung — Werte vor dem Übernehmen prüfen`;
  if (!r.matchedName) return "Keine Zuordnung gefunden — Menge/Nährwerte manuell prüfen oder Zeile entfernen";
  if (UNCERTAIN_MATCH.has(r.matchQuality)) return `⚠️ Unsichere Zuordnung: ${esc(r.matchedName)} — bitte prüfen`;
  return `Zuordnung: ${esc(r.matchedName)}`;
}

function matchLabelStyle(r) {
  if (r.matchQuality === "ai") return "color:var(--accent)";
  if (UNCERTAIN_MATCH.has(r.matchQuality)) return "color:var(--yellow-fg)";
  return "";
}

function renderReview(container, recipeId) {
  const wrap = container.querySelector("#reviewWrap");
  if (!reviewRows || reviewRows.length === 0) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = `
    <h2 class="section-title" style="margin-top:20px">Erkannte Zutaten prüfen</h2>
    <p class="hint" style="margin-top:-8px">Namen, Mengen und Zuordnung vor dem Übernehmen kontrollieren.</p>
    <div id="reviewRows"></div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn secondary" id="reviewCancel">Verwerfen</button>
      <button class="btn" id="reviewApply">Zutaten übernehmen</button>
    </div>
  `;
  const rowsEl = wrap.querySelector("#reviewRows");
  rowsEl.innerHTML = reviewRows.map(r => `
    <div class="card" data-id="${r.id}" style="margin-bottom:8px">
      <p class="hint" style="margin-top:0;margin-bottom:6px">„${esc(r.raw)}"</p>
      <div class="field-row">
        <div><label>Name</label><input type="text" class="rv-name" value="${esc(r.name)}"></div>
        <div><label>Menge (g)</label><input type="number" class="rv-grams" value="${r.grams ?? ""}"></div>
      </div>
      <p class="hint rv-match-label" style="margin-top:6px;${matchLabelStyle(r)}">${matchLabelText(r)}</p>
      <div class="btn-row" style="margin-top:6px">
        <button class="btn ghost rv-research" style="width:auto">🔎 Neu zuordnen</button>
        <button class="btn ghost rv-remove" style="width:auto;color:var(--red-fg)">Entfernen</button>
      </div>
      <div class="rv-research-wrap" style="display:none;margin-top:8px"></div>
    </div>
  `).join("");

  rowsEl.querySelectorAll(".card").forEach(card => {
    const id = card.dataset.id;
    const row = reviewRows.find(r => r.id === id);

    card.querySelector(".rv-name").addEventListener("change", (e) => { row.name = e.target.value.trim(); });
    card.querySelector(".rv-grams").addEventListener("change", (e) => {
      const g = parseFloat(e.target.value);
      row.grams = Number.isNaN(g) ? null : g;
    });
    card.querySelector(".rv-remove").addEventListener("click", () => {
      reviewRows = reviewRows.filter(r => r.id !== id);
      renderReview(container, recipeId);
    });
    card.querySelector(".rv-research").addEventListener("click", () => {
      const rwrap = card.querySelector(".rv-research-wrap");
      const show = rwrap.style.display === "none";
      rwrap.style.display = show ? "block" : "none";
      if (!show) return;
      rwrap.innerHTML = `<input type="text" class="rv-research-input" placeholder="Suchbegriff …"><div class="rv-research-results" style="margin-top:6px"></div>`;
      const rInput = rwrap.querySelector(".rv-research-input");
      const rResults = rwrap.querySelector(".rv-research-results");
      let t = null;
      rInput.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const term = rInput.value.trim();
          if (term.length < 2) { rResults.innerHTML = ""; return; }
          const own = searchOwnProducts(term);
          const local = searchLocalFoods(term).filter(p => !own.some(o => o.name.toLowerCase() === p.name.toLowerCase()));
          const offline = [...own, ...local];
          const online = await searchProductsByName(term);
          const seenNames = new Set(offline.map(p => p.name.toLowerCase()));
          const items = [...offline, ...online.filter(p => !seenNames.has(p.name.toLowerCase()))];
          rResults.innerHTML = items.map((p, i) => `
            <div class="list-item" data-idx="${i}" style="cursor:pointer">
              <div class="info"><div class="name">${esc(p.name)}</div></div>
            </div>
          `).join("") || `<p class="hint">Keine Treffer.</p>`;
          rResults.querySelectorAll(".list-item").forEach(el => {
            el.addEventListener("click", () => {
              const p = items[Number(el.dataset.idx)];
              row.per100 = p.per100;
              row.likelyUsLabel = p.likelyUsLabel;
              row.matchedName = p.name;
              row.matchQuality = "manual"; // von Hand bestätigt -> kein Unsicher-Hinweis mehr
              if (row.grams == null) row.grams = guessGrams(p);
              renderReview(container, recipeId);
            });
          });
        }, 350);
      });
      rInput.focus();
    });
  });

  wrap.querySelector("#reviewCancel").addEventListener("click", () => {
    reviewRows = null;
    renderReview(container, recipeId);
  });
  wrap.querySelector("#reviewApply").addEventListener("click", () => {
    let added = 0, skipped = 0;
    for (const r of reviewRows) {
      if (r.grams > 0 && r.per100) {
        addIngredient(recipeId, { name: r.name, grams: r.grams, per100: r.per100, likelyUsLabel: r.likelyUsLabel });
        added++;
      } else {
        skipped++;
      }
    }
    reviewRows = null;
    renderReview(container, recipeId);
    renderIngredientList(container, recipeId);
    renderTotals(container, recipeId);
    showToast(skipped > 0 ? `${added} Zutaten übernommen, ${skipped} übersprungen (keine Menge/Zuordnung)` : `${added} Zutaten übernommen`);
  });
}
