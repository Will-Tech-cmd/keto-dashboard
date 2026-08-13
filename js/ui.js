// ui.js — kleine, geteilte UI-Helfer.

let toastTimer = null;

export function showToast(text) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  return function closeAndSync() {
    window.removeEventListener("popstate", onPop);
    closeImmediate();
    if (history.state?.modal) history.back();
  };
}
