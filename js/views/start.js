// views/start.js — Startseite: Datumsnavigation, Ziel-/Verbrauchsringe, Mahlzeiten,
// zuletzt gescannte Produkte.
import { Store } from "../store.js";
import { calcTargets } from "../profiles.js";
import { lookupProduct } from "../off.js";
import { evaluateProduct } from "../keto.js";
import {
  getConsumptionForDate, sumConsumption, openQuantityModal, openEditConsumptionModal,
  getActiveDateKey, resetActiveDateToToday, shiftActiveDate,
  isViewingToday, dateLabel, MEAL_LABELS,
} from "../consumption.js";
import { esc, showToast } from "../ui.js";

const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"];

export async function renderStart(container, goToTab) {
  const profile = Store.getActiveProfile();
  const targets = calcTargets(profile);
  const dateKey = getActiveDateKey();
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
    </div>

    <div id="consumptionList" style="margin-top:14px"></div>

    <button class="btn" id="startScanBtn" style="margin-top:20px">📷 Produkt scannen</button>

    <h2 class="section-title" style="margin-top:24px">Zuletzt gescannt</h2>
    <p class="hint" style="margin-top:-8px">Zum Eintragen einer Menge auf ein Produkt tippen.</p>
    <div id="recentList"><p class="muted">Lädt …</p></div>
  `;

  container.querySelector("#startScanBtn").addEventListener("click", () => goToTab("scan"));
  container.querySelector("#datePrev").addEventListener("click", () => { shiftActiveDate(-1); refresh(); });
  container.querySelector("#dateNext").addEventListener("click", () => { shiftActiveDate(1); refresh(); });
  container.querySelector("#dateLabelBtn").addEventListener("click", () => {
    if (!isViewingToday()) { resetActiveDateToToday(); refresh(); }
  });

  const entries = renderRings(container, profile, targets, dateKey);
  renderConsumptionList(container, entries, refresh);
  renderRecent(container, targets, refresh);
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
  return `
    <div class="list-item" data-id="${e.id}" style="cursor:pointer">
      <div class="info">
        <div class="name">${esc(e.name)} · ${e.servings != null ? `${e.servings} Portion(en)` : `${e.grams} g`}</div>
        <div class="meta">${e.kcal ?? "–"} kcal · ${e.netCarbs ?? "–"} g Netto-KH · ${new Date(e.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</div>
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
