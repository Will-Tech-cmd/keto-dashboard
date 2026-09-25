// schritte-eingabe.js — Schritte eintragen, nachtragen, ändern, löschen.
//
// Aufgebaut wie gewicht-eingabe.js, und aus demselben Grund: ein Wert von vorgestern war
// sonst nur erreichbar, indem man sich auf der Startseite Tag für Tag zurückblättert. Das
// Datumsfeld löst das Nachtragen, die Liste darunter das Wiederfinden.
//
// Eingetragen wird von Hand, weil es gar nicht anders geht: eine Website kann keinen
// Schrittzähler lesen (siehe Migration 20260925090000). Schreibt eines Tages eine
// Automatisierung vom Handy in dieselbe Tabelle, ändert sich an diesem Dialog nichts — er
// zeigt dann, was von dort kam.

import { Store, dateKeyOf } from "./store.js";
import { dateLabel } from "./consumption.js";
import { esc, showToast, showSnackbar, bindBackClose, selectOnFocus, zahlAus } from "./ui.js";
import { schrittePunkte, zahl, schnitt } from "./schritte.js";

/** So viele vergangene Tage stehen im Dialog — wie beim Gewicht. */
const LISTE_MAX = 8;

function listeHtml(profileId, aktiverTag) {
  const punkte = [...schrittePunkte(profileId)].reverse().slice(0, LISTE_MAX);
  if (punkte.length === 0) return "";
  const gesamt = schrittePunkte(profileId).length;
  return `
    <div class="gewicht-liste">
      <div class="klar-eyebrow" style="margin:0 0 6px">Zuletzt eingetragen</div>
      ${punkte.map(p => `
        <div class="gewicht-liste-zeile${p.dateKey === aktiverTag ? " aktiv" : ""}" data-tag="${p.dateKey}">
          <button type="button" class="gewicht-liste-waehlen" data-waehlen="${p.dateKey}">
            <span class="tag">${esc(dateLabel(p.dateKey))}</span>
            <span class="kg">${zahl(p.steps)}</span>
          </button>
          <button type="button" class="gewicht-liste-weg" data-weg="${p.dateKey}"
                  aria-label="Eintrag vom ${esc(dateLabel(p.dateKey))} löschen">✕</button>
        </div>
      `).join("")}
      ${gesamt > punkte.length ? `<p class="hint" style="margin:6px 0 0">${gesamt - punkte.length} ältere Tage sind gespeichert.</p>` : ""}
    </div>
  `;
}

/**
 * Dialog für einen Tag. `onDone` wird nach jeder Änderung gerufen (auch nach dem Löschen),
 * damit die aufrufende Ansicht sich neu zeichnen kann.
 */
export function openSchritteModal(startTag = dateKeyOf(Date.now()), onDone = () => {}) {
  const profile = Store.getActiveProfile();
  const heute = dateKeyOf(Date.now());
  // Schritte für übermorgen gibt es nicht — wer von einem geplanten Tag kommt, landet auf heute.
  let tag = startTag > heute ? heute : startTag;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 class="klar-sheet-title" style="margin:0 0 2px">Schritte</h2>
      <p class="hint">Die Zahl steht in der Health-Verbindung oder in Mi Fitness. Abgelesen und eingetippt — den Schrittzähler selbst kann diese App nicht auslesen.</p>
      <div class="gewicht-felder">
        <label style="flex:1 1 100%">
          <span>Tag</span>
          <input type="date" id="schritteTag" max="${heute}" value="${tag}">
        </label>
        <label style="flex:1 1 100%">
          <span>Schritte</span>
          <input type="text" id="schritteZahl" inputmode="numeric" autocomplete="off" placeholder="z.B. 8500">
        </label>
      </div>
      <p class="hint" id="schritteHinweis" style="margin-top:10px"></p>
      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn secondary" id="schritteCancel">Fertig</button>
        <button type="button" class="btn" id="schritteSave">Speichern</button>
      </div>
      <div id="schritteListe"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  selectOnFocus(overlay);

  const tagFeld = overlay.querySelector("#schritteTag");
  const zahlFeld = overlay.querySelector("#schritteZahl");
  const hinweis = overlay.querySelector("#schritteHinweis");
  const speichernKnopf = overlay.querySelector("#schritteSave");
  const listeEl = overlay.querySelector("#schritteListe");

  let geaendert = false;

  function ladeTag() {
    const vorhanden = Store.getStepsFor(profile.id, tag);
    // Kein Vorschlag aus der Luft: anders als beim Gewicht gibt es keinen "letzten Stand",
    // der für heute plausibel wäre — gestern 12.000 sagt über heute nichts.
    zahlFeld.value = vorhanden ? String(vorhanden.steps) : "";
    speichernKnopf.textContent = vorhanden ? "Ändern" : "Speichern";
    zeigeHinweis();
    zeichneListe();
  }

  function zeichneListe() {
    listeEl.innerHTML = listeHtml(profile.id, tag);
    listeEl.querySelectorAll("[data-waehlen]").forEach(btn => {
      btn.addEventListener("click", () => {
        tag = btn.dataset.waehlen;
        tagFeld.value = tag;
        ladeTag();
        zahlFeld.focus();
      });
    });
    listeEl.querySelectorAll("[data-weg]").forEach(btn => {
      btn.addEventListener("click", () => {
        const weg = btn.dataset.weg;
        const gesichert = Store.getStepsFor(profile.id, weg);
        Store.removeSteps(profile.id, weg);
        geaendert = true;
        ladeTag();
        showSnackbar({
          title: `${zahl(gesichert.steps)} Schritte gelöscht`,
          subtitle: dateLabel(weg),
          onUndo: () => {
            Store.setSteps(profile.id, weg, gesichert.steps);
            ladeTag();
          },
        });
      });
    });
  }

  /** Was die eingetippte Zahl gegenüber der letzten Woche bedeutet. */
  function zeigeHinweis() {
    const n = zahlAus(zahlFeld.value);
    const mittel = schnitt(profile.id, { heute, tage: 7 });
    if (n == null || mittel == null) {
      hinweis.textContent = mittel == null ? "" : `Schnitt der letzten 7 Tage: ${zahl(mittel)}.`;
      return;
    }
    const unterschied = n - mittel;
    hinweis.textContent = Math.abs(unterschied) < mittel * 0.05
      ? `Etwa so viel wie im Schnitt der letzten 7 Tage (${zahl(mittel)}).`
      : `${zahl(Math.abs(unterschied))} ${unterschied > 0 ? "mehr" : "weniger"} als im Schnitt der letzten 7 Tage (${zahl(mittel)}).`;
  }

  tagFeld.addEventListener("change", () => {
    const gewaehlt = tagFeld.value;
    tag = /^\d{4}-\d{2}-\d{2}$/.test(gewaehlt) && gewaehlt <= heute ? gewaehlt : tag;
    tagFeld.value = tag;
    ladeTag();
  });
  zahlFeld.addEventListener("input", zeigeHinweis);

  const close = bindBackClose(() => overlay.remove());
  const schliessen = () => close(() => { if (geaendert) onDone(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) schliessen(); });
  overlay.querySelector("#schritteCancel").addEventListener("click", schliessen);

  speichernKnopf.addEventListener("click", () => {
    const n = zahlAus(zahlFeld.value);
    // Die Obergrenze ist keine Schikane: 200.000 Schritte sind rund 140 km am Stück. Was
    // darüber steht, ist ein Vertipper, und ein Vertipper im Vergleich ist ärgerlicher als
    // eine Nachfrage.
    if (n == null || n < 0 || n > 200000) {
      showToast("Bitte eine Schrittzahl zwischen 0 und 200.000 eintragen");
      zahlFeld.focus();
      return;
    }
    Store.setSteps(profile.id, tag, n);
    geaendert = true;
    showToast(`${zahl(n)} Schritte · ${dateLabel(tag)}`);
    ladeTag();
  });

  ladeTag();
  if (!Store.getStepsFor(profile.id, tag)) zahlFeld.focus();
}
