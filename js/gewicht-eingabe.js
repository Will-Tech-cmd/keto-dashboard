// gewicht-eingabe.js — der eine Ort für alles, was mit eingetragenen Gewichten zu tun hat:
// eintragen, nachtragen, ändern, löschen.
//
// Getrennt von gewicht.js, weil dort nur gerechnet wird: die Rechnung läuft in den Tests
// ohne Browser, dieser Teil braucht ein Dokument.
//
// Warum alles in EINEM Dialog und nicht verteilt: ein Wert von vor drei Wochen war vorher
// nur erreichbar, indem man auf der Startseite einundzwanzigmal einen Tag zurückblätterte.
// Ein Datumsfeld allein hätte das Nachtragen gelöst, aber nicht das Wiederfinden — deshalb
// steht die Liste der letzten Messungen darunter, und ein Tipp darauf lädt sie ins Formular.

import { Store, dateKeyOf } from "./store.js";
import { calcTargets } from "./profiles.js";
import { dateLabel } from "./consumption.js";
import { esc, showToast, showSnackbar, bindBackClose, selectOnFocus, zahlAus } from "./ui.js";
import { gewichtspunkte } from "./gewicht.js";

/** So viele vergangene Messungen stehen im Dialog. Mehr wäre eine Liste zum Scrollen in
 * einem Dialog, der eigentlich ein Formular ist — der Verlauf gehört in die Auswertung. */
const LISTE_MAX = 8;

/**
 * Anzeigeform einer Zahl. Punkt, nicht Komma — so schreibt die App JEDE Zahl, von den
 * Zielringen bis zur Zutatenmenge. Zwei Trennzeichen nebeneinander auf einem Bildschirm
 * sehen wie ein Fehler aus, und im großen Ergebniswert der Auswertung riss die Sperrschrift
 * das Komma sichtbar aus der Zahl heraus („88, 1"). Eingetippt werden darf weiterhin
 * beides (siehe ui.js).
 */
const zahl = (n) => (n == null ? "" : String(Math.round(n * 10) / 10));

/**
 * Trägt das Gewicht ein. Ist der Tag der jüngste, den es gibt, wandert der Wert
 * zusätzlich ins Profil — daraus rechnet die App Grundumsatz und Zielwerte (profiles.js).
 * Ein nachgetragener Tag von letzter Woche tut das NICHT: er beschreibt die Vergangenheit,
 * nicht den heutigen Stand.
 *
 * Gibt zurück, ob und wie sich das Kalorienziel dadurch verschoben hat.
 */
function speichere(profile, dateKey, { kg, bodyFatPct }) {
  const vorher = calcTargets(profile);
  Store.setWeight(profile.id, dateKey, { kg, bodyFatPct });

  const juengster = gewichtspunkte(profile.id).at(-1);
  const istJuengster = !juengster || juengster.dateKey <= dateKey;
  if (!istJuengster) return { kcalVorher: vorher.kcal, kcalNachher: vorher.kcal, insProfil: false };

  const patch = { weightKg: kg };
  // Körperfett nur übernehmen, wenn wirklich gemessen wurde. Ein leeres Feld heißt „nicht
  // gemessen", nicht „auf null gesetzt" — sonst fiele die Rechnung stumm von
  // Katch-McArdle auf Mifflin-St Jeor zurück.
  if (bodyFatPct != null) patch.bodyFatPct = bodyFatPct;
  Store.updateProfile(profile.id, patch);

  return {
    kcalVorher: vorher.kcal,
    kcalNachher: calcTargets(Store.getActiveProfile()).kcal,
    insProfil: true,
  };
}

/** Die letzten Messungen, jüngste zuerst — die Liste im Dialog. */
function letzteMessungen(profileId) {
  return [...gewichtspunkte(profileId)].reverse().slice(0, LISTE_MAX);
}

function listeHtml(profileId, aktiverTag) {
  const punkte = letzteMessungen(profileId);
  if (punkte.length === 0) return "";
  const gesamt = gewichtspunkte(profileId).length;
  return `
    <div class="gewicht-liste">
      <div class="klar-eyebrow" style="margin:0 0 6px">Zuletzt gewogen</div>
      ${punkte.map(p => `
        <div class="gewicht-liste-zeile${p.dateKey === aktiverTag ? " aktiv" : ""}" data-tag="${p.dateKey}">
          <button type="button" class="gewicht-liste-waehlen" data-waehlen="${p.dateKey}">
            <span class="tag">${esc(dateLabel(p.dateKey))}</span>
            <span class="kg">${zahl(p.kg)} kg</span>
            ${p.bodyFatPct != null ? `<span class="kf">${zahl(p.bodyFatPct)} %</span>` : ""}
          </button>
          <button type="button" class="gewicht-liste-weg" data-weg="${p.dateKey}"
                  aria-label="Messung vom ${esc(dateLabel(p.dateKey))} löschen">✕</button>
        </div>
      `).join("")}
      ${gesamt > punkte.length ? `<p class="hint" style="margin:6px 0 0">${gesamt - punkte.length} ältere in der Auswertung.</p>` : ""}
    </div>
  `;
}

/**
 * Dialog für einen Tag. `onDone` wird nach jeder Änderung gerufen (auch nach dem Löschen),
 * damit die aufrufende Ansicht sich neu zeichnen kann.
 */
export function openGewichtModal(startTag = dateKeyOf(Date.now()), onDone = () => {}) {
  const profile = Store.getActiveProfile();
  const heute = dateKeyOf(Date.now());
  // Ein Gewicht für übermorgen gibt es nicht. Wer von einem geplanten Tag aus hierherkommt,
  // landet deshalb auf heute statt auf einem Datum, das die Waage nicht kennen kann.
  let tag = startTag > heute ? heute : startTag;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">Gewicht</h2>
      <p class="hint">Am aussagekräftigsten morgens, nüchtern, nach dem Klo — sonst misst die Waage vor allem den Tagesablauf. Notierte Werte lassen sich über das Datum nachtragen.</p>
      <div class="gewicht-felder">
        <label style="flex:1 1 100%">
          <span>Tag</span>
          <input type="date" id="gewichtTag" max="${heute}" value="${tag}">
        </label>
        <label>
          <span>Gewicht (kg)</span>
          <input type="text" id="gewichtKg" inputmode="decimal" autocomplete="off" placeholder="z.B. 82,4">
        </label>
        <label>
          <span>Körperfett (%)<em>optional</em></span>
          <input type="text" id="gewichtKf" inputmode="decimal" autocomplete="off" placeholder="–">
        </label>
      </div>
      <p class="hint" id="gewichtHinweis" style="margin-top:10px"></p>
      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn secondary" id="gewichtCancel">Fertig</button>
        <button type="button" class="btn" id="gewichtSave">Speichern</button>
      </div>
      <div id="gewichtListe"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  selectOnFocus(overlay);

  const tagFeld = overlay.querySelector("#gewichtTag");
  const kgFeld = overlay.querySelector("#gewichtKg");
  const kfFeld = overlay.querySelector("#gewichtKf");
  const hinweis = overlay.querySelector("#gewichtHinweis");
  const speichernKnopf = overlay.querySelector("#gewichtSave");
  const listeEl = overlay.querySelector("#gewichtListe");

  let geaendert = false;   // wurde in diesem Dialog etwas geschrieben? -> onDone beim Schließen

  /** Formular auf den gewählten Tag stellen. */
  function ladeTag() {
    const vorhanden = Store.getWeight(profile.id, tag);
    // Ohne Messung an diesem Tag steht das Profilgewicht als Vorschlag drin: die Waage zeigt
    // selten etwas völlig anderes, und die letzte Stelle zu ändern ist weniger Tipparbeit
    // als eine leere Zeile zu füllen. Bei einem nachgetragenen Tag wäre dieser Vorschlag
    // allerdings geraten — dort bleibt das Feld leer.
    const vorschlag = vorhanden?.kg ?? (tag === heute ? profile.weightKg : null);
    kgFeld.value = vorschlag != null ? zahl(vorschlag) : "";
    kfFeld.value = vorhanden?.bodyFatPct != null ? zahl(vorhanden.bodyFatPct) : "";
    speichernKnopf.textContent = vorhanden ? "Ändern" : "Speichern";
    zeigeVorschau();
    zeichneListe();
  }

  function zeichneListe() {
    listeEl.innerHTML = listeHtml(profile.id, tag);
    listeEl.querySelectorAll("[data-waehlen]").forEach(btn => {
      btn.addEventListener("click", () => {
        tag = btn.dataset.waehlen;
        tagFeld.value = tag;
        ladeTag();
        kgFeld.focus();
      });
    });
    listeEl.querySelectorAll("[data-weg]").forEach(btn => {
      btn.addEventListener("click", () => {
        const weg = btn.dataset.weg;
        const gesichert = Store.getWeight(profile.id, weg);
        Store.removeWeight(profile.id, weg);
        geaendert = true;
        ladeTag();
        // Rückgängig statt Sicherheitsfrage: ein Tipp daneben darf keine Messung kosten,
        // und eine Nachfrage bei jedem Löschen wäre bei acht Zeilen achtmal im Weg.
        showSnackbar({
          title: `${zahl(gesichert.kg)} kg gelöscht`,
          subtitle: dateLabel(weg),
          onUndo: () => {
            Store.setWeight(profile.id, weg, { kg: gesichert.kg, bodyFatPct: gesichert.bodyFatPct });
            ladeTag();
          },
        });
      });
    });
  }

  // Was der eingetippte Wert am Kalorienziel ändern würde — vor dem Speichern, nicht
  // danach. Eine Zielwertänderung, die man erst hinterher bemerkt, ist eine Überraschung.
  function zeigeVorschau() {
    const kg = zahlAus(kgFeld.value);
    if (kg == null) { hinweis.textContent = ""; return; }
    const kf = zahlAus(kfFeld.value);
    const juengster = gewichtspunkte(profile.id).at(-1);
    if (juengster && juengster.dateKey > tag) {
      hinweis.textContent = "Nachgetragener Tag — die Zielwerte bleiben, wie sie sind.";
      return;
    }
    const jetzt = calcTargets(Store.getActiveProfile()).kcal;
    const dann = calcTargets({ ...Store.getActiveProfile(), weightKg: kg, bodyFatPct: kf ?? profile.bodyFatPct }).kcal;
    hinweis.textContent = Math.abs(dann - jetzt) < 10
      ? "Ändert an den Zielwerten nichts Nennenswertes."
      : `Zielwerte rechnen sich damit auf ${dann} kcal um (bisher ${jetzt}).`;
  }

  tagFeld.addEventListener("change", () => {
    // Leeres oder unmögliches Datum: auf den zuletzt gültigen Tag zurück, statt mit einem
    // ungültigen Schlüssel weiterzuarbeiten.
    const gewaehlt = tagFeld.value;
    tag = /^\d{4}-\d{2}-\d{2}$/.test(gewaehlt) && gewaehlt <= heute ? gewaehlt : tag;
    tagFeld.value = tag;
    ladeTag();
  });
  kgFeld.addEventListener("input", zeigeVorschau);
  kfFeld.addEventListener("input", zeigeVorschau);

  const close = bindBackClose(() => overlay.remove());
  const schliessen = () => close(() => { if (geaendert) onDone(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) schliessen(); });
  overlay.querySelector("#gewichtCancel").addEventListener("click", schliessen);

  speichernKnopf.addEventListener("click", () => {
    const kg = zahlAus(kgFeld.value);
    if (kg == null || kg < 20 || kg > 400) {
      showToast("Bitte ein Gewicht zwischen 20 und 400 kg eintragen");
      kgFeld.focus();
      return;
    }
    const kf = zahlAus(kfFeld.value);
    if (kf != null && (kf <= 0 || kf >= 70)) {
      showToast("Körperfett muss zwischen 1 und 69 % liegen");
      kfFeld.focus();
      return;
    }
    const ergebnis = speichere(profile, tag, { kg, bodyFatPct: kf });
    geaendert = true;
    const verschoben = Math.abs(ergebnis.kcalNachher - ergebnis.kcalVorher) >= 10;
    showToast(verschoben
      ? `${zahl(kg)} kg · Ziel jetzt ${ergebnis.kcalNachher} kcal`
      : `${zahl(kg)} kg · ${dateLabel(tag)}`);
    // Der Dialog bleibt offen und auf demselben Tag stehen: der Knopf heißt jetzt „Ändern",
    // die neue Zeile steht oben in der Liste. Automatisch auf den nächsten leeren Tag zu
    // springen wäre bequemer für eine Reihe notierter Werte — aber es verschiebt das Datum
    // unter den Fingern, und wer wöchentlich notiert hat, landet dann jedes Mal woanders,
    // als er denkt. Ein Tipp auf das Datumsfeld ist der ehrlichere Weg.
    ladeTag();
  });

  ladeTag();
  if (!Store.getWeight(profile.id, tag)) kgFeld.focus();
}
