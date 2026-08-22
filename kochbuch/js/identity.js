// identity.js — "Wer bist du?" ist rein lokal (kein zweites Konto, siehe README): der Name
// dient nur dazu, an Rezepten und Kommentaren zu vermerken, wer sie angelegt/geändert hat.
const KEY = "kochbuch-whoami";

export function getWhoAmI() {
  return localStorage.getItem(KEY) || null;
}
export function setWhoAmI(name) {
  localStorage.setItem(KEY, name.trim());
}
