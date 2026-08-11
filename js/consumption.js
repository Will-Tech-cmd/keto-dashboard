// consumption.js — Menge "gegessen" eintragen und mit dem Tagesziel verrechnen.
import { Store } from "./store.js";
import { calcNetCarbs, parseServingGrams } from "./keto.js";
import { esc, showToast } from "./ui.js";

function round1(v) {
  return v == null ? null : Math.round(v * 10) / 10;
}

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Trägt eine gegessene Menge (in Gramm) für das aktive Profil ein. */
export function logConsumption(product, grams) {
  const g = Number(grams);
  if (!g || g <= 0) return null;
  const scale = g / 100;
  const per100 = product.per100;
  const netCarbs100 = calcNetCarbs(per100, { subtractFiber: product.likelyUsLabel });
  const profile = Store.getActiveProfile();

  const entry = {
    id: crypto.randomUUID(),
    profileId: profile.id,
    barcode: product.barcode,
    name: product.name,
    grams: g,
    kcal: round1(per100.kcal != null ? per100.kcal * scale : null),
    netCarbs: round1(netCarbs100 != null ? netCarbs100 * scale : null),
    fat: round1(per100.fat != null ? per100.fat * scale : null),
    protein: round1(per100.protein != null ? per100.protein * scale : null),
    at: Date.now(),
  };
  Store.addConsumption(entry);
  return entry;
}

/** Alle heutigen Verbrauchs-Einträge eines Profils, neueste zuerst. */
export function getTodayConsumption(profileId) {
  const start = startOfToday();
  return Store.getConsumption().filter(e => e.profileId === profileId && e.at >= start);
}

/** Summiert eine Liste von Verbrauchs-Einträgen zu Gesamtwerten. */
export function sumConsumption(entries) {
  return entries.reduce((acc, e) => ({
    kcal: acc.kcal + (e.kcal || 0),
    netCarbs: acc.netCarbs + (e.netCarbs || 0),
    fat: acc.fat + (e.fat || 0),
    protein: acc.protein + (e.protein || 0),
  }), { kcal: 0, netCarbs: 0, fat: 0, protein: 0 });
}

/**
 * Öffnet einen Dialog zur Mengeneingabe für ein Produkt und trägt die gewählte Menge
 * als "gegessen" ein. `onLogged` wird nach erfolgreichem Eintrag aufgerufen (z.B. für Refresh).
 */
export function openQuantityModal(product, onLogged) {
  const servingG = parseServingGrams(product.servingSize);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2 style="text-transform:none;color:var(--text);font-size:1.1rem;font-weight:800;margin-bottom:2px">${esc(product.name)}</h2>
      <p class="hint">Gegessene Menge eintragen — wird von eurem Tagesziel abgezogen.</p>
      ${servingG ? `
        <div class="btn-row" style="flex-wrap:wrap;gap:8px;margin:10px 0">
          ${[1, 2, 3, 4].map(n => `<button type="button" class="btn secondary qty-chip" data-grams="${servingG * n}" style="width:auto;flex:none;padding:0 14px">${n}× (${servingG * n} g)</button>`).join("")}
        </div>
      ` : ""}
      <label for="qtyGramsInput">Menge in Gramm</label>
      <input type="number" id="qtyGramsInput" value="${servingG || 100}" min="1" inputmode="numeric">
      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn secondary" id="qtyCancel">Abbrechen</button>
        <button type="button" class="btn" id="qtyConfirm">Eintragen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#qtyCancel").addEventListener("click", close);
  overlay.querySelectorAll(".qty-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      overlay.querySelector("#qtyGramsInput").value = chip.dataset.grams;
    });
  });
  overlay.querySelector("#qtyConfirm").addEventListener("click", () => {
    const grams = parseFloat(overlay.querySelector("#qtyGramsInput").value);
    if (!grams || grams <= 0) {
      showToast("Bitte eine gültige Menge angeben");
      return;
    }
    logConsumption(product, grams);
    showToast(`${grams} g eingetragen`);
    close();
    onLogged?.();
  });

  overlay.querySelector("#qtyGramsInput").focus();
}
