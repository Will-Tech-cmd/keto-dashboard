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
} from "./logik.js";
import { lesen, schreiben, dauerhaftAnfragen } from "./speicher.js";
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
  profil: { name: "Sema", gewicht: "", gewichtDatum: null },
  einst: { anbieter: "Gemini", keys: { Gemini: "", OpenAI: "" }, hinweisGesehen: false },
  sheet: null,      // { favId, menge }
  favEdit: null,    // Formular „Favorit anlegen/bearbeiten“
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
  const [favs, eintraege, produkte, profil, einst] = await Promise.all([
    lesen("favs", []), lesen("eintraege", []), lesen("produkte", {}),
    lesen("profil", null), lesen("einst", null),
  ]);
  S.favs = favs;
  S.eintraege = altesEntfernen(eintraege);
  S.produkte = produkte;
  if (profil) S.profil = { ...S.profil, ...profil };
  if (einst) S.einst = { ...S.einst, ...einst, keys: { ...S.einst.keys, ...(einst.keys || {}) } };
  if (S.eintraege.length !== eintraege.length) await schreiben("eintraege", S.eintraege);
}

function sichern(...schluessel) {
  for (const k of schluessel) {
    const wert = k === "eintraege" ? S.eintraege : k === "favs" ? S.favs : k === "produkte" ? S.produkte
      : k === "profil" ? S.profil : S.einst;
    schreiben(k, wert).catch(() => melden("Speichern fehlgeschlagen.", true));
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
};

const heute = () => tagSchluessel();
const eintraegeVon = (tag) => S.eintraege.filter((e) => e.date === tag);
const tagText = (d = new Date()) => d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
const datumText = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE") : "noch nie");
const keyAktuell = () => S.einst.keys[S.einst.anbieter] || "";

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
  melden(nachricht);
}

function gehe(screen) {
  if (S.screen === "scan" && screen !== "scan") stopScanner();
  S.screen = screen;
  S.sheet = null;
  S.favEdit = null;
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
    <button class="btn btn-ghost btn-text" data-act="favNeu" style="align-self:flex-start;font-size:16px;min-height:44px;padding:0 4px">+ Neuer Favorit</button>
  </div>
</div>`;
}

function tagesansicht() {
  const tag = heute(), gestern = tagVerschieben(tag, -1);
  const heuteListe = eintraegeVon(tag), gesternListe = eintraegeVon(gestern);
  const gruppen = (liste) => MAHLZEITEN.map((m) => ({ m, items: liste.filter((e) => e.meal === m) })).filter((g) => g.items.length);

  const heuteHtml = gruppen(heuteListe).map(({ m, items }) => `
<div class="stapel" style="gap:4px;padding:16px 18px;border-radius:28px;background:var(--color-neutral-100)">
  <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px"><h4 style="margin:0;font-size:21px">${m}</h4><span style="font-size:20px;font-weight:700">${r0(summeKh(items))} g</span></div>
  ${items.map((e) => `
  <div class="zeile-trenner">
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;padding:6px 0">
      <span style="font-size:17px;font-weight:600">${esc(e.name)}</span>
      <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:14px" class="leise">${esc(e.amount)}${e.src === "ki" ? tagKi() : ""}</span>
    </div>
    <span style="font-size:18px;font-weight:700">${r0(e.kh)} g</span>
    <button class="knopf-roh rund rund-weg" data-act="eintragLoeschen" data-id="${esc(e.id)}" aria-label="${esc(e.name)} löschen">${SVG(I.x, 20)}</button>
  </div>`).join("")}
</div>`).join("");

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
  </div>
  ${heuteListe.length ? heuteHtml : `<div class="karte" style="padding:20px;font-size:17px">Heute noch nichts eingetragen.</div>`}
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
    treffer.push({ art: "fav", name: f.name, amount: favPortionText(f), basis: favBasis(f), kh: favKhJePortion(f), favId: f.id, portion: true });
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
      t.kh = gramm != null ? (t.kh100 * gramm) / 100 : null;
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
  const kiMoeglich = key.length >= 2 && !treffer.some((t) => t.art !== "ki") && !onlineLaeuft && !(S.kiSuche.fuer === key && S.kiSuche.ergebnis);
  const tags = { fav: '<span class="tag tag-accent-2" style="font-size:13px;font-weight:700">1 · Favorit</span>', db: '<span class="tag tag-neutral" style="font-size:13px;font-weight:700;background:var(--color-neutral-200)">2 · Barcode-Datenbank</span>', ki: '<span class="tag tag-accent" style="font-size:13px;font-weight:700">3 · KI-Schätzung · geschätzt</span>' };

  const karten = treffer.map((t, i) => `
<div class="stapel" style="gap:10px;padding:16px 18px;border-radius:28px;background:var(--color-neutral-100)">
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${tags[t.art]}</div>
  <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px">
    <div class="stapel" style="min-width:0"><span style="font-size:20px;font-weight:700">${esc(t.name)}</span><span style="font-size:15px" class="leise">${esc(t.amount)} · ${esc(t.basis)}</span></div>
    <span style="font-family:var(--font-heading);font-size:32px;line-height:1;flex:none">${t.kh == null ? "–" : r0(t.kh)} g</span>
  </div>
  <button class="btn btn-primary" data-act="trefferHinzu" data-i="${i}" style="min-height:52px;font-size:18px" ${t.kh == null ? "disabled" : ""}>${t.kh == null ? "Erst Gramm angeben" : `Zu ${esc(S.meal)} hinzufügen`}</button>
  ${t.art !== "fav" && t.kh100 != null ? `<button class="btn btn-ghost btn-text" data-act="trefferFav" data-i="${i}" style="align-self:flex-start;font-size:15px;min-height:40px;padding:0 4px">Als Favorit speichern</button>` : ""}
</div>`).join("");

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
  </div>`).join("")}
  ${mahlzeitWahl()}
  <button class="btn btn-primary" data-act="fotoHinzu" style="min-height:58px;font-size:20px" ${komps.length ? "" : "disabled"}>${r0(summe)} g KH hinzufügen</button>
  <button class="btn btn-ghost btn-text" data-act="gehe" data-wert="foto" style="font-weight:600;font-size:16px;min-height:44px">Neues Foto</button>
</div>`;
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
    const ergebnis = await fotoAnalysieren(datei, { anbieter: S.einst.anbieter, key: keyAktuell(), gewicht, favs: S.favs });
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
  <div class="karte stapel" style="gap:10px">
    <span style="font-size:18px;font-weight:700">Daten teilen &amp; sichern</span>
    <span style="font-size:15px" class="leise">Favoriten, Profil und Einstellungen als Datei – z. B. von den Eltern an die Kita.</span>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn btn-secondary" data-act="export" style="min-height:52px;font-size:17px">Exportieren</button>
      <label class="btn btn-secondary" style="min-height:52px;font-size:17px" tabindex="0">Importieren<input type="file" accept="application/json,.json" data-in="importDatei" hidden></label>
    </div>
  </div>
  <p style="margin:0" class="klein leise">Datenschutz: Nur Fotos gehen zur Analyse an den gewählten KI-Anbieter, Suchbegriffe für die KI-Schätzung ebenso. Barcode und Suchbegriffe gehen an Open Food Facts. Alle anderen Daten bleiben auf diesem Gerät.</p>
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

const UNTERSEITEN = { foto: "Foto", scan: "Scannen", suche: "Eingeben" };

function zeichnen() {
  // Fokus und Schreibmarke merken: das Neuzeichnen ersetzt das Eingabefeld, und ohne das
  // hier verlöre man nach jedem Buchstaben die Tastatur.
  const aktiv = document.activeElement;
  const fokus = aktiv?.dataset?.in ? { in: aktiv.dataset.in, id: aktiv.dataset.id, start: aktiv.selectionStart, ende: aktiv.selectionEnd } : null;

  const unter = UNTERSEITEN[S.screen];
  document.body.classList.toggle("mit-tabs", !unter);
  const inhalt = { home: startseite, tag: tagesansicht, suche, scan: scannen, foto, profil }[S.screen]();
  $app.innerHTML = `
${unter ? `<div class="sema-kopf"><button class="btn btn-secondary" data-act="gehe" data-wert="home" aria-label="Zurück" style="width:48px;height:48px;padding:0;flex:none">${SVG(I.zurueck, 24)}</button><h2>${unter}</h2></div>` : ""}
<main class="sema-inhalt${unter ? "" : " ohne-kopf"}">${inhalt}</main>
${unter ? "" : `<nav class="tabs" aria-label="Hauptmenü">${[["home", "Start"], ["tag", "Heute"], ["profil", "Profil"]].map(([k, l]) =>
    `<button class="knopf-roh tab" data-act="gehe" data-wert="${k}" ${S.screen === k ? 'aria-current="page"' : ""}><span class="tab-ikone">${SVG(I[k], 24)}</span>${l}</button>`).join("")}</nav>`}
${S.sheet ? favBlatt() : ""}
${S.favEdit ? favFormular() : ""}
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

const AKTIONEN = {
  gehe: (el) => gehe(el.dataset.wert),
  mahlzeit: (el) => { S.meal = el.dataset.wert; zeichnen(); },
  hinweisOk: () => { S.einst.hinweisGesehen = true; sichern("einst"); zeichnen(); },
  schliessen: (el, ev) => { if (ev.target === el) { S.sheet = null; S.favEdit = null; zeichnen(); } },

  favSchnell: (el) => {
    const f = S.favs.find((x) => x.id === el.dataset.id);
    if (!f) return;
    const kh = favKhJePortion(f);
    eintragen([{ name: f.name, amount: favPortionText(f), kh, meal: S.meal, src: "fav" }], `${f.name} · ${r0(kh)} g KH → ${S.meal}`);
    zeichnen();
  },
  favOeffnen: (el) => { S.sheet = { favId: el.dataset.id, menge: 1 }; zeichnen(); },
  blattMenge: (el) => { S.sheet.menge = Math.max(0.5, S.sheet.menge + Number(el.dataset.wert)); zeichnen(); },
  blattHinzu: () => {
    const f = S.favs.find((x) => x.id === S.sheet.favId);
    const m = S.sheet.menge, kh = favKhJePortion(f) * m;
    eintragen([{ name: f.name, amount: favPortionText(f, m), kh, meal: S.meal, src: "fav" }], `${f.name} · ${r0(kh)} g KH → ${S.meal}`);
    S.sheet = null;
    zeichnen();
  },
  favNeu: () => { S.favEdit = { id: null, name: "", unit: "Portion", portionG: "", modus: "100g", kh: "" }; zeichnen(); },
  favBearbeiten: (el) => {
    const f = S.favs.find((x) => x.id === el.dataset.id);
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
    zeichnen();
  },

  eintragLoeschen: (el) => { S.eintraege = S.eintraege.filter((e) => e.id !== el.dataset.id); sichern("eintraege"); zeichnen(); },
  uebernehmen: (el) => {
    const e = S.eintraege.find((x) => x.id === el.dataset.id);
    if (!e) return;
    S.kopiert.add(e.id);
    eintragen([{ name: e.name, amount: e.amount, kh: e.kh, meal: e.meal, src: e.src }], `${e.name} · ${r0(e.kh)} g KH → ${e.meal}`);
    zeichnen();
  },
  alleUebernehmen: (el) => {
    const gestern = tagVerschieben(heute(), -1);
    const items = S.eintraege.filter((e) => e.date === gestern && e.meal === el.dataset.wert && !S.kopiert.has(e.id));
    if (!items.length) return;
    items.forEach((e) => S.kopiert.add(e.id));
    eintragen(items.map((e) => ({ name: e.name, amount: e.amount, kh: e.kh, meal: e.meal, src: e.src })), `${el.dataset.wert} von gestern übernommen`);
    zeichnen();
  },

  vorschlag: (el) => { S.q = `${el.dataset.wert} `; zeichnen(); document.querySelector('[data-in="q"]')?.focus(); },
  trefferHinzu: (el) => {
    const t = suchTreffer().treffer[Number(el.dataset.i)];
    if (!t || t.kh == null) return;
    eintragen([{ name: t.name, amount: t.amount, kh: t.kh, meal: S.meal, src: t.art }], `${t.name} · ${r0(t.kh)} g KH → ${S.meal}`);
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
    eintragen([{ name: s.name.trim(), amount: `${s.menge} Stück (${r0(s.menge * zahl(s.portionStr))} g)`, kh, meal: S.meal, src: "scan" }], `${s.name.trim()} · ${r0(kh)} g KH → ${S.meal}`);
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
    const liste = f.komps.map((k) => ({ name: k.name, amount: `${r0(k.gramm)} g`, kh: (k.gramm * k.kh100) / 100, meal: S.meal, src: "ki" }));
    eintragen(liste, `${f.gericht} · ${r0(summeKh(liste))} g KH → ${S.meal}`);
    gehe("home");
  },

  anbieter: (el) => { S.einst.anbieter = el.dataset.wert; sichern("einst"); zeichnen(); },
  anleitung: () => { S.anleitung = !S.anleitung; zeichnen(); },
  export: () => {
    const daten = exportDaten({ favs: S.favs, profil: S.profil, einstellungen: S.einst });
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
  q: (v) => { S.q = v; zeichnen(); sucheAktualisieren(); },
  codeEingabe: (v) => { S.scan.codeEingabe = v; },
  scanName: (v) => { S.scan.name = v; zeichnen(); },
  scanKh: (v) => { S.scan.kh100Str = v; zeichnen(); },
  scanPortion: (v) => { S.scan.portionStr = v; zeichnen(); },
  fotoGewicht: (v) => { S.foto.gewicht = v; },
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

document.addEventListener("input", (ev) => {
  const el = ev.target;
  const fn = EINGABEN[el.dataset?.in];
  if (fn && el.type !== "file") fn(el.value, el);
});

document.addEventListener("change", async (ev) => {
  const el = ev.target;
  if (el.dataset?.in === "gewicht") zeichnen(); // Datum „Zuletzt geändert“ erst nach dem Tippen auffrischen
  if (el.dataset?.in === "fotoDatei" && el.files?.[0]) fotoAuswerten(el.files[0]);
  if (el.dataset?.in === "importDatei" && el.files?.[0]) {
    try {
      const daten = importPruefen(JSON.parse(await el.files[0].text()));
      const { favs, geaendert } = favsZusammenfuehren(S.favs, daten.favs);
      S.favs = favs;
      if (daten.profil) S.profil = { ...S.profil, ...daten.profil };
      if (["Gemini", "OpenAI"].includes(daten.einstellungen?.anbieter)) S.einst.anbieter = daten.einstellungen.anbieter;
      sichern("favs", "profil", "einst");
      melden(`${geaendert} Favoriten importiert`);
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
