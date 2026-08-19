// product-editor.js — gemeinsames Formular für "Produkt selbst anlegen" und "Werte
// korrigieren". Wird zweifach genutzt: im Scan-Tab direkt in der Seite (dort ersetzt es die
// Ergebniskarte) und aus den Listen heraus als Dialog.
import { Store } from "./store.js";
import { saveOwnProduct } from "./off.js";
import { esc, showToast, bindBackClose, keepActionsInView } from "./ui.js";

/**
 * existing: Produkt mit aktuellen Werten (aus Scan/OFF), wenn als Korrektur geöffnet.
 * prefillName: Namensvorschlag für ein wirklich neues Produkt (z.B. aus der Namenssuche).
 * Die Reihenfolge der Nährwertfelder folgt der Verpackungsangabe (Energie, Fett, KH, …).
 */
export function ownProductFormHtml(barcode, existing = null, prefillName = "", { inCard = true } = {}) {
  const p = existing?.per100 || {};
  const body = `
    <h2>${existing ? "Werte korrigieren" : "Neues Produkt"} · ${esc(barcode)}</h2>
    ${existing ? `<p class="hint" style="margin-top:0">Deine Angaben haben ab jetzt immer Vorrang vor Open Food Facts für dieses Produkt.</p>` : ""}
    <label>Name</label><input type="text" id="opName" required value="${esc(existing?.name || prefillName)}">
    <label>Marke</label><input type="text" id="opBrand" value="${esc(existing?.brand || "")}">
    <div class="field-row">
      <div><label>Portionsgröße (z.B. "30 g")</label><input type="text" id="opServing" value="${esc(existing?.servingSize || "")}"></div>
    </div>
    <p class="hint" style="margin-top:12px">Nährwerte pro 100 g — in der Reihenfolge der Verpackung:</p>
    <label>Energie (kcal)</label><input type="number" step="1" id="opKcal" value="${p.kcal ?? ""}">
    <div class="field-row">
      <div><label>Fett (g)</label><input type="number" step="0.1" id="opFat" value="${p.fat ?? ""}"></div>
      <div><label>davon gesättigte Fettsäuren (g)</label><input type="number" step="0.1" id="opSatFat" value="${p.saturatedFat ?? ""}"></div>
    </div>
    <div class="field-row">
      <div><label>Kohlenhydrate (g)</label><input type="number" step="0.1" id="opCarbs" value="${p.carbs ?? ""}"></div>
      <div><label>davon Zucker (g)</label><input type="number" step="0.1" id="opSugars" value="${p.sugars ?? ""}"></div>
    </div>
    <div class="field-row">
      <div><label>Ballaststoffe (g)</label><input type="number" step="0.1" id="opFiber" value="${p.fiber ?? ""}"></div>
      <div><label>Eiweiß (g)</label><input type="number" step="0.1" id="opProtein" value="${p.protein ?? ""}"></div>
    </div>
    <label>Salz (g)</label><input type="number" step="0.01" id="opSalt" value="${p.salt ?? ""}">
    <label>Zutaten (optional, für Warnhinweise)</label>
    <input type="text" id="opIngredients" placeholder="z.B. Wasser, Zucker, Maltodextrin …" value="${esc(existing?.ingredientsText || "")}">
    <div class="btn-row" style="margin-top:14px">
      ${existing ? `<button type="button" class="btn secondary" id="opCancel">Abbrechen</button>` : ""}
      <button type="button" class="btn" id="opSave">Speichern</button>
    </div>
  `;
  return inCard ? `<div class="card">${body}</div>` : body;
}

/**
 * Liest das Formular unter `root` aus und speichert es als eigenes Produkt. Gibt das
 * gespeicherte Produkt zurück — oder null, wenn der Name fehlt.
 */
function readAndSave(root, barcode) {
  const val = (id) => root.querySelector(id).value;
  const name = val("#opName").trim();
  if (!name) { showToast("Bitte einen Namen eingeben"); return null; }
  const numOrNull = (raw) => {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : n;
  };
  const product = saveOwnProduct(barcode, {
    name,
    brand: val("#opBrand").trim(),
    servingSize: val("#opServing").trim(),
    kcal: numOrNull(val("#opKcal")),
    fat: numOrNull(val("#opFat")),
    saturatedFat: numOrNull(val("#opSatFat")),
    carbs: numOrNull(val("#opCarbs")),
    sugars: numOrNull(val("#opSugars")),
    fiber: numOrNull(val("#opFiber")),
    protein: numOrNull(val("#opProtein")),
    salt: numOrNull(val("#opSalt")),
    ingredientsText: val("#opIngredients").trim(),
  });
  // Eigene Werte sind jetzt maßgeblich — kein zusätzliches Abziehen von Ballaststoffen mehr.
  Store.clearFiberOverride(barcode);
  showToast("Produkt gespeichert");
  return product;
}

/** Verdrahtet ein direkt in der Seite gerendertes Formular (Scan-Tab). */
export function wireOwnProductForm(root, barcode, { onSaved, onCancel } = {}) {
  root.querySelector("#opCancel")?.addEventListener("click", () => onCancel?.());
  root.querySelector("#opSave").addEventListener("click", () => {
    const product = readAndSave(root, barcode);
    if (product) onSaved?.(product);
  });
}

/** Dasselbe Formular als Dialog — aus den Listen heraus, ohne den Umweg über den Scan-Tab. */
export function openProductEditor(product, onSaved) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal-card">${ownProductFormHtml(product.barcode, product, "", { inCard: false })}</div>`;
  document.body.appendChild(overlay);

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#opCancel").addEventListener("click", close);
  overlay.querySelector("#opSave").addEventListener("click", () => {
    const saved = readAndSave(overlay, product.barcode);
    if (!saved) return;
    close();
    onSaved?.(saved);
  });
  keepActionsInView(overlay);
}
