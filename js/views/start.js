// views/start.js — Startseite: Wochenstreifen, Ziel-/Verbrauchsringe samt Wasser,
// Mahlzeiten des Tages.
import { Store, dateKeyOf } from "../store.js";
import { getTargetsForDate } from "../profiles.js";
import {
  getConsumptionForDate, sumConsumption, openEditConsumptionModal,
  getActiveDateKey, shiftActiveDate, setActiveDateKey, dateLabel, MEAL_LABELS,
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
  return renderStartKlar(container, goToTab, Store.getActiveProfile());
}

const WATER_STEPS = [200, 330, 500];

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ===========================================================================
// Wochenstreifen zum Blättern, vier Zielringe plus Wasser in einer Karte,
// Mahlzeiten gruppiert darunter. Rückgängig läuft über die Snackbar.
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
    <div class="klar-meals-head">
      <span class="klar-meals-title">Mahlzeiten</span>
      <span class="klar-meals-count">${entries.length} ${entries.length === 1 ? "Eintrag" : "Einträge"}</span>
    </div>
    <div id="klarMeals"></div>
    <button class="btn ghost" id="saveImageBtn" style="margin-top:20px">📸 Screenshot</button>
  `;

  container.querySelector("#saveImageBtn").addEventListener("click", () => saveDashboardAsImage(container));

  renderKlarWeekStrip(container, dateKey, refresh);
  renderKlarMacros(container, totals, targets, goToTab, profile);
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
    // Zukünftige Tage sind wählbar (Essensplanung für morgen), nur optisch zurückgenommen.
    const isFuture = key > todayKey;
    cells.push(`
      <button type="button" class="klar-week-cell ${key === activeKey ? "today" : ""} ${isFuture ? "future" : ""}"
        data-key="${key}">
        ${KLAR_WEEKDAYS[day.getDay()]}<div class="dom">${day.getDate()}</div>
      </button>
    `);
  }
  el.innerHTML = cells.join("");

  el.querySelectorAll(".klar-week-cell").forEach(btn => {
    btn.addEventListener("click", () => { setActiveDateKey(btn.dataset.key); refresh(); });
  });

  // Wischen blättert wochenweise. Der Streifen folgt dabei sichtbar dem Finger und rastet
  // beim Loslassen ein — ohne diese Rückmeldung wirkt die Geste, als würde sie nicht erkannt.
  let startX = null;
  let dragging = false;

  el.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    dragging = false;
    el.style.transition = "none";
  }, { passive: true });

  el.addEventListener("touchmove", (e) => {
    if (startX == null) return;
    const dx = e.touches[0].clientX - startX;
    if (!dragging && Math.abs(dx) < 8) return;
    dragging = true;
    // Gedämpft mitziehen: deutlich sichtbar, aber der Streifen wandert nicht aus dem Bild.
    el.style.transform = `translateX(${dx * 0.35}px)`;
    el.style.opacity = String(Math.max(0.45, 1 - Math.abs(dx) / 420));
  }, { passive: true });

  const settle = () => {
    el.style.transition = "transform .18s, opacity .18s";
    el.style.transform = "";
    el.style.opacity = "";
  };

  el.addEventListener("touchend", (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    settle();
    if (Math.abs(dx) < 50) return;
    shiftActiveDate(dx < 0 ? 7 : -7);
    refresh();
  }, { passive: true });

  el.addEventListener("touchcancel", () => { startX = null; settle(); }, { passive: true });
}

function renderKlarMacros(container, totals, targets, goToTab, profile) {
  const el = container.querySelector("#klarMacros");
  const rings = [
    { label: "Kalorien", unit: "kcal", target: targets.kcal, consumed: totals.kcal },
    { label: "Netto-KH", unit: "g", target: targets.netCarbG, consumed: totals.netCarbs },
    { label: "Fett", unit: "g", target: targets.fatG, consumed: totals.fat },
    { label: "Eiweiß", unit: "g", target: targets.proteinG, consumed: totals.protein },
  ];
  const carbsLeft = targets.netCarbG - totals.netCarbs;
  const budgetHint = carbsLeft > 0 ? klarBudgetHint(carbsLeft) : "";

  el.innerHTML = `
    <div class="klar-card-head">
      <span class="klar-eyebrow">Nährwerte ${esc(dateLabel(getActiveDateKey()).toLowerCase())}</span>
      <div class="klar-head-actions">
        <button type="button" class="klar-pill-btn icon-only" id="klarScanBtn" title="Produkt scannen" aria-label="Produkt scannen">📷</button>
        <button type="button" class="klar-pill-btn" id="klarEvalBtn">📊 Auswertung</button>
      </div>
    </div>
    ${ringDiagramHtml(rings, profile.ringStyle)}
    ${budgetHint ? `<div class="klar-hint">${esc(budgetHint)}</div>` : ""}
    <div id="klarWater"></div>
  `;

  el.querySelector("#klarEvalBtn").addEventListener("click", () => goToTab("evaluation"));
  el.querySelector("#klarScanBtn").addEventListener("click", () => goToTab("scan"));
}

/** Wählt zwischen den drei Anzeigeformen (Profil-Einstellung, siehe views/profile.js). */
function ringDiagramHtml(rings, style) {
  if (style === "row") return klarRingRowHtml(rings);
  if (style === "concentric") return klarRingConcentricHtml(rings);
  return `<div class="klar-ring-grid">${rings.map(klarRingTile).join("")}</div>`;
}

/** Ein Ring je Zielwert im 2×2-Raster — die ursprüngliche Darstellung. */
function klarRingTile(r) {
  const over = r.consumed > r.target;
  const remaining = round1(Math.abs(r.target - r.consumed));
  const pct = r.target > 0 ? Math.min(r.consumed / r.target, 1) : 0;
  const offset = KLAR_RING_CIRCUMFERENCE * (1 - pct);
  return `
    <div class="klar-ring-tile">
      <div class="klar-ring-wrap">
        <svg viewBox="0 0 100 100" class="klar-ring-svg">
          <circle class="klar-ring-track" cx="50" cy="50" r="43"></circle>
          <circle class="klar-ring-progress ${over ? "over" : ""}" cx="50" cy="50" r="43"
            stroke-dasharray="${KLAR_RING_CIRCUMFERENCE}" stroke-dashoffset="${offset.toFixed(1)}"
            transform="rotate(-90 50 50)"></circle>
        </svg>
        <div class="klar-ring-center">
          <div class="klar-ring-value ${over ? "over" : ""}">${over ? "+" : ""}${remaining}</div>
          <div class="klar-ring-sub">${esc(r.unit)} ${over ? "über" : "übrig"}</div>
        </div>
      </div>
      <div class="klar-ring-label">${esc(r.label)}</div>
      <div class="klar-ring-total">${round1(r.consumed)} / ${r.target} ${esc(r.unit)}</div>
    </div>
  `;
}

/** Dieselben vier Ringe, aber in einer Zeile statt 2×2 — kompakter, alle vier ohne Scrollen. */
function klarRingRowHtml(rings) {
  return `<div class="klar-ring-grid row">${rings.map(klarRingTile).join("")}</div>`;
}

// Eine Farbe je Bahn, von außen nach innen — dieselbe Reihenfolge wie überall sonst (Kalorien,
// Netto-KH, Fett, Eiweiß). --sage kam mit dem Feinschliff dazu, war bis hierhin aber nirgends
// im Einsatz.
const CONCENTRIC_COLORS = ["var(--accent)", "var(--warm)", "var(--water-fg)", "var(--sage)"];
const CONCENTRIC_RADII = [43, 34, 25, 16];
const CONCENTRIC_CIRC = CONCENTRIC_RADII.map(r => 2 * Math.PI * r);

/**
 * Ein Ring, vier ineinanderliegende Bahnen — deutlich kompakter, dafür ist jede einzelne Bahn
 * klein und für sich schwerer zu lesen. Die Mitte zeigt die Kalorien (die meistgelesene Zahl),
 * der Rest steht als Legende darunter.
 */
function klarRingConcentricHtml(rings) {
  const kcalRing = rings[0];
  const kcalOver = kcalRing.consumed > kcalRing.target;
  const kcalRemaining = round1(Math.abs(kcalRing.target - kcalRing.consumed));

  const bands = rings.map((r, i) => {
    const pct = r.target > 0 ? Math.min(r.consumed / r.target, 1) : 0;
    const circ = CONCENTRIC_CIRC[i];
    const offset = circ * (1 - pct);
    const over = r.consumed > r.target;
    return `
      <circle class="klar-ring-track" cx="50" cy="50" r="${CONCENTRIC_RADII[i]}" stroke-width="7"></circle>
      <circle cx="50" cy="50" r="${CONCENTRIC_RADII[i]}" stroke-width="7" fill="none" stroke-linecap="round"
        stroke="${over ? "var(--warm)" : CONCENTRIC_COLORS[i]}"
        stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
        transform="rotate(-90 50 50)" style="transition:stroke-dashoffset .3s"></circle>
    `;
  }).join("");

  const legend = rings.map((r, i) => {
    const over = r.consumed > r.target;
    const remaining = round1(Math.abs(r.target - r.consumed));
    return `
      <div class="klar-ring-legend-row">
        <span class="klar-ring-legend-dot" style="background:${over ? "var(--warm)" : CONCENTRIC_COLORS[i]}"></span>
        <span class="klar-ring-legend-label">${esc(r.label)}</span>
        <span class="klar-ring-legend-val ${over ? "over" : ""}">${over ? "+" : ""}${remaining} ${esc(r.unit)} ${over ? "über" : "übrig"}</span>
      </div>
    `;
  }).join("");

  return `
    <div class="klar-ring-concentric">
      <div class="klar-ring-wrap" style="width:160px;height:160px">
        <svg viewBox="0 0 100 100" class="klar-ring-svg">${bands}</svg>
        <div class="klar-ring-center">
          <div class="klar-ring-value ${kcalOver ? "over" : ""}">${kcalOver ? "+" : ""}${kcalRemaining}</div>
          <div class="klar-ring-sub">kcal ${kcalOver ? "über" : "übrig"}</div>
        </div>
      </div>
    </div>
    <div class="klar-ring-legend">${legend}</div>
  `;
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
    <hr class="klar-divider">
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
          <span class="meta">${entryAmountLabel(e)} · ${e.kcal ?? "–"} kcal</span>
          <span class="chevron">›</span>
        </div>
      `).join("")}
    `);
  }
  el.innerHTML = `<div class="klar-meals-card">${blocks.join("")}</div>`;

  el.querySelectorAll(".klar-meal-row").forEach(row => {
    row.addEventListener("click", () => {
      const entry = Store.getConsumption().find(c => c.id === row.dataset.id);
      if (entry) openEditConsumptionModal(entry, refresh);
    });
  });
}

/** Menge einer Tageszeile: Rezepte in Portionen (mit Gewicht, wenn bekannt), Produkte in Gramm. */
function entryAmountLabel(e) {
  if (e.servings == null) return `${e.grams} g`;
  const grams = e.servingG ? ` (${Math.round(e.servingG * e.servings)} g)` : "";
  return `${e.servings} P.${grams}`;
}
