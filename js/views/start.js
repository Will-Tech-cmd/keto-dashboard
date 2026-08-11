// views/start.js — Startseite: Zielwerte, Tagesverbrauch, zuletzt gescannte Produkte.
import { Store } from "../store.js";
import { calcTargets } from "../profiles.js";
import { lookupProduct } from "../off.js";
import { evaluateProduct } from "../keto.js";
import { getTodayConsumption, sumConsumption, openQuantityModal } from "../consumption.js";
import { esc, showToast } from "../ui.js";

export async function renderStart(container, goToTab) {
  const profile = Store.getActiveProfile();
  const targets = calcTargets(profile);

  container.innerHTML = `
    <h1 class="section-title">Hallo, ${esc(profile.name)} 👋</h1>
    <div class="card">
      <h2>Deine Tagesziele</h2>
      <div class="grid-2">
        <div class="stat"><div class="val">${targets.kcal}</div><div class="lbl">kcal</div></div>
        <div class="stat"><div class="val">${targets.netCarbG} g</div><div class="lbl">Netto-Kohlenhydrate</div></div>
        <div class="stat"><div class="val">${targets.fatG} g</div><div class="lbl">Fett</div></div>
        <div class="stat"><div class="val">${targets.proteinG} g</div><div class="lbl">Eiweiß</div></div>
      </div>
      <p class="hint">Verteilung ca. ${targets.percent.fat}% Fett · ${targets.percent.protein}% Eiweiß · ${targets.percent.carbs}% Kohlenhydrate — diese Prozentwerte kannst du 1:1 in Yazio eintragen.</p>
    </div>

    <h2 class="section-title" style="margin-top:24px">Heute verbraucht</h2>
    <div id="consumptionCard" class="card"></div>
    <div id="consumptionList"></div>

    <button class="btn" id="startScanBtn" style="margin-top:20px">📷 Produkt scannen</button>

    <h2 class="section-title" style="margin-top:24px">Zuletzt gescannt</h2>
    <p class="hint" style="margin-top:-8px">Zum Eintragen einer Menge auf ein Produkt tippen.</p>
    <div id="recentList"><p class="muted">Lädt …</p></div>
  `;

  container.querySelector("#startScanBtn").addEventListener("click", () => goToTab("scan"));

  renderConsumption(container, profile, targets);
  renderRecent(container, profile, targets);
}

function renderConsumption(container, profile, targets) {
  const entries = getTodayConsumption(profile.id);
  const totals = sumConsumption(entries);

  const rows = [
    { key: "kcal", label: "Kalorien", unit: "kcal", target: targets.kcal, consumed: totals.kcal },
    { key: "netCarbs", label: "Netto-Kohlenhydrate", unit: "g", target: targets.netCarbG, consumed: totals.netCarbs },
    { key: "fat", label: "Fett", unit: "g", target: targets.fatG, consumed: totals.fat },
    { key: "protein", label: "Eiweiß", unit: "g", target: targets.proteinG, consumed: totals.protein },
  ];

  container.querySelector("#consumptionCard").innerHTML = rows.map(r => {
    const pct = r.target > 0 ? Math.min((r.consumed / r.target) * 100, 100) : 0;
    const over = r.consumed > r.target;
    const remaining = Math.round((r.target - r.consumed) * 10) / 10;
    return `
      <div class="progress-row">
        <div class="progress-labels">
          <span class="name">${r.label}</span>
          <span class="nums">${round1(r.consumed)} / ${r.target} ${r.unit}</span>
        </div>
        <div class="progress-track"><div class="progress-fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>
        ${over
          ? `<div class="progress-over-label">${Math.abs(remaining)} ${r.unit} über Ziel</div>`
          : `<div class="hint" style="margin-top:3px">${remaining} ${r.unit} übrig</div>`}
      </div>
    `;
  }).join("");

  const listEl = container.querySelector("#consumptionList");
  if (entries.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><span class="emoji">🍽️</span>Heute noch nichts eingetragen.</div>`;
    return;
  }
  listEl.innerHTML = entries.map(e => `
    <div class="list-item" data-id="${e.id}">
      <div class="info">
        <div class="name">${esc(e.name)} · ${e.grams} g</div>
        <div class="meta">${e.kcal ?? "–"} kcal · ${e.netCarbs ?? "–"} g Netto-KH · ${new Date(e.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
      <button class="icon-btn" data-action="undo" title="Entfernen">↩️</button>
    </div>
  `).join("");

  listEl.querySelectorAll(".list-item").forEach(row => {
    row.querySelector('[data-action="undo"]').addEventListener("click", () => {
      Store.removeConsumption(row.dataset.id);
      showToast("Eintrag entfernt");
      renderConsumption(container, profile, targets);
    });
  });
}

async function renderRecent(container, profile, targets) {
  const el = container.querySelector("#recentList");
  const recent = Store.getRecent();
  if (recent.length === 0) {
    el.innerHTML = `<div class="empty-state"><span class="emoji">📦</span>Noch nichts gescannt.</div>`;
    return;
  }

  const rows = [];
  for (const barcode of recent.slice(0, 5)) {
    try {
      const product = await lookupProduct(barcode);
      const evalResult = evaluateProduct(product, targets);
      rows.push({ product, evalResult });
    } catch {
      // Produkt evtl. offline nicht verfügbar — überspringen statt Fehler zu zeigen
    }
  }

  if (rows.length === 0) {
    el.innerHTML = `<p class="muted">Keine Details verfügbar (offline?).</p>`;
    return;
  }

  el.innerHTML = rows.map(({ product, evalResult }, i) => `
    <div class="list-item" data-idx="${i}" style="cursor:pointer">
      <span class="badge ${evalResult.grade}" style="flex-shrink:0">${{ green: "🟢", yellow: "🟡", red: "🔴" }[evalResult.grade] || "⚪"}</span>
      <div class="info">
        <div class="name">${esc(product.name)}</div>
        <div class="meta">${esc(product.brand || "")}${evalResult.netCarbs100 != null ? ` · ${evalResult.netCarbs100} g Netto-KH/100g` : ""}</div>
      </div>
      <span class="icon-btn" title="Menge eintragen" style="pointer-events:none">🍽️</span>
    </div>
  `).join("");

  el.querySelectorAll(".list-item").forEach(row => {
    row.addEventListener("click", () => {
      const { product } = rows[Number(row.dataset.idx)];
      openQuantityModal(product, () => renderConsumption(container, profile, targets));
    });
  });
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
