// off.js — Open Food Facts: Produkt per Barcode, Suche per Name.
//
// Eigene schlanke Fassung statt js/off.js der Keto-App: die hängt am Keto-Store und rechnet
// Netto-KH. Übernommen sind die dort gemessenen Erfahrungen (siehe Kommentar in js/off.js):
// cgi/search.pl mit Länderfilter und bis zu drei Versuchen, weil der Dienst oft mit 503 abweist.

const FELDER = "code,product_name,product_name_de,brands,serving_quantity,nutriments";
const SUCHE_VERSUCHE = 3;
const SUCHE_PAUSE_MS = 700;

function normalisieren(p) {
  if (!p) return null;
  const kh = p.nutriments?.carbohydrates_100g;
  const name = (p.product_name_de || p.product_name || "").trim();
  return {
    barcode: p.code || "",
    name: name || "Unbekanntes Produkt",
    marke: (p.brands || "").split(",")[0].trim(),
    // Fehlende KH bleiben null und nicht 0 — sonst stünde ein Produkt mit 0 g KH da, das in
    // Wahrheit nur keine Angabe hat. Die Oberfläche bietet dann die Eingabe von der Packung an.
    kh100: typeof kh === "number" && Number.isFinite(kh) ? kh : null,
    portionG: Number(p.serving_quantity) > 0 ? Number(p.serving_quantity) : null,
  };
}

export async function produktPerBarcode(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FELDER}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts antwortete mit ${res.status}.`);
  const json = await res.json();
  return json.status === 1 ? normalisieren(json.product) : null;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sucheNachName(begriff, { anzahl = 3 } = {}) {
  const params = new URLSearchParams({
    search_terms: begriff, search_simple: "1", action: "process", json: "1",
    page_size: "12", fields: FELDER, lc: "de",
    tagtype_0: "countries", tag_contains_0: "contains", tag_0: "germany",
  });
  const url = `https://world.openfoodfacts.org/cgi/search.pl?${params}`;
  let letzter;
  for (let i = 0; i < SUCHE_VERSUCHE; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const json = await res.json();
        return (json.products || []).map(normalisieren).filter((p) => p && p.kh100 != null).slice(0, anzahl);
      }
      letzter = new Error(`Open Food Facts antwortete mit ${res.status}.`);
    } catch (e) {
      letzter = e;
      if (!navigator.onLine) break;
    }
    await pause(SUCHE_PAUSE_MS);
  }
  throw letzter;
}
