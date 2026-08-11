// store.js — zentrale Datenhaltung in localStorage, versioniert.

const KEY = "keto-dashboard-v1";
const SCHEMA_VERSION = 1;

function defaultProfile(name) {
  return {
    id: crypto.randomUUID(),
    name,
    // Eingabedaten
    sex: "female",          // "female" | "male"
    age: 35,
    heightCm: 170,
    weightKg: 70,
    bodyFatPct: null,       // optional, aktiviert Katch-McArdle
    activity: 1.375,        // PAL
    goal: "lose",           // "lose" | "maintain" | "gain"
    deficitPct: 15,         // nur relevant bei goal = "lose"
    proteinFactor: 1.6,     // g je kg fettfreier Masse
    netCarbLimitG: 20,      // Tagesbudget Netto-KH (frei editierbar)
    dietType: "keto",       // "keto" | "lowcarb" | "other" -> steuert Ampel-Standardwerte
    gradeThresholds: { green: 5, yellow: 10 }, // g Netto-KH je 100g, frei editierbar
  };
}

function defaultState() {
  const p1 = defaultProfile("Profil 1");
  const p2 = defaultProfile("Profil 2");
  p2.sex = "female";
  return {
    schemaVersion: SCHEMA_VERSION,
    onboarded: false, // steuert den Ersteinrichtungs-Dialog ("Wie heißt du?") bei neuen Geräten
    profiles: [p1, p2],
    activeProfileId: p1.id,
    favorites: [],     // { barcode, name, brand, addedAt, netCarbs100, grade }
    noGo: [],
    shoppingList: [],  // { id, text, checked, barcode? }
    ownProducts: {},   // barcode -> product object (manuell angelegt)
    cache: {},         // barcode -> { product, fetchedAt }
    recent: [],        // zuletzt gescannte barcodes, neueste zuerst
    history: [],        // { id, barcode, name, brand, grade, netCarbs100, source, profileName, at }
    consumption: [],    // { id, profileId, barcode, name, grams|servings, kcal, netCarbs, fat, protein, at }
    recipes: [],         // { id, name, servings, ingredients: [{id,name,grams,per100,likelyUsLabel}], createdAt, updatedAt }
  };
}

const HISTORY_LIMIT = 500;
const CONSUMPTION_LIMIT = 1000;

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.schemaVersion) return defaultState();
    // Platz für künftige Migrationen anhand schemaVersion
    const merged = { ...defaultState(), ...parsed };
    // Bestandsdaten von vor Einführung des Onboardings: nicht nachträglich zur
    // Ersteinrichtung zwingen, nur wirklich neue Geräte sollen den Dialog sehen.
    if (parsed.onboarded === undefined) merged.onboarded = true;
    // Bestehende Profile (vor Einführung der Ernährungsform) um die neuen Felder ergänzen,
    // ohne ihre sonstigen Werte anzutasten.
    merged.profiles = merged.profiles.map(p => ({
      dietType: "keto",
      gradeThresholds: { green: 5, yellow: 10 },
      ...p,
    }));
    return merged;
  } catch (e) {
    console.warn("Store: konnte gespeicherte Daten nicht lesen, starte neu.", e);
    return defaultState();
  }
}

function persist() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export const Store = {
  get() {
    return state;
  },

  isOnboarded() {
    return !!state.onboarded;
  },
  setOnboarded() {
    state.onboarded = true;
    persist();
  },

  getActiveProfile() {
    return state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0];
  },

  setActiveProfile(id) {
    state.activeProfileId = id;
    persist();
  },

  updateProfile(id, patch) {
    const p = state.profiles.find(pr => pr.id === id);
    if (!p) return;
    Object.assign(p, patch);
    persist();
  },

  // --- Produkt-Cache (Open Food Facts Antworten) ---
  cacheProduct(barcode, product) {
    state.cache[barcode] = { product, fetchedAt: Date.now() };
    persist();
  },
  getCachedProduct(barcode) {
    return state.cache[barcode]?.product || null;
  },

  // --- eigene, manuell angelegte Produkte ---
  saveOwnProduct(barcode, product) {
    state.ownProducts[barcode] = product;
    persist();
  },
  getOwnProduct(barcode) {
    return state.ownProducts[barcode] || null;
  },

  // --- zuletzt gescannt ---
  pushRecent(barcode) {
    state.recent = [barcode, ...state.recent.filter(b => b !== barcode)].slice(0, 10);
    persist();
  },
  getRecent() {
    return state.recent;
  },

  // --- Such-/Scan-Verlauf (nur Protokoll, keine Mengen/Kalorien-Tracking) ---
  addHistoryEntry(entry) {
    state.history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
    persist();
  },
  getHistory() {
    return state.history;
  },
  clearHistory() {
    state.history = [];
    persist();
  },

  // --- Verbrauch (Mengen, die als "gegessen" eingetragen wurden) ---
  addConsumption(entry) {
    state.consumption = [entry, ...state.consumption].slice(0, CONSUMPTION_LIMIT);
    persist();
  },
  getConsumption() {
    return state.consumption;
  },
  removeConsumption(id) {
    state.consumption = state.consumption.filter(e => e.id !== id);
    persist();
  },
  updateConsumption(entry) {
    const i = state.consumption.findIndex(e => e.id === entry.id);
    if (i >= 0) { state.consumption[i] = entry; persist(); }
  },

  // --- Rezepte ---
  saveRecipe(recipe) {
    const i = state.recipes.findIndex(r => r.id === recipe.id);
    if (i >= 0) state.recipes[i] = recipe; else state.recipes.unshift(recipe);
    persist();
  },
  getRecipe(id) {
    return state.recipes.find(r => r.id === id) || null;
  },
  getRecipes() {
    return state.recipes;
  },
  deleteRecipe(id) {
    state.recipes = state.recipes.filter(r => r.id !== id);
    persist();
  },

  // --- Favoriten / No-Go ---
  addToList(listName, entry) {
    const list = state[listName];
    const idx = list.findIndex(e => e.barcode === entry.barcode);
    if (idx >= 0) list[idx] = entry; else list.unshift(entry);
    // Ein Produkt kann nicht gleichzeitig auf Favoriten UND No-Go stehen
    const other = listName === "favorites" ? "noGo" : "favorites";
    state[other] = state[other].filter(e => e.barcode !== entry.barcode);
    persist();
  },
  removeFromList(listName, barcode) {
    state[listName] = state[listName].filter(e => e.barcode !== barcode);
    persist();
  },
  isInList(listName, barcode) {
    return state[listName].some(e => e.barcode === barcode);
  },

  // --- Einkaufsliste ---
  addShoppingItem(text, barcode = null) {
    state.shoppingList.unshift({ id: crypto.randomUUID(), text, checked: false, barcode });
    persist();
  },
  toggleShoppingItem(id) {
    const item = state.shoppingList.find(i => i.id === id);
    if (item) item.checked = !item.checked;
    persist();
  },
  removeShoppingItem(id) {
    state.shoppingList = state.shoppingList.filter(i => i.id !== id);
    persist();
  },
  clearCheckedShoppingItems() {
    state.shoppingList = state.shoppingList.filter(i => !i.checked);
    persist();
  },

  // --- Export / Import ---
  exportJSON() {
    return JSON.stringify(state, null, 2);
  },
  importJSON(json) {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.profiles)) {
      throw new Error("Ungültige Datei: kein gültiges Keto-Dashboard-Backup.");
    }
    state = { ...defaultState(), ...parsed };
    persist();
  },

  raw: () => state,
};
