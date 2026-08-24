import "./setup.mjs";
const { shiftDateKey, dateKeyOf } = await import("../js/store.js");

// Laeuft nur sinnvoll in einer Zeitzone mit Sommerzeit. TZ=Europe/Berlin beim Aufruf setzen.
let fails = 0;
const ok = (n, c, e = "") => { if (c) console.log("  PASS " + n); else { console.log("  FAIL " + n + " -> " + e); fails++; } };

// Umstellung 2026: 29.03. (vor) und 25.10. (zurueck)
const kette = (start, n) => {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftDateKey(start, -i));
  return out;
};

const maerz = kette("2026-03-31", 5);
ok("Maerz-Umstellung: 5 aufeinanderfolgende Tage",
   maerz.join(" ") === "2026-03-27 2026-03-28 2026-03-29 2026-03-30 2026-03-31", maerz.join(" "));

const oktober = kette("2026-10-27", 5);
ok("Oktober-Umstellung: 5 aufeinanderfolgende Tage",
   oktober.join(" ") === "2026-10-23 2026-10-24 2026-10-25 2026-10-26 2026-10-27", oktober.join(" "));

// zum Vergleich: so sah es mit festen 24h-Schritten aus
const altMaerz = [];
const basis = new Date(2026, 2, 31, 0, 30).getTime(); // 31.03.2026, 00:30 Ortszeit
for (let i = 4; i >= 0; i--) altMaerz.push(dateKeyOf(basis - i * 86400000));
console.log("  (alte Rechnung mit 86400000: " + altMaerz.join(" ") + ")");

// Monatsgrenze und Schaltjahr
ok("Monatsgrenze", shiftDateKey("2026-03-01", -1) === "2026-02-28", shiftDateKey("2026-03-01", -1));
ok("Schaltjahr 2028", shiftDateKey("2028-03-01", -1) === "2028-02-29", shiftDateKey("2028-03-01", -1));
ok("vorwaerts ueber den Jahreswechsel", shiftDateKey("2026-12-31", 1) === "2027-01-01", shiftDateKey("2026-12-31", 1));

process.exit(fails === 0 ? 0 : 1);
