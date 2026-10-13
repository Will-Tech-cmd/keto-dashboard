// logik.js — alles, was rechnet und nichts anzeigt. Bewusst ohne DOM und ohne Speicher, damit
// die Tests unter test/sema.test.mjs es in Node direkt laden können.

export const MAHLZEITEN = ["Frühstück", "Mittag", "Snack", "Abend"];
export const TAGE_BEHALTEN = 7;

export const zahl = (s) => {
  const v = parseFloat(String(s ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

// Angezeigt werden ganze Gramm — so, wie es in die Pumpe kommt. Gerundet wird NUR hier, beim
// Anzeigen. Summen entstehen immer aus den ungerundeten Werten (siehe summeKh), sonst addieren
// sich fünf aufgerundete Bestandteile zu zwei Gramm zu viel.
export const r0 = (x) => String(Math.round(x));
export const r1 = (x) => (Math.round(x * 10) / 10).toString().replace(".", ",");

export const summeKh = (liste) => liste.reduce((a, e) => a + (Number(e.kh) || 0), 0);

/** Lokales Datum als YYYY-MM-DD. toISOString() wäre UTC — nach 22 Uhr im Sommer schon „morgen“. */
export function tagSchluessel(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function tagVerschieben(schluessel, tage) {
  const [y, m, d] = schluessel.split("-").map(Number);
  // Mittags rechnen: so kippt eine Zeitumstellung den Tag nie.
  return tagSchluessel(new Date(y, m - 1, d + tage, 12));
}

/** Einträge älter als sieben Tage (heute eingeschlossen) fallen weg. */
export function altesEntfernen(eintraege, heute = tagSchluessel()) {
  const grenze = tagVerschieben(heute, -(TAGE_BEHALTEN - 1));
  return eintraege.filter((e) => e.date >= grenze);
}

/**
 * „Birne 50 g“ → { name: "Birne", gramm: 50 }. Ohne Zahl bleibt gramm null.
 * Die Zahl muss am Ende stehen: „7-Korn-Brot“ ist ein Name, keine Mengenangabe.
 */
export function sucheZerlegen(eingabe) {
  const q = String(eingabe ?? "").trim();
  const m = q.match(/^(.*?)[\s,]+(\d+(?:[.,]\d+)?)\s*(g|gramm)?$/i);
  if (m && m[1].trim()) return { name: m[1].trim(), gramm: zahl(m[2]) };
  return { name: q, gramm: null };
}

/**
 * KH einer Favoriten-Portion. Ein Favorit trägt ENTWEDER KH je 100 g (dann braucht er das
 * Portionsgewicht) ODER KH je Portion — so steht es auf vielen Packungen nur so oder so.
 */
export function favKhJePortion(f) {
  if (f.khPortion != null && f.khPortion !== "") return Number(f.khPortion) || 0;
  if (f.kh100 != null && f.portionG) return (Number(f.kh100) * Number(f.portionG)) / 100;
  return 0;
}

/** KH für eine Grammzahl — nur möglich, wenn der Favorit KH je 100 g kennt. */
export function favKhFuerGramm(f, gramm) {
  if (f.kh100 != null && f.kh100 !== "") return (Number(f.kh100) * gramm) / 100;
  if (f.khPortion != null && f.portionG) return (Number(f.khPortion) * gramm) / Number(f.portionG);
  return null;
}

export function favPortionText(f, menge = 1) {
  const g = f.portionG ? ` (${r0(f.portionG * menge)} g)` : "";
  return `${r1(menge)} ${f.unit || "Portion"}${g}`;
}

/**
 * Spanne einer Foto-Schätzung. Je unsicherer ein Bestandteil, desto weiter seine Spanne:
 * bei 80 % Konfidenz ±20 %. Die KI selbst um min/max zu bitten wurde verworfen — die Zahlen
 * kamen dabei oft symmetrisch um die Schätzung gewürfelt und sagten nichts zusätzlich.
 */
export function fotoSpanne(komponenten) {
  let min = 0, max = 0, summe = 0;
  for (const k of komponenten) {
    const kh = k.kh;
    const c = Math.min(1, Math.max(0, Number(k.konfidenz) || 0));
    summe += kh;
    min += kh * c;
    max += kh * (2 - c);
  }
  return { summe, min, max };
}

/**
 * Verteilt ein gewogenes Gesamtgewicht anteilig auf die geschätzten Bestandteile. Die KI
 * bekommt das Gewicht zwar schon mitgeschickt, hält sich aber nicht immer genau daran — die
 * App sorgt dafür, dass die Summe wirklich stimmt.
 */
export function aufGewichtVerteilen(komponenten, gesamt) {
  const basis = komponenten.reduce((a, k) => a + k.gramm, 0);
  if (!(gesamt > 0) || !(basis > 0)) return komponenten;
  return komponenten.map((k) => ({ ...k, gramm: (k.gramm * gesamt) / basis }));
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

export const EXPORT_FORMAT = "sema-backup";

/**
 * Der API-Key bleibt draußen: die Datei geht an die Kita, der Key ist persönlich.
 * Von der Lebensmittel-Liste gehen nur bearbeitete Einträge mit (updatedAt > 0) — die
 * unveränderten Richtwerte hat jedes Gerät ohnehin, und so bleibt sichtbar, was die Eltern
 * tatsächlich geprüft haben.
 */
export function exportDaten({ favs, profil, einstellungen, grund = [], behaelter = [] }) {
  return {
    format: EXPORT_FORMAT,
    version: 2,
    exportiert: new Date().toISOString(),
    favs,
    grund: grund.filter((g) => (g.updatedAt || 0) > 0),
    behaelter,
    profil,
    einstellungen: { anbieter: einstellungen.anbieter },
  };
}

/**
 * Führt importierte Favoriten mit den vorhandenen zusammen. Gleiche id → die jüngere Fassung
 * (updatedAt) gewinnt; ohne Zeitstempel gewänne stumm irgendeine. Ersetzen statt zusammenführen
 * wurde verworfen: dann löscht der Import bei Sandra jeden Favoriten, den nur sie angelegt hat.
 */
export function favsZusammenfuehren(vorhanden, neu) {
  const nachId = new Map(vorhanden.map((f) => [f.id, f]));
  let geaendert = 0;
  for (const f of neu) {
    if (!f || typeof f.name !== "string" || !f.id) continue;
    const alt = nachId.get(f.id);
    if (!alt || (f.updatedAt || 0) > (alt.updatedAt || 0)) {
      nachId.set(f.id, f);
      geaendert++;
    }
  }
  return { favs: [...nachId.values()], geaendert };
}

/** Gleiche Regel für Lebensmittel-Liste und Behälter: id + jüngere Fassung gewinnt. */
export const listenZusammenfuehren = favsZusammenfuehren;

export function importPruefen(obj) {
  if (!obj || obj.format !== EXPORT_FORMAT || !Array.isArray(obj.favs)) {
    throw new Error("Keine Sema-Sicherungsdatei.");
  }
  // Version-1-Dateien (vor Lebensmittel-Liste und Behältern) bleiben lesbar.
  if (!Array.isArray(obj.grund)) obj.grund = [];
  if (!Array.isArray(obj.behaelter)) obj.behaelter = [];
  return obj;
}

// ---------------------------------------------------------------------------
// Lebensmittel-Liste (Grunddaten)
// ---------------------------------------------------------------------------

/**
 * Ergänzt die gespeicherte Liste um Startwerte, deren id noch fehlt. Vorhandene Einträge
 * bleiben unangetastet — auch wenn der Startwert inzwischen ein anderer ist: ein von den
 * Eltern bestätigter oder geänderter Wert darf durch ein App-Update nie still überschrieben
 * werden.
 */
export function grundErgaenzen(vorhanden, startwerte) {
  const ids = new Set(vorhanden.map((g) => g.id));
  const neu = startwerte.filter((g) => !ids.has(g.id)).map((g) => ({ ...g }));
  return { liste: [...vorhanden, ...neu], neu: neu.length };
}

/** „Reis (gekocht)“ — der Zustand gehört sichtbar zum Namen, roh/gekocht ist der Faktor ~3. */
export function grundName(g) {
  return g.zustand ? `${g.name} (${g.zustand})` : g.name;
}

export const grundHatWert = (g) => g.kh100 != null && g.kh100 !== "" && Number.isFinite(Number(g.kh100));

// ---------------------------------------------------------------------------
// Bekannte Werte finden (für Zutaten und den KI-Abgleich)
// ---------------------------------------------------------------------------

// Klammern fallen weg, ihr INHALT bleibt: „Reis (roh)“ → „reis roh“. Eine frühere Fassung
// strich den Klammerinhalt mit und machte so aus „Reis (roh)“ den gekochten Reis — Faktor ~3.
const normName = (s) => String(s ?? "").toLowerCase().replace(/[^a-zäöüß0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Sucht zu einem Namen einen bekannten KH-Wert je 100 g. Reihenfolge wie in der Suche:
 * Favoriten vor bestätigten Grundwerten vor gescannten Produkten vor Richtwerten.
 * Gleichheit schlägt Enthaltensein; Enthaltensein erst ab vier Buchstaben, sonst passt „Ei“
 * auf „Eis“ und „Reis“.
 *
 * Passen mehrere Einträge mit verschiedenen Werten nur über Enthaltensein („Reis“ →
 * „Reis roh“ 78 und „Reis gekocht“ 28), gibt es KEINEN Treffer: lieber den Wert von Hand
 * eintragen lassen, als still den falschen Zustand zu nehmen.
 */
export function bekanntenWertFinden(name, { favs = [], grund = [], produkte = [] }) {
  const n = normName(name);
  if (n.length < 2) return null;
  const kandidaten = [
    ...favs.filter((f) => f.kh100 != null && f.kh100 !== "").map((f) => ({ name: f.name, kh100: Number(f.kh100), quelle: "Favorit" })),
    ...grund.filter((g) => g.verifiziert && grundHatWert(g)).map((g) => ({ name: grundName(g), kh100: Number(g.kh100), quelle: "Liste · bestätigt" })),
    ...produkte.filter((p) => p.kh100 != null).map((p) => ({ name: p.name, kh100: Number(p.kh100), quelle: "Gescannt" })),
    ...grund.filter((g) => !g.verifiziert && grundHatWert(g)).map((g) => ({ name: grundName(g), kh100: Number(g.kh100), quelle: "Richtwert" })),
  ];
  const gleich = kandidaten.find((k) => normName(k.name) === n);
  if (gleich) return gleich;
  if (n.length < 4) return null;
  const teil = kandidaten.filter((k) => {
    const kn = normName(k.name);
    return kn.length >= 4 && (kn.includes(n) || n.includes(kn));
  });
  if (!teil.length) return null;
  const werte = new Set(teil.map((k) => k.kh100));
  return werte.size === 1 ? teil[0] : null;
}

/** Relative Abweichung einer Schätzung von einem bekannten Wert. */
export function abweichung(schaetzung, bekannt) {
  if (!(bekannt > 0)) return schaetzung > 0 ? Infinity : 0;
  return Math.abs(schaetzung - bekannt) / bekannt;
}

export const KI_ABWEICHUNG_GRENZE = 0.2;

// ---------------------------------------------------------------------------
// Plausibilität
// ---------------------------------------------------------------------------

export const GRAMM_UNGEWOEHNLICH = 1000;

/**
 * Warnungen, keine Sperren: ein seltsamer Wert kann richtig sein (1,2 kg Wassermelone), aber
 * ein Tippfehler (500 statt 50) soll auffallen, bevor er in die Pumpe geht.
 */
export function plausibilitaet({ kh100 = null, gramm = null } = {}) {
  const w = [];
  if (kh100 != null && kh100 !== "") {
    const k = Number(kh100);
    if (k > 100) w.push("Mehr als 100 g KH je 100 g ist nicht möglich – Wert prüfen.");
    else if (k < 0) w.push("KH-Wert ist negativ.");
  }
  if (gramm != null && Number(gramm) > GRAMM_UNGEWOEHNLICH) w.push(`Über ${GRAMM_UNGEWOEHNLICH} g für eine Portion – Menge prüfen.`);
  return w;
}

/** Hinweis, wenn eine Mahlzeit die eingestellte Grenze überschreitet. Leer/0 = aus. */
export function mahlzeitUeberGrenze(summe, grenze) {
  const g = zahl(grenze);
  return g > 0 && summe > g;
}

// ---------------------------------------------------------------------------
// Teilverzehr
// ---------------------------------------------------------------------------

/**
 * Setzt den gegessenen Anteil eines Eintrags. Der Anteil bezieht sich immer auf die
 * ursprüngliche Eingabe (khUrspruenglich), nicht auf den letzten Stand — sonst würde
 * „½“ zweimal getippt zu ¼, und ein Korrigieren von ½ auf ¾ wäre unmöglich.
 */
export function teilVerzehr(eintrag, anteil) {
  const a = Math.min(1, Math.max(0, Number(anteil)));
  const ursprung = eintrag.khUrspruenglich ?? eintrag.kh;
  if (a >= 1) {
    const { khUrspruenglich, anteil: _a, ...rest } = eintrag;
    return { ...rest, kh: ursprung };
  }
  return { ...eintrag, khUrspruenglich: ursprung, anteil: a, kh: ursprung * a };
}

/** Anteil aus dem gewogenen Rest. null, wenn das Ausgangsgewicht unbekannt ist. */
export function anteilAusRest(grammGesamt, rest) {
  const g = Number(grammGesamt), r = zahl(rest);
  if (!(g > 0)) return null;
  return Math.min(1, Math.max(0, (g - r) / g));
}

export function anteilText(a) {
  const bekannt = { 0.25: "¼", 0.5: "½", 0.75: "¾", 0: "nichts" };
  return bekannt[a] ?? `${Math.round(a * 100)} %`;
}

// ---------------------------------------------------------------------------
// Eigene Gerichte
// ---------------------------------------------------------------------------

/**
 * KH je 100 g eines selbst gekochten Gerichts: Summe der Zutaten-KH durch das Gewicht des
 * FERTIGEN Gerichts. Das Rohgewicht der Zutaten taugt nicht als Nenner — Nudeln und Reis
 * nehmen Wasser auf, Soßen verkochen; daran scheitert die Rechnung sonst um den Faktor 2–3.
 */
export function rezeptRechnen(zutaten, endGramm) {
  let khGesamt = 0, rohG = 0;
  for (const z of zutaten) {
    const g = zahl(z.gStr ?? z.gramm), k = zahl(z.kh100Str ?? z.kh100);
    rohG += g;
    khGesamt += (g * k) / 100;
  }
  const end = zahl(endGramm);
  return { khGesamt, rohG, kh100: end > 0 ? (khGesamt / end) * 100 : null };
}

// ---------------------------------------------------------------------------
// Behälter (Tara)
// ---------------------------------------------------------------------------

export function taraAbziehen(wert, tara) {
  return Math.max(0, zahl(wert) - zahl(tara));
}

// ---------------------------------------------------------------------------
// Teilen
// ---------------------------------------------------------------------------

const uhrzeit = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * Text für WhatsApp & Co. Uhrzeit je Mahlzeit (frühester Eintrag), damit die Eltern den
 * Verlauf neben die Dexcom-Kurve legen können. Teilverzehr und KI-Schätzungen sind markiert —
 * genau die beiden Stellen, an denen Eltern nachfragen würden.
 */
export function teilenText({ titel, eintraege, mahlzeiten = MAHLZEITEN }) {
  const zeilen = [titel];
  for (const m of mahlzeiten) {
    const items = eintraege.filter((e) => e.meal === m);
    if (!items.length) continue;
    const zeit = uhrzeit(Math.min(...items.map((e) => e.createdAt || Date.now())));
    zeilen.push("", `${zeit} ${m}: ${r0(summeKh(items))} g KH`);
    for (const e of items) {
      const zusatz = [];
      if (e.anteil != null) zusatz.push(`${anteilText(e.anteil)} gegessen, eingegeben ${r0(e.khUrspruenglich)} g`);
      if (e.src === "ki") zusatz.push("KI geschätzt");
      zeilen.push(`• ${e.name}, ${e.amount}: ${r0(e.kh)} g${zusatz.length ? ` (${zusatz.join(", ")})` : ""}`);
    }
  }
  if (eintraege.length > 1 && new Set(eintraege.map((e) => e.meal)).size > 1) {
    zeilen.push("", `Gesamt: ${r0(summeKh(eintraege))} g KH`);
  }
  return zeilen.join("\n");
}

export function neueId() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
