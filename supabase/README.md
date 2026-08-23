# Datenbank

Schema des Supabase-Projekts (`viedjnpmvnkufoysuxvl`, eu-west-2, Postgres 17).
Bis B1 gab es hier nichts — die Tabellen waren nur über die Weboberfläche angelegt.
Ab jetzt liegt jede Änderung als Migration im Repository.

```
migrations/
  20260823120000_haushalt_und_zeilenmodell.sql            B1
  20260823120000_haushalt_und_zeilenmodell.rueckname.sql  Notausgang dazu
```

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

## Was B1 bewusst NICHT anfasst

`keto_sync_state` bleibt stehen, samt seiner offenen Policy — die ausgelieferte
Keto-App synchronisiert noch darüber. Die Tabelle verschwindet mit B3, sobald beide
Geräte auf das Zeilenmodell umgestiegen sind.

> **Solange sie existiert, darf kein zweites Konto angelegt werden.** Mit der offenen
> Policy läse es den kompletten Haushalts-Zustand mit. Die Registrierung bleibt im
> Projekt gesperrt, bis B3 durch ist.
