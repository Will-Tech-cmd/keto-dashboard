// lists.js — Rendering & Interaktion für den "Listen"-Tab (Favoriten / No-Go / Einkaufsliste).
import { Store } from "./store.js";
import { showToast } from "./ui.js";

let activeSubtab = "favorites"; // "favorites" | "noGo" | "shopping" | "history"
let historyPeriodDays = 7; // 7 | 30 | 90 | null (null = alle)

export function renderLists(container) {
  container.innerHTML = `
    <h1 class="section-title">Listen</h1>
    <div class="subtabs">
      <button class="subtab-btn" data-sub="favorites" type="button">⭐ Favoriten</button>
      <button class="subtab-btn" data-sub="noGo" type="button">🚫 No-Go</button>
      <button class="subtab-btn" data-sub="shopping" type="button">🛒 Einkauf</button>
      <button class="subtab-btn" data-sub="history" type="button">🕘 Verlauf</button>
    </div>
    <div id="listBody"></div>
  `;

  container.querySelectorAll(".subtab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSubtab = btn.dataset.sub;
      renderSubtabs(container);
      renderBody(container);
    });
  });

  renderSubtabs(container);
  renderBody(container);
}

function renderSubtabs(container) {
  container.querySelectorAll(".subtab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sub === activeSubtab);
  });
}

function renderBody(container) {
  const body = container.querySelector("#listBody");
  if (activeSubtab === "shopping") {
    renderShopping(body);
  } else if (activeSubtab === "history") {
    renderHistory(body);
  } else {
    renderProductList(body, activeSubtab);
  }
}

function renderProductList(body, listName) {
  const state = Store.get();
  const items = state[listName];
  if (items.length === 0) {
    body.innerHTML = emptyState(
      listName === "favorites" ? "⭐" : "🚫",
      listName === "favorites"
        ? "Noch keine Favoriten. Scanne ein Produkt und speichere es hier."
        : "Noch keine No-Go-Produkte."
    );
    return;
  }

  body.innerHTML = items.map(item => `
    <div class="list-item" data-barcode="${esc(item.barcode)}">
      <span class="badge ${item.grade || "gray"}" style="flex-shrink:0">${gradeEmoji(item.grade)}</span>
      <div class="info">
        <div class="name">${esc(item.name)}</div>
        <div class="meta">${esc(item.brand || "")}${item.netCarbs100 != null ? ` · ${item.netCarbs100} g Netto-KH/100g` : ""}</div>
      </div>
      <button class="icon-btn" data-action="cart" title="Auf Einkaufsliste">🛒</button>
      <button class="icon-btn" data-action="remove" title="Entfernen">🗑️</button>
    </div>
  `).join("");

  body.querySelectorAll(".list-item").forEach(row => {
    const barcode = row.dataset.barcode;
    row.querySelector('[data-action="remove"]').addEventListener("click", () => {
      Store.removeFromList(listName, barcode);
      renderProductList(body, listName);
      showToast("Entfernt");
    });
    row.querySelector('[data-action="cart"]').addEventListener("click", () => {
      const item = Store.get()[listName].find(e => e.barcode === barcode);
      Store.addShoppingItem(item.name, barcode);
      showToast("Auf Einkaufsliste gesetzt");
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
  const items = cutoff ? all.filter(e => e.at >= cutoff) : all;

  const counts = { green: 0, yellow: 0, red: 0, gray: 0 };
  items.forEach(e => { counts[e.grade || "gray"] = (counts[e.grade || "gray"] || 0) + 1; });

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
    ${items.length > 0 ? `
      <div class="grid-2" style="margin-bottom:14px">
        <div class="stat"><div class="val">🟢 ${counts.green}</div><div class="lbl">Keto-tauglich</div></div>
        <div class="stat"><div class="val">🟡 ${counts.yellow}</div><div class="lbl">In Maßen</div></div>
        <div class="stat"><div class="val">🔴 ${counts.red}</div><div class="lbl">Nicht keto</div></div>
        <div class="stat"><div class="val">${items.length}</div><div class="lbl">Gesamt geprüft</div></div>
      </div>
    ` : ""}
    <div id="historyList"></div>
    ${all.length > 0 ? `<button class="btn ghost" id="clearHistoryBtn" style="margin-top:10px">Verlauf löschen</button>` : ""}
  `;

  renderHistoryList(body.querySelector("#historyList"), items);

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

function renderHistoryList(el, items) {
  if (items.length === 0) {
    el.innerHTML = emptyState("🕘", "Noch nichts im gewählten Zeitraum gescannt oder gesucht.");
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
      <div class="list-item">
        <span class="badge ${entry.grade || "gray"}" style="flex-shrink:0">${gradeEmoji(entry.grade)}</span>
        <div class="info">
          <div class="name">${esc(entry.name)}</div>
          <div class="meta">${time} · ${esc(entry.profileName)}${entry.netCarbs100 != null ? ` · ${entry.netCarbs100} g Netto-KH/100g` : ""}</div>
        </div>
      </div>
    `);
  }
  el.innerHTML = rows.join("");
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
