// off.js — Anbindung an Open Food Facts, Normalisierung, Cache, eigene Produkte.
import { Store } from "./store.js";

const FIELDS = [
  "product_name", "brands", "quantity", "serving_size",
  "nutriments", "ingredients_text_de", "ingredients_text",
  "countries_tags", "nutriscore_grade", "code",
].join(",");

function apiUrl(barcode) {
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;
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
  const own = Store.getOwnProduct(barcode);
  if (own) return normalizeOwn(own);

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
