-- Einkaufsliste: Menge und Einheit je Zeile.
--
-- Bisher war eine Einkaufszeile reiner Text. „Rezept auf die Einkaufsliste" übergab nur die
-- Namen; wer zweimal kocht oder dieselbe Zutat aus zwei Rezepten braucht, hatte nichts zum
-- Addieren. Die Menge steht jetzt als Zahl + Einheit daneben (einkauf.js in der App);
-- Handeinträge lassen beides leer.
--
-- Nur Gramm oder Stück: "EL" oder "Packung" ließen sich nicht zusammenzählen, und beim
-- Einkaufen zählt man Gramm oder Stück.

alter table public.einkauf
  add column if not exists menge   numeric,
  add column if not exists einheit text;

alter table public.einkauf drop constraint if exists einkauf_einheit_check;
alter table public.einkauf
  add constraint einkauf_einheit_check
  check (einheit is null or einheit in ('g', 'Stk'));

alter table public.einkauf drop constraint if exists einkauf_menge_check;
alter table public.einkauf
  add constraint einkauf_menge_check
  check (menge is null or (menge > 0 and menge < 1000000));
