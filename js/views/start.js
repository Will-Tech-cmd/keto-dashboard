// views/start.js — Startseite: Datumsnavigation, Ziel-/Verbrauchsringe, Mahlzeiten,
// zuletzt gescannte Produkte.
import { Store, dateKeyOf } from "../store.js";
import { getTargetsForDate } from "../profiles.js";
import { lookupProduct } from "../off.js";
import { evaluateProduct } from "../keto.js";
import {
  getConsumptionForDate, sumConsumption, openQuantityModal, openEditConsumptionModal,
  getActiveDateKey, resetActiveDateToToday, shiftActiveDate, setActiveDateKey,
  isViewingToday, dateLabel, MEAL_LABELS,
  logWater, getWaterForDate, sumWater, undoLastWater,
} from "../consumption.js";
import { esc, showToast, showSnackbar, shareOrDownloadFile } from "../ui.js";

const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"];

// dom-to-image-more rastert einen DOM-Knoten unabhängig vom sichtbaren Ausschnitt in ein Bild —
// das umgeht die unzuverlässige "langer Screenshot"-Funktion von Android/iOS bei installierten
// PWAs, die bei uns immer nur den gerade sichtbaren Bereich erfasst. Lokal vendort (wie
// Tesseract.js), damit es auch offline funktioniert. Die Datei ist ein klassisches UMD-Skript
// (kein ESM-Export) und hängt sich beim Laden als <script> an window.domtoimage — ein
// dynamisches import() würde scheitern, weil "this" im Modul-Kontext undefined ist.
let domToImagePromise = null;
function loadDomToImage() {
  if (window.domtoimage) return Promise.resolve(window.domtoimage);
  if (!domToImagePromise) {
    domToImagePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("../../vendor/dom-to-image-more/dom-to-image-more.min.js", import.meta.url).href;
      script.onload = () => resolve(window.domtoimage);
      script.onerror = () => reject(new Error("dom-to-image-more konnte nicht geladen werden"));
      document.head.appendChild(script);
    });
  }
  return domToImagePromise;
}

let savingImage = false;
async function saveDashboardAsImage(container) {
  if (savingImage) return;
  savingImage = true;
  showToast("Bild wird erstellt …");
  try {
    const domtoimage = await loadDomToImage();
    const bg = getComputedStyle(document.body).backgroundColor;
    const blob = await domtoimage.toBlob(container, {
      bgcolor: bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#0f172a",
      width: container.scrollWidth,
      height: container.scrollHeight,
      filter: (node) => node.id !== "saveImageBtn",
    });
    const filename = `keto-dashboard-${new Date().toISOString().slice(0, 10)}.png`;
    const file = new File([blob], filename, { type: "image/png" });
    const result = await shareOrDownloadFile(file, { title: "Keto-Dashboard" });
    if (result !== "cancelled") showToast(result === "shared" ? "Geteilt" : "Bild gespeichert");
  } catch (e) {
    console.error(e);
    showToast("Bild konnte nicht erstellt werden");
  } finally {
    savingImage = false;
  }
}

export async function renderStart(container, goToTab) {
  const profile = Store.getActiveProfile();
  if (profile.design === "klar") return renderStartKlar(container, goToTab, profile);
  return renderStartKlassisch(container, goToTab, profile);
}

async function renderStartKlassisch(container, goToTab, profile) {
  const dateKey = getActiveDateKey();
  // Zielwerte des angezeigten Tages: heute/Zukunft live, vergangene Tage eingefroren.
  const targets = getTargetsForDate(profile, dateKey);
  const refresh = () => renderStart(container, goToTab);

  container.innerHTML = `
    <h1 class="section-title">Hallo, ${esc(profile.name)} 👋</h1>

    <div class="date-nav">
      <button type="button" id="datePrev" aria-label="Vorheriger Tag">◀</button>
      <span class="date-label ${isViewingToday() ? "" : "today-link"}" id="dateLabelBtn">${esc(dateLabel(dateKey))}</span>
      <button type="button" id="dateNext" aria-label="Nächster Tag">▶</button>
    </div>

    <div class="card">
      <div class="ring-grid" id="ringGrid"></div>
      <div id="waterSection" class="water-section"></div>
    </div>

    <div id="consumptionList" style="margin-top:14px"></div>

    <button class="btn" id="startScanBtn" style="margin-top:20px">📷 Produkt scannen</button>

    <h2 class="section-title" style="margin-top:24px">Zuletzt gescannt</h2>
    <p class="hint" style="margin-top:-8px">Zum Eintragen einer Menge auf ein Produkt tippen.</p>
    <div id="recentList"><p class="muted">Lädt …</p></div>

    <button class="btn ghost" id="saveImageBtn" style="margin-top:20px">📸 Dashboard als Bild sichern</button>
  `;

  container.querySelector("#startScanBtn").addEventListener("click", () => goToTab("scan"));
  container.querySelector("#saveImageBtn").addEventListener("click", () => saveDashboardAsImage(container));
  container.querySelector("#datePrev").addEventListener("click", () => { shiftActiveDate(-1); refresh(); });
  container.querySelector("#dateNext").addEventListener("click", () => { shiftActiveDate(1); refresh(); });
  container.querySelector("#dateLabelBtn").addEventListener("click", () => {
    if (!isViewingToday()) { resetActiveDateToToday(); refresh(); }
  });

  const entries = renderRings(container, profile, targets, dateKey);
  renderWaterSection(container, profile, dateKey, refresh);
  renderConsumptionList(container, entries, refresh);
  renderRecent(container, targets, refresh);
}

const WATER_STEPS = [200, 330, 500];

function renderWaterSection(container, profile, dateKey, refresh) {
  const el = container.querySelector("#waterSection");
  const consumedMl = sumWater(getWaterForDate(profile.id, dateKey));
  const target = profile.waterTargetMl || 2500;
  const pct = target > 0 ? Math.min((consumedMl / target) * 100, 100) : 0;

  el.innerHTML = `
    <div class="btn-row" style="align-items:center;gap:8px;margin-bottom:8px">
      <h2 class="water-label" style="margin:0">💧 Wasser</h2>
      ${consumedMl > 0 ? `<button type="button" class="icon-btn water-undo" title="Rückgängig" style="margin:0">↩️</button>` : ""}
      <span class="hint" style="margin:0 0 0 auto">${consumedMl} / ${target} ml</span>
    </div>
    <div class="progress-track" style="height:10px">
      <div class="progress-fill water" style="width:${pct}%"></div>
    </div>
    <div class="btn-row" style="margin-top:12px;flex-wrap:wrap;gap:8px">
      ${WATER_STEPS.map(ml => `<button type="button" class="btn secondary water-add" data-ml="${ml}" style="width:auto;flex:none;padding:0 14px">+${ml} ml</button>`).join("")}
    </div>
  `;

  el.querySelectorAll(".water-add").forEach(btn => {
    btn.addEventListener("click", () => {
      logWater(Number(btn.dataset.ml));
      refresh();
    });
  });
  el.querySelector(".water-undo")?.addEventListener("click", () => {
    undoLastWater(profile.id, dateKey);
    refresh();
  });
}

function renderRings(container, profile, targets, dateKey) {
  const entries = getConsumptionForDate(profile.id, dateKey);
  const totals = sumConsumption(entries);
  const rows = [
    { label: "Kalorien", unit: "kcal", target: targets.kcal, consumed: totals.kcal },
    { label: "Netto-KH", unit: "g", target: targets.netCarbG, consumed: totals.netCarbs },
    { label: "Fett", unit: "g", target: targets.fatG, consumed: totals.fat },
    { label: "Eiweiß", unit: "g", target: targets.proteinG, consumed: totals.protein },
  ];
  container.querySelector("#ringGrid").innerHTML = rows.map(ringTile).join("");
  return entries;
}

function ringSvg(pct, over) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(pct, 1));
  const offset = c * (1 - clamped);
  return `
    <svg viewBox="0 0 100 100" class="ring-svg">
      <circle class="ring-track" cx="50" cy="50" r="${r}"></circle>
      <circle class="ring-progress ${over ? "over" : ""}" cx="50" cy="50" r="${r}"
        stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
        transform="rotate(-90 50 50)"></circle>
    </svg>
  `;
}

function ringTile(r) {
  const over = r.consumed > r.target;
  const remaining = round1(Math.abs(r.target - r.consumed));
  const pct = r.target > 0 ? r.consumed / r.target : 0;
  return `
    <div class="ring-tile">
      <div class="ring-wrap">
        ${ringSvg(pct, over)}
        <div class="ring-center">
          <div class="ring-value ${over ? "over" : ""}">${over ? "+" : ""}${remaining}</div>
          <div class="ring-unit">${esc(r.unit)} ${over ? "über" : "übrig"}</div>
        </div>
      </div>
      <div class="ring-label">${esc(r.label)}</div>
      <div class="ring-sub">${round1(r.consumed)} / ${r.target} ${esc(r.unit)}</div>
    </div>
  `;
}

function renderConsumptionList(container, entries, refresh) {
  const listEl = container.querySelector("#consumptionList");
  if (entries.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><span class="emoji">🍽️</span>${isViewingToday() ? "Heute noch nichts eingetragen." : "Für diesen Tag noch nichts eingetragen."}</div>`;
    return;
  }

  const groups = new Map([...MEAL_ORDER, "none"].map(k => [k, []]));
  for (const e of entries) {
    const key = MEAL_LABELS[e.meal] ? e.meal : "none";
    groups.get(key).push(e);
  }

  let html = "";
  for (const key of [...MEAL_ORDER, "none"]) {
    const items = groups.get(key);
    if (items.length === 0) continue;
    html += `<div class="meal-group-title">${key === "none" ? "Ohne Zuordnung" : MEAL_LABELS[key]}</div>`;
    html += items.map(entryRowHtml).join("");
  }
  listEl.innerHTML = html;

  listEl.querySelectorAll(".list-item").forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-action="undo"]').addEventListener("click", (e) => {
      e.stopPropagation();
      Store.removeConsumption(id);
      showToast("Eintrag entfernt");
      refresh();
    });
    row.addEventListener("click", () => {
      const entry = Store.getConsumption().find(c => c.id === id);
      if (entry) openEditConsumptionModal(entry, refresh);
    });
  });
}

function entryRowHtml(e) {
  // Alle vier Nährwerte in einer Zeile — kurze Kürzel (KH/F/E) statt ausgeschriebener
  // Bezeichnungen, damit es auch auf schmalen Displays ohne Umbruch passt.
  const n = (v) => v ?? "–";
  return `
    <div class="list-item" data-id="${e.id}" style="cursor:pointer">
      <div class="info">
        <div class="name">${esc(e.name)} · ${e.servings != null ? `${e.servings} Portion(en)` : `${e.grams} g`}</div>
        <div class="meta">${n(e.kcal)} kcal · KH ${n(e.netCarbs)} · F ${n(e.fat)} · E ${n(e.protein)}</div>
      </div>
      <button class="icon-btn" data-action="undo" title="Entfernen">↩️</button>
    </div>
  `;
}

async function renderRecent(container, targets, refresh) {
  const el = container.querySelector("#recentList");
  const recent = Store.getRecent();
  if (recent.length === 0) {
    el.innerHTML = `<div class="empty-state"><span class="emoji">📦</span>Noch nichts gescannt.</div>`;
    return;
  }

  const rows = [];
  for (const barcode of recent.slice(0, 5)) {
    try {
      const product = await lookupProduct(barcode);
      const evalResult = evaluateProduct(product, targets);
      rows.push({ product, evalResult });
    } catch {
      // Produkt evtl. offline nicht verfügbar — überspringen statt Fehler zu zeigen
    }
  }

  if (rows.length === 0) {
    el.innerHTML = `<p class="muted">Keine Details verfügbar (offline?).</p>`;
    return;
  }

  el.innerHTML = rows.map(({ product, evalResult }, i) => `
    <div class="list-item" data-idx="${i}" style="cursor:pointer">
      <span class="badge ${evalResult.grade}" style="flex-shrink:0">${{ green: "🟢", yellow: "🟡", red: "🔴" }[evalResult.grade] || "⚪"}</span>
      <div class="info">
        <div class="name">${esc(product.name)}</div>
        <div class="meta">${esc(product.brand || "")}${evalResult.netCarbs100 != null ? ` · ${evalResult.netCarbs100} g Netto-KH/100g` : ""}</div>
      </div>
      <span class="icon-btn" title="Menge eintragen" style="pointer-events:none">🍽️</span>
    </div>
  `).join("");

  el.querySelectorAll(".list-item").forEach(row => {
    row.addEventListener("click", () => {
      const { product } = rows[Number(row.dataset.idx)];
      openQuantityModal(product, refresh);
    });
  });
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ===========================================================================
// Design „Klar" — dieselben Daten, andere Darstellung: Wochenstreifen statt
// ◀ Heute ▶, ein großer Netto-KH-Ring + drei Balken statt vier gleichrangiger
// Ringe, Mahlzeiten in einer Karte, Undo über die Snackbar statt ↩️ je Zeile.
// ===========================================================================

const KLAR_WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const KLAR_RING_CIRCUMFERENCE = 270.2; // 2πr bei r=43 im viewBox 0 0 100 100

async function renderStartKlar(container, goToTab, profile) {
  const dateKey = getActiveDateKey();
  const targets = getTargetsForDate(profile, dateKey);
  const refresh = () => renderStart(container, goToTab);
  const entries = getConsumptionForDate(profile.id, dateKey);
  const totals = sumConsumption(entries);

  container.innerHTML = `
    <div class="klar-week-strip" id="klarWeek"></div>
    <div class="klar-card" id="klarMacros"></div>
    <div class="klar-water-card" id="klarWater"></div>
    <div class="klar-meals-head">
      <span class="klar-meals-title">Mahlzeiten</span>
      <span class="klar-meals-count">${entries.length} ${entries.length === 1 ? "Eintrag" : "Einträge"}</span>
    </div>
    <div id="klarMeals"></div>
    <button class="btn ghost" id="saveImageBtn" style="margin-top:20px">📸 Dashboard als Bild sichern</button>
  `;

  container.querySelector("#saveImageBtn").addEventListener("click", () => saveDashboardAsImage(container));

  renderKlarWeekStrip(container, dateKey, refresh);
  renderKlarMacros(container, totals, targets, goToTab);
  renderKlarWater(container, profile, dateKey, refresh);
  renderKlarMeals(container, entries, refresh);
}

function renderKlarWeekStrip(container, activeKey, refresh) {
  const el = container.querySelector("#klarWeek");
  const todayKey = dateKeyOf(Date.now());
  const [y, m, d] = activeKey.split("-").map(Number);
  const active = new Date(y, m - 1, d);
  // Woche des gewählten Tages, Montag zuerst (getDay(): 0 = Sonntag).
  const monday = new Date(active);
  monday.setDate(active.getDate() - ((active.getDay() + 6) % 7));

  const cells = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const key = dateKeyOf(day.getTime());
    const isFuture = key > todayKey;
    cells.push(`
      <button type="button" class="klar-week-cell ${key === activeKey ? "today" : ""} ${isFuture ? "future" : ""}"
        data-key="${key}" ${isFuture ? "disabled" : ""}>
        ${KLAR_WEEKDAYS[day.getDay()]}<div class="dom">${day.getDate()}</div>
      </button>
    `);
  }
  el.innerHTML = cells.join("");

  el.querySelectorAll(".klar-week-cell:not([disabled])").forEach(btn => {
    btn.addEventListener("click", () => { setActiveDateKey(btn.dataset.key); refresh(); });
  });

  // Wischen blättert wochenweise — dieselbe Geste wie im Prototyp, ohne Extra-Knöpfe.
  let startX = null;
  el.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) < 50) return;
    shiftActiveDate(dx < 0 ? 7 : -7);
    if (getActiveDateKey() > todayKey) setActiveDateKey(todayKey);
    refresh();
  }, { passive: true });
}

function renderKlarMacros(container, totals, targets, goToTab) {
  const el = container.querySelector("#klarMacros");
  const over = totals.netCarbs > targets.netCarbG;
  const remaining = round1(Math.abs(targets.netCarbG - totals.netCarbs));
  const pct = targets.netCarbG > 0 ? Math.min(totals.netCarbs / targets.netCarbG, 1) : 0;
  const offset = KLAR_RING_CIRCUMFERENCE * (1 - pct);

  const bars = [
    { name: "Kalorien", unit: "kcal", consumed: totals.kcal, target: targets.kcal },
    { name: "Fett", unit: "g", consumed: totals.fat, target: targets.fatG },
    { name: "Eiweiß", unit: "g", consumed: totals.protein, target: targets.proteinG },
  ];

  const budgetHint = over ? "" : klarBudgetHint(targets.netCarbG - totals.netCarbs);

  el.innerHTML = `
    <div class="klar-card-head">
      <span class="klar-eyebrow">Nährwerte ${esc(dateLabel(getActiveDateKey()).toLowerCase())}</span>
      <button type="button" class="klar-pill-btn" id="klarEvalBtn">📊 Auswertung</button>
    </div>
    <div class="klar-ring-row">
      <div class="klar-ring-wrap">
        <svg viewBox="0 0 100 100" class="klar-ring-svg">
          <circle class="klar-ring-track" cx="50" cy="50" r="43"></circle>
          <circle class="klar-ring-progress ${over ? "over" : ""}" cx="50" cy="50" r="43"
            stroke-dasharray="${KLAR_RING_CIRCUMFERENCE}" stroke-dashoffset="${offset.toFixed(1)}"
            transform="rotate(-90 50 50)"></circle>
        </svg>
        <div class="klar-ring-center">
          <div class="klar-ring-value ${over ? "over" : ""}">${over ? "+" : ""}${remaining}</div>
          <div class="klar-ring-sub">g ${over ? "über Limit" : "übrig"}</div>
        </div>
      </div>
      <div class="klar-ring-info">
        <div class="klar-macro-label">Netto-Kohlenhydrate</div>
        <div class="klar-macro-value">${round1(totals.netCarbs)} <span class="of">von ${targets.netCarbG} g</span></div>
        <div style="margin-top:12px"><span class="badge ${over ? "red" : "green"}">${over ? "Über Limit" : "Im Ziel"}</span></div>
        ${budgetHint ? `<div class="klar-hint">${esc(budgetHint)}</div>` : ""}
      </div>
    </div>
    <hr class="klar-divider">
    ${bars.map(klarBarHtml).join("")}
  `;

  el.querySelector("#klarEvalBtn").addEventListener("click", () => goToTab("evaluation"));
}

/**
 * „Reicht noch für …" nur zeigen, wenn es auch stimmt: es muss ein konkretes Lebensmittel aus
 * den Favoriten geben, das ins Restbudget passt. Sonst lieber gar keinen Satz als einen
 * generischen Füllsatz.
 */
function klarBudgetHint(remainingG) {
  if (remainingG <= 0) return "";
  const fits = Store.get().favorites
    .filter(f => f.netCarbs100 != null && f.netCarbs100 > 0 && f.netCarbs100 <= remainingG)
    .sort((a, b) => b.netCarbs100 - a.netCarbs100)[0];
  return fits ? `Reicht noch für 100 g ${fits.name}.` : "";
}

function klarBarHtml(b) {
  const over = b.consumed > b.target;
  const pct = b.target > 0 ? Math.min((b.consumed / b.target) * 100, 100) : 0;
  return `
    <div class="klar-bar-row">
      <div class="klar-bar-labels">
        <span class="name">${esc(b.name)}</span>
        <span class="nums">${Math.round(b.consumed)} / ${b.target} ${esc(b.unit)}</span>
      </div>
      <div class="klar-bar-track"><div class="klar-bar-fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>
    </div>
  `;
}

function renderKlarWater(container, profile, dateKey, refresh) {
  const el = container.querySelector("#klarWater");
  const consumedMl = sumWater(getWaterForDate(profile.id, dateKey));
  const target = profile.waterTargetMl || 2500;
  const pct = target > 0 ? Math.min((consumedMl / target) * 100, 100) : 0;

  el.innerHTML = `
    <div class="klar-water-head">
      <span class="klar-water-title">Wasser</span>
      <span class="klar-water-value">${consumedMl} / ${target} ml</span>
    </div>
    <div class="klar-water-track"><div class="klar-water-fill" style="width:${pct}%"></div></div>
    <div class="klar-water-actions">
      ${WATER_STEPS.map(ml => `<button type="button" class="klar-water-add" data-ml="${ml}">+${ml}</button>`).join("")}
      <button type="button" class="klar-water-undo" title="Rückgängig" ${consumedMl > 0 ? "" : "disabled"}>↩</button>
    </div>
  `;

  el.querySelectorAll(".klar-water-add").forEach(btn => {
    btn.addEventListener("click", () => {
      const ml = Number(btn.dataset.ml);
      const entry = logWater(ml);
      refresh();
      showSnackbar({
        title: `${ml} ml Wasser`,
        subtitle: `${consumedMl + ml} von ${target} ml`,
        onUndo: () => { Store.removeWater(entry.id); refresh(); },
      });
    });
  });
  el.querySelector(".klar-water-undo")?.addEventListener("click", () => {
    undoLastWater(profile.id, dateKey);
    refresh();
  });
}

function renderKlarMeals(container, entries, refresh) {
  const el = container.querySelector("#klarMeals");
  if (entries.length === 0) {
    el.innerHTML = `<div class="klar-empty-row"><span class="plus">+</span>Noch nichts eingetragen</div>`;
    return;
  }

  const groups = new Map([...MEAL_ORDER, "none"].map(k => [k, []]));
  for (const e of entries) {
    const key = MEAL_LABELS[e.meal] ? e.meal : "none";
    groups.get(key).push(e);
  }

  const blocks = [];
  for (const key of [...MEAL_ORDER, "none"]) {
    const items = groups.get(key);
    if (items.length === 0) continue;
    const kcal = Math.round(items.reduce((s, e) => s + (e.kcal || 0), 0));
    const label = key === "none" ? "Ohne Zuordnung" : MEAL_LABELS[key].replace(/^\S+\s/, "");
    blocks.push(`
      <div class="klar-meal-group-title">${esc(label)} · ${kcal} kcal</div>
      ${items.map(e => `
        <div class="klar-meal-row" data-id="${e.id}">
          <span class="name">${esc(e.name)}</span>
          <span class="meta">${e.servings != null ? `${e.servings} P.` : `${e.grams} g`} · ${e.kcal ?? "–"} kcal</span>
          <span class="chevron">›</span>
        </div>
      `).join("")}
    `);
  }
  el.innerHTML = `<div class="klar-meals-card">${blocks.join(`<div class="klar-meal-divider"></div>`)}</div>`;

  el.querySelectorAll(".klar-meal-row").forEach(row => {
    row.addEventListener("click", () => {
      const entry = Store.getConsumption().find(c => c.id === row.dataset.id);
      if (entry) openEditConsumptionModal(entry, refresh);
    });
  });
}
