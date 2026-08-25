-- =============================================================================
-- Eine Mahlzeit kann geplant sein, bevor sie gegessen ist.
--
-- Die App kann seit jeher auf zukünftige Tage blättern und dort eintragen. Was
-- fehlte, war der Unterschied zwischen "das habe ich gegessen" und "das habe ich
-- mir für Donnerstag vorgenommen". Ohne ihn zählte ein Plan, den niemand gegessen
-- hat, am Abend als Mahlzeit.
--
-- Bewusst eine Spalte an `mahlzeit` und keine eigene Tabelle: ein Plan ist
-- dieselbe Zeile mit demselben Nährwert-Schnappschuss, nur noch nicht bestätigt.
-- Eine zweite Tabelle hieße, jede Auswertung an zwei Stellen zu fragen.
--
-- `default false` macht das Nachziehen bestehender Zeilen überflüssig: was vor
-- dieser Migration entstand, ist gegessen. Und ein Client vom alten Stand schickt
-- die Spalte nicht mit — PostgREST fasst beim Upsert nur die mitgeschickten
-- Spalten an, der Wert bleibt also stehen.
-- =============================================================================

alter table public.mahlzeit
  add column if not exists geplant boolean not null default false;

comment on column public.mahlzeit.geplant is
  'true = vorgemerkt, noch nicht bestätigt gegessen. Wird beim Bestätigen auf false gesetzt.';
