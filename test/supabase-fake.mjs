// Kleiner PostgREST-Nachbau fuer den Test von sync2.js. Bildet genau das nach, was der
// Abgleich benutzt: Upsert mit on_conflict, PATCH mit Filtern, GET mit updated_at-Zeiger,
// Sortierung und Seitengroesse — plus den Waechter-Trigger aus der echten Migration.
export class AnmeldeFehler extends Error {}
export function istAngemeldet() { return true; }

export const tabellen = new Map();      // name -> Map(schluessel -> zeile)
export const verlauf = [];              // was angefragt wurde, fuer Zusicherungen im Test
let uhr = 1000;                         // steigende "Transaktionszeit"
export function tick(n = 1) { uhr += n; }
export function jetztISO() { return new Date(uhr).toISOString(); }
export function zuruecksetzen() { tabellen.clear(); verlauf.length = 0; uhr = 1000; }

const tab = (name) => {
  if (!tabellen.has(name)) tabellen.set(name, new Map());
  return tabellen.get(name);
};

/** Primaerschluessel je Tabelle — wie in der echten Datenbank nach B1. */
const SCHLUESSEL = {
  profil: (z) => z.id,
  mahlzeit: (z) => z.id,
  wasser: (z) => z.id,
  einkauf: (z) => z.id,
  tagesziel: (z) => `${z.profil_id}|${z.datum}`,
  listen_eintrag: (z) => `${z.haushalt_id}|${z.barcode}`,
  produkt_korrektur: (z) => `${z.haushalt_id}|${z.barcode}`,
  kochbuch_rezepte: (z) => z.keto_id,
};

function zerlegePfad(pfad) {
  const [name, query = ""] = pfad.split("?");
  const p = new URLSearchParams(query);
  return { name, p };
}

/** stand_fortschreiben(): aelterer Schreibvorgang wird verworfen, sonst updated_at neu. */
function schreibeMitWaechter(karte, schluessel, neu) {
  const alt = karte.get(schluessel);
  if (alt && neu.geaendert_am && alt.geaendert_am && neu.geaendert_am < alt.geaendert_am) {
    return false;                        // Trigger gibt NULL zurueck -> Zeile bleibt
  }
  uhr += 1;
  karte.set(schluessel, { ...alt, ...neu, updated_at: new Date(uhr).toISOString() });
  return true;
}

function passt(zeile, p) {
  for (const [feld, ausdruck] of p.entries()) {
    if (["select", "order", "limit", "on_conflict", "offset"].includes(feld)) continue;
    const [op, ...rest] = ausdruck.split(".");
    const wert = rest.join(".");
    const istWert = zeile[feld];
    if (op === "eq" && String(istWert) !== wert) return false;
    if (op === "gt" && !(String(istWert) > wert)) return false;
    if (op === "is" && wert === "null" && istWert != null) return false;
  }
  return true;
}

export async function rest(pfad, opts = {}) {
  const { name, p } = zerlegePfad(pfad);
  const methode = opts.method || "GET";
  verlauf.push({ methode, name, pfad });
  const karte = tab(name);
  const schluesselVon = SCHLUESSEL[name] || ((z) => z.id);

  if (methode === "GET") {
    let zeilen = [...karte.values()].filter(z => passt(z, p));
    const order = p.get("order");
    if (order?.startsWith("updated_at.asc")) {
      zeilen.sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0));
    }
    const limit = Number(p.get("limit")) || zeilen.length;
    return zeilen.slice(0, limit).map(z => ({ ...z }));
  }

  if (methode === "POST") {
    const zeilen = JSON.parse(opts.body);
    uhr += 1;                                        // eine Anweisung = ein Zeitstempel
    const stempel = new Date(uhr).toISOString();
    const gespeichert = [];
    for (const z of zeilen) {
      const k = schluesselVon(z);
      const alt = karte.get(k);
      // Waechter-Trigger: aeltere Fassung wird verworfen und NICHT zurueckgegeben
      if (alt && z.geaendert_am && alt.geaendert_am && z.geaendert_am < alt.geaendert_am) continue;
      const neu = { id: alt?.id ?? z.id ?? ("srv-" + k), geloescht_am: null, ...alt, ...z, updated_at: stempel };
      karte.set(k, neu);
      gespeichert.push({ ...neu });
    }
    const prefer = String(opts.headers?.Prefer || "");
    return prefer.includes("return=representation") ? gespeichert : null;
  }

  if (methode === "PATCH") {
    const patch = JSON.parse(opts.body);
    for (const [k, z] of karte.entries()) {
      if (passt(z, p)) schreibeMitWaechter(karte, k, { ...z, ...patch });
    }
    return null;
  }

  throw new Error("nicht nachgebildet: " + methode);
}

/** Simuliert das ZWEITE Geraet: schreibt direkt in die Tabellen. */
export function fremdesGeraetSchreibt(name, zeile) {
  uhr += 1;
  const k = (SCHLUESSEL[name] || ((z) => z.id))(zeile);
  tab(name).set(k, { geloescht_am: null, ...zeile, updated_at: new Date(uhr).toISOString() });
}
