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

/** Der API-Key bleibt draußen: die Datei geht an die Kita, der Key ist persönlich. */
export function exportDaten({ favs, profil, einstellungen }) {
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportiert: new Date().toISOString(),
    favs,
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

export function importPruefen(obj) {
  if (!obj || obj.format !== EXPORT_FORMAT || !Array.isArray(obj.favs)) {
    throw new Error("Keine Sema-Sicherungsdatei.");
  }
  return obj;
}

export function neueId() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
