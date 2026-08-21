// consumption.js — Menge "gegessen" eintragen und mit dem Tagesziel verrechnen.
// Trägt außerdem die aktuell auf der Startseite angezeigte Datumsnavigation (für die
// Essensplanung), damit Einträge aus Scan/Listen/Rezepten immer auf dem gewählten Tag landen.
import { Store, dateKeyOf } from "./store.js";
import { calcNetCarbs, parseServingGrams } from "./keto.js";
import { esc, showToast, bindBackClose, keepActionsInView } from "./ui.js";

export const MEAL_LABELS = {
  breakfast: "🌅 Frühstück",
  lunch: "☀️ Mittag",
  dinner: "🌙 Abend",
  snack: "🍎 Snack",
};

/** Mahlzeitenname ohne Emoji — für Fließtext und knappe Knopfbeschriftungen. Fällt auf
 * "Mahlzeit" zurück statt eine bestimmte vorzutäuschen, wenn keine gewählt ist (z.B. ältere
 * Einträge ohne Zuordnung) — sonst stünde überall "Snack", ohne dass je Snack gewählt wurde. */
export function mealShort(key) {
  return { breakfast: "Frühstück", lunch: "Mittag", dinner: "Abend", snack: "Snack" }[key] || "Mahlzeit";
}

function round1(v) {
  return v == null ? null : Math.round(v * 10) / 10;
}

/**
 * Zeitgerechter Mahlzeiten-Vorschlag, nur als Startwert — jederzeit umstellbar.
 * Die einzige Stelle, die das berechnet (Eintragen-Sheet, Scan-Ergebnis und beide
 * Mengendialoge riefen früher zwei verschiedene Funktionen mit unterschiedlichen Grenzen auf —
 * dadurch stand nachmittags praktisch überall "Snack", obwohl niemand Snack gewählt hatte).
 * Snack ist die Ausnahme (spätnachts/früh), nicht ein eigenes Zeitfenster am Nachmittag.
 */
export function suggestMeal() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21.5) return "dinner";
  return "snack";
}

// ---------------------------------------------------------------------------
// Aktiver Planungstag (Startseite: "◀ Heute ▶"). Bewusst nicht persistiert — beim
// nächsten App-Start steht die Navigation wieder auf "heute".
// ---------------------------------------------------------------------------

let activeDateKey = null;

export function getActiveDateKey() {
  return activeDateKey || dateKeyOf(Date.now());
}
export function isViewingToday() {
  return getActiveDateKey() === dateKeyOf(Date.now());
}
export function setActiveDateKey(key) {
  activeDateKey = key;
}
export function resetActiveDateToToday() {
  activeDateKey = null;
}
/** Verschiebt den aktiven Tag um `deltaDays` (negativ = zurück) und liefert den neuen Schlüssel. */
export function shiftActiveDate(deltaDays) {
  const [y, m, d] = getActiveDateKey().split("-").map(Number);
  activeDateKey = dateKeyOf(new Date(y, m - 1, d + deltaDays).getTime());
  return activeDateKey;
}

/** Menschenlesbares Label für einen dateKey: "Heute" / "Morgen" / "Gestern" / Datum. */
export function dateLabel(dateKey) {
  const today = dateKeyOf(Date.now());
  if (dateKey === today) return "Heute";
  const [y, m, d] = dateKey.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const diffDays = Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
  if (diffDays === 1) return "Morgen";
  if (diffDays === -1) return "Gestern";
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}

/** Trägt eine gegessene Menge (in Gramm) für das aktive Profil am aktiven Planungstag ein. */
export function logConsumption(product, grams, meal = null) {
  const g = Number(grams);
  if (!g || g <= 0) return null;
  const scale = g / 100;
  const per100 = product.per100;
  const netCarbs100 = calcNetCarbs(per100, { subtractFiber: product.likelyUsLabel });
  const profile = Store.getActiveProfile();

  const entry = {
    id: crypto.randomUUID(),
    profileId: profile.id,
    barcode: product.barcode,
    name: product.name,
    grams: g,
    servingG: parseServingGrams(product.servingSize), // für spätere Portionen⇄Gramm-Umrechnung
    meal,
    dateKey: getActiveDateKey(),
    kcal: round1(per100.kcal != null ? per100.kcal * scale : null),
    netCarbs: round1(netCarbs100 != null ? netCarbs100 * scale : null),
    fat: round1(per100.fat != null ? per100.fat * scale : null),
    protein: round1(per100.protein != null ? per100.protein * scale : null),
    at: Date.now(),
  };
  Store.addConsumption(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Wasser — bewusst getrennt vom Makro-Verbrauch: kein historisches Einfrieren
// (das Trinkziel ändert sich kaum und ist keine strenge Nährwert-Buchhaltung).
// ---------------------------------------------------------------------------

/** Trägt eine getrunkene Menge (ml) fürs aktive Profil am aktiven Planungstag ein. */
export function logWater(ml) {
  const amount = Number(ml);
  if (!amount || amount <= 0) return null;
  const profile = Store.getActiveProfile();
  const entry = {
    id: crypto.randomUUID(),
    profileId: profile.id,
    dateKey: getActiveDateKey(),
    ml: amount,
    at: Date.now(),
  };
  Store.addWater(entry);
  return entry;
}

export function getWaterForDate(profileId, dateKey) {
  return Store.getWater().filter(e => e.profileId === profileId && e.dateKey === dateKey);
}

export function sumWater(entries) {
  return entries.reduce((sum, e) => sum + (e.ml || 0), 0);
}

/** Entfernt den zuletzt eingetragenen Wasser-Eintrag des Tages (einfaches Undo statt eigener Liste). */
export function undoLastWater(profileId, dateKey) {
  const entries = getWaterForDate(profileId, dateKey);
  if (entries.length === 0) return false;
  Store.removeWater(entries[0].id); // neueste zuerst (Store.addWater fügt vorne ein)
  return true;
}

/**
 * Rangfolge für die Schnellauswahl im Eintragen-Sheet (Design "Klar").
 *
 * score = freq30 × timeslotWeight, wobei freq30 = Anzahl Einträge dieses Produkts/Rezepts in
 * den letzten 30 Tagen und timeslotWeight = Anteil davon, der auf die gerade gewählte Mahlzeit
 * fiel. Die Untergrenze von 0.15 sorgt dafür, dass etwas, das man sonst nie zu dieser Tageszeit
 * isst, nicht komplett verschwindet — es rutscht nur nach hinten.
 *
 * `amount` ist jeweils die zuletzt benutzte Menge (Gramm bzw. Portionen), damit ein Chip-Tipp
 * ohne Rückfrage eintragen kann.
 */
export function rankFrequentItems(profileId, meal, { maxFrequent = 6, maxRecent = 4 } = {}) {
  const cutoff = Date.now() - 30 * 86400000;
  const entries = Store.getConsumption().filter(e => e.profileId === profileId && e.at >= cutoff);

  const byItem = new Map();
  for (const e of entries) {
    // Barcode als Schlüssel: Rezepte tragen "recipe:<id>", Produkte ihren echten Barcode.
    const key = e.barcode;
    if (!key) continue;
    const cur = byItem.get(key) || { key, name: e.name, count: 0, mealCount: 0, lastAt: 0, amount: null, isRecipe: key.startsWith("recipe:") };
    cur.count++;
    if (e.meal === meal) cur.mealCount++;
    if (e.at > cur.lastAt) {
      cur.lastAt = e.at;
      cur.name = e.name;
      cur.amount = e.servings != null ? e.servings : e.grams;
    }
    byItem.set(key, cur);
  }

  const items = [...byItem.values()]
    .filter(i => i.amount != null && i.amount > 0)
    .map(i => ({
      ...i,
      recipeId: i.isRecipe ? i.key.slice("recipe:".length) : null,
      barcode: i.isRecipe ? null : i.key,
      score: i.count * Math.max(0.15, i.mealCount / i.count),
    }));

  const frequent = [...items].sort((a, b) => b.score - a.score).slice(0, maxFrequent);
  const shown = new Set(frequent.map(i => i.key));
  const recent = [...items]
    .filter(i => !shown.has(i.key))
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, maxRecent);

  return { frequent, recent };
}

/** Alle Verbrauchs-Einträge eines Profils an einem bestimmten Tag (dateKey "YYYY-MM-DD"). */
export function getConsumptionForDate(profileId, dateKey) {
  return Store.getConsumption().filter(e => e.profileId === profileId && e.dateKey === dateKey);
}

/** Summiert eine Liste von Verbrauchs-Einträgen zu Gesamtwerten. */
export function sumConsumption(entries) {
  return entries.reduce((acc, e) => ({
    kcal: acc.kcal + (e.kcal || 0),
    netCarbs: acc.netCarbs + (e.netCarbs || 0),
    fat: acc.fat + (e.fat || 0),
    protein: acc.protein + (e.protein || 0),
  }), { kcal: 0, netCarbs: 0, fat: 0, protein: 0 });
}

/**
 * Passt einen bestehenden Verbrauchs-Eintrag auf eine neue Menge an (Gramm bei Produkten,
 * Portionen bei Rezepten). Skaliert alle Nährwerte proportional, ohne die ursprüngliche
 * Quelle (Produkt/Rezept) erneut nachschlagen zu müssen.
 */
export function rescaleConsumption(id, newAmount) {
  const entry = Store.getConsumption().find(e => e.id === id);
  if (!entry) return null;
  const oldAmount = entry.servings != null ? entry.servings : entry.grams;
  if (!oldAmount || oldAmount <= 0) return null;
  const ratio = newAmount / oldAmount;

  const updated = {
    ...entry,
    kcal: round1(entry.kcal != null ? entry.kcal * ratio : null),
    netCarbs: round1(entry.netCarbs != null ? entry.netCarbs * ratio : null),
    fat: round1(entry.fat != null ? entry.fat * ratio : null),
    protein: round1(entry.protein != null ? entry.protein * ratio : null),
  };
  if (entry.servings != null) updated.servings = newAmount; else updated.grams = newAmount;

  Store.updateConsumption(updated);
  return updated;
}

export function setConsumptionMeal(id, meal) {
  const entry = Store.getConsumption().find(e => e.id === id);
  if (!entry) return null;
  const updated = { ...entry, meal };
  Store.updateConsumption(updated);
  return updated;
}

/** Verknüpft ein Portionen- und ein Gramm-Feld: Eingabe in einem rechnet das andere live um. */
export function wireCoupledAmountFields(portionsInput, gramsInput, servingG) {
  if (!portionsInput || !servingG) return;
  let syncing = false;
  portionsInput.addEventListener("input", () => {
    if (syncing) return;
    const p = parseFloat(portionsInput.value);
    if (!p || p <= 0) return;
    syncing = true;
    gramsInput.value = round1(p * servingG);
    gramsInput.dispatchEvent(new Event("input", { bubbles: true }));
    syncing = false;
  });
  gramsInput.addEventListener("input", () => {
    if (syncing) return;
    const g = parseFloat(gramsInput.value);
    if (!g || g <= 0) return;
    syncing = true;
    portionsInput.value = round1(g / servingG);
    syncing = false;
  });
}

export function mealChipsHtml(selected) {
  return `
    <label>Mahlzeit</label>
    <div class="btn-row" style="flex-wrap:wrap;gap:6px" id="mealChips">
      ${Object.entries(MEAL_LABELS).map(([key, label]) => `
        <button type="button" class="btn ${key === selected ? "" : "secondary"} meal-chip" data-meal="${key}" style="width:auto;flex:none;padding:0 12px">${label}</button>
      `).join("")}
    </div>
  `;
}

export function wireMealChips(overlay, onSelect) {
  overlay.querySelectorAll(".meal-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      overlay.querySelectorAll(".meal-chip").forEach(c => c.classList.add("secondary"));
      chip.classList.remove("secondary");
      onSelect(chip.dataset.meal);
    });
  });
}

/**
 * Öffnet einen Dialog zur Mengeneingabe für ein Produkt und trägt die gewählte Menge
 * als "gegessen" ein. `onLogged` wird nach erfolgreichem Eintrag aufgerufen (z.B. für Refresh).
 */
export function openQuantityModal(product, onLogged) {
  const servingG = parseServingGrams(product.servingSize);
  let selectedMeal = suggestMeal();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">${esc(product.name)}</h2>
      <p class="hint">Gegessene Menge eintragen — wird von eurem Tagesziel abgezogen.</p>
      ${servingG ? `
        <div class="btn-row" style="flex-wrap:wrap;gap:8px;margin:10px 0">
          ${[1, 2, 3, 4].map(n => `<button type="button" class="btn secondary qty-chip" data-portions="${n}" style="width:auto;flex:none;padding:0 14px">${n}× (${round1(servingG * n)} g)</button>`).join("")}
        </div>
        <label for="qtyPortionsInput">Portionen</label>
        <input type="number" id="qtyPortionsInput" value="1" min="0.25" step="0.25" inputmode="decimal">
      ` : ""}
      <label for="qtyGramsInput">Menge in Gramm</label>
      <input type="number" id="qtyGramsInput" value="${servingG || 100}" min="1" inputmode="numeric">
      ${mealChipsHtml(selectedMeal)}
      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn secondary" id="qtyCancel">Abbrechen</button>
        <button type="button" class="btn" id="qtyConfirm">Eintragen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const portionsInput = overlay.querySelector("#qtyPortionsInput");
  const gramsInput = overlay.querySelector("#qtyGramsInput");
  if (servingG) wireCoupledAmountFields(portionsInput, gramsInput, servingG);
  wireMealChips(overlay, (meal) => { selectedMeal = meal; });

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#qtyCancel").addEventListener("click", close);
  overlay.querySelectorAll(".qty-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      if (portionsInput) {
        portionsInput.value = chip.dataset.portions;
        portionsInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  });
  overlay.querySelector("#qtyConfirm").addEventListener("click", () => {
    const grams = parseFloat(gramsInput.value);
    if (!grams || grams <= 0) {
      showToast("Bitte eine gültige Menge angeben");
      return;
    }
    logConsumption(product, grams, selectedMeal);
    showToast(`${grams} g eingetragen`);
    close();
    onLogged?.();
  });

  keepActionsInView(overlay);
  (portionsInput || gramsInput).focus();
}

/** Öffnet einen Dialog zum Bearbeiten (Menge/Mahlzeit anpassen, live Vorschau) oder Löschen. */
export function openEditConsumptionModal(entry, onDone) {
  const isRecipe = entry.servings != null;
  const currentAmount = isRecipe ? entry.servings : entry.grams;
  // servingG ist bei Produkten das Packungsgewicht einer Portion, bei Rezepten das beim
  // Eintragen festgehaltene Gewicht einer Portion. In beiden Fällen der Umrechnungsfaktor
  // zwischen Portionen und Gramm — deshalb hier für beide dasselbe Feldpaar.
  const servingG = entry.servingG || null;
  let selectedMeal = entry.meal;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">${esc(entry.name)}</h2>
      <p class="hint">Menge anpassen — Nährwerte werden automatisch neu berechnet.</p>
      ${servingG ? `
        <div class="btn-row" style="flex-wrap:wrap;gap:8px;margin:10px 0">
          ${[1, 2, 3].map(n => `<button type="button" class="btn secondary qty-chip" data-portions="${n}" style="width:auto;flex:none;padding:0 14px">${n}× (${Math.round(servingG * n)} g)</button>`).join("")}
        </div>
      ` : ""}
      ${isRecipe ? `
        <label for="editAmountInput">Portionen</label>
        <input type="number" id="editAmountInput" value="${currentAmount}" min="0.1" step="0.25" inputmode="decimal">
        ${servingG ? `
          <label for="editGramsInput">Menge in Gramm</label>
          <input type="number" id="editGramsInput" value="${Math.round(currentAmount * servingG)}" min="1" inputmode="numeric">
        ` : ""}
      ` : servingG ? `
        <label for="editPortionsInput">Portionen</label>
        <input type="number" id="editPortionsInput" value="${round1(currentAmount / servingG)}" min="0.1" step="0.25" inputmode="decimal">
        <label for="editAmountInput">Menge in Gramm</label>
        <input type="number" id="editAmountInput" value="${currentAmount}" min="0.1" step="1" inputmode="decimal">
      ` : `
        <label for="editAmountInput">Menge in Gramm</label>
        <input type="number" id="editAmountInput" value="${currentAmount}" min="0.1" step="1" inputmode="decimal">
      `}
      <p class="hint" id="editPreview" style="margin-top:8px"></p>
      ${mealChipsHtml(selectedMeal)}
      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn secondary" id="editDelete">🗑️ Löschen</button>
        <button type="button" class="btn" id="editSave">Speichern</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // input trägt immer die maßgebliche Einheit des Eintrags (Portionen bei Rezepten, Gramm bei
  // Produkten) — rescaleConsumption rechnet damit. Das zweite Feld ist die gekoppelte Anzeige.
  const input = overlay.querySelector("#editAmountInput");
  const portionsInput = overlay.querySelector("#editPortionsInput");
  const gramsInput = overlay.querySelector("#editGramsInput");
  if (servingG) {
    if (isRecipe) wireCoupledAmountFields(input, gramsInput, servingG);
    else wireCoupledAmountFields(portionsInput, input, servingG);
  }
  wireMealChips(overlay, (meal) => { selectedMeal = meal; });

  const preview = overlay.querySelector("#editPreview");
  const updatePreview = () => {
    const val = parseFloat(input.value);
    if (!val || val <= 0) { preview.textContent = ""; return; }
    const ratio = val / currentAmount;
    const k = entry.kcal != null ? round1(entry.kcal * ratio) : "–";
    const nc = entry.netCarbs != null ? round1(entry.netCarbs * ratio) : "–";
    const gramsPart = servingG && isRecipe ? `${Math.round(val * servingG)} g · ` : "";
    preview.textContent = `→ ${gramsPart}${k} kcal · ${nc} g Netto-KH`;
  };
  input.addEventListener("input", updatePreview);
  gramsInput?.addEventListener("input", updatePreview);
  updatePreview();

  overlay.querySelectorAll(".qty-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const n = Number(chip.dataset.portions);
      // Bei Produkten ist die Portionsanzahl das Nebenfeld, bei Rezepten das Hauptfeld.
      const target = isRecipe ? input : portionsInput;
      if (!target) return;
      target.value = n;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      updatePreview();
    });
  });

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#editDelete").addEventListener("click", () => {
    Store.removeConsumption(entry.id);
    showToast("Eintrag entfernt");
    close();
    onDone?.();
  });
  overlay.querySelector("#editSave").addEventListener("click", () => {
    const val = parseFloat(input.value);
    if (!val || val <= 0) {
      showToast("Bitte eine gültige Menge angeben");
      return;
    }
    rescaleConsumption(entry.id, val);
    setConsumptionMeal(entry.id, selectedMeal);
    showToast("Aktualisiert");
    close();
    onDone?.();
  });

  keepActionsInView(overlay);
  input.focus();
}
