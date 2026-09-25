// schritte.js — Schritte je Tag und der Vergleich im Haushalt. Kein DOM, damit es sich
// ohne Browser prüfen lässt (test/schritte.test.mjs).
//
// Warum von Hand eingetragen wird, steht in der Migration 20260925090000: eine Website kann
// keinen Schrittzähler lesen. Die Zahl ist trotzdem den Aufwand wert, sobald zwei Menschen
// sie nebeneinander sehen — genau dafür ist dieser Vergleich da.

import { Store, dateKeyOf, shiftDateKey } from "./store.js";

/** Die Schritte eines Profils an einem Tag, oder null wenn nichts eingetragen ist. */
export function schritteAm(profileId, dateKey) {
  const e = Store.getStepsFor(profileId, dateKey);
  return e ? e.steps : null;
}

/** Alle Tage eines Profils, aufsteigend nach Datum. */
export function schrittePunkte(profileId) {
  return Store.getSteps()
    .filter(s => s.profileId === profileId && s.steps != null)
    .map(s => ({ dateKey: s.dateKey, steps: s.steps }))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

/**
 * Durchschnitt über die letzten `tage` Tage — gezählt werden nur Tage MIT Eintrag.
 * Ein vergessener Tag als 0 zu werten würde den Schnitt nach unten ziehen und behaupten,
 * jemand sei nicht gelaufen; in Wahrheit weiß die App es nur nicht.
 */
export function schnitt(profileId, { heute = dateKeyOf(Date.now()), tage = 7 } = {}) {
  const ab = shiftDateKey(heute, -(tage - 1));
  const werte = schrittePunkte(profileId).filter(p => p.dateKey >= ab && p.dateKey <= heute);
  if (werte.length === 0) return null;
  return Math.round(werte.reduce((s, p) => s + p.steps, 0) / werte.length);
}

/**
 * Der Vergleich zweier Profile an einem Tag.
 *
 * `vorne` ist bewusst dreiwertig und kennt "offen": solange einer von beiden nichts
 * eingetragen hat, gibt es keinen Rückstand, sondern eine Lücke. Das ist derselbe
 * Unterschied wie zwischen "nichts gegessen" und "nichts eingetragen", und er ist der
 * Grund, warum hier nicht einfach mit 0 gerechnet wird.
 */
export function vergleich(profileId, partnerId, dateKey) {
  const meine = schritteAm(profileId, dateKey);
  const seine = partnerId ? schritteAm(partnerId, dateKey) : null;
  if (meine == null || seine == null) {
    return { meine, seine, vorne: "offen", abstand: null };
  }
  const abstand = Math.abs(meine - seine);
  const vorne = meine === seine ? "gleich" : meine > seine ? "ich" : "partner";
  return { meine, seine, vorne, abstand };
}

/**
 * Ein Satz zum Vergleich. Ohne Lob und ohne Ausrufezeichen — die Zahl sagt, was sie sagt.
 * `partnerName` steht drin, weil "der Partner" niemand ist, der im Haushalt wohnt.
 */
export function vergleichSatz(v, partnerName) {
  if (v.meine == null && v.seine == null) return "Für heute hat noch niemand Schritte eingetragen.";
  if (v.meine == null) return `Nur ${partnerName} hat heute eingetragen: ${zahl(v.seine)}.`;
  if (v.seine == null) return `${partnerName} hat für heute noch nichts eingetragen.`;
  if (v.vorne === "gleich") return `Gleichstand mit ${partnerName}.`;
  return v.vorne === "ich"
    ? `${zahl(v.abstand)} Schritte vor ${partnerName}.`
    : `${zahl(v.abstand)} Schritte hinter ${partnerName}.`;
}

/** Tausenderpunkte wie im Deutschen üblich; Schritte haben keine Nachkommastellen. */
export function zahl(n) {
  return n == null ? "–" : Math.round(n).toLocaleString("de-DE");
}
