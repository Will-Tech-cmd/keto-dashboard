// lists.js — Rendering & Interaktion für den "Listen"-Tab (Favoriten / No-Go / Einkaufsliste).
import { Store } from "./store.js";
import { showToast } from "./ui.js";

let activeSubtab = "favorites"; // "favorites" | "noGo" | "shopping"

export function renderLists(container) {
  container.innerHTML = `
    <h1 class="section-title">Listen</h1>
    <div class="subtabs">
      <button class="subtab-btn" data-sub="favorites" type="button">⭐ Favoriten</button>
      <button class="subtab-btn" data-sub="noGo" type="button">🚫 No-Go</button>
      <button class="subtab-btn" data-sub="shopping" type="button">🛒 Einkauf</button>
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

function gradeEmoji(grade) {
  return { green: "🟢", yellow: "🟡", red: "🔴" }[grade] || "⚪";
}

function emptyState(emoji, text) {
  return `<div class="empty-state"><span class="emoji">${emoji}</span>${esc(text)}</div>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
