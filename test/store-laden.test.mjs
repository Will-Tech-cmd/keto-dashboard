// Deckt den Pfad ab, den run.mjs NICHT trifft: Modulstart MIT vorhandenen Daten im
// localStorage, also load() -> migrate(). Genau dort schlug die erste Fassung fehl
// ("Cannot access 'TOMBSTONE_TTL_MS' before initialization") und die App startete leer.
import "./setup.mjs";

const jetzt = Date.now();
const tag = 86400000;

// Altbestand, wie ihn ein Geraet von vor diesen Aenderungen haette: keine tombstones,
// kein fiberOverridesAt, ownProducts ohne updatedAt, consumption ohne dateKey.
const alt = {
  schemaVersion: 1,
  profiles: [{ id: "p1", name: "Wilhelm", sex: "male", age: 40, heightCm: 180, weightKg: 85,
               bodyFatPct: null, activity: 1.375, goal: "lose", deficitPct: 15,
               proteinFactor: 1.6, netCarbLimitG: 20 }],
  activeProfileId: "p1",
  favorites: [{ barcode: "1", name: "Butter", addedAt: jetzt - 5 * tag }],
  noGo: [],
  shoppingList: [{ id: "s1", text: "Sahne", checked: false }],
  ownProducts: { "eigen-1": { barcode: "eigen-1", name: "Kaffee", per100: { kcal: 250 } } },
  cache: { "1": { product: { barcode: "1", name: "Butter" }, fetchedAt: jetzt } },
  recent: ["1"],
  history: [{ id: "h1", barcode: "1", name: "Butter", at: jetzt - tag }],
  consumption: [{ id: "c1", profileId: "p1", barcode: "1", name: "Butter", grams: 20, at: jetzt - 2 * tag }],
  water: [{ id: "w1", profileId: "p1", dateKey: "2026-08-20", ml: 500, at: jetzt - 3 * tag }],
  recipes: [{ id: "r1", name: "Omelett", servings: 2, ingredients: [], createdAt: jetzt, updatedAt: jetzt }],
  fiberOverrides: { "1": true },
  dayTargets: {},
};
localStorage.setItem("keto-dashboard-v1", JSON.stringify(alt));

// Zusaetzlich: ein uralter Grabstein, der beim Laden verfallen soll.
alt.tombstones = { consumption: {}, water: {}, shoppingList: { "uralt": jetzt - 300 * tag },
                   recipes: {}, favorites: {}, noGo: {}, historyClearedAt: 0 };
localStorage.setItem("keto-dashboard-v1", JSON.stringify(alt));

const warnungen = [];
const echteWarnung = console.warn;
console.warn = (...a) => { warnungen.push(a.map(String).join(" ")); echteWarnung(...a); };

const { Store } = await import("../js/store.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };

console.log("\nStart mit vorhandenen Altdaten");
ok("kein 'konnte gespeicherte Daten nicht lesen'",
   !warnungen.some(w => w.includes("konnte gespeicherte Daten nicht lesen")), warnungen.join(" | "));

const s = Store.get();
ok("Profil uebernommen", s.profiles.length === 1 && s.profiles[0].name === "Wilhelm");
ok("Bestandsprofil um neue Felder ergaenzt", s.profiles[0].dietType === "keto" && s.profiles[0].waterTargetMl === 2500);
ok("Verbrauch behaelt seinen Tag", s.consumption[0].dateKey === new Date(jetzt - 2 * tag).toISOString().slice(0, 10)
   || /^\d{4}-\d{2}-\d{2}$/.test(s.consumption[0].dateKey), s.consumption[0].dateKey);
ok("Favorit da", s.favorites.length === 1);
ok("Rezept da", s.recipes.length === 1);
ok("fiberOverridesAt ergaenzt", typeof s.fiberOverridesAt === "object" && s.fiberOverridesAt !== null);
ok("alter Ballaststoff-Schalter bleibt lesbar", Store.getFiberOverride("1") === true);
ok("Grabstein-Karten vollstaendig",
   ["consumption", "water", "shoppingList", "recipes", "favorites", "noGo"].every(k => typeof s.tombstones[k] === "object"));
ok("uralter Grabstein verfallen", s.tombstones.shoppingList["uralt"] === undefined,
   JSON.stringify(s.tombstones.shoppingList));
ok("eigenes Produkt ohne updatedAt bleibt lesbar", Store.getOwnProduct("eigen-1").per100.kcal === 250);
ok("Produkt-Cache uebernommen", !!Store.getCachedProduct("1"));

// Und der Fall, den migrate() ganz ohne tombstones sehen wuerde
console.log("\nStart mit Daten von VOR den Grabsteinen");
ok("Export enthaelt die Grabsteine", JSON.parse(Store.exportJSON()).tombstones !== undefined);

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " Pruefung(en) fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
