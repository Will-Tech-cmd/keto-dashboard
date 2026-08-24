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

/**
 * Namenssuche.
 *
 * Drei Dinge sind hier gemessen und nicht geraten:
 *
 * 1. DER DIENST WEIST OFT AB. Acht Suchbegriffe, jeweils mit Abstand: beim ERSTEN Versuch
 *    kamen 2 von 8 durch, sechsmal HTTP 503. Mit bis zu drei Versuchen: 7 von 8, bei im
 *    Schnitt zwei Anfragen. Deshalb WIEDERHOLUNGEN — sie sind hier kein Luxus, sondern der
 *    Unterschied zwischen „Suche funktioniert nicht" und „Suche funktioniert".
 *
 * 2. OHNE LÄNDERFILTER SIND DIE TREFFER UNBRAUCHBAR. „Gouda" brachte 2 von 15 Produkten,
 *    die es hier zu kaufen gibt — oben standen „Queso Gouda / Hacendado" und „Gouda vieux /
 *    Holland Master". Mit Filter: 15 von 15, angeführt von Milbona, Milsani, Rewe Bio.
 *
 * 3. DER NEUE SUCHDIENST GEHT NICHT. search.openfoodfacts.org antwortet zwar zuverlässig,
 *    sendet aber kein Access-Control-Allow-Origin — vom Browser aus also unerreichbar.
 *    Serverseitig gemessen sah er großartig aus; das ist die Falle. Sollte Open Food Facts
 *    dort CORS nachrüsten, ist der Wechsel eine Handvoll Zeilen.
 *
 * Ebenfalls geprüft: api/v2/search hat CORS und liefert vollständige Felder, rangiert aber
 * schlecht — „Schlagsahne" brachte dort Kefir und Nutella nach oben. Deshalb bleibt es bei
 * cgi/search.pl.
 */
const SUCHE_URL = "https://world.openfoodfacts.org/cgi/search.pl";
const LAND = "germany";
const SEITENGROESSE = 20;
const SUCH_VERSUCHE = 3;
const SUCH_PAUSE_MS = 700;

function suchUrl(term, { nurLand }) {
  const params = new URLSearchParams({
    search_terms: term,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(SEITENGROESSE),
    fields: FIELDS,
    lc: "de",
  });
  if (nurLand) {
    params.set("tagtype_0", "countries");
    params.set("tag_contains_0", "contains");
    params.set("tag_0", LAND);
  }
  return `${SUCHE_URL}?${params.toString()}`;
}

/** `brands` kommt je nach Endpunkt als Zeichenkette oder als Liste. */
function marke(roh) {
  if (Array.isArray(roh)) return roh.map(m => String(m).trim()).filter(Boolean).join(", ");
  return roh || "";
}

const warte = (ms) => new Promise(r => setTimeout(r, ms));

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
    brand: marke(raw.brands),
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
 * Eine Suchanfrage, mit Wiederholung bei 5xx. Wirft erst, wenn alle Versuche daneben gingen —
 * dann soll der Aufrufer es zeigen können.
 *
 * Nur 5xx und Netzwerkfehler werden wiederholt: ein 4xx bedeutet, dass die Anfrage selbst
 * nicht stimmt, und die wird beim dritten Mal auch nicht besser.
 */
async function frageSuche(q, { nurLand }) {
  let letzter = null;
  for (let versuch = 1; versuch <= SUCH_VERSUCHE; versuch++) {
    let res;
    try {
      res = await fetch(suchUrl(q, { nurLand }), { headers: { Accept: "application/json" } });
    } catch (e) {
      letzter = new Error("Keine Verbindung zur Produktsuche.");
      letzter.suchFehler = true;
      if (versuch < SUCH_VERSUCHE) { await warte(SUCH_PAUSE_MS); continue; }
      throw letzter;
    }
    if (res.ok) {
      const json = await res.json();
      return Array.isArray(json.products) ? json.products : [];
    }
    letzter = new Error(`Die Produktsuche antwortete mit Status ${res.status}.`);
    letzter.suchFehler = true;
    if (res.status < 500 || versuch === SUCH_VERSUCHE) throw letzter;
    await warte(SUCH_PAUSE_MS);
  }
  throw letzter;
}

/**
 * Namenssuche bei Open Food Facts (z.B. "Eier", "Gouda"), für Produkte ohne Barcode zur Hand.
 *
 * Gibt `{ produkte, fehler }` zurück statt nur einer Liste. Vorher wurde bei jedem Fehler
 * still eine leere Liste geliefert — und weil die alte Schnittstelle meistens 503 antwortete,
 * sah man dauernd „keine Treffer", wo in Wahrheit gar nicht gesucht worden war. Das ist der
 * Unterschied zwischen „gibt es nicht" und „konnte nicht nachsehen", und den muss die App
 * zeigen können.
 *
 * Die Treffer sind BEWUSST unvollständig: der Suchdienst liefert weder Portionsgröße noch
 * Zutatentext, auch nicht auf Anfrage. Sie werden deshalb als `unvollstaendig` markiert und
 * NICHT in den Produkt-Cache gelegt — sonst bekäme ein späterer Barcode-Scan die halbe
 * Fassung aus dem Cache statt der vollen vom Server. Beim Antippen holt die Ansicht das
 * ganze Produkt über lookupProduct() nach.
 */
export async function searchProductsByName(term) {
  const q = term.trim();
  if (q.length < 2) return { produkte: [], fehler: null };
  if (!navigator.onLine) return { produkte: [], fehler: null };

  let treffer;
  try {
    treffer = await frageSuche(q, { nurLand: true });
    // Zu wenig aus Deutschland? Dann noch einmal ohne Filter und anhängen — bei Nischen-
    // begriffen ist ein Treffer aus Österreich besser als gar keiner. Schlägt dieser
    // zweite Griff fehl, bleibt es bei dem, was der erste gebracht hat.
    if (treffer.length < 5) {
      try {
        const weltweit = await frageSuche(q, { nurLand: false });
        const bekannt = new Set(treffer.map(t => t.code));
        treffer = [...treffer, ...weltweit.filter(t => !bekannt.has(t.code))];
      } catch { /* der Länder-Treffer steht, das reicht */ }
    }
  } catch (fehler) {
    return { produkte: [], fehler };
  }

  const produkte = treffer
    .filter(t => t.code && t.product_name)
    .map(t => normalizeOff(t, t.code))
    // Ohne jede Nährwertangabe ist ein Eintrag in dieser App wertlos: man tippt ihn an und
    // kann nichts eintragen. Er nimmt nur einen Platz in der Liste weg.
    .filter(p => p.per100.kcal != null || p.per100.carbs != null);
  // Treffer sind vollständig (FIELDS deckt Portionsgröße und Zutatentext mit ab), dürfen
  // also in den Cache — ein späterer Barcode-Scan findet sie dann ohne Netz.
  for (const p of produkte) Store.cacheProduct(p.barcode, p);
  return { produkte, fehler: null };
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
