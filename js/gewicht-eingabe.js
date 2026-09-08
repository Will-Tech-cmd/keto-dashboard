// gewicht-eingabe.js — der Dialog zum Eintragen und Korrigieren eines Tagesgewichts.
//
// Getrennt von gewicht.js, weil dort nur gerechnet wird: die Rechnung läuft in den Tests
// ohne Browser, dieser Teil braucht ein Dokument.

import { Store, dateKeyOf } from "./store.js";
import { calcTargets } from "./profiles.js";
import { dateLabel } from "./consumption.js";
import { esc, showToast, bindBackClose, selectOnFocus } from "./ui.js";
import { gewichtspunkte } from "./gewicht.js";

/**
 * Deutsche Eingabe: „82,4" ist hier die Regel, nicht die Ausnahme.
 *
 * Deshalb stehen die beiden Felder als `type=text` mit `inputmode=decimal` im Markup und
 * nicht als `type=number`: dessen `value` ist laut Norm eine Zahl mit Punkt, und ein
 * getipptes Komma macht das Feld schlicht leer — gemessen in Chromium, wo aus „78,5" ein
 * "" wird. Auf dem Handy steht die Kommataste direkt unter dem Daumen, und das Ergebnis
 * wäre „Bitte ein Gewicht zwischen 20 und 400 kg eintragen", ohne dass irgendwo stünde,
 * woran es lag. `inputmode=decimal` holt dieselbe Zifferntastatur, ohne den Wert zu
 * beschneiden; geprüft wird hier ohnehin selbst.
 */
function zahlAus(rohwert) {
  const n = Number.parseFloat(String(rohwert ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const kommaZahl = (n, stellen = 1) => n.toFixed(stellen).replace(".", ",");

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

/**
 * Dialog für einen Tag. `onDone` wird nach jeder Änderung gerufen (auch nach dem Löschen),
 * damit die aufrufende Ansicht sich neu zeichnen kann.
 */
export function openGewichtModal(dateKey = dateKeyOf(Date.now()), onDone = () => {}) {
  const profile = Store.getActiveProfile();
  const vorhanden = Store.getWeight(profile.id, dateKey);
  // Ohne Messung an diesem Tag steht das Profilgewicht als Vorschlag drin: die Waage zeigt
  // selten etwas völlig anderes, und die letzte Stelle zu ändern ist weniger Tipparbeit
  // als eine leere Zeile zu füllen.
  const vorschlag = vorhanden?.kg ?? profile.weightKg ?? null;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">
        Gewicht ${esc(dateLabel(dateKey).toLowerCase())}
      </h2>
      <p class="hint">Am aussagekräftigsten morgens, nüchtern, nach dem Klo — sonst misst die Waage vor allem den Tagesablauf.</p>
      <div class="gewicht-felder">
        <label>
          <span>Gewicht (kg)</span>
          <input type="text" id="gewichtKg" inputmode="decimal" autocomplete="off"
                 value="${vorschlag != null ? esc(kommaZahl(vorschlag)) : ""}" placeholder="z.B. 82,4">
        </label>
        <label>
          <span>Körperfett (%)<em>optional</em></span>
          <input type="text" id="gewichtKf" inputmode="decimal" autocomplete="off"
                 value="${vorhanden?.bodyFatPct != null ? esc(kommaZahl(vorhanden.bodyFatPct)) : ""}" placeholder="–">
        </label>
      </div>
      <p class="hint" id="gewichtHinweis" style="margin-top:10px"></p>
      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn secondary" id="gewichtCancel">Abbrechen</button>
        <button type="button" class="btn" id="gewichtSave">Speichern</button>
      </div>
      ${vorhanden ? `<button type="button" class="btn ghost" id="gewichtDelete" style="margin-top:8px">Eintrag löschen</button>` : ""}
    </div>
  `;
  document.body.appendChild(overlay);
  selectOnFocus(overlay);

  const kgFeld = overlay.querySelector("#gewichtKg");
  const kfFeld = overlay.querySelector("#gewichtKf");
  const hinweis = overlay.querySelector("#gewichtHinweis");

  // Was der eingetippte Wert am Kalorienziel ändern würde — vor dem Speichern, nicht
  // danach. Eine Zielwertänderung, die man erst hinterher bemerkt, ist eine Überraschung.
  function zeigeVorschau() {
    const kg = zahlAus(kgFeld.value);
    const kf = zahlAus(kfFeld.value);
    if (kg == null) { hinweis.textContent = ""; return; }
    const jetzt = calcTargets(profile).kcal;
    const dann = calcTargets({ ...profile, weightKg: kg, bodyFatPct: kf ?? profile.bodyFatPct }).kcal;
    const juengster = gewichtspunkte(profile.id).at(-1);
    if (juengster && juengster.dateKey > dateKey) {
      hinweis.textContent = "Nachgetragener Tag — die Zielwerte bleiben, wie sie sind.";
      return;
    }
    hinweis.textContent = Math.abs(dann - jetzt) < 10
      ? "Ändert an den Zielwerten nichts Nennenswertes."
      : `Zielwerte rechnen sich damit auf ${dann} kcal um (bisher ${jetzt}).`;
  }
  kgFeld.addEventListener("input", zeigeVorschau);
  kfFeld.addEventListener("input", zeigeVorschau);
  zeigeVorschau();

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#gewichtCancel").addEventListener("click", close);

  overlay.querySelector("#gewichtSave").addEventListener("click", () => {
    const kg = zahlAus(kgFeld.value);
    if (kg == null || kg < 20 || kg > 400) {
      showToast("Bitte ein Gewicht zwischen 20 und 400 kg eintragen");
      return;
    }
    const kf = zahlAus(kfFeld.value);
    if (kf != null && (kf <= 0 || kf >= 70)) {
      showToast("Körperfett muss zwischen 1 und 69 % liegen");
      return;
    }
    const ergebnis = speichere(profile, dateKey, { kg, bodyFatPct: kf });
    const verschoben = Math.abs(ergebnis.kcalNachher - ergebnis.kcalVorher) >= 10;
    showToast(verschoben
      ? `${kommaZahl(kg)} kg · Ziel jetzt ${ergebnis.kcalNachher} kcal`
      : `${kommaZahl(kg)} kg eingetragen`);
    close(() => onDone());
  });

  overlay.querySelector("#gewichtDelete")?.addEventListener("click", () => {
    Store.removeWeight(profile.id, dateKey);
    showToast("Gewicht gelöscht");
    close(() => onDone());
  });
}
