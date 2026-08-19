// app.js — Tab-Router, Profil-Umschalter, Init, Design/Theme, Klar-Eintragen-Sheet.
import { Store } from "./store.js";
import { renderStart } from "./views/start.js";
import { renderScan, cleanupScan, openScanSearch } from "./views/scan.js";
import { renderLists, openListsSubtab, renderEvaluationPage } from "./lists.js";
import { renderProfile } from "./views/profile.js";
import { renderRecipes } from "./views/recipes.js";
import { renderOnboarding } from "./views/onboarding.js";
import { logConsumption, rankFrequentItems, MEAL_LABELS, mealShort } from "./consumption.js";
import { logRecipeConsumption } from "./recipes.js";
import { lookupProduct } from "./off.js";
import { showToast, showSnackbar, bindBackClose, esc, applyDesignTheme } from "./ui.js";

const view = document.getElementById("view");
const tabbar = document.getElementById("tabbar");
const profileSwitchBtn = document.getElementById("profileSwitch");
const profileSwitchName = document.getElementById("profileSwitchName");
const fabBtn = document.getElementById("fabBtn");

let activeTab = "start";
let historyInitialized = false;

const RENDERERS = {
  start: () => renderStart(view, goToTab),
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
  if (activeTab === "start" || activeTab === "profile" || activeTab === "lists") RENDERERS[activeTab]();
});

// ---------------------------------------------------------------------------
// Eintragen-Sheet (nur Design "Klar", über den FAB in der Tabbar).
// Zeigt die drei Wege (Scannen/Suchen/Rezept) und darüber hinaus Chips nach
// Häufigkeit × Tageszeit, damit der Alltagsfall ein einziger Tipp ist.
// ---------------------------------------------------------------------------
fabBtn.addEventListener("click", openEntrySheet);

function openEntrySheet() {
  const profile = Store.getActiveProfile();
  let meal = suggestMealNow();

  const overlay = document.createElement("div");
  overlay.className = "klar-sheet-overlay";
  document.body.appendChild(overlay);
  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const render = () => {
    const { frequent, recent } = rankFrequentItems(profile.id, meal);
    overlay.innerHTML = `
      <div class="klar-sheet">
        <div class="klar-sheet-handle"></div>
        <div class="klar-sheet-title">Eintragen</div>
        <div class="klar-sheet-sub">Sortiert nach dem, was du um diese Zeit wirklich isst.</div>

        <div class="klar-entry-ways">
          <button type="button" class="klar-entry-way primary" data-way="scan">📷 Scannen</button>
          <button type="button" class="klar-entry-way secondary" data-way="search">🔎 Suchen</button>
          <button type="button" class="klar-entry-way secondary" data-way="recipe">🍳 Rezept</button>
        </div>

        <div class="klar-meal-select-head">
          <span class="klar-eyebrow">Mahlzeit</span>
          <span class="klar-water-value">${nowLabel()} · ${esc(mealShort(suggestMealNow()))} vorgeschlagen</span>
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
          <div class="klar-rank-note">Häufigkeit der letzten 30 Tage, gewichtet mit der Tageszeit.</div>
          <div class="klar-chip-row">
            ${frequent.map((item, i) => chipHtml(item, i < 2 ? "top" : "")).join("")}
          </div>
        ` : ""}

        ${recent.length > 0 ? `
          <div class="klar-eyebrow" style="margin:18px 0 10px">Zuletzt benutzt</div>
          <div class="klar-chip-row">
            ${recent.map(item => chipHtml(item, "")).join("")}
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

function chipHtml(item, extraClass) {
  return `
    <button type="button" class="klar-chip ${extraClass}" data-key="${esc(item.key)}">
      ${esc(item.name)}
      ${item.count > 1 ? `<span class="klar-chip-count">${item.count}×</span>` : ""}
      <span class="klar-chip-amount">+${item.isRecipe ? `${item.amount} P.` : `${item.amount} g`}</span>
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

function suggestMealNow() {
  const h = new Date().getHours(), m = new Date().getMinutes() / 60 + h;
  if (m < 10.5) return "breakfast";
  if (m < 15) return "lunch";
  if (m < 21.5) return "dinner";
  return "snack";
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

// Offline/Online Hinweis
window.addEventListener("offline", () => showToast("Offline — gecachte Produkte funktionieren weiter"));
window.addEventListener("online", () => showToast("Wieder online"));

// Service Worker registrieren (relativer Pfad, funktioniert unter /keto-dashboard/ Unterpfad)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => {
      console.warn("Service Worker Registrierung fehlgeschlagen:", err);
    });
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

// Init
if (Store.isOnboarded()) {
  applyDesignTheme();
  updateProfileSwitchLabel();
  goToTab(initialTabFromUrl());
} else {
  tabbar.style.display = "none";
  profileSwitchBtn.style.display = "none";
  renderOnboarding(view, () => {
    tabbar.style.display = "";
    profileSwitchBtn.style.display = "";
    applyDesignTheme(); // frisch eingerichtete Profile starten in "Klar"
    updateProfileSwitchLabel();
    goToTab("start");
  });
}
