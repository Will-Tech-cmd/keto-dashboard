// views/profile.js — Profil-Tab: Körperdaten, Zielwert-Konfiguration, Export/Import.
import { Store } from "../store.js";
import { calcTargets, Goals, ActivityLevels } from "../profiles.js";
import { DIET_TYPES } from "../keto.js";
import { getApiKey, setApiKey, clearApiKey, testApiKey } from "../ai.js";
import { showToast, esc, applyDesignTheme, bindBackClose, getAppVersion } from "../ui.js";

const RING_STYLES = [
  { key: "rings", label: "Vier Ringe" },
  { key: "row", label: "Eine Reihe" },
  { key: "concentric", label: "Konzentrisch" },
];

export function renderProfile(container, onProfileChanged) {
  const state = Store.get();

  container.innerHTML = `
    <h1 class="section-title">Profil</h1>
    <div class="subtabs">
      ${state.profiles.map(p => `
        <button class="subtab-btn ${p.id === state.activeProfileId ? "active" : ""}" data-id="${p.id}" type="button">${esc(p.name)}</button>
      `).join("")}
    </div>
    <div id="profileForm"></div>

    <div class="divider"></div>
    <div class="card">
      <h2>Daten sichern</h2>
      <p class="hint">Exportiere eure Daten (Profile, Favoriten, Listen) als Datei, oder importiere sie auf dem anderen Handy. Beim Importieren fragt die App, ob zusammengeführt oder ersetzt werden soll.</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn secondary" id="importBtn">⬇️ Import</button>
        <button class="btn secondary" id="exportBtn">⬆️ Export</button>
        <button class="btn secondary" id="shareBtn">📤 Teilen</button>
      </div>
      <input type="file" id="importFile" accept=".json,.txt,application/json,text/plain" style="display:none">
      ${Store.hasPreMergeBackup() ? `
        <button class="btn ghost" id="restoreBtn" style="margin-top:8px">↩️ Letzten Import rückgängig machen</button>
      ` : ""}
    </div>

    <div class="card">
      <h2>Nur Rezepte teilen</h2>
      <p class="hint">Schickt nur die Rezepte (ohne Profile, Verlauf, Listen) — z.B. um ein einzelnes neues Rezept ans andere Handy zu schicken. Vorhandene Rezepte dort bleiben erhalten, gleiche Rezepte werden aktualisiert.</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn secondary" id="importRecipesBtn">⬇️ Import</button>
        <button class="btn secondary" id="exportRecipesBtn">⬆️ Export</button>
        <button class="btn secondary" id="shareRecipesBtn">📤 Teilen</button>
      </div>
      <input type="file" id="importRecipesFile" accept=".json,.txt,application/json,text/plain" style="display:none">
    </div>

    <div class="card">
      <h2>KI-Erkennung (optional)</h2>
      <p class="hint" style="margin-top:0">Mit einem eigenen, kostenlosen Gemini-API-Schlüssel kann der Rezept-Import schwierige Fälle (unbekannte Zutaten, schlecht lesbare Fotos) zusätzlich an eine KI schicken. Ohne Schlüssel funktioniert alles wie bisher — die KI-Knöpfe erscheinen dann einfach nicht.</p>
      <p class="hint">Schlüssel erstellen (kostenlos, keine Kreditkarte nötig): <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/app/apikey</a></p>
      <label for="aiKeyInput">Gemini-API-Schlüssel</label>
      <input type="password" id="aiKeyInput" placeholder="AIza…" value="${esc(getApiKey())}" autocomplete="off">
      <p class="hint" id="aiKeyStatus" style="margin-top:6px"></p>
      <div class="btn-row" style="margin-top:4px;flex-wrap:wrap">
        <button class="btn secondary" id="aiKeySaveBtn">Speichern</button>
        <button class="btn ghost" id="aiKeyTestBtn">Verbindung testen</button>
        <button class="btn ghost" id="aiKeyClearBtn" style="color:var(--red-fg)">Löschen</button>
      </div>
      <p class="hint" style="margin-top:10px">Der Schlüssel bleibt ausschließlich auf diesem Gerät gespeichert — er wird nicht exportiert oder mitgeteilt, wenn du dein Backup sicherst.</p>
    </div>

    <div class="card">
      <h2>Erscheinungsbild</h2>
      <p class="hint" style="margin-top:0">Gilt nur für dieses Profil — ${esc(otherProfileName())} kann es anders einstellen.</p>
      <div class="klar-appearance-row" style="margin-top:4px;padding-top:0;border-top:none">
        <div>
          <div class="klar-appearance-name">Dunkles Erscheinungsbild</div>
          <div class="klar-appearance-desc" id="appearanceDesc"></div>
        </div>
        <button type="button" class="klar-switch" id="appearanceSwitch" role="switch" aria-label="Dunkles Erscheinungsbild"></button>
      </div>
    </div>

    <div class="card">
      <h2>Nährwert-Diagramm</h2>
      <p class="hint" style="margin-top:0">Wie die vier Tageswerte auf der Startseite dargestellt werden — gilt nur für dieses Profil.</p>
      <div class="klar-meal-segments" id="ringStyleSegments" style="margin-top:10px">
        ${RING_STYLES.map(rs => `
          <button type="button" class="klar-meal-segment" data-style="${rs.key}">${esc(rs.label)}</button>
        `).join("")}
      </div>
    </div>

    <p class="hint" style="text-align:center;margin-top:8px">
      Richtwerte auf Basis gängiger Formeln (Mifflin-St Jeor / Katch-McArdle) — keine medizinische Beratung.
      Bei gesundheitlichen Fragen bitte ärztlichen Rat einholen.
    </p>
    <p class="hint" style="text-align:center" id="appVersion"></p>
  `;

  container.querySelectorAll(".subtab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      Store.setActiveProfile(btn.dataset.id);
      onProfileChanged?.();
      renderProfile(container, onProfileChanged);
    });
  });

  renderProfileForm(container, onProfileChanged);
  wireExportImport(container);
  wireAiKey(container);
  renderAppearanceCard(container, onProfileChanged);
  renderRingStyleCard(container, onProfileChanged);
  showAppVersion(container);
}

/** Zeigt, welchen Stand der Service Worker gerade ausliefert — nach einem Update sofort
 * erkennbar, ob die neue Fassung angekommen ist. */
function showAppVersion(container) {
  const el = container.querySelector("#appVersion");
  getAppVersion().then(version => {
    if (el.isConnected) el.textContent = version ? `Version ${version.replace("keto-dashboard-", "")}` : "";
  });
}

function otherProfileName() {
  const state = Store.get();
  return state.profiles.find(p => p.id !== state.activeProfileId)?.name || "das andere Profil";
}

/** Erscheinungsbild-Wahl je Profil. Wirkt sofort (Attribut am <body>), ohne Neuladen —
 * deshalb wird nach dem Umschalten nur neu gerendert. */
function renderAppearanceCard(container, onProfileChanged) {
  const profile = Store.getActiveProfile();
  const isDark = profile.appearance === "dark";
  const sw = container.querySelector("#appearanceSwitch");
  sw.classList.toggle("on", isDark);
  sw.setAttribute("aria-checked", String(isDark));
  container.querySelector("#appearanceDesc").textContent =
    profile.appearance === "system" ? "Folgt der Systemeinstellung" : isDark ? "Immer dunkel" : "Immer hell";

  sw.addEventListener("click", () => {
    // Beim ersten Antippen aus "system" heraus: auf das Gegenteil der aktuellen Systemanzeige
    // wechseln, damit der Schalter sichtbar etwas bewirkt.
    const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
    const next = profile.appearance === "system" ? (systemDark ? "light" : "dark")
      : profile.appearance === "dark" ? "light" : "dark";
    Store.updateProfile(profile.id, { appearance: next });
    applyDesignTheme();
    renderProfile(container, onProfileChanged);
  });
}

/** Wahl des Nährwert-Diagramms auf Start, je Profil — dieselbe Segment-Optik wie die
 * Mahlzeit-Auswahl im Eintragen-Sheet. */
function renderRingStyleCard(container, onProfileChanged) {
  const profile = Store.getActiveProfile();
  const wrap = container.querySelector("#ringStyleSegments");
  wrap.querySelectorAll(".klar-meal-segment").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.style === (profile.ringStyle || "rings"));
    btn.addEventListener("click", () => {
      Store.updateProfile(profile.id, { ringStyle: btn.dataset.style });
      onProfileChanged?.();
      renderProfile(container, onProfileChanged);
    });
  });
}

function wireAiKey(container) {
  const input = container.querySelector("#aiKeyInput");
  const status = container.querySelector("#aiKeyStatus");

  container.querySelector("#aiKeySaveBtn").addEventListener("click", () => {
    const key = input.value.trim();
    if (!key) { showToast("Bitte einen Schlüssel eingeben"); return; }
    setApiKey(key);
    status.textContent = "";
    showToast("Gespeichert — KI-Knöpfe erscheinen jetzt beim Rezept-Import");
  });

  container.querySelector("#aiKeyTestBtn").addEventListener("click", async () => {
    const key = input.value.trim();
    if (!key) { showToast("Bitte einen Schlüssel eingeben"); return; }
    status.textContent = "Prüfe Verbindung …";
    const result = await testApiKey(key);
    status.textContent = result.ok
      ? "✅ Verbindung erfolgreich" + (result.message ? ` — ${result.message}` : "")
      : `❌ ${result.message}`;
  });

  container.querySelector("#aiKeyClearBtn").addEventListener("click", () => {
    if (!getApiKey()) { showToast("Kein Schlüssel hinterlegt"); return; }
    if (!confirm("Gemini-API-Schlüssel von diesem Gerät löschen?")) return;
    clearApiKey();
    input.value = "";
    status.textContent = "";
    showToast("Schlüssel gelöscht");
  });
}

function renderProfileForm(container, onProfileChanged) {
  const profile = Store.getActiveProfile();
  const targets = calcTargets(profile);
  const formWrap = container.querySelector("#profileForm");

  formWrap.innerHTML = `
    <div class="card">
      <label>Name</label>
      <input type="text" id="fName" value="${esc(profile.name)}">

      <div class="field-row">
        <div>
          <label>Geschlecht</label>
          <select id="fSex">
            <option value="female" ${profile.sex === "female" ? "selected" : ""}>weiblich</option>
            <option value="male" ${profile.sex === "male" ? "selected" : ""}>männlich</option>
          </select>
        </div>
        <div><label>Alter</label><input type="number" id="fAge" value="${profile.age}"></div>
      </div>

      <div class="field-row">
        <div><label>Größe (cm)</label><input type="number" id="fHeight" value="${profile.heightCm}"></div>
        <div><label>Gewicht (kg)</label><input type="number" step="0.1" id="fWeight" value="${profile.weightKg}"></div>
      </div>

      <label>Körperfettanteil % (optional, für genauere Berechnung)</label>
      <input type="number" step="0.1" id="fBodyFat" value="${profile.bodyFatPct ?? ""}" placeholder="unbekannt">

      <label>Aktivitätslevel</label>
      <select id="fActivity">
        ${Object.entries(ActivityLevels).map(([val, label]) =>
          `<option value="${val}" ${Number(val) === profile.activity ? "selected" : ""}>${esc(label)}</option>`
        ).join("")}
      </select>

      <label>Ziel</label>
      <select id="fGoal">
        ${Object.entries(Goals).map(([val, label]) =>
          `<option value="${val}" ${val === profile.goal ? "selected" : ""}>${esc(label)}</option>`
        ).join("")}
      </select>

      <div id="deficitWrap" style="${profile.goal === "lose" ? "" : "display:none"}">
        <label>Kaloriendefizit %</label>
        <select id="fDeficit">
          ${[10, 15, 20, 25].map(v => `<option value="${v}" ${v === profile.deficitPct ? "selected" : ""}>${v}%</option>`).join("")}
        </select>
      </div>

      <div class="field-row">
        <div>
          <label>Netto-KH-Limit /Tag</label>
          <select id="fCarbLimit">
            ${[20, 30, 50, 75, 100, 130].map(v => `<option value="${v}" ${v === profile.netCarbLimitG ? "selected" : ""}>${v} g</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Eiweiß g/kg (fettfreie Masse)</label>
          <input type="number" step="0.1" id="fProteinFactor" value="${profile.proteinFactor}">
        </div>
      </div>

      <label>Trinkziel /Tag (ml)</label>
      <input type="number" step="100" min="0" id="fWaterTarget" value="${profile.waterTargetMl ?? 2500}">

      <div class="divider"></div>

      <label>Ernährungsform</label>
      <select id="fDietType">
        ${Object.entries(DIET_TYPES).map(([key, d]) =>
          `<option value="${key}" ${key === profile.dietType ? "selected" : ""}>${esc(d.label)}</option>`
        ).join("")}
      </select>
      <p class="hint" style="margin-top:-2px">Bestimmt die Vorschlagswerte für die Ampel unten (frei anpassbar).</p>

      <div class="field-row">
        <div>
          <label>Ampel grün bis (g Netto-KH/100g)</label>
          <input type="number" step="0.5" id="fGradeGreen" value="${profile.gradeThresholds.green}">
        </div>
        <div>
          <label>Ampel gelb bis (g Netto-KH/100g)</label>
          <input type="number" step="0.5" id="fGradeYellow" value="${profile.gradeThresholds.yellow}">
        </div>
      </div>
      <p class="hint" style="margin-top:-8px">Darüber gilt ein Produkt als rot/nicht empfohlen. Gilt für Scan, Suche und Rezepte.</p>

      <button class="btn" id="saveProfileBtn" style="margin-top:14px">Speichern</button>
    </div>

    <div class="card">
      <h2>Berechnete Ziele</h2>
      <div class="grid-2">
        <div class="stat"><div class="val">${targets.kcal}</div><div class="lbl">kcal/Tag</div></div>
        <div class="stat"><div class="val">${targets.netCarbG} g</div><div class="lbl">Netto-KH</div></div>
        <div class="stat"><div class="val">${targets.fatG} g</div><div class="lbl">Fett</div></div>
        <div class="stat"><div class="val">${targets.proteinG} g</div><div class="lbl">Eiweiß</div></div>
      </div>
      <p class="hint">Grundumsatz ${targets.bmr} kcal · Gesamtumsatz ${targets.tdee} kcal</p>
    </div>
  `;

  formWrap.querySelector("#fGoal").addEventListener("change", (e) => {
    formWrap.querySelector("#deficitWrap").style.display = e.target.value === "lose" ? "" : "none";
  });

  formWrap.querySelector("#fDietType").addEventListener("change", (e) => {
    const d = DIET_TYPES[e.target.value];
    if (!d) return;
    formWrap.querySelector("#fGradeGreen").value = d.defaultThresholds.green;
    formWrap.querySelector("#fGradeYellow").value = d.defaultThresholds.yellow;
  });

  formWrap.querySelector("#saveProfileBtn").addEventListener("click", () => {
    const val = (id) => formWrap.querySelector(id).value;
    const bodyFatRaw = val("#fBodyFat").trim();
    Store.updateProfile(profile.id, {
      name: val("#fName").trim() || profile.name,
      sex: val("#fSex"),
      age: parseInt(val("#fAge"), 10) || profile.age,
      heightCm: parseFloat(val("#fHeight")) || profile.heightCm,
      weightKg: parseFloat(val("#fWeight")) || profile.weightKg,
      bodyFatPct: bodyFatRaw ? parseFloat(bodyFatRaw) : null,
      activity: parseFloat(val("#fActivity")),
      goal: val("#fGoal"),
      deficitPct: parseInt(val("#fDeficit"), 10) || profile.deficitPct,
      netCarbLimitG: parseInt(val("#fCarbLimit"), 10),
      proteinFactor: parseFloat(val("#fProteinFactor")) || profile.proteinFactor,
      waterTargetMl: parseInt(val("#fWaterTarget"), 10) || profile.waterTargetMl,
      dietType: val("#fDietType"),
      gradeThresholds: {
        green: parseFloat(val("#fGradeGreen")) || profile.gradeThresholds.green,
        yellow: parseFloat(val("#fGradeYellow")) || profile.gradeThresholds.yellow,
      },
    });
    showToast("Profil gespeichert");
    onProfileChanged?.();
    renderProfileForm(container, onProfileChanged);
  });
}

// Chrome erlaubt beim Teilen nur eine Positivliste von Dateitypen (Audio, Bild, Text, Video)
// — application/json gehört NICHT dazu, weshalb canShare() dafür immer false liefert. Der
// Inhalt bleibt JSON, wir deklarieren ihn aber als Textdatei, damit das Teilen funktioniert.
const BACKUP_MIME = "text/plain";

function backupFilename(ext = "txt") {
  return `keto-dashboard-backup-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
function recipesFilename(ext = "txt") {
  return `keto-dashboard-rezepte-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function downloadBlob(text, filename) {
  const blob = new Blob([text], { type: BACKUP_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBackup() {
  downloadBlob(Store.exportJSON(), backupFilename());
}

// Lesbare Namen für die Profilfelder, die im Abgleich-Dialog als abweichend gemeldet werden.
const PROFILE_FIELD_LABELS = {
  name: "Name", sex: "Geschlecht", age: "Alter", heightCm: "Größe", weightKg: "Gewicht",
  bodyFatPct: "Körperfett", activity: "Aktivität", goal: "Ziel", deficitPct: "Kaloriendefizit",
  proteinFactor: "Eiweißfaktor", netCarbLimitG: "Netto-KH-Limit", dietType: "Ernährungsform",
  gradeThresholds: "Ampelgrenzen", waterTargetMl: "Trinkziel", appearance: "Erscheinungsbild",
  ringStyle: "Nährwert-Diagramm",
};
const fieldLabel = (k) => PROFILE_FIELD_LABELS[k] || k;

const RING_STYLE_LABELS = { rings: "Vier Ringe", row: "Eine Reihe", concentric: "Konzentrisch" };
const APPEARANCE_LABELS = { system: "Systemeinstellung", light: "Hell", dark: "Dunkel" };

/** Menschlich lesbarer Wert für ein Profilfeld — für die Vergleichstabelle beim Backup-Import. */
function formatFieldValue(key, value) {
  if (value == null) return "–";
  switch (key) {
    case "sex": return value === "male" ? "männlich" : "weiblich";
    case "goal": return Goals[value] || value;
    case "activity": return ActivityLevels[value] || value;
    case "dietType": return DIET_TYPES[value]?.label || value;
    case "appearance": return APPEARANCE_LABELS[value] || value;
    case "ringStyle": return RING_STYLE_LABELS[value] || value;
    case "heightCm": return `${value} cm`;
    case "weightKg": return `${value} kg`;
    case "age": return `${value} Jahre`;
    case "bodyFatPct": return `${value}%`;
    case "deficitPct": return `${value}%`;
    case "proteinFactor": return `${value} g/kg`;
    case "netCarbLimitG": return `${value} g`;
    case "waterTargetMl": return `${value} ml`;
    case "gradeThresholds": return `grün bis ${value.green}, gelb bis ${value.yellow} g`;
    default: return String(value);
  }
}

/**
 * Zeigt vor dem Einspielen eines Vollbackups, was genau passieren würde, und lässt die Wahl
 * zwischen Zusammenführen (nichts geht verloren) und Ersetzen. Die Zahlen kommen aus
 * Store.previewMerge(), sind also echt gerechnet und keine allgemeine Warnung.
 */
function openMergeDialog(container, json, fileInfo = {}) {
  let incoming;
  try {
    incoming = Store.parseBackup(json);
  } catch (e) {
    showToast("Import fehlgeschlagen: " + e.message);
    return;
  }
  const p = Store.previewMerge(incoming);
  // Vorauswahl: die eigenen Einstellungen behalten. Wer sein Profil auf dem anderen Gerät
  // gepflegt hat, stellt hier gezielt auf "Datei" um.
  const profileChoice = {};
  p.profileDiffs.forEach(d => { profileChoice[d.id] = "local"; });
  let mode = "merge"; // "merge" | "replace"

  // Herkunft: das Profil, das auf dem exportierenden Gerät aktiv war — beim Export ist das so
  // gut wie immer die Person, der das Backup gehört.
  const sourceProfile = incoming.profiles?.find(pr => pr.id === incoming.activeProfileId);
  const sourceLine = [
    sourceProfile ? `Von ${esc(sourceProfile.name)}` : null,
    fileInfo.lastModified ? new Date(fileInfo.lastModified).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null,
    fileInfo.size ? `${Math.round(fileInfo.size / 1024)} KB` : null,
  ].filter(Boolean).join(" · ");

  const lost = [
    [p.losesOnReplace.consumption, "Tageseinträge"], [p.losesOnReplace.recipes, "Rezepte"],
    [p.losesOnReplace.favorites, "Favoriten"], [p.losesOnReplace.shoppingList, "Einkaufsartikel"],
  ].filter(([n]) => n > 0);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">Backup einspielen</h2>
      ${sourceLine ? `<p class="hint" style="margin-top:0">${sourceLine}</p>` : ""}

      <div class="klar-eyebrow" style="margin:10px 2px 8px">Kommt dazu</div>
      <div class="klar-tile-grid">
        <div class="klar-tile"><div class="val">${p.consumption}</div><div class="lbl">Tage</div></div>
        <div class="klar-tile"><div class="val">${p.recipes}</div><div class="lbl">Rezepte</div></div>
        <div class="klar-tile"><div class="val">${p.favorites}</div><div class="lbl">Favoriten</div></div>
        <div class="klar-tile"><div class="val">${p.shoppingList}</div><div class="lbl">Einkauf</div></div>
      </div>
      ${p.recipesUpdated > 0 ? `<p class="hint">${p.recipesUpdated} Rezept(e) werden aktualisiert.</p>` : ""}
      ${p.recipeNameClashes.length ? `
        <p class="hint" style="color:var(--warm)">⚠️ Gleicher Name, getrennt angelegt — kommt zusätzlich in die Liste:
        ${esc(p.recipeNameClashes.join(", "))}</p>` : ""}

      <div class="divider"></div>
      <p class="hint" style="margin-top:0">Wie soll eingespielt werden?</p>
      <label class="klar-choice-card active" data-mode="merge">
        <input type="radio" name="mergeMode" value="merge" checked style="display:none">
        <span class="klar-choice-mark">✓</span>
        <span class="klar-choice-body">
          <span class="klar-choice-title">Zusammenführen</span>
          <span class="klar-choice-sub">Nichts geht verloren — beide Stände werden vereinigt.</span>
        </span>
      </label>
      <label class="klar-choice-card" data-mode="replace">
        <input type="radio" name="mergeMode" value="replace" style="display:none">
        <span class="klar-choice-mark">✓</span>
        <span class="klar-choice-body">
          <span class="klar-choice-title">Datei gewinnt</span>
          <span class="klar-choice-sub">${lost.length
            ? `Löscht ${lost.map(([n, l]) => `${n} ${l}`).join(", ")}, die es nur hier gibt.`
            : "Auf diesem Gerät gibt es nichts, was die Datei nicht hätte."}</span>
        </span>
      </label>

      ${p.profileDiffs.length ? `
        <div class="divider"></div>
        ${p.profileDiffs.map(d => `
          <div style="margin-top:4px">
            <div style="font-weight:700;font-size:.9rem">Profil ${esc(d.name)} — welche Werte gelten?</div>
            <div class="klar-diff-table">
              <div class="klar-diff-row klar-diff-head">
                <span>Abweichend</span><span>Hier</span><span>Datei</span>
              </div>
              ${d.fields.map(f => `
                <div class="klar-diff-row">
                  <span>${esc(fieldLabel(f))}</span>
                  <span>${esc(formatFieldValue(f, d.local[f]))}</span>
                  <span>${esc(formatFieldValue(f, d.file[f]))}</span>
                </div>
              `).join("")}
            </div>
            <div class="btn-row" style="margin-top:8px">
              <button type="button" class="btn secondary profile-choice active" data-id="${d.id}" data-choice="local">Dieses Gerät</button>
              <button type="button" class="btn secondary profile-choice" data-id="${d.id}" data-choice="file">Datei</button>
            </div>
          </div>
        `).join("")}
      ` : ""}

      <div class="btn-row" style="margin-top:18px">
        <button type="button" class="btn secondary" id="mergeCancel">Abbrechen</button>
        <button type="button" class="btn" id="mergeConfirm">Zusammenführen</button>
      </div>
      <p class="hint" style="text-align:center;margin-top:8px">Der Stand von jetzt wird vorher gesichert — im Profil unter „Letzten Import rückgängig machen".</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#mergeCancel").addEventListener("click", close);

  const confirmBtn = overlay.querySelector("#mergeConfirm");
  overlay.querySelectorAll(".klar-choice-card").forEach(card => {
    card.addEventListener("click", () => {
      mode = card.dataset.mode;
      overlay.querySelectorAll(".klar-choice-card").forEach(c => c.classList.toggle("active", c === card));
      confirmBtn.textContent = mode === "replace" ? "Ersetzen" : "Zusammenführen";
      confirmBtn.classList.toggle("danger-ish", mode === "replace");
    });
  });

  overlay.querySelectorAll(".profile-choice").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      profileChoice[btn.dataset.id] = btn.dataset.choice;
      overlay.querySelectorAll(`.profile-choice[data-id="${btn.dataset.id}"]`)
        .forEach(b => b.classList.toggle("active", b === btn));
    });
  });

  const finish = (msg) => {
    close();
    showToast(msg);
    renderProfile(container, () => {});
  };

  confirmBtn.addEventListener("click", () => {
    if (mode === "replace") {
      if (!confirm("Wirklich ersetzen? Alles auf diesem Gerät, was nicht in der Datei steht, geht verloren.")) return;
      try {
        Store.importJSON(json);
        finish("Ersetzt");
      } catch (e) {
        showToast("Import fehlgeschlagen: " + e.message);
      }
      return;
    }
    try {
      Store.mergeJSON(json, { profileChoice });
      finish("Zusammengeführt");
    } catch (e) {
      showToast("Zusammenführen fehlgeschlagen: " + e.message);
    }
  });
}

function wireExportImport(container) {
  container.querySelector("#exportBtn").addEventListener("click", () => {
    downloadBackup();
    showToast("Export gestartet");
  });

  // Teilen-Knopf bleibt immer sichtbar: kann das Gerät keine Dateien teilen, wird
  // stattdessen der Download ausgelöst, statt den Knopf kommentarlos zu verstecken.
  const shareBtn = container.querySelector("#shareBtn");
  shareBtn.addEventListener("click", async () => {
    const file = new File([Store.exportJSON()], backupFilename(), { type: BACKUP_MIME });
    if (!navigator.canShare?.({ files: [file] })) {
      downloadBackup();
      showToast("Teilen wird hier nicht unterstützt — Datei wurde gespeichert");
      return;
    }
    try {
      await navigator.share({ files: [file], title: "Keto-Dashboard Backup" });
    } catch (e) {
      if (e.name === "AbortError") return;
      downloadBackup();
      showToast("Teilen fehlgeschlagen — Datei wurde stattdessen gespeichert");
    }
  });

  const fileInput = container.querySelector("#importFile");
  container.querySelector("#importBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      // Nicht mehr sofort ersetzen: erst zeigen, was passieren würde. Ein Vollbackup vom
      // anderen Handy enthält dessen kompletten Stand — blind einspielen löscht den eigenen.
      openMergeDialog(container, text, { size: file.size, lastModified: file.lastModified });
    } catch (e) {
      showToast("Import fehlgeschlagen: " + e.message);
    }
    fileInput.value = "";
  });

  container.querySelector("#restoreBtn")?.addEventListener("click", () => {
    const info = Store.getPreMergeInfo();
    const when = info ? new Date(info.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "";
    if (!confirm(`Stand von vor dem letzten Import (${when}) wiederherstellen? Alles, was seitdem dazugekommen ist, geht verloren.`)) return;
    Store.restorePreMergeBackup();
    showToast("Stand wiederhergestellt");
    renderProfile(container, () => {});
  });

  container.querySelector("#exportRecipesBtn").addEventListener("click", () => {
    downloadBlob(Store.exportRecipesJSON(), recipesFilename());
    showToast("Export gestartet");
  });

  const shareRecipesBtn = container.querySelector("#shareRecipesBtn");
  shareRecipesBtn.addEventListener("click", async () => {
    const file = new File([Store.exportRecipesJSON()], recipesFilename(), { type: BACKUP_MIME });
    if (!navigator.canShare?.({ files: [file] })) {
      downloadBlob(Store.exportRecipesJSON(), recipesFilename());
      showToast("Teilen wird hier nicht unterstützt — Datei wurde gespeichert");
      return;
    }
    try {
      await navigator.share({ files: [file], title: "Keto-Dashboard Rezepte" });
    } catch (e) {
      if (e.name === "AbortError") return;
      downloadBlob(Store.exportRecipesJSON(), recipesFilename());
      showToast("Teilen fehlgeschlagen — Datei wurde stattdessen gespeichert");
    }
  });

  const recipesFileInput = container.querySelector("#importRecipesFile");
  container.querySelector("#importRecipesBtn").addEventListener("click", () => recipesFileInput.click());
  recipesFileInput.addEventListener("change", async () => {
    const file = recipesFileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { added, updated } = Store.importRecipesJSON(text);
      showToast(`${added} neu, ${updated} aktualisiert`);
    } catch (e) {
      showToast("Import fehlgeschlagen: " + e.message);
    }
    recipesFileInput.value = "";
  });
}
