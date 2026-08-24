# Datenbank

Schema des Supabase-Projekts (`viedjnpmvnkufoysuxvl`, eu-west-2, Postgres 17).
Bis B1 gab es hier nichts — die Tabellen waren nur über die Weboberfläche angelegt.
Ab jetzt liegt jede Änderung als Migration im Repository.

```
migrations/
  20260823221331_haushalt_und_zeilenmodell.sql            B1 — Haushalt, Zeilen, RLS
  20260823221331_haushalt_und_zeilenmodell.rueckname.sql  Notausgang dazu
  20260823221459_keto_sync_state_auf_bestandshaushalt...  offene RLS der Blob-Tabelle geschlossen
  20260823221700_rls_haerten_private_schema.sql           Härtung nach dem Security-Linter
```

**Alle drei sind angewendet** (Stand 23.08.2026).

## Anwenden

```bash
supabase link --project-ref viedjnpmvnkufoysuxvl
supabase db push
```

Ohne CLI geht es auch über den SQL-Editor im Supabase-Dashboard: Datei öffnen,
Inhalt einfügen, ausführen. Die Migration ist in sich abgeschlossen und lässt sich
gefahrlos zweimal laufen (`if not exists` / `drop policy if exists` durchgehend).

**Vorher ausprobieren, ohne etwas zu verändern:** `begin;` davor, `rollback;`
dahinter. So wurde diese Migration gegen das echte Schema geprüft.

## Was B1 ändert

- **Haushalt statt gemeinsamem Konto.** `haushalt` + `haushalt_mitglied`, dazu
  `haushalt_anlegen()` / `haushalt_beitreten(code)` als Funktionen. Jede Datenzeile
  hängt an einem Haushalt, jeder Zugriff am angemeldeten Nutzer.
- **Zeilen statt einem JSON-Blob.** `profil`, `mahlzeit`, `wasser`, `tagesziel`,
  `listen_eintrag`, `einkauf`, `produkt_korrektur`. Rezepte bleiben in
  `kochbuch_rezepte` — das ist ab jetzt die eine Rezept-Tabelle für beide Apps.
- **Zwei Zeitstempel je Zeile, mit zwei Aufgaben:**
  - `updated_at` setzt der Server. Nur dafür da, dass ein Gerät „gib mir alles seit
    X" fragen kann. Unterschiedlich gehende Handy-Uhren dürfen diesen Zeiger nicht
    verbiegen.
  - `geaendert_am` setzt der Client beim Bearbeiten. Entscheidet, welche von zwei
    Fassungen die neuere ist. Ein Trigger verwirft Schreibvorgänge, die älter sind
    als der gespeicherte Stand — ein lange offline gewesenes Gerät kann damit keine
    neuere Änderung mehr überbügeln.
- **Löschen ist `geloescht_am`.** Damit entfallen die Grabsteinkarten im Client
  vollständig, samt ihrer Verfallsfrist und samt der Fehler, die daran hingen.
- **Favoriten und No-Go in einer Tabelle** mit einer Spalte `art`. Der Wechsel
  zwischen beiden ist ein UPDATE derselben Zeile; ein eindeutiger Index über
  (Haushalt, Barcode) macht „steht auf beiden Listen" strukturell unmöglich.
- **RLS überall nach einem Muster:** sichtbar ist, was zu einem meiner Haushalte
  gehört. Vorher galt auf allen Tabellen `using (true)` für jeden Angemeldeten.

## Nachgewiesen

Die RLS wurde nicht nur geschrieben, sondern geprüft — mit einer in der Datenbank
simulierten Anmeldung, ohne Zugangswort:

| | Bestandskonto | fremdes Konto |
|---|---|---|
| Haushalte | 1 | **0** |
| Rezepte | 20 | **0** |
| Zutaten | 128 | **0** |
| Profile / Mahlzeiten | 0 | **0** |
| `keto_sync_state` | 1 | **0** |
| Schreiben in den eigenen Haushalt | geht | — |
| Schreiben in einen fremden Haushalt | — | scheitert |

Der Wächter-Trigger ebenfalls: ein Schreibvorgang mit sieben Tage altem
`geaendert_am` wurde abgewiesen, der Datensatz blieb unverändert; ein neuerer
wurde übernommen.

## Offene Punkte

- Der Security-Linter meldet noch, dass Angemeldete `haushalt_anlegen`,
  `haushalt_beitreten` und `haushalt_einladung_erneuern` aufrufen dürfen. Das ist
  genau ihr Zweck und bleibt so.
- **Leaked Password Protection ist im Projekt aus.** Vor dem ersten fremden Konto
  einschalten: Dashboard → Authentication → Passwords. Supabase gleicht Passwörter
  dann gegen HaveIBeenPwned ab.
- Einladungscodes sind 10 Zeichen aus 31 Symbolen (~50 Bit) und laufen nach 7 Tagen
  ab. Gegen automatisiertes Durchprobieren gibt es serverseitig noch keine Bremse —
  vor der Beta eine Rate-Begrenzung auf `haushalt_beitreten` legen.

## Was B1 bewusst NICHT anfasst

`keto_sync_state` bleibt als Tabelle stehen — die ausgelieferte Keto-App
synchronisiert noch darüber, ein Wegnehmen würde sie sofort zerreißen. Sie
verschwindet mit B3, sobald beide Geräte auf das Zeilenmodell umgestiegen sind.

**Stand: diese Bedingung ist erfüllt.** Beide Geräte des Bestandshaushalts laufen
seit dem 24.08.2026, 10:38 Uhr im Zeilenmodus; die Blob-Zeile wurde zuletzt eine
Minute davor geschrieben und liegt seither unverändert. Sie ist damit kein
gemeinsamer Stand mehr, sondern ein eingefrorener Abzug — und weiterhin die
Rückfallebene, falls ein Gerät auf den alten Weg zurückgestellt wird. Vor dem
Löschen also erst sicherstellen, dass niemand mehr zurückschalten will.

Ihre offene Policy ist dagegen **geschlossen** (Migration `20260823221459`): nur
noch Mitglieder des Bestandshaushalts kommen an die Zeile. Ein zweites Konto liest
damit nichts mehr mit — der Weg für Stufe A ist frei.
