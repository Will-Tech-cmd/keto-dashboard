// product-editor.js — gemeinsames Formular für "Produkt selbst anlegen" und "Werte
// korrigieren". Wird zweifach genutzt: im Scan-Tab direkt in der Seite (dort ersetzt es die
// Ergebniskarte) und aus den Listen heraus als Dialog.
import { Store } from "./store.js";
import { saveOwnProduct } from "./off.js";
import { esc, showToast, bindBackClose, selectOnFocus } from "./ui.js";

/**
 * existing: Produkt mit aktuellen Werten (aus Scan/OFF), wenn als Korrektur geöffnet.
 * prefillName: Namensvorschlag für ein wirklich neues Produkt (z.B. aus der Namenssuche).
 * Die Reihenfolge der Nährwertfelder folgt der Verpackungsangabe (Energie, Fett, KH, …).
 */
/**
 * Eine Zeile der Nährwerttabelle: Bezeichnung links, Feld und Einheit rechts — dieselbe
 * Anordnung wie auf der Verpackung, damit man beim Abtippen nur noch Zeile für Zeile
 * vergleichen muss. `sub` rückt die „davon …"-Zeilen ein, wie im Etikett.
 */
function nutriRow(label, id, value, { unit = "g", step = 0.1, sub = false } = {}) {
  return `
    <div class="klar-nutri-row${sub ? " sub" : ""}">
      <label for="${id}">${label}</label>
      <div class="klar-nutri-field">
        <input type="number" step="${step}" id="${id}" value="${value ?? ""}" inputmode="decimal">
        <span>${unit}</span>
      </div>
    </div>
  `;
}

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
    <div class="klar-nutri-table">
      ${nutriRow("Brennwert", "opKcal", p.kcal, { unit: "kcal", step: 1 })}
      ${nutriRow("Fett", "opFat", p.fat)}
      ${nutriRow("davon gesättigte Fettsäuren", "opSatFat", p.saturatedFat, { sub: true })}
      ${nutriRow("Kohlenhydrate", "opCarbs", p.carbs)}
      ${nutriRow("davon Zucker", "opSugars", p.sugars, { sub: true })}
      ${nutriRow("Ballaststoffe", "opFiber", p.fiber)}
      ${nutriRow("Eiweiß", "opProtein", p.protein)}
      ${nutriRow("Salz", "opSalt", p.salt, { step: 0.01 })}
    </div>
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

/** Dasselbe Formular als eigener Screen — aus den Listen heraus, ohne den Umweg über den Scan-Tab. */
export function openProductEditor(product, onSaved) {
  const overlay = document.createElement("div");
  overlay.className = "klar-fullscreen-overlay";
  overlay.innerHTML = `
    <div class="klar-fullscreen-head">
      <button type="button" class="klar-back-btn" id="opBack" aria-label="Zurück">‹</button>
      <div class="klar-fullscreen-head-name">
        <div class="klar-fullscreen-title">${esc(product.name || product.barcode)}</div>
        <div class="klar-fullscreen-sub">Werte korrigieren</div>
      </div>
    </div>
    <div class="klar-fullscreen-body">
      ${ownProductFormHtml(product.barcode, product, "", { inCard: false })}
    </div>
  `;
  document.body.appendChild(overlay);

  const close = bindBackClose(() => overlay.remove());
  overlay.querySelector("#opBack").addEventListener("click", close);
  overlay.querySelector("#opCancel").addEventListener("click", close);
  overlay.querySelector("#opSave").addEventListener("click", () => {
    const saved = readAndSave(overlay, product.barcode);
    if (!saved) return;
    close();
    onSaved?.(saved);
  });
  // Kein keepActionsInView: der Vollbild-Screen scrollt seinen Inhalt ohnehin selbst, die
  // Tastatur verdeckt nur den unteren Teil davon statt eine schwebende Karte zu überlagern.
  selectOnFocus(overlay);
}
