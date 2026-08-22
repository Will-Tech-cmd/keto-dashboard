// views/rezept.js — Detailansicht: Zutaten mit Portionsumrechner, Zubereitung zum Abhaken,
// Fotos, Notizen, Kommentare, Bewertung, "heute gekocht", Zutaten -> Keto-Einkaufsliste.
import { getRezept, publicFotoUrl, forceUpdateRezeptHead, addKommentar, softDeleteRezept } from "../api.js";
import { saveRezeptCache, loadRezeptCache } from "../cache.js";
import { pushToKetoShoppingList } from "../keto-bridge.js";
import { getWhoAmI } from "../identity.js";
import { esc, showToast, starsHtml, formatMinutes } from "../ui.js";

let servingFactor = 1;
let checkedSteps = new Set();
let wakeLock = null;

export async function renderRezeptDetail(container, id, { onEdit, onBack, onDeleted }) {
  servingFactor = 1;
  checkedSteps = new Set();
  releaseWakeLock();

  let rezept = loadRezeptCache(id);
  if (rezept) draw(container, rezept, { onEdit, onBack, onDeleted });
  else container.innerHTML = `<p class="kb-hint" style="padding:16px">Lädt …</p>`;

  try {
    rezept = await getRezept(id);
    if (!rezept) { showToast("Rezept nicht mehr vorhanden"); onBack(); return; }
    saveRezeptCache(rezept);
    draw(container, rezept, { onEdit, onBack, onDeleted });
  } catch (err) {
    if (!rezept) container.innerHTML = `<p class="kb-hint" style="padding:16px">${esc(err.message)}</p>`;
    else showToast("Offline — zeige den letzten bekannten Stand");
  }
}

function scaleAmount(zutat, factor) {
  const gramm = zutat.gramm != null ? Math.round(zutat.gramm * factor * 10) / 10 : null;
  if (gramm != null) return `${gramm} g`;
  if (zutat.mengentext) {
    // Führende Zahl im Mengentext mitskalieren ("2 EL" -> "4 EL" bei ×2), Rest unangetastet.
    return zutat.mengentext.replace(/^(\d+(?:[.,]\d+)?)/, (m) => {
      const val = parseFloat(m.replace(",", ".")) * factor;
      return (Math.round(val * 100) / 100).toString().replace(".", ",");
    });
  }
  return null;
}

function draw(container, r, { onEdit, onBack, onDeleted }) {
  const totalMin = (r.vorbereitung_min || 0) + (r.koch_min || 0) || null;
  const bilder = r.kochbuch_bilder || [];
  const titelbild = bilder.find(b => b.id === r.titelbild_id) || bilder[0] || null;
  const schwierigkeitLabel = { 1: "Einfach", 2: "Mittel", 3: "Anspruchsvoll" }[r.schwierigkeit] || null;

  container.innerHTML = `
    <div class="kb-detail-head">
      <button class="kb-icon-btn" id="backBtn" aria-label="Zurück">‹</button>
      <div class="kb-detail-title">${esc(r.titel)}</div>
      <button class="kb-icon-btn" id="editBtn" aria-label="Bearbeiten">✎</button>
    </div>

    ${titelbild ? `<div class="kb-hero" style="background-image:url('${esc(publicFotoUrl(titelbild.pfad))}')"></div>` : ""}

    <div class="kb-detail-body">
      ${r.untertitel ? `<p class="kb-subtitle">${esc(r.untertitel)}</p>` : ""}

      <div class="kb-meta-row">
        ${totalMin ? `<span>⏱ ${formatMinutes(totalMin)}</span>` : ""}
        ${schwierigkeitLabel ? `<span>📊 ${schwierigkeitLabel}</span>` : ""}
        ${r.ofen_c ? `<span>🔥 ${r.ofen_c}°C</span>` : ""}
        <span id="stars">${starsHtml(r.bewertung, { interactive: true })}</span>
      </div>

      ${r.tags?.length ? `<div class="kb-tag-row">${r.tags.map(t => `<span class="kb-tag-chip">${esc(t)}</span>`).join("")}</div>` : ""}

      ${r.naehrwerte ? `
        <div class="kb-nutri-tiles">
          <div><div class="val">${r.naehrwerte.kcal ?? "–"}</div><div class="lbl">kcal</div></div>
          <div><div class="val">${r.naehrwerte.netCarbs ?? "–"}</div><div class="lbl">g Netto-KH</div></div>
          <div><div class="val">${r.naehrwerte.fat ?? "–"}</div><div class="lbl">g Fett</div></div>
          <div><div class="val">${r.naehrwerte.protein ?? "–"}</div><div class="lbl">g Eiweiß</div></div>
        </div>
        <div class="kb-hint">je Portion</div>
      ` : ""}

      <div class="kb-section-head">
        <h2>Zutaten</h2>
        <div class="kb-serving-scaler">
          <button type="button" data-f="0.5">½×</button>
          <button type="button" data-f="1" class="active">1×</button>
          <button type="button" data-f="2">2×</button>
        </div>
      </div>
      <p class="kb-hint" id="servingsHint">${Math.round((r.portionen || 1) * servingFactor * 10) / 10} Portion(en)</p>
      <ul class="kb-ingredient-list" id="ingList">
        ${(r.kochbuch_zutaten || []).map(z => renderIngredientLine(z)).join("")}
      </ul>
      <button class="kb-btn kb-btn-secondary" id="toShoppingBtn">🛒 Auf Einkaufsliste</button>

      <h2 class="kb-section-title">Zubereitung</h2>
      <ol class="kb-steps" id="stepsList">
        ${(r.kochbuch_schritte || []).map((s, i) => `
          <li data-i="${i}">
            <label>
              <input type="checkbox" data-i="${i}">
              <span class="kb-step-text">${esc(s.text)}${s.minuten ? ` <span class="kb-step-min">(${s.minuten} Min.)</span>` : ""}</span>
            </label>
          </li>
        `).join("") || `<p class="kb-hint">Keine Zubereitungsschritte hinterlegt.</p>`}
      </ol>
      ${r.kochbuch_schritte?.length ? `<button class="kb-btn kb-btn-ghost" id="wakeLockBtn">📱 Bildschirm anlassen</button>` : ""}

      ${bilder.length ? `
        <h2 class="kb-section-title">Fotos</h2>
        <div class="kb-gallery" id="gallery">
          ${bilder.map(b => `<img src="${esc(publicFotoUrl(b.pfad))}" data-full="${esc(publicFotoUrl(b.pfad))}" loading="lazy" alt="">`).join("")}
        </div>
      ` : ""}

      ${r.notizen ? `<h2 class="kb-section-title">Notizen</h2><p class="kb-notes">${esc(r.notizen).replace(/\n/g, "<br>")}</p>` : ""}

      <h2 class="kb-section-title">Kommentare</h2>
      <div id="comments">${renderComments(r.kochbuch_kommentare || [])}</div>
      <form id="commentForm" class="kb-comment-form">
        <input type="text" id="commentInput" placeholder="Kommentar hinzufügen …" maxlength="500">
        <button class="kb-btn kb-btn-secondary" type="submit">Senden</button>
      </form>

      <div class="kb-btn-row" style="margin-top:20px">
        <button class="kb-btn kb-btn-secondary" id="cookedBtn">✅ Heute gekocht</button>
        ${navigator.share ? `<button class="kb-btn kb-btn-secondary" id="shareBtn">📤 Teilen</button>` : ""}
        <button class="kb-btn kb-btn-secondary kb-btn-danger" id="deleteBtn">🗑️ Löschen</button>
      </div>
    </div>
  `;

  container.querySelector("#backBtn").addEventListener("click", () => { releaseWakeLock(); onBack(); });
  container.querySelector("#editBtn").addEventListener("click", () => { releaseWakeLock(); onEdit(r.id); });

  container.querySelectorAll(".kb-serving-scaler button").forEach(btn => {
    btn.addEventListener("click", () => {
      servingFactor = parseFloat(btn.dataset.f);
      container.querySelectorAll(".kb-serving-scaler button").forEach(b => b.classList.toggle("active", b === btn));
      container.querySelector("#servingsHint").textContent = `${Math.round((r.portionen || 1) * servingFactor * 10) / 10} Portion(en)`;
      container.querySelector("#ingList").innerHTML = (r.kochbuch_zutaten || []).map(z => renderIngredientLine(z)).join("");
    });
  });

  container.querySelectorAll('#stepsList input[type="checkbox"]').forEach(cb => {
    cb.checked = checkedSteps.has(Number(cb.dataset.i));
    cb.addEventListener("change", () => {
      const i = Number(cb.dataset.i);
      if (cb.checked) checkedSteps.add(i); else checkedSteps.delete(i);
      cb.closest("li").classList.toggle("done", cb.checked);
    });
    if (cb.checked) cb.closest("li").classList.add("done");
  });

  container.querySelector("#wakeLockBtn")?.addEventListener("click", async (e) => {
    if (wakeLock) {
      releaseWakeLock();
      e.target.textContent = "📱 Bildschirm anlassen";
    } else {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
        e.target.textContent = "📱 Bildschirm bleibt an";
      } catch {
        showToast("Bildschirm-Sperre konnte nicht deaktiviert werden");
      }
    }
  });

  container.querySelector("#gallery")?.addEventListener("click", (e) => {
    const src = e.target.dataset?.full;
    if (src) openLightbox(src);
  });

  container.querySelector("#stars").addEventListener("click", async (e) => {
    const btn = e.target.closest(".kb-star-btn");
    if (!btn) return;
    const rating = Number(btn.dataset.star);
    try {
      await forceUpdateRezeptHead(r.id, { bewertung: rating, geaendert_von: getWhoAmI() });
      r.bewertung = rating;
      container.querySelector("#stars").innerHTML = starsHtml(rating, { interactive: true });
    } catch { showToast("Bewertung konnte nicht gespeichert werden"); }
  });

  container.querySelector("#cookedBtn").addEventListener("click", async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      await forceUpdateRezeptHead(r.id, { zuletzt_gekocht: today, geaendert_von: getWhoAmI() });
      showToast("Eingetragen — guten Appetit! 🍽️");
    } catch { showToast("Konnte nicht gespeichert werden — offline?"); }
  });

  container.querySelector("#toShoppingBtn").addEventListener("click", () => {
    const names = (r.kochbuch_zutaten || []).map(z => z.name).filter(Boolean);
    if (names.length === 0) { showToast("Keine Zutaten in diesem Rezept"); return; }
    pushToKetoShoppingList(names);
    showToast(`${names.length} Zutat(en) für die Keto-App vorgemerkt — beim nächsten Öffnen dort sichtbar`);
  });

  container.querySelector("#shareBtn")?.addEventListener("click", () => {
    navigator.share({ title: r.titel, text: `Rezept: ${r.titel}`, url: location.href }).catch(() => {});
  });

  container.querySelector("#deleteBtn").addEventListener("click", async () => {
    if (!confirm(`„${r.titel}" wirklich löschen?`)) return;
    try {
      await softDeleteRezept(r.id);
      showToast("Rezept gelöscht");
      onDeleted();
    } catch { showToast("Löschen fehlgeschlagen — offline?"); }
  });

  container.querySelector("#commentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = container.querySelector("#commentInput");
    const text = input.value.trim();
    if (!text) return;
    try {
      const kommentar = await addKommentar(r.id, getWhoAmI(), text);
      r.kochbuch_kommentare = [...(r.kochbuch_kommentare || []), kommentar];
      container.querySelector("#comments").innerHTML = renderComments(r.kochbuch_kommentare);
      input.value = "";
    } catch { showToast("Kommentar konnte nicht gespeichert werden — offline?"); }
  });
}

function renderIngredientLine(z) {
  const menge = scaleAmount(z, servingFactor);
  return `<li>${menge ? `<strong>${esc(menge)}</strong> ` : ""}${esc(z.name)}</li>`;
}

function renderComments(kommentare) {
  if (!kommentare.length) return `<p class="kb-hint">Noch keine Kommentare.</p>`;
  return kommentare.map(k => `
    <div class="kb-comment">
      <div class="kb-comment-head"><strong>${esc(k.autor || "Jemand")}</strong> <span>${new Date(k.created_at).toLocaleDateString("de-DE")}</span></div>
      <div>${esc(k.text)}</div>
    </div>
  `).join("");
}

function openLightbox(src) {
  const overlay = document.createElement("div");
  overlay.className = "kb-lightbox";
  overlay.innerHTML = `<img src="${esc(src)}" alt="">`;
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

function releaseWakeLock() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}
