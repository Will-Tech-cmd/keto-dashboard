// views/start.js — Startseite: Wochenstreifen, Ziel-/Verbrauchsringe, Gewicht,
// Mahlzeiten des Tages.
import { Store, dateKeyOf } from "../store.js";
import { getTargetsForDate } from "../profiles.js";
import {
  getConsumptionForDate, sumConsumption, openEditConsumptionModal,
  getActiveDateKey, shiftActiveDate, setActiveDateKey, dateLabel, MEAL_LABELS,
  bestaetigeGeplant, bestaetigeMahlzeit,
} from "../consumption.js";
import { esc, showToast, showSnackbar, shareOrDownloadFile } from "../ui.js";
import { openTodayQuestionModal } from "../analysis.js";
import { gewichtsBericht, trendSatz } from "../gewicht.js";
import { ikon } from "../ikonen.js";
import { openGewichtModal } from "../gewicht-eingabe.js";

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

export async function renderStart(container, goToTab, openEntrySheet) {
  return renderStartKlar(container, goToTab, Store.getActiveProfile(), openEntrySheet);
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ===========================================================================
// Wochenstreifen zum Blättern, vier Zielringe und das Gewicht in einer Karte,
// Mahlzeiten gruppiert darunter. Rückgängig läuft über die Snackbar.
// ===========================================================================

const KLAR_WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const KLAR_RING_CIRCUMFERENCE = 270.2; // 2πr bei r=43 im viewBox 0 0 100 100

async function renderStartKlar(container, goToTab, profile, openEntrySheet) {
  const dateKey = getActiveDateKey();
  const targets = getTargetsForDate(profile, dateKey);
  const refresh = () => renderStart(container, goToTab, openEntrySheet);
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
    <div class="klar-day-actions">
      <button type="button" class="klar-pill-btn" id="planBtn">${ikon("planen", { groesse: 17 })} Planen</button>
      <button type="button" class="klar-pill-btn" id="saveImageBtn">${ikon("bild", { groesse: 17 })} Screenshot</button>
      <button type="button" class="klar-pill-btn" id="todayQuestionBtn">${ikon("ki", { groesse: 17 })} Was geht noch?</button>
    </div>
  `;

  container.querySelector("#planBtn").addEventListener("click", () => goToTab("planer"));
  container.querySelector("#saveImageBtn").addEventListener("click", () => saveDashboardAsImage(container));
  container.querySelector("#todayQuestionBtn").addEventListener("click", () => openTodayQuestionModal(dateKey));

  renderKlarWeekStrip(container, dateKey, refresh);
  renderKlarMacros(container, totals, targets, goToTab, profile, refresh, entries);
  renderKlarWeight(container, profile, dateKey, refresh);
  renderKlarMeals(container, entries, refresh, openEntrySheet, profile, dateKey);
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

  wireDateSwipe(el, 7, refresh);
}

/**
 * Wischen blättert den aktiven Tag weiter — `days` ist die Schrittweite (Wochenstreifen
 * wochenweise, Nährwertkarte tageweise). Das Element folgt dabei gedämpft dem Finger und
 * rastet beim Loslassen ein; ohne diese Rückmeldung wirkt die Geste, als würde sie nicht
 * erkannt.
 */
function wireDateSwipe(el, days, refresh) {
  let startX = null;
  let startY = null;
  let dragging = false;

  el.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = false;
    el.style.transition = "none";
  }, { passive: true });

  el.addEventListener("touchmove", (e) => {
    if (startX == null) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    // Überwiegend senkrecht = die Seite scrollen, nicht blättern. Ohne diese Unterscheidung
    // zuckt die hohe Nährwertkarte bei jedem Scrollen durch die Startseite.
    if (!dragging && Math.abs(dy) > Math.abs(dx)) { startX = null; return; }
    if (!dragging && Math.abs(dx) < 8) return;
    dragging = true;
    // Gedämpft mitziehen: deutlich sichtbar, aber das Element wandert nicht aus dem Bild.
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
    shiftActiveDate(dx < 0 ? days : -days);
    refresh();
  }, { passive: true });

  el.addEventListener("touchcancel", () => { startX = null; settle(); }, { passive: true });
}

/**
 * Ein Tag mit vorgemerkten Mahlzeiten sieht aus wie ein Tag mit gegessenen — dieselben Ringe,
 * dieselben Summen. Genau das ist beim Planen erwünscht, wäre beim Zurückblicken aber eine
 * stille Unwahrheit. Deshalb steht überall dabei, woran man ist: geplant zählt mit, und man
 * sieht, dass es geplant ist.
 */
function geplantHinweis(entries, dateKey) {
  const offen = entries.filter(e => e.planned).length;
  if (offen === 0) return "";
  const zukunft = dateKey > dateKeyOf(Date.now());
  const was = offen === 1 ? "Eine Mahlzeit ist" : `${offen} Mahlzeiten sind`;
  return zukunft
    ? `${was} vorgemerkt — beim Essen bestätigen.`
    : `${was} noch als Plan eingetragen, nicht als gegessen bestätigt.`;
}

function renderKlarMacros(container, totals, targets, goToTab, profile, refresh, entries) {
  const el = container.querySelector("#klarMacros");
  const rings = [
    { label: "Kalorien", unit: "kcal", target: targets.kcal, consumed: totals.kcal },
    { label: "Netto-KH", unit: "g", target: targets.netCarbG, consumed: totals.netCarbs },
    { label: "Fett", unit: "g", target: targets.fatG, consumed: totals.fat },
    { label: "Eiweiß", unit: "g", target: targets.proteinG, consumed: totals.protein },
  ];
  const carbsLeft = targets.netCarbG - totals.netCarbs;
  const budgetHint = carbsLeft > 0 ? klarBudgetHint(carbsLeft) : "";
  const planHint = geplantHinweis(entries, getActiveDateKey());

  el.innerHTML = `
    <div class="klar-card-head">
      <span class="klar-eyebrow">Nährwerte ${esc(dateLabel(getActiveDateKey()).toLowerCase())}${planHint ? " · geplant" : ""}</span>
      <div class="klar-head-actions">
        <button type="button" class="klar-pill-btn icon-only" id="klarScanBtn" title="Produkt scannen" aria-label="Produkt scannen">${ikon("kamera", { groesse: 17 })}</button>
        <button type="button" class="klar-pill-btn" id="klarEvalBtn">${ikon("auswertung", { groesse: 17 })} Auswertung</button>
      </div>
    </div>
    ${ringDiagramHtml(rings, profile.ringStyle)}
    ${budgetHint ? `<div class="klar-hint">${esc(budgetHint)}</div>` : ""}
    ${planHint ? `<div class="klar-hint klar-plan-hint">${esc(planHint)}</div>` : ""}
    <div id="klarWeight"></div>
  `;

  el.querySelector("#klarEvalBtn").addEventListener("click", () => goToTab("evaluation"));
  el.querySelector("#klarScanBtn").addEventListener("click", () => goToTab("scan"));

  // Über der Nährwertkarte tageweise blättern — dieselbe Geste wie im Wochenstreifen, nur
  // eine Schrittweite feiner.
  wireDateSwipe(el, 1, refresh);
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

/**
 * Eine Zeile Gewicht unter dem Wasser — die Gegenprobe zum Defizit, das die Ringe darüber
 * vorgeben. Bewusst schmal: gewogen wird einmal am Tag, nicht bei jedem Blick auf die App.
 *
 * Für zukünftige Tage gibt es nichts einzutragen (die Waage kann nicht vorausschauen), aber
 * der letzte bekannte Wert steht trotzdem da — sonst sähe der geplante Donnerstag aus, als
 * wäre nie jemand auf die Waage gestiegen.
 */
function renderKlarWeight(container, profile, dateKey, refresh) {
  const el = container.querySelector("#klarWeight");
  const heute = dateKeyOf(Date.now());
  const zukunft = dateKey > heute;
  const bericht = gewichtsBericht(profile, { heute: zukunft ? heute : dateKey });
  const amTag = Store.getWeight(profile.id, dateKey);
  const zeigt = amTag || bericht.letzter;

  const wert = zeigt ? `${round1(zeigt.kg)} kg` : "–";
  const woher = amTag
    ? (zeigt.bodyFatPct != null ? `${round1(zeigt.bodyFatPct)} % KF` : "")
    : zeigt ? `zuletzt ${esc(dateLabel(zeigt.dateKey).toLowerCase())}` : "";

  el.innerHTML = `
    <hr class="klar-divider">
    <div class="klar-weight-row${zukunft ? "" : " tippbar"}"${zukunft ? "" : ` role="button" tabindex="0"`}>
      <div class="klar-weight-text">
        <div class="klar-weight-head">
          <span class="klar-weight-title">Gewicht</span>
          <span class="klar-weight-value ${amTag ? "" : "stale"}">${wert}</span>
          ${woher ? `<span class="klar-weight-meta">${woher}</span>` : ""}
        </div>
        <div class="klar-weight-trend">${esc(trendSatz(bericht))}</div>
      </div>
      ${zukunft ? "" : `<button type="button" class="klar-weight-btn" id="klarWeightBtn">${amTag ? "Ändern" : `${ikon("wiegen", { groesse: 17 })} Wiegen`}</button>`}
    </div>
  `;

  // Ein Handler auf der ganzen Zeile statt nur auf dem Knopf — der Knopf bleibt als
  // sichtbarer Hinweis stehen, dass hier etwas passiert.
  const zeile = el.querySelector(".klar-weight-row.tippbar");
  const oeffnen = () => openGewichtModal(dateKey, refresh);
  zeile?.addEventListener("click", oeffnen);
  zeile?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); oeffnen(); }
  });
}

/** Netto-KH einer Zeile — aber nur, wenn welche drin sind. „0 g KH" an Fleisch, Fisch und
 * Käse ist die häufigste Angabe der ganzen Liste und sagt nie etwas. */
function khLabel(e) {
  if (e.netCarbs == null) return " · – g KH";
  return e.netCarbs > 0 ? ` · ${e.netCarbs} g KH` : "";
}

function renderKlarMeals(container, entries, refresh, openEntrySheet, profile, dateKey) {
  const el = container.querySelector("#klarMeals");
  if (entries.length === 0) {
    el.innerHTML = `<div class="klar-empty-row" id="klarEmptyRow"><span class="plus">+</span>Noch nichts eingetragen</div>`;
    el.querySelector("#klarEmptyRow").addEventListener("click", () => openEntrySheet());
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
    const sum = (f) => items.reduce((s, e) => s + (e[f] || 0), 0);
    const label = key === "none" ? "Ohne Zuordnung" : MEAL_LABELS[key];
    // Steht die ganze Mahlzeit noch als Plan da, ist "alles gegessen" ein Tipp statt drei.
    // Das ist der Regelfall: man kocht und isst eine Mahlzeit, nicht eine halbe.
    const offen = items.filter(e => e.planned).length;
    // Kalorien und Netto-KH stehen neben dem Namen: das sind die zwei Zahlen, die den Tag
    // steuern. Fett und Eiweiß kommen beim Antippen der Zeile — vorher standen vor dem
    // ersten Lebensmittel sechzehn Zahlen (vier je Mahlzeit), und die Karte las sich als
    // Tabelle statt als Liste dessen, was man gegessen hat.
    blocks.push(`
      <div class="klar-meal-group-title" data-gruppe="${key}">
        <span class="gruppe-name">${esc(label)}</span>
        <span class="gruppe-werte"><b>${Math.round(sum("kcal"))}</b> kcal · <b>${round1(sum("netCarbs"))}</b> g KH</span>
        ${offen > 0 ? `<button type="button" class="klar-inline-chip" data-bestaetige-mahlzeit="${key}">✓ gegessen</button>` : ""}
      </div>
      <div class="klar-meal-group-macros" hidden>
        <span><b>${round1(sum("fat"))}</b> g Fett</span>
        <span><b>${round1(sum("protein"))}</b> g Eiweiß</span>
      </div>
      ${items.map(e => `
        <div class="klar-meal-row ${e.planned ? "ist-geplant" : ""}" data-id="${e.id}">
          <span class="name">${esc(e.name)}</span>
          <span class="meta">${entryAmountLabel(e)} · ${e.kcal == null ? "–" : Math.round(e.kcal)} kcal${khLabel(e)}</span>
          ${e.planned
            ? `<button type="button" class="icon-btn klar-bestaetigen" data-bestaetige="${e.id}"
                 title="Als gegessen bestätigen" aria-label="Als gegessen bestätigen">✓</button>`
            : `<span class="chevron">›</span>`}
        </div>
      `).join("")}
    `);
  }
  el.innerHTML = `<div class="klar-meals-card">${blocks.join("")}</div>`;

  // Ein Tipp auf die Gruppenzeile zeigt Fett und Eiweiß dieser Mahlzeit — und versteckt sie
  // wieder. Bewusst kein Pfeil daneben: die Zeile ist keine Navigation, sondern zwei Zahlen,
  // die man selten braucht und dann sofort hat.
  el.querySelectorAll(".klar-meal-group-title").forEach(kopf => {
    kopf.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-bestaetige-mahlzeit]")) return;
      const makros = kopf.nextElementSibling;
      if (makros?.classList.contains("klar-meal-group-macros")) {
        makros.hidden = !makros.hidden;
        kopf.classList.toggle("offen", !makros.hidden);
      }
    });
  });

  el.querySelectorAll(".klar-meal-row").forEach(row => {
    row.addEventListener("click", () => {
      const entry = Store.getConsumption().find(c => c.id === row.dataset.id);
      if (entry) openEditConsumptionModal(entry, refresh);
    });
  });

  // Bestätigen darf die Zeile nicht gleichzeitig zum Bearbeiten öffnen.
  el.querySelectorAll("[data-bestaetige]").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const bestaetigt = bestaetigeGeplant(btn.dataset.bestaetige);
      refresh();
      if (bestaetigt) {
        showSnackbar({
          title: `${bestaetigt.name} gegessen`,
          subtitle: "Zählt jetzt als eingetragen, nicht mehr als Plan",
          onUndo: () => { Store.updateConsumption({ ...bestaetigt, planned: true }); refresh(); },
        });
      }
    });
  });

  el.querySelectorAll("[data-bestaetige-mahlzeit]").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const anzahl = bestaetigeMahlzeit(profile.id, dateKey, btn.dataset.bestaetigeMahlzeit);
      refresh();
      if (anzahl > 0) showToast(`${anzahl} Eintrag/Einträge bestätigt`);
    });
  });
}

/** Menge einer Tageszeile: Rezepte in Portionen (mit Gewicht, wenn bekannt), Produkte in Gramm. */
function entryAmountLabel(e) {
  if (e.servings == null) return `${e.grams} g`;
  const grams = e.servingG ? ` (${Math.round(e.servingG * e.servings)} g)` : "";
  // servings wird bewusst ungerundet gespeichert (250 g eines 345-g-Rezepts sind
  // 0.7246376811594203 Portionen) — ungerundet angezeigt stand genau diese Zahl in der Zeile.
  return `${round1(e.servings)} P.${grams}`;
}
