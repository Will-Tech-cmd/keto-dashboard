// views/editor.js — Kopf, Zutaten, Zubereitung, Fotos. Arbeitet immer auf einem bereits in der
// Datenbank angelegten Rezept (auch ein "Neues Rezept" wird sofort mit Platzhaltertitel
// angelegt, genau wie im Rezept-Editor der Keto-App) — Fotos lassen sich dadurch von Anfang an
// hochladen, ohne auf das erste Speichern der Kopfdaten warten zu müssen.
import {
  getRezept, updateRezeptHead, forceUpdateRezeptHead, replaceZutaten, replaceSchritte,
  uploadFoto, deleteFoto, setTitelbild, publicFotoUrl,
} from "../api.js";
import { getWhoAmI } from "../identity.js";
import { esc, showToast, downscaleImage } from "../ui.js";
import { calcPerServingFromZutaten } from "../keto-bridge.js";
import { parseIngredientText } from "../../../js/ingredient-parser.js";

export async function renderEditor(container, id, { onBack, onSaved, preloaded }) {
  let rezept = preloaded && preloaded.id === id ? preloaded : await getRezept(id);
  if (!rezept) { showToast("Rezept nicht mehr vorhanden"); onBack(); return; }

  const draft = {
    updated_at: rezept.updated_at,
    titel: rezept.titel,
    untertitel: rezept.untertitel || "",
    portionen: rezept.portionen || 2,
    vorbereitung_min: rezept.vorbereitung_min ?? "",
    koch_min: rezept.koch_min ?? "",
    schwierigkeit: rezept.schwierigkeit ?? "",
    ofen_c: rezept.ofen_c ?? "",
    tags: (rezept.tags || []).join(", "),
    notizen: rezept.notizen || "",
    zutaten: (rezept.kochbuch_zutaten || []).map(z => ({ ...z })),
    schritte: (rezept.kochbuch_schritte || []).map(s => ({ ...s })),
    bilder: [...(rezept.kochbuch_bilder || [])],
    titelbild_id: rezept.titelbild_id,
  };
  let dirty = false;

  draw();

  function draw() {
    container.innerHTML = `
      <div class="kb-detail-head">
        <button class="kb-icon-btn" id="backBtn" aria-label="Zurück">‹</button>
        <div class="kb-detail-title">${esc(draft.titel) || "Neues Rezept"}</div>
        <button class="kb-btn kb-btn-primary kb-btn-small" id="saveBtn">Speichern</button>
      </div>
      <div class="kb-detail-body">
        <label>Titel</label>
        <input type="text" id="f_titel" value="${esc(draft.titel)}">

        <label>Untertitel</label>
        <input type="text" id="f_untertitel" value="${esc(draft.untertitel)}" placeholder="z.B. „Sonntags-Klassiker“">

        <div class="kb-field-grid">
          <div><label>Portionen</label><input type="number" id="f_portionen" min="1" value="${draft.portionen}"></div>
          <div><label>Vorbereitung (Min.)</label><input type="number" id="f_vorb" min="0" value="${draft.vorbereitung_min}"></div>
          <div><label>Kochzeit (Min.)</label><input type="number" id="f_koch" min="0" value="${draft.koch_min}"></div>
          <div><label>Ofen (°C)</label><input type="number" id="f_ofen" min="0" value="${draft.ofen_c}"></div>
        </div>

        <label>Schwierigkeit</label>
        <select id="f_schwierigkeit">
          <option value="">–</option>
          <option value="1" ${draft.schwierigkeit == 1 ? "selected" : ""}>Einfach</option>
          <option value="2" ${draft.schwierigkeit == 2 ? "selected" : ""}>Mittel</option>
          <option value="3" ${draft.schwierigkeit == 3 ? "selected" : ""}>Anspruchsvoll</option>
        </select>

        <label>Kategorien (mit Komma getrennt)</label>
        <input type="text" id="f_tags" value="${esc(draft.tags)}" placeholder="Frühstück, Beilage, Sonntagsessen">

        <h2 class="kb-section-title">Zutaten</h2>
        <ul class="kb-ingredient-edit-list" id="ingEditList"></ul>
        <div class="kb-btn-row">
          <button class="kb-btn kb-btn-ghost kb-btn-small" id="addIngBtn">➕ Zutat</button>
          <button class="kb-btn kb-btn-ghost kb-btn-small" id="pasteIngBtn">📋 Text einfügen</button>
        </div>
        <div id="ingPasteWrap" style="display:none;margin-top:8px">
          <textarea id="ingPasteText" rows="6" placeholder="z.B.&#10;200g Mehl&#10;2 Eier&#10;1 Prise Salz"></textarea>
          <button class="kb-btn kb-btn-secondary kb-btn-small" id="ingPasteApply">Übernehmen</button>
        </div>

        <h2 class="kb-section-title">Zubereitung</h2>
        <ol class="kb-step-edit-list" id="stepEditList"></ol>
        <div class="kb-btn-row">
          <button class="kb-btn kb-btn-ghost kb-btn-small" id="addStepBtn">➕ Schritt</button>
          <button class="kb-btn kb-btn-ghost kb-btn-small" id="pasteStepBtn">📋 Text einfügen</button>
        </div>
        <div id="stepPasteWrap" style="display:none;margin-top:8px">
          <textarea id="stepPasteText" rows="6" placeholder="Jede Zeile/jeder Absatz wird ein Schritt."></textarea>
          <button class="kb-btn kb-btn-secondary kb-btn-small" id="stepPasteApply">Übernehmen</button>
        </div>

        <h2 class="kb-section-title">Fotos</h2>
        <div class="kb-gallery-edit" id="galleryEdit"></div>
        <input type="file" id="photoInput" accept="image/*" capture="environment" style="display:none">
        <button class="kb-btn kb-btn-ghost kb-btn-small" id="addPhotoBtn">📷 Foto hinzufügen</button>

        <h2 class="kb-section-title">Notizen</h2>
        <textarea id="f_notizen" rows="4" placeholder="Tipps, Varianten, was beim letzten Mal gut war …">${esc(draft.notizen)}</textarea>
      </div>
    `;

    container.querySelector("#backBtn").addEventListener("click", () => {
      if (dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
      onBack();
    });
    container.querySelector("#saveBtn").addEventListener("click", save);

    ["f_titel", "f_untertitel", "f_portionen", "f_vorb", "f_koch", "f_ofen", "f_schwierigkeit", "f_tags", "f_notizen"]
      .forEach(id => container.querySelector(`#${id}`).addEventListener("input", () => { dirty = true; }));
    container.querySelector("#f_titel").addEventListener("input", (e) => {
      container.querySelector(".kb-detail-title").textContent = e.target.value || "Neues Rezept";
    });

    drawIngredients();
    drawSteps();
    drawGallery();

    container.querySelector("#addIngBtn").addEventListener("click", () => {
      draft.zutaten.push({ name: "", gramm: null, mengentext: "", abschnitt: null });
      dirty = true;
      drawIngredients();
    });
    container.querySelector("#pasteIngBtn").addEventListener("click", () => {
      container.querySelector("#ingPasteWrap").style.display = "";
    });
    container.querySelector("#ingPasteApply").addEventListener("click", () => {
      const text = container.querySelector("#ingPasteText").value;
      const parsed = parseIngredientText(text);
      if (parsed.length === 0) { showToast("Keine Zutaten erkannt"); return; }
      draft.zutaten.push(...parsed.map(p => ({
        name: p.name, gramm: p.grams,
        mengentext: p.grams == null && p.quantity != null ? `${p.quantity}${p.unit ? " " + p.unit : ""}` : null,
        abschnitt: null,
      })));
      dirty = true;
      container.querySelector("#ingPasteWrap").style.display = "none";
      container.querySelector("#ingPasteText").value = "";
      drawIngredients();
      showToast(`${parsed.length} Zutat(en) übernommen`);
    });

    container.querySelector("#addStepBtn").addEventListener("click", () => {
      draft.schritte.push({ text: "", minuten: null });
      dirty = true;
      drawSteps();
    });
    container.querySelector("#pasteStepBtn").addEventListener("click", () => {
      container.querySelector("#stepPasteWrap").style.display = "";
    });
    container.querySelector("#stepPasteApply").addEventListener("click", () => {
      const lines = container.querySelector("#stepPasteText").value
        .split(/\r?\n+/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return;
      draft.schritte.push(...lines.map(text => ({ text, minuten: null })));
      dirty = true;
      container.querySelector("#stepPasteWrap").style.display = "none";
      container.querySelector("#stepPasteText").value = "";
      drawSteps();
    });

    container.querySelector("#addPhotoBtn").addEventListener("click", () => container.querySelector("#photoInput").click());
    container.querySelector("#photoInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      showToast("Foto wird hochgeladen …");
      try {
        const { blob, width, height } = await downscaleImage(file);
        const bild = await uploadFoto(id, blob, { breite: width, hoehe: height });
        draft.bilder.push(bild);
        if (!draft.titelbild_id) { draft.titelbild_id = bild.id; await setTitelbild(id, bild.id); }
        drawGallery();
        showToast("Foto gespeichert");
      } catch (err) { showToast(err.message || "Upload fehlgeschlagen"); }
    });
  }

  function drawIngredients() {
    const list = container.querySelector("#ingEditList");
    list.innerHTML = draft.zutaten.map((z, i) => `
      <li>
        <input type="text" class="kb-ing-name" data-i="${i}" placeholder="Zutat" value="${esc(z.name)}">
        <input type="text" class="kb-ing-menge" data-i="${i}" placeholder="Menge" value="${esc(z.gramm != null ? z.gramm + " g" : (z.mengentext || ""))}">
        <button type="button" class="kb-icon-btn kb-remove" data-i="${i}" aria-label="Entfernen">✕</button>
      </li>
    `).join("") || `<li class="kb-hint">Noch keine Zutaten.</li>`;

    list.querySelectorAll(".kb-ing-name").forEach(el => el.addEventListener("input", () => {
      draft.zutaten[el.dataset.i].name = el.value; dirty = true;
    }));
    list.querySelectorAll(".kb-ing-menge").forEach(el => el.addEventListener("input", () => {
      const v = el.value.trim();
      const m = v.match(/^(\d+(?:[.,]\d+)?)\s*g$/i);
      const z = draft.zutaten[el.dataset.i];
      if (m) { z.gramm = parseFloat(m[1].replace(",", ".")); z.mengentext = null; }
      else { z.gramm = null; z.mengentext = v || null; }
      dirty = true;
    }));
    list.querySelectorAll(".kb-remove").forEach(el => el.addEventListener("click", () => {
      draft.zutaten.splice(el.dataset.i, 1); dirty = true; drawIngredients();
    }));
  }

  function drawSteps() {
    const list = container.querySelector("#stepEditList");
    list.innerHTML = draft.schritte.map((s, i) => `
      <li>
        <span class="kb-step-num">${i + 1}.</span>
        <textarea class="kb-step-text-edit" data-i="${i}" rows="2">${esc(s.text)}</textarea>
        <input type="number" class="kb-step-min-edit" data-i="${i}" min="0" placeholder="Min." value="${s.minuten ?? ""}">
        <button type="button" class="kb-icon-btn kb-remove" data-i="${i}" aria-label="Entfernen">✕</button>
      </li>
    `).join("") || `<li class="kb-hint">Noch keine Schritte.</li>`;

    list.querySelectorAll(".kb-step-text-edit").forEach(el => el.addEventListener("input", () => {
      draft.schritte[el.dataset.i].text = el.value; dirty = true;
    }));
    list.querySelectorAll(".kb-step-min-edit").forEach(el => el.addEventListener("input", () => {
      draft.schritte[el.dataset.i].minuten = el.value ? Number(el.value) : null; dirty = true;
    }));
    list.querySelectorAll(".kb-remove").forEach(el => el.addEventListener("click", () => {
      draft.schritte.splice(el.dataset.i, 1); dirty = true; drawSteps();
    }));
  }

  function drawGallery() {
    const wrap = container.querySelector("#galleryEdit");
    wrap.innerHTML = draft.bilder.map(b => `
      <div class="kb-gallery-edit-item ${b.id === draft.titelbild_id ? "is-title" : ""}">
        <img src="${esc(publicFotoUrl(b.pfad))}" alt="">
        <div class="kb-gallery-edit-actions">
          ${b.id !== draft.titelbild_id ? `<button type="button" class="kb-icon-btn" data-title="${b.id}" title="Als Titelbild">⭐</button>` : `<span class="kb-title-badge">Titelbild</span>`}
          <button type="button" class="kb-icon-btn" data-del="${b.id}" title="Löschen">🗑️</button>
        </div>
      </div>
    `).join("") || `<p class="kb-hint">Noch keine Fotos.</p>`;

    wrap.querySelectorAll("[data-title]").forEach(btn => btn.addEventListener("click", async () => {
      const bildId = btn.dataset.title;
      try { await setTitelbild(id, bildId); draft.titelbild_id = bildId; drawGallery(); }
      catch { showToast("Konnte Titelbild nicht setzen"); }
    }));
    wrap.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", async () => {
      const bildId = btn.dataset.del;
      const bild = draft.bilder.find(b => b.id === bildId);
      if (!bild || !confirm("Foto löschen?")) return;
      try {
        await deleteFoto(bild);
        draft.bilder = draft.bilder.filter(b => b.id !== bildId);
        if (draft.titelbild_id === bildId) draft.titelbild_id = draft.bilder[0]?.id || null;
        drawGallery();
      } catch { showToast("Löschen fehlgeschlagen"); }
    }));
  }

  async function save() {
    const btn = container.querySelector("#saveBtn");
    btn.disabled = true;
    btn.textContent = "Speichert …";
    const titel = container.querySelector("#f_titel").value.trim() || "Neues Rezept";
    const portionen = Number(container.querySelector("#f_portionen").value) || 1;

    // Erst die endgültige Zutatenliste, dann daraus die Nährwerte, dann speichern.
    // Ohne diesen Schritt blieb in naehrwerte der Stand des letzten Imports aus der
    // Keto-App stehen: die Liste zeigte vier Zutaten, die Kacheln darüber rechneten
    // weiter mit fünf.
    const zutatenFuerDb = draft.zutaten.filter(z => z.name.trim()).map(z => ({
      name: z.name.trim(), gramm: z.gramm ?? null, mengentext: z.mengentext || null,
      abschnitt: z.abschnitt || null, per100: z.per100 || null, likely_us_label: !!z.likely_us_label,
    }));

    const patch = {
      titel,
      untertitel: container.querySelector("#f_untertitel").value.trim() || null,
      portionen,
      vorbereitung_min: numOrNull(container.querySelector("#f_vorb").value),
      koch_min: numOrNull(container.querySelector("#f_koch").value),
      schwierigkeit: numOrNull(container.querySelector("#f_schwierigkeit").value),
      ofen_c: numOrNull(container.querySelector("#f_ofen").value),
      tags: container.querySelector("#f_tags").value.split(",").map(t => t.trim()).filter(Boolean),
      notizen: container.querySelector("#f_notizen").value.trim() || null,
      geaendert_von: getWhoAmI(),
    };
    // naehrwerte_manuell setzt derzeit niemand — die Abfrage steht hier, damit von Hand
    // eingetragene Werte nicht überschrieben werden, sobald es die Möglichkeit gibt.
    if (!rezept.naehrwerte_manuell) {
      patch.naehrwerte = calcPerServingFromZutaten(zutatenFuerDb, portionen);
    }

    try {
      let saved = await updateRezeptHead(id, patch, draft.updated_at);
      if (!saved) {
        const overwrite = confirm(
          "Dieses Rezept wurde gerade von jemand anderem geändert.\n\n" +
          "OK = deine Fassung trotzdem speichern (überschreibt die andere Änderung)\n" +
          "Abbrechen = nichts speichern, Seite neu laden"
        );
        if (!overwrite) { location.reload(); return; }
        saved = await forceUpdateRezeptHead(id, patch);
      }
      draft.updated_at = saved.updated_at;
      await replaceZutaten(id, zutatenFuerDb);
      await replaceSchritte(id, draft.schritte.filter(s => s.text.trim()).map(s => ({
        text: s.text.trim(), minuten: s.minuten ?? null,
      })));
      dirty = false;
      showToast("Gespeichert");
      onSaved(id);
    } catch (err) {
      showToast(err.message || "Speichern fehlgeschlagen — offline?");
    } finally {
      btn.disabled = false;
      btn.textContent = "Speichern";
    }
  }
}

function numOrNull(v) {
  return v === "" || v == null ? null : Number(v);
}
