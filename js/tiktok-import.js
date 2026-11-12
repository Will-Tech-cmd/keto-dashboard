// tiktok-import.js — „Teilen → Keto" aus TikTok: Link entgegennehmen, Beschreibung über die
// Edge Function holen, Rezept erkennen (Gemini, sonst Textzerlegung aus tiktok.js) und den
// Rezept-Editor mit der Prüfansicht öffnen. Die Zutaten landen erst nach „Zutaten
// übernehmen" im Rezept — Zubereitung und Quelle stehen sofort drin.
//
// Weg der Daten: TikTok „Teilen" → Android öffnet die installierte App mit
// index.html?title=&text=&url= (manifest.webmanifest, share_target) → app.js erkennt das
// (tiktok.js, geteiltesAus) → hier.
import { REST, istAngemeldet, anfrage } from "./supabase.js";
import { hasApiKey, erkenneRezept, describeAiError } from "./ai.js";
import { zerlegeBeschreibung, kombiniere } from "./tiktok.js";
import { oeffneImportiertesRezept } from "./views/recipes.js";
import { showToast, esc, bindBackClose } from "./ui.js";
import { ikon } from "./ikonen.js";

// Die Edge Function liegt unter demselben Host wie REST — der steht schon in der CSP
// (connect-src) von index.html, ein neuer Eintrag ist nicht nötig.
const FUNKTION_URL = `${REST.replace(/\/rest\/v1$/, "")}/functions/v1/tiktok-rezept`;

/** Beschreibung + Autor zu einem TikTok-Link vom Server holen. Wirft mit lesbarer Meldung. */
export async function holeBeschreibung(link) {
  if (!istAngemeldet()) {
    throw new Error("Dafür muss der Abgleich angemeldet sein (Profil → Abgleich).");
  }
  const res = await anfrage(FUNKTION_URL, { method: "POST", body: JSON.stringify({ url: link }) });
  let daten = {};
  try { daten = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (!res.ok || !daten.text) {
    throw new Error(daten.fehler || `Server antwortet mit ${res.status}.`);
  }
  return { text: daten.text, autor: daten.autor || "", url: daten.url || link };
}

/**
 * Aus der Beschreibung ein Rezept machen. Mit Gemini-Schlüssel erkennt das Modell Name,
 * Zutaten (samt Nährwerten) und Schritte; schlägt das fehl oder fehlt der Schlüssel,
 * zerlegt tiktok.js den Text und die Zutaten laufen durch den Zeilen-Parser mit Zuordnung
 * über die eingebaute Lebensmitteltabelle (wie „Text einfügen → Zeilen prüfen").
 */
export async function rezeptAusBeschreibung(beschreibung, { titel = "", diagnose = null } = {}) {
  const z = zerlegeBeschreibung(beschreibung, { titel });
  if (diagnose) diagnose.text = { name: z.name, servings: z.servings, zutaten: z.zutatenZeilen, schritte: z.schritte };
  let ki = null;
  if (hasApiKey()) {
    const protokoll = {};
    try {
      ki = await erkenneRezept(beschreibung, { protokoll });
      if (diagnose) diagnose.ki = { ...protokoll, name: ki.name, servings: ki.servings, zutaten: ki.ingredients.map(i => `${i.name} ${i.grams ?? "?"} g${i.stueck ? ` / ${i.stueck} Stk` : ""}`), schritte: ki.steps };
    } catch (err) {
      if (diagnose) diagnose.ki = { ...protokoll, fehler: describeAiError(err) };
      console.warn("Gemini-Erkennung fehlgeschlagen, nehme Textzerlegung:", describeAiError(err));
    }
  } else if (diagnose) {
    diagnose.ki = { fehler: "kein Schlüssel hinterlegt" };
  }
  const r = kombiniere(ki, z);
  if (diagnose) diagnose.ergebnis = { weg: r.weg, grund: r.grund, name: r.name, servings: r.servings, zutaten: r.ingredients ? r.ingredients.length : z.zutatenZeilen.length, schritte: r.steps.length };
  return r;
}

// ---------------------------------------------------------------------------
// Diagnose: was kam von TikTok, was von Gemini, was wurde daraus. Bleibt nur für den
// letzten Import liegen (ein Eintrag im localStorage) und lässt sich im Profil unter
// „KI" kopieren oder teilen — so lässt sich ein leeres Rezept nachvollziehen, ohne am
// Handy eine Entwicklerkonsole zu brauchen.
// ---------------------------------------------------------------------------
const DIAGNOSE_KEY = "keto-dashboard-tiktok-diagnose";

function diagnoseSpeichern(d) {
  try { localStorage.setItem(DIAGNOSE_KEY, JSON.stringify(d)); } catch { /* voll oder gesperrt — dann eben keine Diagnose */ }
}

/** Die Diagnose des letzten Imports, oder null. */
export function letzteDiagnose() {
  try { return JSON.parse(localStorage.getItem(DIAGNOSE_KEY)) || null; } catch { return null; }
}

/** Als Text zum Kopieren/Teilen — JSON mit Einrückung, der Rohtext von Gemini am Ende. */
export function diagnoseText() {
  const d = letzteDiagnose();
  if (!d) return "";
  const { ki, ...rest } = d;
  const { rohtext, ...kiRest } = ki || {};
  return `${JSON.stringify({ ...rest, ki: ki ? kiRest : null }, null, 2)}${rohtext ? `\n\n--- Gemini-Rohantwort ---\n${rohtext}` : ""}`;
}

/**
 * Einstieg aus app.js. `geteilt` kommt aus geteiltesAus(); `goToTab` wechselt danach auf
 * den Rezepte-Reiter, wo der Editor mit der Prüfansicht wartet.
 */
export async function starteGeteiltesRezept(geteilt, goToTab) {
  const overlay = document.createElement("div");
  overlay.className = "klar-sheet-overlay";
  overlay.innerHTML = `
    <div class="klar-sheet">
      <div class="klar-sheet-handle"></div>
      <div class="klar-sheet-title">Rezept aus TikTok</div>
      <div class="klar-sheet-sub" id="ttStatus">Beschreibung wird geholt …</div>
      <div id="ttFehler" style="display:none"></div>
      <div class="btn-row" style="margin-top:14px">
        <button type="button" class="btn secondary" id="ttCancel">Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const status = overlay.querySelector("#ttStatus");
  const close = bindBackClose(() => overlay.remove());
  overlay.querySelector("#ttCancel").addEventListener("click", close);

  const zeigeFehler = (meldung, beschreibung) => {
    status.textContent = "Das hat nicht geklappt.";
    const box = overlay.querySelector("#ttFehler");
    box.style.display = "block";
    box.innerHTML = `
      <div class="klar-warnung" style="margin-top:12px">${esc(meldung)}</div>
      ${beschreibung ? `<button type="button" class="btn" id="ttTrotzdem" style="margin-top:12px">${ikon("text", { groesse: 17 })} Text trotzdem prüfen</button>` : ""}
    `;
    box.querySelector("#ttTrotzdem")?.addEventListener("click", () => {
      const z = zerlegeBeschreibung(beschreibung, { titel: geteilt.title });
      oeffneImportiertesRezept({ name: z.name, servings: z.servings, steps: z.schritte, quelle: quelleAus(geteilt, null), ingredientsText: z.zutatenZeilen.join("\n") });
      // Erst navigieren, wenn der History-Eintrag des Blatts weg ist (siehe ui.js,
      // bindBackClose): sonst wirft dessen verspätetes popstate den frisch geöffneten
      // Rezept-Editor gleich wieder zu.
      close(() => goToTab("recipes"));
    });
  };

  let beschreibung = null, quelle = null;
  const diagnose = { zeit: new Date().toISOString(), version: 1, geteilt: { title: geteilt.title, text: geteilt.text, url: geteilt.url, link: geteilt.link } };
  try {
    if (geteilt.link) {
      const b = await holeBeschreibung(geteilt.link);
      beschreibung = b.text;
      quelle = quelleAus(geteilt, b);
      diagnose.tiktok = { url: b.url, autor: b.autor, beschreibung: b.text };
    } else if (geteilt.text && geteilt.text.replace(/https?:\/\/\S+/g, "").trim().length >= 20) {
      // Kein TikTok-Link, aber Text (z.B. aus einer Notiz geteilt): direkt als Beschreibung
      // nehmen. Ein nackter fremder Link zählt nicht — daraus würde ein leeres Rezept mit
      // der Adresse als Namen.
      beschreibung = geteilt.text;
      quelle = null;
    } else {
      zeigeFehler("Im Geteilten war kein TikTok-Link und kein Rezepttext.");
      return;
    }
    status.textContent = hasApiKey() ? "Gemini liest Zutaten und Zubereitung …" : "Zutaten und Zubereitung werden erkannt …";
    const r = await rezeptAusBeschreibung(beschreibung, { titel: geteilt.title, diagnose });
    diagnoseSpeichern(diagnose);
    oeffneImportiertesRezept({ ...r, quelle });
    close(() => {
      goToTab("recipes");
      showToast(r.weg === "ki"
        ? `${r.ingredients.length} Zutaten erkannt — bitte prüfen und übernehmen`
        : r.weg === "gemischt"
          ? "KI-Antwort unvollständig — Lücken aus dem Text gefüllt, bitte prüfen"
          : "Zutaten erkannt — Mengen und Zuordnung bitte prüfen");
    });
  } catch (err) {
    diagnose.fehler = err.message || String(err);
    diagnoseSpeichern(diagnose);
    // „Text trotzdem prüfen" nur, wenn außer dem Link noch Text da ist — der nackte Link
    // ergäbe ein leeres Rezept.
    const rest = (beschreibung || geteilt.text || "").replace(/https?:\/\/\S+/g, "").trim();
    zeigeFehler(err.message || String(err), rest.length >= 20 ? (beschreibung || geteilt.text) : null);
  }
}

function quelleAus(geteilt, b) {
  if (!geteilt.link) return null;
  return { art: "tiktok", url: b?.url || geteilt.link, autor: b?.autor || "" };
}
