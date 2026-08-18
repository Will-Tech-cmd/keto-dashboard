// views/profile.js — Profil-Tab: Körperdaten, Zielwert-Konfiguration, Export/Import.
import { Store } from "../store.js";
import { calcTargets, Goals, ActivityLevels } from "../profiles.js";
import { DIET_TYPES } from "../keto.js";
import { getApiKey, setApiKey, clearApiKey, testApiKey } from "../ai.js";
import { showToast, esc } from "../ui.js";

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
      <p class="hint">Exportiere eure Daten (Profile, Favoriten, Listen) als Datei, oder importiere sie auf dem anderen Handy.</p>
      <div class="btn-row" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn secondary" id="exportBtn">⬇️ Exportieren</button>
        <button class="btn secondary" id="importBtn">⬆️ Importieren</button>
        <button class="btn ghost" id="shareBtn" style="display:none">📤 Backup teilen</button>
      </div>
      <input type="file" id="importFile" accept=".json,.txt,application/json,text/plain" style="display:none">
    </div>

    <div class="card">
      <h2>Nur Rezepte teilen</h2>
      <p class="hint">Schickt nur die Rezepte (ohne Profile, Verlauf, Listen) — z.B. um ein einzelnes neues Rezept ans andere Handy zu schicken. Vorhandene Rezepte dort bleiben erhalten, gleiche Rezepte werden aktualisiert.</p>
      <div class="btn-row" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn secondary" id="exportRecipesBtn">⬇️ Exportieren</button>
        <button class="btn secondary" id="importRecipesBtn">⬆️ Importieren</button>
        <button class="btn ghost" id="shareRecipesBtn" style="display:none">📤 Teilen</button>
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

    <p class="hint" style="text-align:center;margin-top:8px">
      Richtwerte auf Basis gängiger Formeln (Mifflin-St Jeor / Katch-McArdle) — keine medizinische Beratung.
      Bei gesundheitlichen Fragen bitte ärztlichen Rat einholen.
    </p>
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

function wireExportImport(container) {
  container.querySelector("#exportBtn").addEventListener("click", () => {
    downloadBackup();
    showToast("Export gestartet");
  });

  // Teilen-Knopf bleibt immer sichtbar: kann das Gerät keine Dateien teilen, wird
  // stattdessen der Download ausgelöst, statt den Knopf kommentarlos zu verstecken.
  const shareBtn = container.querySelector("#shareBtn");
  shareBtn.style.display = "";
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
      Store.importJSON(text);
      showToast("Import erfolgreich");
      renderProfile(container, () => {});
    } catch (e) {
      showToast("Import fehlgeschlagen: " + e.message);
    }
    fileInput.value = "";
  });

  container.querySelector("#exportRecipesBtn").addEventListener("click", () => {
    downloadBlob(Store.exportRecipesJSON(), recipesFilename());
    showToast("Export gestartet");
  });

  const shareRecipesBtn = container.querySelector("#shareRecipesBtn");
  shareRecipesBtn.style.display = "";
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
