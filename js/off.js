// off.js — Anbindung an Open Food Facts, Normalisierung, Cache, eigene Produkte.
import { Store } from "./store.js";
import { getLocalFoodByBarcode } from "./foods-db.js";
import { calcNetCarbs } from "./keto.js";

const FIELDS = [
  "product_name", "brands", "quantity", "serving_size",
  "nutriments", "ingredients_text_de", "ingredients_text",
  "countries_tags", "nutriscore_grade", "code",
].join(",");

function apiUrl(barcode) {
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;
}

function searchUrl(term) {
  const params = new URLSearchParams({
    search_terms: term,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "15",
    fields: FIELDS,
    lc: "de",
  });
  return `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`;
}

function num(v) {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

/** Wandelt eine OFF-API-Antwort in unser einheitliches Produkt-Format um. */
function normalizeOff(raw, barcode) {
  const n = raw.nutriments || {};
  const isUS = Array.isArray(raw.countries_tags) && raw.countries_tags.includes("en:united-states");
  return {
    barcode,
    source: "off",
    name: raw.product_name || "Unbekanntes Produkt",
    brand: raw.brands || "",
    quantity: raw.quantity || "",
    servingSize: raw.serving_size || "",
    nutriscoreGrade: raw.nutriscore_grade || null,
    ingredientsText: raw.ingredients_text_de || raw.ingredients_text || "",
    likelyUsLabel: isUS,
    per100: {
      kcal: num(n["energy-kcal_100g"]),
      carbs: num(n.carbohydrates_100g),
      sugars: num(n.sugars_100g),
      fiber: num(n.fiber_100g),
      fat: num(n.fat_100g),
      saturatedFat: num(n["saturated-fat_100g"]),
      protein: num(n.proteins_100g),
      salt: num(n.salt_100g),
    },
  };
}

/** Eigenes, manuell erfasstes Produkt in dasselbe Format bringen. */
function normalizeOwn(p) {
  return { ...p, source: "own" };
}

/**
 * Sucht ein Produkt in folgender Reihenfolge:
 * 1. eigene, manuell angelegte Produkte (haben Vorrang)
 * 2. lokaler Cache (funktioniert offline)
 * 3. Open Food Facts API
 * Wirft { notFound: true } wenn nichts gefunden wurde -> UI zeigt "Produkt selbst anlegen".
 */
export async function lookupProduct(barcode, { forceNetwork = false } = {}) {
  // Eigene Werte zuerst: wer die eingebaute Tabelle korrigiert hat (z.B. andere Eiergröße),
  // erwartet die Korrektur überall — sonst bliebe sie für "local:"-Einträge wirkungslos.
  const own = Store.getOwnProduct(barcode);
  if (own) return normalizeOwn(own);

  const local = getLocalFoodByBarcode(barcode);
  if (local) return local;

  if (!forceNetwork) {
    const cached = Store.getCachedProduct(barcode);
    if (cached) return cached;
  }

  if (!navigator.onLine) {
    const cached = Store.getCachedProduct(barcode);
    if (cached) return cached;
    const err = new Error("Offline und kein gecachtes Produkt vorhanden.");
    err.offline = true;
    throw err;
  }

  let res;
  try {
    res = await fetch(apiUrl(barcode), { headers: { Accept: "application/json" } });
  } catch (e) {
    const cached = Store.getCachedProduct(barcode);
    if (cached) return cached;
    const err = new Error("Netzwerkfehler bei der Produktsuche.");
    err.networkError = true;
    throw err;
  }

  if (res.status === 404) {
    const err = new Error("Produkt nicht gefunden.");
    err.notFound = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Open Food Facts antwortete mit Status ${res.status}.`);
    err.networkError = true;
    throw err;
  }

  const json = await res.json();
  if (json.status === 0 || !json.product) {
    const err = new Error("Produkt nicht gefunden.");
    err.notFound = true;
    throw err;
  }

  const product = normalizeOff(json.product, barcode);
  Store.cacheProduct(barcode, product);
  return product;
}

/**
 * Namenssuche bei Open Food Facts (z.B. "Eier", "Gouda"), für Produkte ohne Barcode zur Hand.
 * Liefert normalisierte Produkte, die zugleich für spätere Barcode-Treffer gecacht werden.
 * Bei fehlendem Netz oder Fehlern wird still eine leere Liste zurückgegeben (die lokale
 * Grundnahrungsmittel-Suche in foods-db.js liefert in diesem Fall trotzdem Treffer).
 */
export async function searchProductsByName(term) {
  const q = term.trim();
  if (q.length < 2 || !navigator.onLine) return [];

  let res;
  try {
    res = await fetch(searchUrl(q), { headers: { Accept: "application/json" } });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let json;
  try {
    json = await res.json();
  } catch {
    return [];
  }

  const products = Array.isArray(json.products) ? json.products : [];
  return products
    .filter(p => p.code && p.product_name)
    .map(p => {
      const normalized = normalizeOff(p, p.code);
      Store.cacheProduct(p.code, normalized);
      return normalized;
    });
}

/**
 * Durchsucht bereits selbst angelegte Produkte nach Name/Marke — damit ein einmal erfasstes
 * eigenes Produkt (z.B. "Bulletproof Coffee") beim nächsten Mal über die Namenssuche wieder
 * auftaucht, statt dass man sich den frei erfundenen Barcode merken müsste.
 */
export function searchOwnProducts(term) {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  return Object.values(Store.get().ownProducts)
    .filter(p => p.name.toLowerCase().includes(q) || (p.brand || "").toLowerCase().includes(q))
    .map(normalizeOwn);
}

/** Erzeugt einen internen Platzhalter-Barcode für ein eigenes Produkt ohne echten EAN. */
export function newOwnBarcode() {
  return `eigen-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Speichert ein von Hand erfasstes Produkt und macht es sofort auffindbar. */
export function saveOwnProduct(barcode, data) {
  const product = {
    barcode,
    name: data.name,
    brand: data.brand || "",
    quantity: data.quantity || "",
    servingSize: data.servingSize || "",
    nutriscoreGrade: null,
    ingredientsText: data.ingredientsText || "",
    likelyUsLabel: false,
    per100: {
      kcal: num(data.kcal),
      carbs: num(data.carbs),
      sugars: num(data.sugars),
      fiber: num(data.fiber),
      fat: num(data.fat),
      saturatedFat: num(data.saturatedFat),
      protein: num(data.protein),
      salt: num(data.salt),
    },
  };
  Store.saveOwnProduct(barcode, product);
  return normalizeOwn(product);
}

/**
 * Produkt aus dem, was das Gerät ohnehin hat — eigene Produkte, eingebaute Tabelle, Cache.
 * Ohne Netz und ohne Wartezeit, gedacht fürs Zeichnen von Listen. Gibt null zurück, wenn zu
 * diesem Barcode nichts vorliegt.
 */
export function getProductOffline(barcode) {
  if (!barcode) return null;
  const own = Store.getOwnProduct(barcode);
  if (own) return normalizeOwn(own);
  return getLocalFoodByBarcode(barcode) || Store.getCachedProduct(barcode) || null;
}

/**
 * Die vier Kennwerte je 100 g, die in Listen und Kacheln gezeigt werden. Werden beim Anlegen
 * eines Favoriten/Verlaufseintrags mitgespeichert, damit sie auch nach einem Abgleich auf dem
 * anderen Handy vorhanden sind — der Produkt-Cache wird bewusst nicht mit exportiert.
 */
export function nutriSnapshot(product) {
  const override = Store.getFiberOverride(product.barcode);
  const subtractFiber = override !== undefined ? override : product.likelyUsLabel;
  return {
    kcal: product.per100.kcal ?? null,
    netCarbs: calcNetCarbs(product.per100, { subtractFiber }),
    fat: product.per100.fat ?? null,
    protein: product.per100.protein ?? null,
  };
}
