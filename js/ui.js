// ui.js — kleine, geteilte UI-Helfer.
import { Store } from "./store.js";

/** Setzt das Erscheinungsbild ("system"/"light"/"dark") des aktiven Profils als Attribut am
 * <body> — steuert in app.css sämtliche Farb-Tokens. Aufrufen beim Start, nach Profilwechsel
 * und nach Änderung im Profil-Tab. */
export function applyDesignTheme() {
  // Es gibt nur noch das Design "Klar" — das Attribut bleibt als CSS-Aufhänger bestehen.
  document.body.dataset.design = "klar";
  document.body.dataset.theme = Store.getActiveProfile().appearance;
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
// Snackbar mit Rückgängig — Ersatz für die einzelnen ↩️-Buttons
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

// Chrome blendet über der Tastatur eine Autofill-Leiste ein, die NICHT zu dem Bereich zählt,
// den visualViewport als verdeckt meldet. Ohne diesen Zuschlag landen die Dialog-Knöpfe exakt
// dahinter — gemessener Wert, kein Browser gibt die Höhe der Leiste preis.
const AUTOFILL_BAR_PX = 56;

/**
 * Hält die Aktionsknöpfe eines Dialogs erreichbar, solange die Tastatur offen ist.
 *
 * Reines Scrollen im Dialog reicht nicht: kurze Dialoge haben nichts zu scrollen, ihre Karte
 * klebt am unteren Rand und liegt damit hinter der Tastatur. Deshalb wird der ganze Dialog
 * angehoben und seine Höhe auf den verbleibenden Platz begrenzt.
 */
export function keepActionsInView(overlay) {
  const card = overlay.querySelector(".modal-card");
  const vv = window.visualViewport;
  if (!card || !vv) return;

  // Fensterhöhe beim Öffnen — als Vergleichswert dafür, ob später wirklich eine Tastatur
  // aufgegangen ist. Auf dem Desktop passiert damit gar nichts.
  const baseHeight = vv.height;

  const apply = () => {
    if (!document.body.contains(overlay)) {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      return;
    }
    // Von der Tastatur verdeckter Bereich. Das Layout selbst bleibt bewusst unangetastet
    // (kein interactive-widget=resizes-content) — sonst wandert die Fußzeile mit nach oben.
    const covered = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    const keyboardOpen = covered > 120 || vv.height < baseHeight - 120;

    if (!keyboardOpen) {
      overlay.classList.remove("kb-lifted");
      overlay.style.paddingBottom = "";
      card.style.maxHeight = "";
      return;
    }

    overlay.classList.add("kb-lifted");
    overlay.style.paddingBottom = `${covered + AUTOFILL_BAR_PX}px`;
    card.style.maxHeight = `${Math.max(160, vv.height - AUTOFILL_BAR_PX - 24)}px`;

    // Das gerade bearbeitete Feld muss sichtbar bleiben. Früher wurde stattdessen ans Ende
    // der Karte gescrollt, damit die Knöpfe im Bild sind — bei einem Feld weiter oben schob
    // das genau die Zeile aus dem Bild, die man gerade tippt. "nearest" scrollt nur so weit
    // wie nötig und lässt ein bereits sichtbares Feld in Ruhe.
    if (overlay.contains(document.activeElement) && card.scrollHeight > card.clientHeight) {
      document.activeElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  // Die Tastatur fährt animiert ein; direkt nach dem Fokus meldet der Browser noch die alten
  // Maße. Beim Verlassen eines Feldes genauso, deshalb in beide Richtungen verzögert messen.
  const applySoon = () => setTimeout(apply, 300);
  overlay.querySelectorAll("input, select, textarea").forEach(el => {
    el.addEventListener("focus", applySoon);
    el.addEventListener("blur", applySoon);
  });
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);

  selectOnFocus(overlay);
}

/**
 * Markiert den Inhalt eines Zahlen-/Textfeldes, sobald es den Fokus bekommt. Springt man mit
 * Enter/Tab durch ein Formular (Zutat bearbeiten hat zehn Felder), landet der Cursor sonst
 * irgendwo im bestehenden Wert und man muss ihn erst löschen, bevor man den neuen tippen kann.
 */
export function selectOnFocus(root) {
  root.querySelectorAll('input[type="text"], input[type="number"]').forEach(el => {
    // setTimeout(0): ruft man select() direkt im focus-Handler auf, setzt der Browser die
    // Cursor-Position danach trotzdem wieder zurück (eigene Nachbearbeitung nach dem Fokus).
    el.addEventListener("focus", () => setTimeout(() => el.select(), 0));
  });
}

/**
 * Fragt den aktiven Service Worker, welche Fassung er ausliefert. Gibt null zurück, solange
 * keiner die Seite bedient (erster Aufruf einer frischen Installation).
 */
export function getAppVersion() {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve(null);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data?.version || null); };
    sw.postMessage({ type: "version" }, [channel.port2]);
  });
}

/**
 * Die vier Kennwerte als Kachelreihe — dieselbe Darstellung in der Scan-Ergebniskarte und in
 * den Listen. Die Einheit steht einmal unter der Reihe statt in jedem Label: bei vier Spalten
 * nebeneinander bricht „g Netto-KH /100 g" sonst um, „kcal /100 g" nicht, und die Reihe wirkt
 * ausgefranst. Reihenfolge wie die Ringe auf der Startseite.
 */
export function nutriTilesHtml(nutri) {
  const v = (x) => x == null ? "–" : Math.round(x * 10) / 10;
  const tiles = [
    ["kcal", nutri?.kcal],
    ["g Netto-KH", nutri?.netCarbs],
    ["g Fett", nutri?.fat],
    ["g Eiweiß", nutri?.protein],
  ];
  return `
    <div class="klar-tile-grid">
      ${tiles.map(([label, value]) => `
        <div class="klar-tile"><div class="val">${v(value)}</div><div class="lbl">${label}</div></div>
      `).join("")}
    </div>
    <div class="klar-tile-unit">je 100 g</div>
  `;
}

/** Ampelpunkt für Listenzeilen — bewusst ohne Emoji, damit die Zeile ruhig bleibt. */
export function gradeDotHtml(grade) {
  return `<span class="klar-dot ${grade || "gray"}" aria-hidden="true"></span>`;
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
let modalDepth = 0;

export function bindBackClose(closeImmediate) {
  // Verschachtelungstiefe im History-Eintrag mitführen (Rezept-Editor -> Zutaten-Scanner sind
  // z.B. zwei Ebenen). Ohne sie würde der innere Dialog beim Schließen die äußeren mitreißen:
  // sein history.back() löst ein popstate aus, das auch deren Listener erreicht.
  const depth = ++modalDepth;
  history.pushState({ modal: true, depth }, "");

  const detach = () => {
    window.removeEventListener("popstate", onPop);
    modalDepth = Math.min(modalDepth, depth - 1);
  };

  function onPop() {
    // Nur schließen, wenn wirklich hinter DIESEN Dialog zurückgesprungen wurde.
    const current = history.state?.modal ? history.state.depth : 0;
    if (current >= depth) return;
    detach();
    closeImmediate();
  }
  window.addEventListener("popstate", onPop);

  /**
   * `afterHistorySync` für alle Schließwege, die anschließend selbst navigieren (z.B. der
   * Eintragen-Sheet, der auf den Scan-Tab wechselt). history.back() wirkt erst asynchron beim
   * nächsten popstate — wer direkt danach pushState aufruft, wird von diesem popstate wieder
   * zurückgeworfen und landet dort, wo er herkam. Deshalb erst navigieren, wenn der
   * History-Eintrag des Dialogs wirklich weg ist.
   */
  return function closeAndSync(maybeCallback) {
    // Viele Aufrufer hängen close() direkt als Klick-Handler ein — dann kommt hier das
    // Click-Event an, kein Callback. Nur echte Funktionen als Fortsetzung behandeln.
    const afterHistorySync = typeof maybeCallback === "function" ? maybeCallback : null;
    detach();
    closeImmediate();
    if (history.state?.modal && history.state.depth >= depth) {
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
