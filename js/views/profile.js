// views/profile.js — Profil-Tab: Körperdaten, Zielwert-Konfiguration, Export/Import.
import { Store, istZeilenModus, wechsleModus } from "../store.js";
import { calcTargets, Goals, ActivityLevels } from "../profiles.js";
import { DIET_TYPES } from "../keto.js";
import { getApiKey, setApiKey, clearApiKey, testApiKey } from "../ai.js";
import { showToast, esc, applyDesignTheme, bindBackClose, keepActionsInView, getAppVersion } from "../ui.js";
import { isSyncEnabled, needsReauth, enableSync, disableSync, syncNow, getLastSyncAt, SyncAuthError } from "../sync.js";

const RING_STYLES = [
  { key: "rings", label: "Vier Ringe" },
  { key: "row", label: "Eine Reihe" },
  { key: "concentric", label: "Konzentrisch" },
];

export function renderProfile(container, onProfileChanged) {
  const state = Store.get();
  const syncOn = isSyncEnabled();
  const syncReauth = needsReauth();
  const syncLastAt = getLastSyncAt();
  const zeilen = istZeilenModus();

  container.innerHTML = `
    <h1 class="section-title">Profil</h1>
    <div class="subtabs">
      ${state.profiles.map(p => state.profiles.length > 2 ? `
        <span style="display:inline-flex;align-items:center">
          <button class="subtab-btn ${p.id === state.activeProfileId ? "active" : ""}" data-id="${p.id}" type="button">${esc(p.name)}</button>
          ${p.id !== state.activeProfileId ? `<button type="button" data-delete-profile="${p.id}" title="Profil löschen" style="background:none;border:none;color:var(--red-fg);font-size:.85rem;padding:2px 6px;cursor:pointer">✕</button>` : ""}
        </span>
      ` : `
        <button class="subtab-btn ${p.id === state.activeProfileId ? "active" : ""}" data-id="${p.id}" type="button">${esc(p.name)}</button>
      `).join("")}
    </div>
    ${state.profiles.length > 2 ? `<p class="hint" style="margin-top:4px">Mehr als zwei Profile — meist durch einen ersten Sync-Abgleich zweier bereits eingerichteter Geräte entstanden. Überzählige mit ✕ entfernen.</p>` : ""}
    <div id="profileForm"></div>

    <div class="divider"></div>
    <div class="klar-eyebrow" style="margin:0 2px 8px">Zwei Handys abgleichen</div>
    <div class="klar-card">
      <p class="hint" style="margin-top:0">Beim Einspielen zeigt die App erst, was dazukommt — und fragt, ob zusammengeführt oder ersetzt wird.</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" id="shareBtn">📤 Alles teilen</button>
        <button class="btn secondary" id="importBtn">⬇️ Einspielen</button>
      </div>
      <!-- application/octet-stream muss mit rein: über WhatsApp & Co. weitergereichte Backups
           kommen häufig mit diesem Typ an und wären sonst im Dateidialog ausgegraut. Der
           Filter darf aber nicht ganz entfallen — ohne accept bietet Android zusätzlich
           Kamera und Video an, und die helfen hier niemandem. Kein image/* oder video/* in
           der Liste heißt: reiner Dateidialog. Ob die Datei taugt, entscheidet ohnehin
           Store.parseBackup(). -->
      <input type="file" id="importFile" accept=".txt,.json,text/plain,application/json,application/octet-stream" style="display:none">
    </div>

    <div class="klar-list-card" style="margin-top:10px">
      <div class="list-item" id="recipesOnlyRow" style="cursor:pointer">
        <div class="info"><div class="name">Nur Rezepte</div><div class="meta">Teilen, einspielen · Profile bleiben unberührt</div></div>
        <span class="chevron">›</span>
      </div>
      <div class="list-item" id="exportOnlyRow" style="cursor:pointer">
        <div class="info"><div class="name">Als Datei sichern</div><div class="meta">Export ohne Teilen-Dialog</div></div>
        <span class="chevron">›</span>
      </div>
      ${Store.hasPreMergeBackup() ? `
        <div class="list-item" id="restoreRow" style="cursor:pointer">
          <div class="info"><div class="name">Letzten Import rückgängig machen</div><div class="meta">Stand vom ${esc(new Date(Store.getPreMergeInfo()?.at || Date.now()).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }))}</div></div>
          <span class="chevron">›</span>
        </div>
      ` : ""}
    </div>

    <div class="card">
      <h2>Online-Synchronisierung (optional)</h2>
      <p class="hint" style="margin-top:0">Mit dem Kochbuch-Zugangswort gleicht die App alle Daten automatisch zwischen euren Geräten ab — wie das manuelle Einspielen oben, nur automatisch über das Netz statt per Datei. Ohne Aktivierung bleibt hier alles ausschließlich auf diesem Gerät, wie bisher.</p>
      ${syncOn && !syncReauth ? `
        <p class="hint">Status: ✅ aktiv · zuletzt synchronisiert: ${esc(syncLastAt ? new Date(syncLastAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nie")}</p>
        <p class="hint" id="syncStatus" style="margin-top:0;min-height:1.2em"></p>
        <div class="btn-row" style="margin-top:4px;flex-wrap:wrap">
          <button class="btn secondary" id="syncNowBtn">Jetzt synchronisieren</button>
          <button class="btn ghost" id="syncOffBtn" style="color:var(--red-fg)">Deaktivieren</button>
        </div>
      ` : `
        ${syncReauth ? `<p class="hint" style="color:var(--red-fg)">Anmeldung abgelaufen — bitte Zugangswort erneut eingeben.</p>` : ""}
        <label for="syncPwInput">Zugangswort</label>
        <input type="password" id="syncPwInput" autocomplete="current-password" placeholder="Gemeinsames Zugangswort">
        <p class="hint" id="syncStatus" style="margin-top:0;min-height:1.2em"></p>
        <div class="btn-row" style="margin-top:4px;flex-wrap:wrap">
          <button class="btn secondary" id="syncOnBtn">${syncReauth ? "Erneut anmelden" : "Aktivieren"}</button>
          ${syncReauth ? `<button class="btn ghost" id="syncOffBtn" style="color:var(--red-fg)">Deaktivieren</button>` : ""}
        </div>
      `}
    </div>

    <div class="card">
      <h2>Neuer Speicher (Test)</h2>
      <p class="hint" style="margin-top:0">Der neue Weg legt jede Mahlzeit, jedes Rezept und jeden Listeneintrag einzeln ab statt alles zusammen in einem Block, und gleicht auch einzeln ab. Damit kann eine Änderung auf einem Gerät keine auf dem anderen mehr überschreiben — genau das war die Ursache der bisherigen Datenverluste.</p>
      <p class="hint">Zum Ausprobieren gedacht. Umschalten geht in beide Richtungen und nimmt den aktuellen Stand jeweils mit; auf dem Gerät selbst geht dabei nichts verloren. <strong>Der Schalter gehört auf alle Geräte:</strong> solange ein Gerät noch den alten Weg benutzt, sehen die beiden voneinander nichts Neues mehr.</p>
      <p class="hint" style="color:var(--red-fg)"><strong>Noch nicht fertig:</strong> Rezept<em>zutaten</em> wandern auf diesem Weg noch nicht mit. Ein Rezept, das auf einem Gerät neu entsteht, kommt auf dem anderen ohne Zutatenliste an — auf dem Gerät, auf dem es angelegt wurde, bleibt es vollständig. Solange das so ist: zum Anschauen und Messen ja, zum Rezepte-Anlegen auf zwei Geräten noch nicht.</p>
      <p class="hint">Status: ${zeilen ? "✅ neuer Speicher aktiv" : "bisheriger Speicher"}</p>
      <p class="hint" id="zeilenStatus" style="margin-top:0;min-height:1.2em"></p>
      <div class="btn-row" style="margin-top:4px;flex-wrap:wrap">
        <button class="btn secondary" id="zeilenBtn">${zeilen ? "Zurück auf den bisherigen Speicher" : "Neuen Speicher einschalten"}</button>
      </div>
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

  container.querySelectorAll("[data-delete-profile]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteProfile;
      const name = state.profiles.find(p => p.id === id)?.name || "dieses Profil";
      if (!confirm(`„${name}" wirklich löschen? Das lässt sich nicht rückgängig machen.`)) return;
      if (Store.deleteProfile(id)) {
        showToast("Profil gelöscht");
        onProfileChanged?.();
        renderProfile(container, onProfileChanged);
      } else {
        showToast("Konnte nicht gelöscht werden");
      }
    });
  });

  renderProfileForm(container, onProfileChanged);
  wireExportImport(container);
  wireSyncCard(container, onProfileChanged);
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

function wireSyncCard(container, onProfileChanged) {
  const status = container.querySelector("#syncStatus");
  const pwInput = container.querySelector("#syncPwInput");

  container.querySelector("#syncOnBtn")?.addEventListener("click", async (e) => {
    const password = pwInput.value;
    if (!password) { showToast("Bitte das Zugangswort eingeben"); return; }
    e.target.disabled = true;
    status.textContent = "Verbinde …";
    try {
      await enableSync(password);
      showToast("Synchronisierung aktiviert");
      renderProfile(container, onProfileChanged);
    } catch (err) {
      status.textContent = err.message || "Verbindung fehlgeschlagen";
      e.target.disabled = false;
    }
  });

  container.querySelector("#syncNowBtn")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    status.textContent = "Synchronisiert …";
    try {
      await syncNow();
      showToast("Synchronisiert");
      renderProfile(container, onProfileChanged);
    } catch (err) {
      if (err instanceof SyncAuthError) {
        renderProfile(container, onProfileChanged);
      } else {
        status.textContent = err.message || "Synchronisierung fehlgeschlagen — offline?";
        e.target.disabled = false;
      }
    }
  });

  container.querySelector("#syncOffBtn")?.addEventListener("click", () => {
    if (!confirm("Synchronisierung deaktivieren? Die Daten bleiben auf diesem Gerät erhalten.")) return;
    disableSync();
    showToast("Synchronisierung deaktiviert");
    renderProfile(container, onProfileChanged);
  });

  // Speicherweg umschalten. Danach wird neu geladen: der laufende Zustand hängt an
  // Modulvariablen in store.js, die sich nicht mittendrin umstellen lassen.
  container.querySelector("#zeilenBtn")?.addEventListener("click", async (e) => {
    const an = !istZeilenModus();
    const frage = an
      ? "Auf den neuen Speicher umstellen? Der aktuelle Stand wird übernommen, die App lädt danach neu."
      : "Zurück auf den bisherigen Speicher? Der aktuelle Stand wird übernommen, die App lädt danach neu.";
    if (!confirm(frage)) return;
    const knopf = e.currentTarget;
    const zeilenStatus = container.querySelector("#zeilenStatus");
    knopf.disabled = true;
    zeilenStatus.textContent = "Wird umgestellt …";
    try {
      await wechsleModus(an);
      location.reload();
    } catch (err) {
      knopf.disabled = false;
      zeilenStatus.textContent = err?.message || "Umstellen fehlgeschlagen.";
    }
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

const SHORT_ACTIVITY_LABELS = { 1.2: "kaum aktiv", 1.375: "leicht aktiv", 1.55: "mäßig aktiv", 1.725: "sehr aktiv" };

/** Zielwerte oben als Ergebniskarte (wie im Rezept-Editor), Körperdaten darunter als vier
 * Zeilen mit ihrem aktuellen Stand — jede öffnet ein kleines Sheet statt eines 14-Felder-
 * Formulars. Jedes Sheet speichert bei jeder Änderung sofort (Store.updateProfile), die
 * Zielkarte und die Zeile selbst aktualisieren sich live mit — kein "Speichern"-Knopf nötig.
 */
function renderProfileForm(container, onProfileChanged) {
  const profile = Store.getActiveProfile();
  const formWrap = container.querySelector("#profileForm");

  const groups = () => {
    const p = Store.getActiveProfile();
    return [
      { key: "body", title: "Körperdaten",
        sub: `${p.sex === "male" ? "m" : "w"} · ${p.age} J · ${p.heightCm} cm · ${p.weightKg} kg${p.bodyFatPct ? ` · ${p.bodyFatPct}% KF` : ""}` },
      { key: "goal", title: "Ziel & Aktivität",
        sub: `${Goals[p.goal]}${p.goal === "lose" ? `, ${p.deficitPct}% Defizit` : ""} · ${SHORT_ACTIVITY_LABELS[p.activity] || ActivityLevels[p.activity]}` },
      { key: "diet", title: "Ernährungsform",
        sub: `${DIET_TYPES[p.dietType]?.label || p.dietType} · Ampel grün bis ${p.gradeThresholds.green} g, gelb bis ${p.gradeThresholds.yellow} g` },
      { key: "limits", title: "Grenzwerte",
        sub: `${p.netCarbLimitG} g KH · ${p.proteinFactor} g Eiweiß/kg · ${p.waterTargetMl ?? 2500} ml Wasser` },
    ];
  };

  formWrap.innerHTML = `
    <div class="card">
      <label>Name</label>
      <input type="text" id="fName" value="${esc(profile.name)}">
    </div>

    <div class="klar-result-card" id="profileTargetsCard"></div>

    <div class="klar-eyebrow" style="margin:16px 2px 8px">Woraus sich das ergibt</div>
    <div class="klar-list-card" id="profileGroups"></div>
  `;

  formWrap.querySelector("#fName").addEventListener("change", (e) => {
    Store.updateProfile(profile.id, { name: e.target.value.trim() || profile.name });
    onProfileChanged?.();
  });

  const renderTargetsCard = () => {
    const p = Store.getActiveProfile();
    const t = calcTargets(p);
    formWrap.querySelector("#profileTargetsCard").innerHTML = `
      <div class="klar-result-head">
        <span class="klar-result-eyebrow">Deine Tagesziele</span>
        <span class="klar-result-badge gray">${esc(DIET_TYPES[p.dietType]?.label || p.dietType)}</span>
      </div>
      <div class="klar-tile-grid" style="margin-top:10px">
        <div class="klar-tile"><div class="val">${t.kcal}</div><div class="lbl">kcal</div></div>
        <div class="klar-tile"><div class="val">${t.netCarbG}</div><div class="lbl">g Netto-KH</div></div>
        <div class="klar-tile"><div class="val">${t.fatG}</div><div class="lbl">g Fett</div></div>
        <div class="klar-tile"><div class="val">${t.proteinG}</div><div class="lbl">g Eiweiß</div></div>
      </div>
      <div class="klar-result-total">Grundumsatz ${t.bmr} kcal · Gesamtumsatz ${t.tdee} kcal${p.goal === "lose" ? ` · ${p.deficitPct}% Defizit` : ""}</div>
    `;
  };

  const renderGroups = () => {
    const list = formWrap.querySelector("#profileGroups");
    list.innerHTML = groups().map(g => `
      <div class="list-item" data-group="${g.key}" style="cursor:pointer">
        <div class="info">
          <div class="name">${esc(g.title)}</div>
          <div class="meta">${esc(g.sub)}</div>
        </div>
        <span class="chevron">›</span>
      </div>
    `).join("");
    list.querySelectorAll(".list-item").forEach(row => {
      row.addEventListener("click", () => openGroupSheet(row.dataset.group, refresh));
    });
  };

  // Nach jeder Änderung in einem Sheet aufgerufen — hält Zielkarte und Zeilen aktuell, ohne
  // das offene Sheet selbst neu zu zeichnen.
  const refresh = () => { renderTargetsCard(); renderGroups(); };
  refresh();
}

/** Kleines Feld-Sheet für eine der vier Körperdaten-Gruppen. `onChanged` aktualisiert die
 * Zielkarte/Zeilen im Hintergrund, während das Sheet offen bleibt. */
function openGroupSheet(key, onChanged) {
  const profile = Store.getActiveProfile();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const bodyHtml = {
    body: `
      <div class="field-row">
        <div><label>Geschlecht</label>
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
    `,
    goal: `
      <label>Ziel</label>
      <select id="fGoal">
        ${Object.entries(Goals).map(([val, label]) => `<option value="${val}" ${val === profile.goal ? "selected" : ""}>${esc(label)}</option>`).join("")}
      </select>
      <div id="deficitWrap" style="${profile.goal === "lose" ? "" : "display:none"}">
        <label>Kaloriendefizit %</label>
        <select id="fDeficit">
          ${[10, 15, 20, 25].map(v => `<option value="${v}" ${v === profile.deficitPct ? "selected" : ""}>${v}%</option>`).join("")}
        </select>
      </div>
      <label>Aktivitätslevel</label>
      <select id="fActivity">
        ${Object.entries(ActivityLevels).map(([val, label]) => `<option value="${val}" ${Number(val) === profile.activity ? "selected" : ""}>${esc(label)}</option>`).join("")}
      </select>
    `,
    diet: `
      <label>Ernährungsform</label>
      <select id="fDietType">
        ${Object.entries(DIET_TYPES).map(([k, d]) => `<option value="${k}" ${k === profile.dietType ? "selected" : ""}>${esc(d.label)}</option>`).join("")}
      </select>
      <p class="hint" style="margin-top:-2px">Bestimmt die Vorschlagswerte für die Ampel (frei anpassbar).</p>
      <div class="field-row">
        <div><label>Ampel grün bis (g Netto-KH/100g)</label><input type="number" step="0.5" id="fGradeGreen" value="${profile.gradeThresholds.green}"></div>
        <div><label>Ampel gelb bis (g Netto-KH/100g)</label><input type="number" step="0.5" id="fGradeYellow" value="${profile.gradeThresholds.yellow}"></div>
      </div>
      <p class="hint" style="margin-top:-8px">Darüber gilt ein Produkt als rot/nicht empfohlen.</p>
    `,
    limits: `
      <div class="field-row">
        <div><label>Netto-KH-Limit /Tag</label>
          <select id="fCarbLimit">
            ${[20, 30, 50, 75, 100, 130].map(v => `<option value="${v}" ${v === profile.netCarbLimitG ? "selected" : ""}>${v} g</option>`).join("")}
          </select>
        </div>
        <div><label>Eiweiß g/kg (fettfreie Masse)</label><input type="number" step="0.1" id="fProteinFactor" value="${profile.proteinFactor}"></div>
      </div>
      <label>Trinkziel /Tag (ml)</label>
      <input type="number" step="100" min="0" id="fWaterTarget" value="${profile.waterTargetMl ?? 2500}">
    `,
  }[key];

  const titles = { body: "Körperdaten", goal: "Ziel & Aktivität", diet: "Ernährungsform", limits: "Grenzwerte" };
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:10px">${esc(titles[key])}</h2>
      ${bodyHtml}
      <button type="button" class="btn" id="groupDone" style="margin-top:16px">Fertig</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const save = (patch) => { Store.updateProfile(profile.id, patch); onChanged(); };
  const val = (id) => overlay.querySelector(id)?.value;
  const num = (id, fallback) => { const n = parseFloat(val(id)); return Number.isFinite(n) ? n : fallback; };

  if (key === "body") {
    overlay.querySelector("#fSex").addEventListener("change", () => save({ sex: val("#fSex") }));
    overlay.querySelector("#fAge").addEventListener("change", () => save({ age: num("#fAge", profile.age) }));
    overlay.querySelector("#fHeight").addEventListener("change", () => save({ heightCm: num("#fHeight", profile.heightCm) }));
    overlay.querySelector("#fWeight").addEventListener("change", () => save({ weightKg: num("#fWeight", profile.weightKg) }));
    overlay.querySelector("#fBodyFat").addEventListener("change", () => {
      const raw = val("#fBodyFat").trim();
      save({ bodyFatPct: raw ? parseFloat(raw) : null });
    });
  } else if (key === "goal") {
    overlay.querySelector("#fGoal").addEventListener("change", () => {
      overlay.querySelector("#deficitWrap").style.display = val("#fGoal") === "lose" ? "" : "none";
      save({ goal: val("#fGoal") });
    });
    overlay.querySelector("#fDeficit").addEventListener("change", () => save({ deficitPct: num("#fDeficit", profile.deficitPct) }));
    overlay.querySelector("#fActivity").addEventListener("change", () => save({ activity: num("#fActivity", profile.activity) }));
  } else if (key === "diet") {
    overlay.querySelector("#fDietType").addEventListener("change", () => {
      const d = DIET_TYPES[val("#fDietType")];
      if (d) {
        overlay.querySelector("#fGradeGreen").value = d.defaultThresholds.green;
        overlay.querySelector("#fGradeYellow").value = d.defaultThresholds.yellow;
      }
      save({
        dietType: val("#fDietType"),
        gradeThresholds: { green: num("#fGradeGreen", profile.gradeThresholds.green), yellow: num("#fGradeYellow", profile.gradeThresholds.yellow) },
      });
    });
    const saveThresholds = () => save({ gradeThresholds: { green: num("#fGradeGreen", profile.gradeThresholds.green), yellow: num("#fGradeYellow", profile.gradeThresholds.yellow) } });
    overlay.querySelector("#fGradeGreen").addEventListener("change", saveThresholds);
    overlay.querySelector("#fGradeYellow").addEventListener("change", saveThresholds);
  } else if (key === "limits") {
    overlay.querySelector("#fCarbLimit").addEventListener("change", () => save({ netCarbLimitG: num("#fCarbLimit", profile.netCarbLimitG) }));
    overlay.querySelector("#fProteinFactor").addEventListener("change", () => save({ proteinFactor: num("#fProteinFactor", profile.proteinFactor) }));
    overlay.querySelector("#fWaterTarget").addEventListener("change", () => save({ waterTargetMl: num("#fWaterTarget", profile.waterTargetMl ?? 2500) }));
  }

  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#groupDone").addEventListener("click", close);
  keepActionsInView(overlay);
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

/** Teilt das komplette Backup — fällt auf Download zurück, wenn das Gerät nicht teilen kann. */
async function shareFullBackup() {
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
}

/** Teilt nur die Rezepte — fällt ebenfalls auf Download zurück. */
async function shareRecipesOnly() {
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
}

/**
 * Sync-Karte: "Alles teilen" und "Einspielen" als Hauptweg, alles andere (Nur Rezepte, Datei
 * sichern, Rückgängig) als Zeile darunter — statt sechs gleich aussehenden Knöpfen für zwei
 * Vorgänge (Voll-Backup, Nur-Rezepte).
 */
function wireExportImport(container) {
  container.querySelector("#shareBtn").addEventListener("click", shareFullBackup);

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

  container.querySelector("#exportOnlyRow").addEventListener("click", () => {
    downloadBackup();
    showToast("Export gestartet");
  });

  container.querySelector("#recipesOnlyRow").addEventListener("click", () => openRecipesOnlySheet());

  container.querySelector("#restoreRow")?.addEventListener("click", () => {
    const info = Store.getPreMergeInfo();
    const when = info ? new Date(info.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "";
    if (!confirm(`Stand von vor dem letzten Import (${when}) wiederherstellen? Alles, was seitdem dazugekommen ist, geht verloren.`)) return;
    Store.restorePreMergeBackup();
    showToast("Stand wiederhergestellt");
    renderProfile(container, () => {});
  });
}

/** Kleines Sheet für den selteneren Weg: nur Rezepte teilen/einspielen, ohne Profile/Verlauf/Listen. */
function openRecipesOnlySheet() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">Nur Rezepte</h2>
      <p class="hint">Schickt nur die Rezepte (ohne Profile, Verlauf, Listen) — z.B. um ein einzelnes neues Rezept ans andere Handy zu schicken. Vorhandene Rezepte dort bleiben erhalten, gleiche Rezepte werden aktualisiert.</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn secondary" id="importRecipesBtn">⬇️ Import</button>
        <button class="btn secondary" id="exportRecipesBtn">⬆️ Export</button>
        <button class="btn secondary" id="shareRecipesBtn">📤 Teilen</button>
      </div>
      <!-- Gleicher Filter wie bei #importFile, siehe Begründung dort. -->
      <input type="file" id="importRecipesFile" accept=".txt,.json,text/plain,application/json,application/octet-stream" style="display:none">
    </div>
  `;
  document.body.appendChild(overlay);
  const close = bindBackClose(() => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.querySelector("#exportRecipesBtn").addEventListener("click", () => {
    downloadBlob(Store.exportRecipesJSON(), recipesFilename());
    showToast("Export gestartet");
  });
  overlay.querySelector("#shareRecipesBtn").addEventListener("click", shareRecipesOnly);

  const recipesFileInput = overlay.querySelector("#importRecipesFile");
  overlay.querySelector("#importRecipesBtn").addEventListener("click", () => recipesFileInput.click());
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
  keepActionsInView(overlay);
}
