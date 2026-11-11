// tiktok.js — was aus einem geteilten TikTok-Link bzw. einer Videobeschreibung ein Rezept
// macht. Reine Textarbeit ohne Netz und ohne Store, damit test/tiktok.test.mjs sie gegen
// echte Beschreibungen prüfen kann. Den Abruf der Beschreibung macht die Edge Function
// (supabase/functions/tiktok-rezept), die Oberfläche tiktok-import.js.
//
// Was TikTok liefert: EINEN Absatz ohne Zeilenumbrüche. „Zutaten: 200g Hüttenkäse 1 Ei 3-4 EL
// Tomaten … Zubereitung: Ofen vorheizen. Käse und Ei mixen. …" — die Umbrüche, die der
// Ersteller getippt hat, sind weg. Der Zeilen-Parser (ingredient-parser.js) bekäme also eine
// einzige Riesenzeile. Deshalb zerlegt dieses Modul den Absatz vorher: Zutaten an den
// Mengenangaben, Schritte an Nummern oder Satzenden. Mit Gemini-Schlüssel übernimmt das
// Modell diese Arbeit (ai.js, erkenneRezept) — hier ist der Weg ohne Schlüssel.

const LINK = /https?:\/\/(?:www\.|vm\.|vt\.|m\.)?tiktok\.com\/[^\s"'<>]+/i;

/** Der erste TikTok-Link in einem Text, oder null. */
export function tiktokLinkAus(text) {
  const m = LINK.exec(String(text || ""));
  return m ? m[0].replace(/[),.;!?]+$/, "") : null;
}

/**
 * Das, was ein Teilen-Dialog an ?title=&text=&url= mitgibt (manifest.webmanifest,
 * share_target). TikTok schickt den Link mal in `url`, mal in `text` — beide ansehen.
 * null, wenn die URL gar nichts Geteiltes trägt (normaler Start, Homescreen-Shortcut).
 */
export function geteiltesAus(params) {
  const title = params.get("title") || "";
  const text = params.get("text") || "";
  const url = params.get("url") || "";
  if (!title && !text && !url) return null;
  return { title, text, url, link: tiktokLinkAus(url) || tiktokLinkAus(text) || tiktokLinkAus(title) };
}

const BRUECHE = { "½": "0,5", "¼": "0,25", "¾": "0,75", "⅓": "0,33", "⅔": "0,66", "⅛": "0,125" };

/** Hashtags und Mehrfach-Leerzeichen weg, Bruchzeichen zu Zahlen — der Rest bleibt. */
export function bereinigeBeschreibung(desc) {
  return String(desc || "")
    .replace(/[½¼¾⅓⅔⅛]/g, (z) => `${BRUECHE[z]} `)
    .replace(/#[^\s#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Die Marke frisst alles bis zum Doppelpunkt mit („Zutaten für 2 Toast:", „Zubereitung vom
// Keto Rezept:"), aber nie über ein Satzende hinweg. Ohne Doppelpunkt zählt „Zutaten" nur,
// wenn direkt eine Zahl folgt — „aus nur 5 Zutaten." in der Einleitung ist keine Liste.
const ZUTATEN_MARKE = /\b(?:zutaten|du brauchst|ihr braucht|ingredients)\b(?:[^:.!?]{0,40}:|\s*(?=\d))/i;
const SCHRITTE_MARKE = /\b(?:zubereitung|anleitung|so geht'?s|zubereiten|instructions|method)\b(?:[^:.!?]{0,40}:)?/i;
const ENDE_MARKE = /\b(tipp|hinweis|folgt? mir|speicher|abonnier|kommentier|link in (?:der )?bio|rezept speichern)\b/i;

// Wo im Fließtext eine neue Zutat beginnt: eine Zahl (auch 3-4, 1,5, 0,5) oder „etwas",
// „eine Prise", „Prise", „einige". Dahinter muss ein Wort folgen, sonst ist es eine Zahl
// im Satz („180 Grad" fängt keine Zutat an — das steht aber in der Zubereitung, nicht hier).
const ZUTAT_START = /(?:^|\s)(?=(?:\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?|etwas|eine? prise|prise|einige|ein paar|eine? handvoll)\s*\S)/gi;

function teile(text, marke) {
  const m = marke.exec(text);
  if (!m) return null;
  return { vor: text.slice(0, m.index), nach: text.slice(m.index + m[0].length) };
}

/**
 * Zerlegt eine bereinigte Beschreibung in Name, Portionen, Zutatenzeilen und Schritte.
 * Alles Vermutung — die Prüfansicht im Rezept zeigt das Ergebnis, bevor etwas gespeichert
 * wird. Ohne „Zutaten:"-Marke werden nur Stücke mit Mengenangabe als Zutat genommen.
 */
export function zerlegeBeschreibung(desc, { titel = "" } = {}) {
  const text = bereinigeBeschreibung(desc);

  // Reihenfolge im Text: [Intro] Zutaten: … Zubereitung: … [Tipp/Werbung]
  let intro = text, zutatenTeil = "", schritteTeil = "";
  const z = teile(text, ZUTATEN_MARKE);
  if (z) { intro = z.vor; zutatenTeil = z.nach; }
  const s = teile(z ? z.nach : text, SCHRITTE_MARKE);
  if (s) {
    if (z) zutatenTeil = s.vor; else intro = s.vor;
    schritteTeil = s.nach;
  }
  if (!z && !s) zutatenTeil = text; // keine Marken: alles nach Mengenangaben absuchen

  const e = teile(schritteTeil || zutatenTeil, ENDE_MARKE);
  if (e) { if (schritteTeil) schritteTeil = e.vor; else zutatenTeil = e.vor; }

  const zutatenZeilen = zutatenAus(zutatenTeil, { nurMitMenge: !z });
  const schritte = schritteAus(schritteTeil);

  return {
    name: rezeptnameAus(intro, titel),
    servings: portionenAus(text),
    zutatenZeilen,
    schritte,
  };
}

/** Fließtext → eine Zeile je Zutat, geteilt vor jeder Mengenangabe. */
export function zutatenAus(teil, { nurMitMenge = false } = {}) {
  const ohneKlammern = String(teil || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!ohneKlammern) return [];
  const stuecke = ohneKlammern.split(ZUTAT_START).map(x => x.trim()).filter(Boolean);
  const zeilen = [];
  for (let i = 0; i < stuecke.length; i++) {
    let st = stuecke[i];
    const hatMenge = /^(\d|etwas|eine? prise|prise|einige|ein paar|eine? handvoll)/i.test(st);
    // Das erste Stück vor der ersten Menge ist Einleitung („Für den Teig"), keine Zutat.
    if (i === 0 && !hatMenge) continue;
    if (nurMitMenge && !hatMenge) continue;
    // Ein Satzende mitten im Stück heißt: danach beginnt Fließtext, keine Zutat mehr.
    st = st.replace(/\.\s.*$/, "").replace(/[.,;:]+$/, "").trim();
    // Mehr als ~7 Wörter nach der Menge sind kein Zutatenname mehr, sondern ein Satz,
    // der ohne Umbruch an die letzte Zutat geklebt ist („Etwas Käse nach Wahl Wenn du …").
    const woerter = st.split(" ");
    if (woerter.length > 8) st = woerter.slice(0, 8).join(" ");
    if (st.length >= 2) zeilen.push(st);
  }
  return zeilen;
}

/** Schritte: an „1. 2. 3." geteilt, sonst an Satzenden. */
export function schritteAus(teil) {
  const t = String(teil || "").trim();
  if (!t) return [];
  let stuecke;
  if (/(^|\s)1\.\s/.test(t) && /\s2\.\s/.test(t)) {
    stuecke = t.split(/\s(?=\d{1,2}\.\s)/).map(x => x.replace(/^\d{1,2}\.\s*/, ""));
  } else {
    stuecke = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  }
  return stuecke
    .map(x => x.trim().replace(/^[-–•]\s*/, ""))
    .filter(x => x.length > 3 && /\p{L}/u.test(x));
}

/** Der erste Satz der Einleitung, gekürzt — sonst der geteilte Titel, sonst „TikTok-Rezept". */
export function rezeptnameAus(intro, titel = "") {
  const satz = String(intro || "").split(/[.!?:]\s/)[0]?.trim() || "";
  const kandidat = satz.length >= 4 ? satz : String(titel || "").trim();
  if (!kandidat) return "TikTok-Rezept";
  const kurz = kandidat.replace(/\s*[|–-]\s*(tiktok|rezept).*$/i, "").trim();
  return kurz.length > 60 ? `${kurz.slice(0, 57).trim()}…` : kurz;
}

/** „Ergibt 4 Brötchen", „für 2 Portionen", „Zutaten für 2 Toast" → 4 / 2 / 2; sonst 1. */
export function portionenAus(text) {
  const m = /\b(?:ergibt|reicht für|für)\s+(\d{1,2})\s+(?:portionen|personen|stück|brötchen|toast|waffeln|muffins|pancakes|stk)/i.exec(text || "")
    || /\bergibt\s+(\d{1,2})\b/i.exec(text || "");
  const n = m ? parseInt(m[1], 10) : 0;
  return n > 0 && n <= 50 ? n : 1;
}
