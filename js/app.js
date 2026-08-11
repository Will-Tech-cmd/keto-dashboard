// app.js — Tab-Router, Profil-Umschalter, Init.
import { Store } from "./store.js";
import { renderStart } from "./views/start.js";
import { renderScan, cleanupScan } from "./views/scan.js";
import { renderLists } from "./lists.js";
import { renderProfile } from "./views/profile.js";
import { renderRecipes } from "./views/recipes.js";
import { renderOnboarding } from "./views/onboarding.js";
import { showToast } from "./ui.js";

const view = document.getElementById("view");
const tabbar = document.getElementById("tabbar");
const profileSwitchBtn = document.getElementById("profileSwitch");
const profileSwitchName = document.getElementById("profileSwitchName");

let activeTab = "start";

const RENDERERS = {
  start: () => renderStart(view, goToTab),
  scan: () => renderScan(view),
  lists: () => renderLists(view),
  recipes: () => renderRecipes(view),
  profile: () => renderProfile(view, updateProfileSwitchLabel),
};

function goToTab(tab) {
  if (tab !== "scan") cleanupScan();
  activeTab = tab;
  tabbar.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  RENDERERS[tab]();
}

tabbar.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => goToTab(btn.dataset.tab));
});

function updateProfileSwitchLabel() {
  profileSwitchName.textContent = Store.getActiveProfile().name;
}

profileSwitchBtn.addEventListener("click", () => {
  const state = Store.get();
  const idx = state.profiles.findIndex(p => p.id === state.activeProfileId);
  const next = state.profiles[(idx + 1) % state.profiles.length];
  Store.setActiveProfile(next.id);
  updateProfileSwitchLabel();
  showToast(`Profil: ${next.name}`);
  if (activeTab === "start" || activeTab === "profile") RENDERERS[activeTab]();
});

// Stream sauber stoppen, wenn die App in den Hintergrund geht (Akku).
document.addEventListener("visibilitychange", () => {
  if (document.hidden && activeTab === "scan") cleanupScan();
});

// Offline/Online Hinweis
window.addEventListener("offline", () => showToast("Offline — gecachte Produkte funktionieren weiter"));
window.addEventListener("online", () => showToast("Wieder online"));

// Service Worker registrieren (relativer Pfad, funktioniert unter /keto-dashboard/ Unterpfad)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => {
      console.warn("Service Worker Registrierung fehlgeschlagen:", err);
    });
  });
}

// Init
if (Store.isOnboarded()) {
  updateProfileSwitchLabel();
  goToTab("start");
} else {
  tabbar.style.display = "none";
  profileSwitchBtn.style.display = "none";
  renderOnboarding(view, () => {
    tabbar.style.display = "";
    profileSwitchBtn.style.display = "";
    updateProfileSwitchLabel();
    goToTab("start");
  });
}
