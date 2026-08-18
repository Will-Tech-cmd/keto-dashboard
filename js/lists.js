// lists.js — Rendering & Interaktion für den "Listen"-Tab (Favoriten / No-Go / Einkauf /
// Verlauf / Auswertung).
import { Store, dateKeyOf } from "./store.js";
import { getTargetsForDate } from "./profiles.js";
import { lookupProduct } from "./off.js";
import {
  openQuantityModal, getConsumptionForDate, sumConsumption, setActiveDateKey,
} from "./consumption.js";
import { openAnalysisModal } from "./analysis.js";
import { showToast } from "./ui.js";

let activeSubtab = "favorites"; // "favorites" | "noGo" | "shopping" | "history" | "evaluation"
let historyPeriodDays = 7; // 7 | 30 | 90 | null (null = alle)
let listFilter = "";       // Suchbegriff für Favoriten/No-Go
let historyFilter = "";    // Suchbegriff für den Verlauf
let pendingSubtab = null;  // von App-Shortcuts gesetzter Ziel-Reiter, einmalig beim nächsten Aufruf

/** Legt den Reiter fest, der beim nächsten renderLists() zuerst gezeigt wird (z.B. aus einem
 * Homescreen-Shortcut). Wird nach Gebrauch zurückgesetzt, spätere normale Aufrufe sind unberührt. */
export function openListsSubtab(sub) {
  pendingSubtab = sub;
}

export function renderLists(container, goToTab) {
  if (pendingSubtab) { activeSubtab = pendingSubtab; pendingSubtab = null; }
  container.innerHTML = `
    <h1 class="section-title">Listen</h1>
    <div class="subtabs">
      <button class="subtab-btn" data-sub="favorites" type="button">⭐ Favoriten</button>
      <button class="subtab-btn" data-sub="noGo" type="button">🚫 No-Go</button>
      <button class="subtab-btn" data-sub="shopping" type="button">🛒 Einkauf</button>
      <button class="subtab-btn" data-sub="history" type="button">🕘 Verlauf</button>
      <button class="subtab-btn" data-sub="evaluation" type="button">📊 Auswertung</button>
    </div>
    <div id="listBody"></div>
  `;

  container.querySelectorAll(".subtab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSubtab = btn.dataset.sub;
      listFilter = ""; // Suchbegriffe gelten nicht über Reiter hinweg
      historyFilter = "";
      renderSubtabs(container);
      renderBody(container, goToTab);
    });
  });

  renderSubtabs(container);
  renderBody(container, goToTab);
}

function renderSubtabs(container) {
  container.querySelectorAll(".subtab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sub === activeSubtab);
  });
}

function renderBody(container, goToTab) {
  const body = container.querySelector("#listBody");
  if (activeSubtab === "shopping") {
    renderShopping(body);
  } else if (activeSubtab === "history") {
    renderHistory(body);
  } else if (activeSubtab === "evaluation") {
    renderEvaluation(body, goToTab);
  } else {
    renderProductList(body, activeSubtab);
  }
}

function renderProductList(body, listName) {
  const all = Store.get()[listName];
  if (all.length === 0) {
    body.innerHTML = emptyState(
      listName === "favorites" ? "⭐" : "🚫",
      listName === "favorites"
        ? "Noch keine Favoriten. Scanne ein Produkt und speichere es hier."
        : "Noch keine No-Go-Produkte."
    );
    return;
  }

  body.innerHTML = `
    <input type="text" id="listSearch" placeholder="🔎 Suchen …" autocomplete="off"
      value="${esc(listFilter)}" style="margin-bottom:12px">
    <div id="listRows"></div>
  `;
  const search = body.querySelector("#listSearch");
  search.addEventListener("input", () => {
    listFilter = search.value;
    renderProductRows(body, listName);
  });
  renderProductRows(body, listName);
}

function renderProductRows(body, listName) {
  const rowsEl = body.querySelector("#listRows");
  const q = listFilter.trim().toLowerCase();
  const items = Store.get()[listName].filter(item =>
    !q || item.name.toLowerCase().includes(q) || (item.brand || "").toLowerCase().includes(q)
  );

  if (items.length === 0) {
    rowsEl.innerHTML = emptyState("🔎", `Kein Eintrag passt zu „${listFilter}".`);
    return;
  }

  rowsEl.innerHTML = items.map(item => `
    <div class="list-item" data-barcode="${esc(item.barcode)}" style="cursor:pointer">
      <span class="badge ${item.grade || "gray"}" style="flex-shrink:0">${gradeEmoji(item.grade)}</span>
      <div class="info">
        <div class="name">${esc(item.name)}</div>
        <div class="meta">${esc(item.brand || "")}${item.netCarbs100 != null ? ` · ${item.netCarbs100} g Netto-KH/100g` : ""}</div>
      </div>
      <button class="icon-btn" data-action="cart" title="Auf Einkaufsliste">🛒</button>
      <button class="icon-btn" data-action="remove" title="Entfernen">🗑️</button>
    </div>
  `).join("");

  rowsEl.querySelectorAll(".list-item").forEach(row => {
    const barcode = row.dataset.barcode;
    row.querySelector('[data-action="remove"]').addEventListener("click", (e) => {
      e.stopPropagation();
      Store.removeFromList(listName, barcode);
      // Komplett neu zeichnen, damit beim letzten Eintrag auch das Suchfeld verschwindet.
      renderProductList(body, listName);
      showToast("Entfernt");
    });
    row.querySelector('[data-action="cart"]').addEventListener("click", (e) => {
      e.stopPropagation();
      const item = Store.get()[listName].find(e2 => e2.barcode === barcode);
      Store.addShoppingItem(item.name, barcode);
      showToast("Auf Einkaufsliste gesetzt");
    });
    row.addEventListener("click", async () => {
      try {
        const product = await lookupProduct(barcode);
        openQuantityModal(product);
      } catch {
        showToast("Produkt nicht verfügbar (offline?)");
      }
    });
  });
}

function renderShopping(body) {
  const state = Store.get();
  const items = state.shoppingList;

  const listHtml = items.length === 0
    ? emptyState("🛒", "Einkaufsliste ist leer.")
    : items.map(item => `
      <label class="list-item checkbox-row ${item.checked ? "checked" : ""}" data-id="${item.id}">
        <input type="checkbox" ${item.checked ? "checked" : ""}>
        <div class="info"><div class="name">${esc(item.text)}</div></div>
        <button class="icon-btn" data-action="remove" title="Entfernen">🗑️</button>
      </label>
    `).join("");

  body.innerHTML = `
    <form id="addItemForm" class="btn-row" style="margin-bottom:12px">
      <input type="text" id="newItemText" placeholder="Artikel hinzufügen …" autocomplete="off">
      <button class="btn" type="submit" style="width:auto;padding:0 18px">+</button>
    </form>
    ${listHtml}
    ${items.some(i => i.checked) ? `<button class="btn secondary" id="clearChecked" style="margin-top:12px">Erledigte entfernen</button>` : ""}
  `;

  body.querySelector("#addItemForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = body.querySelector("#newItemText");
    const text = input.value.trim();
    if (!text) return;
    Store.addShoppingItem(text);
    renderShopping(body);
  });

  body.querySelectorAll(".checkbox-row").forEach(row => {
    const id = row.dataset.id;
    row.querySelector('input[type="checkbox"]').addEventListener("change", () => {
      Store.toggleShoppingItem(id);
      renderShopping(body);
    });
    row.querySelector('[data-action="remove"]').addEventListener("click", (e) => {
      e.preventDefault();
      Store.removeShoppingItem(id);
      renderShopping(body);
    });
  });

  body.querySelector("#clearChecked")?.addEventListener("click", () => {
    Store.clearCheckedShoppingItems();
    renderShopping(body);
  });
}

function renderHistory(body) {
  const all = Store.getHistory();
  const cutoff = historyPeriodDays ? Date.now() - historyPeriodDays * 86400000 : null;
  const periodItems = cutoff ? all.filter(e => e.at >= cutoff) : all;

  // Statistik bezieht sich bewusst nur auf den Zeitraum, nicht auf den Suchbegriff — die
  // Suche dient zum schnellen Wiederfinden, soll die Kennzahlen aber nicht verzerren.
  const counts = { green: 0, yellow: 0, red: 0, gray: 0 };
  periodItems.forEach(e => { counts[e.grade || "gray"] = (counts[e.grade || "gray"] || 0) + 1; });

  const periodBtn = (days, label) => `
    <button class="subtab-btn ${historyPeriodDays === days ? "active" : ""}" data-days="${days ?? ""}" type="button">${label}</button>
  `;

  body.innerHTML = `
    <div class="subtabs" style="margin-bottom:14px">
      ${periodBtn(7, "7 Tage")}
      ${periodBtn(30, "30 Tage")}
      ${periodBtn(90, "90 Tage")}
      ${periodBtn(null, "Alle")}
    </div>
    ${periodItems.length > 0 ? `
      <input type="text" id="historySearch" placeholder="🔎 Suchen …" autocomplete="off" value="${esc(historyFilter)}" style="margin-bottom:14px">
      <div class="grid-2" style="margin-bottom:14px">
        <div class="stat"><div class="val">🟢 ${counts.green}</div><div class="lbl">Keto-tauglich</div></div>
        <div class="stat"><div class="val">🟡 ${counts.yellow}</div><div class="lbl">In Maßen</div></div>
        <div class="stat"><div class="val">🔴 ${counts.red}</div><div class="lbl">Nicht keto</div></div>
        <div class="stat"><div class="val">${periodItems.length}</div><div class="lbl">Gesamt geprüft</div></div>
      </div>
    ` : ""}
    <div id="historyList"></div>
    ${all.length > 0 ? `<button class="btn ghost" id="clearHistoryBtn" style="margin-top:10px">Verlauf löschen</button>` : ""}
  `;

  renderHistoryList(body.querySelector("#historyList"), filterHistoryItems(periodItems));

  // Nur die Liste neu zeichnen, nicht den gesamten Block — sonst verliert das Suchfeld
  // bei jedem Tastendruck den Fokus.
  body.querySelector("#historySearch")?.addEventListener("input", (e) => {
    historyFilter = e.target.value;
    renderHistoryList(body.querySelector("#historyList"), filterHistoryItems(periodItems));
  });

  body.querySelectorAll(".subtabs .subtab-btn[data-days]").forEach(btn => {
    btn.addEventListener("click", () => {
      historyPeriodDays = btn.dataset.days === "" ? null : Number(btn.dataset.days);
      renderHistory(body);
    });
  });

  body.querySelector("#clearHistoryBtn")?.addEventListener("click", () => {
    if (confirm("Gesamten Such-/Scan-Verlauf löschen? Favoriten, No-Go und Einkaufsliste bleiben erhalten.")) {
      Store.clearHistory();
      renderHistory(body);
      showToast("Verlauf gelöscht");
    }
  });
}

function filterHistoryItems(items) {
  const q = historyFilter.trim().toLowerCase();
  if (!q) return items;
  return items.filter(e => e.name.toLowerCase().includes(q) || (e.brand || "").toLowerCase().includes(q));
}

function renderHistoryList(el, items) {
  if (items.length === 0) {
    el.innerHTML = historyFilter.trim()
      ? emptyState("🔎", `Kein Eintrag passt zu „${historyFilter}".`)
      : emptyState("🕘", "Noch nichts im gewählten Zeitraum gescannt oder gesucht.");
    return;
  }

  let lastLabel = null;
  const rows = [];
  for (const entry of items) {
    const label = dayLabel(entry.at);
    if (label !== lastLabel) {
      rows.push(`<div class="muted" style="font-size:.8rem;font-weight:700;margin:14px 0 6px">${esc(label)}</div>`);
      lastLabel = label;
    }
    const time = new Date(entry.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    rows.push(`
      <div class="list-item" data-barcode="${esc(entry.barcode)}" style="cursor:pointer">
        <span class="badge ${entry.grade || "gray"}" style="flex-shrink:0">${gradeEmoji(entry.grade)}</span>
        <div class="info">
          <div class="name">${esc(entry.name)}</div>
          <div class="meta">${time} · ${esc(entry.profileName)}${entry.netCarbs100 != null ? ` · ${entry.netCarbs100} g Netto-KH/100g` : ""}</div>
        </div>
      </div>
    `);
  }
  el.innerHTML = rows.join("");

  el.querySelectorAll(".list-item[data-barcode]").forEach(row => {
    row.addEventListener("click", async () => {
      try {
        const product = await lookupProduct(row.dataset.barcode);
        openQuantityModal(product);
      } catch {
        showToast("Produkt nicht verfügbar (offline?)");
      }
    });
  });
}

/** 30-Tage-Auswertung: Tag-für-Tag-Verlauf, Durchschnitte, Zielquote, längste Serie. */
function renderEvaluation(body, goToTab) {
  const profile = Store.getActiveProfile();

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const key = dateKeyOf(Date.now() - i * 86400000);
    const entries = getConsumptionForDate(profile.id, key);
    // Jeder Tag wird gegen die Zielwerte bewertet, die an diesem Tag galten.
    days.push({
      key,
      hasEntries: entries.length > 0,
      totals: sumConsumption(entries),
      targets: getTargetsForDate(profile, key),
    });
  }

  const withData = days.filter(d => d.hasEntries);
  const avgKcal = withData.length ? Math.round(withData.reduce((s, d) => s + d.totals.kcal, 0) / withData.length) : null;
  const avgCarbs = withData.length ? round1(withData.reduce((s, d) => s + d.totals.netCarbs, 0) / withData.length) : null;
  const daysInTarget = withData.filter(d => d.totals.netCarbs <= d.targets.netCarbG).length;

  let streak = 0, maxStreak = 0;
  for (const d of days) {
    if (d.hasEntries && d.totals.netCarbs <= d.targets.netCarbG) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }

  body.innerHTML = `
    <div class="grid-2" style="margin-bottom:14px">
      <div class="stat"><div class="val">${avgKcal ?? "–"}</div><div class="lbl">Ø kcal/Tag</div></div>
      <div class="stat"><div class="val">${avgCarbs ?? "–"} g</div><div class="lbl">Ø Netto-KH/Tag</div></div>
      <div class="stat"><div class="val">${daysInTarget}/${withData.length}</div><div class="lbl">Tage im Netto-KH-Ziel</div></div>
      <div class="stat"><div class="val">${maxStreak}</div><div class="lbl">Längste Serie im Ziel</div></div>
    </div>
    ${withData.length === 0
      ? `<p class="hint" style="text-align:center;margin-bottom:10px">Noch keine Einträge in den letzten 30 Tagen.</p>`
      : trendChartHtml(days)}
    <button class="btn secondary" id="analyzeBtn" style="margin-bottom:14px">🤖 Mit Claude analysieren</button>
    <div id="evalDays"></div>
  `;

  body.querySelector("#analyzeBtn").addEventListener("click", openAnalysisModal);

  const daysEl = body.querySelector("#evalDays");
  daysEl.innerHTML = [...days].reverse().map(evalDayRowHtml).join("");

  daysEl.querySelectorAll(".list-item[data-daykey]").forEach(row => {
    row.addEventListener("click", () => {
      setActiveDateKey(row.dataset.daykey);
      goToTab?.("start");
    });
  });
}

/**
 * Kleines SVG-Liniendiagramm des täglichen Netto-KH-Verbrauchs über den 30-Tage-Zeitraum.
 * Tage ohne Eintrag reißen die Linie ab statt sie auf 0 zu ziehen (sonst sähe "nichts
 * gegessen" wie "perfekt eingehalten" aus). Referenzlinie zeigt das HEUTIGE Ziel — frühere
 * Tage können (durch die Zielwert-Einfrierung) ein anderes gehabt haben, siehe Punktfarbe.
 */
function trendChartHtml(days) {
  const withData = days.filter(d => d.hasEntries);
  if (withData.length < 2) return "";

  const W = 640, H = 140, PAD = 10;
  const todayTarget = days[days.length - 1].targets.netCarbG;
  const maxVal = Math.max(todayTarget, ...withData.map(d => d.totals.netCarbs)) * 1.15 || 1;
  const n = days.length;
  const x = (i) => PAD + (i / (n - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - (Math.min(v, maxVal) / maxVal) * (H - PAD * 2);

  const segments = [];
  let current = [];
  days.forEach((d, i) => {
    if (d.hasEntries) {
      current.push(`${x(i).toFixed(1)},${y(d.totals.netCarbs).toFixed(1)}`);
    } else if (current.length) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length) segments.push(current);

  const dots = days.map((d, i) => {
    if (!d.hasEntries) return "";
    const over = d.totals.netCarbs > d.targets.netCarbG;
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(d.totals.netCarbs).toFixed(1)}" r="3" class="trend-dot ${over ? "over" : ""}"></circle>`;
  }).join("");

  const targetY = y(todayTarget).toFixed(1);

  return `
    <div class="card" style="margin-bottom:14px">
      <h2 style="margin-bottom:2px">Netto-KH-Verlauf</h2>
      <p class="hint" style="margin-top:0">Gestrichelt: heutiges Ziel (${todayTarget} g). Frühere Tage können ein anderes Ziel gehabt haben — rote Punkte lagen über ihrem jeweiligen Ziel.</p>
      <svg viewBox="0 0 ${W} ${H}" class="trend-svg" preserveAspectRatio="none" style="width:100%;height:120px">
        <line x1="${PAD}" y1="${targetY}" x2="${W - PAD}" y2="${targetY}" class="trend-target-line"></line>
        ${segments.map(seg => `<polyline points="${seg.join(" ")}" class="trend-line"></polyline>`).join("")}
        ${dots}
      </svg>
    </div>
  `;
}

function evalDayRowHtml(d) {
  const targets = d.targets;
  const [y, m, dd] = d.key.split("-").map(Number);
  const ts = new Date(y, m - 1, dd).getTime();
  const label = dayLabel(ts);

  if (!d.hasEntries) {
    return `
      <div class="list-item" data-daykey="${d.key}" style="cursor:pointer;opacity:.55">
        <div class="info">
          <div class="name">${esc(label)}</div>
          <div class="meta">Keine Einträge</div>
        </div>
      </div>
    `;
  }

  const over = d.totals.netCarbs > targets.netCarbG;
  const pct = targets.netCarbG > 0 ? Math.min((d.totals.netCarbs / targets.netCarbG) * 100, 100) : 0;
  return `
    <div class="list-item" data-daykey="${d.key}" style="cursor:pointer;flex-direction:column;align-items:stretch;gap:6px">
      <div class="btn-row" style="justify-content:space-between;align-items:center">
        <span class="name">${esc(label)}</span>
        <span class="meta">${round1(d.totals.kcal)} kcal · ${round1(d.totals.netCarbs)} g Netto-KH</span>
      </div>
      <div class="progress-track" style="height:6px">
        <div class="progress-fill ${over ? "over" : ""}" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function dayLabel(ts) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(new Date(ts))) / 86400000);
  if (diffDays === 0) return "Heute";
  if (diffDays === 1) return "Gestern";
  return new Date(ts).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit" });
}

function gradeEmoji(grade) {
  return { green: "🟢", yellow: "🟡", red: "🔴" }[grade] || "⚪";
}

function emptyState(emoji, text) {
  return `<div class="empty-state"><span class="emoji">${emoji}</span>${esc(text)}</div>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
