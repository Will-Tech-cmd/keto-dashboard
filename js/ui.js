// ui.js — kleine, geteilte UI-Helfer.
import { Store } from "./store.js";

/** Setzt Design ("klassisch"/"klar") und Erscheinungsbild ("system"/"light"/"dark") des aktiven
 * Profils als Attribute am <body> — steuert in app.css sämtliche Farb-/Schrift-Tokens sowie
 * Tabbar und FAB. Aufrufen beim Start, nach Profilwechsel und nach Änderung im Profil-Tab. */
export function applyDesignTheme() {
  const profile = Store.getActiveProfile();
  document.body.dataset.design = profile.design;
  document.body.dataset.theme = profile.appearance;
}

let toastTimer = null;

export function showToast(text) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---------------------------------------------------------------------------
// Snackbar mit Rückgängig (nur Design "Klar") — Ersatz für die einzelnen ↩️-Buttons
// in jeder Zeile. Mehrere Aktionen kurz hintereinander ersetzen die sichtbare Snackbar,
// bleiben aber als Stapel bestehen: Rückgängig macht immer zuerst die zuletzt gezeigte
// Aktion rückgängig (LIFO), bis der Stapel leer ist. Jede Aktion verfällt nach 5s eigenständig
// und ist danach endgültig — auch wenn sie gerade nicht sichtbar ist, weil eine neuere
// Aktion sie überdeckt hat.
// ---------------------------------------------------------------------------
let snackbarStack = [];

function renderSnackbarStack() {
  const wrap = document.getElementById("snackbarWrap");
  if (!wrap) return;
  const top = snackbarStack[snackbarStack.length - 1];
  if (!top) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = `
    <div class="klar-snackbar" id="activeSnackbar">
      <div class="klar-snackbar-text">
        <div class="klar-snackbar-title">${esc(top.title)}</div>
        ${top.subtitle ? `<div class="klar-snackbar-sub">${esc(top.subtitle)}</div>` : ""}
      </div>
      ${top.onUndo ? `<button type="button" class="klar-snackbar-undo">Rückgängig</button>` : ""}
    </div>
  `;
  requestAnimationFrame(() => wrap.querySelector(".klar-snackbar")?.classList.add("show"));
  wrap.querySelector(".klar-snackbar-undo")?.addEventListener("click", () => {
    const i = snackbarStack.indexOf(top);
    if (i >= 0) snackbarStack.splice(i, 1);
    clearTimeout(top.timer);
    top.onUndo();
    renderSnackbarStack();
  });
}

/** Zeigt eine rückgängig-machbare Aktion als Snackbar. `onUndo` bleibt weg, wenn nichts
 * rückgängig zu machen ist (z.B. reine Statusmeldungen im Klar-Design). */
export function showSnackbar({ title, subtitle, onUndo }) {
  const entry = { title, subtitle, onUndo };
  entry.timer = setTimeout(() => {
    const i = snackbarStack.indexOf(entry);
    if (i >= 0) snackbarStack.splice(i, 1);
    renderSnackbarStack();
  }, 5000);
  snackbarStack.push(entry);
  renderSnackbarStack();
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Teilt eine Datei über den systemeigenen Teilen-Dialog, falls verfügbar — sonst wird sie
 * heruntergeladen. Gibt zurück, was tatsächlich passiert ist, damit der Aufrufer eine passende
 * Rückmeldung zeigen kann (bei Abbruch durch den Nutzer z.B. keine).
 */
export async function shareOrDownloadFile(file, { title } = {}) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}

/**
 * Verkleinert ein übergroßes Bild (z.B. ein sehr langer Scrolling-Screenshot) vor
 * Texterkennung/Upload. Unauffällig für normal große Bilder — gibt die Datei unverändert
 * zurück, wenn sie bereits innerhalb der Grenzen liegt oder der Browser sie nicht direkt
 * decodieren kann (z.B. ungewöhnliches Format). Ohne diese Begrenzung können sehr hohe Bilder
 * je nach Gerät an Canvas-Größen- oder Speichergrenzen scheitern (Tab-Absturz statt
 * Fehlermeldung) oder unnötig riesige Uploads erzeugen.
 */
export async function downscaleImageIfNeeded(file, { maxSide = 8000, maxPixels = 20_000_000 } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  if (scale >= 1) {
    bitmap.close?.();
    return file;
  }

  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close?.();
  return (await new Promise(resolve => canvas.toBlob(resolve, "image/png"))) || file;
}

/**
 * Koppelt einen Dialog/Vollbild-Zustand (Modal, Rezept-Editor, …) an die Browser-History,
 * damit die Zurück-Geste am Handy zuerst diesen Zustand schließt, statt die App zu
 * verlassen. `closeImmediate` entfernt den Zustand rein visuell (z.B. Overlay aus dem DOM
 * nehmen). Die zurückgegebene Funktion für alle IN-APP-Schließwege verwenden (Abbrechen,
 * Speichern, Klick daneben) — sie räumt zusätzlich den History-Eintrag auf, damit der
 * Verlauf nicht mit toten Einträgen vollläuft.
 */
export function bindBackClose(closeImmediate) {
  history.pushState({ modal: true }, "");
  const onPop = () => {
    window.removeEventListener("popstate", onPop);
    closeImmediate();
  };
  window.addEventListener("popstate", onPop);
  /**
   * `afterHistorySync` für alle Schließwege, die anschließend selbst navigieren (z.B. der
   * Eintragen-Sheet, der auf den Scan-Tab wechselt). history.back() wirkt erst asynchron beim
   * nächsten popstate — wer direkt danach pushState aufruft, wird von diesem popstate wieder
   * zurückgeworfen und landet dort, wo er herkam. Deshalb erst navigieren, wenn der
   * History-Eintrag des Dialogs wirklich weg ist.
   */
  return function closeAndSync(afterHistorySync) {
    window.removeEventListener("popstate", onPop);
    closeImmediate();
    if (history.state?.modal) {
      if (afterHistorySync) {
        const onSynced = () => {
          window.removeEventListener("popstate", onSynced);
          afterHistorySync();
        };
        window.addEventListener("popstate", onSynced);
      }
      history.back();
    } else {
      afterHistorySync?.();
    }
  };
}
