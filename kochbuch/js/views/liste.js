// views/liste.js — Übersicht: Suche, Tag-Filter, Sortierung, Karten.
import { listRezepte, publicFotoUrl } from "../api.js";
import { saveListeCache, loadListeCache } from "../cache.js";
import { esc, showToast, starsHtml, formatMinutes } from "../ui.js";

let filterText = "";
let filterTag = null;
let sortBy = "updated"; // "updated" | "rating" | "stale"

export async function renderListe(container, { onOpen, onNew, onImport, onSettings }) {
  container.innerHTML = `
    <div class="kb-topbar">
      <span class="kb-brand">📖 Kochbuch</span>
      <div class="kb-topbar-actions">
        <button class="kb-icon-btn" id="importBtn" title="Aus der Keto-App übernehmen">⬇️</button>
        <button class="kb-icon-btn" id="settingsBtn" title="Einstellungen">⚙️</button>
      </div>
    </div>
    <div class="kb-list-controls">
      <input type="text" id="searchInput" placeholder="🔎 Rezept oder Zutat suchen …" value="${esc(filterText)}">
      <select id="sortSelect">
        <option value="updated" ${sortBy === "updated" ? "selected" : ""}>Zuletzt geändert</option>
        <option value="rating" ${sortBy === "rating" ? "selected" : ""}>Bewertung</option>
        <option value="stale" ${sortBy === "stale" ? "selected" : ""}>Lange nicht gekocht</option>
      </select>
    </div>
    <div id="tagRow" class="kb-tag-row"></div>
    <div id="cards" class="kb-cards"><p class="kb-hint">Lädt …</p></div>
    <button class="kb-fab" id="newBtn" aria-label="Neues Rezept">+</button>
  `;

  container.querySelector("#newBtn").addEventListener("click", onNew);
  container.querySelector("#importBtn").addEventListener("click", onImport);
  container.querySelector("#settingsBtn").addEventListener("click", onSettings);
  container.querySelector("#searchInput").addEventListener("input", (e) => {
    filterText = e.target.value;
    renderCards(container, rezepte, onOpen);
  });
  container.querySelector("#sortSelect").addEventListener("change", (e) => {
    sortBy = e.target.value;
    renderCards(container, rezepte, onOpen);
  });

  let rezepte = loadListeCache() || [];
  if (rezepte.length) renderCards(container, rezepte, onOpen);

  try {
    rezepte = await listRezepte();
    saveListeCache(rezepte);
    renderCards(container, rezepte, onOpen);
  } catch (err) {
    if (rezepte.length === 0) {
      container.querySelector("#cards").innerHTML = `<p class="kb-hint">${esc(err.message)}</p>`;
    } else {
      showToast("Offline — zeige den letzten bekannten Stand");
    }
  }
}

function renderCards(container, rezepte, onOpen) {
  const tagRow = container.querySelector("#tagRow");
  const allTags = [...new Set(rezepte.flatMap(r => r.tags || []))].sort();
  tagRow.innerHTML = allTags.map(t => `
    <button type="button" class="kb-tag-chip ${t === filterTag ? "active" : ""}" data-tag="${esc(t)}">${esc(t)}</button>
  `).join("");
  tagRow.querySelectorAll(".kb-tag-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      filterTag = filterTag === chip.dataset.tag ? null : chip.dataset.tag;
      renderCards(container, rezepte, onOpen);
    });
  });

  const q = filterText.trim().toLowerCase();
  let filtered = rezepte.filter(r => {
    if (filterTag && !(r.tags || []).includes(filterTag)) return false;
    if (!q) return true;
    return r.titel.toLowerCase().includes(q) || (r.untertitel || "").toLowerCase().includes(q);
  });

  filtered = [...filtered].sort((a, b) => {
    if (sortBy === "rating") return (b.bewertung || 0) - (a.bewertung || 0);
    if (sortBy === "stale") return (a.zuletzt_gekocht || "") < (b.zuletzt_gekocht || "") ? -1 : 1;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  const cardsEl = container.querySelector("#cards");
  if (rezepte.length === 0) {
    cardsEl.innerHTML = `<p class="kb-hint">Noch keine Rezepte. Leg eins an oder übernimm eins aus der Keto-App.</p>`;
    return;
  }
  if (filtered.length === 0) {
    cardsEl.innerHTML = `<p class="kb-hint">Nichts gefunden.</p>`;
    return;
  }

  cardsEl.innerHTML = filtered.map(r => {
    const totalMin = (r.vorbereitung_min || 0) + (r.koch_min || 0) || null;
    const bild = r.titelbild ? publicFotoUrl(r.titelbild.pfad) : null;
    const n = r.naehrwerte;
    return `
      <button type="button" class="kb-card" data-id="${r.id}">
        <div class="kb-card-img" ${bild ? `style="background-image:url('${esc(bild)}')"` : ""}>${bild ? "" : "🍽️"}</div>
        <div class="kb-card-body">
          <div class="kb-card-title">${esc(r.titel)}</div>
          <div class="kb-card-meta">
            ${totalMin ? `<span>⏱ ${formatMinutes(totalMin)}</span>` : ""}
            ${r.bewertung ? starsHtml(r.bewertung) : ""}
          </div>
          ${n ? `<div class="kb-card-nutri">${n.kcal ?? "–"} kcal · ${n.netCarbs ?? "–"} g Netto-KH / Portion</div>` : ""}
        </div>
      </button>
    `;
  }).join("");

  cardsEl.querySelectorAll(".kb-card").forEach(card => {
    card.addEventListener("click", () => onOpen(card.dataset.id));
  });
}
