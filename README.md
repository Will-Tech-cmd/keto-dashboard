# Keto-Dashboard

Eine deutschsprachige PWA für den Alltag einer ketogenen Ernährung: Barcode scannen,
Nährwerte prüfen, Mahlzeiten und Wasser eintragen, Rezepte pflegen — offline nutzbar und
ohne Konto. Alle Daten bleiben auf dem Gerät.

**→ [will-tech-cmd.github.io/keto-dashboard](https://will-tech-cmd.github.io/keto-dashboard/)**

Die App ist für zwei Personen ausgelegt (zwei Profile mit eigenen Zielwerten, umschaltbar
über die Kopfzeile). Zwei Geräte lassen sich über eine Backup-Datei abgleichen.

---

## Funktionen

### Start
- Wochenstreifen zum Blättern; auch der morgige Tag lässt sich schon befüllen (Essensplanung)
- Vier Zielringe — Kalorien, Netto-Kohlenhydrate, Fett, Eiweiß — mit Restbudget
- Wasserzähler mit +200/+330/+500 ml und Rückgängig
- Mahlzeiten nach Frühstück/Mittag/Abend/Snack gruppiert, jede Zeile bearbeitbar
- **Portion ans zweite Profil weiterreichen:** Der Eintragen-Knopf ist geteilt — links „+ Name"
  trägt bei beiden ein, rechts wie gewohnt nur bei dir. „Rückgängig" nimmt beide zurück. Ein
  Eintrag ist dabei eine Kopie, keine neue Rechnung: ändert sich das Produkt später, bleiben
  beide auf ihrem Stand
- „Screenshot": rendert die gesamte Seite als Bild (auch die Teile außerhalb des Bildschirms)

### Scannen & Suchen
- Barcode über die Kamera: nutzt die native `BarcodeDetector`-API, sonst ZXing als Rückfall
- Namenssuche über Open Food Facts, eine eingebaute Tabelle gängiger Grundnahrungsmittel
  (offline) und die selbst angelegten Produkte. Die Trefferliste zeigt Bezeichnung und Marke;
  Einträge ohne jede Nährwertangabe bleiben draußen
- Die Suche filtert auf in Deutschland erhältliche Produkte und wiederholt bei Serverfehlern
  bis zu dreimal. Beides ist nötig, nicht Kosmetik: gemessen kam nur jede vierte Anfrage beim
  ersten Versuch durch, und ohne Länderfilter waren von fünfzehn „Gouda"-Treffern zwei hier
  überhaupt zu kaufen. Antwortet Open Food Facts gar nicht, steht das da — statt eines stillen
  „keine Treffer"
- Keto-Ampel je 100 g mit frei einstellbaren Grenzwerten, Portionsbezug und Anteil am Tagesziel
- Warnhinweise bei zuckerhaltigen Zutaten, Hinweis auf Zuckeralkohole
- Plausibilitätsprüfung: passt die kcal-Angabe nicht zu Fett/KH/Eiweiß, wird das gemeldet
- Ballaststoff-Schalter je Produkt (EU- vs. US-Etikettkonvention)
- Eigene Produkte anlegen oder fehlerhafte Werte korrigieren — eigene Angaben haben ab dann
  immer Vorrang
- **Selbst erfasste Produkte an Open Food Facts zurückgeben** (optional, eigenes Konto nötig):
  ein Knopf am einzelnen Produkt, der vorher zeigt, was genau gesendet würde. Nie automatisch,
  nie mit den erfundenen Barcodes für Produkte ohne Scan, nie ohne Nährwerte

### Listen
- Favoriten, No-Go, Verlauf und Einkaufsliste
- Jede Zeile klappt auf vier Nährwertkacheln je 100 g auf, mit „Eintragen" und „Werte korrigieren"
- Auswertung über 30 Tage: Durchschnitte, Tage im Ziel, längste Serie, Verlaufsdiagramm
- Textbericht für eine Analyse durch ein Sprachmodell (kopieren oder teilen)

### Rezepte
- Zutaten per Suche, Barcode-Scan oder von Hand; Nährwerte pro Portion und gesamt
- Import aus Text oder Foto (Texterkennung mit Tesseract, optional zusätzlich per Gemini)
- Portionsgewicht wird aus den Zutatenmengen abgeleitet („1 P. (240 g)")
- Zutaten auf die Einkaufsliste übernehmen
- Rezepte einzeln exportieren, teilen und importieren — ohne den Rest der Daten
- „📖 Im Kochbuch öffnen": übergibt ein Rezept an das Kochbuch (siehe unten) und springt direkt
  zu dessen Ansicht dort, wo sich Zubereitung, Fotos und mehr ergänzen lassen

### Profil
- Körperdaten, Aktivitätsgrad, Ziel und Defizit; Zielwerte nach Mifflin-St Jeor bzw.
  Katch-McArdle (bei angegebenem Körperfettanteil)
- Ernährungsform steuert die Ampel-Standardwerte, alles bleibt frei editierbar
- Erscheinungsbild je Profil (System/hell/dunkel)
- Export, Import und Teilen der Daten — siehe unten
- Optionaler Gemini-Schlüssel für die KI-gestützte Rezepterkennung
- Optionales Open-Food-Facts-Konto, um eigene Produkte zurückzugeben
- Synchronisierung, Speicherweg, KI-Erkennung und Open Food Facts liegen als vier Zeilen
  zusammen, jede mit ihrem aktuellen Stand

### Zielwerte werden eingefroren
Änderst du heute dein Gewicht oder dein Defizit, ändert das **nicht** rückwirkend die
Bewertung vergangener Tage: für jeden Tag wird ein Schnappschuss der damals gültigen
Zielwerte gespeichert. Dasselbe gilt für eingetragene Mahlzeiten — sie behalten die
Nährwerte, die beim Eintragen galten, auch wenn ein Rezept später korrigiert wird.

---

## Kochbuch

Unter [`kochbuch/`](kochbuch/) liegt eine zweite, eigenständige PWA:
**→ [will-tech-cmd.github.io/keto-dashboard/kochbuch](https://will-tech-cmd.github.io/keto-dashboard/kochbuch/)**

Anders als das Keto-Dashboard ist das Kochbuch bewusst **online und mit Konto** — dafür lässt
es sich vom Handy aus schreiben und ist sofort auf beiden Geräten sichtbar. Es ergänzt Rezepte
um Zubereitungsschritte, Fotos, Zeiten, Schwierigkeit, Kategorien, Bewertung und Kommentare.

- **Backend:** [Supabase](https://supabase.com) (Postgres + Storage), Projektregion eu-west-2.
  Row-Level-Security lässt nur angemeldete Zugriffe zu; ohne Anmeldung ist keine Zeile lesbar.
- **Anmeldung:** ein gemeinsames Zugangswort für ein einziges Konto — die Registrierung neuer
  Konten ist im Projekt gesperrt. Einmalig wird nach eurem Namen gefragt (rein lokal
  gespeichert), damit Einträge und Kommentare erkennen lassen, von wem sie stammen.
- **Fotos** liegen in einem öffentlich lesbaren Storage-Bucket unter nicht erratbaren
  Zufallspfaden — kein Anmelde-Umweg beim Anzeigen, dafür kein echter Zugriffsschutz für wer
  den Pfad kennt.
- **Übernahme aus dem Keto-Dashboard:**
  - **Automatisch, sobald dort die Online-Synchronisierung aktiv ist:** das Kochbuch liest bei
    jedem Start alle Rezepte aus demselben Sync-Datensatz (`keto_sync_state`) und legt neue an
    bzw. aktualisiert geänderte — ganz ohne Klicken, auf jedem angemeldeten Gerät. Ein
    Zeitstempel je Rezept (`keto_updated_at`) sorgt dafür, dass unveränderte Rezepte dabei
    nicht unnötig neu geschrieben werden.
  - **Manuell**, für den Fall ohne aktivierte Synchronisierung: über den Knopf „📖 Im Kochbuch
    öffnen" im Rezept-Editor (nur auf demselben Gerät/Browser, da direkt aus dessen
    `localStorage` gelesen wird) oder über eine exportierte Rezept-Datei (Profil → „Nur
    Rezepte") — das ist der Weg fürs zweite Handy.
  - In beiden Fällen gilt: ein erneuter Import aktualisiert nur Zutaten und Nährwerte;
    Zubereitung, Fotos und Notizen bleiben erhalten.
  - **Auf dem bisherigen Speicherweg läuft die Übernahme nur in eine Richtung.** Änderst du
    im Kochbuch eine Zutat, erfährt die Keto-App davon nichts — und der nächste Abgleich von
    dort ersetzt die Zutatenliste wieder durch ihre eigene. Zutaten gehören dann in die
    Keto-App; Zubereitung, Fotos, Bewertung und Kommentare ins Kochbuch.
  - **Mit dem neuen Speicher (siehe unten) fällt das weg:** Rezepte wandern samt Zutatenliste
    in beide Richtungen, und der automatische Rezept-Import des Kochbuchs hält sich dann
    zurück, damit nicht zwei Stellen dieselben Zeilen schreiben.
- **Titelbilder:** Rezepte ohne Foto bekommen eine erzeugte Kachel — ein Farbverlauf, der aus
  dem Titel gerechnet wird (dasselbe Rezept also überall dieselbe Kachel), und ein Symbol nach
  Art des Gerichts. Sobald ein echtes Foto hochgeladen ist, tritt sie zurück.
- **Beim Kochen:** Die Zubereitungsschritte lassen sich einzeln abhaken, und „Bildschirm
  anlassen" hält das Display wach — im aktiven Zustand farbig, damit man es aus einem Meter
  Abstand sieht.
- **Zurück zur Einkaufsliste:** „Zutaten → Einkaufsliste" im Kochbuch legt die Namen in einer
  kleinen Übergabe-Inbox ab, die das Keto-Dashboard beim nächsten eigenen Start abholt.
- **Offline:** Lesen funktioniert mit dem zuletzt bekannten Stand (eigener Service Worker,
  eigener Cache). Schreiben braucht eine Verbindung — kein Offline-Sync in dieser Version.
- Details zu Datenmodell, RLS-Policies und Architektur: Kommentare in `kochbuch/js/api.js` und
  die Migration `kochbuch_init` im Supabase-Projekt.

---

## Daten, Abgleich und Datenschutz

**Das Keto-Dashboard selbst:** standardmäßig kein Server, kein Konto — alles liegt im
Browser (im `localStorage`, mit dem neuen Speicher in IndexedDB). Die Online-Synchronisierung (siehe unten) ist eine bewusste,
abschaltbare Ausnahme davon, genau wie das Kochbuch.

- **Export/Import/Teilen** im Profil-Tab schreibt bzw. liest eine JSON-Datei. Der
  Produkt-Cache bleibt draußen — er lässt sich jederzeit nachladen und macht den Großteil
  der Dateigröße aus.
- **Import führt zusammen statt zu ersetzen.** Vor dem Einspielen zeigt ein Dialog mit
  echten Zahlen, was dazukommt und was ein Ersetzen kosten würde. Vereinigt wird über die
  IDs (Zufalls-UUIDs, deshalb verlustfrei). Löschungen (Mahlzeit, Wasser, Rezept,
  Einkaufslisten-Eintrag, Favorit/No-Go) werden dabei als solche vermerkt (`tombstones` im
  Zustand) — sonst würde ein Merge sie aus der jeweils anderen, noch ahnungslosen Seite immer
  wieder aufleben lassen, was bei der automatischen Online-Synchronisierung sofort auffiele.
  Bei allem, was sich nachträglich bearbeiten lässt (Menge/Zeitpunkt einer Mahlzeit, Haken auf
  der Einkaufsliste, nachgefüllte Nährwerte bei Favoriten/No-Go, Rezepte, eingefrorene
  Tagesziele, Profileinstellungen), gewinnt die zeitlich neuere Fassung (`updatedAt` bzw.
  `frozenAt`) — bei abweichenden Profileinstellungen wird zusätzlich nachgefragt, falls beide
  Seiten gleichzeitig und ohne Zeitstempel geändert wurden.
- Vor jedem manuellen Import wird eine Sicherung angelegt: **„Letzten Import rückgängig
  machen"**. Die automatische Online-Synchronisierung legt diese Sicherung bewusst nicht bei
  jedem Durchlauf neu an — sie bleibt dem bewussten, manuellen Datei-Import vorbehalten.
- **Üblicher Ablauf zwischen zwei Geräten ohne Synchronisierung:** auf Gerät A exportieren,
  per Teilen rüberschicken, auf Gerät B importieren und zusammenführen — danach in die
  Gegenrichtung.
- **Online-Synchronisierung (optional, Profil-Tab):** mit dem gemeinsamen Kochbuch-
  Zugangswort gleicht die App automatisch zwischen euren Geräten ab, statt Dateien hin- und
  herzuschicken — technisch derselbe Merge wie beim manuellen Import, nur automatisch über
  Supabase transportiert. Ausgeschaltet standardmäßig; wer sie nie aktiviert, für den ändert
  sich nichts. **Achtung beim ersten Aktivieren auf zwei bereits eigenständig eingerichteten
  Geräten:** da jedes Gerät seine zwei Profile mit eigenen, zufälligen IDs anlegt, erkennt der
  Abgleich sie nicht automatisch als "dasselbe" Profil — nach dem ersten Sync stehen deshalb
  gegebenenfalls vier Profil-Reiter da. Ab dem dritten Profil erscheint neben jedem
  nicht-aktiven Profil ein ✕ zum Aufräumen — und das hält jetzt: gelöschte Profile haben
  einen Grabstein wie jede andere Liste und kommen beim nächsten Abgleich nicht zurück.
- **Neuer Speicher (Profil-Tab, standardmäßig aus).** Der bisherige Weg legt den kompletten
  Zustand als *ein* JSON ab und gleicht ihn auch als Ganzes ab — die Zusammenführung muss
  deshalb im Client nachgebaut werden, und genau dort steckten die Datenverluste. Der neue
  Weg legt jede Mahlzeit, jedes Rezept und jeden Listeneintrag einzeln in IndexedDB ab und
  gleicht sie einzeln ab; die Zusammenführung macht die Datenbank. Was auf dem Server
  gelöscht wurde, kommt als Zeile mit gesetztem `geloescht_am` — die `tombstones` im Client
  entfallen damit ersatzlos. Ein Trigger verwirft Schreibvorgänge, die älter sind als der
  gespeicherte Stand: ein Gerät, das eine Woche offline war, kann keine neuere Änderung mehr
  überbügeln.

  Der Schalter wirkt in beide Richtungen und nimmt den aktuellen Stand jeweils mit. **Er
  gehört auf alle Geräte eines Haushalts:** solange eines noch den alten Weg benutzt, sehen
  die beiden voneinander nichts Neues mehr — verloren geht dabei nichts, jedes Gerät behält
  seinen vollständigen Stand, und sobald beide umgestellt sind, treffen sie sich wieder.

  Nicht abgeglichen werden Verlauf, Produkt-Cache, „zuletzt gescannt" und das aktive Profil.
  Die bleiben absichtlich auf dem Gerät.

  **Rezepte wandern samt Zutatenliste.** Die Zutaten stehen serverseitig in
  `kochbuch_zutaten` — einer Tabelle ohne `haushalt_id` und ohne `updated_at`, die am
  Abgleich über den Zeiger deshalb nicht selbst teilnehmen kann. Sie sind aber auch keine
  eigene Datenart, sondern ein Teil des Rezepts: die App führt sie als geordnete Liste, und
  beide Editoren ersetzen sie immer als Ganzes. Sie wandern deshalb als `kinder` des Rezepts
  mit — wer den Rezeptkopf gewinnt, gewinnt seine Zutaten. Die `id` einer Zutat wird dabei
  zur `id` der Zeile, damit dieselbe Zutat auf allen Geräten dieselbe id behält.

  Damit läuft der Weg **Kochbuch → Keto-App** zum ersten Mal: eine dort geänderte oder
  gelöschte Zutat kommt in der Keto-App an. Auf dem bisherigen Weg ging das nur in eine
  Richtung. Solange auf einem Gerät der Zeilenmodus läuft, lässt der automatische
  Rezept-Import des Kochbuchs (`keto-sync-import.js`) die Finger davon — sonst schrieben
  zwei Stellen dieselben Zeilen.

  Ein Rezept, das **im Kochbuch** entstanden ist, hat keine `keto_id` und bleibt vorerst
  draußen, statt als Bruchstück ohne id in der App zu landen.

- Ein **Gemini-API-Schlüssel** (falls hinterlegt) liegt unter einem eigenen Speicherschlüssel
  und wird weder exportiert noch geteilt noch synchronisiert.
- Ein **Open-Food-Facts-Konto** (falls hinterlegt) liegt ebenso unter einem eigenen
  Speicherschlüssel und wird weder exportiert noch geteilt noch synchronisiert.
- Nach außen gehen nur:
  - Anfragen an Open Food Facts beim Suchen und Scannen.
  - Bilder und Texte an die Gemini-API — nur mit hinterlegtem Schlüssel und nur, wenn du den
    KI-Knopf drückst.
  - Anfragen an das Supabase-Projekt des Kochbuchs — nur bei aktivierter Synchronisierung.
    Auf dem bisherigen Weg landet dort der komplette App-Zustand als ein JSON-Datensatz, auf
    dem neuen die einzelnen Zeilen.
  - **Ein Produkt an Open Food Facts** — nur mit hinterlegtem Konto und nur, wenn du bei
    diesem einen Produkt auf „beitragen" tippst. Was dabei gesendet wird, steht vorher auf
    dem Bildschirm. Ein Beitrag ist öffentlich, dauerhaft und trägt deinen Kontonamen.

---

## Technik

Reines HTML, CSS und ES-Module. **Kein Build-Schritt, keine npm-Abhängigkeiten** — was im
Repository liegt, ist genau das, was ausgeliefert wird. Alle Fremdbibliotheken sind unter
`vendor/` eingecheckt, damit die App vollständig offline funktioniert.

### Aktualisierung und Offline-Betrieb

Der Service Worker holt HTML, CSS und JS **network-first** (mit `cache: "no-cache"`, damit
per ETag nur nachgefragt statt neu geladen wird) und fällt nach 3 Sekunden oder bei einem
Fehler auf den Cache zurück. Damit zeigt schon der erste Reload den neuen Stand. Schriften,
Symbole und `vendor/` bleiben cache-first — sie sind groß und ändern sich praktisch nie.
Übernimmt ein neuer Service Worker, lädt die App sich einmalig selbst neu, aber nie während
einer Eingabe. Welcher Stand läuft, steht unten im Profil-Tab.

Bei jeder Änderung an ausgelieferten Dateien wird `CACHE_NAME` in `sw.js` hochgezählt — das
Kochbuch hat mit `kochbuch/sw.js` einen eigenen, unabhängig zu pflegenden Service Worker.

### Projektstruktur

```
index.html              App-Gerüst: Kopfzeile, Ansicht, Fußleiste
sw.js                   Service Worker (Caching-Strategie, Cache-Version)
manifest.webmanifest    PWA-Manifest inkl. Homescreen-Kurzbefehle
css/app.css             sämtliche Styles, Farb-Tokens für hell/dunkel

js/
  app.js                Einstieg, Tab-Navigation, Eintragen-Sheet, SW-Registrierung
  store.js              Zustand im Speicher, Speicherweg, Export/Import, Zusammenführen
  profiles.js           Zielwertberechnung (Mifflin-St Jeor / Katch-McArdle)
  keto.js               Netto-KH, Ampel, Zutatenwarnungen, Plausibilität
  off.js                Open Food Facts: Suche, Normalisierung, Cache, eigene Produkte
  off-beitrag.js        eigene Produkte an Open Food Facts zurückgeben (optional)
  foods-db.js           eingebaute Nährwerttabelle mit Fuzzy-Suche (offline)
  consumption.js        Mahlzeiten eintragen/bearbeiten, Wasser, Mengen-Dialoge
  recipes.js            Rezeptrechnung, Zutatenerkennung, Texterkennung
  ingredient-parser.js  deutscher Zutaten-Text-Parser (auch vom Kochbuch genutzt)
  lists.js              Listen-Tab und Auswertungsseite
  analysis.js           Textbericht für die KI-Analyse
  ai.js                 optionale Gemini-Anbindung
  sync.js               optionale Online-Synchronisierung über Supabase (Profil-Tab)
  modus.js              Schalter zwischen altem und neuem Speicherweg (Standard: alt)
  ablage.js             der neue Speicherweg aus Sicht von store.js (Vergleich → Zeilen)
  db.js                 IndexedDB: eine Zeile je Mahlzeit/Rezept/Eintrag, Outbox, Zeiger
  entities.js           Zustand ⇄ flache Listen je Datenart
  rows.js               Übersetzung App-Schreibweise ⇄ Server-Spalten
  umzug.js              einmaliger Umzug vom JSON-Klumpen in die Zeilen
  supabase.js           Sitzung, Anmeldung, Anfragen (von sync.js und sync2.js geteilt)
  sync2.js              zeilenweiser Abgleich: Upsert je Zeile, Pull je Datenart
  scanner.js            Kamera und Barcode-Erkennung
  product-editor.js     gemeinsames Formular „Produkt anlegen / Werte korrigieren"
  ui.js                 geteilte Helfer: Dialoge, Snackbar, Tastaturabstand, Theme
  views/                start.js, scan.js, recipes.js, profile.js, onboarding.js

vendor/                 eingecheckte Fremdbibliotheken (siehe unten)
icons/                  PWA-Icons
scripts/gen_icons.py    erzeugt die Icons ohne externe Abhängigkeiten

kochbuch/               eigenständige PWA mit Supabase-Backend — siehe Abschnitt "Kochbuch" oben
  js/titelbild.js       erzeugte Titelkachel für Rezepte ohne Foto
  js/keto-bridge.js     Übersetzung Keto-Rezept -> Kochbuch (nutzt js/rows.js mit)
```

### Lokal starten

Ein einfacher statischer Server genügt; `file://` funktioniert wegen der ES-Module nicht.

```bash
python -m http.server 8000
```

Danach [http://localhost:8000](http://localhost:8000) öffnen. Kamera und Service Worker
brauchen einen sicheren Kontext — `localhost` gilt als sicher, im Netzwerk ist HTTPS nötig.

Beim Testen hält der Browser Module hartnäckig im Cache. Am zuverlässigsten ist ein
Portwechsel zwischen zwei Testläufen, sonst „Anwendungsdaten löschen" in den Entwicklertools.

### Deployment

GitHub Pages liefert den `main`-Branch direkt aus, ein Push genügt. Es gibt keinen
Build-Schritt und keine Workflow-Datei.

---

## Eingecheckte Fremdbibliotheken

| Verzeichnis | Zweck | Lizenz |
|---|---|---|
| `vendor/zxing/` | Barcode-Erkennung, wenn der Browser keine `BarcodeDetector`-API hat | MIT (`@zxing/library`) |
| `vendor/tesseract/` | Texterkennung für den Rezept-Import aus Fotos, inkl. deutscher Sprachdaten | Apache-2.0 (Tesseract.js, tessdata) |
| `vendor/dom-to-image-more/` | rendert die Startseite als Bild (v3.10.2) | MIT |
| `vendor/manrope/` | Schriftart Manrope (variabel) | SIL Open Font License 1.1 |

Produktdaten stammen von [Open Food Facts](https://world.openfoodfacts.org/) und stehen
unter der Open Database License (ODbL). Die eingebaute Nährwerttabelle in `foods-db.js`
sind Richtwerte auf Basis gängiger Nährwerttabellen.

---

## Hinweis

Die berechneten Werte sind Richtwerte auf Basis gängiger Formeln und **keine medizinische
Beratung**. Bei gesundheitlichen Fragen bitte ärztlichen Rat einholen.

## Lizenz

Für dieses Projekt ist keine Lizenz hinterlegt; es gilt das gesetzliche Urheberrecht.
Die Dateien unter `vendor/` stehen unter ihren jeweils eigenen, oben genannten Lizenzen.
