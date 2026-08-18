// analysis.js — erzeugt einen kompakten Textbericht über das Ernährungsverhalten samt
// Analyse-Auftrag, den man in die Claude-App einfügen (oder direkt teilen) kann.
import { Store, dateKeyOf } from "./store.js";
import { getTargetsForDate, Goals } from "./profiles.js";
import { getConsumptionForDate, sumConsumption, MEAL_LABELS } from "./consumption.js";
import { esc, showToast, bindBackClose } from "./ui.js";

function round1(v) {
  return Math.round(v * 10) / 10;
}

/** Sammelt die Tagesdaten eines Profils für die letzten `days` Tage (ältester zuerst). */
function collectDays(profile, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dateKeyOf(Date.now() - i * 86400000);
    const entries = getConsumptionForDate(profile.id, key);
    out.push({ key, entries, totals: sumConsumption(entries), targets: getTargetsForDate(profile, key) });
  }
  return out;
}

/**
 * Baut den Berichtstext. Bewusst als Klartext (kein JSON): kompakt genug zum Einfügen und
 * für Menschen wie Modelle gleichermaßen lesbar. Enthält keine Namen — nur die für eine
 * Ernährungsanalyse nötigen Kennzahlen.
 */
export function buildAnalysisReport(profile, days) {
  const dayList = collectDays(profile, days);
  const withData = dayList.filter(d => d.entries.length > 0);
  const t = getTargetsForDate(profile, dateKeyOf(Date.now()));

  const lines = [];
  lines.push(`# Keto-Ernährungsdaten (letzte ${days} Tage)`);
  lines.push("");
  lines.push("## Profil und Tagesziele");
  lines.push(`- Geschlecht: ${profile.sex === "male" ? "männlich" : "weiblich"}, Alter: ${profile.age}`);
  lines.push(`- Größe: ${profile.heightCm} cm, Gewicht: ${profile.weightKg} kg${profile.bodyFatPct != null ? `, Körperfett: ${profile.bodyFatPct}%` : ""}`);
  lines.push(`- Ziel: ${Goals[profile.goal] || profile.goal}${profile.goal === "lose" ? ` (${profile.deficitPct}% Defizit)` : ""}`);
  lines.push(`- Ernährungsform: ${profile.dietType}`);
  lines.push(`- Tagesziele: ${t.kcal} kcal · ${t.netCarbG} g Netto-KH · ${t.fatG} g Fett · ${t.proteinG} g Eiweiß`);
  lines.push("");

  if (withData.length === 0) {
    lines.push("_Für diesen Zeitraum sind keine Einträge vorhanden._");
    return lines.join("\n");
  }

  // --- Tagesübersicht ---
  lines.push("## Tagesübersicht (Ist / Ziel)");
  for (const d of dayList) {
    if (d.entries.length === 0) {
      lines.push(`- ${d.key}: keine Einträge`);
      continue;
    }
    const s = d.totals;
    const inTarget = s.netCarbs <= d.targets.netCarbG ? "im Ziel" : "über Limit";
    lines.push(
      `- ${d.key}: ${Math.round(s.kcal)}/${d.targets.kcal} kcal · ` +
      `KH ${round1(s.netCarbs)}/${d.targets.netCarbG} g (${inTarget}) · ` +
      `Fett ${round1(s.fat)}/${d.targets.fatG} g · Eiweiß ${round1(s.protein)}/${d.targets.proteinG} g`
    );
  }
  lines.push("");

  // --- Kennzahlen ---
  const avg = (fn) => round1(withData.reduce((sum, d) => sum + fn(d), 0) / withData.length);
  const daysInTarget = withData.filter(d => d.totals.netCarbs <= d.targets.netCarbG).length;
  let streak = 0, maxStreak = 0;
  for (const d of dayList) {
    if (d.entries.length > 0 && d.totals.netCarbs <= d.targets.netCarbG) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }
  const avgKcal = avg(d => d.totals.kcal);
  const avgFat = avg(d => d.totals.fat);
  const avgProtein = avg(d => d.totals.protein);
  const avgCarbs = avg(d => d.totals.netCarbs);
  const energyFromMacros = avgFat * 9 + avgProtein * 4 + avgCarbs * 4;
  const pct = (kcalPart) => energyFromMacros > 0 ? Math.round((kcalPart / energyFromMacros) * 100) : 0;

  lines.push("## Kennzahlen");
  lines.push(`- Tage mit Einträgen: ${withData.length} von ${days}`);
  lines.push(`- Ø pro Tag: ${Math.round(avgKcal)} kcal · ${avgCarbs} g Netto-KH · ${avgFat} g Fett · ${avgProtein} g Eiweiß`);
  lines.push(`- Ø Makroverteilung: ${pct(avgFat * 9)}% Fett · ${pct(avgProtein * 4)}% Eiweiß · ${pct(avgCarbs * 4)}% Kohlenhydrate`);
  lines.push(`- Tage im Netto-KH-Ziel: ${daysInTarget} von ${withData.length}, längste Serie: ${maxStreak}`);
  lines.push("");

  // --- Lebensmittel ---
  const byFood = new Map();
  for (const d of withData) {
    for (const e of d.entries) {
      const cur = byFood.get(e.name) || { count: 0, kcal: 0, netCarbs: 0 };
      cur.count++;
      cur.kcal += e.kcal || 0;
      cur.netCarbs += e.netCarbs || 0;
      byFood.set(e.name, cur);
    }
  }
  const foods = [...byFood.entries()];

  lines.push("## Am häufigsten gegessen");
  for (const [name, v] of foods.sort((a, b) => b[1].count - a[1].count).slice(0, 15)) {
    lines.push(`- ${name}: ${v.count}× (gesamt ${Math.round(v.kcal)} kcal, ${round1(v.netCarbs)} g Netto-KH)`);
  }
  lines.push("");

  const carbSources = foods.filter(([, v]) => v.netCarbs > 0)
    .sort((a, b) => b[1].netCarbs - a[1].netCarbs).slice(0, 10);
  if (carbSources.length > 0) {
    lines.push("## Größte Kohlenhydrat-Quellen");
    for (const [name, v] of carbSources) {
      lines.push(`- ${name}: ${round1(v.netCarbs)} g Netto-KH über ${v.count} Portion(en)`);
    }
    lines.push("");
  }

  // --- Mahlzeiten ---
  const byMeal = new Map();
  for (const d of withData) {
    for (const e of d.entries) {
      const key = MEAL_LABELS[e.meal] ? e.meal : "none";
      const cur = byMeal.get(key) || { count: 0, kcal: 0 };
      cur.count++;
      cur.kcal += e.kcal || 0;
      byMeal.set(key, cur);
    }
  }
  lines.push("## Verteilung über die Mahlzeiten");
  for (const [key, v] of byMeal) {
    const label = key === "none" ? "Ohne Zuordnung" : MEAL_LABELS[key].replace(/^\S+\s/, "");
    lines.push(`- ${label}: ${v.count} Einträge, Ø ${Math.round(v.kcal / withData.length)} kcal/Tag`);
  }
  lines.push("");

  // --- Auftrag an Claude ---
  lines.push("---");
  lines.push("");
  lines.push("Bitte analysiere diese Daten als Ernährungsüberblick:");
  lines.push("");
  lines.push("1. **Ernährungsverhalten**: Wie konsequent wird die Keto-Ernährung umgesetzt? Wo gibt es Muster (z.B. bestimmte Wochentage, Mahlzeiten oder Lebensmittel, die aus dem Ziel führen)?");
  lines.push("2. **Verwendete Lebensmittel**: Bewerte die Auswahl — Abwechslung, Qualität der Fett- und Eiweißquellen, versteckte Kohlenhydrate, verarbeitete Produkte.");
  lines.push("3. **Mögliche Lücken**: Worauf deutet die Auswahl hin in Bezug auf Ballaststoffe, Mikronährstoffe (Magnesium, Kalium, Natrium) und Gemüseanteil?");
  lines.push("4. **Empfehlungen**: Konkrete, alltagstaugliche Vorschläge für eine ausgewogenere Keto-Ernährung — mit Beispielen für Lebensmittel oder Mahlzeiten, die die gefundenen Lücken schließen.");
  lines.push("");
  lines.push("_Hinweis: Die Werte stammen aus einer Tracking-App; Netto-Kohlenhydrate sind nach EU-Konvention angegeben (Ballaststoffe nicht enthalten)._");

  return lines.join("\n");
}

/** Dialog: Zeitraum wählen, Bericht erzeugen, kopieren oder teilen. */
export function openAnalysisModal() {
  const profile = Store.getActiveProfile();
  let days = 14;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">Mit Claude analysieren</h2>
      <p class="hint">Erzeugt einen Überblick über dein Ernährungsverhalten samt Analyse-Auftrag. Danach in die Claude-App einfügen.</p>
      <label>Zeitraum</label>
      <div class="btn-row" style="flex-wrap:wrap;gap:6px" id="periodChips">
        ${[7, 14, 30].map(d => `
          <button type="button" class="btn ${d === days ? "" : "secondary"} period-chip" data-days="${d}" style="width:auto;flex:none;padding:0 14px">${d} Tage</button>
        `).join("")}
      </div>
      <p class="hint" id="analysisPreview" style="margin-top:10px"></p>
      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn secondary" id="analysisCancel">Abbrechen</button>
        <button type="button" class="btn" id="analysisCopy">📋 Kopieren</button>
      </div>
      <button type="button" class="btn ghost" id="analysisShare" style="margin-top:8px;display:none">📤 Teilen</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const preview = overlay.querySelector("#analysisPreview");
  const updatePreview = () => {
    const report = buildAnalysisReport(profile, days);
    const dayCount = collectDays(profile, days).filter(d => d.entries.length > 0).length;
    preview.textContent = `${dayCount} Tage mit Einträgen · ca. ${Math.round(report.length / 100) / 10} KB Text`;
  };
  updatePreview();

  overlay.querySelectorAll(".period-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      overlay.querySelectorAll(".period-chip").forEach(c => c.classList.add("secondary"));
      chip.classList.remove("secondary");
      days = Number(chip.dataset.days);
      updatePreview();
    });
  });

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#analysisCancel").addEventListener("click", close);

  overlay.querySelector("#analysisCopy").addEventListener("click", async () => {
    const report = buildAnalysisReport(profile, days);
    try {
      await navigator.clipboard.writeText(report);
      showToast("Kopiert — jetzt in Claude einfügen");
      close();
    } catch {
      // Clipboard-API kann ohne HTTPS oder Nutzerfreigabe fehlschlagen: Text zum manuellen
      // Kopieren anzeigen, statt den Nutzer ohne Ergebnis stehen zu lassen.
      showFallbackText(overlay, report);
    }
  });

  // Teilen nur anbieten, wenn das Gerät Text teilen kann.
  const shareBtn = overlay.querySelector("#analysisShare");
  if (navigator.share) {
    shareBtn.style.display = "";
    shareBtn.addEventListener("click", async () => {
      try {
        await navigator.share({ text: buildAnalysisReport(profile, days), title: "Keto-Auswertung" });
        close();
      } catch (e) {
        if (e.name !== "AbortError") showToast("Teilen fehlgeschlagen — nutze stattdessen Kopieren");
      }
    });
  }
}

function showFallbackText(overlay, report) {
  const card = overlay.querySelector(".modal-card");
  card.innerHTML = `
    <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800">Text markieren und kopieren</h2>
    <p class="hint">Automatisches Kopieren wurde vom Browser blockiert.</p>
    <textarea readonly rows="10" style="width:100%;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);padding:10px;font:inherit;font-size:.8rem">${esc(report)}</textarea>
    <button type="button" class="btn" id="fallbackClose" style="margin-top:12px">Schließen</button>
  `;
  card.querySelector("textarea").select();
  card.querySelector("#fallbackClose").addEventListener("click", () => overlay.remove());
}
