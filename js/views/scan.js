// views/scan.js — Scan-Tab: Kamera, Ergebniskarte, manuelle Eingabe, "Produkt selbst anlegen".
import { Store } from "../store.js";
import { getTargetsForDate } from "../profiles.js";
import { lookupProduct, searchProductsByName, searchOwnProducts, newOwnBarcode, nutriSnapshot } from "../off.js";
import { hatZugang, pruefeBeitrag, vorschau, sendeBeitrag, produktUrl, REGISTRIER_URL } from "../off-beitrag.js";
import { ownProductFormHtml, wireOwnProductForm } from "../product-editor.js";
import { searchLocalFoods } from "../foods-db.js";
import { evaluateProduct, GRADE_LABEL } from "../keto.js";
import { startScanner, stopScanner, isScannerSupported } from "../scanner.js";
import {
  openQuantityModal, suggestMeal, mealShort,
  getActiveDateKey, getConsumptionForDate, sumConsumption,
} from "../consumption.js";
import { showToast, esc, nutriTilesHtml, gradeDotHtml, bindBackClose } from "../ui.js";

function round1(v) {
  return v == null ? null : Math.round(v * 10) / 10;
}

let currentBarcode = null;

export function renderScan(container) {
  stopScanner();
  currentBarcode = null;

  if (!isScannerSupported()) {
    container.innerHTML = manualOnlyMarkup("Kamera wird von diesem Browser nicht unterstützt.");
    wireManualForm(container);
    wireSearchToggle(container);
    return;
  }

  container.innerHTML = `
    <h1 class="section-title">Scannen</h1>
    <div id="scanArea"></div>
    <div id="scanToggles">
      <button class="btn secondary" id="manualToggle">🔢 Barcode manuell eingeben</button>
      <button class="btn secondary" id="searchToggle" style="margin-top:8px">🔎 Lebensmittel ohne Barcode suchen</button>
    </div>
    <div id="manualFormWrap" style="display:none;margin-top:12px"></div>
    <div id="searchFormWrap" style="display:none;margin-top:12px"></div>
    <div id="resultWrap"></div>
  `;

  container.querySelector("#manualToggle").addEventListener("click", () => {
    const wrap = container.querySelector("#manualFormWrap");
    const show = wrap.style.display === "none";
    wrap.style.display = show ? "block" : "none";
    if (show) {
      wrap.innerHTML = manualFormHtml();
      wireManualForm(container);
    }
  });

  wireSearchToggle(container);
  startCameraView(container);
}

/**
 * Baut die Kameraansicht auf und startet den Scanner. Eigene Funktion, damit "Erneut scannen"
 * (nach einem Treffer, siehe collapseScanArea) dieselbe Ansicht erneut aufbauen kann, ohne die
 * ganze Seite (inkl. Suchfeld, Ergebnis) neu zu rendern.
 */
function startCameraView(container) {
  const area = container.querySelector("#scanArea");
  if (!area) return;
  area.innerHTML = `
    <div class="scan-wrap">
      <video id="scanVideo" playsinline muted></video>
      <div class="scan-frame"></div>
      <div class="scan-status" id="scanStatus">Kamera wird gestartet …</div>
    </div>
  `;
  container.querySelector("#scanToggles").style.display = "";

  const video = area.querySelector("#scanVideo");
  const statusEl = area.querySelector("#scanStatus");

  startScanner(
    video,
    (barcode) => handleBarcode(container, barcode),
    (status) => { if (statusEl) statusEl.textContent = status; }
  ).catch(err => {
    console.error("Scanner konnte nicht gestartet werden:", err);
    statusEl.textContent = "Kamerazugriff fehlgeschlagen. Bitte Berechtigung erlauben oder manuell eingeben.";
  });
}

/**
 * Die Kamera hat ihre Aufgabe erfüllt, sobald ein Barcode erkannt ist — sie bräuchte sonst
 * weiter ein Drittel des Bildschirms und drückt die Ergebniskarte unter die Falz. Ersetzt die
 * Kameraansicht durch eine schmale Bestätigungszeile mit dem erkannten Code; "Erneut scannen"
 * baut die Kamera über startCameraView() wieder auf. Manuelle Eingabe/Namenssuche verstecken
 * sich mit, solange ein Ergebnis dasteht — sie sind Alternativen zum Scannen, keine Ergänzung.
 */
function collapseScanArea(container, barcode) {
  stopScanner();
  const area = container.querySelector("#scanArea");
  if (!area) return;
  area.innerHTML = `
    <div class="klar-scan-confirm">
      <span class="klar-scan-confirm-check">✓</span>
      <span class="klar-scan-confirm-code">Barcode erkannt · ${esc(barcode)}</span>
      <button type="button" class="klar-pill-btn" id="rescanBtn">Erneut scannen</button>
    </div>
  `;
  const toggles = container.querySelector("#scanToggles");
  if (toggles) toggles.style.display = "none";
  container.querySelector("#manualFormWrap").style.display = "none";
  container.querySelector("#searchFormWrap").style.display = "none";
  area.querySelector("#rescanBtn").addEventListener("click", () => {
    container.querySelector("#resultWrap").innerHTML = "";
    startCameraView(container);
  });
}

export function cleanupScan() {
  stopScanner();
}

function manualOnlyMarkup(message) {
  return `
    <h1 class="section-title">Scannen</h1>
    <div class="card"><p>${esc(message)}</p></div>
    <div id="manualFormWrap">${manualFormHtml()}</div>
    <button class="btn secondary" id="searchToggle">🔎 Lebensmittel ohne Barcode suchen</button>
    <div id="searchFormWrap" style="display:none;margin-top:12px"></div>
    <div id="resultWrap"></div>
  `;
}

function wireSearchToggle(container) {
  container.querySelector("#searchToggle").addEventListener("click", () => {
    const wrap = container.querySelector("#searchFormWrap");
    if (wrap.style.display === "none") openScanSearch(container);
    else wrap.style.display = "none";
  });
}

/** Klappt die Namenssuche auf und fokussiert sie — auch von außen aufrufbar, damit der
 * „🔎 Suchen"-Weg im Klar-Eintragen-Sheet direkt dort landet statt nur im Scan-Tab. */
export function openScanSearch(container) {
  const wrap = container.querySelector("#searchFormWrap");
  if (!wrap) return;
  wrap.style.display = "block";
  wrap.innerHTML = searchFormHtml();
  wireSearchForm(container);
  wrap.querySelector("#foodSearchInput").focus();
}

function searchFormHtml() {
  return `
    <div class="card">
      <label for="foodSearchInput">Lebensmittel suchen (ohne Barcode)</label>
      <input type="text" id="foodSearchInput" placeholder="z.B. Eier, Gouda, Avocado …" autocomplete="off">
      <div id="searchResults" style="margin-top:10px"></div>
    </div>
  `;
}

function wireSearchForm(container) {
  const input = container.querySelector("#foodSearchInput");
  const resultsEl = container.querySelector("#searchResults");
  if (!input) return;

  let debounceTimer = null;
  let requestSeq = 0;

  const runSearch = async () => {
    const term = input.value.trim();
    const seq = ++requestSeq;
    if (term.length < 2) {
      resultsEl.innerHTML = "";
      return;
    }

    // Eigene Produkte zuerst (sofort verfügbar, kein Netz nötig), dann Grundnahrungsmittel.
    const own = searchOwnProducts(term);
    const local = searchLocalFoods(term).filter(p => !own.some(o => o.name.toLowerCase() === p.name.toLowerCase()));
    const offline = [...own, ...local];
    renderSearchResults(container, resultsEl, offline, false, term);

    const { produkte: online, fehler } = await searchProductsByName(term);
    if (seq !== requestSeq) return; // Nutzer hat weitergetippt, veraltete Antwort verwerfen
    // Nicht nur nach Namen entdoppeln: zwei verschiedene Produkte heißen oft gleich
    // („Schlagsahne"), und dann verschwand der zweite. Der Barcode entscheidet, der Name
    // nur gegen die eigenen und die eingebauten Einträge.
    const bekannteNamen = new Set(offline.map(p => p.name.toLowerCase()));
    const bekannteCodes = new Set(offline.map(p => p.barcode));
    const gesehen = new Set();
    const neue = online.filter(p => {
      if (bekannteCodes.has(p.barcode) || gesehen.has(p.barcode)) return false;
      gesehen.add(p.barcode);
      return !bekannteNamen.has(p.name.toLowerCase());
    });
    renderSearchResults(container, resultsEl, [...offline, ...neue], true, term, fehler);
  };

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 350);
  });
}

const SOURCE_ICON = { local: "🥑", own: "📝" };
const SOURCE_LABEL = { local: "Grundnahrungsmittel", own: "Eigenes Produkt" };

function renderSearchResults(container, resultsEl, items, isFinal, term, fehler = null) {
  // „Konnte nicht nachsehen" ist etwas anderes als „gibt es nicht" — und weil die alte
  // Schnittstelle meistens abwies, stand hier dauernd fälschlich „keine Treffer".
  const fehlerZeile = fehler
    ? `<p class="hint" style="color:var(--red-fg)">Open Food Facts antwortet gerade nicht — angezeigt wird, was auf diesem Gerät liegt.</p>`
    : "";

  if (items.length === 0) {
    resultsEl.innerHTML = isFinal
      ? `
        ${fehlerZeile}
        <p class="hint">Keine Treffer für „${esc(term)}".</p>
        <button class="btn secondary" id="addOwnFromSearchBtn" style="margin-top:6px">➕ „${esc(term)}" als eigenes Produkt anlegen</button>
      `
      : `<p class="hint">Suche …</p>`;
    resultsEl.querySelector("#addOwnFromSearchBtn")?.addEventListener("click", () => {
      startOwnProductFromSearch(container, term);
    });
    return;
  }

  // Name oben, Marke darunter. Bewusst keine Nährwerte in der Zeile: die Liste ist zum
  // Wiedererkennen da, und „Schlagsahne 292 kcal" neben „Schlagsahne 293 kcal" hilft beim
  // Wiedererkennen nicht — der Name und die Marke tun es.
  resultsEl.innerHTML = fehlerZeile + items.map((p, i) => `
    <div class="list-item" data-idx="${i}" style="cursor:pointer">
      <span style="flex-shrink:0">${SOURCE_ICON[p.source] || "🏷️"}</span>
      <div class="info">
        <div class="name">${esc(p.name)}</div>
        <div class="meta">${p.brand ? esc(p.brand) : SOURCE_LABEL[p.source] || "Open Food Facts"}</div>
      </div>
    </div>
  `).join("") + (!isFinal ? `<p class="hint">Suche weitere Online-Treffer …</p>` : "");

  resultsEl.querySelectorAll(".list-item").forEach(row => {
    row.addEventListener("click", () => {
      const item = items[Number(row.dataset.idx)];
      handleSearchSelect(container, item);
    });
  });
}

/** Öffnet das "Neues Produkt"-Formular direkt aus einer erfolglosen Namenssuche heraus, mit
 * dem Suchbegriff als Namensvorschlag — ohne den Umweg über einen frei erfundenen Barcode. */
function startOwnProductFromSearch(container, term) {
  const searchWrap = container.querySelector("#searchFormWrap");
  if (searchWrap) searchWrap.style.display = "none";
  const resultWrap = container.querySelector("#resultWrap");
  const barcode = newOwnBarcode();
  resultWrap.innerHTML = ownProductFormHtml(barcode, null, term);
  wireOwnProductForm(resultWrap, barcode, { onSaved: (product) => afterOwnProductSaved(container, product) });
  scrollToResult(container);
}

function handleSearchSelect(container, product) {
  const searchWrap = container.querySelector("#searchFormWrap");
  if (searchWrap) searchWrap.style.display = "none";

  Store.pushRecent(product.barcode);
  logHistory(product);
  renderResult(container, product);
  scrollToResult(container);
}

/**
 * Holt die Ergebniskarte in den sichtbaren Bereich, damit nach einem Treffer nicht erst
 * am Kamerabild vorbeigescrollt werden muss. Bewusst nur bei *neuen* Treffern aufgerufen,
 * nicht bei jedem Neuzeichnen (z.B. Favorit umschalten), sonst springt die Seite ständig.
 */
function scrollToResult(container) {
  const resultWrap = container.querySelector("#resultWrap");
  if (!resultWrap) return;
  requestAnimationFrame(() => {
    resultWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** Protokolliert einen Such-/Scan-Treffer im Verlauf (nur Log, keine Mengen/Kalorien). */
function logHistory(product) {
  const profile = Store.getActiveProfile();
  const targets = getTargetsForDate(profile, getActiveDateKey());
  const evalResult = evaluateProduct(product, targets);
  Store.addHistoryEntry({
    id: crypto.randomUUID(),
    barcode: product.barcode,
    name: product.name,
    brand: product.brand,
    grade: evalResult.grade,
    netCarbs100: evalResult.netCarbs100,
    nutri100: nutriSnapshot(product),
    source: product.source,
    profileName: profile.name,
    at: Date.now(),
  });
}

function manualFormHtml() {
  return `
    <div class="card">
      <label for="manualBarcode">Barcode (EAN)</label>
      <div class="btn-row">
        <input type="text" inputmode="numeric" id="manualBarcode" placeholder="z.B. 4008400290423">
        <button class="btn" id="manualSubmit" style="width:auto;padding:0 18px">Suchen</button>
      </div>
    </div>
  `;
}

function wireManualForm(container) {
  const btn = container.querySelector("#manualSubmit");
  const input = container.querySelector("#manualBarcode");
  if (!btn) return;
  const submit = () => {
    const code = input.value.trim();
    if (code) handleBarcode(container, code);
  };
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

async function handleBarcode(container, barcode) {
  currentBarcode = barcode;
  Store.pushRecent(barcode);
  collapseScanArea(container, barcode);
  const resultWrap = container.querySelector("#resultWrap");
  resultWrap.innerHTML = `<div class="card"><p class="muted">Suche Produkt …</p></div>`;

  try {
    const product = await lookupProduct(barcode);
    logHistory(product);
    renderResult(container, product);
  } catch (err) {
    if (err.notFound) {
      renderNotFound(container, barcode);
    } else if (err.offline) {
      resultWrap.innerHTML = `<div class="card"><p>📡 Offline und kein gecachtes Produkt für diesen Barcode vorhanden.</p></div>`;
    } else {
      resultWrap.innerHTML = `<div class="card"><p>⚠️ ${esc(err.message)}</p></div>`;
    }
  }
  scrollToResult(container);
}

function renderResult(container, product) {
  const profile = Store.getActiveProfile();
  const targets = getTargetsForDate(profile, getActiveDateKey());
  const fiberOverride = Store.getFiberOverride(product.barcode);
  const subtractFiber = fiberOverride !== undefined ? fiberOverride : product.likelyUsLabel;
  const evalResult = evaluateProduct(product, targets, { subtractFiber });
  const resultWrap = container.querySelector("#resultWrap");
  const hasFiber = product.per100.fiber != null && product.per100.fiber > 0;

  const isFav = Store.isInList("favorites", product.barcode);
  const isNoGo = Store.isInList("noGo", product.barcode);

  // Die Portion ist die Antwort auf die Frage, wegen der gescannt wurde — eigene Fläche in der
  // Ampelfarbe statt ein Satz zwischen den Kacheln, mit Balken und Folge fürs Restbudget.
  const portionPanel = evalResult.netCarbsServing != null ? (() => {
    const already = sumConsumption(getConsumptionForDate(profile.id, getActiveDateKey())).netCarbs;
    const afterTotal = round1(already + evalResult.netCarbsServing);
    const remainingAfter = round1(targets.netCarbG - afterTotal);
    const pct = targets.netCarbG > 0 ? Math.min((evalResult.netCarbsServing / targets.netCarbG) * 100, 100) : 0;
    const over = evalResult.pctOfDailyLimit != null && evalResult.pctOfDailyLimit > 100;
    return `
      <div class="klar-portion-panel ${evalResult.grade}">
        <div class="klar-portion-head">Eine Portion (${evalResult.servingGrams} g)</div>
        <div class="klar-portion-value">${evalResult.netCarbsServing} g<span>Netto-KH${evalResult.pctOfDailyLimit != null ? ` · ${evalResult.pctOfDailyLimit}% des Tageslimits` : ""}</span></div>
        <div class="progress-track"><div class="progress-fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>
        <div class="klar-portion-sub">${remainingAfter >= 0
          ? `Heute noch ${round1(targets.netCarbG - already)} g frei — danach ${remainingAfter} g`
          : `Heute noch ${round1(targets.netCarbG - already)} g frei — danach ${Math.abs(remainingAfter)} g darüber`}</div>
      </div>
    `;
  })() : "";

  // Hinweise nach Rang statt vier gleich grauer Absätze: Warnungen (Terrakotta) vor
  // Sachhinweisen (Grau), zusammengefasst hinter einer ausklappbaren Zeile.
  const hints = [];
  if (evalResult.plausibility) {
    hints.push({ warn: true, title: "kcal-Angabe unplausibel",
      body: `Aus KH, Fett und Eiweiß errechnen sich ca. ${evalResult.plausibility.calculatedKcal} kcal statt ${fmt(product.per100.kcal)} (${evalResult.plausibility.deviationPct}% Abweichung). Mit „✎" anpassen.` });
  }
  evalResult.warnings.forEach(w => hints.push({ warn: true, title: w, body: "" }));
  if (evalResult.sugarAlcohols) {
    hints.push({ warn: false, title: "Enthält Zuckeralkohole", body: "Wirken sich meist kaum auf den Blutzucker aus." });
  }
  if (!evalResult.fiberAvailable) {
    hints.push({ warn: false, title: "Keine Ballaststoff-Angabe verfügbar", body: "" });
  }

  const hintsHtml = hints.length ? `
    <button type="button" class="klar-hints-toggle" id="hintsToggle">
      <span>${hints.length} ${hints.length === 1 ? "Hinweis" : "Hinweise"} zu diesen Werten</span>
      <span class="chev">▾</span>
    </button>
    <div class="klar-hints" id="hintsBody" hidden>
      ${hints.map(h => `
        <div class="klar-hint-row ${h.warn ? "warn" : ""}">
          <span class="klar-hint-mark">${h.warn ? "!" : "ℹ"}</span>
          <div>
            <div class="klar-hint-title">${esc(h.title)}</div>
            ${h.body ? `<div class="klar-hint-body">${h.body}</div>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  ` : "";

  const fiberToggleHtml = hasFiber ? `
    <label class="btn-row" style="align-items:center;gap:8px;margin-top:14px;cursor:pointer">
      <input type="checkbox" id="fiberToggle" ${subtractFiber ? "checked" : ""} style="width:auto;min-height:auto;flex:none">
      <span class="hint" style="margin:0">Etikett nach US-Konvention (${fmt(product.per100.fiber)} g Ballaststoffe zählen zu den KH)</span>
    </label>
  ` : "";

  resultWrap.innerHTML = `
    <div class="klar-card" style="margin-top:14px">
      <div class="klar-card-head" style="align-items:center">
        <span class="klar-scan-grade">${gradeDotHtml(evalResult.grade)}${esc(GRADE_LABEL[evalResult.grade])}</span>
        <button type="button" class="klar-icon-btn" id="correctBtn" title="Werte korrigieren">✎</button>
      </div>
      <div class="klar-product-name">${esc(product.name)}</div>
      <div class="klar-product-meta">${esc(product.brand || "")}${product.quantity ? " · " + esc(product.quantity) : ""}</div>
      ${portionPanel}
      ${nutriTilesHtml({
        kcal: product.per100.kcal,
        netCarbs: evalResult.netCarbs100,
        fat: product.per100.fat,
        protein: product.per100.protein,
      })}
      ${hintsHtml}
      ${fiberToggleHtml}
      <button class="klar-primary-btn" id="eatBtn" style="margin-top:16px">Eintragen · ${esc(mealShort(suggestMeal()))}</button>
      ${beitragsKnopfHtml(product)}
      <div class="klar-action-row">
        <button class="klar-action-btn ${isFav ? "on" : ""}" id="favBtn">⭐ Favorit</button>
        <button class="klar-action-btn" id="cartBtn">🛒 Einkauf</button>
        <button class="klar-action-btn ${isNoGo ? "danger" : ""}" id="noGoBtn">🚫 No-Go</button>
      </div>
    </div>
  `;

  resultWrap.querySelector("#hintsToggle")?.addEventListener("click", () => {
    const body = resultWrap.querySelector("#hintsBody");
    const toggle = resultWrap.querySelector("#hintsToggle");
    body.hidden = !body.hidden;
    toggle.classList.toggle("open", !body.hidden);
  });

  wireResultActions(container, resultWrap, product, evalResult);
}

/** Knöpfe der Ergebniskarte verdrahten — auch aus dem Korrektur-Formular heraus wiederverwendet. */
function wireResultActions(container, resultWrap, product, evalResult) {
  resultWrap.querySelector("#fiberToggle")?.addEventListener("change", (e) => {
    Store.setFiberOverride(product.barcode, e.target.checked);
    renderResult(container, product);
  });
  resultWrap.querySelector("#beitragBtn")?.addEventListener("click", () => {
    openBeitragSheet(product, () => renderResult(container, product));
  });

  resultWrap.querySelector("#correctBtn").addEventListener("click", () => {
    resultWrap.innerHTML = ownProductFormHtml(product.barcode, product);
    wireOwnProductForm(resultWrap, product.barcode, {
      onSaved: (saved) => afterOwnProductSaved(container, saved),
      onCancel: () => renderResult(container, product),
    });
  });

  const entry = () => ({
    barcode: product.barcode,
    name: product.name,
    brand: product.brand,
    addedAt: Date.now(),
    netCarbs100: evalResult.netCarbs100,
    grade: evalResult.grade,
    // Vier Kennwerte mitspeichern: der Produkt-Cache wird nicht exportiert, sonst stünde die
    // Liste auf dem anderen Handy nach einem Abgleich ohne Werte da.
    nutri100: nutriSnapshot(product),
  });

  resultWrap.querySelector("#eatBtn").addEventListener("click", () => {
    openQuantityModal(product);
  });
  resultWrap.querySelector("#favBtn").addEventListener("click", () => {
    Store.addToList("favorites", entry());
    showToast("Zu Favoriten hinzugefügt");
    renderResult(container, product);
  });
  resultWrap.querySelector("#noGoBtn").addEventListener("click", () => {
    Store.addToList("noGo", entry());
    showToast("Als No-Go markiert");
    renderResult(container, product);
  });
  resultWrap.querySelector("#cartBtn").addEventListener("click", () => {
    Store.addShoppingItem(product.name, product.barcode);
    showToast("Auf Einkaufsliste gesetzt");
  });
}

function renderNotFound(container, barcode) {
  const resultWrap = container.querySelector("#resultWrap");
  resultWrap.innerHTML = `
    <div class="card">
      <p>🔍 Barcode <strong>${esc(barcode)}</strong> wurde bei Open Food Facts nicht gefunden.</p>
      <button class="btn secondary" id="addOwnBtn">➕ Produkt selbst anlegen</button>
    </div>
  `;
  resultWrap.querySelector("#addOwnBtn").addEventListener("click", () => {
    resultWrap.innerHTML = ownProductFormHtml(barcode);
    wireOwnProductForm(resultWrap, barcode, { onSaved: (product) => afterOwnProductSaved(container, product) });
  });
}

/** Nach dem Speichern eigener Werte: in den Verlauf schreiben und die Ergebniskarte zeigen. */
function afterOwnProductSaved(container, product) {
  logHistory(product);
  renderResult(container, product);
}

function fmt(v) {
  return v == null ? "–" : Math.round(v * 10) / 10;
}


// ---------------------------------------------------------------------------
// Zurückgeben an Open Food Facts
//
// Nur für selbst erfasste Produkte mit echtem Barcode: genau die sind der Fall, in dem man
// die Zahlen vom Etikett abgetippt hat, weil die Datenbank sie nicht hatte. Alles andere
// stammt ohnehin von dort.
// ---------------------------------------------------------------------------

/** Der Knopf erscheint nur, wo ein Beitrag überhaupt Sinn ergibt. */
function beitragsKnopfHtml(product) {
  if (product.source !== "own") return "";
  if (!pruefeBeitrag(product).moeglich) return "";
  return `
    <button type="button" class="klar-action-btn" id="beitragBtn" style="width:100%;margin-top:8px">
      🌍 Zu Open Food Facts beitragen
    </button>
  `;
}

/**
 * Zeigt vor dem Senden, was genau gesendet wird. Ein Beitrag ist öffentlich, dauerhaft und
 * trägt den Namen des Kontos — das gehört gesehen, nicht erahnt.
 */
function openBeitragSheet(product, onDone) {
  const overlay = document.createElement("div");
  overlay.className = "klar-sheet-overlay";
  const zeilen = vorschau(product);
  const angemeldet = hatZugang();

  overlay.innerHTML = `
    <div class="klar-sheet">
      <div class="klar-sheet-handle"></div>
      <div class="klar-sheet-title">Zu Open Food Facts beitragen</div>
      <div class="klar-sheet-sub">Das wird gesendet — öffentlich und dauerhaft, unter deinem Kontonamen.</div>

      <div class="klar-list-card" style="margin-top:12px">
        ${zeilen.map(z => `
          <div class="list-item">
            <div class="info">
              <div class="meta">${esc(z.was)}</div>
              <div class="name" style="font-size:.95rem">${esc(String(z.wert))}</div>
            </div>
          </div>
        `).join("")}
      </div>

      ${angemeldet ? "" : `
        <p class="hint" style="margin-top:14px">Dafür brauchst du ein Konto bei Open Food Facts — kostenlos, und du kannst es im Profil hinterlegen.
        <a href="${REGISTRIER_URL}" target="_blank" rel="noopener noreferrer">Konto anlegen</a></p>
      `}

      <p class="hint" id="beitragStatus" style="margin-top:10px;min-height:1.2em"></p>

      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn secondary" id="beitragAbbrechen">Abbrechen</button>
        <button type="button" class="btn" id="beitragSenden" ${angemeldet ? "" : "disabled"}>Senden</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#beitragAbbrechen").addEventListener("click", close);

  const status = overlay.querySelector("#beitragStatus");
  overlay.querySelector("#beitragSenden").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    status.textContent = "Wird gesendet …";
    try {
      const { barcode } = await sendeBeitrag(product);
      close();
      showToast("Danke — der Beitrag ist bei Open Food Facts");
      window.open(produktUrl(barcode), "_blank", "noopener");
      onDone?.();
    } catch (err) {
      e.currentTarget.disabled = false;
      status.textContent = err.message || "Der Beitrag konnte nicht gesendet werden.";
    }
  });
}
