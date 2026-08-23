-- =============================================================================
-- Rücknahme zu 20260823120000_haushalt_und_zeilenmodell.sql
--
-- Kein Teil des normalen Migrationslaufs (Supabase kennt keine Abwärts-Migration) —
-- dieses Skript liegt hier für den Fall, dass nach dem Anwenden etwas klemmt und
-- der Stand von vorher gebraucht wird.
--
-- ACHTUNG: löscht die neuen Tabellen SAMT INHALT. Nur so lange gefahrlos, wie noch
-- nichts über das Zeilenmodell eingetragen wurde — also vor B2/B3. Danach wäre der
-- Weg zurück ein Export, kein DROP.
-- =============================================================================

begin;

-- 1. Neue Tabellen weg (Reihenfolge wegen der Fremdschlüssel)
drop table if exists public.tagesziel;
drop table if exists public.wasser;
drop table if exists public.mahlzeit;
drop table if exists public.listen_eintrag;
drop table if exists public.einkauf;
drop table if exists public.produkt_korrektur;
drop table if exists public.profil;
drop table if exists public.haushalt_mitglied;
drop table if exists public.haushalt cascade;

-- 2. Kochbuch-Rezepte auf den alten Stand
alter table public.kochbuch_rezepte
  drop column if exists haushalt_id,
  drop column if exists geaendert_am;

-- 3. Trigger zurück auf die alte Fassung
drop trigger if exists trg_kochbuch_rezepte_stand on public.kochbuch_rezepte;
create trigger trg_kochbuch_rezepte_updated_at
  before update on public.kochbuch_rezepte
  for each row execute function kochbuch_set_updated_at();

-- 4. Die alte, offene RLS wiederherstellen
do $blk$
declare
  t text;
begin
  foreach t in array array[
    'kochbuch_rezepte', 'kochbuch_zutaten', 'kochbuch_schritte',
    'kochbuch_bilder', 'kochbuch_kommentare'
  ] loop
    execute format('drop policy if exists %1$s_haushalt on public.%1$s', t);
    execute format('drop policy if exists kochbuch_alles on public.%1$s', t);
    execute format(
      'create policy kochbuch_alles on public.%1$s for all to authenticated
       using (true) with check (true)', t);
  end loop;
end;
$blk$;

-- 5. Funktionen weg
drop function if exists public.haushalt_einladung_erneuern(uuid);
drop function if exists public.haushalt_beitreten(text);
drop function if exists public.haushalt_anlegen(text);
drop function if exists public.meine_haushalte();
drop function if exists public.neuer_einladungscode();
drop function if exists public.stand_fortschreiben();

comment on table public.keto_sync_state is null;

commit;
