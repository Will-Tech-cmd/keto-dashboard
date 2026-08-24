# Tests

Laufen mit Node, ohne Browser und ohne Netz.

```bash
cd test
npm install          # einmalig, holt nur fake-indexeddb
node lauf.mjs
```

Die App selbst bleibt abhängigkeitsfrei: die einzige Abhängigkeit steht hier in
`test/package.json` und wird zum Ausliefern nicht gebraucht. Das `package.json` in der
Wurzel enthält bewusst nur `"type": "module"` — damit Node die Dateien unter `js/` als
ES-Module liest. Kein Bauschritt, keine Laufzeit-Abhängigkeit.

## Mit echten Daten

Zwei Tests prüfen den Umzug gegen eine echte Sicherung. Ohne Pfad überspringen sie sich:

```bash
node lauf.mjs "/pfad/zu/keto-dashboard-backup-....txt"
```

Echte Ernährungsdaten liegen bewusst **nicht** im Repository. Eine Sicherung schreibt die
App unter Profil → „Datei sichern".

## Was geprüft wird

| Datei | |
|---|---|
| `store.test.mjs` | Zusammenführen, Grabsteine, Ersetzen und Rückgängig, Listenwechsel, eigene Produkte |
| `store-laden.test.mjs` | Start mit Altdaten — der Pfad, auf dem eine fehlende Konstante die App einmal mit leeren Daten starten ließ |
| `zeitumstellung.test.mjs` | Tagesschritte über die Zeitumstellung |
| `parser.test.mjs` | Zutatenzeilen, inklusive des als „o" gelesenen Aufzählungspunkts |
| `naehrwerte.test.mjs` | Nährwerte je Portion, beide Eingangsformate |
| `db.test.mjs` | IndexedDB-Schicht, Outbox, Zusammenfassen überholter Aufträge |
| `rows.test.mjs` | Zustand → Zeilen → Server-Schreibweise → zurück, verlustfrei |
| `sync2.test.mjs` | Abgleich in zwölf Szenarien gegen einen PostgREST-Nachbau |
| `umzug.test.mjs` | der ganze Weg: alter Klumpen → IndexedDB → Server → zweites Gerät |

`supabase-fake.mjs` ist kein Test, sondern der Nachbau: Upsert mit `on_conflict`, PATCH mit
Filtern, Zeiger über `updated_at` — und der Wächter-Trigger, der eine veraltete Fassung
verwirft. Damit lässt sich der Abgleich vollständig durchspielen, ohne ein Konto, ohne Netz
und ohne die echten Daten anzufassen.

## Grenzen

Der Nachbau ist ein Nachbau. Er prüft die Logik des Abgleichs, nicht das Verhalten von
PostgREST und Postgres im Detail — Fremdschlüssel, Prüfregeln und die echten RLS-Policies
wurden getrennt davon gegen die echte Datenbank geprüft (in einer zurückgerollten
Transaktion, siehe `supabase/README.md`).
