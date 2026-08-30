// ai.js — optionale KI-Zutatenerkennung über die Gemini-API (Google AI Studio).
//
// Bewusst vollständig optional: ohne eigenen API-Schlüssel bleibt die App unverändert
// nutzbar, alle KI-Knöpfe erscheinen dann gar nicht erst. Der Schlüssel liegt unter einem
// EIGENEN localStorage-Schlüssel außerhalb des App-Zustands (state) — dadurch landet er nie
// in Store.exportJSON() und wandert beim Teilen/Sichern des Backups nicht versehentlich mit.

import { downscaleImageIfNeeded } from "./ui.js";

const KEY_STORAGE = "keto-dashboard-gemini-key";
const MODEL = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || "";
}
export function hasApiKey() {
  return getApiKey().length > 0;
}
export function setApiKey(key) {
  localStorage.setItem(KEY_STORAGE, key.trim());
}
export function clearApiKey() {
  localStorage.removeItem(KEY_STORAGE);
}

const INGREDIENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    ingredients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          grams: { type: "NUMBER" },
          kcal100: { type: "NUMBER" },
          carbs100: { type: "NUMBER" },
          fiber100: { type: "NUMBER" },
          sugars100: { type: "NUMBER" },
          fat100: { type: "NUMBER" },
          protein100: { type: "NUMBER" },
          salt100: { type: "NUMBER" },
        },
        required: ["name", "grams", "kcal100", "carbs100", "fat100", "protein100"],
      },
    },
  },
  required: ["ingredients"],
};

const PROMPT = `Du bekommst eine Zutatenliste aus einem Rezept (ggf. mit Tippfehlern oder aus Bild-Texterkennung). Zerlege sie in einzelne Zutaten.

Für jede echte Zutat:
- name: bereinigter Lebensmittelname, ohne Mengenangabe und ohne Zubereitungshinweise ("gehackt", "geschmolzen" o.ä.)
- grams: die im Rezept angegebene Menge in Gramm. Einheiten umrechnen (1 EL ≈ 15g, 1 TL ≈ 5g, 1 Ei ≈ 58g, 1 Knoblauchzehe ≈ 5g, 1ml Flüssigkeit ≈ 1g). Wenn keine Menge erkennbar ist: 0.
- kcal100/carbs100/fiber100/sugars100/fat100/protein100/salt100: STANDARD-Nährwerte dieses Lebensmittels pro 100g nach üblichen deutschen/EU-Nährwerttabellen — UNABHÄNGIG von der im Rezept verwendeten Menge. carbs100 ist die Netto-Kohlenhydratmenge (Ballaststoffe bereits abgezogen, wie auf deutschen Etiketten üblich).

Abschnittsüberschriften ohne Zutat (z.B. "Zutaten:", "Boden:", "Füllung:") gehören NICHT in die Liste. Reine Gewürzzeilen ohne erkennbare Menge (z.B. "Salz, Pfeffer nach Geschmack") mit grams: 0 aufnehmen, nicht weglassen.

Antworte ausschließlich mit dem JSON-Objekt gemäß Schema, ohne zusätzlichen Text.`;

function numOrNull(v) {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

/**
 * Ein Aufruf, ein Schema, ein Objekt zurück.
 *
 * Das Schema kommt von außen, weil es inzwischen zwei Aufgaben gibt: Zutaten erkennen und
 * einen Essensplan zusammenstellen. Was mit dem Ergebnis geschieht, entscheidet die
 * aufrufende Funktion — hier steht nur, wie man mit Gemini redet und was schiefgehen kann.
 */
async function callGemini(parts, key, schema) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts }],
        // maxOutputTokens großzügig setzen: gemini-3.6-flash ist ein "Thinking"-Modell und
        // verbraucht sonst sein Budget fürs interne Denken, bevor die eigentliche JSON-Antwort
        // fertig ist — die Zutatenliste bricht dann mittendrin ab.
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          maxOutputTokens: 8192,
        },
      }),
    });
  } catch {
    const err = new Error("Keine Verbindung zu Gemini möglich (offline?).");
    err.networkError = true;
    throw err;
  }

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const err = new Error("API-Schlüssel ungültig oder abgelehnt.");
    err.invalidKey = true;
    throw err;
  }
  if (res.status === 429) {
    const err = new Error("Gemini-Tageskontingent erschöpft — später erneut versuchen.");
    err.quotaExceeded = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Gemini antwortete mit Status ${res.status}.`);
    err.apiError = true;
    throw err;
  }

  const json = await res.json();
  const textOut = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOut) {
    const err = new Error("Keine verwertbare Antwort von Gemini erhalten.");
    err.apiError = true;
    throw err;
  }

  try {
    return JSON.parse(textOut);
  } catch {
    const err = new Error("Antwort von Gemini war kein gültiges JSON.");
    err.apiError = true;
    throw err;
  }
}

/** Wirft, wenn kein Schlüssel hinterlegt ist — die KI-Knöpfe erscheinen dann gar nicht erst. */
function schluesselOderFehler() {
  const key = getApiKey();
  if (key) return key;
  const err = new Error("Kein Gemini-API-Schlüssel hinterlegt.");
  err.noKey = true;
  throw err;
}

/** Die Zutaten-Antwort in die Schreibweise der App. */
function zuZutaten(parsed) {
  return (parsed?.ingredients || [])
    .map(i => ({
      name: String(i.name || "").trim(),
      grams: numOrNull(i.grams),
      per100: {
        kcal: numOrNull(i.kcal100),
        carbs: numOrNull(i.carbs100),
        fiber: numOrNull(i.fiber100),
        sugars: numOrNull(i.sugars100),
        fat: numOrNull(i.fat100),
        saturatedFat: null,
        protein: numOrNull(i.protein100),
        salt: numOrNull(i.salt100),
      },
    }))
    .filter(i => i.name);
}

/** Schickt eine Zutatenliste als Text an Gemini. Wirft, wenn kein Schlüssel hinterlegt ist. */
export async function recognizeIngredientsFromText(text) {
  const key = schluesselOderFehler();
  return zuZutaten(await callGemini([{ text: `${PROMPT}\n\nZutatenliste:\n${text}` }], key, INGREDIENT_SCHEMA));
}

/**
 * Schickt ein Bild direkt an Gemini (multimodal) — liest die Zutatenliste unmittelbar aus dem
 * Foto, ohne den Umweg über die lokale Texterkennung. Oft genauer als Tesseract bei schlecht
 * lesbaren Screenshots.
 */
export async function recognizeIngredientsFromImage(file) {
  const key = schluesselOderFehler();
  // Sehr hohe Scrolling-Screenshots vorher verkleinern — sonst wird der Base64-Upload
  // unnötig riesig (und kann Gemini's Größenlimit für inlineData reißen).
  const prepared = await downscaleImageIfNeeded(file);
  const data = await fileToBase64(prepared);
  const mimeType = prepared.type || file.type || "image/jpeg";
  return zuZutaten(await callGemini([
    { text: PROMPT },
    { inlineData: { mimeType, data } },
  ], key, INGREDIENT_SCHEMA));
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Minimaler Testaufruf für den "Verbindung testen"-Knopf im Profil. */
export async function testApiKey(key) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Antworte nur mit dem Wort OK." }] }],
        generationConfig: { maxOutputTokens: 512 },
      }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 429) return { ok: true, message: "Schlüssel gültig, Tageskontingent aktuell erschöpft." };
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, message: "Schlüssel wurde von Google abgelehnt." };
    }
    return { ok: false, message: `Unerwarteter Status ${res.status}.` };
  } catch {
    return { ok: false, message: "Keine Verbindung möglich (offline?)." };
  }
}

/** Fehler aus recognizeIngredientsFrom* in einen kurzen, verständlichen Toast-Text übersetzen. */
export function describeAiError(err) {
  if (err.noKey) return "Kein Gemini-API-Schlüssel hinterlegt (Profil-Tab).";
  if (err.invalidKey) return "Gemini-API-Schlüssel ungültig — im Profil-Tab prüfen.";
  if (err.quotaExceeded) return "Gemini-Tageskontingent erschöpft — später erneut versuchen.";
  if (err.networkError) return "Keine Verbindung zu Gemini möglich (offline?).";
  return "KI-Erkennung fehlgeschlagen: " + err.message;
}

// ---------------------------------------------------------------------------
// Essensplan verfeinern
//
// Der lokale Motor (planer.js) stellt einen Tag zusammen, der die Zielwerte trifft. Was er
// nicht kann, ist Geschmack: dass Lachs und Spinat zusammengehören, Frischkäse und Krakauer
// aber nicht in dieselbe Schüssel. Genau dafür ist dieser Aufruf da.
//
// Die Regel, die ihn ungefährlich macht:
//
//     DAS MODELL WÄHLT AUS, DIE APP RECHNET.
//
// Zurück kommen nur Verweise auf den mitgeschickten Katalog und Mengen — kein Name, keine
// Kalorienzahl, kein neues Gericht. Ein Verweis, den der Katalog nicht kennt, wird verworfen
// (siehe planer.js: ausVorschlag). Damit kann hier nichts hereinkommen, das der Haushalt
// nicht hat, und keine Zahl, die geschätzt statt gerechnet wurde.
// ---------------------------------------------------------------------------

const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    eintraege: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          tag: { type: "STRING" },
          mahlzeit: { type: "STRING" },
          nr: { type: "NUMBER" },
          menge: { type: "NUMBER" },
        },
        required: ["tag", "mahlzeit", "nr", "menge"],
      },
    },
  },
  required: ["eintraege"],
};

// Mehr als das schickt der Prompt nicht mit: die seltenen Einträge tragen zur Auswahl kaum
// etwas bei und kosten nur Platz.
const KATALOG_GRENZE = 60;

function katalogText(katalog) {
  return katalog.map((k, i) => {
    const einheit = k.einheit === "portion" ? "Portion" : "100 g";
    const p = k.per;
    return `${i}. ${k.name} — je ${einheit}: ${Math.round(p.kcal)} kcal, `
      + `${p.netCarbs} g KH, ${p.fat ?? "?"} g Fett, ${p.protein ?? "?"} g Eiweiß`
      + ` | Einheit: ${k.einheit === "portion" ? "Portionen" : "Gramm"}`
      + `, üblich ${k.standard}, von ${k.min} bis ${k.max}, Schritt ${k.schritt}`;
  }).join("\n");
}

/**
 * Lässt Gemini aus dem Katalog einen Plan zusammenstellen.
 *
 * Gibt die Einträge bereits mit `katalogKey` zurück — die Nummern sind nur eine Abkürzung für
 * den Prompt, außerhalb dieser Datei haben sie nichts zu suchen.
 */
export async function verfeinerePlan({ katalog, ziele, tage, mahlzeiten }) {
  const key = schluesselOderFehler();

  // Die naheliegendsten zuerst, damit die Grenze die richtigen abschneidet.
  const kurz = [...katalog]
    .sort((a, b) => (b.anzahl + (b.favorit ? 3 : 0)) - (a.anzahl + (a.favorit ? 3 : 0)))
    .slice(0, KATALOG_GRENZE);

  const namen = { breakfast: "Frühstück", lunch: "Mittag", dinner: "Abend", snack: "Snack" };
  const auftrag = [
    "Du stellst einen Essensplan zusammen. Verwende AUSSCHLIESSLICH die nummerierten Gerichte",
    "aus der Liste — erfinde nichts und schlage nichts vor, was nicht in der Liste steht.",
    "",
    `Tage: ${tage.join(", ")}`,
    `Mahlzeiten je Tag: ${mahlzeiten.map(m => `${m} (${namen[m]})`).join(", ")}`,
    "",
    "Zielwerte für JEDEN einzelnen Tag (Summe über alle Mahlzeiten):",
    `- Netto-Kohlenhydrate: HÖCHSTENS ${ziele.netCarbG} g. Das ist eine harte Grenze, keine Zielgröße.`,
    `- Kalorien: etwa ${ziele.kcal} kcal (±10 %)`,
    `- Eiweiß: mindestens ${ziele.proteinG} g`,
    `- Fett: etwa ${ziele.fatG} g`,
    "",
    "Regeln:",
    "1. Je Mahlzeit ein bis zwei Einträge. Was zusammen auf einem Teller Sinn ergibt, gehört zusammen.",
    "2. An einem Tag kommt kein Gericht zweimal vor, und an zwei aufeinanderfolgenden Tagen",
    "   steht nicht dasselbe auf dem Tisch.",
    "3. `menge` in der Einheit des Gerichts, innerhalb der angegebenen Grenzen und auf die",
    "   angegebene Schrittweite gerundet.",
    "4. `nr` ist die Nummer aus der Liste, `tag` genau einer der oben genannten Tage,",
    "   `mahlzeit` genau einer der englischen Schlüssel.",
    "",
    "Gerichte:",
    katalogText(kurz),
  ].join("\n");

  const antwort = await callGemini([{ text: auftrag }], key, PLAN_SCHEMA);
  return (antwort?.eintraege || [])
    .map(e => ({
      tag: String(e.tag || ""),
      mahlzeit: String(e.mahlzeit || ""),
      katalogKey: kurz[Math.round(Number(e.nr))]?.key || null,
      menge: numOrNull(e.menge),
    }))
    .filter(e => e.katalogKey && e.menge != null);
}

// ---------------------------------------------------------------------------
// Tellerfoto — was liegt da, und wie viel davon?
//
// Bewusst etwas anderes als recognizeIngredientsFromImage(): dort wird eine GESCHRIEBENE
// Zutatenliste abgelesen, hier muss geschätzt werden. Deshalb zwei Zusätze, die es dort
// nicht braucht:
//   - `sicher` + `alternativen`: glasierte Putenstreifen sehen aus wie Garnelen. Eine App,
//     die sich in so einem Fall einfach festlegt, trägt stillschweigend Falsches ein — hier
//     sagt die Erkennung, dass sie unsicher ist, und der Mensch tippt die richtige Fassung an.
//   - `hinweis`: was ein Foto grundsätzlich nicht zeigt (Öl in der Pfanne, Zucker in der
//     Soße). Lieber benennen als Genauigkeit vortäuschen.
// ---------------------------------------------------------------------------

const TELLER_SCHEMA = {
  type: "OBJECT",
  properties: {
    beschreibung: { type: "STRING" },
    hinweis: { type: "STRING" },
    posten: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          grams: { type: "NUMBER" },
          sicher: { type: "BOOLEAN" },
          alternativen: { type: "ARRAY", items: { type: "STRING" } },
          kcal100: { type: "NUMBER" },
          carbs100: { type: "NUMBER" },
          fiber100: { type: "NUMBER" },
          fat100: { type: "NUMBER" },
          protein100: { type: "NUMBER" },
        },
        required: ["name", "grams", "sicher", "kcal100", "carbs100", "fat100", "protein100"],
      },
    },
  },
  required: ["beschreibung", "posten"],
};

const TELLER_PROMPT = `Du siehst das Foto einer Mahlzeit. Schätze, was darauf liegt und wie viel davon.

beschreibung: ein bis zwei Sätze in natürlichem Deutsch, was auf dem Teller zu sehen ist.

posten: die einzelnen Bestandteile GETRENNT, nicht als ein Gesamtgericht. Fleisch, Beilage,
Gemüse, Soße, Salat sind eigene Posten. Für jeden:
- name: das Lebensmittel auf Deutsch, ohne Mengenangabe
- grams: geschätztes Gewicht dieses Bestandteils auf dem Teller. Orientiere dich an sichtbaren
  Größenverhältnissen (Teller ca. 26-28 cm, Besteck, Gläser). Realistische Restaurantportionen.
- sicher: true, wenn das Lebensmittel eindeutig erkennbar ist. false, wenn es mit etwas anderem
  verwechselbar ist — glasiertes helles Fleisch, paniertes, Pürees, undurchsichtige Soßen.
- alternativen: bei sicher=false zwei bis vier plausible Möglichkeiten, die wahrscheinlichste
  zuerst; der Name selbst darf darunter sein. Bei sicher=true leer lassen.
- kcal100/carbs100/fiber100/fat100/protein100: STANDARD-Nährwerte pro 100 g nach üblichen
  deutschen Nährwerttabellen, für das zubereitete Lebensmittel wie abgebildet (gebraten also
  inklusive des üblichen Bratfetts). carbs100 sind NETTO-Kohlenhydrate, Ballaststoffe bereits
  abgezogen.

Rechne mit, was zum Anrichten gehört, aber nicht sichtbar ist: Bratfett, Butter am Gemüse,
Öl im Dressing. Lieber als eigenen kleinen Posten führen als unterschlagen.

hinweis: eine kurze Warnung, wenn etwas Wesentliches am Foto nicht beurteilbar ist und die
Kohlenhydrate spürbar beeinflussen könnte — etwa eine Soße, die gezuckert sein kann, oder
eine Panade. Sonst leer lassen.

Antworte ausschließlich mit dem JSON-Objekt gemäß Schema, ohne zusätzlichen Text.`;

/**
 * Schickt ein Tellerfoto an Gemini und liefert die geschätzten Bestandteile.
 * Nährwerte kommen in derselben Schreibweise wie überall in der App (per100).
 */
export async function erkenneTellerFoto(file) {
  const key = schluesselOderFehler();
  const prepared = await downscaleImageIfNeeded(file);
  const data = await fileToBase64(prepared);
  const mimeType = prepared.type || file.type || "image/jpeg";
  const parsed = await callGemini([
    { text: TELLER_PROMPT },
    { inlineData: { mimeType, data } },
  ], key, TELLER_SCHEMA);

  return {
    beschreibung: String(parsed?.beschreibung || "").trim(),
    hinweis: String(parsed?.hinweis || "").trim(),
    posten: (parsed?.posten || [])
      .map(p => ({
        id: crypto.randomUUID(),
        name: String(p.name || "").trim(),
        grams: numOrNull(p.grams) ?? 0,
        sicher: p.sicher !== false,
        alternativen: (p.alternativen || []).map(a => String(a).trim()).filter(Boolean),
        per100: {
          kcal: numOrNull(p.kcal100),
          carbs: numOrNull(p.carbs100),
          fiber: numOrNull(p.fiber100),
          sugars: null,
          fat: numOrNull(p.fat100),
          saturatedFat: null,
          protein: numOrNull(p.protein100),
          salt: null,
        },
      }))
      .filter(p => p.name),
  };
}
