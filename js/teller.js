// teller.js — eine Mahlzeit unterwegs per Foto erfassen.
//
// Der Ablauf ist bewusst dreistufig: Foto -> Vorschlag -> Prüfen -> Eintragen. Der mittlere
// Schritt ist der eigentliche Punkt. Andere Apps tragen die Schätzung sofort ein und legen
// sich dabei still auf Falsches fest (glasierte Putenstreifen werden zu Garnelen). Hier steht
// jeder Posten einzeln da, mit Gramm zum Nachbessern, und wo die Erkennung selbst unsicher
// ist, bietet sie ihre Alternativen zum Antippen an.
//
// Eingetragen wird über logConsumption() wie jeder andere Eintrag auch — ein Foto-Posten ist
// hinterher nichts Besonderes mehr und lässt sich ganz normal bearbeiten oder löschen.
import { erkenneTellerFoto, hasApiKey, describeAiError } from "./ai.js";
import {
  logConsumption, suggestMeal, mealShort, MEAL_LABELS, isViewingToday,
  dateLabel, getActiveDateKey, logButtonRowHtml, askShareTargets, copyConsumptionTo,
  meldeEingetragen,
} from "./consumption.js";
import { showToast, esc, bindBackClose } from "./ui.js";

/** Foto-Posten bekommen einen eigenen Barcode-Raum: im Verlauf bleibt so erkennbar, dass die
 * Werte geschätzt und nicht von einem Etikett abgelesen sind. */
function fotoBarcode() {
  return `foto:${crypto.randomUUID().slice(0, 8)}`;
}

function round1(v) {
  return v == null ? null : Math.round(v * 10) / 10;
}

/** Summe der aktuell angehakten Posten — die Zahl, die gleich im Tagesbudget landet. */
function summe(posten) {
  return posten.reduce((acc, p) => {
    const scale = (Number(p.grams) || 0) / 100;
    return {
      kcal: acc.kcal + (p.per100.kcal != null ? p.per100.kcal * scale : 0),
      netCarbs: acc.netCarbs + (p.per100.carbs != null ? p.per100.carbs * scale : 0),
      fat: acc.fat + (p.per100.fat != null ? p.per100.fat * scale : 0),
      protein: acc.protein + (p.per100.protein != null ? p.per100.protein * scale : 0),
    };
  }, { kcal: 0, netCarbs: 0, fat: 0, protein: 0 });
}

/**
 * Einstieg aus dem Eintragen-Sheet: Kamera bzw. Galerie öffnen, danach auswerten.
 * `capture="environment"` bringt am Handy direkt die Rückkamera — unterwegs zählt jeder Tipp.
 */
export function openTellerFoto(onLogged) {
  if (!hasApiKey()) {
    showToast("Dafür wird der Gemini-Schlüssel gebraucht — Profil → Zusatzfunktionen");
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.capture = "environment";
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (file) await auswertenUndZeigen(file, onLogged);
  });
  input.click();
}

async function auswertenUndZeigen(file, onLogged) {
  const overlay = document.createElement("div");
  overlay.className = "klar-sheet-overlay";
  overlay.innerHTML = `
    <div class="klar-sheet">
      <div class="klar-sheet-handle"></div>
      <div class="klar-sheet-title">Foto wird ausgewertet …</div>
      <div class="klar-sheet-sub">Das dauert ein paar Sekunden.</div>
    </div>
  `;
  document.body.appendChild(overlay);
  const schliessen = bindBackClose(() => overlay.remove());

  let ergebnis;
  try {
    ergebnis = await erkenneTellerFoto(file);
  } catch (err) {
    schliessen();
    showToast(describeAiError(err));
    return;
  }
  if (!ergebnis.posten.length) {
    schliessen();
    showToast("Auf dem Foto war keine Mahlzeit zu erkennen");
    return;
  }
  zeigePruefung(overlay, schliessen, ergebnis, file, onLogged);
}

/** Der Prüf-Schritt: alles noch änderbar, nichts ist bisher eingetragen. */
function zeigePruefung(overlay, schliessen, ergebnis, file, onLogged) {
  let posten = ergebnis.posten;
  let mahlzeit = suggestMeal();

  const zeichnen = () => {
    const s = summe(posten);
    overlay.innerHTML = `
      <div class="klar-sheet">
        <div class="klar-sheet-handle"></div>
        <div class="klar-sheet-title">Das sehe ich</div>
        <div class="klar-sheet-sub">${isViewingToday() ? "Eintrag für Heute" : `Eintrag für ${esc(dateLabel(getActiveDateKey()))}`}</div>

        <p class="hint" style="margin-top:10px">${esc(ergebnis.beschreibung)}</p>
        ${ergebnis.hinweis ? `<p class="hint" style="color:var(--warm)">⚠️ ${esc(ergebnis.hinweis)}</p>` : ""}

        <div id="tellerPosten" style="margin-top:12px"></div>

        <button type="button" class="btn ghost" id="tellerAdd" style="margin-top:6px">+ Posten ergänzen</button>

        <div class="klar-portion-panel gray" style="margin-top:14px">
          <div class="klar-portion-head">Summe</div>
          <div class="klar-portion-value">${Math.round(s.kcal)} kcal<span>${round1(s.netCarbs)} g Netto-KH · ${round1(s.fat)} g Fett · ${round1(s.protein)} g Eiweiß</span></div>
        </div>

        <p class="hint" style="margin-top:10px">Geschätzt aus dem Foto — Mengen bitte kurz prüfen.</p>

        <div class="klar-meal-select-head" style="margin-top:14px">
          <span class="klar-eyebrow">Mahlzeit</span>
        </div>
        <div class="klar-meal-segments">
          ${Object.keys(MEAL_LABELS).map(k => `
            <button type="button" class="klar-meal-segment ${k === mahlzeit ? "active" : ""}" data-meal="${k}">${esc(mealShort(k))}</button>
          `).join("")}
        </div>

        ${logButtonRowHtml("Eintragen", { cancelId: "tellerCancel", confirmId: "tellerOk", shareId: "tellerShare" })}
      </div>
    `;
    zeichnePosten();
    verdrahten();
  };

  const zeichnePosten = () => {
    const el = overlay.querySelector("#tellerPosten");
    el.innerHTML = posten.map(p => {
      const scale = (Number(p.grams) || 0) / 100;
      const kcal = p.per100.kcal != null ? Math.round(p.per100.kcal * scale) : "–";
      const kh = p.per100.carbs != null ? round1(p.per100.carbs * scale) : "–";
      return `
        <div class="klar-card" data-id="${p.id}" style="margin-bottom:8px;padding:10px 12px">
          <div style="display:flex;align-items:center;gap:8px">
            <input type="text" value="${esc(p.name)}" data-feld="name"
                   style="flex:1;min-width:0;font-weight:700" aria-label="Bezeichnung">
            <input type="number" value="${Number(p.grams) || 0}" data-feld="grams" inputmode="numeric"
                   style="width:72px;text-align:right" aria-label="Gramm">
            <span class="hint" style="margin:0">g</span>
            <button type="button" data-weg="1" title="Posten entfernen"
                    style="background:none;border:none;color:var(--red-fg);font-size:1rem;padding:2px 4px;cursor:pointer">✕</button>
          </div>
          <div class="hint" style="margin:6px 0 0">${kcal} kcal · ${kh} g Netto-KH</div>
          ${!p.sicher ? `<div class="hint" style="margin:6px 0 0">⚠️ unsicher erkannt — bitte bestätigen:</div>` : ""}
          ${p.alternativen.length ? `
            <div class="klar-meal-segments" style="margin-top:6px">
              ${p.alternativen.map(a => `
                <button type="button" class="klar-meal-segment ${p.sicher && a.toLowerCase() === p.name.toLowerCase() ? "active" : ""}" data-alt="${esc(a)}">${esc(a)}</button>
              `).join("")}
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    el.querySelectorAll("[data-id]").forEach(karte => {
      const p = posten.find(x => x.id === karte.dataset.id);
      if (!p) return;
      karte.querySelector('[data-feld="name"]').addEventListener("input", (e) => { p.name = e.target.value; });
      karte.querySelector('[data-feld="grams"]').addEventListener("input", (e) => {
        p.grams = Number(e.target.value) || 0;
        zeichnen(); // Summe und die Zeile mitziehen
      });
      karte.querySelector("[data-weg]").addEventListener("click", () => {
        posten = posten.filter(x => x.id !== p.id);
        if (posten.length === 0) { schliessen(); showToast("Nichts übrig — nichts eingetragen"); return; }
        zeichnen();
      });
      // Eine Alternative antippen ersetzt den Namen — der eigentliche Zweck der ganzen Übung.
      // Die Auswahl bleibt danach stehen (nicht ausblenden): wer danebentippt, muss den Namen
      // sonst von Hand schreiben, obwohl die richtige Fassung eben noch als Knopf dastand.
      karte.querySelectorAll("[data-alt]").forEach(btn => {
        btn.addEventListener("click", () => {
          p.name = btn.dataset.alt;
          p.sicher = true; // von Hand bestätigt
          zeichnen();
        });
      });
    });
  };

  const verdrahten = () => {
    overlay.querySelectorAll("[data-meal]").forEach(btn => {
      btn.addEventListener("click", () => { mahlzeit = btn.dataset.meal; zeichnen(); });
    });
    overlay.querySelector("#tellerCancel").addEventListener("click", schliessen);
    overlay.querySelector("#tellerAdd").addEventListener("click", () => {
      posten = [...posten, {
        id: crypto.randomUUID(), name: "", grams: 0, sicher: true, alternativen: [],
        per100: { kcal: null, carbs: null, fiber: null, sugars: null, fat: null, saturatedFat: null, protein: null, salt: null },
      }];
      zeichnen();
    });
    overlay.querySelector("#tellerOk").addEventListener("click", () => eintragen([]));
    overlay.querySelector("#tellerShare")?.addEventListener("click", async () => {
      eintragen(await askShareTargets());
    });
  };

  const eintragen = (weitereProfile) => {
    const brauchbar = posten.filter(p => p.name.trim() && Number(p.grams) > 0);
    if (brauchbar.length === 0) { showToast("Keine Posten mit Menge"); return; }

    const eintraege = [];
    for (const p of brauchbar) {
      const eintrag = logConsumption(
        { barcode: fotoBarcode(), name: p.name.trim(), per100: p.per100, servingSize: null, likelyUsLabel: false },
        p.grams,
        mahlzeit
      );
      if (eintrag) eintraege.push(eintrag);
      for (const pid of weitereProfile) if (eintrag) copyConsumptionTo(eintrag, [pid]);
    }
    schliessen();
    meldeEingetragen({
      titel: `${eintraege.length} Posten eingetragen`,
      untertitel: ergebnis.beschreibung,
      eintraege,
      onChange: onLogged,
    });
    onLogged?.();
  };

  zeichnen();
}
