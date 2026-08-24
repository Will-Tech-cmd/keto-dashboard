// rows.js — Übersetzung zwischen der Schreibweise der App und den Zeilen auf dem Server.
//
// Die App rechnet weiterhin mit ihren gewachsenen Objekten (`consumption` mit `grams`,
// `dateKey`, `profileId` …). Der Server kennt seit B1 Tabellen mit deutschen Spalten
// (`mahlzeit` mit `gramm`, `datum`, `profil_id` …). Diese Datei ist die EINZIGE Stelle,
// an der beide Schreibweisen aufeinandertreffen — die Views und store.js sehen den
// Server nie, sync.js sieht die App-Objekte nie.
//
// Warum nicht gleich alles auf die Server-Schreibweise umstellen? Weil dann jede einzelne
// View mitgeändert werden müsste. Der Gewinn wäre kosmetisch, das Risiko erheblich.
//
// Jede Entität liefert:
//   tabelle      Tabelle auf dem Server
//   konflikt     Spalten, an denen der Upsert "gibt es schon" festmacht
//   schluessel   wie die App die Zeile lokal führt (muss zu `konflikt` passen!)
//   zuZeile      App-Objekt -> Server-Zeile
//   ausZeile     Server-Zeile -> App-Objekt
//   zeit         Zeitpunkt der letzten Änderung im App-Objekt
//
// Zu `konflikt` und `schluessel`: beide beschreiben dieselbe Frage — "wann sind zwei
// Fassungen dieselbe Sache?" — einmal für Postgres, einmal für die lokale Ablage. Wo
// die App eine zufällige id vergibt (Mahlzeit, Wasser, Einkauf), ist das die id: zwei
// Geräte erzeugen nie dieselbe. Wo dieselbe Sache auf beiden Geräten unabhängig
// entstehen kann (das Tagesziel eines Tages, der Favorit zu einem Barcode), ist es der
// fachliche Schlüssel — sonst stünden zwei Zeilen für eine Sache.
//
// Diese Entitäten schicken deshalb bewusst KEINE `id` mit: sie würde bei jedem Upsert
// den Primärschlüssel der bestehenden Zeile überschreiben wollen. Der Server behält
// seine, die App führt ihre eigene über den fachlichen Schlüssel.
//
// Beim Zurückübersetzen gilt: was der Server nicht kennt, wird nicht erfunden. Fehlende
// Werte bleiben null statt auf einen Standardwert zu fallen — eine 0 an der falschen
// Stelle sähe aus wie eine echte Messung.

const zahl = (v) => (v == null || v === "" ? null : Number(v));
const millis = (v) => (v == null ? null : new Date(v).getTime());
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

/** Erster nicht-leerer Zeitpunkt; sonst jetzt. */
function stempel(...kandidaten) {
  for (const k of kandidaten) if (k != null) return k;
  return Date.now();
}

// ---------------------------------------------------------------------------
const profil = {
  tabelle: "profil",
  konflikt: "id",
  schluessel: (p) => p.id,
  zeit: (p) => stempel(p.updatedAt),
  zuZeile: (p, ctx) => ({
    id: p.id,
    haushalt_id: ctx.haushaltId,
    name: p.name,
    geschlecht: p.sex === "male" ? "male" : "female",
    alter_jahre: Math.max(1, Math.min(120, Math.round(Number(p.age) || 35))),
    groesse_cm: zahl(p.heightCm),
    gewicht_kg: zahl(p.weightKg),
    koerperfett_pct: zahl(p.bodyFatPct),
    aktivitaet: zahl(p.activity),
    ziel: ["lose", "maintain", "gain"].includes(p.goal) ? p.goal : "lose",
    defizit_pct: zahl(p.deficitPct),
    eiweiss_faktor: zahl(p.proteinFactor),
    netto_kh_limit_g: zahl(p.netCarbLimitG),
    ernaehrungsform: p.dietType || "keto",
    ampel_grenzen: p.gradeThresholds || { green: 5, yellow: 10 },
    wasser_ziel_ml: Math.round(Number(p.waterTargetMl) || 2500),
    erscheinungsbild: p.appearance || "system",
    ring_stil: p.ringStyle || "rings",
    geaendert_am: iso(stempel(p.updatedAt)),
  }),
  ausZeile: (z) => ({
    id: z.id,
    name: z.name,
    sex: z.geschlecht,
    age: Number(z.alter_jahre),
    heightCm: Number(z.groesse_cm),
    weightKg: Number(z.gewicht_kg),
    bodyFatPct: z.koerperfett_pct == null ? null : Number(z.koerperfett_pct),
    activity: Number(z.aktivitaet),
    goal: z.ziel,
    deficitPct: Number(z.defizit_pct),
    proteinFactor: Number(z.eiweiss_faktor),
    netCarbLimitG: Number(z.netto_kh_limit_g),
    dietType: z.ernaehrungsform,
    gradeThresholds: z.ampel_grenzen,
    waterTargetMl: Number(z.wasser_ziel_ml),
    appearance: z.erscheinungsbild,
    ringStyle: z.ring_stil,
    updatedAt: millis(z.geaendert_am),
  }),
};

// ---------------------------------------------------------------------------
// `barcode` trägt bei Rezepten weiterhin "recipe:<id>" — daran hängt die Schnellauswahl
// im Eintragen-Sheet (rankFrequentItems gruppiert danach). Die Spalte rezept_id bleibt
// deshalb leer: sie wäre eine zweite Wahrheit über dieselbe Zuordnung.
// ---------------------------------------------------------------------------
const mahlzeit = {
  tabelle: "mahlzeit",
  konflikt: "id",
  schluessel: (e) => e.id,
  zeit: (e) => stempel(e.updatedAt, e.at),
  zuZeile: (e, ctx) => ({
    id: e.id,
    haushalt_id: ctx.haushaltId,
    profil_id: e.profileId,
    datum: e.dateKey,
    mahlzeit: ["breakfast", "lunch", "dinner", "snack"].includes(e.meal) ? e.meal : null,
    barcode: e.barcode ?? null,
    rezept_id: null,
    name: e.name,
    gramm: zahl(e.grams),
    portionen: zahl(e.servings),
    portion_g: zahl(e.servingG),
    kcal: zahl(e.kcal),
    netto_kh: zahl(e.netCarbs),
    fett: zahl(e.fat),
    eiweiss: zahl(e.protein),
    erfasst_am: iso(e.at),
    geaendert_am: iso(stempel(e.updatedAt, e.at)),
  }),
  ausZeile: (z) => {
    const e = {
      id: z.id,
      profileId: z.profil_id,
      barcode: z.barcode,
      name: z.name,
      servingG: z.portion_g == null ? null : Number(z.portion_g),
      meal: z.mahlzeit,
      dateKey: z.datum,
      kcal: z.kcal == null ? null : Number(z.kcal),
      netCarbs: z.netto_kh == null ? null : Number(z.netto_kh),
      fat: z.fett == null ? null : Number(z.fett),
      protein: z.eiweiss == null ? null : Number(z.eiweiss),
      at: millis(z.erfasst_am),
    };
    // Entweder Gramm (Produkt) ODER Portionen (Rezept) — nie beides. Daran erkennt
    // rescaleConsumption(), in welcher Einheit es weiterrechnen muss.
    if (z.portionen != null) e.servings = Number(z.portionen);
    else e.grams = Number(z.gramm);
    const geaendert = millis(z.geaendert_am);
    if (geaendert != null && geaendert !== e.at) e.updatedAt = geaendert;
    return e;
  },
};

// ---------------------------------------------------------------------------
const wasser = {
  tabelle: "wasser",
  konflikt: "id",
  schluessel: (e) => e.id,
  zeit: (e) => stempel(e.at),
  zuZeile: (e, ctx) => ({
    id: e.id,
    haushalt_id: ctx.haushaltId,
    profil_id: e.profileId,
    datum: e.dateKey,
    ml: Math.round(Number(e.ml)),
    erfasst_am: iso(e.at),
    geaendert_am: iso(stempel(e.at)),
  }),
  ausZeile: (z) => ({
    id: z.id,
    profileId: z.profil_id,
    dateKey: z.datum,
    ml: Number(z.ml),
    at: millis(z.erfasst_am),
  }),
};

// ---------------------------------------------------------------------------
// tagesziel — in der App eine verschachtelte Karte profileId -> dateKey -> Werte, auf
// dem Server eine flache Tabelle mit (profil_id, datum) als Primärschlüssel. Keine id.
// ---------------------------------------------------------------------------
const tagesziel = {
  tabelle: "tagesziel",
  konflikt: "profil_id,datum",
  schluessel: (t) => `${t.profileId}|${t.dateKey}`,
  zeit: (t) => stempel(t.frozenAt),
  zuZeile: (t, ctx) => ({
    haushalt_id: ctx.haushaltId,
    profil_id: t.profileId,
    datum: t.dateKey,
    kcal: zahl(t.kcal),
    netto_kh_g: zahl(t.netCarbG),
    fett_g: zahl(t.fatG),
    eiweiss_g: zahl(t.proteinG),
    geaendert_am: iso(stempel(t.frozenAt)),
  }),
  ausZeile: (z) => ({
    profileId: z.profil_id,
    dateKey: z.datum,
    kcal: Number(z.kcal),
    netCarbG: Number(z.netto_kh_g),
    fatG: Number(z.fett_g),
    proteinG: Number(z.eiweiss_g),
    frozenAt: millis(z.geaendert_am),
  }),
};

// ---------------------------------------------------------------------------
// listen_eintrag — Favoriten und No-Go in einer Tabelle, unterschieden über `art`.
// Der Wechsel zwischen beiden ist damit ein Feldwechsel statt Löschen + Anlegen, und
// das alte "steht plötzlich auf beiden Listen" kann gar nicht mehr entstehen.
// ---------------------------------------------------------------------------
const listen_eintrag = {
  tabelle: "listen_eintrag",
  konflikt: "haushalt_id,barcode",
  schluessel: (e) => e.barcode,
  zeit: (e) => stempel(e.updatedAt, e.addedAt),
  zuZeile: (e, ctx) => ({
    haushalt_id: ctx.haushaltId,
    art: e.art === "nogo" ? "nogo" : "favorit",
    barcode: e.barcode,
    name: e.name,
    marke: e.brand || null,
    naehrwerte: e.nutri100 || null,
    ampel: e.grade || null,
    geaendert_am: iso(stempel(e.updatedAt, e.addedAt)),
  }),
  ausZeile: (z) => ({
    art: z.art,
    barcode: z.barcode,
    name: z.name,
    brand: z.marke || "",
    nutri100: z.naehrwerte || null,
    // netCarbs100 lesen Listen und Startseite einzeln; aus dem Nährwert-Schnappschuss
    // ableiten statt eine zweite Spalte für denselben Wert zu führen.
    netCarbs100: z.naehrwerte?.netCarbs ?? null,
    grade: z.ampel || null,
    addedAt: millis(z.geaendert_am),
    updatedAt: millis(z.geaendert_am),
  }),
};

// ---------------------------------------------------------------------------
const einkauf = {
  tabelle: "einkauf",
  konflikt: "id",
  schluessel: (i) => i.id,
  zeit: (i) => stempel(i.updatedAt),
  zuZeile: (i, ctx) => ({
    id: i.id,
    haushalt_id: ctx.haushaltId,
    text: i.text,
    erledigt: !!i.checked,
    barcode: i.barcode ?? null,
    geaendert_am: iso(stempel(i.updatedAt)),
  }),
  ausZeile: (z) => ({
    id: z.id,
    text: z.text,
    checked: !!z.erledigt,
    barcode: z.barcode,
    updatedAt: millis(z.geaendert_am),
  }),
};

// ---------------------------------------------------------------------------
// produkt_korrektur — eigenes Produkt UND Ballaststoff-Schalter zu einem Barcode.
// In der App zwei getrennte Karten (ownProducts, fiberOverrides), auf dem Server eine
// Zeile: beides sind Korrekturen an demselben Produkt.
// ---------------------------------------------------------------------------
const produkt_korrektur = {
  tabelle: "produkt_korrektur",
  konflikt: "haushalt_id,barcode",
  schluessel: (k) => k.barcode,
  zeit: (k) => stempel(k.updatedAt),
  zuZeile: (k, ctx) => ({
    haushalt_id: ctx.haushaltId,
    barcode: k.barcode,
    daten: k.daten || null,
    ballaststoff_abziehen: k.ballaststoffAbziehen == null ? null : !!k.ballaststoffAbziehen,
    geaendert_am: iso(stempel(k.updatedAt)),
  }),
  ausZeile: (z) => ({
    barcode: z.barcode,
    daten: z.daten || null,
    ballaststoffAbziehen: z.ballaststoff_abziehen == null ? null : !!z.ballaststoff_abziehen,
    updatedAt: millis(z.geaendert_am),
  }),
};

// ---------------------------------------------------------------------------
// rezept — liegt serverseitig in kochbuch_rezepte, der Tabelle, die sich beide Apps
// seit B1 teilen. Dort ist `id` die Kochbuch-id und `keto_id` die der Keto-App. Die
// App führt weiterhin ihre eigene id und merkt sich die fremde daneben (serverId): die
// Kochbuch-id lässt sich nicht ändern, an ihr hängen Zutaten, Bilder und Kommentare.
//
// Zutaten wandern (noch) nicht mit — kochbuch_zutaten ist eine eigene Tabelle mit
// eigenen Zeilen. Das ist der nächste Schritt, siehe supabase/README.md.
// ---------------------------------------------------------------------------
const rezept = {
  tabelle: "kochbuch_rezepte",
  konflikt: "keto_id",
  schluessel: (r) => r.id,
  zeit: (r) => stempel(r.updatedAt, r.createdAt),
  zuZeile: (r, ctx) => ({
    haushalt_id: ctx.haushaltId,
    keto_id: r.id,
    titel: r.name,
    portionen: Math.max(1, Math.round(Number(r.servings) || 1)),
    quelle: "keto-app",
    keto_updated_at: iso(stempel(r.updatedAt, r.createdAt)),
    geaendert_am: iso(stempel(r.updatedAt, r.createdAt)),
  }),
  ausZeile: (z) => ({
    id: z.keto_id,
    serverId: z.id,
    name: z.titel,
    servings: Number(z.portionen) || 1,
    updatedAt: millis(z.keto_updated_at) ?? millis(z.updated_at),
  }),
};

export const ENTITAETEN = {
  profil, mahlzeit, wasser, tagesziel, listen_eintrag, einkauf, produkt_korrektur, rezept,
};

/**
 * Reihenfolge beim Hochladen. Profile zuerst: Mahlzeit, Wasser und Tagesziel hängen per
 * Fremdschlüssel daran, und Postgres weist die erste Mahlzeit eines neuen Geräts sonst
 * ab. Rezepte davor, weil eine Mahlzeit auf ein Rezept zeigen kann.
 */
export const REIHENFOLGE = [
  "profil", "rezept", "tagesziel", "mahlzeit", "wasser",
  "listen_eintrag", "einkauf", "produkt_korrektur",
];

/** Spalten, die jede abgleichbare Zeile mitbringt — der Rest ist Fachlichkeit. */
export const STANDARDSPALTEN = ["haushalt_id", "geaendert_am", "updated_at", "geloescht_am"];
