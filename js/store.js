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
    waterTargetMl: 2500,    // Tagesziel Trinkmenge (frei editierbar), unabhängig von den Makro-Zielen
    appearance: "system",   // "system" | "light" | "dark" — schlägt bei explizitem Wert die Systemeinstellung
    ringStyle: "rings",     // "rings" (2x2) | "row" (vier in einer Reihe) | "concentric" (ein Ring, vier Bahnen)
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
    consumption: [],    // { id, profileId, barcode, name, grams|servings, servingG, meal, dateKey, kcal, netCarbs, fat, protein, at }
    water: [],          // { id, profileId, dateKey, ml, at }
    recipes: [],         // { id, name, servings, ingredients: [{id,name,grams,per100,likelyUsLabel}], createdAt, updatedAt }
    fiberOverrides: {},  // barcode -> true|false, überschreibt die automatische EU/US-Erkennung (Ballaststoff-Schalter)
    dayTargets: {},      // profileId -> { dateKey -> { kcal, netCarbG, fatG, proteinG } }, friert vergangene Tage ein
  };
}

/** Lokales Datum (nicht UTC) als "YYYY-MM-DD" — Schlüssel für Tagesplanung/Auswertung. */
export function dateKeyOf(timestamp) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const HISTORY_LIMIT = 500;
const CONSUMPTION_LIMIT = 1000;
// Sicherung des Stands unmittelbar vor einem Import/Abgleich — bewusst ein eigener Schlüssel,
// damit sie nicht selbst wieder überschrieben oder mitexportiert wird.
const PREMERGE_KEY = "keto-dashboard-premerge";

let state = load();

/** Ergänzt Bestandsdaten (egal ob aus localStorage geladen oder importiert) um Felder, die
 * es zum Speicherzeitpunkt noch nicht gab — ohne vorhandene Werte anzutasten. */
function migrate(parsed) {
  const merged = { ...defaultState(), ...parsed };
  // Bestandsdaten von vor Einführung des Onboardings: nicht nachträglich zur
  // Ersteinrichtung zwingen, nur wirklich neue Geräte sollen den Dialog sehen.
  if (parsed.onboarded === undefined) merged.onboarded = true;
  // Bestehende Profile (vor Einführung der Ernährungsform) um die neuen Felder ergänzen,
  // ohne ihre sonstigen Werte anzutasten.
  merged.profiles = merged.profiles.map(p => ({
    dietType: "keto",
    gradeThresholds: { green: 5, yellow: 10 },
    waterTargetMl: 2500,
    appearance: "system",
    ringStyle: "rings",
    ...p,
  }));
  // Verbrauchs-Einträge von vor Tagesplanung/Mahlzeiten: dateKey aus dem Zeitstempel
  // ableiten, damit sie weiterhin ihrem ursprünglichen Tag zugeordnet bleiben.
  merged.consumption = merged.consumption.map(e => ({
    meal: null,
    servingG: null,
    ...e,
    dateKey: e.dateKey || dateKeyOf(e.at),
  }));
  return merged;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.schemaVersion) return defaultState();
    // Platz für künftige Migrationen anhand schemaVersion
    return migrate(parsed);
  } catch (e) {
    console.warn("Store: konnte gespeicherte Daten nicht lesen, starte neu.", e);
    return defaultState();
  }
}

// Persistieren wird debounced: ein schneller Klick-Ausbruch (z.B. 5× "+200 ml Wasser") soll nicht
// 5 synchrone localStorage-Schreibvorgänge auslösen. Beim Verlassen der App (Tab wechseln,
// schließen) wird sofort geschrieben — sonst ginge eine Änderung kurz vor dem Schließen verloren.
let persistTimer = null;

function writeNow() {
  clearTimeout(persistTimer);
  persistTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Store: persistieren fehlgeschlagen", e);
  }
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(writeNow, 250);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && persistTimer) writeNow();
  });
  window.addEventListener("pagehide", () => { if (persistTimer) writeNow(); });
}

/** Prüft eine Backup-Datei und gibt den Inhalt zurück. Wirft mit klarer Meldung bei Unfug. */
function parseBackup(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Datei ist keine gültige JSON-Datei.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.profiles)) {
    throw new Error("Ungültige Datei: kein gültiges Keto-Dashboard-Backup.");
  }
  return parsed;
}

/** Legt den aktuellen Stand als Sicherung ab, damit ein Import rückgängig gemacht werden kann. */
function savePreMergeBackup() {
  try {
    const { cache, ...withoutCache } = state;
    localStorage.setItem(PREMERGE_KEY, JSON.stringify({ at: Date.now(), snapshot: withoutCache }));
  } catch (e) {
    // Kein Platz mehr im Speicher: der Import soll trotzdem laufen, nur eben ohne Netz.
    console.warn("Sicherung vor dem Zusammenführen konnte nicht angelegt werden.", e);
  }
}

/** Felder, in denen sich zwei Fassungen desselben Profils unterscheiden (ohne updatedAt). */
function diffProfiles(mine, theirs) {
  const out = [];
  for (const t of theirs || []) {
    const m = (mine || []).find(p => p.id === t.id);
    if (!m) continue;
    const fields = Object.keys({ ...m, ...t })
      .filter(k => k !== "updatedAt" && JSON.stringify(m[k]) !== JSON.stringify(t[k]));
    if (fields.length) out.push({ id: t.id, name: m.name, fields, local: m, file: t });
  }
  return out;
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
    // Zeitstempel mitführen, damit ein späterer Abgleich zwischen zwei Geräten selbst
    // entscheiden kann, welche Fassung der Einstellungen die neuere ist.
    Object.assign(p, patch, { updatedAt: Date.now() });
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

  // --- Ballaststoff-Schalter (pro Barcode, überschreibt EU/US-Standarderkennung) ---
  setFiberOverride(barcode, subtractFiber) {
    state.fiberOverrides[barcode] = subtractFiber;
    persist();
  },
  getFiberOverride(barcode) {
    return Object.prototype.hasOwnProperty.call(state.fiberOverrides, barcode)
      ? state.fiberOverrides[barcode]
      : undefined;
  },
  clearFiberOverride(barcode) {
    delete state.fiberOverrides[barcode];
    persist();
  },

  // --- Zielwert-Schnappschüsse je Tag (damit Profiländerungen die Historie nicht rückwirkend verfälschen) ---
  setDayTargets(profileId, dateKey, targets) {
    if (!state.dayTargets[profileId]) state.dayTargets[profileId] = {};
    const existing = state.dayTargets[profileId][dateKey];
    // Nur schreiben, wenn sich wirklich etwas ändert — spart unnötige persist()-Aufrufe
    // beim häufigen Neuzeichnen der Startseite.
    if (existing && existing.kcal === targets.kcal && existing.netCarbG === targets.netCarbG
      && existing.fatG === targets.fatG && existing.proteinG === targets.proteinG) return;
    state.dayTargets[profileId][dateKey] = targets;
    persist();
  },
  getDayTargets(profileId, dateKey) {
    return state.dayTargets[profileId]?.[dateKey] || null;
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

  // --- Wasser (getrennt vom Makro-Verbrauch, kein historisches Einfrieren nötig) ---
  addWater(entry) {
    state.water = [entry, ...state.water].slice(0, 2000);
    persist();
  },
  getWater() {
    return state.water;
  },
  removeWater(id) {
    state.water = state.water.filter(e => e.id !== id);
    persist();
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
  /** Ergänzt/ändert einzelne Felder eines Listeneintrags (z.B. nachgefüllte Nährwerte). */
  updateListEntry(listName, barcode, patch) {
    const item = state[listName].find(e => e.barcode === barcode);
    if (!item) return;
    Object.assign(item, patch);
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
  /**
   * Backup ohne den Produkt-Cache: der macht ~68% der Dateigröße aus, lässt sich aber
   * jederzeit neu von Open Food Facts laden. Ohne ihn schrumpft ein typisches Backup von
   * ~640 KB auf ~45 KB — wichtig fürs Teilen. Beim Import ergänzt migrate() das Feld wieder.
   */
  exportJSON() {
    const { cache, ...withoutCache } = state;
    return JSON.stringify(withoutCache, null, 2);
  },
  importJSON(json) {
    const parsed = parseBackup(json);
    savePreMergeBackup();
    state = migrate(parsed);
    persist();
  },

  /** Prüft eine Backup-Datei und liefert den geparsten Inhalt — für die Vorschau im Dialog. */
  parseBackup(json) {
    return parseBackup(json);
  },

  /**
   * Was würde ein Zusammenführen mit dieser Datei bewirken? Reine Vorschau, ändert nichts.
   * Damit kann der Dialog echte Zahlen zeigen statt allgemeiner Warnungen.
   */
  previewMerge(incoming) {
    const countNew = (mine, theirs, key) => {
      const known = new Set((mine || []).map(key));
      return (theirs || []).filter(x => !known.has(key(x))).length;
    };
    const byId = x => x.id;
    const myRecipeNames = new Set(state.recipes.map(r => r.name.trim().toLowerCase()));
    const myRecipeIds = new Set(state.recipes.map(r => r.id));

    return {
      consumption: countNew(state.consumption, incoming.consumption, byId),
      water: countNew(state.water, incoming.water, byId),
      history: countNew(state.history, incoming.history, byId),
      recipes: countNew(state.recipes, incoming.recipes, byId),
      favorites: countNew(state.favorites, incoming.favorites, f => f.barcode),
      noGo: countNew(state.noGo, incoming.noGo, f => f.barcode),
      shoppingList: countNew(state.shoppingList, incoming.shoppingList, byId),
      // Rezepte mit gleicher id werden aktualisiert statt doppelt angelegt.
      recipesUpdated: (incoming.recipes || []).filter(r => myRecipeIds.has(r.id)).length,
      // Gleicher Name, andere id = unabhängig voneinander angelegt. Lässt sich nicht
      // automatisch zusammenlegen, ohne zu raten — deshalb nur ankündigen.
      recipeNameClashes: [...new Set((incoming.recipes || [])
        .filter(r => !myRecipeIds.has(r.id) && myRecipeNames.has(r.name.trim().toLowerCase()))
        .map(r => r.name.trim()))],
      // Was ein "Datei gewinnt" kosten würde.
      losesOnReplace: {
        consumption: countNew(incoming.consumption, state.consumption, byId),
        recipes: countNew(incoming.recipes, state.recipes, byId),
        favorites: countNew(incoming.favorites, state.favorites, f => f.barcode),
        shoppingList: countNew(incoming.shoppingList, state.shoppingList, byId),
      },
      profileDiffs: diffProfiles(state.profiles, incoming.profiles),
    };
  },

  /**
   * Führt eine Backup-Datei mit dem lokalen Stand zusammen, statt ihn zu ersetzen.
   *
   * Die IDs sind Zufalls-UUIDs — zwei Geräte erzeugen nie dieselbe. Eine Vereinigung über die
   * ID ist deshalb verlustfrei: was auf beiden Geräten liegt, stammt aus demselben Ursprung und
   * ist identisch; alles andere ist neu und kommt dazu.
   *
   * `profileChoice` bestimmt je Profil-ID, wessen Einstellungen gelten sollen ("local" oder
   * "file"). Profile tragen erst seit Kurzem ein `updatedAt`; wo beide Seiten eines haben,
   * entscheidet das neuere automatisch, sonst bleibt es bei der Wahl aus dem Dialog.
   */
  mergeJSON(json, { profileChoice = {} } = {}) {
    const incoming = parseBackup(json);
    savePreMergeBackup();

    const unionById = (mine, theirs) => {
      const map = new Map((mine || []).map(x => [x.id, x]));
      for (const x of theirs || []) if (!map.has(x.id)) map.set(x.id, x);
      return [...map.values()];
    };
    const byTimeDesc = (a, b) => (b.at || 0) - (a.at || 0);

    state.consumption = unionById(state.consumption, incoming.consumption)
      .sort(byTimeDesc).slice(0, CONSUMPTION_LIMIT);
    state.history = unionById(state.history, incoming.history)
      .sort(byTimeDesc).slice(0, HISTORY_LIMIT);
    state.water = unionById(state.water, incoming.water).sort(byTimeDesc);
    state.shoppingList = unionById(state.shoppingList, incoming.shoppingList);

    // Rezepte: gleiche id -> neuere Fassung gewinnt, sonst dazunehmen.
    const recipes = new Map(state.recipes.map(r => [r.id, r]));
    for (const r of incoming.recipes || []) {
      const mine = recipes.get(r.id);
      if (!mine || (r.updatedAt || 0) > (mine.updatedAt || 0)) recipes.set(r.id, r);
    }
    state.recipes = [...recipes.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // Favoriten/No-Go über den Barcode, jüngerer Eintrag gewinnt.
    for (const listName of ["favorites", "noGo"]) {
      const map = new Map(state[listName].map(e => [e.barcode, e]));
      for (const e of incoming[listName] || []) {
        const mine = map.get(e.barcode);
        if (!mine || (e.addedAt || 0) > (mine.addedAt || 0)) map.set(e.barcode, e);
      }
      state[listName] = [...map.values()];
    }

    // Eigene Produkte und Ballaststoff-Schalter sind eigene Korrekturen: bei Kollision
    // behält das Gerät seine Fassung, Fehlendes kommt dazu.
    state.ownProducts = { ...(incoming.ownProducts || {}), ...state.ownProducts };
    state.fiberOverrides = { ...(incoming.fiberOverrides || {}), ...state.fiberOverrides };

    // Eingefrorene Tagesziele je Profil und Tag — lokal gewinnt (sollte ohnehin gleich sein).
    for (const [profileId, days] of Object.entries(incoming.dayTargets || {})) {
      state.dayTargets[profileId] = { ...days, ...(state.dayTargets[profileId] || {}) };
    }

    // Profile: je Profil entscheidet updatedAt, sonst die Wahl aus dem Dialog.
    for (const incomingProfile of incoming.profiles || []) {
      const i = state.profiles.findIndex(p => p.id === incomingProfile.id);
      if (i < 0) { state.profiles.push(incomingProfile); continue; }
      const mine = state.profiles[i];
      const bothStamped = mine.updatedAt != null && incomingProfile.updatedAt != null;
      const takeFile = bothStamped
        ? incomingProfile.updatedAt > mine.updatedAt
        : profileChoice[incomingProfile.id] === "file";
      if (takeFile) state.profiles[i] = incomingProfile;
    }

    persist();
  },

  // --- Sicherung vor dem letzten Zusammenführen ---
  hasPreMergeBackup() {
    return !!localStorage.getItem(PREMERGE_KEY);
  },
  getPreMergeInfo() {
    try {
      const raw = localStorage.getItem(PREMERGE_KEY);
      return raw ? { at: JSON.parse(raw).at } : null;
    } catch { return null; }
  },
  /** Stellt den Stand von unmittelbar vor dem letzten Import/Abgleich wieder her. */
  restorePreMergeBackup() {
    const raw = localStorage.getItem(PREMERGE_KEY);
    if (!raw) return false;
    const { snapshot } = JSON.parse(raw);
    state = migrate(snapshot);
    persist();
    localStorage.removeItem(PREMERGE_KEY);
    return true;
  },

  /**
   * Schlanker Export nur der Rezepte (ohne Profile, Verlauf, Listen) zum gezielten Teilen
   * einzelner Rezepte, statt des kompletten Backups. Nährwerte stecken bereits in jeder
   * Zutat (per100), die Datei ist also für sich allein importierbar.
   */
  exportRecipesJSON() {
    return JSON.stringify({ schemaVersion: SCHEMA_VERSION, recipes: state.recipes }, null, 2);
  },
  /**
   * Fügt Rezepte HINZU statt das ganze Backup zu ersetzen — anders als importJSON().
   * Rezepte mit bereits vorhandener id werden aktualisiert (z.B. beim erneuten Teilen einer
   * Änderung), alle anderen werden neu angelegt. Bestehende Rezepte bleiben unangetastet.
   */
  importRecipesJSON(json) {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.recipes)) {
      throw new Error("Ungültige Datei: keine Keto-Dashboard-Rezeptdatei.");
    }
    let added = 0, updated = 0;
    for (const r of parsed.recipes) {
      if (!r || !r.id || !r.name || !Array.isArray(r.ingredients)) continue;
      const i = state.recipes.findIndex(x => x.id === r.id);
      if (i >= 0) { state.recipes[i] = r; updated++; } else { state.recipes.unshift(r); added++; }
    }
    persist();
    return { added, updated };
  },

  raw: () => state,
};
