// ikonen.js — die Bedien-Ikonen der App als Inline-SVG.
//
// Vorher standen an jeder dieser Stellen Emoji. Die zeichnet das Betriebssystem: farbig, auf
// jedem Gerät anders, und in einer Formensprache, die mit dem Rest der App nichts zu tun hat.
// Zwei Nebenwirkungen wogen schwerer als das Aussehen:
//
//   - Ein Emoji nimmt keine Farbe an. Der aktive Reiter der Tableiste ist grün, der Text
//     daneben auch — das Bildchen darüber blieb bunt und wusste von nichts.
//   - Es gibt sie nicht überall. Fehlt eines, steht ein leeres Rechteck da, und die Zeile
//     ist unlesbar statt nur anders.
//
// Hier liegen sie als Pfade auf einem 24er-Raster, Strichstärke 1.75, ohne Füllung, mit
// `stroke="currentColor"`: sie erben die Farbe des Zustands, in dem sie stehen, und sehen in
// Hell wie Dunkel richtig aus. `aria-hidden`, weil daneben immer ein Wort steht oder der
// Knopf ein `aria-label` trägt — sonst läse ein Screenreader die Beschriftung doppelt.
//
// NICHT ersetzt und bewusst geblieben:
//   - die Avocado in der Kopfzeile: sie bedient nichts, sie ist das Zeichen der App.
//   - einfarbige Schriftzeichen (✓ ✕ ★ ☆ → ⬆ ⬇ ⇄): die sind schon Text, nehmen `color`
//     an und brauchen keine Zeichnung.

const PFADE = {
  // Tableiste
  start:    '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"/>',
  listen:   '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8.5h6M9 12.5h6M9 16.5h3"/>',
  rezepte:  '<path d="M4 13h11a4 4 0 0 1 0 8H8a4 4 0 0 1-4-4z"/><path d="M15 15h3.5a2.5 2.5 0 0 0 0-5H17"/><path d="M6 9.5c0-2 2-2 2-4M10 9.5c0-2 2-2 2-4"/>',
  // Ein gezahntes Zahnrad wird bei 22 px zu einem Kreis mit Fransen und liest sich als
  // Sonne. Drei Schieberegler bleiben auf jeder Größe erkennbar.
  profil:   '<path d="M5 7.5h14M5 12h14M5 16.5h14"/><circle cx="9" cy="7.5" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="16.5" r="2"/>',

  // Handlungen
  kamera:   '<path d="M4 8.5h3l1.5-2h7L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.2"/>',
  auswertung:'<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7.5" y="12" width="3" height="5" rx="1"/><rect x="13" y="8" width="3" height="9" rx="1"/>',
  planen:   '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  ki:       '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/><path d="M18 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  wiegen:   '<path d="M12 4v16M7 20h10"/><path d="M12 7 5 9.5M12 7l7 2.5"/><path d="M2.5 15a2.5 2.5 0 0 0 5 0L5 9.5z"/><path d="M16.5 15a2.5 2.5 0 0 0 5 0L19 9.5z"/>',
  suche:    '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/>',
  einkauf:  '<circle cx="10" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/><path d="M3 4h2.2l2.3 10.5h10.2L20 7.5H6.2"/>',
  loeschen: '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5 7.5 20h9l1-13.5"/><path d="M10.5 10v6M13.5 10v6"/>',
  teilen:   '<path d="M12 15V4"/><path d="m8 7.5 4-3.5 4 3.5"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>',
  laden:    '<path d="M12 4v11"/><path d="m8 11.5 4 3.5 4-3.5"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>',
  bild:     '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="m4 17 4.5-4.5 3.5 3.5 3-2.5 4.5 4"/>',
  bearbeiten:'<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 2 2"/>',
  notiz:    '<path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20z"/><path d="M14.5 3.5V8h4.5"/><path d="M9.5 12.5h6M9.5 16h4"/>',
  kochbuch: '<path d="M5 4.5h11a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z"/><path d="M7 20a2 2 0 0 1 2-2h9"/><path d="M9.5 9h6"/>',
  warnung:  '<path d="M12 4.5 21 20H3z"/><path d="M12 10.5v4M12 17.2v.1"/>',
  verboten: '<circle cx="12" cy="12" r="8"/><path d="m6.5 6.5 11 11"/>',
  stern:    '<path d="m12 4 2.5 5.3 5.5.7-4 3.9 1 5.6-5-2.8-5 2.8 1-5.6-4-3.9 5.5-.7z"/>',
  uhr:      '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  funk:     '<path d="M12 12h.01"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 15.5a5 5 0 0 0 0-7"/><path d="M5.5 5.5a9 9 0 0 0 0 13M18.5 18.5a9 9 0 0 0 0-13"/>',
  welt:     '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a13 13 0 0 1 0 16 13 13 0 0 1 0-16z"/>',
  neu:      '<path d="M12 6v12M6 12h12"/>',
  wuerfeln: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4.5v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 19.5v-4h4"/>',
  zutat:    '<path d="M7 3.5v7a2.5 2.5 0 0 0 5 0v-7"/><path d="M9.5 13v7.5"/><path d="M17 3.5c-1.6 1.4-2.5 3.4-2.5 5.5 0 1.6.8 2.7 2.5 2.7s2.5-1.1 2.5-2.7c0-2.1-.9-4.1-2.5-5.5z"/><path d="M17 12v8.5"/>',
  teller:   '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.5"/>',
  essen:    '<path d="M6 3.5v7a2 2 0 0 0 4 0v-7"/><path d="M8 3.5v7M8 12.5V20.5"/><path d="M17 3.5c-1.5 1.4-2.3 3.3-2.3 5.3 0 1.5.8 2.6 2.3 2.6s2.3-1.1 2.3-2.6c0-2-.8-3.9-2.3-5.3z"/><path d="M17 11.5v9"/>',
  text:     '<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M9.5 3.5h5v2.5h-5z"/><path d="M9 11h6M9 15h4"/>',
};

/**
 * Ein Ikon als SVG-Zeichenkette, zum Einsetzen in eine Vorlage.
 *
 * `groesse` in Pixeln; die Strichstärke wird mitskaliert, damit ein 16er-Ikon neben einer
 * Beschriftung nicht plumper wirkt als ein 24er in der Tableiste.
 */
export function ikon(name, { groesse = 20, strich = null, klasse = "" } = {}) {
  const pfad = PFADE[name];
  if (!pfad) return "";
  const w = strich ?? Math.round((1.75 * 24 / groesse) * 100) / 100;
  return `<svg class="ikon${klasse ? " " + klasse : ""}" viewBox="0 0 24 24" width="${groesse}" height="${groesse}"`
    + ` fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round"`
    + ` stroke-linejoin="round" aria-hidden="true" focusable="false">${pfad}</svg>`;
}

/** Für die Fälle, in denen ein Ikon in ein bestehendes Element gesetzt wird. */
export function setzeIkon(el, name, opts) {
  if (el) el.innerHTML = ikon(name, opts);
}
