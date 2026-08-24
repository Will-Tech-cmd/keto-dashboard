// entities.js — der Zustand der App als flache Listen je Datenart, und zurück.
//
// store.js hält den Zustand als EIN Objekt mit Arrays und verschachtelten Karten
// (`dayTargets` ist profileId -> dateKey -> Werte, `ownProducts` ist barcode -> Produkt).
// Für die lokale Ablage und den Abgleich braucht es dagegen Zeilen: eine Liste je
// Datenart, jede Zeile einzeln schreib- und übertragbar.
//
// Diese Datei macht beides ineinander umrechenbar — verlustfrei in beide Richtungen.
// Sie kennt weder IndexedDB noch den Server, nur die zwei Formen.
//
// Nicht dabei: Verlauf, Produkt-Cache, `recent`, `activeProfileId`, `onboarded`. Die
// bleiben bewusst lokal (Entscheidung B0.2) und liegen in einem eigenen Speicher.

/** Favoriten und No-Go sind serverseitig eine Liste mit einer Spalte `art`. */
const ART = { favorites: "favorit", noGo: "nogo" };

/**
 * Zustand -> flache Listen.
 *
 * Reihenfolgen bleiben erhalten, wo sie etwas bedeuten (Einkaufsliste, Favoriten):
 * store.js stellt Neues nach vorn, und das ist die Reihenfolge, die man in der App sieht.
 */
export function zerlege(state) {
  const tagesziel = [];
  for (const [profileId, tage] of Object.entries(state.dayTargets || {})) {
    for (const [dateKey, werte] of Object.entries(tage || {})) {
      tagesziel.push({ profileId, dateKey, ...werte });
    }
  }

  const listen_eintrag = [];
  for (const liste of ["favorites", "noGo"]) {
    for (const e of state[liste] || []) listen_eintrag.push({ ...e, art: ART[liste] });
  }

  // Eigene Produkte und Ballaststoff-Schalter treffen sich je Barcode in einer Zeile.
  const korrekturen = new Map();
  const hole = (barcode) => {
    if (!korrekturen.has(barcode)) {
      korrekturen.set(barcode, { barcode, daten: null, ballaststoffAbziehen: null, updatedAt: null });
    }
    return korrekturen.get(barcode);
  };
  for (const [barcode, produkt] of Object.entries(state.ownProducts || {})) {
    const k = hole(barcode);
    k.daten = produkt;
    k.updatedAt = Math.max(k.updatedAt || 0, produkt?.updatedAt || 0) || null;
  }
  for (const [barcode, wert] of Object.entries(state.fiberOverrides || {})) {
    const k = hole(barcode);
    // null heißt "bewusst zurückgesetzt" und ist eine echte Angabe, kein fehlender Wert.
    k.ballaststoffAbziehen = wert == null ? null : !!wert;
    const wann = (state.fiberOverridesAt || {})[barcode] || 0;
    k.updatedAt = Math.max(k.updatedAt || 0, wann) || null;
  }

  return {
    profil: [...(state.profiles || [])],
    mahlzeit: [...(state.consumption || [])],
    wasser: [...(state.water || [])],
    tagesziel,
    listen_eintrag,
    einkauf: [...(state.shoppingList || [])],
    produkt_korrektur: [...korrekturen.values()],
    rezept: [...(state.recipes || [])],
  };
}

/**
 * Flache Listen -> Zustand. `basis` liefert alles, was nicht abgeglichen wird
 * (Verlauf, Cache, activeProfileId …) und unverändert durchgereicht wird.
 */
export function fuege(entitaeten, basis = {}) {
  const e = entitaeten || {};

  const dayTargets = {};
  for (const t of e.tagesziel || []) {
    if (!t.profileId || !t.dateKey) continue;
    (dayTargets[t.profileId] ||= {})[t.dateKey] = {
      kcal: t.kcal, netCarbG: t.netCarbG, fatG: t.fatG, proteinG: t.proteinG,
      frozenAt: t.frozenAt,
    };
  }

  const favorites = [];
  const noGo = [];
  for (const l of e.listen_eintrag || []) {
    const { art, ...rest } = l;
    (art === "nogo" ? noGo : favorites).push(rest);
  }

  const ownProducts = {};
  const fiberOverrides = {};
  const fiberOverridesAt = {};
  for (const k of e.produkt_korrektur || []) {
    if (!k.barcode) continue;
    if (k.daten) ownProducts[k.barcode] = k.daten;
    // Ein zurückgesetzter Schalter kommt als null zurück und wird hier gar nicht erst
    // eingetragen: getFiberOverride() liefert für "steht als null drin" und "steht nicht
    // drin" dasselbe (undefined). Der Unterschied ist nicht beobachtbar, also wird er
    // auch nicht künstlich am Leben gehalten.
    if (k.ballaststoffAbziehen != null) {
      fiberOverrides[k.barcode] = k.ballaststoffAbziehen;
      fiberOverridesAt[k.barcode] = k.updatedAt || 0;
    }
  }

  return {
    ...basis,
    profiles: [...(e.profil || [])],
    consumption: [...(e.mahlzeit || [])],
    water: [...(e.wasser || [])],
    dayTargets,
    favorites,
    noGo,
    shoppingList: [...(e.einkauf || [])],
    ownProducts,
    fiberOverrides,
    fiberOverridesAt,
    recipes: [...(e.rezept || [])],
  };
}

/** Felder des Zustands, die NICHT über den Abgleich wandern. */
export const NUR_LOKAL = [
  "history", "cache", "recent", "activeProfileId", "onboarded", "schemaVersion", "tombstones",
];

/** Der nur-lokale Teil eines Zustands — Gegenstück zu zerlege(). */
export function nurLokales(state) {
  const out = {};
  for (const feld of NUR_LOKAL) if (state[feld] !== undefined) out[feld] = state[feld];
  return out;
}
