// views/scan.js — Scan-Tab: Kamera, Ergebniskarte, manuelle Eingabe, "Produkt selbst anlegen".
import { Store } from "../store.js";
import { calcTargets } from "../profiles.js";
import { lookupProduct, saveOwnProduct, searchProductsByName } from "../off.js";
import { searchLocalFoods } from "../foods-db.js";
import { evaluateProduct, GRADE_LABEL } from "../keto.js";
import { startScanner, stopScanner, isScannerSupported } from "../scanner.js";
import { openQuantityModal } from "../consumption.js";
import { showToast, esc } from "../ui.js";

let currentBarcode = null;

export function renderScan(container) {
  stopScanner();
  currentBarcode = null;

  if (!isScannerSupported()) {
    container.innerHTML = manualOnlyMarkup("Kamera wird von diesem Browser nicht unterstützt.");
    wireManualForm(container);
    wireSearchToggle(container);
    return;
  }

  container.innerHTML = `
    <h1 class="section-title">Scannen</h1>
    <div class="scan-wrap">
      <video id="scanVideo" playsinline muted></video>
      <div class="scan-frame"></div>
      <div class="scan-status" id="scanStatus">Kamera wird gestartet …</div>
    </div>
    <button class="btn secondary" id="manualToggle">🔢 Barcode manuell eingeben</button>
    <button class="btn secondary" id="searchToggle" style="margin-top:8px">🔎 Lebensmittel ohne Barcode suchen</button>
    <div id="manualFormWrap" style="display:none;margin-top:12px"></div>
    <div id="searchFormWrap" style="display:none;margin-top:12px"></div>
    <div id="resultWrap"></div>
  `;

  container.querySelector("#manualToggle").addEventListener("click", () => {
    const wrap = container.querySelector("#manualFormWrap");
    const show = wrap.style.display === "none";
    wrap.style.display = show ? "block" : "none";
    if (show) {
      wrap.innerHTML = manualFormHtml();
      wireManualForm(container);
    }
  });

  wireSearchToggle(container);

  const video = container.querySelector("#scanVideo");
  const statusEl = container.querySelector("#scanStatus");

  startScanner(
    video,
    (barcode) => handleBarcode(container, barcode),
    (status) => { if (statusEl) statusEl.textContent = status; }
  ).catch(err => {
    console.error("Scanner konnte nicht gestartet werden:", err);
    statusEl.textContent = "Kamerazugriff fehlgeschlagen. Bitte Berechtigung erlauben oder manuell eingeben.";
  });
}

export function cleanupScan() {
  stopScanner();
}

function manualOnlyMarkup(message) {
  return `
    <h1 class="section-title">Scannen</h1>
    <div class="card"><p>${esc(message)}</p></div>
    <div id="manualFormWrap">${manualFormHtml()}</div>
    <button class="btn secondary" id="searchToggle">🔎 Lebensmittel ohne Barcode suchen</button>
    <div id="searchFormWrap" style="display:none;margin-top:12px"></div>
    <div id="resultWrap"></div>
  `;
}

function wireSearchToggle(container) {
  container.querySelector("#searchToggle").addEventListener("click", () => {
    const wrap = container.querySelector("#searchFormWrap");
    const show = wrap.style.display === "none";
    wrap.style.display = show ? "block" : "none";
    if (show) {
      wrap.innerHTML = searchFormHtml();
      wireSearchForm(container);
      wrap.querySelector("#foodSearchInput").focus();
    }
  });
}

function searchFormHtml() {
  return `
    <div class="card">
      <label for="foodSearchInput">Lebensmittel suchen (ohne Barcode)</label>
      <input type="text" id="foodSearchInput" placeholder="z.B. Eier, Gouda, Avocado …" autocomplete="off">
      <div id="searchResults" style="margin-top:10px"></div>
    </div>
  `;
}

function wireSearchForm(container) {
  const input = container.querySelector("#foodSearchInput");
  const resultsEl = container.querySelector("#searchResults");
  if (!input) return;

  let debounceTimer = null;
  let requestSeq = 0;

  const runSearch = async () => {
    const term = input.value.trim();
    const seq = ++requestSeq;
    if (term.length < 2) {
      resultsEl.innerHTML = "";
      return;
    }

    const local = searchLocalFoods(term);
    renderSearchResults(container, resultsEl, local, false, term);

    const online = await searchProductsByName(term);
    if (seq !== requestSeq) return; // Nutzer hat weitergetippt, veraltete Antwort verwerfen
    const localNames = new Set(local.map(p => p.name.toLowerCase()));
    const combined = [...local, ...online.filter(p => !localNames.has(p.name.toLowerCase()))];
    renderSearchResults(container, resultsEl, combined, true, term);
  };

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 350);
  });
}

function renderSearchResults(container, resultsEl, items, isFinal, term) {
  if (items.length === 0) {
    resultsEl.innerHTML = isFinal
      ? `<p class="hint">Keine Treffer für „${esc(term)}". Du kannst es unten als eigenes Produkt anlegen (Barcode z.B. frei erfinden, etwa <code>eigen-${Date.now().toString().slice(-6)}</code>).</p>`
      : `<p class="hint">Suche …</p>`;
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
      const item = items[Number(row.dataset.idx)];
      handleSearchSelect(container, item);
    });
  });
}

function handleSearchSelect(container, product) {
  const searchWrap = container.querySelector("#searchFormWrap");
  if (searchWrap) searchWrap.style.display = "none";
  Store.pushRecent(product.barcode);
  logHistory(product);
  renderResult(container, product);
  scrollToResult(container);
}

/**
 * Holt die Ergebniskarte in den sichtbaren Bereich, damit nach einem Treffer nicht erst
 * am Kamerabild vorbeigescrollt werden muss. Bewusst nur bei *neuen* Treffern aufgerufen,
 * nicht bei jedem Neuzeichnen (z.B. Favorit umschalten), sonst springt die Seite ständig.
 */
function scrollToResult(container) {
  const resultWrap = container.querySelector("#resultWrap");
  if (!resultWrap) return;
  requestAnimationFrame(() => {
    resultWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** Protokolliert einen Such-/Scan-Treffer im Verlauf (nur Log, keine Mengen/Kalorien). */
function logHistory(product) {
  const profile = Store.getActiveProfile();
  const targets = calcTargets(profile);
  const evalResult = evaluateProduct(product, targets);
  Store.addHistoryEntry({
    id: crypto.randomUUID(),
    barcode: product.barcode,
    name: product.name,
    brand: product.brand,
    grade: evalResult.grade,
    netCarbs100: evalResult.netCarbs100,
    source: product.source,
    profileName: profile.name,
    at: Date.now(),
  });
}

function manualFormHtml() {
  return `
    <div class="card">
      <label for="manualBarcode">Barcode (EAN)</label>
      <div class="btn-row">
        <input type="text" inputmode="numeric" id="manualBarcode" placeholder="z.B. 4008400290423">
        <button class="btn" id="manualSubmit" style="width:auto;padding:0 18px">Suchen</button>
      </div>
    </div>
  `;
}

function wireManualForm(container) {
  const btn = container.querySelector("#manualSubmit");
  const input = container.querySelector("#manualBarcode");
  if (!btn) return;
  const submit = () => {
    const code = input.value.trim();
    if (code) handleBarcode(container, code);
  };
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

async function handleBarcode(container, barcode) {
  currentBarcode = barcode;
  Store.pushRecent(barcode);
  const resultWrap = container.querySelector("#resultWrap");
  resultWrap.innerHTML = `<div class="card"><p class="muted">Suche Produkt …</p></div>`;

  try {
    const product = await lookupProduct(barcode);
    logHistory(product);
    renderResult(container, product);
  } catch (err) {
    if (err.notFound) {
      renderNotFound(container, barcode);
    } else if (err.offline) {
      resultWrap.innerHTML = `<div class="card"><p>📡 Offline und kein gecachtes Produkt für diesen Barcode vorhanden.</p></div>`;
    } else {
      resultWrap.innerHTML = `<div class="card"><p>⚠️ ${esc(err.message)}</p></div>`;
    }
  }
  scrollToResult(container);
}

function renderResult(container, product) {
  const profile = Store.getActiveProfile();
  const targets = calcTargets(profile);
  const fiberOverride = Store.getFiberOverride(product.barcode);
  const subtractFiber = fiberOverride !== undefined ? fiberOverride : product.likelyUsLabel;
  const evalResult = evaluateProduct(product, targets, { subtractFiber });
  const resultWrap = container.querySelector("#resultWrap");
  const hasFiber = product.per100.fiber != null && product.per100.fiber > 0;

  const isFav = Store.isInList("favorites", product.barcode);
  const isNoGo = Store.isInList("noGo", product.barcode);

  resultWrap.innerHTML = `
    <div class="card">
      <div class="btn-row" style="align-items:center;justify-content:space-between;margin-bottom:8px">
        <span class="badge ${evalResult.grade}">${{ green: "🟢", yellow: "🟡", red: "🔴", gray: "⚪" }[evalResult.grade]} ${esc(GRADE_LABEL[evalResult.grade])}</span>
      </div>
      <h2 style="text-transform:none;color:var(--text);font-size:1.15rem;font-weight:800">${esc(product.name)}</h2>
      <p class="muted" style="margin-top:-6px">${esc(product.brand || "")} ${product.quantity ? "· " + esc(product.quantity) : ""}</p>

      <div class="grid-2" style="margin-top:12px">
        <div class="stat"><div class="val">${fmt(evalResult.netCarbs100)}</div><div class="lbl">g Netto-KH /100g</div></div>
        <div class="stat"><div class="val">${fmt(product.per100.fat)}</div><div class="lbl">g Fett /100g</div></div>
        <div class="stat"><div class="val">${fmt(product.per100.protein)}</div><div class="lbl">g Eiweiß /100g</div></div>
        <div class="stat"><div class="val">${fmt(product.per100.kcal)}</div><div class="lbl">kcal /100g</div></div>
      </div>

      ${evalResult.netCarbsServing != null ? `
        <p class="hint" style="margin-top:10px">
          Portion (${evalResult.servingGrams} g): <strong>${evalResult.netCarbsServing} g Netto-KH</strong>
          ${evalResult.pctOfDailyLimit != null ? ` — das sind ${evalResult.pctOfDailyLimit}% deines Tageslimits (${targets.netCarbG} g).` : ""}
        </p>` : ""}

      ${hasFiber ? `
        <label class="btn-row" style="align-items:center;gap:8px;margin-top:10px;cursor:pointer">
          <input type="checkbox" id="fiberToggle" ${subtractFiber ? "checked" : ""} style="width:auto;min-height:auto;flex:none">
          <span class="hint" style="margin:0">Ballaststoffe abziehen (${fmt(product.per100.fiber)} g)</span>
        </label>
      ` : ""}
      ${!evalResult.fiberAvailable ? `<p class="hint">ℹ️ Keine Ballaststoff-Angabe verfügbar.</p>` : ""}
      ${evalResult.sugarAlcohols ? `<p class="hint">ℹ️ Enthält Zuckeralkohole (z.B. Erythrit/Xylit) — wirken sich meist kaum auf den Blutzucker aus.</p>` : ""}

      ${evalResult.plausibility ? `
        <p class="hint" style="margin-top:8px;color:var(--red-fg)">
          ⚠️ Die kcal-Angabe (${fmt(product.per100.kcal)}) passt nicht zu den übrigen Werten — aus Kohlenhydraten/Fett/Eiweiß errechnen sich ca. <strong>${evalResult.plausibility.calculatedKcal} kcal</strong> (${evalResult.plausibility.deviationPct}% Abweichung). Vermutlich ein Fehler in der Datenbank — unten mit „Werte korrigieren" anpassen.
        </p>
      ` : ""}

      ${evalResult.warnings.length ? `
        <ul class="warn-list">${evalResult.warnings.map(w => `<li>⚠️ ${esc(w)}</li>`).join("")}</ul>
      ` : ""}

      <button class="btn" id="eatBtn" style="margin-top:14px">🍽️ Als gegessen eintragen</button>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn ${isFav ? "" : "secondary"}" id="favBtn">⭐ ${isFav ? "Favorit" : "Favorisieren"}</button>
        <button class="btn ${isNoGo ? "danger" : "secondary"}" id="noGoBtn">🚫 ${isNoGo ? "No-Go" : "No-Go"}</button>
      </div>
      <button class="btn ghost" id="cartBtn" style="margin-top:8px">🛒 Auf Einkaufsliste</button>
      <button class="btn ghost" id="correctBtn" style="margin-top:8px">✏️ Werte korrigieren</button>
    </div>
  `;

  resultWrap.querySelector("#fiberToggle")?.addEventListener("change", (e) => {
    Store.setFiberOverride(product.barcode, e.target.checked);
    renderResult(container, product);
  });
  resultWrap.querySelector("#correctBtn").addEventListener("click", () => {
    resultWrap.innerHTML = ownProductFormHtml(product.barcode, product);
    wireOwnProductForm(container, resultWrap, product.barcode, () => renderResult(container, product));
  });

  const entry = () => ({
    barcode: product.barcode,
    name: product.name,
    brand: product.brand,
    addedAt: Date.now(),
    netCarbs100: evalResult.netCarbs100,
    grade: evalResult.grade,
  });

  resultWrap.querySelector("#eatBtn").addEventListener("click", () => {
    openQuantityModal(product);
  });
  resultWrap.querySelector("#favBtn").addEventListener("click", () => {
    Store.addToList("favorites", entry());
    showToast("Zu Favoriten hinzugefügt");
    renderResult(container, product);
  });
  resultWrap.querySelector("#noGoBtn").addEventListener("click", () => {
    Store.addToList("noGo", entry());
    showToast("Als No-Go markiert");
    renderResult(container, product);
  });
  resultWrap.querySelector("#cartBtn").addEventListener("click", () => {
    Store.addShoppingItem(product.name, product.barcode);
    showToast("Auf Einkaufsliste gesetzt");
  });
}

function renderNotFound(container, barcode) {
  const resultWrap = container.querySelector("#resultWrap");
  resultWrap.innerHTML = `
    <div class="card">
      <p>🔍 Barcode <strong>${esc(barcode)}</strong> wurde bei Open Food Facts nicht gefunden.</p>
      <button class="btn secondary" id="addOwnBtn">➕ Produkt selbst anlegen</button>
    </div>
  `;
  resultWrap.querySelector("#addOwnBtn").addEventListener("click", () => {
    resultWrap.innerHTML = ownProductFormHtml(barcode);
    wireOwnProductForm(container, resultWrap, barcode);
  });
}

/** existing: Produkt mit aktuellen Werten (aus Scan/OFF), wenn als Korrektur geöffnet. */
function ownProductFormHtml(barcode, existing = null) {
  const p = existing?.per100 || {};
  return `
    <div class="card">
      <h2>${existing ? "Werte korrigieren" : "Neues Produkt"} · ${esc(barcode)}</h2>
      ${existing ? `<p class="hint" style="margin-top:0">Deine Angaben haben ab jetzt immer Vorrang vor Open Food Facts für dieses Produkt.</p>` : ""}
      <label>Name</label><input type="text" id="opName" required value="${esc(existing?.name || "")}">
      <label>Marke</label><input type="text" id="opBrand" value="${esc(existing?.brand || "")}">
      <div class="field-row">
        <div><label>Portionsgröße (z.B. "30 g")</label><input type="text" id="opServing" value="${esc(existing?.servingSize || "")}"></div>
      </div>
      <p class="hint" style="margin-top:12px">Nährwerte pro 100 g:</p>
      <div class="field-row">
        <div><label>Kohlenhydrate (g)</label><input type="number" step="0.1" id="opCarbs" value="${p.carbs ?? ""}"></div>
        <div><label>davon Ballaststoffe (g)</label><input type="number" step="0.1" id="opFiber" value="${p.fiber ?? ""}"></div>
      </div>
      <div class="field-row">
        <div><label>Zucker (g)</label><input type="number" step="0.1" id="opSugars" value="${p.sugars ?? ""}"></div>
        <div><label>Fett (g)</label><input type="number" step="0.1" id="opFat" value="${p.fat ?? ""}"></div>
      </div>
      <div class="field-row">
        <div><label>Eiweiß (g)</label><input type="number" step="0.1" id="opProtein" value="${p.protein ?? ""}"></div>
        <div><label>kcal</label><input type="number" step="1" id="opKcal" value="${p.kcal ?? ""}"></div>
      </div>
      <label>Zutaten (optional, für Warnhinweise)</label>
      <input type="text" id="opIngredients" placeholder="z.B. Wasser, Zucker, Maltodextrin …" value="${esc(existing?.ingredientsText || "")}">
      <button class="btn" id="opSave" style="margin-top:14px">Speichern</button>
      ${existing ? `<button class="btn ghost" id="opCancel" style="margin-top:8px">Abbrechen</button>` : ""}
    </div>
  `;
}

function wireOwnProductForm(container, resultWrap, barcode, onCancel) {
  resultWrap.querySelector("#opCancel")?.addEventListener("click", () => onCancel?.());
  resultWrap.querySelector("#opSave").addEventListener("click", () => {
    const val = (id) => resultWrap.querySelector(id).value;
    const name = val("#opName").trim();
    if (!name) { showToast("Bitte einen Namen eingeben"); return; }
    const numOrNull = (raw) => {
      const n = parseFloat(raw);
      return Number.isNaN(n) ? null : n;
    };
    const product = saveOwnProduct(barcode, {
      name,
      brand: val("#opBrand").trim(),
      servingSize: val("#opServing").trim(),
      carbs: numOrNull(val("#opCarbs")),
      fiber: numOrNull(val("#opFiber")),
      sugars: numOrNull(val("#opSugars")),
      fat: numOrNull(val("#opFat")),
      protein: numOrNull(val("#opProtein")),
      kcal: numOrNull(val("#opKcal")),
      ingredientsText: val("#opIngredients").trim(),
    });
    Store.clearFiberOverride(barcode); // eigene Werte sind jetzt maßgeblich, kein doppeltes Abziehen mehr
    showToast("Produkt gespeichert");
    logHistory(product);
    renderResult(container, product);
  });
}

function fmt(v) {
  return v == null ? "–" : Math.round(v * 10) / 10;
}
