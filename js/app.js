// app.js — Tab-Router, Profil-Umschalter, Init, Design/Theme, Klar-Eintragen-Sheet.
import { Store, onPersistError, bereit, onStoreChange, istZeilenModus } from "./store.js";
import { renderStart } from "./views/start.js";
import { renderScan, cleanupScan, openScanSearch } from "./views/scan.js";
import { renderLists, openListsSubtab, renderEvaluationPage } from "./lists.js";
import { renderProfile } from "./views/profile.js";
import { renderRecipes } from "./views/recipes.js";
import { renderOnboarding } from "./views/onboarding.js";
import {
  logConsumption, rankFrequentItems, MEAL_LABELS, mealShort, suggestMeal,
  getActiveDateKey, getConsumptionForDate, sumConsumption,
} from "./consumption.js";
import { logRecipeConsumption, calcPerServing } from "./recipes.js";
import { lookupProduct, getProductOffline, nutriSnapshot } from "./off.js";
import { getTargetsForDate } from "./profiles.js";
import { showToast, showSnackbar, bindBackClose, esc, applyDesignTheme } from "./ui.js";
import { isSyncEnabled, syncNow } from "./sync.js";

function round1(v) {
  return v == null ? null : Math.round(v * 10) / 10;
}

const view = document.getElementById("view");
const tabbar = document.getElementById("tabbar");
const profileSwitchBtn = document.getElementById("profileSwitch");
const profileSwitchName = document.getElementById("profileSwitchName");
const fabBtn = document.getElementById("fabBtn");

let activeTab = "start";
let historyInitialized = false;

const RENDERERS = {
  start: () => renderStart(view, goToTab, openEntrySheet),
  scan: () => renderScan(view),
  lists: () => renderLists(view, goToTab),
  recipes: () => renderRecipes(view),
  profile: () => renderProfile(view, updateProfileSwitchLabel),
  // Unterseite ohne eigenen Reiter (Design "Klar"), erreichbar aus der Nährwertkarte auf Start.
  evaluation: () => renderEvaluationPage(view, goToTab),
};

// Jeder Tab-Wechsel bekommt einen eigenen History-Eintrag, damit die Zurück-Geste am Handy
// durch die zuletzt besuchten Tabs blättert statt die App sofort zu verlassen. Dialoge und
// der Rezept-Editor koppeln sich zusätzlich selbst an (siehe ui.js: bindBackClose).
function goToTab(tab, opts = {}) {
  if (tab !== "scan") cleanupScan();
  if (tab === "lists" && opts.sub) openListsSubtab(opts.sub);
  activeTab = tab;
  // Unterseiten ohne eigenen Reiter (z.B. Auswertung) lassen die Markierung stehen, wo sie
  // hergekommen sind — sonst wäre in der Tableiste gar nichts hervorgehoben.
  const hasOwnTab = [...tabbar.querySelectorAll(".tab-btn")].some(btn => btn.dataset.tab === tab);
  if (hasOwnTab) {
    tabbar.querySelectorAll(".tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
  }
  if (!opts.fromPopstate) {
    if (!historyInitialized) {
      history.replaceState({ nav: "tab", tab }, "");
      historyInitialized = true;
    } else {
      history.pushState({ nav: "tab", tab }, "");
    }
  }
  // Vollbild-Ansichten (Rezept-Editor) blenden die Kopfleiste aus und melden das über eine
  // Klasse am <body>. Beim Tabwechsel hier zurücksetzen — die Renderer setzen sie danach
  // selbst wieder, falls sie noch gilt. Sonst bliebe die Kopfleiste in anderen Tabs weg.
  document.body.classList.remove("chrome-hidden");
  RENDERERS[tab]();
}

tabbar.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => goToTab(btn.dataset.tab));
});

window.addEventListener("popstate", (e) => {
  const state = e.state;
  if (state?.nav === "tab" && state.tab !== activeTab) {
    goToTab(state.tab, { fromPopstate: true });
  } else if (!state && activeTab !== "start") {
    // Basis-Zustand erreicht, aber wir sind nicht auf Start — lieber dorthin zurück als
    // die App auf einer Unterseite zu verlassen.
    goToTab("start", { fromPopstate: true });
  }
});

function updateProfileSwitchLabel() {
  profileSwitchName.textContent = Store.getActiveProfile().name;
}

profileSwitchBtn.addEventListener("click", () => {
  const state = Store.get();
  const idx = state.profiles.findIndex(p => p.id === state.activeProfileId);
  const next = state.profiles[(idx + 1) % state.profiles.length];
  Store.setActiveProfile(next.id);
  updateProfileSwitchLabel();
  applyDesignTheme(); // jedes Profil hat sein eigenes Design/Erscheinungsbild
  showToast(`Profil: ${next.name}`);
  refreshCurrentTabIfSafe();
});

/** Rendert den sichtbaren Tab neu, ohne die History anzufassen — nur für Tabs ohne eigenen,
 * zwischenzeitlichen Bearbeitungszustand (Rezept-Editor und Scanner bleiben deshalb außen vor). */
function refreshCurrentTabIfSafe() {
  if (activeTab === "start" || activeTab === "profile" || activeTab === "lists") RENDERERS[activeTab]();
}

// ---------------------------------------------------------------------------
// Eintragen-Sheet (nur Design "Klar", über den FAB in der Tabbar).
// Zeigt die drei Wege (Scannen/Suchen/Rezept) und darüber hinaus Chips nach
// Häufigkeit × Tageszeit, damit der Alltagsfall ein einziger Tipp ist.
// ---------------------------------------------------------------------------
fabBtn.addEventListener("click", openEntrySheet);

// Exportiert, damit der "+" in der leeren Mahlzeiten-Liste auf Start denselben Weg öffnet
// wie der FAB in der Tableiste, statt eine zweite Variante desselben Sheets zu pflegen.
export function openEntrySheet() {
  const profile = Store.getActiveProfile();
  let meal = suggestMeal();

  const overlay = document.createElement("div");
  overlay.className = "klar-sheet-overlay";
  document.body.appendChild(overlay);
  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const render = () => {
    const { frequent, recent } = rankFrequentItems(profile.id, meal);
    const targets = getTargetsForDate(profile, getActiveDateKey());
    const totals = sumConsumption(getConsumptionForDate(profile.id, getActiveDateKey()));
    const carbsLeft = round1(targets.netCarbG - totals.netCarbs);
    const kcalLeft = Math.round(targets.kcal - totals.kcal);

    overlay.innerHTML = `
      <div class="klar-sheet">
        <div class="klar-sheet-handle"></div>
        <div class="klar-sheet-head">
          <div class="klar-sheet-title">Eintragen</div>
          <span class="klar-pill-btn budget ${carbsLeft <= 0 ? "over" : ""}">Noch ${carbsLeft} g KH · ${kcalLeft} kcal</span>
        </div>
        <div class="klar-sheet-sub">Sortiert nach dem, was du um diese Zeit wirklich isst.</div>

        <div class="klar-entry-ways">
          <button type="button" class="klar-entry-way primary" data-way="scan">📷 Scannen</button>
          <button type="button" class="klar-entry-way secondary" data-way="search">🔎 Suchen</button>
          <button type="button" class="klar-entry-way secondary" data-way="recipe">🍳 Rezept</button>
        </div>

        <div class="klar-meal-select-head">
          <span class="klar-eyebrow">Mahlzeit</span>
          <span class="klar-water-value">${nowLabel()} vorgeschlagen</span>
        </div>
        <div class="klar-meal-segments">
          ${Object.keys(MEAL_LABELS).map(key => `
            <button type="button" class="klar-meal-segment ${key === meal ? "active" : ""}" data-meal="${key}">${esc(mealShort(key))}</button>
          `).join("")}
        </div>

        ${frequent.length > 0 ? `
          <div class="klar-rank-head">
            <span class="klar-eyebrow">Für dich ${esc(mealPhrase(meal))}</span>
          </div>
          <div class="klar-rank-note">Häufigkeit × Tageszeit. Terrakotta passt nicht mehr ins KH-Budget.</div>
          <div class="klar-chip-row">
            ${frequent.map((item, i) => chipHtml(item, i < 2 ? "top" : "", carbsLeft)).join("")}
          </div>
        ` : ""}

        ${recent.length > 0 ? `
          <hr class="klar-divider">
          <div class="klar-eyebrow" style="margin:0 0 10px">Zuletzt benutzt</div>
          <div class="klar-chip-row">
            ${recent.map(item => chipHtml(item, "", carbsLeft)).join("")}
          </div>
        ` : ""}

        ${frequent.length === 0 && recent.length === 0 ? `
          <div class="klar-hint" style="margin-top:18px">Sobald du ein paar Sachen eingetragen hast, erscheinen sie hier als Schnellauswahl.</div>
        ` : ""}
      </div>
    `;

    overlay.querySelectorAll(".klar-meal-segment").forEach(btn => {
      btn.addEventListener("click", () => { meal = btn.dataset.meal; render(); });
    });
    overlay.querySelectorAll(".klar-entry-way").forEach(btn => {
      btn.addEventListener("click", () => {
        const way = btn.dataset.way;
        close(() => {
          if (way === "recipe") goToTab("recipes");
          else if (way === "search") { goToTab("scan"); openScanSearch(view); }
          else goToTab("scan");
        });
      });
    });
    overlay.querySelectorAll(".klar-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const item = [...frequent, ...recent].find(i => i.key === chip.dataset.key);
        if (item) logQuickEntry(item, meal);
        close();
      });
    });
  };

  render();
}

/** Netto-KH, die ein Chip einträgt — ohne Netz aus dem, was das Gerät ohnehin hat (Cache,
 * eigene Produkte, eingebaute Tabelle, lokal gespeicherte Rezepte). null, wenn nicht ermittelbar
 * (z.B. Produkt noch nie gecacht) — der Chip zeigt dann nur Name und Menge, wie bisher. */
function estimateNetCarbs(item) {
  if (item.isRecipe) {
    const recipe = Store.getRecipe(item.recipeId);
    return recipe ? round1(calcPerServing(recipe).netCarbs * item.amount) : null;
  }
  const product = getProductOffline(item.barcode);
  if (!product) return null;
  const netCarbs100 = nutriSnapshot(product).netCarbs;
  return netCarbs100 != null ? round1(netCarbs100 * item.amount / 100) : null;
}

function chipHtml(item, extraClass, carbsLeft) {
  const netCarbs = estimateNetCarbs(item);
  const over = netCarbs != null && carbsLeft != null && netCarbs > carbsLeft;
  return `
    <button type="button" class="klar-chip ${extraClass} ${over ? "over" : ""}" data-key="${esc(item.key)}">
      ${esc(item.name)}
      ${item.count > 1 ? `<span class="klar-chip-count">${item.count}×</span>` : ""}
      <span class="klar-chip-amount">+${item.isRecipe ? `${item.amount} P.` : `${item.amount} g`}${netCarbs != null ? ` ${netCarbs} g KH` : ""}</span>
    </button>
  `;
}

/** Trägt einen Chip mit seiner zuletzt genutzten Menge ein — ohne Zwischendialog, dafür mit
 * Snackbar zum Rückgängigmachen. Rezepte laufen über logRecipeConsumption (Portionen). */
async function logQuickEntry(item, meal) {
  let entry = null;
  if (item.isRecipe) {
    const recipe = Store.getRecipe(item.recipeId);
    if (!recipe) { showToast("Rezept nicht mehr vorhanden"); return; }
    entry = logRecipeConsumption(recipe, item.amount, meal);
  } else {
    try {
      const product = await lookupProduct(item.barcode);
      entry = logConsumption(product, item.amount, meal);
    } catch {
      showToast("Produkt gerade nicht verfügbar (offline?)");
      return;
    }
  }
  if (!entry) return;
  if (activeTab === "start") RENDERERS.start();
  showSnackbar({
    title: `${item.name} eingetragen`,
    subtitle: `${item.isRecipe ? `${item.amount} Portion(en)` : `${item.amount} g`} · ${mealShort(meal)}`,
    onUndo: () => {
      Store.removeConsumption(entry.id);
      if (activeTab === "start") RENDERERS.start();
    },
  });
}

function mealPhrase(key) {
  return { breakfast: "zum Frühstück", lunch: "mittags", dinner: "am Abend", snack: "als Snack" }[key] || "";
}
function nowLabel() {
  return new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}

// Stream sauber stoppen, wenn die App in den Hintergrund geht (Akku).
document.addEventListener("visibilitychange", () => {
  if (document.hidden && activeTab === "scan") cleanupScan();
});

// Der Speicher des Browsers ist voll und selbst nach dem Leeren des Produkt-Cache geht nichts
// mehr hinein. Das MUSS sichtbar sein: sonst wirkt jede weitere Eingabe, als wäre sie
// gespeichert, und ist nach dem nächsten Neuladen weg.
let storageWarningShown = false;
onPersistError(() => {
  if (storageWarningShown) return;
  storageWarningShown = true;
  showToast("Speicher voll — Eingaben werden gerade NICHT gesichert. Bitte Daten exportieren.");
});

// Offline/Online Hinweis
window.addEventListener("offline", () => showToast("Offline — gecachte Produkte funktionieren weiter"));
window.addEventListener("online", () => {
  showToast("Wieder online");
  if (isSyncEnabled()) syncNow().catch(() => {}); // Fehler zeigt die Profil-Ansicht beim nächsten Öffnen
});

// Service Worker registrieren (relativer Pfad, funktioniert unter /keto-dashboard/ Unterpfad)
if ("serviceWorker" in navigator) {
  // Ob beim Start schon ein Service Worker die Seite bedient hat: bei der allerersten
  // Registrierung wechselt der Controller ebenfalls — dann darf NICHT neu geladen werden.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(reg => {
      // Eine installierte App wird nie neu geladen — beim Zurückholen aus dem Hintergrund
      // deshalb selbst nach einem neuen Stand schauen.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    }).catch(err => {
      console.warn("Service Worker Registrierung fehlgeschlagen:", err);
    });
  });

  // Ein neuer Service Worker hat übernommen: die bereits geladenen Module stammen noch vom
  // alten Stand, deshalb einmalig neu laden — aber nie mitten in einer Eingabe.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !hadController) return;
    if (document.querySelector(".modal-overlay")) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
    reloading = true;
    location.reload();
  });
}

/** Liest ?tab=/&sub= aus der URL (Homescreen-Shortcuts, siehe manifest.webmanifest) und säubert
 * die Adressleiste danach, damit ein Neuladen nicht wieder auf denselben Reiter springt. */
function initialTabFromUrl() {
  const params = new URLSearchParams(location.search);
  const tab = params.get("tab");
  const sub = params.get("sub");
  if (tab === "lists" && sub) openListsSubtab(sub);
  if (location.search) history.replaceState(null, "", location.pathname);
  return tab && RENDERERS[tab] ? tab : "start";
}

// Kommt über den Abgleich etwas Neues herein, den sichtbaren Reiter auffrischen — sonst
// sieht man die Eingabe des anderen Geräts erst nach einem Neustart. Nur im Zeilenmodus:
// dort wird der Zustand ausschließlich dann neu geladen, wenn wirklich etwas ankam. Der
// alte Weg meldet auch bei einem unveränderten Serverstand "remote" und zeichnete die
// Liste dann alle 60 Sekunden ohne Anlass neu.
onStoreChange((origin) => {
  if (origin === "remote" && istZeilenModus()) refreshCurrentTabIfSafe();
});

// Den Speicher hochfahren, bevor irgendetwas gelesen wird. Im bisherigen Klumpenmodus ist
// das sofort durch; im Zeilenmodus wird hier aus IndexedDB geladen (und beim allerersten Mal
// umgezogen). Das ist die EINZIGE asynchrone Stelle des Starts — danach liest die App den
// Zustand wieder synchron, genau wie vorher.
await bereit();

// Vom Kochbuch (kochbuch/) auf die Einkaufsliste übernommene Zutaten abholen — bewusst vor dem
// ersten Rendern, damit die Einkaufsliste beim allerersten Blick schon vollständig ist.
const drainedFromKochbuch = Store.drainKochbuchInbox();

// Init
if (Store.isOnboarded()) {
  applyDesignTheme();
  updateProfileSwitchLabel();
  goToTab(initialTabFromUrl());
  if (drainedFromKochbuch > 0) {
    showToast(`${drainedFromKochbuch} Zutat(en) aus dem Kochbuch auf die Einkaufsliste übernommen`);
  }
  if (isSyncEnabled()) {
    syncNow().then(refreshCurrentTabIfSafe).catch(() => {
      // Fehler (z.B. abgelaufene Anmeldung) zeigt die Profil-Ansicht beim nächsten Öffnen an —
      // kein Toast hier, damit ein kurzer Verbindungsaussetzer beim Start nicht jedes Mal stört.
    });
  }
} else {
  // Auch die Ersteinrichtung schon im Design "Klar" zeigen — ohne das hier ist der allererste
  // Bildschirm eines neuen Geräts der einzige, der ohne die Schrift und die Farbtokens läuft.
  applyDesignTheme();
  tabbar.style.display = "none";
  profileSwitchBtn.style.display = "none";
  renderOnboarding(view, () => {
    tabbar.style.display = "";
    profileSwitchBtn.style.display = "";
    applyDesignTheme(); // nach dem Anlegen gilt das Erscheinungsbild des neuen Profils
    updateProfileSwitchLabel();
    goToTab("start");
  });
}
