// views/onboarding.js — Ersteinrichtung bei ganz neuen Geräten, als dreistufiger Assistent:
// 1 Name(n), 2 Körperdaten (mit live berechneten Zielen), 3 Ziel & Ernährungsform.
// Jeder Schritt passt ohne Scrollen aufs Handy und hat genau eine Frage — so landet niemand
// direkt nach der Installation auf einem Dashboard mit fremden Standardwerten.
import { Store } from "../store.js";
import { calcTargets, Goals, ActivityLevels } from "../profiles.js";
import { DIET_TYPES } from "../keto.js";
import { esc, showToast } from "../ui.js";

const TOTAL_STEPS = 3;

export function renderOnboarding(container, onComplete) {
  // Dieselben Grundwerte wie defaultProfile() in store.js — der Assistent verändert nur,
  // was tatsächlich beantwortet wird.
  const data = {
    name1: "", shared: false, name2: "",
    sex: "female", age: 35, heightCm: 170, weightKg: 70,
    activity: 1.375, goal: "lose", deficitPct: 15,
    proteinFactor: 1.6, netCarbLimitG: 20, dietType: "keto",
  };
  let step = 1;

  const finish = () => {
    const profiles = Store.get().profiles;
    Store.updateProfile(profiles[0].id, {
      name: data.name1 || profiles[0].name,
      sex: data.sex, age: data.age, heightCm: data.heightCm, weightKg: data.weightKg,
      activity: data.activity, goal: data.goal, deficitPct: data.deficitPct,
      proteinFactor: data.proteinFactor, netCarbLimitG: data.netCarbLimitG, dietType: data.dietType,
      gradeThresholds: DIET_TYPES[data.dietType]?.defaultThresholds || profiles[0].gradeThresholds,
    });
    Store.updateProfile(profiles[1].id, { name: data.shared && data.name2 ? data.name2 : "Profil 2" });
    Store.setActiveProfile(profiles[0].id);
    Store.setOnboarded();
    onComplete();
  };

  // Funktion statt statischem Objekt: Schritt 2 nennt den gerade eingegebenen Namen — als
  // vorberechnete Objektzuordnung stünde beim ersten Durchlauf noch der alte (leere) Stand,
  // weil der Name erst im Weiter-Handler von Schritt 1 in `data` landet, nachdem der Titel für
  // Schritt 2 schon gebaut wäre.
  function stepTitle(s) {
    if (s === 1) return "Wie heißt du?";
    if (s === 2) return `Deine Körperdaten${data.name1 ? `, ${data.name1}` : ""}`;
    return "Ziel & Ernährungsform";
  }

  function shell(subtitle, bodyHtml, { showSkip = false } = {}) {
    container.innerHTML = `
      <div class="klar-ob">
        <div class="klar-ob-head">
          ${step > 1 ? `<button type="button" class="klar-back-btn" id="obBack" aria-label="Zurück">‹</button>` : `<span style="width:28px"></span>`}
          <span class="klar-ob-progress">${step}/${TOTAL_STEPS}</span>
        </div>
        <h1 class="klar-ob-title">${esc(stepTitle(step))}</h1>
        <p class="klar-ob-subtitle">${subtitle}</p>
        <div class="klar-ob-body">${bodyHtml}</div>
      </div>
      <div class="klar-ob-footer">
        <button type="button" class="btn" id="obNext">${step < TOTAL_STEPS ? "Weiter" : "Los geht's"}</button>
        ${showSkip ? `<button type="button" class="btn ghost" id="obSkip">Überspringen — mit Richtwerten starten</button>` : ""}
      </div>
    `;
    container.querySelector("#obBack")?.addEventListener("click", () => { step--; render(); });
    container.querySelector("#obSkip")?.addEventListener("click", finish);
  }

  function renderStep1() {
    shell("Alles bleibt nur auf diesem Gerät gespeichert.", `
      <label for="obName1">Dein Name</label>
      <input type="text" id="obName1" placeholder="Dein Name" autocomplete="off" value="${esc(data.name1)}">
      <label style="margin-top:16px;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="obShared" style="width:auto;min-height:auto" ${data.shared ? "checked" : ""}>
        <span>Dieses Gerät wird noch von jemand anderem genutzt</span>
      </label>
      <div id="obName2Wrap" style="display:${data.shared ? "block" : "none"};margin-top:6px">
        <label for="obName2">Name der zweiten Person</label>
        <input type="text" id="obName2" placeholder="z.B. Partner:in" autocomplete="off" value="${esc(data.name2)}">
      </div>
    `);
    const wrap2 = container.querySelector("#obName2Wrap");
    container.querySelector("#obShared").addEventListener("change", (e) => {
      data.shared = e.target.checked;
      wrap2.style.display = data.shared ? "block" : "none";
    });
    container.querySelector("#obNext").addEventListener("click", () => {
      data.name1 = container.querySelector("#obName1").value.trim();
      if (!data.name1) { showToast("Bitte deinen Namen eingeben"); return; }
      data.name2 = container.querySelector("#obName2").value.trim();
      step = 2;
      render();
    });
    container.querySelector("#obName1").focus();
  }

  function renderStep2() {
    shell("Daraus rechnet die App deine Tagesziele. Du kannst alles später im Profil ändern — oder überspringen und mit Richtwerten starten.", `
      <div class="klar-ob-sex">
        <button type="button" class="klar-ob-sex-btn ${data.sex === "female" ? "active" : ""}" data-sex="female">weiblich</button>
        <button type="button" class="klar-ob-sex-btn ${data.sex === "male" ? "active" : ""}" data-sex="male">männlich</button>
      </div>
      ${stepperRow("obAge", "Alter", data.age, "", 1, 10, 100)}
      ${stepperRow("obHeight", "Größe", data.heightCm, "cm", 1, 100, 230)}
      ${stepperRow("obWeight", "Gewicht", data.weightKg, "kg", 0.5, 30, 250)}
      <div class="klar-result-card" id="obTargetsCard" style="margin-top:16px"></div>
      <p class="hint" style="text-align:center;margin-top:8px">Ändert sich live mit deinen Angaben · Ziel und Ernährungsform kommen im nächsten Schritt</p>
    `, { showSkip: true });

    container.querySelectorAll(".klar-ob-sex-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        data.sex = btn.dataset.sex;
        container.querySelectorAll(".klar-ob-sex-btn").forEach(b => b.classList.toggle("active", b === btn));
        updateTargetsPreview();
      });
    });
    wireStepper("obAge", "age", 1, 10, 100);
    wireStepper("obHeight", "heightCm", 1, 100, 230);
    wireStepper("obWeight", "weightKg", 0.5, 30, 250);
    updateTargetsPreview();

    container.querySelector("#obNext").addEventListener("click", () => { step = 3; render(); });
  }

  function renderStep3() {
    shell("Letzter Schritt — danach geht's direkt aufs Dashboard.", `
      <label for="obGoal">Ziel</label>
      <select id="obGoal">
        ${Object.entries(Goals).map(([val, label]) => `<option value="${val}" ${val === data.goal ? "selected" : ""}>${esc(label)}</option>`).join("")}
      </select>
      <div id="obDeficitWrap" style="display:${data.goal === "lose" ? "block" : "none"}">
        <label for="obDeficit">Kaloriendefizit</label>
        <select id="obDeficit">
          ${[10, 15, 20, 25].map(v => `<option value="${v}" ${v === data.deficitPct ? "selected" : ""}>${v}%</option>`).join("")}
        </select>
      </div>
      <label for="obActivity">Aktivitätslevel</label>
      <select id="obActivity">
        ${Object.entries(ActivityLevels).map(([val, label]) => `<option value="${val}" ${Number(val) === data.activity ? "selected" : ""}>${esc(label)}</option>`).join("")}
      </select>
      <label for="obDiet" style="margin-top:16px">Ernährungsform</label>
      <select id="obDiet">
        ${Object.entries(DIET_TYPES).map(([key, d]) => `<option value="${key}" ${key === data.dietType ? "selected" : ""}>${esc(d.label)}</option>`).join("")}
      </select>
      <p class="hint" style="margin-top:-2px">Bestimmt die Vorschlagswerte für die Ampel — frei anpassbar im Profil.</p>
      <div class="klar-result-card" id="obTargetsCard" style="margin-top:16px"></div>
    `, { showSkip: true });

    container.querySelector("#obGoal").addEventListener("change", (e) => {
      data.goal = e.target.value;
      container.querySelector("#obDeficitWrap").style.display = data.goal === "lose" ? "block" : "none";
      updateTargetsPreview();
    });
    container.querySelector("#obDeficit").addEventListener("change", (e) => {
      data.deficitPct = Number(e.target.value);
      updateTargetsPreview();
    });
    container.querySelector("#obActivity").addEventListener("change", (e) => {
      data.activity = Number(e.target.value);
      updateTargetsPreview();
    });
    container.querySelector("#obDiet").addEventListener("change", (e) => {
      data.dietType = e.target.value;
    });
    updateTargetsPreview();

    container.querySelector("#obNext").addEventListener("click", finish);
  }

  /** ±-Stepper-Zeile: 44px Tippziele statt Tastatureingabe — schneller unterwegs, und die
   * Tastatur verdeckt die Zielkarte nicht. */
  function stepperRow(id, label, value, unit, step_, min, max) {
    return `
      <div class="klar-ob-stepper-row">
        <span class="klar-ob-stepper-label">${esc(label)}</span>
        <div class="klar-stepper">
          <button type="button" class="klar-stepper-btn" id="${id}Minus" aria-label="weniger">−</button>
          <span class="klar-stepper-val" id="${id}Val">${value}${unit}</span>
          <button type="button" class="klar-stepper-btn" id="${id}Plus" aria-label="mehr">+</button>
        </div>
      </div>
    `;
  }

  function wireStepper(id, field, step_, min, max) {
    const unit = field === "heightCm" ? "cm" : field === "weightKg" ? "kg" : "";
    const valEl = container.querySelector(`#${id}Val`);
    const apply = (delta) => {
      const next = Math.round((data[field] + delta) * 10) / 10;
      if (next < min || next > max) return;
      data[field] = next;
      valEl.textContent = `${next}${unit}`;
      updateTargetsPreview();
    };
    container.querySelector(`#${id}Minus`).addEventListener("click", () => apply(-step_));
    container.querySelector(`#${id}Plus`).addEventListener("click", () => apply(step_));
  }

  function updateTargetsPreview() {
    const card = container.querySelector("#obTargetsCard");
    if (!card) return;
    const t = calcTargets(data);
    card.innerHTML = `
      <div class="klar-result-head">
        <span class="klar-result-eyebrow">Damit wären deine Ziele</span>
      </div>
      <div class="klar-tile-grid" style="margin-top:10px">
        <div class="klar-tile"><div class="val">${t.kcal}</div><div class="lbl">kcal</div></div>
        <div class="klar-tile"><div class="val">${t.netCarbG}</div><div class="lbl">g Netto-KH</div></div>
        <div class="klar-tile"><div class="val">${t.fatG}</div><div class="lbl">g Fett</div></div>
        <div class="klar-tile"><div class="val">${t.proteinG}</div><div class="lbl">g Eiweiß</div></div>
      </div>
    `;
  }

  function render() {
    if (step === 1) renderStep1();
    else if (step === 2) renderStep2();
    else renderStep3();
  }

  render();
}
