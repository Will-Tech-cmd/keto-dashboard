// consumption.js — Menge "gegessen" eintragen und mit dem Tagesziel verrechnen.
// Trägt außerdem die aktuell auf der Startseite angezeigte Datumsnavigation (für die
// Essensplanung), damit Einträge aus Scan/Listen/Rezepten immer auf dem gewählten Tag landen.
import { Store, dateKeyOf } from "./store.js";
import { calcNetCarbs, parseServingGrams } from "./keto.js";
import { getTargetsForDate } from "./profiles.js";
import { esc, showToast, bindBackClose } from "./ui.js";

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
  // Dieselbe Regel wie auf der Scan-Ergebniskarte: manuelle Übersteuerung (US-Etikett-Schalter)
  // hat Vorrang, sonst die automatische Erkennung — sonst könnten die eingetragenen Netto-KH
  // von dem abweichen, was gerade eben noch auf der Karte stand.
  const fiberOverride = Store.getFiberOverride(product.barcode);
  const subtractFiber = fiberOverride !== undefined ? fiberOverride : product.likelyUsLabel;
  const netCarbs100 = calcNetCarbs(per100, { subtractFiber });
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

/**
 * "Von 30 g heute: 21.4 g gegessen, 4.1 g bleiben danach frei" — dieselbe Frage, die man beim
 * Eintragen ohnehin im Kopf hat, deshalb direkt im Dialog statt erst danach auf Start.
 * `excludeId` lässt den gerade bearbeiteten Eintrag selbst aus der Summe raus (Bearbeiten-Dialog),
 * sonst würde er sich doppelt einrechnen.
 */
export function budgetLineText(addNetCarbs, { excludeId = null } = {}) {
  const profile = Store.getActiveProfile();
  const dateKey = getActiveDateKey();
  const targets = getTargetsForDate(profile, dateKey);
  const already = getConsumptionForDate(profile.id, dateKey)
    .filter(e => e.id !== excludeId)
    .reduce((sum, e) => sum + (e.netCarbs || 0), 0);
  const afterTotal = already + (addNetCarbs || 0);
  const remaining = round1(targets.netCarbG - afterTotal);
  const nach = remaining < 0
    ? `${Math.abs(remaining)} g darüber`
    : `${remaining} g bleiben danach frei`;
  return `Von ${targets.netCarbG} g heute: ${round1(already)} g gegessen, ${nach}`;
}

/**
 * Ein Mengen-Bedienelement statt zwei Zahlenfelder, die sich gegenseitig umrechnen — das
 * versteht man erst, wenn man tippt. Ist eine Portionsgröße bekannt, ist die Portion das
 * große, primäre Feld (± verändert sie in Vierteln), Gramm steht klein als Zeile darunter und
 * lässt sich über den „g …"-Schnellwert für die freie Eingabe aufklappen. Ohne bekannte
 * Portionsgröße steuert der Stepper Gramm direkt, in 10er-Schritten.
 */
export function qtyStepperHtml(servingG, grams) {
  if (servingG) {
    const portions = round1(grams / servingG);
    return `
      <div class="klar-qty-stepper">
        <button type="button" class="klar-stepper-btn" id="qtyMinus" aria-label="weniger">−</button>
        <div class="klar-qty-display">
          <input type="number" id="qtyPortionsInput" class="klar-qty-primary" value="${portions}" min="0.25" step="0.25" inputmode="decimal">
          <span class="klar-qty-primary-unit">${portions === 1 ? "Portion" : "Portionen"}</span>
          <span class="klar-qty-secondary" id="qtyGramsDisplay">${grams} g</span>
        </div>
        <button type="button" class="klar-stepper-btn" id="qtyPlus" aria-label="mehr">+</button>
      </div>
      <div class="klar-chip-row" style="margin-top:12px">
        ${[0.5, 1, 2, 3].map(n => `<button type="button" class="klar-chip qty-chip ${n === portions ? "top" : ""}" data-portions="${n}">${n === 0.5 ? "½" : n}</button>`).join("")}
        <button type="button" class="klar-chip" id="qtyGramsChip">g …</button>
      </div>
      <div id="qtyGramsWrap" style="display:none;margin-top:10px">
        <label for="qtyGramsInput">Menge in Gramm</label>
        <input type="number" id="qtyGramsInput" value="${grams}" min="1" inputmode="numeric">
      </div>
    `;
  }
  return `
    <div class="klar-qty-stepper">
      <button type="button" class="klar-stepper-btn" id="qtyMinus" aria-label="weniger">−</button>
      <div class="klar-qty-display">
        <input type="number" id="qtyGramsInput" class="klar-qty-primary" value="${grams}" min="1" inputmode="numeric">
        <span class="klar-qty-primary-unit">Gramm</span>
      </div>
      <button type="button" class="klar-stepper-btn" id="qtyPlus" aria-label="mehr">+</button>
    </div>
  `;
}

/** Verdrahtet qtyStepperHtml(): hält Portion/Gramm synchron und ruft `onChange(grams)` bei
 * jeder Änderung. Gibt eine getGrams()-Abfrage zurück für den Bestätigen-Knopf. */
export function wireQtyStepper(overlay, servingG, initialGrams, onChange) {
  let grams = initialGrams;
  const portionsInput = overlay.querySelector("#qtyPortionsInput");
  const gramsInput = overlay.querySelector("#qtyGramsInput");
  const gramsDisplay = overlay.querySelector("#qtyGramsDisplay");
  const step = servingG ? servingG / 4 : 10;

  const setGrams = (g, { fromPortions = false, fromGrams = false } = {}) => {
    grams = Math.max(0, round1(g));
    if (servingG) {
      if (!fromPortions) portionsInput.value = round1(grams / servingG);
      if (gramsDisplay) gramsDisplay.textContent = `${grams} g`;
      if (!fromGrams) gramsInput.value = grams;
      overlay.querySelectorAll(".qty-chip[data-portions]").forEach(c => {
        c.classList.toggle("top", parseFloat(c.dataset.portions) === round1(grams / servingG));
      });
    } else if (!fromGrams) {
      gramsInput.value = grams;
    }
    onChange(grams);
  };

  overlay.querySelector("#qtyMinus").addEventListener("click", () => setGrams(grams - step));
  overlay.querySelector("#qtyPlus").addEventListener("click", () => setGrams(grams + step));

  if (servingG) {
    portionsInput.addEventListener("input", () => {
      const p = parseFloat(portionsInput.value);
      if (!p || p <= 0) return;
      setGrams(p * servingG, { fromPortions: true });
    });
    overlay.querySelectorAll(".qty-chip[data-portions]").forEach(chip => {
      chip.addEventListener("click", () => setGrams(parseFloat(chip.dataset.portions) * servingG));
    });
    overlay.querySelector("#qtyGramsChip")?.addEventListener("click", () => {
      const wrap = overlay.querySelector("#qtyGramsWrap");
      wrap.style.display = "block";
      overlay.querySelector("#qtyGramsInput").focus();
    });
  }
  gramsInput.addEventListener("input", () => {
    const g = parseFloat(gramsInput.value);
    if (!g || g < 0) return;
    setGrams(g, { fromGrams: true });
  });

  return { getGrams: () => grams };
}

/**
 * Öffnet einen Dialog zur Mengeneingabe für ein Produkt und trägt die gewählte Menge
 * als "gegessen" ein. `onLogged` wird nach erfolgreichem Eintrag aufgerufen (z.B. für Refresh).
 */
export function openQuantityModal(product, onLogged) {
  const servingG = parseServingGrams(product.servingSize);
  let selectedMeal = suggestMeal();
  let currentGrams = servingG || 100;

  const fiberOverride = Store.getFiberOverride(product.barcode);
  const subtractFiber = fiberOverride !== undefined ? fiberOverride : product.likelyUsLabel;
  const netCarbs100 = calcNetCarbs(product.per100, { subtractFiber });

  const overlay = document.createElement("div");
  overlay.className = "klar-sheet-overlay";
  overlay.innerHTML = `
    <div class="klar-sheet">
      <div class="klar-sheet-handle"></div>
      <div class="klar-sheet-title">${esc(product.name)}</div>
      <div class="klar-sheet-sub">${esc(product.brand || "")}${product.brand ? " · " : ""}${isViewingToday() ? "Eintrag für Heute" : `Eintrag für ${esc(dateLabel(getActiveDateKey()))}`}</div>

      ${qtyStepperHtml(servingG, currentGrams)}

      <div class="klar-portion-panel gray" id="qtyPreview" style="margin-top:16px"></div>

      <div class="klar-meal-select-head" style="margin-top:18px">
        <span class="klar-eyebrow">Mahlzeit</span>
        <span class="klar-water-value">${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr · vorgeschlagen</span>
      </div>
      <div class="klar-meal-segments">
        ${Object.keys(MEAL_LABELS).map(key => `
          <button type="button" class="klar-meal-segment ${key === selectedMeal ? "active" : ""}" data-meal="${key}">${esc(mealShort(key))}</button>
        `).join("")}
      </div>

      <div class="btn-row" style="margin-top:18px">
        <button type="button" class="btn secondary" id="qtyCancel">Abbrechen</button>
        <button type="button" class="btn" id="qtyConfirm">Eintragen · ${esc(mealShort(selectedMeal))}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const confirmBtn = overlay.querySelector("#qtyConfirm");
  overlay.querySelectorAll(".klar-meal-segment").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedMeal = btn.dataset.meal;
      overlay.querySelectorAll(".klar-meal-segment").forEach(b => b.classList.toggle("active", b === btn));
      confirmBtn.textContent = `Eintragen · ${mealShort(selectedMeal)}`;
    });
  });

  const preview = overlay.querySelector("#qtyPreview");
  const updatePreview = (grams) => {
    currentGrams = grams;
    if (!grams || grams <= 0) { preview.innerHTML = ""; return; }
    const kcal = product.per100.kcal != null ? round1(product.per100.kcal * grams / 100) : null;
    const netCarbs = netCarbs100 != null ? round1(netCarbs100 * grams / 100) : null;
    preview.innerHTML = `
      <div class="klar-portion-head">Das trägt ein</div>
      <div class="klar-portion-value">${netCarbs ?? "–"} g<span>Netto-KH${kcal != null ? ` · ${kcal} kcal` : ""}</span></div>
      <div class="klar-portion-sub">${budgetLineText(netCarbs)}</div>
    `;
  };
  wireQtyStepper(overlay, servingG, currentGrams, updatePreview);
  updatePreview(currentGrams);

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#qtyCancel").addEventListener("click", close);
  confirmBtn.addEventListener("click", () => {
    if (!currentGrams || currentGrams <= 0) {
      showToast("Bitte eine gültige Menge angeben");
      return;
    }
    logConsumption(product, currentGrams, selectedMeal);
    showToast(`${currentGrams} g eingetragen`);
    close();
    onLogged?.();
  });
}

/** Öffnet einen Dialog zum Bearbeiten (Menge/Mahlzeit anpassen, live Vorschau) oder Löschen. */
export function openEditConsumptionModal(entry, onDone) {
  const isRecipe = entry.servings != null;
  const currentAmount = isRecipe ? entry.servings : entry.grams;
  // servingG ist bei Produkten das Packungsgewicht einer Portion, bei Rezepten das beim
  // Eintragen festgehaltene Gewicht einer Portion — in beiden Fällen der Umrechnungsfaktor
  // zwischen Portionen und Gramm. rescaleConsumption() erwartet aber immer die maßgebliche
  // Einheit des Eintrags: Portionen bei Rezepten, Gramm bei Produkten — toVal() rechnet dahin
  // zurück, unabhängig davon, worauf der Stepper visuell gerade steht (immer Gramm).
  const servingG = entry.servingG || null;
  let selectedMeal = entry.meal;
  const toVal = (grams) => isRecipe ? (servingG ? grams / servingG : grams) : grams;

  // Für Rezepte ohne servingG (nur sehr alte Einträge ohne Gewichts-Schnappschuss) gibt es
  // keine Gramm-Basis — der Stepper wirkt dann direkt auf Portionen in Vierteln.
  const gramsBase = isRecipe ? (servingG ? currentAmount * servingG : null) : currentAmount;
  let currentGrams = gramsBase ?? currentAmount;

  const overlay = document.createElement("div");
  overlay.className = "klar-sheet-overlay";
  overlay.innerHTML = `
    <div class="klar-sheet">
      <div class="klar-sheet-handle"></div>
      <div class="klar-sheet-title">${esc(entry.name)}</div>
      <div class="klar-sheet-sub">Menge anpassen — Nährwerte werden automatisch neu berechnet.</div>

      ${gramsBase != null ? qtyStepperHtml(servingG, currentGrams) : `
        <div class="klar-qty-stepper">
          <button type="button" class="klar-stepper-btn" id="qtyMinus" aria-label="weniger">−</button>
          <div class="klar-qty-display">
            <input type="number" id="qtyGramsInput" class="klar-qty-primary" value="${currentAmount}" min="0.1" step="0.25" inputmode="decimal">
            <span class="klar-qty-primary-unit">${currentAmount === 1 ? "Portion" : "Portionen"}</span>
          </div>
          <button type="button" class="klar-stepper-btn" id="qtyPlus" aria-label="mehr">+</button>
        </div>
      `}

      <div class="klar-portion-panel gray" id="editPreview" style="margin-top:16px"></div>

      <div class="klar-meal-select-head" style="margin-top:18px">
        <span class="klar-eyebrow">Mahlzeit</span>
      </div>
      <div class="klar-meal-segments">
        ${Object.keys(MEAL_LABELS).map(key => `
          <button type="button" class="klar-meal-segment ${key === selectedMeal ? "active" : ""}" data-meal="${key}">${esc(mealShort(key))}</button>
        `).join("")}
      </div>

      <div class="btn-row" style="margin-top:18px">
        <button type="button" class="btn secondary" id="editDelete" style="color:var(--warm)">🗑️ Löschen</button>
        <button type="button" class="btn" id="editSave">Speichern</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelectorAll(".klar-meal-segment").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedMeal = btn.dataset.meal;
      overlay.querySelectorAll(".klar-meal-segment").forEach(b => b.classList.toggle("active", b === btn));
    });
  });

  const preview = overlay.querySelector("#editPreview");
  const updatePreview = (grams) => {
    currentGrams = grams;
    const val = toVal(grams);
    if (!val || val <= 0) { preview.innerHTML = ""; return; }
    const ratio = val / currentAmount;
    const k = entry.kcal != null ? round1(entry.kcal * ratio) : null;
    const nc = entry.netCarbs != null ? round1(entry.netCarbs * ratio) : null;
    preview.innerHTML = `
      <div class="klar-portion-head">Das trägt ein</div>
      <div class="klar-portion-value">${nc ?? "–"} g<span>Netto-KH${k != null ? ` · ${k} kcal` : ""}</span></div>
      <div class="klar-portion-sub">${budgetLineText(nc, { excludeId: entry.id })}</div>
    `;
  };

  let getGrams;
  if (gramsBase != null) {
    ({ getGrams } = wireQtyStepper(overlay, servingG, currentGrams, updatePreview));
  } else {
    const input = overlay.querySelector("#qtyGramsInput");
    const setVal = (v) => { input.value = Math.max(0.1, round1(v)); updatePreview(parseFloat(input.value)); };
    overlay.querySelector("#qtyMinus").addEventListener("click", () => setVal(parseFloat(input.value) - 0.25));
    overlay.querySelector("#qtyPlus").addEventListener("click", () => setVal(parseFloat(input.value) + 0.25));
    input.addEventListener("input", () => updatePreview(parseFloat(input.value)));
    getGrams = () => parseFloat(input.value);
  }
  updatePreview(currentGrams);

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#editDelete").addEventListener("click", () => {
    Store.removeConsumption(entry.id);
    showToast("Eintrag entfernt");
    close();
    onDone?.();
  });
  overlay.querySelector("#editSave").addEventListener("click", () => {
    const val = toVal(getGrams());
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
}
