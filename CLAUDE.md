# Keto-Dashboard — Hinweise für Claude

Zwei eigenständige PWAs in einem Repo, ausgeliefert von GitHub Pages direkt aus `main`:
die Keto-App in der Wurzel und das gemeinsame Kochbuch unter `kochbuch/`.

**Reines HTML/CSS/ES-Module. Kein Bauschritt, keine Laufzeit-Abhängigkeit.** Was im Repo
liegt, ist genau das, was ausgeliefert wird. Fremdbibliotheken sind unter `vendor/`
eingecheckt. Die einzige npm-Abhängigkeit steht in `test/package.json`.

## Zuerst: Stand prüfen

An diesem Repo wird oft in mehreren Sitzungen parallel gearbeitet. **Vor der Arbeit
`git fetch origin main` und `git log --oneline -15 origin/main`** — `main` kann dutzende
Commits vor dem eigenen Branch liegen, und der Auftrag ist womöglich längst erledigt oder
die Grundlage eine andere. Ist der eigene Branch bereits gemerged, für neue Arbeit frisch
von `origin/main` aufsetzen statt darauf weiterzubauen.

## Tests

```bash
cd test && node lauf.mjs      # 14 Dateien, ohne Browser und ohne Netz, wenige Sekunden
```

Diese Suite ist der erste Griff — **keine eigenen Testskripte danebenbauen, ohne vorher
hier hineingesehen zu haben.** Sie deckt Store, Zeilenmodus, Abgleich, Parser und Planer ab.
Nach jeder Änderung an `js/store.js`, `js/sync.js`, `js/sync2.js`, `js/rows.js` oder
`js/entities.js` laufen lassen.

Ein Abgleich betrifft immer zwei Geräte: Änderungen daran gehören mit einem Test belegt,
der beide Seiten nachstellt (siehe `test/sync2.test.mjs`), nicht nur eine.

## Pflichten bei jeder Änderung

- **`CACHE_NAME` in `sw.js` hochzählen** — sonst liefert der Service Worker den alten Stand
  aus. Das Kochbuch hat mit `kochbuch/sw.js` einen **eigenen** Service Worker mit eigenem
  `CACHE_NAME`; wer dort etwas ändert, zählt dort hoch.
- Neue Dateien unter `js/` gehören zusätzlich in `APP_SHELL` des jeweiligen `sw.js`.
- **Ausgehende Verbindungen brauchen einen Eintrag in der CSP** im `<meta>` von `index.html`
  bzw. `kochbuch/index.html`. Fehlt er, scheitert der Aufruf stumm.

## Zwei Speicherwege — häufigster Stolperstein

`js/modus.js` schaltet zwischen zwei Wegen um, die **nebeneinander** bestehen:

- **klassisch (Standard, Schalter aus):** der ganze Zustand als ein JSON im `localStorage`,
  Abgleich als Ganzes über `js/sync.js`, Zusammenführung im Client (`applyMerge`).
- **Zeilenmodus (opt-in):** jede Mahlzeit, jedes Rezept einzeln in IndexedDB
  (`js/db.js`, `js/ablage.js`), Abgleich Zeile für Zeile über `js/sync2.js`, Zusammenführung
  auf dem Server.

`istZeilenModus()` aus `js/store.js` sagt, welcher gerade gilt. **Wer nur einen Weg anfasst,
muss den anderen mitdenken** — beide sind in Benutzung. Löschungen brauchen in beiden Wegen
einen Grabstein (`tombstones`), sonst lebt das Gelöschte beim nächsten Abgleich wieder auf.
Bearbeitbare Einträge brauchen einen Zeitstempel (`updatedAt`), sonst gewinnt beim
Zusammenführen stumm die ältere Fassung.

## Server

Supabase-Projekt `viedjnpmvnkufoysuxvl` (eu-west-2), ein gemeinsames Konto für den ganzen
Haushalt. Schemaänderungen gehören als Migration nach `supabase/migrations/` — jeweils mit
einer `.rueckname.sql` daneben.

## Sprache

UI-Texte, Code-Kommentare und Dokumentation auf **Deutsch**; Commit-Nachrichten und
PR-Beschreibungen auf **Englisch**. Kommentare erklären das *Warum* — welche Alternative
verworfen wurde, welcher Fehler dahintersteckt —, nicht das *Was*.
