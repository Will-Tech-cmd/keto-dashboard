// views/onboarding.js — Ersteinrichtung bei ganz neuen Geräten ("Wie heißt du?"),
// damit z.B. ein Freund die App bekommt, ohne auf fremde Namen zu treffen.
import { Store } from "../store.js";
import { esc, showToast } from "../ui.js";

export function renderOnboarding(container, onComplete) {
  container.innerHTML = `
    <div style="padding-top:8vh;max-width:420px;margin:0 auto">
      <h1 class="section-title" style="text-align:center;font-size:1.4rem">🥑 Willkommen beim Keto-Dashboard</h1>
      <p class="hint" style="text-align:center;margin-bottom:20px">Kurz einrichten, dann geht's los. Alles bleibt nur auf diesem Gerät gespeichert.</p>
      <div class="card">
        <label for="obName1">Wie heißt du?</label>
        <input type="text" id="obName1" placeholder="Dein Name" autocomplete="off">

        <label style="margin-top:16px;display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="obShared" style="width:auto;min-height:auto">
          <span>Dieses Gerät wird noch von jemand anderem genutzt</span>
        </label>
        <div id="obName2Wrap" style="display:none;margin-top:6px">
          <label for="obName2">Name der zweiten Person</label>
          <input type="text" id="obName2" placeholder="z.B. Partner:in" autocomplete="off">
        </div>
      </div>
      <button class="btn" id="obSubmit" style="margin-top:16px">Los geht's</button>
    </div>
  `;

  const wrap2 = container.querySelector("#obName2Wrap");
  container.querySelector("#obShared").addEventListener("change", (e) => {
    wrap2.style.display = e.target.checked ? "block" : "none";
  });

  container.querySelector("#obSubmit").addEventListener("click", () => {
    const name1 = container.querySelector("#obName1").value.trim();
    if (!name1) {
      showToast("Bitte deinen Namen eingeben");
      return;
    }
    const shared = container.querySelector("#obShared").checked;
    const name2 = container.querySelector("#obName2").value.trim();

    // Neu eingerichtete Geräte starten mit dem neuen Design "Klar" (siehe Profil > Design zum
    // Umschalten) — bestehende Installationen bleiben beim vertrauten "Klassisch" (in migrate()
    // in store.js), damit niemand ungefragt umgestellt wird.
    const profiles = Store.get().profiles;
    Store.updateProfile(profiles[0].id, { name: name1, design: "klar" });
    Store.updateProfile(profiles[1].id, { name: shared && name2 ? name2 : "Profil 2", design: "klar" });
    Store.setActiveProfile(profiles[0].id);
    Store.setOnboarded();
    onComplete();
  });

  container.querySelector("#obName1").focus();
}
