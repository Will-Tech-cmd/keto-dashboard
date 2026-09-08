// lauf.mjs — führt alle Tests der Reihe nach aus.
//
//   node lauf.mjs                       alles, was ohne echte Daten auskommt
//   node lauf.mjs <pfad-zur-sicherung>  zusätzlich gegen eine echte Backup-Datei
//
// Die beiden Tests, die eine Sicherung brauchen (rows, umzug), überspringen sich selbst,
// wenn kein Pfad kommt — echte Ernährungsdaten gehören nicht ins Repository.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const hier = fileURLToPath(new URL(".", import.meta.url));
const sicherung = process.argv[2] || process.env.KETO_SICHERUNG || "";
const dateien = readdirSync(hier)
  .filter(n => n.endsWith(".test.mjs"))
  .sort();

// ---------------------------------------------------------------------------
// fake-indexeddb ist die einzige Abhängigkeit im ganzen Repo, und `node_modules/` ist
// nicht eingecheckt. In einem frischen Arbeitsverzeichnis scheiterten deshalb fünf
// Dateien mit einem Stapelabzug („Cannot find package 'fake-indexeddb'"), aus dem nicht
// hervorgeht, dass ein `npm install` fehlt — Anlass genug, an einer gesunden Suite zu
// zweifeln oder ein eigenes Skript danebenzustellen.
//
// Also: einmal selbst nachinstallieren. Geht das nicht (kein Netz, kein npm), werden die
// betroffenen Dateien mit EINER Zeile Begründung übersprungen statt fünfmal abzustürzen —
// die übrigen zehn laufen und sagen etwas.
// ---------------------------------------------------------------------------
const brauchtIDB = (datei) =>
  readFileSync(new URL(datei, import.meta.url), "utf8").includes("fake-indexeddb");

function idbVorhanden() {
  return existsSync(new URL("node_modules/fake-indexeddb/package.json", import.meta.url));
}

let idbFehlt = false;
if (!idbVorhanden()) {
  process.stdout.write("fake-indexeddb fehlt — installiere einmalig …\n");
  spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel", "error"],
            { stdio: "inherit", cwd: hier, shell: process.platform === "win32" });
  idbFehlt = !idbVorhanden();
  if (idbFehlt) {
    process.stdout.write(
      "\nfake-indexeddb konnte nicht installiert werden (kein Netz?).\n" +
      "Die Tests zu IndexedDB, Zeilenmodus und Abgleich werden uebersprungen.\n" +
      "Von Hand: cd test && npm install\n");
  }
}

let fehlgeschlagen = 0;
let uebersprungen = 0;
for (const datei of dateien) {
  process.stdout.write(`\n== ${datei} ${"=".repeat(Math.max(3, 52 - datei.length))}\n`);
  if (idbFehlt && brauchtIDB(datei)) {
    process.stdout.write("  UEBERSPRUNGEN (fake-indexeddb fehlt)\n");
    uebersprungen++;
    continue;
  }
  const ergebnis = spawnSync(
    process.execPath,
    [datei, sicherung].filter(Boolean),
    { stdio: "inherit", cwd: hier }
  );
  if (ergebnis.status !== 0) fehlgeschlagen++;
}

const gelaufen = dateien.length - uebersprungen;
const nachsatz = uebersprungen > 0 ? ` (${uebersprungen} uebersprungen, siehe oben)` : "";
console.log(fehlgeschlagen === 0
  ? `\nAlle ${gelaufen} gelaufenen Testdateien bestanden${nachsatz}.`
  : `\n${fehlgeschlagen} von ${gelaufen} Testdateien fehlgeschlagen${nachsatz}.`);
// Übersprungene Dateien sind kein Fehlschlag, aber auch kein Beweis: der Rückgabewert
// bleibt 0, damit ein Durchlauf ohne Netz nicht als kaputt gilt.
process.exit(fehlgeschlagen === 0 ? 0 : 1);
