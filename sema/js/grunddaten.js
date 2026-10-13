// grunddaten.js — Startwerte der Lebensmittel-Liste („Wissensbasis“).
//
// Als ES-Modul statt als JSON-Datei per fetch: so liegt die Liste im App-Shell-Cache, geht
// offline und braucht keinen CSP-Eintrag. Beim Start wird sie nach IndexedDB übernommen
// (siehe grundErgaenzen in logik.js) — danach gehören die Einträge dem Gerät und dürfen
// bearbeitet und bestätigt werden, ohne dass ein Update sie zurücksetzt.
//
// WICHTIG: Das sind allgemeine Richtwerte aus Nährwerttabellen, NICHT Semas Werte. Deshalb
// stehen alle auf verifiziert:false und tragen in der App ein Warnzeichen, bis Elif oder Yusuf
// sie bestätigt oder durch ihre eigenen Werte ersetzt haben. Die Eltern rechnen seit Langem mit
// ihren Werten, und Semas Pumpeneinstellung passt zu genau diesen — bei Abweichung gilt ihr Wert.
//
// Einträge mit kh100:null sind Platzhalter (Markenprodukte, Eisdiele): Rezepturen ändern sich,
// ein geratener Wert wäre hier gefährlicher als keiner. Sie sind erst nach dem Befüllen
// (Barcode-Scan oder Elternwert) berechenbar.
//
// Neue Einträge: neue id vergeben und GRUND_VERSION hochzählen. Vorhandene ids nie umbenennen
// oder wiederverwenden — Geräte mit älterem Stand ergänzen nur fehlende ids.

export const GRUND_VERSION = 1;

const r = (id, name, kategorie, zustand, kh100, hinweis = "") =>
  ({ id: `g-${id}`, name, kategorie, zustand, kh100, portionG: null, hinweis, quelle: "richtwert", verifiziert: false, updatedAt: 0 });

export const GRUNDDATEN = [
  r("apfel", "Apfel", "Obst", "roh", 11.4),
  r("birne", "Birne", "Obst", "roh", 12.4),
  r("banane", "Banane", "Obst", "roh", 20.0, "Reifegrad beeinflusst den Wert"),
  r("erdbeeren", "Erdbeeren", "Obst", "roh", 5.5),
  r("weintrauben", "Weintrauben", "Obst", "roh", 15.2),
  r("mandarine", "Mandarine", "Obst", "roh", 10.1),
  r("kiwi", "Kiwi", "Obst", "roh", 9.1),
  r("heidelbeeren", "Heidelbeeren", "Obst", "roh", 7.4),
  r("karotte", "Karotte", "Gemüse", "roh", 4.8),
  r("gurke", "Gurke", "Gemüse", "roh", 1.8),
  r("paprika", "Paprika rot", "Gemüse", "roh", 6.4),
  r("kohlrabi", "Kohlrabi", "Gemüse", "roh", 3.7),
  r("tomate", "Tomate", "Gemüse", "roh", 2.6),
  r("vollmilch", "Vollmilch 3,5 %", "Milchprodukte", "", 4.8),
  r("naturjoghurt", "Naturjoghurt 3,5 %", "Milchprodukte", "", 4.0),
  r("magerquark", "Magerquark", "Milchprodukte", "", 4.0),
  r("vollkornbrot", "Vollkornbrot", "Brot", "", 39.0, "Stark sortenabhängig – eigenes Brot scannen oder Elternwert"),
  r("mischbrot", "Weizenmischbrot", "Brot", "", 46.0, "Stark sortenabhängig"),
  r("toast", "Toastbrot", "Brot", "", 48.0, "Per Barcode genauer"),
  r("broetchen", "Weizenbrötchen", "Brot", "", 55.0),
  r("brezel", "Laugenbrezel", "Brot", "", null, "Wert beim Bäcker erfragen oder Elternwert eintragen"),
  // Beilagen: roh und gekocht unterscheiden sich um fast das Dreifache — die häufigste Quelle
  // für grobe Fehler. Deshalb steht der Zustand im Namen und wird immer mit angezeigt.
  r("reis-gekocht", "Reis", "Beilage", "gekocht", 28.0, "Gekochtes Gewicht wiegen"),
  r("reis-roh", "Reis", "Beilage", "roh", 78.0, "Rohgewicht – nur beim Kochen nach Rezept"),
  r("nudeln-gekocht", "Nudeln", "Beilage", "gekocht", 28.0, "Je nach Kochzeit etwa 25–31 g"),
  r("nudeln-roh", "Nudeln", "Beilage", "roh", 70.0, "Rohgewicht – nur beim Kochen nach Rezept"),
  r("kartoffeln-gekocht", "Kartoffeln", "Beilage", "gekocht", 15.0),
  r("haferflocken", "Haferflocken", "Frühstück", "roh", 58.7),
  r("reiswaffel", "Reiswaffel natur", "Snack", "", 80.0, "Per Barcode genauer"),
  r("vanilleeis", "Vanilleeis", "Süßes", "", 23.0, "Kugelgröße variiert stark"),
  r("apfelsaft", "Apfelsaft", "Getränke", "", 11.0),
  // Aus dem Gespräch mit Elif und Yusuf: wiederkehrende Dinge ohne verlässlichen Allgemeinwert.
  { ...r("sema-muesli", "Semas Müsli", "Sema", "roh", null, "Per Barcode erfassen – Portion 25 g laut Eltern"), portionG: 25 },
  r("sema-waffel", "Waffel (Vesperbox)", "Sema", "", null, "Produkt scannen oder Elternwert eintragen"),
  r("sema-milchschnitte", "Milchschnitte", "Sema", "", null, "Per Barcode erfassen, Portion = 1 Stück"),
  r("sema-mini-knoppers", "Mini Knoppers", "Sema", "", null, "Per Barcode erfassen, Stückgewicht wiegen"),
  r("sema-eiskugel", "Kugel Eis (Stammeisdiele)", "Sema", "", null, "Elternwert je Kugel eintragen"),
];
