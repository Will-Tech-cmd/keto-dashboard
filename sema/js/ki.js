// ki.js — Fotoanalyse und KH-Schätzung über Gemini oder OpenAI, mit dem eigenen Key des Nutzers.
//
// Die Fehlerbehandlung folgt js/ai.js der Keto-App (dort an echten Fehlschlägen gelernt). Neu
// ist der zweite Anbieter. Beide Antworten werden hier auf dieselbe Form gebracht, damit der
// Rest der App nicht wissen muss, wer geantwortet hat.
//
// Grundsatz: DIE KI SCHÄTZT GRAMM UND KH JE 100 g, DIE APP RECHNET. KH in Gramm für die
// Portion kommen nie aus der Antwort, sondern aus gramm × kh100 — so bleibt jede Zahl auf dem
// Bildschirm nachvollziehbar und editierbar.

const GEMINI_MODELL = "gemini-3.6-flash";
// Falls OpenAI dieses Modell abkündigt, hier tauschen. Es muss Bilder annehmen und
// response_format json_object beherrschen.
const OPENAI_MODELL = "gpt-4o-mini";

const KH_DEFINITION =
  "KH = verwertbare Kohlenhydrate je 100 g, so wie sie auf EU-Nährwertangaben unter " +
  "„Kohlenhydrate“ stehen (Ballaststoffe sind dort bereits nicht enthalten).";

function fotoPrompt({ gewicht, favs }) {
  const zeilen = [
    "Du hilfst Eltern eines Kindes mit Typ-1-Diabetes, Kohlenhydrate (KH) einer Mahlzeit zu schätzen.",
    "Auf dem Foto ist eine Mahlzeit. Zerlege sie in ihre sichtbaren Bestandteile (z. B. Eissorten, Soße, Waffel getrennt).",
    "Für jeden Bestandteil:",
    "- name: Lebensmittel auf Deutsch, ohne Mengenangabe",
    "- gramm: geschätztes Gewicht dieses Bestandteils (Kinderportion, Größenvergleich mit Geschirr/Besteck)",
    `- kh100: ${KH_DEFINITION}`,
    "- konfidenz: Zahl zwischen 0 und 1, wie sicher Erkennung UND Menge sind",
    "gericht: kurzer Name der ganzen Mahlzeit, z. B. „Eisbecher“.",
  ];
  if (gewicht > 0) {
    zeilen.push(`Die Mahlzeit wurde gewogen: insgesamt ${gewicht} g (ohne Teller). Verteile GENAU dieses Gewicht auf die Bestandteile.`);
  }
  if (favs.length) {
    zeilen.push(
      "Diese Lebensmittel nutzt die Familie oft. Erkennst du eines davon, verwende genau diesen Namen und diesen KH-Wert:",
      ...favs.slice(0, 40).map((f) => `- ${f.name}${f.kh100 != null ? `: ${f.kh100} g KH je 100 g` : ""}`),
    );
  }
  zeilen.push(
    'Antworte ausschließlich mit JSON: {"gericht": string, "komponenten": [{"name": string, "gramm": number, "kh100": number, "konfidenz": number}]}',
  );
  return zeilen.join("\n");
}

function textPrompt(name) {
  return [
    "Du hilfst Eltern eines Kindes mit Typ-1-Diabetes, Kohlenhydrate (KH) zu schätzen.",
    `Lebensmittel: „${name}“. Nimm die übliche Form an (Obst roh, Nudeln gekocht, usw.).`,
    `kh100: ${KH_DEFINITION}`,
    "name: das Lebensmittel, so wie du es verstanden hast, z. B. „Birne, roh“.",
    "konfidenz: Zahl zwischen 0 und 1.",
    'Antworte ausschließlich mit JSON: {"name": string, "kh100": number, "konfidenz": number}',
  ].join("\n");
}

const GEMINI_FOTO_SCHEMA = {
  type: "OBJECT",
  properties: {
    gericht: { type: "STRING" },
    komponenten: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" }, gramm: { type: "NUMBER" },
          kh100: { type: "NUMBER" }, konfidenz: { type: "NUMBER" },
        },
        required: ["name", "gramm", "kh100", "konfidenz"],
      },
    },
  },
  required: ["gericht", "komponenten"],
};

const GEMINI_TEXT_SCHEMA = {
  type: "OBJECT",
  properties: { name: { type: "STRING" }, kh100: { type: "NUMBER" }, konfidenz: { type: "NUMBER" } },
  required: ["name", "kh100", "konfidenz"],
};

function fehler(text, art) {
  const e = new Error(text);
  e[art] = true;
  return e;
}

async function anfrage(url, init, anbieter) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw fehler(`Keine Verbindung zu ${anbieter} (offline?).`, "netz");
  }
  if (res.status === 401 || res.status === 403 || (anbieter === "Gemini" && res.status === 400)) {
    throw fehler(`API-Key wurde von ${anbieter} abgelehnt. Im Profil prüfen.`, "key");
  }
  if (res.status === 429) throw fehler(`${anbieter}: Kontingent erschöpft. Später erneut versuchen.`, "kontingent");
  if (!res.ok) throw fehler(`${anbieter} antwortete mit Status ${res.status}.`, "api");
  return res.json();
}

function jsonAusText(text, anbieter) {
  if (!text) throw fehler(`Keine verwertbare Antwort von ${anbieter}.`, "api");
  try {
    return JSON.parse(text);
  } catch {
    throw fehler(`Antwort von ${anbieter} war kein gültiges JSON.`, "api");
  }
}

async function gemini(key, parts, schema) {
  const json = await anfrage(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts }],
        // Großzügig: das Modell denkt vor dem Antworten und verbraucht sonst sein Budget,
        // bevor das JSON fertig ist (siehe js/ai.js).
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 8192 },
      }),
    },
    "Gemini",
  );
  return jsonAusText(json.candidates?.[0]?.content?.parts?.[0]?.text, "Gemini");
}

async function openai(key, content) {
  const json = await anfrage(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: OPENAI_MODELL,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    },
    "OpenAI",
  );
  return jsonAusText(json.choices?.[0]?.message?.content, "OpenAI");
}

const zahlOder = (v, ersatz) => (typeof v === "number" && Number.isFinite(v) ? v : ersatz);

/** Verkleinert das Foto: Handykameras liefern 4000 px, die Analyse braucht ein Viertel davon. */
async function fotoVorbereiten(datei, maxKante = 1280) {
  const bild = await createImageBitmap(datei);
  const f = Math.min(1, maxKante / Math.max(bild.width, bild.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bild.width * f);
  canvas.height = Math.round(bild.height * f);
  canvas.getContext("2d").drawImage(bild, 0, 0, canvas.width, canvas.height);
  bild.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { dataUrl, base64: dataUrl.split(",")[1] };
}

/**
 * @returns {{gericht: string, komponenten: {name: string, gramm: number, kh100: number, konfidenz: number}[]}}
 */
export async function fotoAnalysieren(datei, { anbieter, key, gewicht = 0, favs = [] }) {
  if (!key) throw fehler("Kein API-Key hinterlegt. Im Profil eintragen.", "keinKey");
  const { dataUrl, base64 } = await fotoVorbereiten(datei);
  const prompt = fotoPrompt({ gewicht, favs });
  const roh = anbieter === "OpenAI"
    ? await openai(key, [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }])
    : await gemini(key, [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64 } }], GEMINI_FOTO_SCHEMA);
  const komponenten = (roh.komponenten || [])
    .map((k) => ({
      name: String(k.name || "").trim(),
      gramm: Math.max(0, zahlOder(k.gramm, 0)),
      kh100: Math.max(0, zahlOder(k.kh100, 0)),
      konfidenz: Math.min(1, Math.max(0, zahlOder(k.konfidenz, 0.5))),
    }))
    .filter((k) => k.name);
  if (!komponenten.length) throw fehler("Auf dem Foto wurde nichts Essbares erkannt.", "leer");
  return { gericht: String(roh.gericht || "Mahlzeit").trim(), komponenten };
}

/** @returns {{name: string, kh100: number, konfidenz: number}} */
export async function khSchaetzen(name, { anbieter, key }) {
  if (!key) throw fehler("Kein API-Key hinterlegt. Im Profil eintragen.", "keinKey");
  const prompt = textPrompt(name);
  const roh = anbieter === "OpenAI"
    ? await openai(key, prompt)
    : await gemini(key, [{ text: prompt }], GEMINI_TEXT_SCHEMA);
  const kh100 = zahlOder(roh.kh100, null);
  if (kh100 == null || kh100 < 0 || kh100 > 100) throw fehler("Die KI lieferte keinen plausiblen Wert.", "api");
  return {
    name: String(roh.name || name).trim(),
    kh100,
    konfidenz: Math.min(1, Math.max(0, zahlOder(roh.konfidenz, 0.5))),
  };
}
