// lauf.mjs — führt alle Tests der Reihe nach aus.
//
//   node lauf.mjs                       alles, was ohne echte Daten auskommt
//   node lauf.mjs <pfad-zur-sicherung>  zusätzlich gegen eine echte Backup-Datei
//
// Die beiden Tests, die eine Sicherung brauchen (rows, umzug), überspringen sich selbst,
// wenn kein Pfad kommt — echte Ernährungsdaten gehören nicht ins Repository.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const sicherung = process.argv[2] || process.env.KETO_SICHERUNG || "";
const dateien = readdirSync(new URL(".", import.meta.url))
  .filter(n => n.endsWith(".test.mjs"))
  .sort();

let fehlgeschlagen = 0;
for (const datei of dateien) {
  process.stdout.write(`\n== ${datei} ${"=".repeat(Math.max(3, 52 - datei.length))}\n`);
  const ergebnis = spawnSync(
    process.execPath,
    [datei, sicherung].filter(Boolean),
    { stdio: "inherit", cwd: new URL(".", import.meta.url) }
  );
  if (ergebnis.status !== 0) fehlgeschlagen++;
}

console.log(fehlgeschlagen === 0
  ? `\nAlle ${dateien.length} Testdateien bestanden.`
  : `\n${fehlgeschlagen} von ${dateien.length} Testdateien fehlgeschlagen.`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
