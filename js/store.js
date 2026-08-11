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
    netCarbLimitG: 20,      // 20 | 30 | 50 (frei editierbar)
  };
}

function defaultState() {
  const p1 = defaultProfile("Wilhelm");
  const p2 = defaultProfile("Sandra");
  p2.sex = "female";
  return {
    schemaVersion: SCHEMA_VERSION,
    profiles: [p1, p2],
    activeProfileId: p1.id,
    favorites: [],     // { barcode, name, brand, addedAt, netCarbs100, grade }
    noGo: [],
    shoppingList: [],  // { id, text, checked, barcode? }
    ownProducts: {},   // barcode -> product object (manuell angelegt)
    cache: {},         // barcode -> { product, fetchedAt }
    recent: [],        // zuletzt gescannte barcodes, neueste zuerst
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.schemaVersion) return defaultState();
    // Platz für künftige Migrationen anhand schemaVersion
    return { ...defaultState(), ...parsed };
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
