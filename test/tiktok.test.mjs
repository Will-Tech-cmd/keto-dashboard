// TikTok-Teilen: Link erkennen, Beschreibung zerlegen, Manifest und Edge Function.
//
// Die beiden Beschreibungen unten sind echte TikTok-Captions (11/2026), so wie sie die
// Videoseite liefert: EIN Absatz, alle Zeilenumbrüche weg. Genau daran war der normale
// Zeilen-Parser gescheitert — er bekam eine einzige Riesenzeile.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");

const { tiktokLinkAus, geteiltesAus, bereinigeBeschreibung, zerlegeBeschreibung, portionenAus, rezeptnameAus }
  = await import("../js/tiktok.js");
const { parseIngredientText } = await import("../js/ingredient-parser.js");

let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + (e ? " -> " + e : "")); fails++; } };

console.log("\n1) Link aus dem Geteilten");
ok("www-Link", tiktokLinkAus("Schau mal https://www.tiktok.com/@keto/video/123?x=1 toll") === "https://www.tiktok.com/@keto/video/123?x=1");
ok("Kurzlink vm.", tiktokLinkAus("https://vm.tiktok.com/ZNabc123/") === "https://vm.tiktok.com/ZNabc123/");
ok("Satzzeichen am Ende weg", tiktokLinkAus("(https://vt.tiktok.com/ZS1/).") === "https://vt.tiktok.com/ZS1/");
ok("kein Link", tiktokLinkAus("https://example.com/tiktok.com/") === null);
const params = new URLSearchParams("title=Keto&text=Hier%20https%3A%2F%2Fvm.tiktok.com%2FZNx%2F&url=");
ok("geteiltesAus findet den Link im text-Feld", geteiltesAus(params)?.link === "https://vm.tiktok.com/ZNx/");
ok("ohne Teilen-Parameter null", geteiltesAus(new URLSearchParams("tab=scan")) === null);

const pizza = "Das virale Hüttenkäse Rezept als Wrap habt ihr sicherlich mitbekommen. Aber ich dachte  mir: Warum nicht eine schnelle und leckere Keto Pizza, Low Carb Pizza zum Abnehmen daraus zaubern? Proteinreich und glutenfrei natürlich.  Und brauchst du nur 4 Zutaten. Zutaten: 200g Hüttenkäse 1 Ei 3-4 EL zuckerfreie passierte Tomaten Etwas geriebener Käse nach Wahl Wenn du möchtest, kannst du den „Teig“ noch mit Salz & Pfeffer abschmecken. Tipp: Daraus lässt sich auch wunderbar ein Low Carb Flammkuchen machen. Zubereitung vom Keto Rezept: 1. Ofen auf 180 Grad vorheizen. 2. Hüttenkäse und Ein (und ggf Gewürze) in eine Küchenmaschine geben und zu einer gleichmäßigen Masse mixen. 3. Auf Backpapier streichen und 15 Minuten backen. #keto #lowcarb #abnehmen";

const broetchen = "Burger Brötchen ohne Mehl, aus nur 5 Zutaten. 🍔 Diese Keto Burger Brötchen sind luftig, glutenfrei und so stabil, dass sie jeden saftigen Burger halten. Kein Mandelmehl, kein Mehl, keine Stärke, nur Eier und Flohsamenschalen. Perfekt für deinen nächsten Keto Burgerabend. Ergibt 4 Brötchen. Zutaten: 4 Eier ½ TL Salz ¼ TL Natron 40 g Flohsamenschalenpulver (ca. 5 EL) 1 TL Apfelessig oder Zitronensaft 1 EL Sesam oder andere Saaten (optional) Zubereitung: Den Ofen auf 175 °C Ober und Unterhitze vorheizen und ein Blech mit Backpapier auslegen. Die Eier mit Salz und Natron gut verquirlen. Das Flohsamenschalenpulver dazugeben und zügig zu einem gleichmäßigen Teig verrühren. Etwa 20 Minuten goldbraun backen. #ketorezepte #lowcarb";

console.log("\n2) Bereinigen");
const b = bereinigeBeschreibung(broetchen);
ok("Hashtags weg", !b.includes("#"));
ok("½ wird 0,5", b.includes("0,5 TL Salz"), b.slice(b.indexOf("Zutaten"), b.indexOf("Zutaten") + 60));

console.log("\n3) Hüttenkäse-Pizza (nummerierte Schritte, Tipp dazwischen)");
let z = zerlegeBeschreibung(pizza);
ok("Zutaten: Hüttenkäse, Ei, Tomaten, Käse", z.zutatenZeilen.length === 4, JSON.stringify(z.zutatenZeilen));
ok("erste Zeile '200g Hüttenkäse'", z.zutatenZeilen[0] === "200g Hüttenkäse", z.zutatenZeilen[0]);
ok("'1 Ei' ist eine eigene Zeile", z.zutatenZeilen[1] === "1 Ei", z.zutatenZeilen[1]);
ok("Fließtext nach 'nach Wahl' abgeschnitten", /^Etwas geriebener Käse nach Wahl/.test(z.zutatenZeilen[3]) && z.zutatenZeilen[3].split(" ").length <= 8, z.zutatenZeilen[3]);
ok("drei nummerierte Schritte", z.schritte.length === 3, JSON.stringify(z.schritte));
ok("Schritt ohne Nummer", z.schritte[0] === "Ofen auf 180 Grad vorheizen.", z.schritte[0]);
ok("Name aus dem ersten Satz", z.name.startsWith("Das virale Hüttenkäse Rezept"), z.name);
ok("ohne Portionsangabe 1", z.servings === 1);
const geparst = parseIngredientText(z.zutatenZeilen.join("\n"));
ok("Parser versteht die Zeilen: 200 g", geparst[0].grams === 200 && /hüttenkäse/i.test(geparst[0].name), JSON.stringify(geparst[0]));
ok("1 Ei → Stückzahl 1 ohne Einheit", geparst[1].quantity === 1 && geparst[1].unit === null, JSON.stringify(geparst[1]));

console.log("\n4) Burger-Brötchen (Schritte als Sätze, Klammern, Brüche)");
z = zerlegeBeschreibung(broetchen);
ok("sechs Zutaten", z.zutatenZeilen.length === 6, JSON.stringify(z.zutatenZeilen));
ok("Klammer '(ca. 5 EL)' zerreißt nichts", z.zutatenZeilen[3] === "40 g Flohsamenschalenpulver", z.zutatenZeilen[3]);
ok("0,5 TL Salz", z.zutatenZeilen[1] === "0,5 TL Salz", z.zutatenZeilen[1]);
ok("Ergibt 4 → 4 Portionen", z.servings === 4);
ok("vier Schritte an Satzenden", z.schritte.length === 4, JSON.stringify(z.schritte));
ok("Hashtags nicht in den Schritten", !z.schritte.some(s => s.includes("#")));

console.log("\n4b) Cheeseburger Cake (Emoji als Aufzählung, Tastenkappen-Ziffern, pro.tiktok.com-Fall)");
const cake = "🍔🔥 Cheeseburger Cake 🧀🥒 Saftig, käsig und einfach brachial! 🤤🔥 Der virale Cheeseburger Cake kommt mit allem, was wir am Cheeseburger lieben – nur als herzhafter Kuchen! 🍔💥 Zutaten 📝 🍕 1 fertiger Pizzateig 🐄 300 g Rinderhack 🧀 150 g Cheddar 🧀 50g Gouda g Gouda-Mozzarella-Mix 🧀 50g Mozzarella 🧅 1 rote Zwiebel, fein gewürfelt 🥒 Gewürzgurken, in Scheiben 🍅 4 EL Ketchup 🥄 2 EL Mayonnaise 🌭 2 TL Senf 🥒 1 EL Gurkenwasser 🧂 1 TL Salz ⚫ ½ TL schwarzer Pfeffer 🌶️ 1 TL Paprikapulver, edelsüß 🧄 ½ TL Knoblauchpulver 🥚 1 Eigelb + 1 TL Milch zum Bestreichen ⚪ Sesam zum Bestreuen Rezept 👨‍🍳 1️⃣ Rinderhack 🐄 in einer heißen Pfanne kräftig anbraten, dann mit Salz 🧂, Pfeffer ⚫, Paprika 🌶️ und Knoblauchpulver 🧄 würzen. Kurz abkühlen lassen. 2️⃣ Für die Soße 🍔 Ketchup 🍅, Mayo, Senf und Gurkenwasser 🥒 verrühren  3️⃣ Pizzateig 🍕 über eine Kuchenform legen und mit der Hälfte vom Käse 🧀 starten. 4️⃣ Die zweite Hälfte genauso schichten. 5️⃣ Bei 200 °C Ober-/Unterhitze im vorgeheizten Ofen 25–30 Minuten backen, bis der Cake goldbraun ist. 🔥 6️⃣ Kurz ruhen lassen, anschneiden und den Cheesepull genießen! 🧀🤤 Kleiner Tipp: Rechtecke lassen sich leichter essen als Scheiben. 7️⃣ An Gutn! ✌️😋 #GrillBabo #FoodTrend @Sonja_Zeb";
z = zerlegeBeschreibung(cake);
ok("Name ohne Emoji und ohne Rest des Satzes", z.name === "Cheeseburger Cake", z.name);
ok("18 Zutaten", z.zutatenZeilen.length === 18, JSON.stringify(z.zutatenZeilen));
ok("'Zutaten 📝 🍕 1 …' ohne Doppelpunkt wird als Marke erkannt", z.zutatenZeilen[0] === "1 fertiger Pizzateig", z.zutatenZeilen[0]);
ok("Zutat ohne Menge, aber mit eigenem Emoji, bleibt eigene Zeile", z.zutatenZeilen.includes("Gewürzgurken, in Scheiben"));
ok("'1 Eigelb + 1 TL Milch' wird zu zwei Zeilen ohne Plus", z.zutatenZeilen.includes("1 Eigelb") && z.zutatenZeilen.includes("1 TL Milch zum Bestreichen"));
ok("keine Emoji in den Zutaten", !z.zutatenZeilen.some(x => /\p{Extended_Pictographic}/u.test(x)));
ok("'Rezept 👨‍🍳 1️⃣' startet die Schritte", z.schritte.length === 6, JSON.stringify(z.schritte));
ok("Emoji mitten im Satz weg, Kommas sauber", z.schritte[0].startsWith("Rinderhack in einer heißen Pfanne kräftig anbraten, dann mit Salz, Pfeffer, Paprika und Knoblauchpulver würzen."), z.schritte[0]);
ok("'Kleiner Tipp' schneidet am Satzende, nicht mitten im Wort", z.schritte[5] === "Kurz ruhen lassen, anschneiden und den Cheesepull genießen!", z.schritte[5]);
const gp = parseIngredientText(z.zutatenZeilen.join("\n"));
ok("Parser: 4 EL Ketchup → 60 g", gp.find(p => /ketchup/i.test(p.name))?.grams === 60);
ok("Parser: 0,5 TL Pfeffer → 3 g", gp.find(p => /pfeffer/i.test(p.name))?.grams === 3);

console.log("\n5) Kleinkram");
ok("portionenAus 'für 2 Portionen'", portionenAus("Zutaten für 2 Portionen: 1 Ei") === 2);
ok("rezeptnameAus kürzt", rezeptnameAus("x".repeat(80)).length <= 60);
ok("rezeptnameAus nimmt Titel, wenn Intro fehlt", rezeptnameAus("", "Keto Sandwich") === "Keto Sandwich");
ok("rezeptnameAus Rückfall", rezeptnameAus("", "") === "TikTok-Rezept");
ok("ohne Marken: nur Stücke mit Menge", zerlegeBeschreibung("Mega lecker heute. 100 g Butter 2 Eier").zutatenZeilen.join("|") === "100 g Butter|2 Eier");

console.log("\n6) Manifest und Edge Function");
const manifest = JSON.parse(readFileSync(join(wurzel, "manifest.webmanifest"), "utf8"));
ok("share_target vorhanden", !!manifest.share_target);
ok("GET mit title/text/url", manifest.share_target?.method === "GET"
  && manifest.share_target?.params?.text === "text" && manifest.share_target?.params?.url === "url");
ok("action zeigt auf die App", manifest.share_target?.action === "./index.html");
const fn = readFileSync(join(wurzel, "supabase/functions/tiktok-rezept/index.ts"), "utf8");
ok("Edge Function lässt nur tiktok.com-Hosts zu", /TIKTOK_HOST = \/\^\(\?:\[a-z0-9-\]\+\\\.\)\*tiktok\\\.com\$\/i/.test(fn) && /protocol !== "https:"/.test(fn));
ok("pro.tiktok.com-Kurzlink wird erkannt", tiktokLinkAus("https://pro.tiktok.com/t/ZGdX5WrK1/") === "https://pro.tiktok.com/t/ZGdX5WrK1/");
ok("liest __UNIVERSAL_DATA_FOR_REHYDRATION__", fn.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__"));
ok("antwortet mit CORS", fn.includes("Access-Control-Allow-Origin"));
const sw = readFileSync(join(wurzel, "sw.js"), "utf8");
for (const d of ["./js/einkauf.js", "./js/tiktok.js", "./js/tiktok-import.js"]) ok(`${d} in APP_SHELL`, sw.includes(`"${d}"`));

console.log(fails ? `\n${fails} fehlgeschlagen.` : "\nAlles bestanden.");
process.exit(fails ? 1 : 0);
