// views/planer.js — die Seite, auf der die nächsten Tage beplant werden.
//
// Unterseite ohne eigenen Reiter, wie die Auswertung: die Tableiste ist mit fünf Reitern voll,
// und Planen ist nichts, was man zehnmal am Tag aufruft. Der Weg dorthin führt über die
// Startseite, wo ohnehin steht, wie der Tag aussieht.
//
// Die Seite selbst rechnet nichts — sie zeigt, was planer.js zusammengestellt hat, und lässt
// es ändern. Alle Zahlen stammen aus dem Plan, nicht aus einer zweiten Rechnung.

import { Store, dateKeyOf, shiftDateKey } from "../store.js";
import { getTargetsForDate } from "../profiles.js";
import { dateLabel, mealShort } from "../consumption.js";
import { hasApiKey, verfeinerePlan, describeAiError } from "../ai.js";
import { esc, showToast, showSnackbar } from "../ui.js";
import * as Planer from "../planer.js";

const round1 = (v) => Math.round(v * 10) / 10;

// Der Zustand der Seite lebt nur, solange sie offen ist — ein Plan, den man nicht übernommen
// hat, ist bewusst nichts, was den nächsten App-Start überdauert.
let anzahlTage = 3;
let abMorgen = true;
let mitSnack = false;
let plan = null;
let katalog = null;
let saat = 1;

export function renderPlanerPage(container, goToTab) {
  container.innerHTML = `
    <div class="klar-page-head">
      <button type="button" class="klar-back-btn" id="planBack" aria-label="Zurück">‹</button>
      <span class="klar-page-title">Tage planen</span>
    </div>
    <div id="planBody"></div>
  `;
  container.querySelector("#planBack").addEventListener("click", () => goToTab("start"));
  render(container.querySelector("#planBody"), goToTab);
}

/** Die Tage, um die es geht — abhängig von "ab heute"/"ab morgen" und der Anzahl. */
function tageKeys() {
  const heute = dateKeyOf(Date.now());
  return Planer.planTage(abMorgen ? shiftDateKey(heute, 1) : heute, anzahlTage);
}

function mahlzeitenListe() {
  return mitSnack ? ["breakfast", "lunch", "dinner", "snack"] : ["breakfast", "lunch", "dinner"];
}

function render(body, goToTab) {
  const profile = Store.getActiveProfile();
  const keys = tageKeys();

  body.innerHTML = `
    <div class="klar-card">
      <div class="klar-eyebrow">Wie viele Tage</div>
      <div class="klar-chip-row" style="margin-top:10px">
        ${[1, 2, 3, 4].map(n => `
          <button type="button" class="klar-chip ${n === anzahlTage ? "top" : ""}" data-tage="${n}">
            ${n} ${n === 1 ? "Tag" : "Tage"}
          </button>
        `).join("")}
      </div>

      <div class="klar-eyebrow" style="margin-top:18px">Ab wann</div>
      <div class="klar-meal-segments" style="margin-top:8px">
        <button type="button" class="klar-meal-segment ${abMorgen ? "" : "active"}" data-start="heute">Heute</button>
        <button type="button" class="klar-meal-segment ${abMorgen ? "active" : ""}" data-start="morgen">Morgen</button>
      </div>

      <div class="klar-water-head" style="margin-top:18px">
        <span class="klar-water-title">Snacks mitplanen</span>
        <button type="button" class="klar-pill-btn ${mitSnack ? "is-an" : ""}" id="snackSchalter">
          ${mitSnack ? "an" : "aus"}
        </button>
      </div>

      <div class="klar-hint" style="margin-top:14px">
        ${esc(dateLabel(keys[0]))} bis ${esc(dateLabel(keys[keys.length - 1]))} ·
        ${esc(profile.name)} · Ziel ${getTargetsForDate(profile, keys[0]).netCarbG} g Netto-KH am Tag
      </div>

      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn" id="planBauen">${plan ? "Neu würfeln" : "Plan erstellen"}</button>
      </div>
      ${hasApiKey() && plan ? `
        <button type="button" class="btn ghost" id="planKi" style="margin-top:8px">✨ Mit KI verfeinern</button>
      ` : ""}
    </div>

    <div id="planTage"></div>
    <div id="planFuss"></div>
  `;

  const neu = () => render(body, goToTab);

  body.querySelectorAll("[data-tage]").forEach(btn => {
    btn.addEventListener("click", () => { anzahlTage = Number(btn.dataset.tage); plan = null; neu(); });
  });
  body.querySelectorAll("[data-start]").forEach(btn => {
    btn.addEventListener("click", () => { abMorgen = btn.dataset.start === "morgen"; plan = null; neu(); });
  });
  body.querySelector("#snackSchalter").addEventListener("click", () => {
    mitSnack = !mitSnack; plan = null; neu();
  });
  body.querySelector("#planBauen").addEventListener("click", () => { baue(profile); neu(); });
  body.querySelector("#planKi")?.addEventListener("click", () => verfeinere(body, goToTab));

  zeichneTage(body, neu);
  zeichneFuss(body, profile, goToTab, neu);
}

function baue(profile) {
  katalog = Planer.sammleKatalog(profile.id);
  const keys = tageKeys();
  saat = Math.floor(Math.random() * 1e9);
  plan = Planer.erstellePlan({
    katalog,
    // Die Zielwerte des ERSTEN Tages gelten für den ganzen Plan. Für die kommenden Tage sind
    // sie ohnehin dieselben — sie werden erst beim Anzeigen des Tages festgeschrieben.
    ziele: getTargetsForDate(profile, keys[0]),
    dateKeys: keys,
    mahlzeiten: mahlzeitenListe(),
    saat,
  });
}

// ---------------------------------------------------------------------------
// Die Tage
// ---------------------------------------------------------------------------

function zeichneTage(body, neu) {
  const el = body.querySelector("#planTage");
  if (!plan) {
    el.innerHTML = `
      <div class="klar-hint" style="margin-top:18px">
        Der Plan entsteht aus deinen eigenen Rezepten, deinen Favoriten und dem, was du in den
        letzten Wochen wirklich gegessen hast — passend zur Tageszeit und ohne dein
        KH-Limit zu reißen. Nichts wird erfunden, deshalb stimmen die Nährwerte.
      </div>
    `;
    return;
  }

  if (katalog && katalog.length < 4) {
    el.innerHTML = `
      <div class="klar-hint" style="margin-top:18px">
        Für einen abwechslungsreichen Plan sind zu wenige Gerichte hinterlegt
        (${katalog.length}). Trag ein paar Tage normal ein oder leg Rezepte an — dann wird
        der Vorschlag deutlich besser.
      </div>
    `;
  } else {
    el.innerHTML = "";
  }

  el.insertAdjacentHTML("beforeend", plan.map((tag, i) => tagKarteHtml(tag, i)).join(""));

  el.querySelectorAll("[data-tausch]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [i, slot, idx] = btn.dataset.tausch.split("|");
      saat = (saat + 7919) >>> 0;
      plan = plan.map((t, n) => (
        n === Number(i) ? Planer.tauscheZeile(t, slot, Number(idx), { katalog, saat }) : t
      ));
      neu();
    });
  });
}

function tagKarteHtml(tag, index) {
  const mahlzeiten = mahlzeitenListe();
  if (tag.leer) {
    return `
      <div class="klar-card" style="margin-top:14px">
        <div class="klar-eyebrow">${esc(dateLabel(tag.dateKey))}</div>
        <div class="klar-hint" style="margin-top:8px">Für diesen Tag ließ sich nichts zusammenstellen.</div>
      </div>
    `;
  }

  const zeilen = mahlzeiten.map(slot => {
    const items = tag.mahlzeiten[slot] || [];
    if (items.length === 0) return "";
    return `
      <div class="klar-meal-group-title">${esc(mealShort(slot))}</div>
      ${items.map((z, idx) => `
        <div class="klar-plan-row">
          <div class="text">
            <div class="name">${esc(z.name)}</div>
            <div class="meta">${mengeText(z)} · ${Math.round(z.kcal ?? 0)} kcal · ${round1(z.netCarbs ?? 0)} g KH</div>
          </div>
          <button type="button" class="icon-btn" data-tausch="${index}|${slot}|${idx}"
            title="Anderes Gericht vorschlagen" aria-label="Tauschen">🔄</button>
        </div>
      `).join("")}
    `;
  }).join("");

  return `
    <div class="klar-card" style="margin-top:14px">
      <div class="klar-card-head">
        <span class="klar-eyebrow">${esc(dateLabel(tag.dateKey))}</span>
        <span class="klar-water-value">${Math.round(tag.summe.kcal)} / ${tag.ziele.kcal} kcal</span>
      </div>
      ${tag.ueberLimit ? `
        <div class="klar-hint" style="color:var(--warm)">
          Über dem KH-Limit — mit dem, was hinterlegt ist, geht es an diesem Tag nicht enger.
        </div>
      ` : ""}
      <div class="klar-meals-card" style="margin-top:6px">${zeilen}</div>
      ${abweichungHtml(tag)}
    </div>
  `;
}

function mengeText(z) {
  return z.einheit === "portion"
    ? `${round1(z.menge)} P.${z.servingG ? ` (${Math.round(z.servingG * z.menge)} g)` : ""}`
    : `${z.menge} g`;
}

/** Ist/Soll in einer Zeile — dieselben vier Werte wie die Ringe auf der Startseite. */
function abweichungHtml(tag) {
  const werte = [
    ["Netto-KH", round1(tag.summe.netCarbs), tag.ziele.netCarbG, "g"],
    ["Fett", round1(tag.summe.fat), tag.ziele.fatG, "g"],
    ["Eiweiß", round1(tag.summe.protein), tag.ziele.proteinG, "g"],
  ];
  return `
    <div class="klar-meal-group-macros" style="margin-top:10px">
      ${werte.map(([label, ist, soll, einheit]) => `
        <span><b>${ist}</b> / ${soll} ${esc(einheit)} ${esc(label)}</span>
      `).join("")}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Übernehmen und einkaufen
// ---------------------------------------------------------------------------

function zeichneFuss(body, profile, goToTab, neu) {
  const el = body.querySelector("#planFuss");
  if (!plan || plan.every(t => t.leer)) { el.innerHTML = ""; return; }

  const keys = tageKeys();
  const schonGeplant = keys.reduce((s, k) => s + Planer.geplanteEintraege(profile.id, k).length, 0);

  el.innerHTML = `
    ${schonGeplant > 0 ? `
      <div class="klar-hint" style="margin-top:16px">
        Für diese Tage stehen bereits ${schonGeplant} vorgemerkte Mahlzeiten. Beim Übernehmen
        werden sie ersetzt; schon bestätigte Einträge bleiben stehen.
      </div>
    ` : ""}
    <div class="btn-row" style="margin-top:16px">
      <button type="button" class="btn secondary" id="planEinkauf">🛒 Zutaten</button>
      <button type="button" class="btn" id="planUebernehmen">Plan übernehmen</button>
    </div>
  `;

  el.querySelector("#planEinkauf").addEventListener("click", () => {
    const zutaten = Planer.zutatenFuerPlan(plan);
    const gesetzt = Planer.aufEinkaufsliste(zutaten);
    showSnackbar({
      title: gesetzt > 0 ? `${gesetzt} Zutat(en) auf der Einkaufsliste` : "Steht schon alles drauf",
      subtitle: zutaten.slice(0, 3).map(z => z.name).join(", ") + (zutaten.length > 3 ? " …" : ""),
      action: { label: "Ansehen", onClick: () => goToTab("lists", { sub: "shopping" }) },
    });
  });

  el.querySelector("#planUebernehmen").addEventListener("click", () => {
    for (const k of keys) Planer.verwirfPlan(profile.id, k);
    const eintraege = Planer.uebernehmePlan(plan, profile.id);
    showSnackbar({
      title: `${eintraege.length} Mahlzeiten vorgemerkt`,
      subtitle: `${esc(dateLabel(keys[0]))} bis ${esc(dateLabel(keys[keys.length - 1]))} — beim Essen bestätigen`,
      onUndo: () => {
        for (const e of eintraege) Store.removeConsumption(e.id);
        neu();
      },
    });
    goToTab("start");
  });
}

// ---------------------------------------------------------------------------
// Verfeinern
// ---------------------------------------------------------------------------

async function verfeinere(body, goToTab) {
  const btn = body.querySelector("#planKi");
  if (!btn || !plan || !katalog) return;
  btn.disabled = true;
  btn.textContent = "Gemini denkt nach …";
  try {
    const vorschlag = await verfeinerePlan({
      katalog,
      ziele: plan[0].ziele,
      tage: plan.map(t => t.dateKey),
      mahlzeiten: mahlzeitenListe(),
    });
    const gebaut = Planer.ausVorschlag(vorschlag, {
      katalog, ziele: plan[0].ziele, dateKeys: plan.map(t => t.dateKey), mahlzeiten: mahlzeitenListe(),
    });
    // Kommt nichts Verwertbares zurück, bleibt der bisherige Plan stehen — ein leerer
    // Bildschirm wäre das schlechtere Ergebnis als ein Vorschlag, der schon da war.
    if (gebaut.some(t => !t.leer)) {
      plan = gebaut;
      showToast("Vorschlag übernommen");
    } else {
      showToast("Gemini hatte nichts Passendes — der bisherige Plan bleibt");
    }
  } catch (err) {
    showToast(describeAiError(err));
  } finally {
    render(body, goToTab);
  }
}
