// views/login.js — Zugangswort-Anmeldung, danach einmalig "Wer bist du?".
import { login } from "../api.js";
import { getWhoAmI, setWhoAmI } from "../identity.js";

export function renderLogin(container, onDone) {
  container.innerHTML = `
    <div class="kb-login">
      <div class="kb-login-brand">📖 Kochbuch</div>
      <form id="loginForm" class="kb-card">
        <label for="pw">Zugangswort</label>
        <input type="password" id="pw" autocomplete="current-password" autofocus required>
        <div id="loginError" class="kb-error" role="alert" style="display:none"></div>
        <button class="kb-btn kb-btn-primary" type="submit" id="loginBtn">Anmelden</button>
      </form>
    </div>
  `;

  const form = container.querySelector("#loginForm");
  const errorEl = container.querySelector("#loginError");
  const btn = container.querySelector("#loginBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = container.querySelector("#pw").value;
    errorEl.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Wird geprüft …";
    try {
      await login(password);
      if (getWhoAmI()) {
        onDone();
      } else {
        renderWhoAmI(container, onDone);
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "";
    } finally {
      btn.disabled = false;
      btn.textContent = "Anmelden";
    }
  });
}

function renderWhoAmI(container, onDone) {
  container.innerHTML = `
    <div class="kb-login">
      <div class="kb-login-brand">📖 Kochbuch</div>
      <form id="whoForm" class="kb-card">
        <p>Wer bist du? Steht künftig bei deinen Einträgen und Kommentaren.</p>
        <label for="whoName">Dein Name</label>
        <input type="text" id="whoName" autocomplete="given-name" autofocus required maxlength="40">
        <button class="kb-btn kb-btn-primary" type="submit">Los geht's</button>
      </form>
    </div>
  `;
  container.querySelector("#whoForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = container.querySelector("#whoName").value.trim();
    if (!name) return;
    setWhoAmI(name);
    onDone();
  });
}
