// einkauf.js — Einkaufsposten mit Menge: aus Rezeptzutaten erzeugen, mit der Liste
// zusammenführen, als Text zeigen. Reine Rechnung ohne Store, damit test/einkauf.test.mjs
// sie ohne Browser prüfen kann.
//
// Eine Einkaufszeile war bisher nur Text. Für „Rezept auf die Einkaufsliste" reicht das
// nicht: wer zweimal kocht, braucht 600 g statt 300 g, und wer dieselbe Zutat aus zwei
// Rezepten übernimmt, will EINE Zeile mit der Summe — nicht zwei Zeilen „Rinderhack".
// Die Menge steht deshalb als Zahl + Einheit neben dem Text; Handeinträge bleiben
// ohne Menge, wie bisher.

/** Einheiten, die eine Einkaufszeile kennt. Mehr nicht: "EL" oder "Packung" ließen sich
 *  nicht addieren, und beim Einkaufen zählt Gramm oder Stück. */
export const EINHEITEN = ["g", "Stk"];

function rund(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Die Posten, die ein Rezept für `faktor`-maliges Kochen auf die Liste setzt.
 * Eine Zutat mit Stückzahl ergibt Stück (2 Eier → 4 Stk bei 2×), sonst Gramm.
 * Zutaten ohne Menge kommen als reiner Text — der Mensch weiß, was „Salz" heißt.
 */
export function zutatenFuerEinkauf(recipe, faktor = 1) {
  const f = faktor > 0 ? faktor : 1;
  return (recipe?.ingredients || [])
    .filter(z => z && z.name && z.name.trim())
    .map(z => {
      const text = z.name.trim();
      if (z.stueck > 0) return { text, menge: rund(z.stueck * f), einheit: "Stk" };
      if (z.grams > 0) return { text, menge: rund(z.grams * f), einheit: "g" };
      return { text, menge: null, einheit: null };
    });
}

/** „600 g", „1,2 kg", „4 Stk" — oder "" ohne Menge. Komma wie überall in der Anzeige
 *  von Mengen auf der Einkaufsliste: die liest man, man rechnet nicht damit. */
export function mengeText(menge, einheit) {
  if (!(menge > 0) || !einheit) return "";
  if (einheit === "g" && menge >= 1000) {
    return `${(menge / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} kg`;
  }
  return `${menge.toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${einheit}`;
}

const normal = (s) => String(s || "").trim().toLowerCase();

/**
 * Sucht in `liste` die offene Zeile, zu der `posten` dazugehört, und sagt, was zu tun ist:
 *   { aktion: "neu" }                 — nichts Passendes offen → neue Zeile
 *   { aktion: "ergaenzt", item, menge } — gleiche Zutat, Mengen addierbar → Summe
 *   { aktion: "vorhanden", item }     — gleiche Zutat, aber ohne Menge auf beiden Seiten
 *
 * Erledigte Zeilen zählen nicht: wer „Eier" abgehakt hat, braucht beim nächsten Rezept
 * wieder eine offene Zeile. Unterschiedliche Einheiten (200 g vs. 2 Stk) lassen sich nicht
 * addieren — dann lieber eine zweite Zeile als eine falsche Summe.
 */
export function fuegeZusammen(liste, posten) {
  const name = normal(posten.text);
  const offen = (liste || []).filter(i => !i.checked && normal(i.text) === name);
  if (offen.length === 0) return { aktion: "neu" };

  if (posten.menge > 0 && posten.einheit) {
    const gleich = offen.find(i => i.einheit === posten.einheit && i.menge > 0);
    if (gleich) return { aktion: "ergaenzt", item: gleich, menge: rund(gleich.menge + posten.menge) };
    const leer = offen.find(i => !(i.menge > 0));
    if (leer) return { aktion: "ergaenzt", item: leer, menge: posten.menge, einheit: posten.einheit };
    return { aktion: "neu" };
  }
  return { aktion: "vorhanden", item: offen[0] };
}
