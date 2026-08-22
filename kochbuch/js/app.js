// app.js — Einstieg, Hash-Routing, Anmeldung, Einstellungen, Service-Worker-Registrierung.
import { isLoggedIn, logout, changePassword, createRezeptHead } from "./api.js";
import { renderLogin } from "./views/login.js";
import { renderListe } from "./views/liste.js";
import { renderRezeptDetail } from "./views/rezept.js";
import { renderEditor } from "./views/editor.js";
import { renderImport } from "./views/import.js";
import { syncRezepteFromKetoSync } from "./keto-sync-import.js";
import { getWhoAmI } from "./identity.js";
import { esc, showToast } from "./ui.js";

const view = document.getElementById("view");

// ?import=<ketoId> kommt vom "📖 Im Kochbuch öffnen"-Knopf im Rezept-Editor der Keto-App — einmalig
// lesen und die Adressleiste säubern, damit ein Neuladen nicht denselben Import wiederholt.
const params = new URLSearchParams(location.search);
const importKetoId = params.get("import");
if (location.search) history.replaceState(null, "", location.pathname + location.hash);
if (importKetoId && (location.hash === "" || location.hash === "#/")) {
  history.replaceState(null, "", location.pathname + "#/import");
}

function route() {
  const hash = location.hash.slice(1) || "/";

  if (!isLoggedIn()) {
    renderLogin(view, () => { route(); maybeAutoSyncFromKeto(); });
    return;
  }

  if (hash === "/" || hash === "") {
    renderListe(view, {
      onOpen: (id) => { location.hash = `#/rezept/${id}`; },
      onNew: createAndEdit,
      onImport: () => { location.hash = "#/import"; },
      onSettings: openSettings,
    });
  } else if (hash.startsWith("/rezept/")) {
    const id = hash.slice("/rezept/".length);
    renderRezeptDetail(view, id, {
      onEdit: (rid) => { location.hash = `#/bearbeiten/${rid}`; },
      onBack: () => { location.hash = "#/"; },
      onDeleted: () => { location.hash = "#/"; },
    });
  } else if (hash.startsWith("/bearbeiten/")) {
    const id = hash.slice("/bearbeiten/".length);
    renderEditor(view, id, {
      onBack: () => { location.hash = `#/rezept/${id}`; },
      onSaved: (rid) => { location.hash = `#/rezept/${rid}`; },
    });
  } else if (hash === "/import") {
    renderImport(view, {
      onBack: () => { location.hash = "#/"; },
      onImported: (rid) => { location.hash = `#/rezept/${rid}`; },
      preselectKetoId: importKetoId,
    });
  } else {
    location.hash = "#/";
  }
}

let creatingRezept = false;

async function createAndEdit() {
  // Das Anlegen braucht einen Netzwerk-Roundtrip und zeigt bis zum Seitenwechsel keine
  // Rückmeldung — ohne diese Sperre legt ungeduldiges Mehrfachtippen mehrere leere Rezepte an.
  if (creatingRezept) return;
  creatingRezept = true;
  document.getElementById("newBtn")?.setAttribute("disabled", "true");
  const wer = getWhoAmI();
  try {
    const created = await createRezeptHead({ titel: "Neues Rezept", portionen: 2, erstellt_von: wer, geaendert_von: wer });
    location.hash = `#/bearbeiten/${created.id}`;
  } catch (err) {
    showToast(err.message || "Anlegen fehlgeschlagen — offline?");
  } finally {
    creatingRezept = false;
    document.getElementById("newBtn")?.removeAttribute("disabled");
  }
}

function openSettings() {
  const overlay = document.createElement("div");
  overlay.className = "kb-lightbox kb-settings-overlay";
  overlay.innerHTML = `
    <div class="kb-card kb-settings-card" role="dialog" aria-label="Einstellungen">
      <h2 style="margin-top:0">Einstellungen</h2>
      <p class="kb-hint">Angemeldet mit dem gemeinsamen Zugangswort${getWhoAmI() ? ` · Name: ${esc(getWhoAmI())}` : ""}</p>
      <button class="kb-btn kb-btn-secondary" id="changePwBtn">Zugangswort ändern</button>
      <button class="kb-btn kb-btn-secondary" id="logoutBtn">Abmelden</button>
      <button class="kb-btn kb-btn-ghost" id="closeSettingsBtn">Schließen</button>
    </div>
  `;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  overlay.querySelector("#closeSettingsBtn").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#logoutBtn").addEventListener("click", () => {
    logout();
    overlay.remove();
    route();
  });
  overlay.querySelector("#changePwBtn").addEventListener("click", async () => {
    const pw = prompt("Neues gemeinsames Zugangswort (mindestens 8 Zeichen):");
    if (!pw) return;
    if (pw.length < 8) { showToast("Mindestens 8 Zeichen"); return; }
    try {
      await changePassword(pw);
      showToast("Zugangswort geändert — bitte auch dem anderen Gerät Bescheid geben");
      overlay.remove();
    } catch (err) {
      showToast(err.message || "Konnte nicht geändert werden — offline?");
    }
  });
}

window.addEventListener("hashchange", route);
window.addEventListener("online", () => showToast("Wieder online"));
window.addEventListener("offline", () => showToast("Offline — zeigt den letzten bekannten Stand"));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

route();

// Sobald mindestens ein Gerät die Online-Synchronisierung der Keto-App aktiviert hat, liegen
// alle ihre Rezepte zentral bei Supabase — dann automatisch übernehmen statt auf das manuelle
// "Aus der Keto-App übernehmen" zu warten. Der ?import=-Direktsprung übernimmt sein eines
// Rezept schon selbst, deshalb hier aussetzen, um nicht doppelt zu arbeiten. Läuft sowohl direkt
// beim Start (schon angemeldete Sitzung) als auch nach einem frischen Login (siehe route()) —
// beim allerersten Laden vor dem Einloggen ist isLoggedIn() sonst immer noch false.
function maybeAutoSyncFromKeto() {
  if (!isLoggedIn() || importKetoId) return;
  syncRezepteFromKetoSync().then(({ imported, updated }) => {
    if (imported + updated === 0) return;
    const teile = [];
    if (imported) teile.push(`${imported} neu`);
    if (updated) teile.push(`${updated} aktualisiert`);
    showToast(`Aus der Keto-App übernommen: ${teile.join(", ")}`);
    if (location.hash === "" || location.hash === "#/") route();
  }).catch(() => {
    // Kein Sync-Datensatz vorhanden oder offline — bewusst still, kein Fehler-Toast beim
    // ganz normalen Start ohne aktivierte Keto-Synchronisierung.
  });
}
maybeAutoSyncFromKeto();
