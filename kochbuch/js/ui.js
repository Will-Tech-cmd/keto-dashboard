// ui.js — kleine, geteilte UI-Helfer für das Kochbuch. Bewusst eine eigene, schlanke Fassung
// statt eines Imports aus ../js/ui.js: jene Datei importiert store.js, dessen Modul-Ladezeit
// bereits in den localStorage der Keto-App schreiben würde — hier soll ausschließlich
// keto-bridge.js gezielt lesend darauf zugreifen.

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer = null;

export function showToast(text) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

/** Markiert den Inhalt eines Feldes beim Fokussieren — praktisch beim Tab-Springen durchs Formular. */
export function selectOnFocus(root) {
  root.querySelectorAll('input[type="text"], input[type="number"]').forEach(el => {
    el.addEventListener("focus", () => setTimeout(() => el.select(), 0));
  });
}

/**
 * Koppelt eine Vollbild-/Dialogansicht an die Browser-History, damit die Zurück-Geste sie
 * zuerst schließt statt die App zu verlassen. Vereinfachte Fassung des Musters aus der
 * Keto-App (dort js/ui.js:bindBackClose) — hier ohne Verschachtelungstiefe, weil das
 * Kochbuch nie mehr als eine Ebene gleichzeitig offen hat.
 */
export function bindBackClose(closeImmediate) {
  history.pushState({ kbModal: true }, "");
  const onPop = () => { detach(); closeImmediate(); };
  function detach() { window.removeEventListener("popstate", onPop); }
  window.addEventListener("popstate", onPop);
  return function closeAndSync() {
    detach();
    closeImmediate();
    if (history.state?.kbModal) history.back();
  };
}

/**
 * Verkleinert ein Foto vor dem Hochladen auf höchstens 1600px Kantenlänge und komprimiert es
 * als JPEG. Direkt aus der Handykamera kommen sonst leicht 10+ MB pro Bild — das würde sowohl
 * den Upload als auch das spätere Offline-Caching unnötig ausbremsen.
 */
export async function downscaleImage(file, { maxSide = 1600, quality = 0.82 } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { blob: file, width: null, height: null };
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  return { blob: blob || file, width: targetW, height: targetH };
}

/** Formatiert Minuten als "45 Min." oder "1 Std. 15 Min." */
export function formatMinutes(min) {
  if (min == null) return null;
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

export function starsHtml(rating, { interactive = false } = {}) {
  const full = rating || 0;
  let html = `<span class="kb-stars" ${interactive ? 'role="radiogroup" aria-label="Bewertung"' : ""}>`;
  for (let i = 1; i <= 5; i++) {
    html += interactive
      ? `<button type="button" class="kb-star-btn" data-star="${i}" aria-label="${i} Sterne">${i <= full ? "★" : "☆"}</button>`
      : `<span class="kb-star">${i <= full ? "★" : "☆"}</span>`;
  }
  return html + "</span>";
}
