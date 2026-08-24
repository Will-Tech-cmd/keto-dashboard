// off-beitrag.js — ein selbst erfasstes Produkt an Open Food Facts zurückgeben.
//
// Warum das überhaupt lohnt, gemessen an zwölf der eigenen Produkte:
//   5 kennt Open Food Facts gar nicht
//   5 kennt es, aber ohne jede Nährwertangabe
//   2 sind dort bereits vollständig
// Zehn von zwölf wären also ein echter Beitrag — und die mittlere Gruppe ist fast die
// wertvollere: dort steht der Eintrag schon, und es fehlen genau die Zahlen, die hier
// ohnehin vom Etikett abgetippt wurden.
//
// Drei Regeln, die diese Datei durchsetzt:
//
//   NIE AUTOMATISCH.     Ein Beitrag ist öffentlich, dauerhaft und trägt den Namen des
//                        Kontos. Das ist eine Entscheidung je Produkt, kein Nebeneffekt
//                        des Speicherns.
//   NIE ERFUNDENE CODES. Produkte ohne echten Barcode bekommen hier einen Platzhalter
//                        ("eigen-..."). Der darf die Datenbank nie erreichen.
//   NIE OHNE ZAHLEN.     Ein Beitrag ohne Nährwerte hilft niemandem.
//
// Die Zugangsdaten liegen ausschließlich auf diesem Gerät, wie der Gemini-Schlüssel: eigener
// Speicherschlüssel, nicht im Backup, nicht im Abgleich.

const ZUGANG_KEY = "keto-dashboard-off-zugang";

const SCHREIB_URL = "https://world.openfoodfacts.org/cgi/product_jqm2.pl";
export const REGISTRIER_URL = "https://de.openfoodfacts.org/cgi/user.pl";

/** Woran die Datenbank erkennt, wer geschrieben hat. */
const APP_NAME = "Keto-Dashboard";
const APP_URL = "https://will-tech-cmd.github.io/keto-dashboard/";

// ---------------------------------------------------------------------------
// Zugang
// ---------------------------------------------------------------------------

export function ladeZugang() {
  try {
    const roh = localStorage.getItem(ZUGANG_KEY);
    return roh ? JSON.parse(roh) : null;
  } catch {
    return null;
  }
}

export function hatZugang() {
  const z = ladeZugang();
  return !!(z?.benutzer && z?.passwort);
}

/** Der Benutzername — für die Anzeige. Das Passwort verlässt diese Datei nicht. */
export function benutzername() {
  return ladeZugang()?.benutzer || "";
}

export function setzeZugang(benutzer, passwort) {
  localStorage.setItem(ZUGANG_KEY, JSON.stringify({ benutzer, passwort }));
}

export function loescheZugang() {
  localStorage.removeItem(ZUGANG_KEY);
}

// ---------------------------------------------------------------------------
// Was darf gehen
// ---------------------------------------------------------------------------

/** Ein echter Handelscode — 8 bis 14 Ziffern. Alles andere ist ein Platzhalter dieser App. */
export function istEchterBarcode(barcode) {
  return /^\d{8,14}$/.test(String(barcode || ""));
}

/**
 * Darf dieses Produkt beigetragen werden? Gibt einen Grund zurück, wenn nicht — die Ansicht
 * soll erklären können, warum der Knopf fehlt, statt ihn wortlos wegzulassen.
 */
export function pruefeBeitrag(produkt) {
  if (!produkt) return { moeglich: false, grund: "Kein Produkt." };
  if (!istEchterBarcode(produkt.barcode)) {
    return { moeglich: false, grund: "Dieses Produkt hat keinen echten Barcode — es wurde ohne Scan angelegt." };
  }
  const p = produkt.per100 || {};
  if (p.kcal == null && p.carbs == null && p.fat == null && p.protein == null) {
    return { moeglich: false, grund: "Ohne Nährwerte hilft ein Beitrag niemandem." };
  }
  if (!produkt.name || produkt.name === "Unbekanntes Produkt") {
    return { moeglich: false, grund: "Ohne Namen kann der Eintrag nicht zugeordnet werden." };
  }
  return { moeglich: true, grund: "" };
}

// ---------------------------------------------------------------------------
// Der Beitrag selbst
// ---------------------------------------------------------------------------

/** Die Nährwertfelder, so wie Open Food Facts sie erwartet. */
const NAEHRWERTE = [
  ["kcal", "energy-kcal", "kcal"],
  ["carbs", "carbohydrates", "g"],
  ["sugars", "sugars", "g"],
  ["fiber", "fiber", "g"],
  ["fat", "fat", "g"],
  ["saturatedFat", "saturated-fat", "g"],
  ["protein", "proteins", "g"],
  ["salt", "salt", "g"],
];

/**
 * Baut die Felder, die gesendet würden — als Liste von [Feld, Wert]. Ausdrücklich getrennt
 * vom Senden, damit die Ansicht sie VORHER zeigen kann. Was man beiträgt, sollte man gesehen
 * haben.
 */
export function baueBeitrag(produkt) {
  const felder = [
    ["code", String(produkt.barcode)],
    ["product_name", produkt.name],
    ["product_name_de", produkt.name],
    ["lc", "de"],
    ["nutrition_data_per", "100g"],
  ];
  if (produkt.brand) felder.push(["brands", produkt.brand]);
  if (produkt.quantity) felder.push(["quantity", produkt.quantity]);
  if (produkt.servingSize) felder.push(["serving_size", produkt.servingSize]);
  if (produkt.ingredientsText) felder.push(["ingredients_text_de", produkt.ingredientsText]);

  const p = produkt.per100 || {};
  for (const [unser, ihr, einheit] of NAEHRWERTE) {
    if (p[unser] == null) continue;
    felder.push([`nutriment_${ihr}`, String(p[unser])]);
    felder.push([`nutriment_${ihr}_unit`, einheit]);
  }
  return felder;
}

/** Menschenlesbare Vorschau — dieselben Daten, nur mit deutschen Bezeichnungen. */
const LESBAR = {
  code: "Barcode", product_name: "Name", brands: "Marke", quantity: "Füllmenge",
  serving_size: "Portionsgröße", ingredients_text_de: "Zutaten",
  "nutriment_energy-kcal": "kcal je 100 g", nutriment_carbohydrates: "Kohlenhydrate",
  nutriment_sugars: "davon Zucker", nutriment_fiber: "Ballaststoffe", nutriment_fat: "Fett",
  "nutriment_saturated-fat": "davon gesättigt", nutriment_proteins: "Eiweiß", nutriment_salt: "Salz",
};

export function vorschau(produkt) {
  return baueBeitrag(produkt)
    .filter(([feld]) => LESBAR[feld])
    .map(([feld, wert]) => ({ was: LESBAR[feld], wert }));
}

/**
 * Sendet den Beitrag.
 *
 * Die Schnittstelle antwortet bei Erfolg mit JSON, bei falschen Zugangsdaten dagegen mit
 * einer HTML-Fehlerseite („Incorrect user name or password."). Beides wird hier auf eine
 * klare Meldung zurückgeführt — gegen den Testserver von Open Food Facts überprüft.
 */
export async function sendeBeitrag(produkt) {
  const zugang = ladeZugang();
  if (!zugang?.benutzer || !zugang?.passwort) {
    throw new Error("Kein Open-Food-Facts-Konto hinterlegt.");
  }
  const pruefung = pruefeBeitrag(produkt);
  if (!pruefung.moeglich) throw new Error(pruefung.grund);

  const koerper = new URLSearchParams(baueBeitrag(produkt));
  koerper.set("user_id", zugang.benutzer);
  koerper.set("password", zugang.passwort);
  koerper.set("app_name", APP_NAME);
  koerper.set("app_version", APP_URL);
  koerper.set("comment", `Nährwerte vom Etikett ergänzt (${APP_NAME})`);

  let res;
  try {
    res = await fetch(SCHREIB_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: koerper.toString(),
    });
  } catch {
    throw new Error("Keine Verbindung zu Open Food Facts.");
  }

  return deuteAntwort(await res.text(), res.status, produkt.barcode);
}

/**
 * Aus der Antwort eine klare Aussage machen. Als eigene Funktion, weil sie sich so ohne Netz
 * pruefen laesst — gegen die echte Fehlerseite, die der Testserver von Open Food Facts bei
 * falschen Zugangsdaten liefert.
 *
 * Bei Erfolg kommt JSON, bei falschem Passwort eine HTML-Seite mit
 * „Incorrect user name or password.". Beides muss hier auseinandergehalten werden.
 */
export function deuteAntwort(text, status, barcode) {
  let antwort = null;
  try { antwort = JSON.parse(text); } catch { /* dann ist es HTML */ }

  if (!antwort) {
    if (/incorrect user name or password/i.test(text)) {
      throw new Error("Benutzername oder Passwort stimmt nicht.");
    }
    throw new Error(`Open Food Facts antwortete unerwartet (Status ${status}).`);
  }
  if (antwort.status !== 1) {
    throw new Error(antwort.status_verbose || "Der Beitrag wurde nicht angenommen.");
  }
  return { barcode: String(barcode), meldung: antwort.status_verbose || "gespeichert" };
}

/** Die öffentliche Seite eines Produkts — zum Nachschauen nach dem Beitrag. */
export function produktUrl(barcode) {
  return `https://de.openfoodfacts.org/product/${encodeURIComponent(barcode)}`;
}
