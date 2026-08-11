// views/start.js — Startseite: Zielwerte des aktiven Profils + zuletzt gescannte Produkte.
import { Store } from "../store.js";
import { calcTargets } from "../profiles.js";
import { lookupProduct } from "../off.js";
import { evaluateProduct } from "../keto.js";
import { esc } from "../ui.js";

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

    <button class="btn" id="startScanBtn">📷 Produkt scannen</button>

    <h2 class="section-title" style="margin-top:24px">Zuletzt gescannt</h2>
    <div id="recentList"><p class="muted">Lädt …</p></div>
  `;

  container.querySelector("#startScanBtn").addEventListener("click", () => goToTab("scan"));

  renderRecent(container, profile, targets);
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
      rows.push(`
        <div class="list-item">
          <span class="badge ${evalResult.grade}" style="flex-shrink:0">${{ green: "🟢", yellow: "🟡", red: "🔴" }[evalResult.grade] || "⚪"}</span>
          <div class="info">
            <div class="name">${esc(product.name)}</div>
            <div class="meta">${esc(product.brand || "")}${evalResult.netCarbs100 != null ? ` · ${evalResult.netCarbs100} g Netto-KH/100g` : ""}</div>
          </div>
        </div>
      `);
    } catch {
      // Produkt evtl. offline nicht verfügbar — überspringen statt Fehler zu zeigen
    }
  }
  el.innerHTML = rows.join("") || `<p class="muted">Keine Details verfügbar (offline?).</p>`;
}
