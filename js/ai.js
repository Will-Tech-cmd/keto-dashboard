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

async function callGemini(parts, key) {
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
          responseSchema: INGREDIENT_SCHEMA,
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

  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    const err = new Error("Antwort von Gemini war kein gültiges JSON.");
    err.apiError = true;
    throw err;
  }

  return (parsed.ingredients || [])
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
  const key = getApiKey();
  if (!key) {
    const err = new Error("Kein Gemini-API-Schlüssel hinterlegt.");
    err.noKey = true;
    throw err;
  }
  return callGemini([{ text: `${PROMPT}\n\nZutatenliste:\n${text}` }], key);
}

/**
 * Schickt ein Bild direkt an Gemini (multimodal) — liest die Zutatenliste unmittelbar aus dem
 * Foto, ohne den Umweg über die lokale Texterkennung. Oft genauer als Tesseract bei schlecht
 * lesbaren Screenshots.
 */
export async function recognizeIngredientsFromImage(file) {
  const key = getApiKey();
  if (!key) {
    const err = new Error("Kein Gemini-API-Schlüssel hinterlegt.");
    err.noKey = true;
    throw err;
  }
  // Sehr hohe Scrolling-Screenshots vorher verkleinern — sonst wird der Base64-Upload
  // unnötig riesig (und kann Gemini's Größenlimit für inlineData reißen).
  const prepared = await downscaleImageIfNeeded(file);
  const data = await fileToBase64(prepared);
  const mimeType = prepared.type || file.type || "image/jpeg";
  return callGemini([
    { text: PROMPT },
    { inlineData: { mimeType, data } },
  ], key);
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
