import "./setup.mjs";
const { Store, onStoreChange } = await import("../js/store.js");

let fails = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  PASS " + name);
  else { console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); fails++; }
};
const flush = () => new Promise(r => setTimeout(r, 400)); // persist ist 250ms debounced
const tick = () => new Promise(r => setTimeout(r, 5));

const origins = [];
onStoreChange(o => origins.push(o));

console.log("\n1) Herkunft der Aenderung (Endlosschleifen-Fix)");
Store.addShoppingItem("Butter");
await flush();
ok("eigene Aenderung -> origin local", origins.at(-1) === "local", JSON.stringify(origins));

const remote = JSON.parse(Store.exportJSON());
remote.shoppingList = [...remote.shoppingList, { id: "remote-1", text: "Sahne", checked: false, updatedAt: Date.now() }];
origins.length = 0;
Store.mergeJSONQuiet(JSON.stringify(remote));
await flush();
ok("Abgleich -> origin remote (kein Push)", origins.length === 1 && origins[0] === "remote", JSON.stringify(origins));
ok("Abgleich hat den fremden Eintrag uebernommen", Store.get().shoppingList.some(i => i.id === "remote-1"));

origins.length = 0;
Store.addShoppingItem("Eier");                 // setzt pendingIsLocal
Store.mergeJSONQuiet(JSON.stringify(remote));  // darf es nicht zuruecknehmen
await flush();
ok("offene eigene Aenderung bleibt local", origins.at(-1) === "local", JSON.stringify(origins));

console.log("\n2) Datei-gewinnt ueberlebt den naechsten Abgleich");
const serverStand = Store.exportJSON();        // Butter, Sahne, Eier
const datei = JSON.parse(serverStand);
datei.shoppingList = datei.shoppingList.filter(i => i.text === "Butter");
Store.importJSON(JSON.stringify(datei));
await flush();
ok("nach dem Ersetzen nur noch Butter", Store.get().shoppingList.map(i => i.text).join() === "Butter",
   JSON.stringify(Store.get().shoppingList.map(i => i.text)));
ok("Grabsteine fuer das Entfernte angelegt", Object.keys(Store.get().tombstones.shoppingList).length === 2,
   JSON.stringify(Store.get().tombstones.shoppingList));
Store.mergeJSONQuiet(serverStand);             // Server hat noch alles
await flush();
ok("Abgleich holt das Ersetzte NICHT zurueck", Store.get().shoppingList.map(i => i.text).join() === "Butter",
   JSON.stringify(Store.get().shoppingList.map(i => i.text)));

console.log("\n3) Rueckgaengig ueberlebt den naechsten Abgleich");
ok("Sicherung vor dem Import vorhanden", Store.hasPreMergeBackup());
Store.restorePreMergeBackup();
await flush();
ok("wiederhergestellt: alle drei wieder da", Store.get().shoppingList.length === 3,
   String(Store.get().shoppingList.length));
Store.mergeJSONQuiet(JSON.stringify(datei));   // die Datei kennt weiterhin nur Butter
await flush();
ok("Abgleich macht das Wiederherstellen nicht zunichte", Store.get().shoppingList.length === 3,
   String(Store.get().shoppingList.length));

console.log("\n4) Favorit <-> No-Go: kein Eintrag auf beiden Listen");
Store.addToList("noGo", { barcode: "111", name: "Cola", addedAt: Date.now() });
await flush();
const vorherigerStand = Store.exportJSON();    // Gegenseite kennt 111 noch als No-Go
await tick();
Store.addToList("favorites", { barcode: "111", name: "Cola Zero", addedAt: Date.now() });
await flush();
Store.mergeJSONQuiet(vorherigerStand);
await flush();
ok("111 nur in favorites", Store.isInList("favorites", "111") && !Store.isInList("noGo", "111"),
   "fav=" + Store.isInList("favorites", "111") + " noGo=" + Store.isInList("noGo", "111"));

console.log("\n5) Wieder aufgenommener Favorit bleibt");
Store.removeFromList("favorites", "111");
await flush();
const mitGrabstein = Store.exportJSON();
await tick();
Store.addToList("favorites", { barcode: "111", name: "Cola Zero", addedAt: Date.now() });
await flush();
Store.mergeJSONQuiet(mitGrabstein);            // Gegenseite bringt den Grabstein mit
await flush();
ok("Wiederaufnahme sticht den aelteren Grabstein", Store.isInList("favorites", "111"));

console.log("\n6) Eigene Produkte: neuere Korrektur gewinnt");
Store.saveOwnProduct("eigen-1", { barcode: "eigen-1", name: "Kaffee", per100: { kcal: 250 } });
await flush();
const alt = JSON.parse(Store.exportJSON());
const fremd = JSON.parse(JSON.stringify(alt));
fremd.ownProducts["eigen-1"] = { barcode: "eigen-1", name: "Kaffee", per100: { kcal: 180 }, updatedAt: Date.now() + 1000 };
Store.mergeJSONQuiet(JSON.stringify(fremd));
await flush();
ok("neuere Fassung des anderen Geraets kommt an", Store.getOwnProduct("eigen-1").per100.kcal === 180,
   String(Store.getOwnProduct("eigen-1").per100.kcal));
const veraltet = JSON.parse(JSON.stringify(alt));
veraltet.ownProducts["eigen-1"] = { barcode: "eigen-1", name: "Kaffee", per100: { kcal: 999 }, updatedAt: 1 };
Store.mergeJSONQuiet(JSON.stringify(veraltet));
await flush();
ok("aeltere Fassung ueberschreibt nicht", Store.getOwnProduct("eigen-1").per100.kcal === 180,
   String(Store.getOwnProduct("eigen-1").per100.kcal));

console.log("\n7) Ballaststoff-Schalter: Zuruecksetzen wandert mit");
Store.setFiberOverride("222", true);
await flush();
ok("gesetzt", Store.getFiberOverride("222") === true);
Store.clearFiberOverride("222");
await flush();
ok("zurueckgesetzt liest sich als undefined", Store.getFiberOverride("222") === undefined);
const altSchalter = JSON.parse(Store.exportJSON());
altSchalter.fiberOverrides["222"] = true;
altSchalter.fiberOverridesAt["222"] = 1;       // aeltere Fassung der Gegenseite
Store.mergeJSONQuiet(JSON.stringify(altSchalter));
await flush();
ok("alter Schalter kommt nicht zurueck", Store.getFiberOverride("222") === undefined,
   String(Store.getFiberOverride("222")));

console.log("\n8) Nachtragen beim Anzeigen fasst updatedAt nicht an");
Store.addToList("favorites", { barcode: "333", name: "Kaese", addedAt: Date.now() });
await flush();
const stempelVorher = Store.get().favorites.find(e => e.barcode === "333").updatedAt;
await tick();
Store.backfillListEntry("favorites", "333", { nutri100: { kcal: 400 }, grade: "green" });
await flush();
const eintrag = Store.get().favorites.find(e => e.barcode === "333");
ok("Werte nachgetragen", eintrag.nutri100.kcal === 400);
ok("updatedAt unveraendert", eintrag.updatedAt === stempelVorher);
await tick();
Store.updateListEntry("favorites", "333", { name: "Gouda" });
await flush();
ok("echte Aenderung setzt updatedAt neu",
   Store.get().favorites.find(e => e.barcode === "333").updatedAt > stempelVorher);

console.log("\n9) Produkt-Cache wird gedeckelt");
for (let i = 0; i < 450; i++) Store.cacheProduct("bc" + i, { barcode: "bc" + i, name: "P" + i });
await flush();
const cacheGroesse = Object.keys(Store.get().cache).length;
ok("Cache <= 400", cacheGroesse <= 400, String(cacheGroesse));
ok("das zuletzt Geholte ist noch da", !!Store.getCachedProduct("bc449"));

console.log("\n10) Ein geloeschtes Profil bleibt geloescht");
// Bis hierher nahm applyMerge() jedes eingehende Profil auf, dessen id es nicht kannte —
// ein aufgeraeumtes ueberzaehliges Profil kam vom anderen Geraet postwendend zurueck.
const eigenes = Store.getActiveProfile().id;
const ueberzaehlig = Store.get().profiles.find(p => p.id !== eigenes)?.id;
ok("es gibt ein zweites Profil", !!ueberzaehlig);
const mitBeiden = JSON.parse(Store.exportJSON());   // Stand des anderen Geraets: kennt beide
ok("geloescht", Store.deleteProfile(ueberzaehlig) === true);
ok("nur noch eines im Speicher", Store.get().profiles.length === 1,
   String(Store.get().profiles.length));
Store.mergeJSONQuiet(JSON.stringify(mitBeiden));
await flush();
ok("der Abgleich holt es NICHT zurueck", Store.get().profiles.length === 1,
   JSON.stringify(Store.get().profiles.map(p => p.name)));
ok("das eigene Profil ist noch da", Store.getActiveProfile()?.id === eigenes);

console.log("\n11) Wer das Profil nach der Loeschung bearbeitet hat, holt es bewusst zurueck");
const spaeter = JSON.parse(JSON.stringify(mitBeiden));
const wieder = spaeter.profiles.find(p => p.id === ueberzaehlig);
wieder.updatedAt = Date.now() + 60000;   // dort nach der Loeschung angefasst
wieder.name = "Wiederbelebt";
Store.mergeJSONQuiet(JSON.stringify(spaeter));
await flush();
ok("neuere Bearbeitung schlaegt den Grabstein", Store.get().profiles.length === 2,
   JSON.stringify(Store.get().profiles.map(p => p.name)));

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : "\n" + fails + " Pruefung(en) fehlgeschlagen.");
process.exit(fails === 0 ? 0 : 1);
