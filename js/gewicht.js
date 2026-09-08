// gewicht.js — Gewichtsverlauf: glätten, Trend schätzen, gegen das Defizit halten.
//
// Die App rechnet ein Kaloriendefizit aus (profiles.js) und friert die Zielwerte jedes
// Tages ein. Was fehlte, war die Gegenprobe: WIRKT das Defizit? `profile.weightKg` ist
// ein einzelner, ständig überschriebener Wert — aus ihm lässt sich kein Verlauf lesen.
//
// Der wunde Punkt jeder Waage ist die Streuung. Wasser, Glykogen, Darminhalt und Salz
// bewegen den angezeigten Wert um ein bis zwei Kilo, und gerade in der ersten Keto-Woche
// gehen ein paar Kilo Wasser weg, die nichts mit Fett zu tun haben. Zwei Messungen
// voneinander abzuziehen misst deshalb vor allem Rauschen. Hier wird stattdessen eine
// Ausgleichsgerade durch ALLE Punkte des Fensters gelegt (kleinste Quadrate) — sie
// braucht keine gleichmäßigen Abstände, verkraftet Lücken und wird mit jedem Punkt
// ruhiger.
//
// Und sie wird erst gezeigt, wenn sie etwas heißt: drei Messungen über mindestens zwei
// Wochen. Darunter steht die Spanne da, aber keine Rate — eine Hochrechnung aus zwei
// Punkten von gestern und heute ergäbe „−7 kg pro Woche" und wäre schlicht falsch.

import { Store, dateKeyOf, shiftDateKey } from "./store.js";
import { calcTargets } from "./profiles.js";

/**
 * Faustzahl für den Energiegehalt eines Kilos Körpermasse. Sie ist genau das: eine
 * Faustzahl (7000–7700 kcal je nach Quelle und Anteil fettfreier Masse). Sie taugt für
 * „passt die Größenordnung?", nicht für eine Prognose auf die Nachkommastelle.
 */
export const KCAL_JE_KG = 7700;

/** Mindestens so viele Messungen über so viele Tage, bevor eine Rate genannt wird. */
const MIN_PUNKTE = 3;
const MIN_SPANNE_TAGE = 14;

/** "YYYY-MM-DD" als fortlaufende Tagesnummer. Über UTC gerechnet, damit die
 * Zeitumstellung keine krummen Abstände erzeugt — es geht um Kalendertage. */
export function tagesnummer(dateKey) {
  const [j, m, t] = String(dateKey).split("-").map(Number);
  return Date.UTC(j, m - 1, t) / 86400000;
}

/** Alle Gewichte eines Profils, aufsteigend nach Tag. */
export function gewichtspunkte(profileId) {
  return Store.getWeights()
    .filter(w => w.profileId === profileId && w.kg != null)
    .map(w => ({ dateKey: w.dateKey, kg: Number(w.kg), bodyFatPct: w.bodyFatPct ?? null }))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

/**
 * Steigung einer Ausgleichsgeraden durch die Punkte, in kg je Woche.
 * Negativ heißt abnehmend. null, wenn alle Punkte auf denselben Tag fallen — dann gibt
 * es keine Steigung, nur eine Wolke.
 */
export function kgProWoche(punkte) {
  if (!punkte || punkte.length < 2) return null;
  const xs = punkte.map(p => tagesnummer(p.dateKey));
  const ys = punkte.map(p => p.kg);
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let oben = 0, unten = 0;
  for (let i = 0; i < n; i++) {
    oben += (xs[i] - mx) * (ys[i] - my);
    unten += (xs[i] - mx) ** 2;
  }
  if (unten === 0) return null;
  return (oben / unten) * 7;
}

/**
 * Was das eingestellte Defizit rechnerisch je Woche bringen sollte — negativ beim
 * Abnehmen. Bei „Halten" ist es 0, beim Aufbau positiv.
 */
export function erwarteteKgProWoche(profile) {
  const t = calcTargets(profile);
  const luecke = t.kcal - t.tdee; // negativ beim Defizit
  return (luecke * 7) / KCAL_JE_KG;
}

/**
 * Der Verlauf in einer Form, die beide Ansichten (Startseite und Auswertung) direkt
 * anzeigen können. `tage` ist die Fensterbreite für den Trend.
 */
export function gewichtsBericht(profile, { heute = dateKeyOf(Date.now()), tage = 28 } = {}) {
  const alle = gewichtspunkte(profile.id);
  const ab = shiftDateKey(heute, -(tage - 1));
  const fenster = alle.filter(p => p.dateKey >= ab && p.dateKey <= heute);

  const letzter = alle.filter(p => p.dateKey <= heute).at(-1) || null;
  const erster = fenster[0] || null;
  const spanneTage = fenster.length >= 2
    ? tagesnummer(fenster.at(-1).dateKey) - tagesnummer(fenster[0].dateKey)
    : 0;

  const genugDaten = fenster.length >= MIN_PUNKTE && spanneTage >= MIN_SPANNE_TAGE;
  const rate = genugDaten ? kgProWoche(fenster) : null;
  const erwartet = erwarteteKgProWoche(profile);

  return {
    alle,
    fenster,
    tage,
    letzter,
    erster,
    spanneTage,
    genugDaten,
    // Fehlende Messungen: was noch fehlt, bis eine Rate genannt werden kann.
    fehlendePunkte: Math.max(0, MIN_PUNKTE - fenster.length),
    fehlendeTage: Math.max(0, MIN_SPANNE_TAGE - spanneTage),
    kgProWoche: rate,
    erwarteteKgProWoche: erwartet,
    // Nur sinnvoll, wenn beides da ist. Positiv = es geht langsamer als gerechnet.
    abweichung: rate == null ? null : rate - erwartet,
    veraenderung: erster && letzter && erster.dateKey !== letzter.dateKey
      ? Math.round((letzter.kg - erster.kg) * 10) / 10
      : null,
  };
}

/**
 * Ein Satz zum Verlauf — dieselbe Formulierung auf der Startseite, in der Auswertung und
 * im Textbericht fürs Sprachmodell. Bewusst ohne Ausrufezeichen und ohne Lob: die Zahl
 * sagt, was sie sagt.
 */
export function trendSatz(bericht) {
  if (!bericht.letzter) return "Noch kein Gewicht eingetragen.";
  if (!bericht.genugDaten) {
    const fehlt = bericht.fehlendePunkte > 0
      ? `${bericht.fehlendePunkte} weitere ${bericht.fehlendePunkte === 1 ? "Messung" : "Messungen"}`
      : `${bericht.fehlendeTage} weitere Tage Abstand`;
    return `Für einen Trend fehlen noch ${fehlt}.`;
  }
  const rate = bericht.kgProWoche;
  const betrag = Math.abs(rate).toFixed(1).replace(".", ",");
  if (Math.abs(rate) < 0.05) return `Gewicht hält sich über die letzten ${bericht.tage} Tage.`;
  const richtung = rate < 0 ? "abwärts" : "aufwärts";
  return `Trend über ${bericht.tage} Tage: ${betrag} kg pro Woche ${richtung}.`;
}

/**
 * Der Abgleich mit dem eingestellten Ziel. Nur beim Abnehmen und nur mit genug Daten —
 * bei „Halten" gibt es nichts zu vergleichen, und ohne Trend wäre es geraten.
 *
 * Die Toleranz ist bewusst breit: 0,2 kg je Woche liegen innerhalb dessen, was
 * Wasserhaushalt und Messfehler ohnehin verschieben, und die 7700-kcal-Faustzahl selbst
 * ist nicht genauer.
 */
export function zielAbgleichSatz(profile, bericht) {
  if (!bericht.genugDaten || profile.goal !== "lose") return "";
  const erwartet = bericht.erwarteteKgProWoche;
  if (erwartet >= -0.05) return "";
  const soll = Math.abs(erwartet).toFixed(1).replace(".", ",");
  const ist = bericht.kgProWoche;
  if (ist > -0.05) {
    return `Gerechnet war mit ${soll} kg pro Woche — gemessen geht gerade nichts runter.`;
  }
  const abweichung = bericht.abweichung; // >0 = langsamer als gerechnet
  if (Math.abs(abweichung) <= 0.2) return `Deckt sich mit den gerechneten ${soll} kg pro Woche.`;
  return abweichung > 0
    ? `Langsamer als die gerechneten ${soll} kg pro Woche.`
    : `Schneller als die gerechneten ${soll} kg pro Woche.`;
}
