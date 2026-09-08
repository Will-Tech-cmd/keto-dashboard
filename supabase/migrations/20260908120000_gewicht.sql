-- =============================================================================
-- Gewicht je Profil und Tag
--
-- Die App rechnet seit jeher mit einem Defizit (`profil.ziel = lose`, `defizit_pct`)
-- und friert die Zielwerte jedes Tages ein. Was fehlte, war die Gegenprobe: wirkt das
-- Defizit überhaupt? `profil.gewicht_kg` ist ein einzelner, ständig überschriebener
-- Wert — aus ihm lässt sich kein Verlauf lesen.
--
-- Schlüssel ist (profil_id, datum), nicht eine eigene id. Genau wie bei tagesziel
-- entsteht „das Gewicht von Profil X am 8.9." auf beiden Geräten unabhängig; mit je
-- einer zufälligen id stünden am Ende zwei Zeilen für einen Morgen da, und der Upsert
-- des zweiten Geräts wäre nicht am Konflikt hängengeblieben, sondern hätte
-- danebengeschrieben. Zweimal am selben Tag gewogen heißt: der zweite Wert ersetzt
-- den ersten.
--
-- `koerperfett_pct` ist optional und bleibt null, wenn niemand misst — eine 0 sähe
-- aus wie eine Messung. Die App füttert damit Katch-McArdle, wenn ein Wert da ist.
-- =============================================================================

create table if not exists public.gewicht (
  haushalt_id      uuid not null references public.haushalt(id) on delete cascade,
  profil_id        uuid not null references public.profil(id) on delete cascade,
  datum            date not null,
  kg               numeric not null check (kg > 0 and kg < 500),
  koerperfett_pct  numeric check (koerperfett_pct is null or (koerperfett_pct > 0 and koerperfett_pct < 70)),
  erfasst_am       timestamptz not null default now(),
  geaendert_am     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  geloescht_am     timestamptz,
  primary key (profil_id, datum)
);

comment on table public.gewicht is
  'Ein Wert je Profil und Tag. (profil_id, datum) ist bewusst der Primärschlüssel — siehe Migration 20260908120000.';

-- Der Abgleich holt je Datenart alles, was seit seinem Zeiger neuer ist.
create index if not exists gewicht_stand_idx on public.gewicht (haushalt_id, updated_at);

-- `updated_at`/`geaendert_am` fortschreiben wie bei jeder anderen abgeglichenen Tabelle.
drop trigger if exists trg_gewicht_stand on public.gewicht;
create trigger trg_gewicht_stand before insert or update on public.gewicht
  for each row execute function public.stand_fortschreiben();

alter table public.gewicht enable row level security;

drop policy if exists gewicht_haushalt on public.gewicht;
create policy gewicht_haushalt on public.gewicht for all to authenticated
  using (haushalt_id in (select private.meine_haushalte()))
  with check (haushalt_id in (select private.meine_haushalte()));
