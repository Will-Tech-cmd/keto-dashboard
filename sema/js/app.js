// app.js — Sema: KH-Rechner für Typ-1-Diabetes. Umsetzung des Entwurfs „Sema App.dc.html“ aus
// Claude Design. Der Entwurf läuft auf einer React-Laufzeit; hier ist er in schlichtes HTML
// aus Zeichenketten übersetzt — kein Bauschritt, keine Abhängigkeit (siehe CLAUDE.md).
//
// Aufbau: ein Zustand S, eine Funktion zeichnen(), die den Bildschirm aus S neu aufbaut, und
// Ereignisse über data-act/data-in am Dokument. Der Kamerabildschirm ist die Ausnahme: das
// <video> darf nicht neu gezeichnet werden, solange es läuft (siehe scanStarten).

import {
  MAHLZEITEN, zahl, r0, r1, summeKh, tagSchluessel, tagVerschieben, altesEntfernen,
  sucheZerlegen, favKhJePortion, favKhFuerGramm, favPortionText, fotoSpanne,
  aufGewichtVerteilen, exportDaten, favsZusammenfuehren, importPruefen, neueId,
  listenZusammenfuehren, grundErgaenzen, grundName, grundHatWert, bekanntenWertFinden, abweichung,
  KI_ABWEICHUNG_GRENZE, plausibilitaet, mahlzeitUeberGrenze, teilVerzehr, anteilAusRest, anteilText,
  rezeptRechnen, taraAbziehen, teilenText,
} from "./logik.js";
import { lesen, schreiben, dauerhaftAnfragen } from "./speicher.js";
import { GRUNDDATEN, GRUND_VERSION } from "./grunddaten.js";
import { produktPerBarcode, sucheNachName } from "./off.js";
import { fotoAnalysieren, khSchaetzen } from "./ki.js";
// Kamera und Barcode-Erkennung teilt sich Sema mit der Keto-App (nativer BarcodeDetector,
// sonst das eingecheckte ZXing unter vendor/zxing/).
import { startScanner, stopScanner, isScannerSupported } from "../../js/scanner.js";

const $app = document.getElementById("app");
const $toast = document.getElementById("toast");

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

function mahlzeitNachUhrzeit(d = new Date()) {
  const h = d.getHours();
  return h < 10 ? "Frühstück" : h < 14 ? "Mittag" : h < 17 ? "Snack" : "Abend";
}

const S = {
  screen: "home",
  meal: mahlzeitNachUhrzeit(),
  favs: [],
  eintraege: [],
  produkte: {},
  grund: [],        // Lebensmittel-Liste (Startwerte + Elternwerte), siehe grunddaten.js
  behaelter: [],    // { id, name, gramm, updatedAt } — Tara für Vesperbox, Teller, Becher
  // grenze: Hinweis ab so vielen g KH je Mahlzeit. Leer = aus — einen Standardwert zu raten
  // wäre falsch, er hängt von Sema ab und gehört von den Eltern eingetragen.
  profil: { name: "Sema", gewicht: "", gewichtDatum: null, grenze: "" },
  einst: { anbieter: "Gemini", keys: { Gemini: "", OpenAI: "" }, hinweisGesehen: false },
  sheet: null,      // { favId, menge }
  favEdit: null,    // Formular „Favorit anlegen/bearbeiten“
  grundEdit: null,  // Formular „Lebensmittel bearbeiten“
  teil: null,       // Blatt „Teilweise gegessen“: { art: "eintrag"|"mahlzeit", id|meal, restStr }
  rezept: null,     // Bildschirm „Eigenes Gericht“
  taraAuf: {},      // je Eingabefeld die abgezogene Behälter-id — verhindert doppeltes Abziehen
  listeFilter: "",
  kopiert: new Set(),
  q: "",
  online: { fuer: "", laeuft: false, treffer: [], fehler: "" },
  kiSuche: { fuer: "", laeuft: false, ergebnis: null, fehler: "" },
  foto: null,
  scan: null,
  anleitung: false,
};

const neuesFoto = () => ({ schritt: "aufnahme", gewicht: "", gericht: "", komps: [], fehler: "" });
const neuerScan = () => ({
  schritt: "kamera", status: "", barcode: "", codeEingabe: "",
  name: "", marke: "", kh100Str: "", manuell: false, portionStr: "", menge: 1, gespeichert: false,
});

async function laden() {
  const [favs, eintraege, produkte, profil, einst, grund, grundVersion, behaelter] = await Promise.all([
    lesen("favs", []), lesen("eintraege", []), lesen("produkte", {}),
    lesen("profil", null), lesen("einst", null),
    lesen("grund", []), lesen("grundVersion", 0), lesen("behaelter", []),
  ]);
  S.favs = favs;
  S.eintraege = altesEntfernen(eintraege);
  S.produkte = produkte;
  S.behaelter = behaelter;
  if (profil) S.profil = { ...S.profil, ...profil };
  if (einst) S.einst = { ...S.einst, ...einst, keys: { ...S.einst.keys, ...(einst.keys || {}) } };
  if (S.eintraege.length !== eintraege.length) await schreiben("eintraege", S.eintraege);
  // Startwerte nur ergänzen, wenn die App neuere mitbringt. Eine gelöschte Startzeile kommt
  // deshalb erst mit der nächsten GRUND_VERSION zurück — gewollt: wer sie löscht, will sie weg.
  S.grund = grund;
  if (grundVersion < GRUND_VERSION) {
    S.grund = grundErgaenzen(grund, GRUNDDATEN).liste;
    await schreiben("grund", S.grund);
    await schreiben("grundVersion", GRUND_VERSION);
  }
}

const SPEICHER = {
  eintraege: () => S.eintraege, favs: () => S.favs, produkte: () => S.produkte,
  profil: () => S.profil, einst: () => S.einst, grund: () => S.grund, behaelter: () => S.behaelter,
};

function sichern(...schluessel) {
  for (const k of schluessel) {
    schreiben(k, SPEICHER[k]()).catch(() => melden("Speichern fehlgeschlagen.", true));
  }
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SVG = (inhalt, g = 24, extra = "") =>
  `<svg width="${g}" height="${g}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${inhalt}</svg>`;
const I = {
  zurueck: '<path d="m15 18-6-6 6-6"/>',
  kamera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 7v10"/><path d="M12 7v10"/><path d="M16 7v10"/>',
  suche: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  haken: '<path d="M20 6 9 17l-5-5"/>',
  muell: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  stern: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  home: '<path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  tag: '<path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/><path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>',
  profil: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  teilen: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  teller: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
};

/** Warnungen gesammelt anzeigen. Bewusst auffällig, aber ohne den Knopf zu sperren. */
const warnHtml = (liste) => liste.length ? `
<div role="alert" class="stapel" style="gap:4px;font-size:15px;font-weight:600;color:var(--color-accent-900);background:var(--color-accent-100);padding:10px 14px;border-radius:18px">
  ${liste.map((w) => `<span style="display:flex;gap:8px;align-items:flex-start">${SVG(I.warn, 18, 'style="flex:none;margin-top:2px"')}<span>${esc(w)}</span></span>`).join("")}
</div>` : "";

/**
 * Behälter-Knöpfe unter einem Gewichtsfeld. Pro Feld lässt sich ein Behälter einmal abziehen;
 * wer das Feld danach von Hand ändert, setzt das zurück (siehe EINGABEN). Ohne diese Sperre
 * zieht ein zweiter Tipp den Teller zweimal ab — still und genau in der Größenordnung, die man
 * nicht bemerkt.
 */
function taraChips(ziel) {
  if (!S.behaelter.length) return "";
  const auf = S.taraAuf[ziel];
  const b = auf && S.behaelter.find((x) => x.id === auf);
  if (b) return `<span class="klein" style="font-weight:600;color:var(--color-accent-2-800)">− ${esc(b.name)} (${r0(b.gramm)} g) abgezogen</span>`;
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><span class="klein leise">Abziehen:</span>${S.behaelter.map((x) =>
    `<button type="button" class="btn btn-secondary btn-text" data-act="tara" data-ziel="${ziel}" data-id="${esc(x.id)}" style="min-height:40px;font-size:15px;padding:0 12px">− ${esc(x.name)} ${r0(x.gramm)} g</button>`).join("")}</div>`;
}

/** Bekannter Wert aus allen Quellen (für Zutaten und den KI-Abgleich). */
const bekannt = (name) => bekanntenWertFinden(name, { favs: S.favs, grund: S.grund, produkte: Object.values(S.produkte) });

const heute = () => tagSchluessel();
const eintraegeVon = (tag) => S.eintraege.filter((e) => e.date === tag);
const tagText = (d = new Date()) => d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
const datumText = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE") : "noch nie");
const keyAktuell = () => S.einst.keys[S.einst.anbieter] || "";
const uhrzeitVon = (items) => {
  const ms = Math.min(...items.map((e) => e.createdAt || Date.now()));
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};

let toastTimer;
function melden(text, fehler = false) {
  clearTimeout(toastTimer);
  $toast.className = `toast an${fehler ? " fehler" : ""}`;
  $toast.innerHTML = `${SVG(fehler ? I.info : I.haken, 22, 'style="flex:none;color:var(--color-accent-2-300)"')}<span>${esc(text)}</span>`;
  $toast.hidden = false;
  toastTimer = setTimeout(() => { $toast.hidden = true; }, fehler ? 4200 : 2400);
}

function eintragen(liste, nachricht) {
  const jetzt = Date.now();
  const tag = heute();
  S.eintraege.push(...liste.map((e) => ({ id: neueId(), date: tag, createdAt: jetzt, ...e })));
  sichern("eintraege");
  const mahlzeiten = [...new Set(liste.map((e) => e.meal))];
  const ueber = mahlzeiten.find((m) => mahlzeitUeberGrenze(summeKh(eintraegeVon(tag).filter((e) => e.meal === m)), S.profil.grenze));
  if (ueber) {
    melden(`${nachricht} – ${ueber} liegt jetzt über ${r0(zahl(S.profil.grenze))} g KH. Bitte prüfen.`, true);
  } else {
    melden(nachricht);
  }
}

function gehe(screen) {
  if (S.screen === "scan" && screen !== "scan") stopScanner();
  S.screen = screen;
  S.sheet = null;
  S.favEdit = null;
  S.grundEdit = null;
  S.teil = null;
  S.taraAuf = {};
  if (screen === "foto") S.foto = neuesFoto();
  if (screen === "scan") S.scan = neuerScan();
  if (screen === "suche") {
    S.q = "";
    S.online = { fuer: "", laeuft: false, treffer: [], fehler: "" };
    S.kiSuche = { fuer: "", laeuft: false, ergebnis: null, fehler: "" };
  }
  zeichnen();
  window.scrollTo(0, 0);
  if (screen === "scan") scanStarten();
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

const mahlzeitWahl = () => `
<div class="stapel" style="gap:8px"><span style="font-size:15px;font-weight:600">Mahlzeit</span>
<div class="pillen" style="grid-template-columns:repeat(4,minmax(0,1fr))">
${MAHLZEITEN.map((m) => `<button class="knopf-roh pille" data-act="mahlzeit" data-wert="${m}" aria-pressed="${m === S.meal}">${m}</button>`).join("")}
</div></div>`;

const tagKi = (text = "KI · geschätzt") => `<span class="tag tag-accent" style="font-size:13px;font-weight:600">${esc(text)}</span>`;

// ---------------------------------------------------------------------------
// Bildschirme
// ---------------------------------------------------------------------------

function startseite() {
  const summe = summeKh(eintraegeVon(heute()));
  const favs = S.favs.map((f) => `
<div class="fav-zeile">
  <button class="knopf-roh" data-act="favOeffnen" data-id="${esc(f.id)}" style="flex:1;min-width:0;display:flex;flex-direction:column;padding:6px 0">
    <span style="font-size:18px;font-weight:600">${esc(f.name)}</span>
    <span style="font-size:15px" class="leise">${esc(favPortionText(f))} · ${r0(favKhJePortion(f))} g KH</span>
  </button>
  <button class="knopf-roh rund rund-plus" data-act="favSchnell" data-id="${esc(f.id)}" aria-label="${esc(f.name)} hinzufügen">${SVG(I.plus, 26)}</button>
</div>`).join("");

  return `
<div class="stapel" style="gap:22px;padding-top:8px">
  <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px">
    <div><div style="font-size:16px" class="leise">${esc(tagText())}</div><h1 style="margin:0;font-size:38px">${esc(S.profil.name || "Sema")}</h1></div>
    <button class="knopf-roh summe-knopf" data-act="gehe" data-wert="tag">
      <span style="font-size:14px;font-weight:600;color:var(--color-accent-2-800)">Heute gesamt</span>
      <span style="font-family:var(--font-heading);font-size:34px;line-height:1.1;color:var(--color-accent-2-900)">${r0(summe)} g KH</span>
    </button>
  </div>
  <div class="stapel" style="gap:12px">
    <button class="knopf-roh aktion aktion-haupt" data-act="gehe" data-wert="foto">
      <span class="aktion-ikone">${SVG(I.kamera, 28)}</span>
      <span class="stapel"><span class="aktion-titel">Foto</span><span class="aktion-text">Teller fotografieren</span></span>
    </button>
    <button class="knopf-roh aktion" data-act="gehe" data-wert="scan">
      <span class="aktion-ikone">${SVG(I.scan, 28)}</span>
      <span class="stapel"><span class="aktion-titel">Scannen</span><span class="aktion-text">Barcode einer Packung</span></span>
    </button>
    <button class="knopf-roh aktion" data-act="gehe" data-wert="suche">
      <span class="aktion-ikone">${SVG(I.suche, 28)}</span>
      <span class="stapel"><span class="aktion-titel">Eingeben</span><span class="aktion-text">z. B. „Birne 50 g“</span></span>
    </button>
  </div>
  <div class="stapel" style="gap:10px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
      <h3 style="margin:0;font-size:24px">Favoriten</h3>
      ${S.favs.length ? `<span style="font-size:15px" class="leise">+ fügt zu ${esc(S.meal)} hinzu</span>` : ""}
    </div>
    ${favs || `<div class="karte" style="font-size:16px">Noch keine Favoriten. Lege häufige Lebensmittel an – oder speichere sie beim Scannen und Suchen.</div>`}
    <div style="display:flex;flex-wrap:wrap;gap:4px 16px">
      <button class="btn btn-ghost btn-text" data-act="favNeu" style="font-size:16px;min-height:44px;padding:0 4px">+ Neuer Favorit</button>
      <button class="btn btn-ghost btn-text" data-act="rezeptNeu" style="font-size:16px;min-height:44px;padding:0 4px">+ Eigenes Gericht</button>
    </div>
  </div>
  ${listeHinweis()}
</div>`;
}

/** Erinnerung auf der Startseite, solange Startwerte ohne Wert oder ungeprüft sind. */
function listeHinweis() {
  const fehlt = S.grund.filter((g) => !grundHatWert(g)).length;
  const offen = S.grund.filter((g) => grundHatWert(g) && !g.verifiziert).length;
  if (!fehlt && !offen) return "";
  const teile = [fehlt ? `${fehlt} ohne Wert` : "", offen ? `${offen} Richtwerte ungeprüft` : ""].filter(Boolean).join(" · ");
  return `
<button class="knopf-roh karte stapel" data-act="gehe" data-wert="liste" style="gap:4px">
  <span style="font-size:17px;font-weight:700">Lebensmittel-Liste</span>
  <span style="font-size:15px" class="leise">${esc(teile)} – Werte mit den Eltern abgleichen</span>
</button>`;
}

function tagesansicht() {
  const tag = heute(), gestern = tagVerschieben(tag, -1);
  const heuteListe = eintraegeVon(tag), gesternListe = eintraegeVon(gestern);
  const gruppen = (liste) => MAHLZEITEN.map((m) => ({ m, items: liste.filter((e) => e.meal === m) })).filter((g) => g.items.length);

  const heuteHtml = gruppen(heuteListe).map(({ m, items }) => {
    const summe = summeKh(items);
    const teilweise = items.some((e) => e.anteil != null);
    const eingegeben = items.reduce((a, e) => a + (e.khUrspruenglich ?? e.kh), 0);
    return `
<div class="stapel" style="gap:4px;padding:16px 18px;border-radius:28px;background:var(--color-neutral-100)">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px">
    <h4 style="margin:0;font-size:21px">${m} <span class="leise" style="font-family:var(--font-body);font-size:14px;font-weight:600">${esc(uhrzeitVon(items))}</span></h4>
    <span style="font-size:20px;font-weight:700">${r0(summe)} g</span>
  </div>
  ${teilweise ? `<span style="font-size:15px;font-weight:600;color:var(--color-accent-2-800)">Eingegeben ${r0(eingegeben)} g, gegessen ${r0(summe)} g (−${r0(eingegeben - summe)} g)</span>` : ""}
  ${mahlzeitUeberGrenze(summe, S.profil.grenze) ? warnHtml([`Über ${r0(zahl(S.profil.grenze))} g KH – Eingaben prüfen.`]) : ""}
  ${items.map((e) => `
  <div class="zeile-trenner">
    <button class="knopf-roh" data-act="teilEintrag" data-id="${esc(e.id)}" style="flex:1;min-width:0;display:flex;flex-direction:column;padding:6px 0" aria-label="${esc(e.name)}: gegessenen Anteil festlegen">
      <span style="font-size:17px;font-weight:600">${esc(e.name)}</span>
      <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:14px" class="leise">${esc(e.amount)}${e.src === "ki" ? tagKi() : ""}${e.anteil != null ? `<span class="tag tag-accent-2" style="font-size:13px;font-weight:700">${anteilText(e.anteil)} gegessen · von ${r0(e.khUrspruenglich)} g</span>` : ""}</span>
    </button>
    <span style="font-size:18px;font-weight:700">${r0(e.kh)} g</span>
    <button class="knopf-roh rund rund-weg" data-act="eintragLoeschen" data-id="${esc(e.id)}" aria-label="${esc(e.name)} löschen">${SVG(I.x, 20)}</button>
  </div>`).join("")}
  <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px">
    <button class="btn btn-ghost btn-text" data-act="teilMahlzeit" data-wert="${m}" style="font-size:15px;min-height:44px;padding:0 4px">Nicht aufgegessen?</button>
    <button class="btn btn-ghost btn-text" data-act="teilen" data-wert="${m}" style="font-size:15px;min-height:44px;padding:0 4px;gap:6px">${SVG(I.teilen, 18)}Teilen</button>
  </div>
</div>`;
  }).join("");

  const gesternHtml = gruppen(gesternListe).map(({ m, items }) => `
<div class="stapel" style="gap:2px;padding:14px 16px 10px 18px;border-radius:28px;border:2px dashed var(--color-neutral-400)">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><h4 style="margin:0;font-size:19px">${m}</h4>
  <button class="btn btn-ghost btn-text" data-act="alleUebernehmen" data-wert="${m}" style="font-size:15px;min-height:44px;padding:0 12px">Alles übernehmen</button></div>
  ${items.map((e) => `
  <div style="display:flex;align-items:center;gap:10px;min-height:52px">
    <div style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:17px">${esc(e.name)}</span><span style="font-size:14px" class="leise">${esc(e.amount)} · ${r0(e.kh)} g KH</span></div>
    ${S.kopiert.has(e.id)
      ? `<span class="rund rund-ok">${SVG(I.haken, 22)}</span>`
      : `<button class="knopf-roh rund rund-flaeche" data-act="uebernehmen" data-id="${esc(e.id)}" aria-label="${esc(e.name)} übernehmen">${SVG(I.plus, 22)}</button>`}
  </div>`).join("")}
</div>`).join("");

  return `
<div class="stapel" style="gap:18px;padding-top:8px">
  <div>
    <div style="font-size:16px" class="leise">${esc(tagText())}</div>
    <div style="display:flex;align-items:baseline;gap:10px"><h1 style="margin:0;font-size:52px">${r0(summeKh(heuteListe))}</h1><span style="font-size:22px;font-weight:600">g KH heute</span></div>
    ${heuteListe.length ? `<button class="btn btn-secondary" data-act="teilen" data-wert="" style="margin-top:8px;min-height:48px;font-size:16px;gap:8px">${SVG(I.teilen, 20)}Ganzen Tag teilen</button>` : ""}
  </div>
  ${heuteListe.length ? `<p style="margin:0;font-size:15px" class="leise">Nicht aufgegessen? Auf einen Eintrag tippen.</p>${heuteHtml}` : `<div class="karte" style="padding:20px;font-size:17px">Heute noch nichts eingetragen.</div>`}
  <div class="stapel" style="gap:10px;margin-top:10px">
    <div style="display:flex;align-items:baseline;justify-content:space-between"><h3 style="margin:0;font-size:24px">Gestern</h3><span style="font-size:15px" class="leise">${r0(summeKh(gesternListe))} g KH</span></div>
    ${gesternListe.length
      ? `<p style="margin:0;font-size:15px" class="leise">Ein Tipp übernimmt den Eintrag in die gleiche Mahlzeit von heute.</p>${gesternHtml}`
      : `<p style="margin:0;font-size:15px" class="leise">Gestern wurde nichts eingetragen.</p>`}
    <p style="margin:4px 0 0" class="klein leise">Die App behält nur die letzten 7 Tage.</p>
  </div>
</div>`;
}

// — Suche ——————————————————————————————————————————————————————————————

/** Treffer in der Reihenfolge der Spezifikation: Favoriten, Barcode-Datenbank, KI. */
function suchTreffer() {
  const { name, gramm } = sucheZerlegen(S.q);
  const key = name.toLowerCase();
  const treffer = [];
  if (key.length < 2) return { name, gramm, key, treffer };

  for (const f of S.favs.filter((f) => f.name.toLowerCase().includes(key))) {
    if (gramm != null) {
      const kh = favKhFuerGramm(f, gramm);
      if (kh != null) { treffer.push({ art: "fav", name: f.name, amount: `${r0(gramm)} g`, basis: favBasis(f), kh, favId: f.id }); continue; }
    }
    treffer.push({ art: "fav", name: f.name, amount: favPortionText(f), basis: favBasis(f), kh: favKhJePortion(f), favId: f.id, portion: true, gramm: f.portionG || null });
  }
  // Lebensmittel-Liste: bestätigte Werte vor ungeprüften Richtwerten, Platzhalter zuletzt.
  const rang = (g) => (!grundHatWert(g) ? 2 : g.verifiziert ? 0 : 1);
  const grund = S.grund.filter((g) => grundName(g).toLowerCase().includes(key) && !treffer.some((t) => t.name.toLowerCase() === g.name.toLowerCase()))
    .sort((a, b) => rang(a) - rang(b)).slice(0, 4);
  for (const g of grund) {
    const wert = grundHatWert(g);
    treffer.push({
      art: "grund", name: grundName(g), grundId: g.id, verifiziert: !!g.verifiziert, leer: !wert,
      kh100: wert ? Number(g.kh100) : null, gramm, hinweis: g.hinweis,
      basis: wert ? `${r1(g.kh100)} g KH / 100 g · ${g.verifiziert ? "von Eltern bestätigt" : "Richtwert, ungeprüft"}` : "Wert fehlt noch",
    });
  }
  // Gescannte Produkte liegen lokal — sie zählen als Barcode-Datenbank und gehen auch offline.
  const lokal = Object.values(S.produkte).filter((p) => p.kh100 != null && p.name.toLowerCase().includes(key)
    && !treffer.some((t) => t.name === p.name));
  const online = S.online.fuer === key ? S.online.treffer : [];
  for (const p of [...lokal, ...online.filter((o) => !lokal.some((l) => l.barcode && l.barcode === o.barcode))]) {
    treffer.push({ art: "db", name: p.marke ? `${p.name} (${p.marke})` : p.name, kh100: p.kh100, basis: `${r1(p.kh100)} g KH / 100 g`, gramm });
  }
  const ki = S.kiSuche.fuer === key ? S.kiSuche.ergebnis : null;
  if (ki) treffer.push({ art: "ki", name: ki.name, kh100: ki.kh100, basis: `${r1(ki.kh100)} g KH / 100 g · ${Math.round(ki.konfidenz * 100)} % sicher`, gramm });
  for (const t of treffer) {
    if (t.art !== "fav") {
      t.amount = gramm != null ? `${r0(gramm)} g` : "Gramm fehlen";
      // Ohne Wert bleibt kh null statt 0 — ein Platzhalter darf nie als „0 g KH“ eingetragen werden.
      t.kh = gramm != null && t.kh100 != null ? (t.kh100 * gramm) / 100 : null;
    }
  }
  return { name, gramm, key, treffer };
}

function favBasis(f) {
  if (f.kh100 != null && f.kh100 !== "") return `${r1(f.kh100)} g KH / 100 g`;
  return `${r1(favKhJePortion(f))} g KH / ${f.unit || "Portion"}`;
}

let suchTimer;
function sucheAktualisieren() {
  clearTimeout(suchTimer);
  const { key, treffer } = suchTreffer();
  if (key.length < 3 || treffer.length || S.online.fuer === key) return;
  // Erst nach einer Tipp-Pause ins Netz: Open Food Facts weist bei vielen Anfragen ab.
  suchTimer = setTimeout(async () => {
    S.online = { fuer: key, laeuft: true, treffer: [], fehler: "" };
    zeichnen();
    try {
      const t = await sucheNachName(key);
      if (S.online.fuer === key) S.online = { fuer: key, laeuft: false, treffer: t, fehler: "" };
    } catch {
      if (S.online.fuer === key) S.online = { fuer: key, laeuft: false, treffer: [], fehler: navigator.onLine ? "Datenbank gerade nicht erreichbar." : "Ohne Netz sind nur Favoriten verfügbar." };
    }
    if (S.screen === "suche") zeichnen();
  }, 700);
}

function suche() {
  const { name, gramm, key, treffer } = suchTreffer();
  const leer = S.q.trim().length === 0;
  const onlineLaeuft = S.online.laeuft && S.online.fuer === key;
  const kiLaeuft = S.kiSuche.laeuft && S.kiSuche.fuer === key;
  const kiMoeglich = key.length >= 2 && !treffer.some((t) => t.art !== "ki" && !t.leer) && !onlineLaeuft && !(S.kiSuche.fuer === key && S.kiSuche.ergebnis);
  const tags = {
    fav: '<span class="tag tag-accent-2" style="font-size:13px;font-weight:700">1 · Favorit</span>',
    grund: (t) => t.leer
      ? '<span class="tag tag-neutral" style="font-size:13px;font-weight:700;background:var(--color-neutral-200)">2 · Liste · Wert fehlt</span>'
      : t.verifiziert
        ? '<span class="tag tag-accent-2" style="font-size:13px;font-weight:700">2 · Liste · bestätigt</span>'
        : `<span class="tag tag-accent" style="font-size:13px;font-weight:700;display:inline-flex;gap:4px;align-items:center">${SVG(I.warn, 14)}2 · Richtwert · ungeprüft</span>`,
    db: '<span class="tag tag-neutral" style="font-size:13px;font-weight:700;background:var(--color-neutral-200)">3 · Barcode-Datenbank</span>',
    ki: '<span class="tag tag-accent" style="font-size:13px;font-weight:700">4 · KI-Schätzung · geschätzt</span>',
  };
  const tagVon = (t) => (typeof tags[t.art] === "function" ? tags[t.art](t) : tags[t.art]);

  const karten = treffer.map((t, i) => {
    const warnungen = plausibilitaet({ kh100: t.kh100, gramm: t.gramm });
    const knopfText = t.leer ? "Wert fehlt noch" : t.kh == null ? "Erst Gramm angeben" : `Zu ${esc(S.meal)} hinzufügen`;
    return `
<div class="stapel" style="gap:10px;padding:16px 18px;border-radius:28px;background:var(--color-neutral-100)">
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${tagVon(t)}</div>
  <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px">
    <div class="stapel" style="min-width:0"><span style="font-size:20px;font-weight:700">${esc(t.name)}</span><span style="font-size:15px" class="leise">${esc(t.amount)} · ${esc(t.basis)}</span>${t.hinweis ? `<span class="klein leise">${esc(t.hinweis)}</span>` : ""}</div>
    <span style="font-family:var(--font-heading);font-size:32px;line-height:1;flex:none">${t.kh == null ? "–" : r0(t.kh)} g</span>
  </div>
  ${warnHtml(warnungen)}
  <button class="btn btn-primary" data-act="trefferHinzu" data-i="${i}" style="min-height:52px;font-size:18px" ${t.kh == null ? "disabled" : ""}>${knopfText}</button>
  <div style="display:flex;flex-wrap:wrap;gap:0 14px">
    ${t.art === "grund" ? `<button class="btn btn-ghost btn-text" data-act="grundBearbeiten" data-id="${esc(t.grundId)}" style="font-size:15px;min-height:40px;padding:0 4px">${t.leer ? "Wert eintragen" : "Wert ändern"}</button>` : ""}
    ${t.art === "grund" && !t.leer && !t.verifiziert ? `<button class="btn btn-ghost btn-text" data-act="grundBestaetigen" data-id="${esc(t.grundId)}" style="font-size:15px;min-height:40px;padding:0 4px">Von Eltern bestätigt</button>` : ""}
    ${t.art !== "fav" && t.kh100 != null ? `<button class="btn btn-ghost btn-text" data-act="trefferFav" data-i="${i}" style="font-size:15px;min-height:40px;padding:0 4px">Als Favorit speichern</button>` : ""}
  </div>
</div>`;
  }).join("");

  return `
<div class="stapel" style="gap:16px">
  <div style="position:relative">
    <input class="input" data-in="q" value="${esc(S.q)}" placeholder="z. B. Birne 50 g" enterkeyhint="search" autocomplete="off" aria-label="Lebensmittel und Gramm"
      style="min-height:60px;font-size:20px;padding-left:52px;background:var(--color-neutral-100);border-width:2px">
    ${SVG(I.suche, 24, 'style="position:absolute;left:18px;top:18px;color:var(--color-neutral-700)"')}
  </div>
  ${leer ? `
  <div class="stapel" style="gap:10px">
    <span style="font-size:15px" class="leise">Lebensmittel und Gramm eingeben${S.favs.length ? ". Favoriten:" : ", z. B. „Birne 50 g“."}</span>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${S.favs.slice(0, 6).map((f) => `<button class="btn btn-secondary btn-text" data-act="vorschlag" data-wert="${esc(f.name)}" style="font-weight:600;font-size:16px;min-height:46px;padding:0 18px">${esc(f.name)}</button>`).join("")}
    </div>
  </div>` : ""}
  ${treffer.length && gramm == null ? `<div style="font-size:15px;color:var(--color-accent-800);background:var(--color-accent-100);padding:10px 16px;border-radius:20px">Tipp: Gramm mit angeben, z. B. „${esc(name)} 50 g“.</div>` : ""}
  ${gramm != null ? taraChips("suche") : ""}
  ${karten}
  ${onlineLaeuft ? `<div class="karte" style="display:flex;align-items:center;gap:14px;font-size:16px"><span class="spinner" style="width:28px;height:28px;border-width:4px"></span>Suche in der Barcode-Datenbank …</div>` : ""}
  ${kiLaeuft ? `<div class="karte" style="display:flex;align-items:center;gap:14px;font-size:16px"><span class="spinner" style="width:28px;height:28px;border-width:4px"></span>KI schätzt …</div>` : ""}
  ${!leer && key.length >= 2 && !treffer.length && !onlineLaeuft && !kiLaeuft ? `
  <div class="karte stapel" style="font-size:17px;gap:10px">
    ${S.online.fuer === key && S.online.fehler ? esc(S.online.fehler) : "Nichts gefunden."}
    ${S.kiSuche.fuer === key && S.kiSuche.fehler ? `<span style="font-size:15px;color:var(--color-accent-800)">${esc(S.kiSuche.fehler)}</span>` : ""}
  </div>` : ""}
  ${kiMoeglich && !kiLaeuft ? `<button class="btn btn-secondary" data-act="kiSchaetzen" style="min-height:52px;font-size:17px">KI schätzen lassen (${esc(S.einst.anbieter)})</button>` : ""}
  ${!leer && key.length >= 2 && !treffer.length && !onlineLaeuft ? `<button class="btn btn-secondary" data-act="gehe" data-wert="foto" style="min-height:48px;font-size:17px">Stattdessen Foto machen</button>` : ""}
  ${treffer.length ? mahlzeitWahl() : ""}
</div>`;
}

// — Scannen ————————————————————————————————————————————————————————————

function scannen() {
  const s = S.scan;
  if (s.schritt === "kamera") {
    return `
<div class="stapel" style="gap:16px">
  <div class="kamera">
    <video id="scan-video" playsinline muted></video>
    <span class="kamera-rahmen"></span>
    <span class="kamera-text">Barcode in den Rahmen halten</span>
    <span class="kamera-text" id="scan-status" style="font-size:14px;font-weight:400;color:var(--color-neutral-300)">${esc(s.status)}</span>
  </div>
  <form class="karte stapel" data-form="code" style="gap:8px">
    <label for="code" style="font-size:15px;font-weight:600">Kamera geht nicht? Nummer unter dem Barcode eingeben</label>
    <div style="display:flex;gap:8px">
      <input class="input" id="code" data-in="codeEingabe" inputmode="numeric" autocomplete="off" value="${esc(s.codeEingabe)}" placeholder="z. B. 4000417025005" style="min-height:52px;font-size:18px">
      <button class="btn btn-primary" type="submit" style="min-height:52px;font-size:17px;flex:none">Suchen</button>
    </div>
  </form>
</div>`;
  }
  if (s.schritt === "laedt") return `<div class="laden"><span class="spinner"></span>Suche bei Open Food Facts …</div>`;

  const kh100 = zahl(s.kh100Str), portion = zahl(s.portionStr);
  const kh = s.menge * portion * kh100 / 100;
  const bereit = kh100 > 0 && portion > 0 && s.name.trim();
  return `
<div class="stapel" style="gap:16px">
  <div class="karte stapel" style="gap:6px">
    <span class="tag tag-neutral" style="align-self:flex-start;font-size:13px;font-weight:700;background:var(--color-neutral-200)">${s.quelle === "off" ? "Open Food Facts" : s.quelle === "lokal" ? "Schon einmal gescannt" : s.offline ? "Datenbank nicht erreichbar" : "Nicht in der Datenbank"}</span>
    ${s.quelle ? `<span style="font-family:var(--font-heading);font-size:26px;line-height:1.2">${esc(s.name)}</span>${s.marke ? `<span class="leise" style="font-size:15px">${esc(s.marke)}</span>` : ""}`
      : `<label class="stapel" style="gap:4px;font-size:15px;font-weight:600">Name<input class="input" data-in="scanName" value="${esc(s.name)}" placeholder="z. B. Mini Knoppers" style="min-height:52px;font-size:18px"></label>`}
    ${!s.manuell
      ? `<span style="font-size:16px;color:var(--color-neutral-800)">${r1(kh100)} g KH pro 100 g</span>
         <button class="btn btn-ghost btn-text" data-act="scanManuell" style="align-self:flex-start;font-weight:600;font-size:15px;min-height:40px;padding:0 4px">Wert falsch? Von der Packung eingeben</button>`
      : `${s.quelle === "off" && !s.kh100Orig ? `<span style="font-size:15px;color:var(--color-accent-800)">Open Food Facts kennt die KH nicht. Bitte von der Packung abschreiben.</span>` : ""}
         <label class="feld-zeile" style="font-size:16px">KH pro 100 g<input class="input" data-in="scanKh" inputmode="decimal" value="${esc(s.kh100Str)}" style="width:100px;min-height:48px;font-size:18px;text-align:center"> g</label>`}
  </div>
  <div class="karte stapel" style="gap:8px">
    <span style="font-size:15px;font-weight:600">Portion festlegen</span>
    <label class="feld-zeile">1 Stück =<input class="input" data-in="scanPortion" inputmode="decimal" value="${esc(s.portionStr)}" placeholder="–" style="width:90px;min-height:52px;font-size:20px;text-align:center"> g</label>
  </div>
  <div class="stapel" style="gap:12px;padding:18px;border-radius:28px;background:var(--color-accent-2-100)">
    <span style="font-size:15px;font-weight:600;color:var(--color-accent-2-800)">Wie viele?</span>
    <div style="display:flex;align-items:center;justify-content:space-between">
      <button class="knopf-roh rund rund-hell" data-act="scanMenge" data-wert="-1" aria-label="Weniger">${SVG(I.minus, 28)}</button>
      <span style="font-family:var(--font-heading);font-size:40px">${s.menge} Stück</span>
      <button class="knopf-roh rund rund-hell" data-act="scanMenge" data-wert="1" aria-label="Mehr">${SVG(I.plus, 28)}</button>
    </div>
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;border-top:1px solid var(--color-divider);padding-top:10px">
      <span style="font-size:14px;color:var(--color-accent-2-800)">${s.menge} × ${r1(portion)} g × ${r1(kh100)} %</span>
      <span style="font-family:var(--font-heading);font-size:34px;color:var(--color-accent-2-900)">${r0(kh)} g KH</span>
    </div>
  </div>
  ${warnHtml(plausibilitaet({ kh100: s.kh100Str === "" ? null : kh100, gramm: s.menge * portion }))}
  ${mahlzeitWahl()}
  <button class="btn btn-primary" data-act="scanHinzu" style="min-height:58px;font-size:20px" ${bereit ? "" : "disabled"}>Hinzufügen</button>
  ${s.gespeichert
    ? `<div style="text-align:center;font-size:16px;font-weight:600;color:var(--color-accent-2-800);padding:12px">Als Favorit gespeichert</div>`
    : `<button class="btn btn-secondary" data-act="scanFav" style="min-height:52px;font-size:17px;gap:8px" ${bereit ? "" : "disabled"}>${SVG(I.stern, 20)}Als Favorit speichern</button>`}
  <button class="btn btn-ghost btn-text" data-act="gehe" data-wert="scan" style="font-weight:600;font-size:16px;min-height:44px">Anderes Produkt scannen</button>
</div>`;
}

async function scanStarten() {
  const video = document.getElementById("scan-video");
  const status = (t) => { S.scan.status = t; const el = document.getElementById("scan-status"); if (el) el.textContent = t; };
  if (!video || !isScannerSupported()) { status("Keine Kamera verfügbar – Nummer unten eingeben."); return; }
  try {
    await startScanner(video, (code) => produktLaden(code), status);
  } catch {
    status("Kein Kamerazugriff – Nummer unten eingeben.");
  }
}

async function produktLaden(barcode) {
  stopScanner();
  const s = S.scan;
  s.barcode = String(barcode).trim();
  const bekannt = S.produkte[s.barcode];
  if (bekannt) {
    Object.assign(s, { schritt: "gefunden", quelle: "lokal", name: bekannt.name, marke: bekannt.marke || "",
      kh100Str: bekannt.kh100 != null ? r1(bekannt.kh100) : "", kh100Orig: bekannt.kh100, manuell: bekannt.kh100 == null,
      portionStr: bekannt.portionG ? r1(bekannt.portionG) : "" });
    zeichnen();
    return;
  }
  s.schritt = "laedt";
  zeichnen();
  try {
    const p = await produktPerBarcode(s.barcode);
    if (S.screen !== "scan" || S.scan !== s) return;
    if (p) {
      Object.assign(s, { schritt: "gefunden", quelle: "off", name: p.name, marke: p.marke,
        kh100Str: p.kh100 != null ? r1(p.kh100) : "", kh100Orig: p.kh100, manuell: p.kh100 == null,
        portionStr: p.portionG ? r1(p.portionG) : "" });
    } else {
      Object.assign(s, { schritt: "gefunden", quelle: null, name: "", marke: "", kh100Str: "", manuell: true });
    }
  } catch {
    if (S.scan !== s) return;
    Object.assign(s, { schritt: "gefunden", quelle: null, offline: true, name: "", marke: "", kh100Str: "", manuell: true });
    melden(navigator.onLine ? "Open Food Facts nicht erreichbar – bitte Werte von der Packung eingeben." : "Ohne Netz keine Datenbank – bitte Werte von der Packung eingeben.", true);
  }
  zeichnen();
}

function scanProduktMerken() {
  const s = S.scan;
  if (!s.barcode) return;
  S.produkte[s.barcode] = { barcode: s.barcode, name: s.name.trim(), marke: s.marke, kh100: zahl(s.kh100Str), portionG: zahl(s.portionStr) || null };
  sichern("produkte");
}

// — Foto ———————————————————————————————————————————————————————————————

function foto() {
  const f = S.foto;
  if (f.schritt === "aufnahme" || f.schritt === "fehler") {
    return `
<div class="stapel" style="gap:16px">
  <div class="foto-feld">
    <span style="position:absolute;top:40%;left:0;right:0;text-align:center;font-size:17px;color:var(--color-neutral-300);padding:0 20px">Teller von oben fotografieren</span>
    <label class="knopf-roh ausloeser" aria-label="Foto aufnehmen" tabindex="0">
      <input type="file" accept="image/*" capture="environment" data-in="fotoDatei" hidden>
    </label>
    <span style="font-size:14px;color:var(--color-neutral-400)">Tippen öffnet die Kamera</span>
  </div>
  ${f.fehler ? `<div style="font-size:16px;color:var(--color-accent-800);background:var(--color-accent-100);padding:12px 16px;border-radius:20px">${esc(f.fehler)}${!keyAktuell() ? ` <button class="btn btn-ghost btn-text" data-act="gehe" data-wert="profil" style="font-size:16px;min-height:36px;padding:0 4px">Zum Profil</button>` : ""}</div>` : ""}
  <div class="karte stapel" style="gap:8px;padding:16px 18px">
    <span style="font-size:17px;font-weight:600">Teller gewogen? <span style="font-weight:400" class="leise">(optional)</span></span>
    <label class="feld-zeile">Gesamtgewicht<input class="input" data-in="fotoGewicht" inputmode="decimal" value="${esc(f.gewicht)}" placeholder="–" style="width:100px;min-height:52px;font-size:20px;text-align:center"> g</label>
    ${zahl(f.gewicht) > 0 ? taraChips("foto") : ""}
    <span class="klein leise">Ohne Teller gewogen. Die KI verteilt dann dieses Gewicht auf die Bestandteile – genauer als nur schätzen.</span>
  </div>
  <p style="margin:0" class="klein leise">Das Foto wird zur Analyse an ${esc(S.einst.anbieter)} gesendet. Alles andere bleibt auf dem Gerät.</p>
</div>`;
  }
  if (f.schritt === "laedt") return `<div class="laden"><span class="spinner"></span>KI erkennt die Bestandteile …</div>`;

  const komps = f.komps.map((k) => ({ ...k, kh: (k.gramm * k.kh100) / 100 }));
  const { summe, min, max } = fotoSpanne(komps);
  return `
<div class="stapel" style="gap:16px">
  <div class="stapel" style="gap:6px;padding:18px;border-radius:28px;background:var(--color-accent-100)">
    <span class="tag tag-accent" style="align-self:flex-start;font-size:13px;font-weight:700;background:var(--color-accent-200)">KI · geschätzt</span>
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px"><span style="font-size:18px;font-weight:600;color:var(--color-accent-900)">${esc(f.gericht)}</span><span style="font-family:var(--font-heading);font-size:40px;color:var(--color-accent-900);flex:none">≈ ${r0(summe)} g KH</span></div>
    <span style="font-size:15px;color:var(--color-accent-800)">Spanne ${r0(min)}–${r0(max)} g · bitte prüfen</span>
    ${zahl(f.gewicht) > 0 ? `<span style="font-size:15px;color:var(--color-accent-800)">Auf ${esc(f.gewicht)} g Gesamtgewicht verteilt</span>` : ""}
  </div>
  ${komps.map((k) => `
  <div class="stapel" style="gap:8px;padding:14px 12px 14px 18px;border-radius:24px;background:var(--color-neutral-100)">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="flex:1;font-size:18px;font-weight:700;min-width:0">${esc(k.name)}</span>
      <span class="tag ${k.konfidenz >= 0.7 ? "tag-accent-2" : "tag-accent"}" style="font-size:13px;font-weight:600;flex:none">${Math.round(k.konfidenz * 100)} % ${k.konfidenz >= 0.7 ? "sicher" : "unsicher"}</span>
      <button class="knopf-roh rund rund-weg" data-act="kompLoeschen" data-id="${k.id}" aria-label="${esc(k.name)} entfernen">${SVG(I.muell, 20)}</button>
    </div>
    <div style="display:flex;gap:10px">
      <label style="flex:1;display:flex;align-items:center;gap:6px;font-size:16px;color:var(--color-neutral-800)">Menge<input class="input" data-in="kompG" data-id="${k.id}" inputmode="decimal" value="${esc(k.gStr)}" style="width:76px;min-height:48px;font-size:18px;text-align:center;padding:0 8px"> g</label>
      <label style="flex:1;display:flex;align-items:center;gap:6px;font-size:16px;font-weight:700">KH<input class="input" data-in="kompKh" data-id="${k.id}" inputmode="decimal" value="${esc(k.khStr)}" style="width:76px;min-height:48px;font-size:18px;font-weight:700;text-align:center;padding:0 8px"> g</label>
    </div>
    ${kompPruefung(k)}
  </div>`).join("")}
  ${mahlzeitWahl()}
  <button class="btn btn-primary" data-act="fotoHinzu" style="min-height:58px;font-size:20px" ${komps.length ? "" : "disabled"}>${r0(summe)} g KH hinzufügen</button>
  <button class="btn btn-ghost btn-text" data-act="gehe" data-wert="foto" style="font-weight:600;font-size:16px;min-height:44px">Neues Foto</button>
</div>`;
}

/**
 * Plausibilität und Abgleich eines Bestandteils mit bekannten Werten. Weicht die KI um mehr
 * als 20 % von einem Favoriten oder Listenwert ab, ist meist die KI daneben (anderes Produkt
 * vermutet) — der bekannte Wert lässt sich mit einem Tipp übernehmen, entschieden wird aber
 * von Hand: die KI könnte auch etwas Ähnliches, aber anderes richtig erkannt haben.
 */
function kompPruefung(k) {
  const w = plausibilitaet({ kh100: k.kh100, gramm: k.gramm });
  const b = bekannt(k.name);
  const weicht = b && !k.uebernommen && abweichung(k.kh100, b.kh100) > KI_ABWEICHUNG_GRENZE;
  if (weicht) w.push(`KI: ${r1(k.kh100)} g / 100 g, ${b.quelle} „${b.name}“: ${r1(b.kh100)} g / 100 g – Abweichung ${Math.round(abweichung(k.kh100, b.kh100) * 100)} %.`);
  return `${warnHtml(w)}${weicht ? `<button class="btn btn-secondary btn-text" data-act="kompBekannt" data-id="${k.id}" style="align-self:flex-start;min-height:44px;font-size:15px;padding:0 14px">${esc(b.quelle)}-Wert übernehmen</button>` : ""}`;
}

async function fotoAuswerten(datei) {
  const f = S.foto;
  if (!keyAktuell()) {
    f.schritt = "fehler";
    f.fehler = `Für die Fotoanalyse fehlt der API-Key für ${S.einst.anbieter}.`;
    zeichnen();
    return;
  }
  f.schritt = "laedt";
  f.fehler = "";
  zeichnen();
  try {
    const gewicht = zahl(f.gewicht);
    // Nur bestätigte Listenwerte gehen als Vorgabe an die KI — ungeprüfte Richtwerte sollen
    // die Schätzung nicht in eine Richtung schieben, die die Eltern nie gesehen haben.
    const bekannte = [...S.favs, ...S.grund.filter((g) => g.verifiziert && grundHatWert(g)).map((g) => ({ name: grundName(g), kh100: Number(g.kh100) }))];
    const ergebnis = await fotoAnalysieren(datei, { anbieter: S.einst.anbieter, key: keyAktuell(), gewicht, favs: bekannte });
    if (S.foto !== f) return;
    const komps = aufGewichtVerteilen(ergebnis.komponenten, gewicht).map((k, i) => ({
      ...k, id: i + 1, gStr: r0(k.gramm), khStr: r0((k.gramm * k.kh100) / 100),
    }));
    Object.assign(f, { schritt: "ergebnis", gericht: ergebnis.gericht, komps });
  } catch (e) {
    if (S.foto !== f) return;
    Object.assign(f, { schritt: "fehler", fehler: e.message || "Analyse fehlgeschlagen." });
  }
  zeichnen();
}

// — Profil ——————————————————————————————————————————————————————————————

const ANLEITUNG = {
  Gemini: ["aistudio.google.com öffnen und mit Google-Konto anmelden", "„Get API key“ → „API-Key erstellen“ tippen", "Key kopieren", "Hier oben einfügen – fertig"],
  OpenAI: ["platform.openai.com öffnen und anmelden", "Menü „API keys“ → „Create new secret key“", "Key kopieren (wird nur einmal angezeigt)", "Hier oben einfügen – fertig"],
};

function profil() {
  const p = S.profil;
  const alt = p.gewichtDatum && (Date.now() - new Date(p.gewichtDatum).getTime()) > 90 * 864e5;
  return `
<div class="stapel" style="gap:16px;padding-top:8px">
  <h1 style="margin:0;font-size:38px">Profil</h1>
  <div class="karte stapel" style="gap:12px">
    <div style="display:flex;align-items:center;gap:14px">
      <span style="width:56px;height:56px;flex:none;border-radius:50%;background:var(--color-accent-2-300);display:grid;place-items:center;font-family:var(--font-heading);font-size:26px;color:var(--color-accent-2-900)">${esc((p.name || "S").charAt(0).toUpperCase())}</span>
      <input class="input" data-in="name" value="${esc(p.name)}" aria-label="Name" style="font-family:var(--font-heading);font-size:26px;min-height:52px;background:transparent;border-color:transparent;padding-left:6px">
    </div>
    <label class="feld-zeile">Gewicht<input class="input" data-in="gewicht" inputmode="decimal" value="${esc(p.gewicht)}" placeholder="–" style="width:90px;min-height:50px;font-size:19px;text-align:center"> kg</label>
    <span style="font-size:15px;${alt ? "color:var(--color-accent-800);font-weight:600" : ""}" class="${alt ? "" : "leise"}">Zuletzt geändert: ${datumText(p.gewichtDatum)} · ${alt ? "bitte aktualisieren" : "alle 3 Monate aktualisieren"}</span>
  </div>
  <div class="stapel" style="gap:6px;padding:18px;border-radius:28px;background:var(--color-accent-2-100);color:var(--color-accent-2-900)">
    <span style="font-size:18px;font-weight:700">Einheit: Gramm KH</span>
    <span style="font-size:15px">Fest eingestellt, wie in der Pumpe. Ganze Gramm. Die App berechnet kein Insulin – das macht die Pumpe.</span>
  </div>
  <div class="karte stapel" style="gap:12px">
    <span style="font-size:18px;font-weight:700">KI-Anbieter</span>
    <div class="pillen seg-klein">
      ${["Gemini", "OpenAI"].map((a) => `<button class="knopf-roh pille" data-act="anbieter" data-wert="${a}" aria-pressed="${a === S.einst.anbieter}" style="min-height:48px;font-size:16px">${a}</button>`).join("")}
    </div>
    <input class="input" type="password" data-in="apiKey" value="${esc(keyAktuell())}" placeholder="API-Key für ${esc(S.einst.anbieter)} einfügen" autocomplete="off" style="min-height:52px;font-size:17px">
    <span class="klein leise">Wird nur auf diesem Gerät gespeichert und nicht mit exportiert.</span>
    <button class="btn btn-ghost btn-text" data-act="anleitung" style="align-self:flex-start;font-size:16px;min-height:44px;padding:0 4px" aria-expanded="${S.anleitung}">Anleitung: API-Key erstellen</button>
    ${S.anleitung ? `<ol style="margin:0;padding-left:22px;font-size:16px;line-height:1.6;display:flex;flex-direction:column;gap:4px">${ANLEITUNG[S.einst.anbieter].map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
  </div>
  <button class="knopf-roh karte stapel" data-act="gehe" data-wert="liste" style="gap:4px">
    <span style="font-size:18px;font-weight:700">Lebensmittel-Liste</span>
    <span style="font-size:15px" class="leise">${S.grund.filter((g) => g.verifiziert).length} von ${S.grund.length} von den Eltern bestätigt · Werte prüfen und ergänzen</span>
  </button>
  <div class="karte stapel" style="gap:10px">
    <span style="font-size:18px;font-weight:700">Behälter (Tara)</span>
    <span style="font-size:15px" class="leise">Leergewicht von Vesperbox, Teller oder Becher. Wird beim Wiegen mit einem Tipp abgezogen.</span>
    ${S.behaelter.map((b) => `
    <div style="display:flex;align-items:center;gap:8px;min-height:48px">
      <span style="flex:1;font-size:17px;font-weight:600">${esc(b.name)}</span><span style="font-size:17px">${r0(b.gramm)} g</span>
      <button class="knopf-roh rund rund-weg" data-act="behaelterLoeschen" data-id="${esc(b.id)}" aria-label="${esc(b.name)} löschen">${SVG(I.x, 20)}</button>
    </div>`).join("")}
    <form data-form="behaelter" style="display:grid;grid-template-columns:1fr 84px auto;gap:8px">
      <input class="input" name="name" placeholder="z. B. Vesperbox" aria-label="Behälter" style="min-height:50px;font-size:17px">
      <input class="input" name="gramm" inputmode="decimal" placeholder="g" aria-label="Leergewicht in Gramm" style="min-height:50px;font-size:17px;text-align:center">
      <button class="btn btn-secondary" type="submit" style="min-height:50px;font-size:16px">Dazu</button>
    </form>
  </div>
  <div class="karte stapel" style="gap:8px">
    <span style="font-size:18px;font-weight:700">Hinweis bei großen Mahlzeiten</span>
    <label class="feld-zeile" style="font-size:17px">Warnen ab<input class="input" data-in="grenze" inputmode="decimal" value="${esc(S.profil.grenze)}" placeholder="aus" style="width:90px;min-height:50px;font-size:19px;text-align:center"> g KH</label>
    <span class="klein leise">Pro Mahlzeit. Leer lassen = aus. Den Wert bitte mit den Eltern festlegen.</span>
  </div>
  <div class="karte stapel" style="gap:10px">
    <span style="font-size:18px;font-weight:700">Daten teilen &amp; sichern</span>
    <span style="font-size:15px" class="leise">Favoriten, geprüfte Listenwerte, Gerichte, Behälter und Profil als Datei – z. B. von den Eltern an die Kita.</span>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn btn-secondary" data-act="export" style="min-height:52px;font-size:17px">Exportieren</button>
      <label class="btn btn-secondary" style="min-height:52px;font-size:17px" tabindex="0">Importieren<input type="file" accept="application/json,.json" data-in="importDatei" hidden></label>
    </div>
  </div>
  <p style="margin:0" class="klein leise">Datenschutz: Nur Fotos gehen zur Analyse an den gewählten KI-Anbieter, Suchbegriffe für die KI-Schätzung ebenso. Barcode und Suchbegriffe gehen an Open Food Facts. Alle anderen Daten bleiben auf diesem Gerät.</p>
</div>`;
}

// — Lebensmittel-Liste ————————————————————————————————————————————————

function liste() {
  const f = S.listeFilter.trim().toLowerCase();
  const sichtbar = S.grund.filter((g) => !f || grundName(g).toLowerCase().includes(f) || (g.kategorie || "").toLowerCase().includes(f));
  const kategorien = [...new Set(sichtbar.map((g) => g.kategorie || "Sonstiges"))];
  const status = (g) => !grundHatWert(g)
    ? '<span class="tag tag-neutral" style="font-size:12px;font-weight:700;background:var(--color-neutral-200)">Wert fehlt</span>'
    : g.verifiziert
      ? `<span class="tag tag-accent-2" style="font-size:12px;font-weight:700;display:inline-flex;gap:4px;align-items:center">${SVG(I.haken, 12)}bestätigt</span>`
      : `<span class="tag tag-accent" style="font-size:12px;font-weight:700;display:inline-flex;gap:4px;align-items:center">${SVG(I.warn, 12)}Richtwert</span>`;
  return `
<div class="stapel" style="gap:16px">
  <p style="margin:0;font-size:15px;line-height:1.5" class="leise">Startwerte sind <b>allgemeine Richtwerte</b>, nicht Semas Werte. Bitte mit den Werten der Eltern abgleichen und bestätigen. Bei Abweichung gilt immer der Elternwert.</p>
  <input class="input" data-in="listeFilter" value="${esc(S.listeFilter)}" placeholder="Filtern, z. B. Obst" aria-label="Liste filtern" style="min-height:52px;font-size:18px">
  ${kategorien.map((k) => `
  <div class="stapel" style="gap:4px;padding:14px 16px;border-radius:28px;background:var(--color-neutral-100)">
    <h4 style="margin:0 0 4px;font-size:20px">${esc(k)}</h4>
    ${sichtbar.filter((g) => (g.kategorie || "Sonstiges") === k).map((g) => `
    <button class="knopf-roh zeile-trenner" data-act="grundBearbeiten" data-id="${esc(g.id)}" style="padding:6px 0">
      <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:17px;font-weight:600">${esc(grundName(g))}</span><span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${status(g)}${g.portionG ? `<span class="klein leise">Portion ${r0(g.portionG)} g</span>` : ""}</span></span>
      <span style="font-size:17px;font-weight:700;flex:none">${grundHatWert(g) ? `${r1(g.kh100)} g` : "–"}</span>
    </button>`).join("")}
  </div>`).join("") || `<div class="karte" style="font-size:16px">Nichts gefunden.</div>`}
  <button class="btn btn-secondary" data-act="grundNeu" style="min-height:52px;font-size:17px">+ Lebensmittel hinzufügen</button>
  <p style="margin:0" class="klein leise">Werte in g KH je 100 g. Neue Startwerte aus App-Updates werden ergänzt, eigene Änderungen nie überschrieben.</p>
</div>`;
}

function grundFormular() {
  const e = S.grundEdit;
  const warnungen = plausibilitaet({ kh100: e.kh === "" ? null : zahl(e.kh) });
  return `
<div class="schleier" data-act="schliessen">
  <form class="blatt" data-form="grund" role="dialog" aria-modal="true" aria-label="Lebensmittel">
    <span class="griff"></span>
    <h3 style="margin:0;font-size:28px">${e.id ? "Lebensmittel bearbeiten" : "Neues Lebensmittel"}</h3>
    <label class="stapel" style="gap:4px;font-size:15px;font-weight:600">Name<input class="input" data-in="ge.name" value="${esc(e.name)}" required style="min-height:52px;font-size:18px"></label>
    <div class="stapel" style="gap:6px">
      <span style="font-size:15px;font-weight:600">Zustand beim Wiegen</span>
      <div class="pillen" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        ${[["", "–"], ["roh", "roh"], ["gekocht", "gekocht"]].map(([w, l]) => `<button type="button" class="knopf-roh pille" data-act="geZustand" data-wert="${w}" aria-pressed="${e.zustand === w}">${l}</button>`).join("")}
      </div>
      ${e.kategorie === "Beilage" && !e.zustand ? `<span class="klein" style="color:var(--color-accent-800);font-weight:600">Bei Beilagen bitte roh oder gekocht angeben.</span>` : ""}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label class="stapel" style="gap:4px;font-size:15px;font-weight:600">KH je 100 g<input class="input" data-in="ge.kh" inputmode="decimal" value="${esc(e.kh)}" placeholder="–" style="min-height:52px;font-size:20px;text-align:center"></label>
      <label class="stapel" style="gap:4px;font-size:15px;font-weight:600">Übliche Portion (g)<input class="input" data-in="ge.portionG" inputmode="decimal" value="${esc(e.portionG)}" placeholder="optional" style="min-height:52px;font-size:18px;text-align:center"></label>
    </div>
    ${warnHtml(warnungen)}
    <label style="display:flex;gap:12px;align-items:center;font-size:17px;font-weight:600;min-height:48px">
      <input type="checkbox" data-in="ge.verifiziert" ${e.verifiziert ? "checked" : ""} style="width:26px;height:26px;flex:none">
      Von den Eltern geprüft
    </label>
    ${e.hinweis ? `<span class="klein leise">${esc(e.hinweis)}</span>` : ""}
    <button class="btn btn-primary" type="submit" style="min-height:56px;font-size:19px">Speichern</button>
    ${e.id ? `<button type="button" class="btn btn-ghost btn-text" data-act="grundLoeschen" data-id="${esc(e.id)}" style="font-size:16px;min-height:44px">Aus der Liste löschen</button>` : ""}
  </form>
</div>`;
}

// — Eigenes Gericht ————————————————————————————————————————————————————

const neueZutat = () => ({ id: neueId(), name: "", gStr: "", kh100Str: "", quelle: "" });

function rezept() {
  const r = S.rezept;
  const { khGesamt, rohG, kh100 } = rezeptRechnen(r.zutaten, r.endStr);
  const portion = zahl(r.portionStr);
  const bereit = r.name.trim() && kh100 != null && portion > 0 && r.zutaten.some((z) => zahl(z.gStr) > 0);
  const namen = [...new Set([...S.favs.map((f) => f.name), ...S.grund.filter(grundHatWert).map(grundName), ...Object.values(S.produkte).map((p) => p.name)])];
  const warnungen = [
    ...plausibilitaet({ kh100 }),
    ...(kh100 != null && zahl(r.endStr) < rohG * 0.5 ? ["Endgewicht ist weniger als die Hälfte der Zutaten – gewogen ohne Topf?"] : []),
  ];
  return `
<div class="stapel" style="gap:16px">
  <label class="stapel" style="gap:4px;font-size:15px;font-weight:600">Name des Gerichts<input class="input" data-in="rz.name" value="${esc(r.name)}" placeholder="z. B. Milchreis" style="min-height:52px;font-size:19px"></label>
  <datalist id="zutatenliste">${namen.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
  <div class="stapel" style="gap:8px">
    <span style="font-size:17px;font-weight:700">Zutaten</span>
    ${r.zutaten.map((z) => `
    <div class="stapel" style="gap:6px;padding:12px 10px 12px 14px;border-radius:22px;background:var(--color-neutral-100)">
      <div style="display:flex;gap:6px;align-items:center">
        <input class="input" data-in="rz.zName" data-id="${z.id}" list="zutatenliste" value="${esc(z.name)}" placeholder="Zutat" aria-label="Zutat" style="flex:1;min-width:0;min-height:48px;font-size:17px">
        <button type="button" class="knopf-roh rund rund-weg" data-act="zutatWeg" data-id="${z.id}" aria-label="Zutat entfernen">${SVG(I.muell, 20)}</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-size:15px">Menge<input class="input" data-in="rz.zG" data-id="${z.id}" inputmode="decimal" value="${esc(z.gStr)}" style="width:76px;min-height:46px;font-size:17px;text-align:center;padding:0 6px"> g</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:15px">KH<input class="input" data-in="rz.zKh" data-id="${z.id}" inputmode="decimal" value="${esc(z.kh100Str)}" style="width:70px;min-height:46px;font-size:17px;text-align:center;padding:0 6px"> / 100 g</label>
      </div>
      ${z.quelle ? `<span class="klein leise">Wert aus: ${esc(z.quelle)}</span>` : ""}
      ${warnHtml(plausibilitaet({ kh100: z.kh100Str === "" ? null : zahl(z.kh100Str) }))}
    </div>`).join("")}
    <button type="button" class="btn btn-ghost btn-text" data-act="zutatDazu" style="align-self:flex-start;font-size:16px;min-height:44px;padding:0 4px">+ Zutat</button>
  </div>
  <div class="karte stapel" style="gap:10px">
    <label class="feld-zeile" style="font-size:17px">Fertiges Gericht wiegt<input class="input" data-in="rz.end" inputmode="decimal" value="${esc(r.endStr)}" placeholder="–" style="width:96px;min-height:50px;font-size:19px;text-align:center"> g</label>
    ${zahl(r.endStr) > 0 ? taraChips("rezeptEnd") : ""}
    <span class="klein leise">Nach dem Kochen wiegen, ohne Topf. Zutaten zusammen: ${r0(rohG)} g roh.</span>
    <label class="feld-zeile" style="font-size:17px">Übliche Portion<input class="input" data-in="rz.portion" inputmode="decimal" value="${esc(r.portionStr)}" placeholder="–" style="width:96px;min-height:50px;font-size:19px;text-align:center"> g</label>
  </div>
  <div class="stapel" style="gap:4px;padding:18px;border-radius:28px;background:var(--color-accent-2-100);color:var(--color-accent-2-900)">
    <span style="font-size:15px;font-weight:600">${r0(khGesamt)} g KH im ganzen Topf</span>
    <span style="font-family:var(--font-heading);font-size:32px">${kh100 == null ? "Endgewicht fehlt" : `${r1(kh100)} g KH / 100 g`}</span>
    ${kh100 != null && portion > 0 ? `<span style="font-size:17px;font-weight:700">1 Portion (${r0(portion)} g) = ${r0((kh100 * portion) / 100)} g KH</span>` : ""}
  </div>
  ${warnHtml(warnungen)}
  <button class="btn btn-primary" data-act="rezeptSpeichern" style="min-height:58px;font-size:20px" ${bereit ? "" : "disabled"}>Als Favorit speichern</button>
  ${r.favId ? `<button class="btn btn-ghost btn-text" data-act="favLoeschen" data-id="${esc(r.favId)}" style="font-size:16px;min-height:44px">Gericht löschen</button>` : ""}
</div>`;
}

// — Teilweise gegessen ———————————————————————————————————————————————————

function teilZiele() {
  const t = S.teil;
  if (t.art === "eintrag") return S.eintraege.filter((e) => e.id === t.id);
  return eintraegeVon(heute()).filter((e) => e.meal === t.meal);
}

function teilBlatt() {
  const t = S.teil;
  const ziele = teilZiele();
  if (!ziele.length) return "";
  const eingegeben = ziele.reduce((a, e) => a + (e.khUrspruenglich ?? e.kh), 0);
  // Rest wiegen geht nur, wenn das Ausgangsgewicht aller Einträge bekannt ist — sonst wäre der
  // Anteil eine Vermutung.
  const grammGesamt = ziele.every((e) => e.gramm > 0) ? ziele.reduce((a, e) => a + e.gramm, 0) : null;
  const restAnteil = grammGesamt != null && t.restStr !== "" ? anteilAusRest(grammGesamt, t.restStr) : null;
  const titel = t.art === "eintrag" ? ziele[0].name : `${t.meal} (ganze Mahlzeit)`;
  return `
<div class="schleier" data-act="schliessen">
  <div class="blatt" role="dialog" aria-modal="true" aria-label="Teilweise gegessen">
    <span class="griff"></span>
    <div><h3 style="margin:0;font-size:26px">${esc(titel)}</h3><span style="font-size:16px" class="leise">Eingegeben: ${r0(eingegeben)} g KH${grammGesamt ? ` · ${r0(grammGesamt)} g` : ""}</span></div>
    <span style="font-size:17px;font-weight:600">Wie viel wurde gegessen?</span>
    <div class="pillen" style="grid-template-columns:repeat(5,minmax(0,1fr))">
      ${[0, 0.25, 0.5, 0.75, 1].map((a) => `<button class="knopf-roh pille" data-act="teilAnteil" data-wert="${a}" style="min-height:56px;font-size:17px">${a === 1 ? "alles" : anteilText(a)}</button>`).join("")}
    </div>
    ${grammGesamt != null ? `
    <div class="karte stapel" style="gap:8px">
      <label class="feld-zeile" style="font-size:17px">Rest gewogen<input class="input" data-in="teilRest" inputmode="decimal" value="${esc(t.restStr)}" placeholder="–" style="width:96px;min-height:50px;font-size:19px;text-align:center"> g</label>
      ${zahl(t.restStr) > 0 ? taraChips("rest") : ""}
      ${restAnteil != null ? `<span style="font-size:16px;font-weight:600">Gegessen ${Math.round(restAnteil * 100)} % = ${r0(eingegeben * restAnteil)} g KH (−${r0(eingegeben * (1 - restAnteil))} g)</span>` : ""}
      ${zahl(t.restStr) > grammGesamt ? warnHtml(["Rest ist schwerer als die Portion – mit Behälter gewogen?"]) : ""}
      <button class="btn btn-primary" data-act="teilRestUebernehmen" style="min-height:52px;font-size:18px" ${restAnteil == null ? "disabled" : ""}>Übernehmen</button>
    </div>` : `<span class="klein leise">Rest wiegen geht nur bei Einträgen mit bekanntem Gewicht.</span>`}
    <span class="klein leise">Die App ändert nur die KH-Zahl. Was das für das Insulin bedeutet, entscheidet ihr wie gewohnt.</span>
  </div>
</div>`;
}

// — Blätter und Hinweise ————————————————————————————————————————————————

function favBlatt() {
  const f = S.favs.find((x) => x.id === S.sheet.favId);
  if (!f) return "";
  const m = S.sheet.menge;
  return `
<div class="schleier" data-act="schliessen">
  <div class="blatt" role="dialog" aria-modal="true" aria-label="${esc(f.name)}">
    <span class="griff"></span>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
      <div><h3 style="margin:0;font-size:28px">${esc(f.name)}</h3><span style="font-size:16px" class="leise">${esc(favPortionText(f))} · ${r1(favKhJePortion(f))} g KH</span></div>
      <button class="btn btn-ghost btn-text" data-act="favBearbeiten" data-id="${esc(f.id)}" style="font-size:15px;min-height:40px;padding:0 8px">Bearbeiten</button>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border-radius:28px;background:var(--color-neutral-100)">
      <button class="knopf-roh rund rund-flaeche" data-act="blattMenge" data-wert="-0.5" aria-label="Weniger" style="width:60px;height:60px">${SVG(I.minus, 26)}</button>
      <div class="stapel" style="align-items:center"><span style="font-family:var(--font-heading);font-size:36px;line-height:1.1">${r1(m)} ${esc(f.unit || "Portion")}</span><span style="font-size:17px;font-weight:700">${r0(favKhJePortion(f) * m)} g KH</span></div>
      <button class="knopf-roh rund rund-flaeche" data-act="blattMenge" data-wert="0.5" aria-label="Mehr" style="width:60px;height:60px">${SVG(I.plus, 26)}</button>
    </div>
    <div class="pillen" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      ${MAHLZEITEN.map((x) => `<button class="knopf-roh pille" data-act="mahlzeit" data-wert="${x}" aria-pressed="${x === S.meal}">${x}</button>`).join("")}
    </div>
    <button class="btn btn-primary" data-act="blattHinzu" style="min-height:58px;font-size:20px">Zu ${esc(S.meal)} hinzufügen</button>
  </div>
</div>`;
}

function favFormular() {
  const e = S.favEdit;
  return `
<div class="schleier" data-act="schliessen">
  <form class="blatt" data-form="fav" role="dialog" aria-modal="true" aria-label="Favorit">
    <span class="griff"></span>
    <h3 style="margin:0;font-size:28px">${e.id ? "Favorit bearbeiten" : "Neuer Favorit"}</h3>
    <label class="stapel" style="gap:4px;font-size:15px;font-weight:600">Name<input class="input" data-in="fe.name" value="${esc(e.name)}" placeholder="z. B. Kugel Eis" required style="min-height:52px;font-size:18px"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label class="stapel" style="gap:4px;font-size:15px;font-weight:600">Portion heißt<input class="input" data-in="fe.unit" value="${esc(e.unit)}" placeholder="Stück" style="min-height:52px;font-size:18px"></label>
      <label class="stapel" style="gap:4px;font-size:15px;font-weight:600">1 Portion wiegt (g)<input class="input" data-in="fe.portionG" inputmode="decimal" value="${esc(e.portionG)}" placeholder="${e.modus === "100g" ? "nötig" : "optional"}" style="min-height:52px;font-size:18px;text-align:center"></label>
    </div>
    <div class="stapel" style="gap:8px">
      <span style="font-size:15px;font-weight:600">KH-Angabe von der Packung</span>
      <div class="pillen seg-klein">
        <button type="button" class="knopf-roh pille" data-act="feModus" data-wert="100g" aria-pressed="${e.modus === "100g"}">pro 100 g</button>
        <button type="button" class="knopf-roh pille" data-act="feModus" data-wert="portion" aria-pressed="${e.modus === "portion"}">pro Portion</button>
      </div>
      <label class="feld-zeile">KH<input class="input" data-in="fe.kh" inputmode="decimal" value="${esc(e.kh)}" required style="width:100px;min-height:52px;font-size:20px;text-align:center"> g</label>
    </div>
    <button class="btn btn-primary" type="submit" style="min-height:56px;font-size:19px">Speichern</button>
    ${e.id ? `<button type="button" class="btn btn-ghost btn-text" data-act="favLoeschen" data-id="${esc(e.id)}" style="font-size:16px;min-height:44px">Favorit löschen</button>` : ""}
  </form>
</div>`;
}

function hinweis() {
  return `
<div class="schleier schleier-mitte">
  <div class="stapel" role="alertdialog" aria-modal="true" aria-labelledby="hinweis-titel" style="gap:14px;padding:26px 24px;border-radius:32px;background:var(--color-bg);box-shadow:var(--shadow-lg);max-width:440px">
    <span style="width:56px;height:56px;border-radius:50%;background:var(--color-accent-200);color:var(--color-accent-800);display:grid;place-items:center">${SVG(I.info, 28)}</span>
    <h2 id="hinweis-titel" style="margin:0;font-size:28px">Kurz wichtig</h2>
    <p style="margin:0;font-size:17px;line-height:1.5">KI-Werte sind <b>Schätzungen</b>. Prüfe jedes Ergebnis, bevor du es in die Pumpe eingibst.</p>
    <p style="margin:0;font-size:17px;line-height:1.5">Die App rechnet kein Insulin. Die Entscheidung triffst immer du.</p>
    <p style="margin:0;font-size:15px" class="leise">Fotos gehen zur Analyse an den KI-Anbieter. Alles andere bleibt auf dem Gerät.</p>
    <button class="btn btn-primary" data-act="hinweisOk" style="min-height:56px;font-size:19px;margin-top:4px">Verstanden</button>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Zeichnen
// ---------------------------------------------------------------------------

const UNTERSEITEN = { foto: "Foto", scan: "Scannen", suche: "Eingeben", liste: "Lebensmittel-Liste", rezept: "Eigenes Gericht" };

function zeichnen() {
  // Fokus und Schreibmarke merken: das Neuzeichnen ersetzt das Eingabefeld, und ohne das
  // hier verlöre man nach jedem Buchstaben die Tastatur.
  const aktiv = document.activeElement;
  const fokus = aktiv?.dataset?.in ? { in: aktiv.dataset.in, id: aktiv.dataset.id, start: aktiv.selectionStart, ende: aktiv.selectionEnd } : null;

  const unter = UNTERSEITEN[S.screen];
  document.body.classList.toggle("mit-tabs", !unter);
  const inhalt = { home: startseite, tag: tagesansicht, suche, scan: scannen, foto, profil, liste, rezept }[S.screen]();
  $app.innerHTML = `
${unter ? `<div class="sema-kopf"><button class="btn btn-secondary" data-act="gehe" data-wert="home" aria-label="Zurück" style="width:48px;height:48px;padding:0;flex:none">${SVG(I.zurueck, 24)}</button><h2>${unter}</h2></div>` : ""}
<main class="sema-inhalt${unter ? "" : " ohne-kopf"}">${inhalt}</main>
${unter ? "" : `<nav class="tabs" aria-label="Hauptmenü">${[["home", "Start"], ["tag", "Heute"], ["profil", "Profil"]].map(([k, l]) =>
    `<button class="knopf-roh tab" data-act="gehe" data-wert="${k}" ${S.screen === k ? 'aria-current="page"' : ""}><span class="tab-ikone">${SVG(I[k], 24)}</span>${l}</button>`).join("")}</nav>`}
${S.sheet ? favBlatt() : ""}
${S.favEdit ? favFormular() : ""}
${S.grundEdit ? grundFormular() : ""}
${S.teil ? teilBlatt() : ""}
${!S.einst.hinweisGesehen ? hinweis() : ""}`;

  if (fokus) {
    const sel = `[data-in="${fokus.in}"]${fokus.id ? `[data-id="${fokus.id}"]` : ""}`;
    const el = $app.querySelector(sel);
    if (el) {
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(fokus.start, fokus.ende); } catch { /* type=password/number kennen das nicht immer */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------

/**
 * Kopie vom Vortag: übernommen wird, was AUFGETISCHT war (die ursprüngliche Eingabe), nicht
 * der gegessene Rest — heute ist wieder eine volle Portion auf dem Teller. Wird heute wieder
 * nicht aufgegessen, gilt das neu.
 */
const vomVortag = (e) => ({ name: e.name, amount: e.amount, kh: e.khUrspruenglich ?? e.kh, gramm: e.gramm ?? null, meal: e.meal, src: e.src });

function teilAnwenden(anteil) {
  const ids = new Set(teilZiele().map((e) => e.id));
  const vorher = S.eintraege.filter((e) => ids.has(e.id)).reduce((a, e) => a + (e.khUrspruenglich ?? e.kh), 0);
  S.eintraege = S.eintraege.map((e) => (ids.has(e.id) ? teilVerzehr(e, anteil) : e));
  const nachher = summeKh(S.eintraege.filter((e) => ids.has(e.id)));
  sichern("eintraege");
  S.teil = null;
  melden(anteil >= 1 ? "Wieder ganz gegessen" : `Gegessen ${r0(nachher)} statt ${r0(vorher)} g KH (−${r0(vorher - nachher)} g)`);
  zeichnen();
}

const AKTIONEN = {
  gehe: (el) => gehe(el.dataset.wert),
  mahlzeit: (el) => { S.meal = el.dataset.wert; zeichnen(); },
  hinweisOk: () => { S.einst.hinweisGesehen = true; sichern("einst"); zeichnen(); },
  schliessen: (el, ev) => { if (ev.target === el) { S.sheet = null; S.favEdit = null; S.grundEdit = null; S.teil = null; zeichnen(); } },

  favSchnell: (el) => {
    const f = S.favs.find((x) => x.id === el.dataset.id);
    if (!f) return;
    const kh = favKhJePortion(f);
    eintragen([{ name: f.name, amount: favPortionText(f), kh, gramm: f.portionG || null, meal: S.meal, src: "fav" }], `${f.name} · ${r0(kh)} g KH → ${S.meal}`);
    zeichnen();
  },
  favOeffnen: (el) => { S.sheet = { favId: el.dataset.id, menge: 1 }; zeichnen(); },
  blattMenge: (el) => { S.sheet.menge = Math.max(0.5, S.sheet.menge + Number(el.dataset.wert)); zeichnen(); },
  blattHinzu: () => {
    const f = S.favs.find((x) => x.id === S.sheet.favId);
    const m = S.sheet.menge, kh = favKhJePortion(f) * m;
    eintragen([{ name: f.name, amount: favPortionText(f, m), kh, gramm: f.portionG ? f.portionG * m : null, meal: S.meal, src: "fav" }], `${f.name} · ${r0(kh)} g KH → ${S.meal}`);
    S.sheet = null;
    zeichnen();
  },
  favNeu: () => { S.favEdit = { id: null, name: "", unit: "Portion", portionG: "", modus: "100g", kh: "" }; zeichnen(); },
  favBearbeiten: (el) => {
    const f = S.favs.find((x) => x.id === el.dataset.id);
    if (f.rezept) {
      // Ein Gericht wird über seine Zutaten bearbeitet, nicht über den errechneten Wert — sonst
      // stünde nach dem nächsten Ändern einer Zutat wieder die alte Rechnung da.
      S.rezept = { favId: f.id, name: f.name, zutaten: f.rezept.zutaten.map((z) => ({ ...z, id: neueId() })), endStr: r1(f.rezept.endG), portionStr: f.portionG ? r1(f.portionG) : "" };
      gehe("rezept");
      return;
    }
    const modus = f.kh100 != null && f.kh100 !== "" ? "100g" : "portion";
    S.sheet = null;
    S.favEdit = { id: f.id, name: f.name, unit: f.unit || "", portionG: f.portionG ? r1(f.portionG) : "", modus, kh: r1(modus === "100g" ? f.kh100 : f.khPortion) };
    zeichnen();
  },
  feModus: (el) => { S.favEdit.modus = el.dataset.wert; zeichnen(); },
  favLoeschen: (el) => {
    const f = S.favs.find((x) => x.id === el.dataset.id);
    if (!f || !confirm(`„${f.name}“ wirklich löschen?`)) return;
    S.favs = S.favs.filter((x) => x.id !== f.id);
    S.favEdit = null;
    sichern("favs");
    melden(`${f.name} gelöscht`);
    if (S.screen === "rezept") gehe("home"); else zeichnen();
  },

  eintragLoeschen: (el) => { S.eintraege = S.eintraege.filter((e) => e.id !== el.dataset.id); sichern("eintraege"); zeichnen(); },
  uebernehmen: (el) => {
    const e = S.eintraege.find((x) => x.id === el.dataset.id);
    if (!e) return;
    S.kopiert.add(e.id);
    const kopie = vomVortag(e);
    eintragen([kopie], `${e.name} · ${r0(kopie.kh)} g KH → ${e.meal}`);
    zeichnen();
  },
  alleUebernehmen: (el) => {
    const gestern = tagVerschieben(heute(), -1);
    const items = S.eintraege.filter((e) => e.date === gestern && e.meal === el.dataset.wert && !S.kopiert.has(e.id));
    if (!items.length) return;
    items.forEach((e) => S.kopiert.add(e.id));
    eintragen(items.map(vomVortag), `${el.dataset.wert} von gestern übernommen`);
    zeichnen();
  },

  // — Teilweise gegessen
  teilEintrag: (el) => { S.teil = { art: "eintrag", id: el.dataset.id, restStr: "" }; S.taraAuf.rest = null; zeichnen(); },
  teilMahlzeit: (el) => { S.teil = { art: "mahlzeit", meal: el.dataset.wert, restStr: "" }; S.taraAuf.rest = null; zeichnen(); },
  teilAnteil: (el) => teilAnwenden(Number(el.dataset.wert)),
  teilRestUebernehmen: () => {
    const ziele = teilZiele();
    const grammGesamt = ziele.reduce((a, e) => a + (e.gramm || 0), 0);
    const a = anteilAusRest(grammGesamt, S.teil.restStr);
    if (a != null) teilAnwenden(a);
  },

  // — Teilen
  teilen: async (el) => {
    const meal = el.dataset.wert;
    const eintraege = eintraegeVon(heute()).filter((e) => !meal || e.meal === meal);
    const titel = `${S.profil.name || "Sema"} · ${new Date().toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}${meal ? ` · ${meal}` : ""}`;
    const text = teilenText({ titel, eintraege });
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      melden("Text kopiert – in WhatsApp einfügen");
    } catch (e) {
      // Abbrechen im Teilen-Dialog ist kein Fehler.
      if (e?.name === "AbortError") return;
      try { await navigator.clipboard.writeText(text); melden("Text kopiert – in WhatsApp einfügen"); }
      catch { melden("Teilen nicht möglich.", true); }
    }
  },

  // — Behälter
  tara: (el) => {
    const b = S.behaelter.find((x) => x.id === el.dataset.id);
    const ziel = el.dataset.ziel;
    if (!b || S.taraAuf[ziel]) return;
    if (ziel === "foto") S.foto.gewicht = r0(taraAbziehen(S.foto.gewicht, b.gramm));
    else if (ziel === "rest") S.teil.restStr = r0(taraAbziehen(S.teil.restStr, b.gramm));
    else if (ziel === "rezeptEnd") S.rezept.endStr = r0(taraAbziehen(S.rezept.endStr, b.gramm));
    else if (ziel === "suche") {
      const { name, gramm } = sucheZerlegen(S.q);
      if (gramm == null) return;
      S.q = `${name} ${r0(taraAbziehen(gramm, b.gramm))} g`;
    }
    S.taraAuf[ziel] = b.id;
    zeichnen();
  },
  behaelterLoeschen: (el) => {
    S.behaelter = S.behaelter.filter((b) => b.id !== el.dataset.id);
    sichern("behaelter");
    zeichnen();
  },

  // — Lebensmittel-Liste
  grundBearbeiten: (el) => {
    const g = S.grund.find((x) => x.id === el.dataset.id);
    if (!g) return;
    S.grundEdit = { id: g.id, name: g.name, zustand: g.zustand || "", kategorie: g.kategorie, kh: grundHatWert(g) ? r1(g.kh100) : "", portionG: g.portionG ? r1(g.portionG) : "", verifiziert: !!g.verifiziert, hinweis: g.hinweis || "" };
    zeichnen();
  },
  grundNeu: () => { S.grundEdit = { id: null, name: "", zustand: "", kategorie: "Eigene", kh: "", portionG: "", verifiziert: false, hinweis: "" }; zeichnen(); },
  geZustand: (el) => { S.grundEdit.zustand = el.dataset.wert; zeichnen(); },
  grundBestaetigen: (el) => {
    const g = S.grund.find((x) => x.id === el.dataset.id);
    if (!g || !confirm(`${grundName(g)}: ${r1(g.kh100)} g KH je 100 g – stimmt der Wert mit dem der Eltern überein?`)) return;
    S.grund = S.grund.map((x) => (x.id === g.id ? { ...x, verifiziert: true, quelle: "eltern", updatedAt: Date.now() } : x));
    sichern("grund");
    melden(`${grundName(g)} bestätigt`);
    zeichnen();
  },
  grundLoeschen: (el) => {
    const g = S.grund.find((x) => x.id === el.dataset.id);
    if (!g || !confirm(`„${grundName(g)}“ aus der Liste löschen?`)) return;
    S.grund = S.grund.filter((x) => x.id !== g.id);
    S.grundEdit = null;
    sichern("grund");
    zeichnen();
  },

  // — Eigenes Gericht
  rezeptNeu: () => { S.rezept = { favId: null, name: "", zutaten: [neueZutat(), neueZutat()], endStr: "", portionStr: "" }; gehe("rezept"); },
  zutatDazu: () => { S.rezept.zutaten.push(neueZutat()); zeichnen(); },
  zutatWeg: (el) => { S.rezept.zutaten = S.rezept.zutaten.filter((z) => z.id !== el.dataset.id); zeichnen(); },
  rezeptSpeichern: () => {
    const r = S.rezept;
    const { kh100 } = rezeptRechnen(r.zutaten, r.endStr);
    const portionG = zahl(r.portionStr);
    if (!r.name.trim() || kh100 == null || !(portionG > 0)) return;
    const zutaten = r.zutaten.filter((z) => z.name.trim() || zahl(z.gStr) > 0).map(({ id, ...z }) => z);
    const fav = {
      id: r.favId || neueId(), name: r.name.trim(), unit: "Portion", portionG,
      kh100: Math.round(kh100 * 10) / 10, khPortion: null,
      rezept: { zutaten, endG: zahl(r.endStr) }, updatedAt: Date.now(),
    };
    S.favs = r.favId ? S.favs.map((f) => (f.id === r.favId ? fav : f)) : [...S.favs, fav];
    sichern("favs");
    melden(`${fav.name} gespeichert · ${r1(fav.kh100)} g KH / 100 g`);
    gehe("home");
  },

  // — Foto: bekannten Wert statt KI-Schätzung
  kompBekannt: (el) => {
    const k = S.foto.komps.find((x) => x.id === Number(el.dataset.id));
    const b = k && bekannt(k.name);
    if (!b) return;
    Object.assign(k, { kh100: b.kh100, khStr: r0((k.gramm * b.kh100) / 100), uebernommen: true });
    zeichnen();
  },

  vorschlag: (el) => { S.q = `${el.dataset.wert} `; zeichnen(); document.querySelector('[data-in="q"]')?.focus(); },
  trefferHinzu: (el) => {
    const t = suchTreffer().treffer[Number(el.dataset.i)];
    if (!t || t.kh == null) return;
    eintragen([{ name: t.name, amount: t.amount, kh: t.kh, gramm: t.gramm ?? null, meal: S.meal, src: t.art }], `${t.name} · ${r0(t.kh)} g KH → ${S.meal}`);
    gehe("home");
  },
  trefferFav: (el) => {
    const t = suchTreffer().treffer[Number(el.dataset.i)];
    if (!t) return;
    S.favEdit = { id: null, name: t.name, unit: "Portion", portionG: t.gramm ? r1(t.gramm) : "", modus: "100g", kh: r1(t.kh100) };
    zeichnen();
  },
  kiSchaetzen: async () => {
    const { name, key } = suchTreffer();
    if (!keyAktuell()) { S.kiSuche = { fuer: key, laeuft: false, ergebnis: null, fehler: `Kein API-Key für ${S.einst.anbieter} hinterlegt (Profil).` }; zeichnen(); return; }
    S.kiSuche = { fuer: key, laeuft: true, ergebnis: null, fehler: "" };
    zeichnen();
    try {
      const ergebnis = await khSchaetzen(name, { anbieter: S.einst.anbieter, key: keyAktuell() });
      if (S.kiSuche.fuer === key) S.kiSuche = { fuer: key, laeuft: false, ergebnis, fehler: "" };
    } catch (e) {
      if (S.kiSuche.fuer === key) S.kiSuche = { fuer: key, laeuft: false, ergebnis: null, fehler: e.message };
    }
    if (S.screen === "suche") zeichnen();
  },

  scanManuell: () => { S.scan.manuell = true; zeichnen(); },
  scanMenge: (el) => { S.scan.menge = Math.max(1, S.scan.menge + Number(el.dataset.wert)); zeichnen(); },
  scanHinzu: () => {
    const s = S.scan;
    const kh = s.menge * zahl(s.portionStr) * zahl(s.kh100Str) / 100;
    scanProduktMerken();
    eintragen([{ name: s.name.trim(), amount: `${s.menge} Stück (${r0(s.menge * zahl(s.portionStr))} g)`, kh, gramm: s.menge * zahl(s.portionStr), meal: S.meal, src: "scan" }], `${s.name.trim()} · ${r0(kh)} g KH → ${S.meal}`);
    gehe("home");
  },
  scanFav: () => {
    const s = S.scan;
    scanProduktMerken();
    S.favs.push({ id: neueId(), name: s.name.trim(), unit: "Stück", portionG: zahl(s.portionStr), kh100: zahl(s.kh100Str), khPortion: null, updatedAt: Date.now() });
    s.gespeichert = true;
    sichern("favs");
    melden(`${s.name.trim()} ist jetzt Favorit`);
    zeichnen();
  },

  kompLoeschen: (el) => { S.foto.komps = S.foto.komps.filter((k) => k.id !== Number(el.dataset.id)); zeichnen(); },
  fotoHinzu: () => {
    const f = S.foto;
    const liste = f.komps.map((k) => ({ name: k.name, amount: `${r0(k.gramm)} g`, kh: (k.gramm * k.kh100) / 100, gramm: k.gramm, meal: S.meal, src: "ki" }));
    eintragen(liste, `${f.gericht} · ${r0(summeKh(liste))} g KH → ${S.meal}`);
    gehe("home");
  },

  anbieter: (el) => { S.einst.anbieter = el.dataset.wert; sichern("einst"); zeichnen(); },
  anleitung: () => { S.anleitung = !S.anleitung; zeichnen(); },
  export: () => {
    const daten = exportDaten({ favs: S.favs, profil: S.profil, einstellungen: S.einst, grund: S.grund, behaelter: S.behaelter });
    const blob = new Blob([JSON.stringify(daten, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sema-backup-${heute()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    melden(`${a.download} gespeichert`);
  },
};

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const fn = AKTIONEN[el.dataset.act];
  if (fn) fn(el, ev);
});

// Tastatur für die <label>-Knöpfe (Auslöser, Importieren): Enter/Leertaste öffnet die Datei.
document.addEventListener("keydown", (ev) => {
  if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("label[tabindex]")) {
    ev.preventDefault();
    ev.target.querySelector("input[type=file]")?.click();
  }
});

const EINGABEN = {
  q: (v) => { S.q = v; S.taraAuf.suche = null; zeichnen(); sucheAktualisieren(); },
  codeEingabe: (v) => { S.scan.codeEingabe = v; },
  scanName: (v) => { S.scan.name = v; zeichnen(); },
  scanKh: (v) => { S.scan.kh100Str = v; zeichnen(); },
  scanPortion: (v) => { S.scan.portionStr = v; zeichnen(); },
  fotoGewicht: (v) => { S.foto.gewicht = v; S.taraAuf.foto = null; zeichnen(); },
  teilRest: (v) => { S.teil.restStr = v; S.taraAuf.rest = null; zeichnen(); },
  grenze: (v) => { S.profil.grenze = v; sichern("profil"); },
  listeFilter: (v) => { S.listeFilter = v; zeichnen(); },
  "ge.name": (v) => { S.grundEdit.name = v; },
  "ge.kh": (v) => { S.grundEdit.kh = v; zeichnen(); },
  "ge.portionG": (v) => { S.grundEdit.portionG = v; },
  "ge.verifiziert": (v, el) => { S.grundEdit.verifiziert = el.checked; },
  "rz.name": (v) => { S.rezept.name = v; zeichnen(); },
  "rz.zName": (v, el) => { zutat(el).name = v; },
  "rz.zG": (v, el) => { zutat(el).gStr = v; zeichnen(); },
  "rz.zKh": (v, el) => { const z = zutat(el); z.kh100Str = v; z.quelle = ""; zeichnen(); },
  "rz.end": (v) => { S.rezept.endStr = v; S.taraAuf.rezeptEnd = null; zeichnen(); },
  "rz.portion": (v) => { S.rezept.portionStr = v; zeichnen(); },
  kompG: (v, el) => {
    const k = S.foto.komps.find((x) => x.id === Number(el.dataset.id));
    k.gStr = v; k.gramm = zahl(v); k.khStr = r0((k.gramm * k.kh100) / 100);
    zeichnen();
  },
  kompKh: (v, el) => {
    // Wer die KH direkt korrigiert, korrigiert den Wert je 100 g mit — sonst spränge die Zahl
    // beim nächsten Ändern der Menge auf die alte Schätzung zurück.
    const k = S.foto.komps.find((x) => x.id === Number(el.dataset.id));
    k.khStr = v;
    if (k.gramm > 0) k.kh100 = (zahl(v) / k.gramm) * 100;
    zeichnen();
  },
  name: (v) => { S.profil.name = v; sichern("profil"); },
  gewicht: (v) => { S.profil.gewicht = v; S.profil.gewichtDatum = new Date().toISOString(); sichern("profil"); },
  apiKey: (v) => { S.einst.keys[S.einst.anbieter] = v.trim(); sichern("einst"); },
  "fe.name": (v) => { S.favEdit.name = v; },
  "fe.unit": (v) => { S.favEdit.unit = v; },
  "fe.portionG": (v) => { S.favEdit.portionG = v; },
  "fe.kh": (v) => { S.favEdit.kh = v; },
};

const zutat = (el) => S.rezept.zutaten.find((z) => z.id === el.dataset.id);

document.addEventListener("input", (ev) => {
  const el = ev.target;
  const fn = EINGABEN[el.dataset?.in];
  if (fn && el.type !== "file") fn(el.value, el);
});

document.addEventListener("change", async (ev) => {
  const el = ev.target;
  if (el.dataset?.in === "gewicht") zeichnen(); // Datum „Zuletzt geändert“ erst nach dem Tippen auffrischen
  // Zutat gewählt (Liste oder fertig getippt): bekannten Wert eintragen, solange das KH-Feld leer
  // ist. Erst bei „change“, nicht bei jedem Buchstaben — sonst sprängen Werte beim Tippen hin und her.
  if (el.dataset?.in === "rz.zName") {
    const z = zutat(el), b = z && bekannt(z.name);
    if (z && b && z.kh100Str === "") { z.kh100Str = r1(b.kh100); z.quelle = `${b.quelle} „${b.name}“`; }
    zeichnen();
  }
  if (el.dataset?.in === "ge.verifiziert") zeichnen();
  if (el.dataset?.in === "fotoDatei" && el.files?.[0]) fotoAuswerten(el.files[0]);
  if (el.dataset?.in === "importDatei" && el.files?.[0]) {
    try {
      const daten = importPruefen(JSON.parse(await el.files[0].text()));
      const { favs, geaendert } = favsZusammenfuehren(S.favs, daten.favs);
      S.favs = favs;
      const g = listenZusammenfuehren(S.grund, daten.grund);
      S.grund = g.favs;
      S.behaelter = listenZusammenfuehren(S.behaelter, daten.behaelter).favs;
      if (daten.profil) S.profil = { ...S.profil, ...daten.profil };
      if (["Gemini", "OpenAI"].includes(daten.einstellungen?.anbieter)) S.einst.anbieter = daten.einstellungen.anbieter;
      sichern("favs", "profil", "einst", "grund", "behaelter");
      melden(`${geaendert} Favoriten und ${g.geaendert} Listenwerte importiert`);
      zeichnen();
    } catch (e) {
      melden(e.message || "Datei konnte nicht gelesen werden.", true);
    }
    el.value = "";
  }
});

document.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (form.dataset.form === "code") {
    const code = S.scan.codeEingabe.replace(/\D/g, "");
    if (code.length >= 8) produktLaden(code);
    else melden("Die Nummer hat mindestens 8 Ziffern.", true);
  }
  if (form.dataset.form === "behaelter") {
    const name = form.elements.name.value.trim(), gramm = zahl(form.elements.gramm.value);
    if (!name || !(gramm > 0)) return melden("Name und Leergewicht angeben.", true);
    S.behaelter = [...S.behaelter, { id: neueId(), name, gramm, updatedAt: Date.now() }];
    sichern("behaelter");
    zeichnen();
  }
  if (form.dataset.form === "grund") {
    const e = S.grundEdit;
    if (!e.name.trim()) return melden("Name angeben.", true);
    const kh = e.kh === "" ? null : zahl(e.kh);
    if (kh != null && (kh < 0 || kh > 100)) return melden("KH je 100 g muss zwischen 0 und 100 liegen.", true);
    if (e.verifiziert && kh == null) return melden("Ohne Wert kann nichts bestätigt sein.", true);
    const alt = S.grund.find((g) => g.id === e.id) || {};
    const neu = {
      ...alt, id: e.id || neueId(), name: e.name.trim(), zustand: e.zustand, kategorie: e.kategorie || "Eigene",
      kh100: kh, portionG: zahl(e.portionG) > 0 ? zahl(e.portionG) : null,
      verifiziert: e.verifiziert, quelle: e.verifiziert ? "eltern" : "eigen", hinweis: alt.hinweis || "",
      updatedAt: Date.now(),
    };
    S.grund = e.id ? S.grund.map((g) => (g.id === e.id ? neu : g)) : [...S.grund, neu];
    S.grundEdit = null;
    sichern("grund");
    melden(`${grundName(neu)} gespeichert`);
    zeichnen();
  }
  if (form.dataset.form === "fav") {
    const e = S.favEdit;
    const kh = zahl(e.kh), portionG = zahl(e.portionG);
    if (!e.name.trim() || !(kh >= 0) || e.kh === "") return melden("Name und KH angeben.", true);
    if (e.modus === "100g" && !(portionG > 0)) return melden("Bei KH pro 100 g das Portionsgewicht angeben.", true);
    const fav = {
      id: e.id || neueId(), name: e.name.trim(), unit: e.unit.trim() || "Portion",
      portionG: portionG > 0 ? portionG : null,
      kh100: e.modus === "100g" ? kh : null,
      khPortion: e.modus === "portion" ? kh : null,
      updatedAt: Date.now(),
    };
    S.favs = e.id ? S.favs.map((f) => (f.id === e.id ? fav : f)) : [...S.favs, fav];
    S.favEdit = null;
    sichern("favs");
    melden(`${fav.name} gespeichert`);
    zeichnen();
  }
});

// Läuft die App über Mitternacht offen, gehört „heute“ zum neuen Tag und die Sieben-Tage-
// Grenze rückt nach.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const vorher = S.eintraege.length;
  S.eintraege = altesEntfernen(S.eintraege);
  if (S.eintraege.length !== vorher) sichern("eintraege");
  if (S.screen !== "scan") zeichnen();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

await laden();
dauerhaftAnfragen();
zeichnen();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
