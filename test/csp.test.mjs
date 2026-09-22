// Prüft die Content-Security-Policy der beiden Apps gegen das, was sie tatsächlich brauchen.
//
// Anlass: die Texterkennung für den Rezept-Import war von Anfang an tot. Tesseract legt
// seinen Worker über eine `blob:`-URL an und übersetzt sein Rechenwerk als WebAssembly —
// beides verbot die eigene CSP (`worker-src 'self'`, `script-src 'self'`). Die App warf
// dabei keinen sichtbaren Fehler, sie sagte nur "Texterkennung fehlgeschlagen", und die
// Ursache stand in der Browser-Konsole, die am Handy niemand aufmacht.
//
// Eine CSP lässt sich in Node nicht ausführen. Prüfbar ist aber, ob die Direktiven da sind,
// von denen bekannt ist, dass die App ohne sie nicht läuft — genau das hätte den Fehler beim
// Schreiben der CSP gemeldet statt Monate später am Küchentisch.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wurzel = fileURLToPath(new URL("..", import.meta.url));
let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };

function csp(datei) {
  const html = readFileSync(wurzel + datei, "utf8");
  const treffer = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  if (!treffer) return null;
  const regeln = {};
  for (const teil of treffer[1].split(";")) {
    const [name, ...werte] = teil.trim().split(/\s+/);
    if (name) regeln[name] = werte;
  }
  return regeln;
}

console.log("\nKeto-App (index.html)");
const app = csp("index.html");
ok("hat überhaupt eine CSP", app !== null);
ok("default-src 'self'", app["default-src"]?.includes("'self'"));
// Tesseract: Worker aus blob:, Rechenwerk als WebAssembly.
ok("worker-src erlaubt blob: (Tesseract-Worker)", app["worker-src"]?.includes("blob:"),
   JSON.stringify(app["worker-src"]));
ok("script-src erlaubt 'wasm-unsafe-eval' (Tesseract-WASM)", app["script-src"]?.includes("'wasm-unsafe-eval'"),
   JSON.stringify(app["script-src"]));
// 'unsafe-eval' wäre die weite Variante und erlaubt zusätzlich eval() auf JavaScript.
ok("script-src erlaubt NICHT 'unsafe-eval'", !app["script-src"]?.includes("'unsafe-eval'"));
ok("script-src erlaubt kein fremdes Skript", app["script-src"]?.every(w => w === "'self'" || w === "'wasm-unsafe-eval'"),
   JSON.stringify(app["script-src"]));

for (const ziel of ["https://*.openfoodfacts.org", "https://generativelanguage.googleapis.com", "https://viedjnpmvnkufoysuxvl.supabase.co"]) {
  ok(`connect-src kennt ${ziel}`, app["connect-src"]?.includes(ziel));
}

console.log("\nKochbuch (kochbuch/index.html)");
const kb = csp("kochbuch/index.html");
ok("hat überhaupt eine CSP", kb !== null);
ok("connect-src kennt Supabase", kb["connect-src"]?.includes("https://viedjnpmvnkufoysuxvl.supabase.co"));
// Das Kochbuch erkennt keinen Text: keine Ausnahmen, die es nicht braucht.
ok("worker-src bleibt eng (keine Texterkennung)", !kb["worker-src"]?.includes("blob:"));
ok("script-src bleibt eng", kb["script-src"]?.every(w => w === "'self'"));

console.log(fails === 0 ? "\nAlle Pruefungen bestanden." : `\n${fails} Pruefung(en) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);
