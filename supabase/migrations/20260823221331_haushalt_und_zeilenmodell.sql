-- =============================================================================
-- B1 — Haushalts-Modell und Zeilen statt einem JSON-Blob
--
-- Bisher: ein gemeinsames Konto, RLS "true" für alle Angemeldeten, der komplette
-- Zustand der Keto-App als EINE jsonb-Zeile (keto_sync_state). Damit lässt sich
-- weder ein zweiter Nutzer noch eine Kontolöschung abbilden.
--
-- Danach: ein Konto je Person, ein Haushalt als Gruppe, jede Datenart eine Tabelle.
-- Löschungen sind Soft-Deletes (geloescht_am) statt Grabsteinkarten im Client, und
-- der Abgleich holt schlicht alles mit updated_at > letzter_stand.
--
-- Diese Migration ist ADDITIV und lässt die laufenden Apps weiterlaufen:
--   * keto_sync_state bleibt unangetastet (siehe Hinweis am Ende).
--   * Die kochbuch_*-Tabellen behalten ihre Namen und Spalten, bekommen aber
--     haushalt_id und eine echte RLS. Damit das gemeinsame Konto weiterarbeiten
--     kann, wird es unten in den Bestandshaushalt aufgenommen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Zeitstempel: zwei verschiedene, mit zwei verschiedenen Aufgaben
--
--   updated_at    setzt der SERVER. Nur dafür da, dass ein Gerät beim Abgleich
--                 "gib mir alles seit X" fragen kann. Uhren, die auf zwei Handys
--                 unterschiedlich gehen, dürfen diesen Zeiger nicht verbiegen.
--   geaendert_am  setzt der CLIENT beim Bearbeiten. Entscheidet, welche von zwei
--                 Fassungen die neuere ist.
-- -----------------------------------------------------------------------------
create or replace function public.stand_fortschreiben()
returns trigger
language plpgsql
as $$
begin
  -- Ein Gerät, das lange offline war, darf mit seinem alten Stand keine neuere
  -- Änderung überschreiben. Ohne diese Sperre gewinnt schlicht, wer zuletzt
  -- hochlädt — genau der Fehler, der im JSON-Blob-Abgleich Daten gekostet hat.
  -- NULL heißt "diese Zeile unverändert lassen"; der Aufrufer bekommt dann eine
  -- leere Antwort zurück und weiß, dass seine Fassung veraltet war.
  if tg_op = 'UPDATE'
     and new.geaendert_am is not null
     and old.geaendert_am is not null
     and new.geaendert_am < old.geaendert_am then
    return null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.stand_fortschreiben() is
  'BEFORE INSERT/UPDATE: setzt updated_at serverseitig und verwirft Schreibvorgänge, die älter sind als der gespeicherte Stand.';

-- -----------------------------------------------------------------------------
-- 2. Haushalt und Mitgliedschaft
-- -----------------------------------------------------------------------------
create table if not exists public.haushalt (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null default 'Haushalt',
  einladungscode        text unique,
  einladung_gueltig_bis timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.haushalt_mitglied (
  haushalt_id    uuid not null references public.haushalt(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  rolle          text not null default 'mitglied' check (rolle in ('besitzer', 'mitglied')),
  beigetreten_am timestamptz not null default now(),
  primary key (haushalt_id, user_id)
);

create index if not exists haushalt_mitglied_user_idx on public.haushalt_mitglied (user_id);

-- Welche Haushalte gehören mir? SECURITY DEFINER mit Absicht: die Funktion umgeht
-- damit die RLS auf haushalt_mitglied. Würde die Policy dieser Tabelle die Tabelle
-- selbst abfragen, drehte sich Postgres im Kreis ("infinite recursion in policy").
create or replace function public.meine_haushalte()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select haushalt_id from public.haushalt_mitglied where user_id = auth.uid();
$$;

comment on function public.meine_haushalte() is
  'Haushalts-IDs des angemeldeten Nutzers. Basis jeder RLS-Policy; SECURITY DEFINER, um Rekursion auf haushalt_mitglied zu vermeiden.';

-- -----------------------------------------------------------------------------
-- 3. Haushalt anlegen und beitreten
--
-- Beides als Funktion statt über direkte INSERTs: wer beitritt, darf den Haushalt
-- vor dem Beitritt noch gar nicht sehen (RLS), und das Anlegen muss Haushalt und
-- Mitgliedschaft in einem Rutsch erledigen — sonst bleibt bei einem Abbruch ein
-- Haushalt zurück, in den niemand mehr hineinkommt.
-- -----------------------------------------------------------------------------
create or replace function public.neuer_einladungscode()
returns text
language sql
volatile
as $$
  -- 10 Zeichen ohne 0/O/1/I/L — die verwechselt man beim Abtippen oder Vorlesen.
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (random() * 30)::int + 1, 1), '')
  from generate_series(1, 10);
$$;

create or replace function public.haushalt_anlegen(p_name text default 'Haushalt')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;

  insert into public.haushalt (name, einladungscode, einladung_gueltig_bis)
  values (coalesce(nullif(btrim(p_name), ''), 'Haushalt'),
          public.neuer_einladungscode(),
          now() + interval '7 days')
  returning id into v_id;

  insert into public.haushalt_mitglied (haushalt_id, user_id, rolle)
  values (v_id, auth.uid(), 'besitzer');

  return v_id;
end;
$$;

create or replace function public.haushalt_beitreten(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;

  select id into v_id
  from public.haushalt
  where upper(einladungscode) = upper(btrim(p_code))
    and (einladung_gueltig_bis is null or einladung_gueltig_bis > now());

  if v_id is null then
    raise exception 'Einladungscode unbekannt oder abgelaufen.' using errcode = '22023';
  end if;

  insert into public.haushalt_mitglied (haushalt_id, user_id)
  values (v_id, auth.uid())
  on conflict do nothing;

  return v_id;
end;
$$;

-- Code neu würfeln (z.B. nachdem jemand beigetreten ist oder er zu weit gestreut wurde).
create or replace function public.haushalt_einladung_erneuern(p_haushalt_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not exists (select 1 from public.haushalt_mitglied
                 where haushalt_id = p_haushalt_id and user_id = auth.uid()) then
    raise exception 'Kein Mitglied dieses Haushalts.' using errcode = '42501';
  end if;

  v_code := public.neuer_einladungscode();
  update public.haushalt
     set einladungscode = v_code,
         einladung_gueltig_bis = now() + interval '7 days',
         updated_at = now()
   where id = p_haushalt_id;

  return v_code;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Datentabellen
--
-- Alle nach demselben Muster: id, haushalt_id, fachliche Spalten, geaendert_am
-- (Client), updated_at (Server), geloescht_am (Soft-Delete). Genau diese vier
-- Spalten braucht der Abgleich — mehr weiß er über keine Tabelle.
-- -----------------------------------------------------------------------------
create table if not exists public.profil (
  id                uuid primary key default gen_random_uuid(),
  haushalt_id       uuid not null references public.haushalt(id) on delete cascade,
  name              text not null,
  geschlecht        text not null default 'female' check (geschlecht in ('female', 'male')),
  alter_jahre       integer not null default 35 check (alter_jahre between 1 and 120),
  groesse_cm        numeric not null default 170,
  gewicht_kg        numeric not null default 70,
  koerperfett_pct   numeric check (koerperfett_pct is null or koerperfett_pct between 1 and 70),
  aktivitaet        numeric not null default 1.375,
  ziel              text not null default 'lose' check (ziel in ('lose', 'maintain', 'gain')),
  defizit_pct       numeric not null default 15,
  eiweiss_faktor    numeric not null default 1.6,
  netto_kh_limit_g  numeric not null default 20,
  ernaehrungsform   text not null default 'keto',
  ampel_grenzen     jsonb not null default '{"green": 5, "yellow": 10}'::jsonb,
  wasser_ziel_ml    integer not null default 2500,
  erscheinungsbild  text not null default 'system',
  ring_stil         text not null default 'rings',
  geaendert_am      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  geloescht_am      timestamptz
);

-- Rezepte: die vorhandene kochbuch_rezepte IST ab jetzt die eine Rezept-Tabelle
-- für beide Apps (Entscheidung B0.3). Der Name bleibt, um die laufende
-- Kochbuch-App nicht zu zerreißen — ein Umbenennen ist reine Kosmetik und kann
-- später über eine Sicht nachgeholt werden.
alter table public.kochbuch_rezepte
  add column if not exists haushalt_id uuid references public.haushalt(id) on delete cascade,
  add column if not exists geaendert_am timestamptz not null default now();

create table if not exists public.mahlzeit (
  id           uuid primary key default gen_random_uuid(),
  haushalt_id  uuid not null references public.haushalt(id) on delete cascade,
  profil_id    uuid not null references public.profil(id) on delete cascade,
  datum        date not null,
  mahlzeit     text check (mahlzeit is null or mahlzeit in ('breakfast', 'lunch', 'dinner', 'snack')),
  -- barcode trägt weiterhin auch "recipe:<uuid>", damit die Schnellauswahl im
  -- Eintragen-Sheet unverändert danach gruppieren kann.
  barcode      text,
  rezept_id    uuid references public.kochbuch_rezepte(id) on delete set null,
  name         text not null,
  gramm        numeric,
  portionen    numeric,
  portion_g    numeric,
  kcal         numeric,
  netto_kh     numeric,
  fett         numeric,
  eiweiss      numeric,
  erfasst_am   timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  geloescht_am timestamptz,
  -- Entweder eine Menge in Gramm (Produkt) oder in Portionen (Rezept).
  constraint mahlzeit_menge check (gramm is not null or portionen is not null)
);

create table if not exists public.wasser (
  id           uuid primary key default gen_random_uuid(),
  haushalt_id  uuid not null references public.haushalt(id) on delete cascade,
  profil_id    uuid not null references public.profil(id) on delete cascade,
  datum        date not null,
  ml           integer not null check (ml > 0),
  erfasst_am   timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  geloescht_am timestamptz
);

-- Eingefrorene Tagesziele: ein Datensatz je Profil und Tag, wird nie gelöscht.
create table if not exists public.tagesziel (
  id             uuid primary key default gen_random_uuid(),
  haushalt_id    uuid not null references public.haushalt(id) on delete cascade,
  profil_id      uuid not null references public.profil(id) on delete cascade,
  datum          date not null,
  kcal           numeric not null,
  netto_kh_g     numeric not null,
  fett_g         numeric not null,
  eiweiss_g      numeric not null,
  geaendert_am   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (profil_id, datum)
);

-- Favoriten und No-Go in EINER Tabelle mit einer Spalte "art". Damit ist der Wechsel
-- zwischen beiden ein UPDATE derselben Zeile — und der Fehler, bei dem ein Produkt
-- nach dem Abgleich auf beiden Listen stand, ist strukturell nicht mehr möglich.
create table if not exists public.listen_eintrag (
  id           uuid primary key default gen_random_uuid(),
  haushalt_id  uuid not null references public.haushalt(id) on delete cascade,
  art          text not null check (art in ('favorit', 'nogo')),
  barcode      text not null,
  name         text not null,
  marke        text,
  naehrwerte   jsonb,
  ampel        text,
  geaendert_am timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  geloescht_am timestamptz
);

create table if not exists public.einkauf (
  id           uuid primary key default gen_random_uuid(),
  haushalt_id  uuid not null references public.haushalt(id) on delete cascade,
  text         text not null,
  erledigt     boolean not null default false,
  barcode      text,
  geaendert_am timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  geloescht_am timestamptz
);

-- Eigene Produkte und der EU/US-Ballaststoff-Schalter sind beides Korrekturen zu
-- EINEM Barcode — deshalb eine Zeile je Barcode statt zweier getrennter Karten.
create table if not exists public.produkt_korrektur (
  id                    uuid primary key default gen_random_uuid(),
  haushalt_id           uuid not null references public.haushalt(id) on delete cascade,
  barcode               text not null,
  daten                 jsonb,    -- eigenes/korrigiertes Produkt; null = keine eigenen Werte
  ballaststoff_abziehen boolean,  -- null = automatisch nach Herkunft entscheiden
  geaendert_am          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  geloescht_am          timestamptz
);

-- Ein Barcode kann nur einmal je Haushalt auf einer Liste bzw. als Korrektur stehen.
-- Als partieller Index, damit ein weggelöschter Eintrag den Barcode nicht für immer
-- blockiert (das war der Grund, warum Grabsteine im Client so schwierig waren).
create unique index if not exists listen_eintrag_barcode_uniq
  on public.listen_eintrag (haushalt_id, barcode) where geloescht_am is null;
create unique index if not exists produkt_korrektur_barcode_uniq
  on public.produkt_korrektur (haushalt_id, barcode) where geloescht_am is null;

-- -----------------------------------------------------------------------------
-- 5. Indizes für den Abgleich und die Tagesansicht
-- -----------------------------------------------------------------------------
create index if not exists profil_stand_idx            on public.profil (haushalt_id, updated_at);
create index if not exists mahlzeit_stand_idx          on public.mahlzeit (haushalt_id, updated_at);
create index if not exists wasser_stand_idx            on public.wasser (haushalt_id, updated_at);
create index if not exists tagesziel_stand_idx         on public.tagesziel (haushalt_id, updated_at);
create index if not exists listen_eintrag_stand_idx    on public.listen_eintrag (haushalt_id, updated_at);
create index if not exists einkauf_stand_idx           on public.einkauf (haushalt_id, updated_at);
create index if not exists produkt_korrektur_stand_idx on public.produkt_korrektur (haushalt_id, updated_at);
create index if not exists kochbuch_rezepte_stand_idx  on public.kochbuch_rezepte (haushalt_id, updated_at);

create index if not exists mahlzeit_tag_idx on public.mahlzeit (profil_id, datum) where geloescht_am is null;
create index if not exists wasser_tag_idx   on public.wasser (profil_id, datum) where geloescht_am is null;

-- -----------------------------------------------------------------------------
-- 6. Trigger
-- -----------------------------------------------------------------------------
drop trigger if exists trg_kochbuch_rezepte_updated_at on public.kochbuch_rezepte;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profil', 'mahlzeit', 'wasser', 'tagesziel', 'listen_eintrag',
    'einkauf', 'produkt_korrektur', 'kochbuch_rezepte'
  ] loop
    execute format('drop trigger if exists trg_%1$s_stand on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_stand before insert or update on public.%1$s
       for each row execute function public.stand_fortschreiben()', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Bestand übernehmen
--
-- Es gibt genau einen Nutzer (das gemeinsame Konto) und 20 Rezepte. Beide kommen
-- in einen Bestandshaushalt, damit die laufenden Apps nach dieser Migration
-- unverändert weiterarbeiten — die verschärfte RLS unten greift sonst sofort.
-- -----------------------------------------------------------------------------
do $$
declare
  v_haushalt uuid;
begin
  select id into v_haushalt from public.haushalt order by created_at limit 1;

  if v_haushalt is null then
    insert into public.haushalt (name, einladungscode, einladung_gueltig_bis)
    values ('Haushalt', public.neuer_einladungscode(), now() + interval '7 days')
    returning id into v_haushalt;
  end if;

  insert into public.haushalt_mitglied (haushalt_id, user_id, rolle)
  select v_haushalt, u.id, 'besitzer' from auth.users u
  on conflict do nothing;

  update public.kochbuch_rezepte set haushalt_id = v_haushalt where haushalt_id is null;
end;
$$;

alter table public.kochbuch_rezepte alter column haushalt_id set not null;

-- -----------------------------------------------------------------------------
-- 8. RLS
--
-- Ein Muster für alle: sichtbar und änderbar ist, was zu einem meiner Haushalte
-- gehört. Das (select ...) um den Funktionsaufruf ist Absicht — Postgres wertet
-- ihn dadurch einmal je Anweisung aus statt einmal je Zeile.
-- -----------------------------------------------------------------------------
alter table public.haushalt           enable row level security;
alter table public.haushalt_mitglied  enable row level security;
alter table public.profil             enable row level security;
alter table public.mahlzeit           enable row level security;
alter table public.wasser             enable row level security;
alter table public.tagesziel          enable row level security;
alter table public.listen_eintrag     enable row level security;
alter table public.einkauf            enable row level security;
alter table public.produkt_korrektur  enable row level security;

drop policy if exists haushalt_sichtbar on public.haushalt;
create policy haushalt_sichtbar on public.haushalt
  for select to authenticated
  using (id in (select public.meine_haushalte()));

drop policy if exists haushalt_aendern on public.haushalt;
create policy haushalt_aendern on public.haushalt
  for update to authenticated
  using (id in (select public.meine_haushalte()))
  with check (id in (select public.meine_haushalte()));

-- Anlegen und Beitreten laufen ausschließlich über die Funktionen oben, deshalb
-- bewusst KEINE INSERT-Policy auf haushalt und haushalt_mitglied.
drop policy if exists mitglied_sichtbar on public.haushalt_mitglied;
create policy mitglied_sichtbar on public.haushalt_mitglied
  for select to authenticated
  using (haushalt_id in (select public.meine_haushalte()));

drop policy if exists mitglied_austreten on public.haushalt_mitglied;
create policy mitglied_austreten on public.haushalt_mitglied
  for delete to authenticated
  using (user_id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'profil', 'mahlzeit', 'wasser', 'tagesziel', 'listen_eintrag',
    'einkauf', 'produkt_korrektur'
  ] loop
    execute format('drop policy if exists %1$s_haushalt on public.%1$s', t);
    execute format(
      'create policy %1$s_haushalt on public.%1$s for all to authenticated
       using (haushalt_id in (select public.meine_haushalte()))
       with check (haushalt_id in (select public.meine_haushalte()))', t);
  end loop;
end;
$$;

-- Kochbuch: von "jeder Angemeldete darf alles" auf den Haushalt einschränken.
drop policy if exists kochbuch_alles on public.kochbuch_rezepte;
create policy kochbuch_rezepte_haushalt on public.kochbuch_rezepte
  for all to authenticated
  using (haushalt_id in (select public.meine_haushalte()))
  with check (haushalt_id in (select public.meine_haushalte()));

-- Die Unterlisten hängen am Rezept und brauchen deshalb keine eigene haushalt_id —
-- ihre Berechtigung leitet sich über den Fremdschlüssel ab.
do $$
declare
  t text;
begin
  foreach t in array array[
    'kochbuch_zutaten', 'kochbuch_schritte', 'kochbuch_bilder', 'kochbuch_kommentare'
  ] loop
    execute format('drop policy if exists kochbuch_alles on public.%1$s', t);
    execute format('drop policy if exists %1$s_haushalt on public.%1$s', t);
    execute format(
      'create policy %1$s_haushalt on public.%1$s for all to authenticated
       using (exists (select 1 from public.kochbuch_rezepte r
                      where r.id = %1$s.rezept_id
                        and r.haushalt_id in (select public.meine_haushalte())))
       with check (exists (select 1 from public.kochbuch_rezepte r
                           where r.id = %1$s.rezept_id
                             and r.haushalt_id in (select public.meine_haushalte())))', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Was hier bewusst NICHT passiert
--
--   keto_sync_state bleibt unverändert stehen, samt seiner "jeder Angemeldete darf
--   alles"-Policy. Die ausgelieferte Keto-App synchronisiert noch darüber; ein
--   Wegnehmen jetzt würde sie sofort zerreißen. Die Tabelle verschwindet in der
--   Migration zu B3, sobald beide Geräte auf das Zeilenmodell umgestiegen sind.
--
--   ACHTUNG: solange sie existiert, darf KEIN zweites Konto angelegt werden — mit
--   der offenen Policy läse es den kompletten Haushalts-Zustand mit. Registrierung
--   bleibt bis dahin im Projekt gesperrt.
-- -----------------------------------------------------------------------------
comment on table public.keto_sync_state is
  'VERALTET — Übergangslösung aus der Blob-Zeit. Wird in B3 entfernt. Offene RLS: erst ein zweites Konto zulassen, wenn diese Tabelle weg ist.';
