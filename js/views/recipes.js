// views/recipes.js — Rezepte: Liste, Editor, Zutatensuche, Bild-/Text-Import mit Review.
import { Store } from "../store.js";
import { lookupProduct, searchProductsByName } from "../off.js";
import { searchLocalFoods, bestLocalFoodMatch } from "../foods-db.js";
import { calcNetCarbs, ketoGrade, GRADE_LABEL } from "../keto.js";
import {
  createRecipe, updateRecipeMeta, deleteRecipe, addIngredient, removeIngredient,
  updateIngredient, calcRecipeTotals, calcPerServing, logRecipeConsumption,
  parseIngredientText, recognizeImageText,
} from "../recipes.js";
import { showToast, esc } from "../ui.js";

let openRecipeId = null;
let reviewRows = null; // Kandidaten aus Bild-/Text-Import, während der Review-Phase

export function renderRecipes(container) {
  if (openRecipeId && Store.getRecipe(openRecipeId)) {
    renderEditor(container, openRecipeId);
  } else {
    openRecipeId = null;
    renderList(container);
  }
}

function renderList(container) {
  const recipes = Store.getRecipes();
  container.innerHTML = `
    <h1 class="section-title">Rezepte</h1>
    <button class="btn" id="newRecipeBtn">➕ Neues Rezept</button>
    <div id="recipeListBody" style="margin-top:14px"></div>
  `;

  container.querySelector("#newRecipeBtn").addEventListener("click", () => {
    const recipe = createRecipe("Neues Rezept", 4);
    openRecipeId = recipe.id;
    renderEditor(container, recipe.id);
  });

  const body = container.querySelector("#recipeListBody");
  if (recipes.length === 0) {
    body.innerHTML = `<div class="empty-state"><span class="emoji">🍳</span>Noch keine Rezepte angelegt.</div>`;
    return;
  }

  body.innerHTML = recipes.map(r => {
    const perServing = calcPerServing(r);
    const grade = ketoGrade(perServing.netCarbs);
    return `
      <div class="card" data-id="${r.id}">
        <div class="btn-row" style="align-items:center;justify-content:space-between;margin-bottom:6px">
          <span class="badge ${grade}">${{ green: "🟢", yellow: "🟡", red: "🔴", gray: "⚪" }[grade]} ${esc(GRADE_LABEL[grade])}</span>
          <button class="icon-btn" data-action="delete" title="Löschen">🗑️</button>
        </div>
        <div class="name" style="font-size:1.05rem;cursor:pointer" data-action="open">${esc(r.name)}</div>
        <p class="hint">${r.ingredients.length} Zutaten · ${r.servings} Portionen</p>
        <div class="grid-2" style="margin-top:8px">
          <div class="stat"><div class="val">${perServing.kcal ?? "–"}</div><div class="lbl">kcal/Portion</div></div>
          <div class="stat"><div class="val">${perServing.netCarbs ?? "–"} g</div><div class="lbl">Netto-KH/Portion</div></div>
        </div>
        <button class="btn secondary" data-action="addToday" style="margin-top:10px">🍽️ Zum Tag hinzufügen</button>
      </div>
    `;
  }).join("");

  body.querySelectorAll(".card").forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-action="open"]').addEventListener("click", () => {
      openRecipeId = id;
      renderEditor(container, id);
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", () => {
      const recipe = Store.getRecipe(id);
      if (confirm(`Rezept „${recipe.name}" wirklich löschen?`)) {
        deleteRecipe(id);
        renderList(container);
        showToast("Rezept gelöscht");
      }
    });
    card.querySelector('[data-action="addToday"]').addEventListener("click", () => {
      openServingsModal(Store.getRecipe(id));
    });
  });
}

function openServingsModal(recipe) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">${esc(recipe.name)}</h2>
      <p class="hint">Wie viele Portionen hinzufügen?</p>
      <label for="servingsInput">Portionen</label>
      <input type="number" id="servingsInput" value="1" min="0.25" step="0.25">
      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn secondary" id="servingsCancel">Abbrechen</button>
        <button type="button" class="btn" id="servingsConfirm">Eintragen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#servingsCancel").addEventListener("click", close);
  overlay.querySelector("#servingsConfirm").addEventListener("click", () => {
    const servings = parseFloat(overlay.querySelector("#servingsInput").value);
    if (!servings || servings <= 0) { showToast("Bitte eine gültige Anzahl angeben"); return; }
    logRecipeConsumption(recipe, servings);
    showToast(`${servings} Portion(en) „${recipe.name}" eingetragen`);
    close();
  });
  overlay.querySelector("#servingsInput").focus();
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function renderEditor(container, recipeId) {
  const recipe = Store.getRecipe(recipeId);
  if (!recipe) { openRecipeId = null; renderList(container); return; }
  reviewRows = null;

  container.innerHTML = `
    <button class="btn ghost" id="backBtn" style="width:auto;padding:0 4px;margin-bottom:6px">← Zurück zu Rezepten</button>

    <div class="card">
      <label for="recName">Name</label>
      <input type="text" id="recName" value="${esc(recipe.name)}">
      <label for="recServings">Portionen</label>
      <input type="number" id="recServings" value="${recipe.servings}" min="1" step="1">
    </div>

    <div class="card" id="totalsCard"></div>

    <h2 class="section-title">Zutaten</h2>
    <div id="ingredientList"></div>

    <div class="card">
      <label for="ingSearchInput">Zutat suchen und hinzufügen</label>
      <input type="text" id="ingSearchInput" placeholder="z.B. Rinderhackfleisch, Bacon …" autocomplete="off">
      <div id="ingSearchResults" style="margin-top:8px"></div>
      <button class="btn ghost" id="manualIngToggle" style="margin-top:10px">✏️ Zutat manuell eintragen</button>
      <div id="manualIngWrap" style="display:none;margin-top:10px"></div>
    </div>

    <h2 class="section-title">Aus Bild oder Text importieren</h2>
    <div class="card">
      <p class="hint" style="margin-top:0">Foto einer Zutatenliste (z.B. Screenshot) einlesen, oder Text direkt einfügen. Ergebnis kannst du danach prüfen und korrigieren.</p>
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

  container.querySelector("#backBtn").addEventListener("click", () => {
    openRecipeId = null;
    renderList(container);
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
      openRecipeId = null;
      renderList(container);
      showToast("Rezept gelöscht");
    }
  });

  renderTotals(container, recipeId);
  renderIngredientList(container, recipeId);
  wireIngredientSearch(container, recipeId);
  wireManualIngredient(container, recipeId);
  wireImport(container, recipeId);
}

function renderTotals(container, recipeId) {
  const recipe = Store.getRecipe(recipeId);
  const perServing = calcPerServing(recipe);
  const grade = ketoGrade(perServing.netCarbs);
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

    const local = searchLocalFoods(term);
    renderIngSearchResults(local, false);

    const online = await searchProductsByName(term);
    if (seq !== requestSeq) return;
    const localNames = new Set(local.map(p => p.name.toLowerCase()));
    const combined = [...local, ...online.filter(p => !localNames.has(p.name.toLowerCase()))];
    renderIngSearchResults(combined, true);
  };

  function renderIngSearchResults(items, isFinal) {
    if (items.length === 0) {
      resultsEl.innerHTML = isFinal ? `<p class="hint">Keine Treffer.</p>` : `<p class="hint">Suche …</p>`;
      return;
    }
    resultsEl.innerHTML = items.map((p, i) => `
      <div class="list-item" data-idx="${i}" style="cursor:pointer">
        <span style="flex-shrink:0">${p.source === "local" ? "🥑" : "🏷️"}</span>
        <div class="info">
          <div class="name">${esc(p.name)}</div>
          <div class="meta">${p.brand ? esc(p.brand) + " · " : ""}${p.source === "local" ? "Grundnahrungsmittel" : "Open Food Facts"}</div>
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
      <button class="btn" id="pasteParseBtn" style="margin-top:10px">Zeilen prüfen</button>
    `;
    wrap.querySelector("#pasteParseBtn").addEventListener("click", () => {
      const text = wrap.querySelector("#pasteText").value;
      if (!text.trim()) { showToast("Bitte Text einfügen"); return; }
      wrap.style.display = "none";
      startReview(container, recipeId, text);
    });
  });
}

function startReview(container, recipeId, text) {
  const parsed = parseIngredientText(text);
  reviewRows = parsed.map(p => {
    const match = bestLocalFoodMatch(p.name);
    return {
      id: crypto.randomUUID(),
      raw: p.raw,
      name: p.name,
      grams: p.grams ?? (match && p.quantity != null ? guessGrams(match) * p.quantity : null),
      per100: match ? match.per100 : null,
      likelyUsLabel: match ? match.likelyUsLabel : false,
      matchedName: match ? match.name : null,
    };
  });
  renderReview(container, recipeId);
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
      <p class="hint rv-match-label" style="margin-top:6px">${r.matchedName ? `Zuordnung: ${esc(r.matchedName)}` : "Keine Zuordnung gefunden — Menge/Nährwerte manuell prüfen oder Zeile entfernen"}</p>
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
          const local = searchLocalFoods(term);
          const online = await searchProductsByName(term);
          const localNames = new Set(local.map(p => p.name.toLowerCase()));
          const items = [...local, ...online.filter(p => !localNames.has(p.name.toLowerCase()))];
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
