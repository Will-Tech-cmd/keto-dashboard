-- =============================================================================
-- Härtung nach dem Supabase-Security-Linter
--
-- 1) stand_fortschreiben() hatte keinen festen search_path. Bei einer Trigger-
--    funktion ohne Bindung könnte ein Aufrufer mit eigenem Suchpfad steuern, welche
--    Objekte darin aufgelöst werden.
-- 2) meine_haushalte() und neuer_einladungscode() lagen in public und waren damit
--    über /rest/v1/rpc/ aufrufbar — auch für nicht angemeldete Besucher. Gebraucht
--    werden sie nur INNERHALB von Policies und anderen Funktionen. Deshalb ins
--    Schema "private", das PostgREST nicht ausliefert.
-- 3) Die drei Haushalts-RPCs MÜSSEN über die API erreichbar bleiben (die App ruft
--    sie auf), aber nur für Angemeldete. anon verliert das Ausführungsrecht.
--
-- Danach meldet der Linter nur noch, dass Angemeldete die drei Haushalts-RPCs
-- aufrufen dürfen — das ist genau ihr Zweck und bleibt so.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from anon, authenticated;
grant usage on schema private to authenticated;

-- --- 1) Triggerfunktion mit festem Suchpfad -----------------------------------
create or replace function public.stand_fortschreiben()
returns trigger language plpgsql security invoker set search_path = '' as $fn$
begin
  if tg_op = 'UPDATE' and new.geaendert_am is not null and old.geaendert_am is not null
     and new.geaendert_am < old.geaendert_am then
    return null;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

-- --- 2) Helfer aus der API nehmen ---------------------------------------------
create or replace function private.neuer_einladungscode()
returns text language sql volatile set search_path = '' as $fn$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (random()*30)::int + 1, 1), '')
  from generate_series(1,10);
$fn$;

create or replace function private.meine_haushalte()
returns setof uuid language sql stable security definer set search_path = '' as $fn$
  select haushalt_id from public.haushalt_mitglied where user_id = auth.uid();
$fn$;

comment on function private.meine_haushalte() is
  'Haushalts-IDs des angemeldeten Nutzers. Basis jeder RLS-Policy. SECURITY DEFINER gegen Rekursion auf haushalt_mitglied; im Schema private, damit sie nicht über die REST-API aufrufbar ist.';

grant execute on function private.meine_haushalte() to authenticated;
grant execute on function private.neuer_einladungscode() to authenticated;

-- --- 3) Policies auf die neue Fundstelle umhängen ------------------------------
drop policy if exists haushalt_sichtbar on public.haushalt;
create policy haushalt_sichtbar on public.haushalt for select to authenticated
  using (id in (select private.meine_haushalte()));

drop policy if exists haushalt_aendern on public.haushalt;
create policy haushalt_aendern on public.haushalt for update to authenticated
  using (id in (select private.meine_haushalte()))
  with check (id in (select private.meine_haushalte()));

drop policy if exists mitglied_sichtbar on public.haushalt_mitglied;
create policy mitglied_sichtbar on public.haushalt_mitglied for select to authenticated
  using (haushalt_id in (select private.meine_haushalte()));

do $blk$
declare t text;
begin
  foreach t in array array['profil','mahlzeit','wasser','tagesziel','listen_eintrag','einkauf','produkt_korrektur'] loop
    execute format('drop policy if exists %1$s_haushalt on public.%1$s', t);
    execute format('create policy %1$s_haushalt on public.%1$s for all to authenticated
      using (haushalt_id in (select private.meine_haushalte()))
      with check (haushalt_id in (select private.meine_haushalte()))', t);
  end loop;
end; $blk$;

drop policy if exists kochbuch_rezepte_haushalt on public.kochbuch_rezepte;
create policy kochbuch_rezepte_haushalt on public.kochbuch_rezepte for all to authenticated
  using (haushalt_id in (select private.meine_haushalte()))
  with check (haushalt_id in (select private.meine_haushalte()));

do $blk$
declare t text;
begin
  foreach t in array array['kochbuch_zutaten','kochbuch_schritte','kochbuch_bilder','kochbuch_kommentare'] loop
    execute format('drop policy if exists %1$s_haushalt on public.%1$s', t);
    execute format('create policy %1$s_haushalt on public.%1$s for all to authenticated
      using (exists (select 1 from public.kochbuch_rezepte r where r.id = %1$s.rezept_id
                     and r.haushalt_id in (select private.meine_haushalte())))
      with check (exists (select 1 from public.kochbuch_rezepte r where r.id = %1$s.rezept_id
                     and r.haushalt_id in (select private.meine_haushalte())))', t);
  end loop;
end; $blk$;

do $blk$
declare v_haushalt uuid;
begin
  select id into v_haushalt from public.haushalt order by created_at limit 1;
  execute 'drop policy if exists keto_sync_bestandshaushalt on public.keto_sync_state';
  execute format(
    'create policy keto_sync_bestandshaushalt on public.keto_sync_state
     for all to authenticated
     using (%L::uuid in (select private.meine_haushalte()))
     with check (%L::uuid in (select private.meine_haushalte()))',
    v_haushalt, v_haushalt);
end; $blk$;

-- --- 4) Haushalts-RPCs auf die neuen Helfer, nur für Angemeldete ---------------
create or replace function public.haushalt_anlegen(p_name text default 'Haushalt')
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet.' using errcode='28000'; end if;
  insert into public.haushalt (name, einladungscode, einladung_gueltig_bis)
  values (coalesce(nullif(btrim(p_name),''),'Haushalt'), private.neuer_einladungscode(), now() + interval '7 days')
  returning id into v_id;
  insert into public.haushalt_mitglied (haushalt_id, user_id, rolle) values (v_id, auth.uid(), 'besitzer');
  return v_id;
end; $fn$;

create or replace function public.haushalt_beitreten(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet.' using errcode='28000'; end if;
  select id into v_id from public.haushalt
   where upper(einladungscode) = upper(btrim(p_code))
     and (einladung_gueltig_bis is null or einladung_gueltig_bis > now());
  if v_id is null then raise exception 'Einladungscode unbekannt oder abgelaufen.' using errcode='22023'; end if;
  insert into public.haushalt_mitglied (haushalt_id, user_id) values (v_id, auth.uid()) on conflict do nothing;
  return v_id;
end; $fn$;

create or replace function public.haushalt_einladung_erneuern(p_haushalt_id uuid)
returns text language plpgsql security definer set search_path = '' as $fn$
declare v_code text;
begin
  if not exists (select 1 from public.haushalt_mitglied where haushalt_id = p_haushalt_id and user_id = auth.uid()) then
    raise exception 'Kein Mitglied dieses Haushalts.' using errcode='42501';
  end if;
  v_code := private.neuer_einladungscode();
  update public.haushalt set einladungscode = v_code, einladung_gueltig_bis = now() + interval '7 days', updated_at = now()
   where id = p_haushalt_id;
  return v_code;
end; $fn$;

revoke execute on function public.haushalt_anlegen(text) from public, anon;
revoke execute on function public.haushalt_beitreten(text) from public, anon;
revoke execute on function public.haushalt_einladung_erneuern(uuid) from public, anon;
grant execute on function public.haushalt_anlegen(text) to authenticated;
grant execute on function public.haushalt_beitreten(text) to authenticated;
grant execute on function public.haushalt_einladung_erneuern(uuid) to authenticated;

drop function if exists public.meine_haushalte();
drop function if exists public.neuer_einladungscode();
