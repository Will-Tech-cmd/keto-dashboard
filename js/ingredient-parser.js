// ingredient-parser.js — deutscher Zutaten-Text-Parser: wandelt eingefügten/erkannten Text
// in strukturierte Zeilen um (Menge, Einheit, Name). Ursprünglich Teil von recipes.js, hierher
// ausgelagert, damit die Kochbuch-App (kochbuch/) denselben Parser verwenden kann, ohne die
// restliche Rezept-/Store-Logik der Keto-App mitzuziehen. Keine Abhängigkeiten.

const UNIT_GRAMS = {
  g: 1, gr: 1, gramm: 1,
  kg: 1000, kilo: 1000, kilogramm: 1000,
  ml: 1, milliliter: 1,
  l: 1000, liter: 1000,
  el: 15, essl: 15, esslöffel: 15,
  tl: 5, teel: 5, teelöffel: 5,
  zehe: 5, zehen: 5,
  prise: 1, prisen: 1,
  stück: null, stk: null, // Stückzahl ohne bekanntes Gewicht -> grams bleibt null, quantity zählt
};
// Einheiten-Wortmuster für beide Erkennungsrichtungen (deckt sich mit UNIT_GRAMS' Schlüsseln).
const UNIT_PATTERN = "g|gr|gramm|kg|kilo|kilogramm|ml|milliliter|l|liter|el|essl|esslöffel|tl|teel|teelöffel|zehen?|prisen?|st(?:ü|ue)ck|stk";

const SIZE_QUALIFIERS = /\b(kleine[rs]?|mittlere[rs]?|große[rs]?|groß)\b/gi;
const LEADING_DESCRIPTORS = /\b(geriebene[rs]?|gehackte[rs]?|frische[rs]?|getrocknete[rs]?|gewürfelte[rs]?|gepresste[rs]?|gemahlene[rs]?|geschmolzene[rs]?|zuckerfreie[rn]?|weiche[rs]?)\b/gi;
const TRAILING_DESCRIPTORS = /[,\s]+\b(fein gehackt|gehackt|gewürfelt|gepresst|gerieben|geraspelt|in scheiben|zum garnieren|nach geschmack|frisch|getrocknet)\b.*$/i;

// Aufzählungszeichen am Zeilenanfang: nummerierte Listen ("1.", "2)") UND/GEFOLGT VON
// Bindestrichen ("4. -Eier", "5. - Eier") — beide Präfixe können kombiniert auftreten.
//
// Ein einzeln stehendes "o" zählt mit: die Texterkennung liest ein Aufzählungs-• in
// vielen Schriften als kleines o. Ohne diese Ausnahme fällt die ganze Zeile durch beide
// Muster unten durch und landet als Name MITSAMT Menge in der Liste ("o 150g Speisequark"
// mit leerer Mengenangabe). Nur mit folgendem Leerraum, damit "Olivenöl" unberührt bleibt.
// Ein Zeichen je Durchlauf statt "+", sonst kann eine lange Strichfolge den Regex-Motor
// in exponentielles Zurücksetzen treiben.
const BULLET_PREFIX = /^\s*(?:\d+[.)]\s*)?(?:(?:[-–—•*·]|[oO](?=\s))\s*)*/;
// Abschnittsüberschriften ohne Menge überspringen: "Zutaten:", "Boden:", "Füllung:" …
const SECTION_HEADER = /^[^\d]*:\s*$/;
// Klammerzusätze wie "(geschmolzen)" oder "(ggf mehr oder weniger …)" sind keine Zutat.
const PAREN_CONTENT = /\([^)]*\)/g;
// Mengenbereiche auf den kleineren Wert reduzieren: "1-2 TL" -> "1 TL" (im Review anpassbar).
const QUANTITY_RANGE = /^(\d+(?:[.,]\d+)?)\s*[-–]\s*\d+(?:[.,]\d+)?(?=\s)/;
// Mengen-Zusatzwörter vor der eigentlichen Einheit: "1 gehäufter EL" -> "1 EL"
const HEAP_QUALIFIER = /^(gehäufte[rn]?|gestrichene[rn]?)\s+/i;

// "Menge zuerst": "150g Mandeln" / "150 g Mandeln" / "1 EL Öl" — beliebig viel Leerraum
// zwischen Zahl und Einheit, Einheit optional direkt angehängt oder als eigenes Wort.
const QTY_FIRST = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(?:(${UNIT_PATTERN})\\b)?\\.?\\s*(.+)$`, "i");
// "Name zuerst": "Eier 100g" / "Eier 100 g" / "Eier, 2 Stück" / "Butter 1 EL"
const NAME_FIRST = new RegExp(`^(.+?)[,\\s]+(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})?\\.?\\s*$`, "i");

function parseIngredientLine(rawLine) {
  const raw = rawLine.trim();
  if (!raw) return null;

  let cleaned = raw.replace(BULLET_PREFIX, "").trim();
  if (!cleaned || SECTION_HEADER.test(cleaned)) return null;

  cleaned = cleaned.replace(PAREN_CONTENT, "").replace(/\s{2,}/g, " ").trim();
  if (!cleaned) return null;

  cleaned = cleaned.replace(QUANTITY_RANGE, "$1");
  cleaned = cleaned.replace(TRAILING_DESCRIPTORS, "").trim() || cleaned;

  // 1) "Menge zuerst" — nur wenn dahinter noch ein eigenständiger Name folgt (mind. 1 Buchstabe),
  // sonst würde "150g" allein (ohne Namen) fälschlich hier hängen bleiben.
  let m = cleaned.match(QTY_FIRST);
  if (m && /[a-zA-ZäöüÄÖÜß]/.test(m[3])) {
    const quantity = parseFloat(m[1].replace(",", "."));
    let rest = m[3].trim().replace(HEAP_QUALIFIER, "");
    // Die Einheit wurde entweder schon direkt an der Zahl erkannt (m[2], z.B. "150g") — dann NICHT
    // nochmal aus "rest" stripped werden (sonst frisst "gemahlene" fälschlich sein führendes "g").
    // Nur wenn m[2] leer blieb, nach einer separat stehenden Einheit am Anfang von "rest" suchen
    // (z.B. "1 gehäufter EL Kakao" -> nach Entfernen von "gehäufter" beginnt rest mit "EL").
    let unit = (m[2] || "").toLowerCase();
    if (!unit) {
      const detected = detectLeadingUnit(rest);
      if (detected) { unit = detected; rest = stripLeadingUnit(rest, detected); }
    }
    const name = cleanName(rest);
    const grams = unit && UNIT_GRAMS[unit] != null ? Math.round(quantity * UNIT_GRAMS[unit]) : null;
    if (name) return { raw, quantity, unit: unit || null, grams, name };
  }

  // 2) "Name zuerst" — Menge/Einheit stehen am Zeilenende.
  m = cleaned.match(NAME_FIRST);
  if (m) {
    const name = cleanName(m[1].replace(/[,\s]+$/, ""));
    const quantity = parseFloat(m[2].replace(",", "."));
    const unit = (m[3] || "").toLowerCase() || null;
    const grams = unit && UNIT_GRAMS[unit] != null ? Math.round(quantity * UNIT_GRAMS[unit]) : null;
    if (name) return { raw, quantity, unit, grams, name };
  }

  // 3) Kein erkennbares Zahlen/Einheiten-Muster — z.B. "Salz, Pfeffer nach Geschmack".
  return { raw, quantity: null, unit: null, grams: null, name: cleanName(cleaned) };
}

function detectLeadingUnit(rest) {
  const m = rest.match(new RegExp(`^(${UNIT_PATTERN})\\b`, "i"));
  return m ? m[1].toLowerCase() : null;
}

function stripLeadingUnit(rest, unit) {
  return rest.replace(new RegExp(`^${unit}\\.?\\s*`, "i"), "");
}

function cleanName(name) {
  return name
    .replace(SIZE_QUALIFIERS, "")
    .replace(LEADING_DESCRIPTORS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Zerlegt mehrzeiligen Zutaten-Text (aus OCR oder Einfügen) in Kandidaten-Zeilen. */
export function parseIngredientText(text) {
  return text
    .split(/\r?\n+/)
    .map(parseIngredientLine)
    .filter(Boolean)
    .filter(entry => entry.name.length > 1);
}
