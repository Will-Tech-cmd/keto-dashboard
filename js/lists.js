// lists.js — Rendering & Interaktion für den "Listen"-Tab (Einkauf / Favoriten / No-Go /
// Verlauf) sowie die Auswertungsseite.
import { Store, dateKeyOf, shiftDateKey } from "./store.js";
import { getTargetsForDate } from "./profiles.js";

import { lookupProduct, getProductOffline, nutriSnapshot } from "./off.js";
import { ketoGrade, parseServingGrams } from "./keto.js";
import { openProductEditor } from "./product-editor.js";
import {
  openQuantityModal, getConsumptionForDate, sumConsumption, setActiveDateKey,
} from "./consumption.js";
import { openAnalysisModal } from "./analysis.js";
import { showToast, nutriTilesHtml, gradeDotHtml } from "./ui.js";
import { gewichtsBericht, trendSatz, zielAbgleichSatz, tagesnummer, kgProWoche } from "./gewicht.js";
import { openGewichtModal } from "./gewicht-eingabe.js";
import { ikon } from "./ikonen.js";

let activeSubtab = "favorites"; // "favorites" | "noGo" | "shopping" | "history" | "evaluation"
let historyPeriodDays = 7; // 7 | 30 | 90 | null (null = alle)
let listFilter = "";       // Suchbegriff für Favoriten/No-Go
let historyFilter = "";    // Suchbegriff für den Verlauf
let pendingSubtab = null;  // von App-Shortcuts gesetzter Ziel-Reiter, einmalig beim nächsten Aufruf
let subtabChosen = false;  // true, sobald bewusst ein Reiter angetippt wurde (siehe Klar-Standard)

/** Legt den Reiter fest, der beim nächsten renderLists() zuerst gezeigt wird (z.B. aus einem
 * Homescreen-Shortcut). Wird nach Gebrauch zurückgesetzt, spätere normale Aufrufe sind unberührt. */
export function openListsSubtab(sub) {
  pendingSubtab = sub;
}

// Favoriten stehen vorn (häufigster Griff), der Einkauf ganz rechts. Die Auswertung ist kein
// Reiter, sondern eine eigene Seite über die Nährwertkarte auf Start.
const SUBTABS = [
  { sub: "favorites", label: "Favoriten" },
  { sub: "noGo", label: "No-Go" },
  { sub: "history", label: "Verlauf" },
  { sub: "shopping", label: "Einkauf" },
];

export function renderLists(container, goToTab) {
  if (pendingSubtab) { activeSubtab = pendingSubtab; pendingSubtab = null; }
  // Favoriten sind der Startreiter, solange nicht bewusst ein anderer gewählt wurde.
  if (!subtabChosen || !SUBTABS.some(t => t.sub === activeSubtab)) activeSubtab = "favorites";

  container.innerHTML = `
    <div class="subtabs">
      ${SUBTABS.map(t => `<button class="subtab-btn" data-sub="${t.sub}" type="button">${t.label}</button>`).join("")}
    </div>
    <div id="listBody"></div>
  `;

  container.querySelectorAll(".subtab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSubtab = btn.dataset.sub;
      subtabChosen = true;
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
      listName === "favorites" ? "stern" : "verboten",
      listName === "favorites"
        ? "Noch keine Favoriten. Scanne ein Produkt und speichere es hier."
        : "Noch keine No-Go-Produkte."
    );
    return;
  }

  body.innerHTML = `
    <div class="such-feld" style="margin-bottom:12px">${ikon("suche", { groesse: 17 })}
      <input type="text" id="listSearch" placeholder="Suchen …" aria-label="In dieser Liste suchen" autocomplete="off" value="${esc(listFilter)}"></div>
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
    rowsEl.innerHTML = emptyState("suche", `Kein Eintrag passt zu „${listFilter}".`);
    return;
  }

  const isNoGo = listName === "noGo";
  rowsEl.innerHTML = `<div class="klar-list-card">${items.map(item => {
    const nutri = nutriOf(item, listName);
    // Nur die Marke. Die Nährwerte stehen aufgeklappt in den Kacheln — sie doppelt zu
    // führen machte die Zeile lang, ohne dass die Kacheln dadurch entbehrlich wurden.
    const meta = item.brand || "";
    // Die Ampel wird beim Zeichnen gerechnet, nicht aus dem Eintrag gelesen: die gespeicherte
    // stammt vom Zeitpunkt des Merkens und weiß nichts von einer Portionsgröße, die später
    // dazukam — und seit die Ampel je Portion bewertet, ändert genau die das Ergebnis.
    const grade = ampelFuer(item.barcode, nutri);
    return `
      <div class="list-entry" data-barcode="${esc(item.barcode)}">
        <div class="list-item" style="cursor:pointer">
          ${gradeDotHtml(grade)}
          <div class="info">
            <div class="name">${esc(item.name)}</div>
            <div class="meta">${esc(meta)}</div>
          </div>
          ${isNoGo ? "" : `<button class="icon-btn" data-action="cart" title="Auf Einkaufsliste" aria-label="Auf Einkaufsliste">${ikon("einkauf", { groesse: 19 })}</button>`}
        </div>
        ${isNoGo ? noGoDetailHtml(item, nutri) : detailHtml(nutri, portionsZeile(item.barcode, nutri))}
      </div>
    `;
  }).join("")}</div>`;

  rowsEl.querySelectorAll(".list-entry").forEach(entry => {
    const barcode = entry.dataset.barcode;
    entry.querySelector('[data-action="remove"]').addEventListener("click", (e) => {
      e.stopPropagation();
      Store.removeFromList(listName, barcode);
      // Komplett neu zeichnen, damit beim letzten Eintrag auch das Suchfeld verschwindet.
      renderProductList(body, listName);
      showToast("Entfernt");
    });
    entry.querySelector('[data-action="cart"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = Store.get()[listName].find(e2 => e2.barcode === barcode);
      Store.addShoppingItem(item.name, barcode);
      showToast("Auf Einkaufsliste gesetzt");
    });
    entry.querySelector(".list-item").addEventListener("click", () => toggleDetail(entry));
    entry.querySelector('[data-action="eat"]')?.addEventListener("click", async () => {
      const product = await resolveProduct(barcode);
      if (product) openQuantityModal(product);
    });
    entry.querySelector('[data-action="edit"]')?.addEventListener("click", async () => {
      const product = await resolveProduct(barcode);
      if (!product) return;
      openProductEditor(product, (saved) => {
        applyCorrectionToLists(saved);
        renderProductRows(body, listName);
      });
    });
    // No-Go: "Zu Favoriten" verschiebt den Eintrag statt ihn einzutragen — der Weg zurück,
    // wenn sich die Einschätzung ändert.
    entry.querySelector('[data-action="toFavorites"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = Store.get().noGo.find(e2 => e2.barcode === barcode);
      Store.addToList("favorites", { ...item, addedAt: Date.now() });
      renderProductList(body, "noGo");
      showToast("Zu Favoriten verschoben");
    });
  });
}

/**
 * Aufklappbereich für No-Go: kein 🛒 (etwas auf die Einkaufsliste zu setzen, das man meidet,
 * wäre widersprüchlich), stattdessen "Zu Favoriten" als Weg zurück, falls sich die Einschätzung
 * ändert — plus eine Zeile, die die Portionsrechnung nennt, damit nachvollziehbar bleibt,
 * warum es ein No-Go ist.
 */
function noGoDetailHtml(item, nutri) {
  const profile = Store.getActiveProfile();
  const targets = getTargetsForDate(profile, dateKeyOf(Date.now()));
  const product = getProductOffline(item.barcode);
  const grams = product ? parseServingGrams(product.servingSize) : null;
  let portionHint = "";
  if (nutri?.netCarbs != null && grams) {
    const perServing = round1(nutri.netCarbs * grams / 100);
    portionHint = perServing > targets.netCarbG
      ? `<p class="hint">Eine Portion (${grams} g) wäre ${perServing} g Netto-KH — mehr als dein Tageslimit (${targets.netCarbG} g).</p>`
      : `<p class="hint">Eine Portion (${grams} g) wäre ${perServing} g Netto-KH.</p>`;
  }
  return `
    <div class="list-detail" hidden>
      <div class="kachel-kompakt">${nutriTilesHtml(nutri)}</div>
      ${nutri ? "" : `<p class="hint">Zu diesem Produkt liegen auf diesem Gerät keine Werte vor.</p>`}
      ${portionHint}
      <div class="zeilen-aktionen">
        <button class="btn" data-action="toFavorites">${ikon("stern", { groesse: 17 })} Favorit</button>
        <button class="btn secondary" data-action="edit">${ikon("bearbeiten", { groesse: 17 })} Werte</button>
        <button class="btn secondary warm" data-action="remove">${ikon("loeschen", { groesse: 17 })} Entfernen</button>
      </div>
    </div>
  `;
}

/** Klappt die Nährwertkacheln einer Zeile auf/zu — immer nur eine gleichzeitig. */
function toggleDetail(entry) {
  const detail = entry.querySelector(".list-detail");
  const open = detail.hidden;
  entry.parentElement.querySelectorAll(".list-entry.open").forEach(other => {
    if (other === entry) return;
    other.classList.remove("open");
    other.querySelector(".list-detail").hidden = true;
  });
  detail.hidden = !open;
  entry.classList.toggle("open", open);
}

/**
 * Die vier Kennwerte einer Zeile. Bevorzugt der beim Anlegen gespeicherte Schnappschuss;
 * bei Bestandseinträgen wird er einmalig aus dem nachgefüllt, was das Gerät ohnehin hat, und
 * dann mitgespeichert — so wandert er beim nächsten Abgleich auf das andere Handy mit.
 */
function nutriOf(item, listName) {
  // Ein Schnappschuss, in dem *alle* Werte null sind, entsteht beim Merken eines damals noch
  // unbekannten Produkts. Er ist so gut wie keiner — würde er hier als vorhanden durchgehen,
  // bliebe der Eintrag für immer grau, auch nachdem die Werte längst nachgetragen wurden.
  if (item.nutri100 && Object.values(item.nutri100).some(v => v != null)) return item.nutri100;
  const product = getProductOffline(item.barcode);
  if (!product) return null;
  const snapshot = nutriSnapshot(product);
  if (listName === "favorites" || listName === "noGo") {
    // Mit den Werten auch die Ampel nachziehen: sie stammt vom Zeitpunkt des Merkens und
    // stünde sonst weiter auf grau, obwohl die Kacheln daneben echte Werte zeigen.
    const grade = ketoGrade(snapshot.netCarbs, Store.getActiveProfile().gradeThresholds,
      parseServingGrams(product.servingSize));
    item.grade = grade;
    // backfillListEntry statt updateListEntry: hier wird nur nachgetragen, was ohnehin auf
    // diesem Gerät liegt — das ist keine Änderung des Menschen. Mit einem frischen updatedAt
    // würde schon das bloße Öffnen der Liste diese Fassung zur "neueren" machen und beim
    // nächsten Abgleich eine echte Korrektur vom anderen Handy überschreiben.
    Store.backfillListEntry(listName, item.barcode, { nutri100: snapshot, grade });
  }
  return snapshot;
}

/**
 * Die Ampel eines Listeneintrags: aus den Nährwerten und der Portionsgröße des Produkts.
 * Ohne Portionsgröße bleibt es bei der Bewertung je 100 g (siehe ketoGrade).
 */
function ampelFuer(barcode, nutri) {
  if (!nutri || nutri.netCarbs == null) return "gray";
  const product = getProductOffline(barcode);
  return ketoGrade(nutri.netCarbs, Store.getActiveProfile().gradeThresholds,
    product ? parseServingGrams(product.servingSize) : null);
}

/**
 * Eine Zeile, die sagt, worauf sich der Punkt bezieht — sonst ist nicht zu sehen, ob Grün für
 * 100 g oder für eine Portion gilt, und die Kacheln daneben tragen „je 100 g".
 */
function portionsZeile(barcode, nutri) {
  const product = getProductOffline(barcode);
  const servingG = product ? parseServingGrams(product.servingSize) : null;
  if (!servingG || !nutri || nutri.netCarbs == null) {
    return `<p class="hint">Keine Portionsgröße hinterlegt — die Ampel bewertet je 100 g. Beim Eintragen lässt sie sich festlegen.</p>`;
  }
  const jePortion = Math.round((nutri.netCarbs * servingG / 100) * 10) / 10;
  return `<p class="hint">Eine Portion (${servingG} g): ${jePortion} g Netto-KH — darauf bezieht sich der Punkt.</p>`;
}

/** Aufklappbereich einer Listenzeile: Kacheln, optionale Zusatzzeile, Aktionen. */
function detailHtml(nutri, extraHint = "", { showRemove = true } = {}) {
  return `
    <div class="list-detail" hidden>
      <div class="kachel-kompakt">${nutriTilesHtml(nutri)}</div>
      ${nutri ? "" : `<p class="hint">Zu diesem Produkt liegen auf diesem Gerät keine Werte vor — sie kommen beim nächsten Scan dazu.</p>`}
      ${extraHint}
      <div class="zeilen-aktionen${showRemove ? "" : " ohne-entfernen"}">
        <button class="btn" data-action="eat">${ikon("essen", { groesse: 17 })} Eintragen</button>
        <button class="btn secondary" data-action="edit">${ikon("bearbeiten", { groesse: 17 })} Werte</button>
        ${showRemove ? `<button class="btn secondary warm" data-action="remove">${ikon("loeschen", { groesse: 17 })} Entfernen</button>` : ""}
      </div>
    </div>
  `;
}

/** Produkt zu einem Barcode holen: erst offline, sonst über das Netz. */
async function resolveProduct(barcode) {
  const offline = getProductOffline(barcode);
  if (offline) return offline;
  try {
    return await lookupProduct(barcode);
  } catch {
    showToast("Produkt nicht verfügbar (offline?)");
    return null;
  }
}

/** Nach einer Wertekorrektur: Ampelfarbe und Kennwerte in allen Listen nachziehen. */
function applyCorrectionToLists(product) {
  const snapshot = nutriSnapshot(product);
  const grade = ketoGrade(snapshot.netCarbs, Store.getActiveProfile().gradeThresholds,
    parseServingGrams(product.servingSize));
  for (const listName of ["favorites", "noGo"]) {
    Store.updateListEntry(listName, product.barcode, {
      name: product.name,
      brand: product.brand,
      netCarbs100: snapshot.netCarbs,
      grade,
      nutri100: snapshot,
    });
  }
}

function renderShopping(body) {
  // Das Eingabefeld wird EINMAL gezeichnet und danach nicht mehr angefasst. Vorher zeichnete
  // jedes Hinzufügen den ganzen Reiter neu — das Feld war ein neues Element, der Fokus weg und
  // am Handy klappte die Tastatur zu. Wer eine Einkaufsliste schreibt, tippt aber mehrere
  // Sachen hintereinander: Wort, Enter, Wort, Enter. Nur die Liste darunter wird neu gezeichnet.
  body.innerHTML = `
    <form id="addItemForm" class="listen-eingabe">
      <div class="such-feld">${ikon("neu", { groesse: 17 })}
        <input type="text" id="newItemText" placeholder="Artikel hinzufügen …" aria-label="Artikel auf die Einkaufsliste setzen"
          autocomplete="off" enterkeyhint="done"></div>
      <button class="btn" type="submit" title="Auf die Liste setzen" aria-label="Auf die Liste setzen">${ikon("einkauf", { groesse: 18 })}</button>
    </form>
    <div id="shopList"></div>
  `;

  const input = body.querySelector("#newItemText");
  body.querySelector("#addItemForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    Store.addShoppingItem(text);
    input.value = "";
    input.focus(); // Tastatur bleibt offen, der nächste Artikel kann direkt getippt werden.
    renderShoppingList(body);
  });

  renderShoppingList(body);
}

/** Nur die Liste unter dem Eingabefeld — das Feld selbst bleibt stehen (siehe renderShopping). */
function renderShoppingList(body) {
  const el = body.querySelector("#shopList");
  const items = Store.get().shoppingList;

  // Offen zuerst, Erledigtes gesammelt darunter — beim Einkaufen zählt, was noch fehlt.
  const open = items.filter(i => !i.checked);
  const done = items.filter(i => i.checked);
  // Dieselbe Karte, dieselbe Zeile wie in Favoriten, No-Go und Verlauf: eine `.klar-list-card`
  // mit `.list-item`-Zeilen darin. Der Haken tritt hier nur an die Stelle, an der sonst die
  // Ampel steht.
  const group = (title, list) => list.length === 0 ? "" : `
    <div class="klar-eyebrow gruppen-titel">${title} · ${list.length}</div>
    <div class="klar-list-card">
      ${list.map(item => `
        <label class="list-item einkauf-zeile ${item.checked ? "checked" : ""}" data-id="${item.id}">
          <input type="checkbox" ${item.checked ? "checked" : ""} hidden>
          <span class="klar-check ${item.checked ? "on" : ""}">${item.checked ? "✓" : ""}</span>
          <div class="info"><div class="name" title="${esc(item.text)}">${esc(item.text)}</div></div>
          <button class="icon-btn" data-action="remove" title="Entfernen" aria-label="Entfernen">${ikon("loeschen", { groesse: 19 })}</button>
        </label>
      `).join("")}
    </div>
  `;

  el.innerHTML = (items.length === 0
    ? emptyState("einkauf", "Einkaufsliste ist leer. Trag oben ein, was fehlt.")
    : group("Offen", open) + group("Erledigt", done))
    + (done.length ? `<button class="btn ghost" id="clearChecked" style="margin-top:14px">Erledigte entfernen</button>` : "");

  el.querySelectorAll(".einkauf-zeile").forEach(row => {
    const id = row.dataset.id;
    row.querySelector('input[type="checkbox"]').addEventListener("change", () => {
      Store.toggleShoppingItem(id);
      renderShoppingList(body);
    });
    row.querySelector('[data-action="remove"]').addEventListener("click", (e) => {
      e.preventDefault();
      Store.removeShoppingItem(id);
      renderShoppingList(body);
    });
  });

  el.querySelector("#clearChecked")?.addEventListener("click", () => {
    Store.clearCheckedShoppingItems();
    renderShoppingList(body);
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
      <div class="such-feld" style="margin-bottom:14px">${ikon("suche", { groesse: 17 })}<input type="text" id="historySearch" placeholder="Suchen …" aria-label="Im Verlauf suchen" autocomplete="off" value="${esc(historyFilter)}"></div>
      <!-- Vier einstellige Zahlen brauchen kein 2x2-Raster aus Kacheln: das nahm über
           dem ersten Eintrag mehr Platz ein als der Verlauf selbst. Eine Zeile sagt
           dasselbe, und die Ampelfarbe steht jetzt direkt beim Wort. -->
      <div class="verlauf-bilanz">
        <span><span class="klar-dot green"></span><b>${counts.green}</b> keto</span>
        <span><span class="klar-dot yellow"></span><b>${counts.yellow}</b> in Maßen</span>
        <span><span class="klar-dot red"></span><b>${counts.red}</b> nicht keto</span>
        <span class="gesamt">von <b>${periodItems.length}</b></span>
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
      ? emptyState("suche", `Kein Eintrag passt zu „${historyFilter}".`)
      : emptyState("uhr", "Noch nichts im gewählten Zeitraum gescannt oder gesucht.");
    return;
  }

  // Je Tag eine Karte mit Trennlinien statt einer Karte pro Zeile.
  const blocks = [];
  let lastLabel = null;
  let rows = [];
  const flush = () => {
    if (rows.length) blocks.push(`<div class="klar-list-card">${rows.join("")}</div>`);
    rows = [];
  };

  for (const entry of items) {
    const label = dayLabel(entry.at);
    if (label !== lastLabel) {
      flush();
      blocks.push(`<div class="klar-eyebrow gruppen-titel">${esc(label)}</div>`);
      lastLabel = label;
    }
    const time = new Date(entry.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    // Verlaufseinträge werden nicht nachträglich befüllt (es sind viele) — nur angezeigt.
    // Verlaufseinträge tragen selbst nur die Netto-KH je 100 g; ein voller Schnappschuss
    // entsteht nur, wenn das Produkt noch im Cache liegt. Der Teilwert ist besser als
    // leere Kacheln — die Zeile zeigte bisher gar keine Nährwerte, und in genau dieser
    // Liste ist „war das keto?" die Frage.
    const nutri = nutriOf(entry, null)
      || (entry.netCarbs100 != null ? { netCarbs: entry.netCarbs100 } : null);
    const meta = [time, entry.brand || ""].filter(Boolean).join(" · ");
    const isFav = Store.isInList("favorites", entry.barcode);
    // Wie in den Listen: die Ampel wird gerechnet, damit der Punkt überall dasselbe meint.
    // Ohne bekannte Werte bleibt die Bewertung von damals stehen — besser als grau.
    const grade = nutri ? ampelFuer(entry.barcode, nutri) : (entry.grade || "gray");
    rows.push(`
      <div class="list-entry" data-barcode="${esc(entry.barcode)}">
        <div class="list-item" style="cursor:pointer">
          ${gradeDotHtml(grade)}
          <div class="info">
            <div class="name">${esc(entry.name)}</div>
            <div class="meta">${esc(meta)}</div>
          </div>
          <button class="icon-btn" data-action="cart" title="Auf Einkaufsliste" aria-label="Auf Einkaufsliste">${ikon("einkauf", { groesse: 19 })}</button>
          <button class="icon-btn star ${isFav ? "on" : ""}" data-action="fav"
            title="${isFav ? "Favorit entfernen" : "Als Favorit merken"}"
            aria-pressed="${isFav}">${isFav ? "★" : "☆"}</button>
        </div>
        ${detailHtml(nutri, `<p class="hint">${esc(entry.brand || "")}${entry.brand ? " · " : ""}gesucht von ${esc(entry.profileName)}</p>`, { showRemove: false })}
      </div>
    `);
  }
  flush();
  el.innerHTML = blocks.join("");

  el.querySelectorAll(".list-entry").forEach(entry => {
    const barcode = entry.dataset.barcode;
    entry.querySelector(".list-item").addEventListener("click", () => toggleDetail(entry));
    entry.querySelector('[data-action="fav"]').addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavoriteFromHistory(barcode);
      renderHistoryList(el, items);
    });
    // Derselbe Weg wie in der Favoritenliste: der Verlauf trägt den Namen bereits, es braucht
    // also weder Netz noch Nachschlagen. stopPropagation, weil die Zeile selbst die
    // Nährwerte aufklappt.
    entry.querySelector('[data-action="cart"]').addEventListener("click", (e) => {
      e.stopPropagation();
      const eintrag = Store.getHistory().find(h => h.barcode === barcode);
      if (!eintrag) return;
      Store.addShoppingItem(eintrag.name, barcode);
      showToast("Auf Einkaufsliste gesetzt");
    });
    entry.querySelector('[data-action="eat"]').addEventListener("click", async () => {
      const product = await resolveProduct(barcode);
      if (product) openQuantityModal(product);
    });
    entry.querySelector('[data-action="edit"]').addEventListener("click", async () => {
      const product = await resolveProduct(barcode);
      if (!product) return;
      openProductEditor(product, (saved) => {
        applyCorrectionToLists(saved);
        renderHistoryList(el, items);
      });
    });
  });
}

/**
 * Stern in einer Verlaufszeile: macht den Eintrag zum Favoriten oder nimmt ihn wieder heraus.
 * Der Verlauf trägt Name, Ampel und Kennwerte bereits, es braucht also weder Netz noch Scan.
 */
function toggleFavoriteFromHistory(barcode) {
  if (Store.isInList("favorites", barcode)) {
    Store.removeFromList("favorites", barcode);
    showToast("Aus den Favoriten entfernt");
    return;
  }
  const entry = Store.getHistory().find(e => e.barcode === barcode);
  if (!entry) return;
  Store.addToList("favorites", {
    barcode: entry.barcode,
    name: entry.name,
    brand: entry.brand,
    addedAt: Date.now(),
    netCarbs100: entry.netCarbs100,
    grade: entry.grade,
    nutri100: nutriOf(entry, null),
  });
  showToast("Zu Favoriten hinzugefügt");
}

/** 30-Tage-Auswertung: Tag-für-Tag-Verlauf, Durchschnitte, Zielquote, längste Serie. */
/**
 * Auswertung als eigene Seite (Design "Klar") statt als Registerkarte unter "Listen" —
 * erreichbar über den Knopf in der Nährwertkarte auf Start. Nutzt denselben Renderer wie
 * der klassische Reiter, nur mit eigener Kopfzeile samt Zurück-Knopf.
 */
export function renderEvaluationPage(container, goToTab) {
  container.innerHTML = `
    <div class="klar-page-head">
      <button type="button" class="klar-back-btn" id="evalBack" aria-label="Zurück">‹</button>
      <span class="klar-page-title">Auswertung</span>
    </div>
    <div id="listBody"></div>
  `;
  container.querySelector("#evalBack").addEventListener("click", () => goToTab("start"));
  renderEvaluation(container.querySelector("#listBody"), goToTab);
}

function renderEvaluation(body, goToTab) {
  const profile = Store.getActiveProfile();

  const days = [];
  const heute = dateKeyOf(Date.now());
  for (let i = 29; i >= 0; i--) {
    const key = shiftDateKey(heute, -i);
    const entries = getConsumptionForDate(profile.id, key);
    // Jeder Tag wird gegen die Zielwerte bewertet, die an diesem Tag galten.
    days.push({
      key,
      hasEntries: entries.length > 0,
      // Vorgemerkte Mahlzeiten zählen in den Summen mit (siehe planer.js). In einer
      // Auswertung, die zurückblickt, muss das dabeistehen — sonst liest sich ein Tag, an
      // dem man den Plan nicht bestätigt hat, wie ein gegessener.
      geplant: entries.filter(e => e.planned).length,
      totals: sumConsumption(entries),
      targets: getTargetsForDate(profile, key),
    });
  }

  const withData = days.filter(d => d.hasEntries);
  const avg = (field) => withData.length
    ? round1(withData.reduce((s, d) => s + d.totals[field], 0) / withData.length)
    : null;
  const daysInTarget = withData.filter(d => d.totals.netCarbs <= d.targets.netCarbG).length;

  let streak = 0, maxStreak = 0;
  for (const d of days) {
    if (d.hasEntries && d.totals.netCarbs <= d.targets.netCarbG) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }

  // Die Frage der Seite ist "halte ich mein Limit?" — die Quote steht deshalb groß voran,
  // die Serie als Pille daneben, statt vier gleich große Kacheln nebeneinanderzustellen.
  body.innerHTML = `
    <div class="klar-card" style="margin-bottom:14px">
      <div class="klar-card-head">
        <span class="klar-eyebrow">30 Tage · Im Netto-KH-Ziel</span>
        ${maxStreak > 0 ? `<span class="klar-pill-btn" style="color:var(--warm)">Serie ${maxStreak} ${maxStreak === 1 ? "Tag" : "Tage"}</span>` : ""}
      </div>
      <div class="klar-result-main" style="margin-top:2px">
        <span class="klar-result-value">${daysInTarget}</span>
        <span class="klar-result-unit">von ${withData.length} Tagen mit Einträgen</span>
      </div>
      ${withData.length > 0 ? `
        <div class="klar-day-strip">
          ${days.map(d => {
            const cls = !d.hasEntries ? "empty" : d.totals.netCarbs <= d.targets.netCarbG ? "ok" : "over";
            return `<span class="klar-day-strip-bar ${cls}"></span>`;
          }).join("")}
        </div>
        <div class="klar-day-strip-labels"><span>vor 30 Tagen</span><span>heute</span></div>
        <div class="klar-tile-grid" style="margin-top:16px">
          <div class="klar-tile"><div class="val">${avg("kcal") ?? "–"}</div><div class="lbl">kcal</div></div>
          <div class="klar-tile"><div class="val">${avg("netCarbs") ?? "–"}</div><div class="lbl">g Netto-KH</div></div>
          <div class="klar-tile"><div class="val">${avg("fat") ?? "–"}</div><div class="lbl">g Fett</div></div>
          <div class="klar-tile"><div class="val">${avg("protein") ?? "–"}</div><div class="lbl">g Eiweiß</div></div>
        </div>
        <div class="klar-tile-unit">Ø pro Tag</div>
      ` : `<p class="hint" style="text-align:center;margin:14px 0 0">Noch keine Einträge in den letzten 30 Tagen.</p>`}
    </div>
    ${trendChartHtml(days)}
    ${gewichtKarteHtml(profile)}
    <button class="klar-pill-btn" id="analyzeBtn" style="margin-bottom:14px">${ikon("ki", { groesse: 17 })} Mit Claude analysieren</button>
    <div class="klar-eyebrow" style="margin:0 2px 8px">Tage einzeln</div>
    <div id="evalDays"></div>
  `;

  body.querySelector("#analyzeBtn").addEventListener("click", openAnalysisModal);
  body.querySelector("#gewichtEintragenBtn")?.addEventListener("click", () => {
    openGewichtModal(dateKeyOf(Date.now()), () => renderEvaluation(body, goToTab));
  });

  const daysEl = body.querySelector("#evalDays");
  daysEl.innerHTML = `<div class="klar-list-card">${[...days].reverse().map(evalDayRowHtml).join("")}</div>`;

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
/**
 * Gewichtsverlauf über denselben Zeitraum wie der Rest der Auswertung.
 *
 * Gezeigt werden die Messpunkte UND die Ausgleichsgerade. Nur die Punkte zu verbinden wäre
 * irreführend — zwischen zwei Morgen liegen ein bis zwei Kilo Wasser, und die Zacken sehen
 * nach Auf und Ab aus, wo in Wirklichkeit eine ruhige Linie liegt. Nur die Gerade zu zeigen
 * wäre die andere Hälfte derselben Lüge: dann sähe niemand mehr, wie dünn die Datenlage ist.
 *
 * Die Gerade wird erst gezeichnet, wenn sie etwas heißt (siehe gewicht.js).
 */
function gewichtKarteHtml(profile) {
  const TAGE = 30;
  const bericht = gewichtsBericht(profile, { tage: TAGE });
  const punkte = bericht.fenster;

  const kopf = `
    <div class="klar-card-head">
      <span class="klar-eyebrow">${TAGE} Tage · Gewicht</span>
      <button type="button" class="klar-pill-btn" id="gewichtEintragenBtn">${ikon("wiegen", { groesse: 17 })} Eintragen</button>
    </div>`;

  if (punkte.length === 0) {
    return `
      <div class="klar-card" style="margin-bottom:14px">
        ${kopf}
        <p class="hint" style="text-align:center;margin:14px 0 0">
          Noch kein Gewicht eingetragen. Ohne Messungen lässt sich nicht sagen, ob das
          eingestellte Defizit wirkt — die Ringe zeigen nur, was gerechnet wurde.
        </p>
      </div>`;
  }

  const letzter = punkte.at(-1);
  const W = 640, H = 140, PAD = 12;
  const heuteNr = tagesnummer(dateKeyOf(Date.now()));
  const startNr = heuteNr - (TAGE - 1);

  // Mindestens ein Kilo Spannweite, sonst bläst der Maßstab ein paar hundert Gramm
  // Tagesrauschen zu einem dramatischen Gebirge auf.
  const werte = punkte.map(p => p.kg);
  const mitte = (Math.max(...werte) + Math.min(...werte)) / 2;
  const spanne = Math.max(Math.max(...werte) - Math.min(...werte), 1);
  const oben = mitte + spanne * 0.75;
  const unten = mitte - spanne * 0.75;

  const x = (dateKey) => PAD + ((tagesnummer(dateKey) - startNr) / (TAGE - 1)) * (W - PAD * 2);
  const y = (kg) => H - PAD - ((kg - unten) / (oben - unten)) * (H - PAD * 2);

  // Eine Lücke von mehr als einer Woche wird nicht überbrückt: eine gerade Linie über drei
  // wochenlose Wochen behauptet einen Verlauf, den niemand gemessen hat.
  const abschnitte = [];
  let laufend = [];
  punkte.forEach((p, i) => {
    const vorher = punkte[i - 1];
    if (vorher && tagesnummer(p.dateKey) - tagesnummer(vorher.dateKey) > 7) {
      abschnitte.push(laufend);
      laufend = [];
    }
    laufend.push(`${x(p.dateKey).toFixed(1)},${y(p.kg).toFixed(1)}`);
  });
  if (laufend.length) abschnitte.push(laufend);

  let gerade = "";
  if (bericht.genugDaten) {
    const steigungProTag = kgProWoche(punkte) / 7;
    const mx = punkte.reduce((sum, p) => sum + tagesnummer(p.dateKey), 0) / punkte.length;
    const my = werte.reduce((sum, v) => sum + v, 0) / punkte.length;
    const bei = (nr) => my + steigungProTag * (nr - mx);
    const vonNr = tagesnummer(punkte[0].dateKey);
    const bisNr = tagesnummer(letzter.dateKey);
    gerade = `<line x1="${x(punkte[0].dateKey).toFixed(1)}" y1="${y(bei(vonNr)).toFixed(1)}"
                    x2="${x(letzter.dateKey).toFixed(1)}" y2="${y(bei(bisNr)).toFixed(1)}"
                    class="gewicht-chart-trend"></line>`;
  }

  const zielSatz = zielAbgleichSatz(profile, bericht);
  const zahl = (v) => round1(v);
  const kf = letzter.bodyFatPct != null ? ` · ${zahl(letzter.bodyFatPct)} % Körperfett` : "";

  return `
    <div class="klar-card" style="margin-bottom:14px">
      ${kopf}
      <div class="klar-result-main" style="margin-top:2px">
        <span class="klar-result-value">${zahl(letzter.kg)}</span>
        <span class="klar-result-unit">kg${esc(kf)}</span>
      </div>
      <p class="hint" style="margin-top:2px">${esc(trendSatz(bericht))}${zielSatz ? ` ${esc(zielSatz)}` : ""}</p>
      <svg viewBox="0 0 ${W} ${H}" class="trend-svg" preserveAspectRatio="none" style="width:100%;height:120px">
        ${gerade}
        ${abschnitte.filter(a => a.length > 1).map(a => `<polyline points="${a.join(" ")}" class="gewicht-chart-line"></polyline>`).join("")}
        ${punkte.map(p => `<circle cx="${x(p.dateKey).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="3" class="gewicht-chart-dot"></circle>`).join("")}
      </svg>
      <div class="gewicht-chart-labels">
        <span>Maßstab ${zahl(unten)}–${zahl(oben)} kg</span>
        <span>${punkte.length} ${punkte.length === 1 ? "Messung" : "Messungen"}</span>
      </div>
    </div>
  `;
}

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
    <div class="klar-card" style="margin-bottom:14px">
      <div class="klar-card-head">
        <span class="klar-eyebrow">Netto-KH-Verlauf</span>
        <span class="klar-pill-btn">Ziel ${todayTarget} g</span>
      </div>
      <p class="hint" style="margin-top:0">Frühere Tage können ein anderes Ziel gehabt haben — Punkte in Terrakotta lagen über ihrem jeweiligen Ziel.</p>
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
        <span class="meta">${round1(d.totals.netCarbs)} / ${targets.netCarbG} g</span>
      </div>
      <div class="progress-track" style="height:6px">
        <div class="progress-fill ${over ? "over" : ""}" style="width:${pct}%"></div>
      </div>
      <div class="meta">${round1(d.totals.kcal)} kcal · F ${round1(d.totals.fat)} · E ${round1(d.totals.protein)}${d.geplant ? ` · ${d.geplant}× geplant` : ""}</div>
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

/** Leerer Zustand. `name` ist ein Ikonenname aus ikonen.js — größer gezeichnet als sonst,
 * weil hier nichts anderes auf der Fläche steht. */
function emptyState(name, text) {
  return `<div class="empty-state"><span class="emoji">${ikon(name, { groesse: 34 })}</span>${esc(text)}</div>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
