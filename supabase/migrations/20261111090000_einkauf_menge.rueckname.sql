-- Rücknahme von 20261111090000_einkauf_menge.sql: Spalten samt Prüfregeln entfernen.
-- Die App liest fehlende Spalten als "ohne Menge" — die Zeilen selbst bleiben erhalten.

alter table public.einkauf drop constraint if exists einkauf_einheit_check;
alter table public.einkauf drop constraint if exists einkauf_menge_check;
alter table public.einkauf
  drop column if exists menge,
  drop column if exists einheit;
