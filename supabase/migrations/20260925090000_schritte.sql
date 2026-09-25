-- =============================================================================
-- Schritte je Profil und Tag
--
-- Zweck ist der Vergleich im Haushalt: zwei Menschen, dieselbe Tabelle, und auf der
-- Startseite steht nebeneinander, wer heute wie weit gelaufen ist.
--
-- Die Zahl kommt von Hand. Eine Website kann keinen Schrittzähler lesen — dafür gibt es
-- keine Web-Schnittstelle, und eine PWA läuft nicht im Hintergrund, kann also auch nichts
-- selbst mitzählen. Health Connect ist ausdrücklich gerätezentriert und nur über das
-- Android-SDK erreichbar; die Google-Fit-REST-Schnittstelle, die ein Server hätte abfragen
-- können, wird laut Android-Dokumentation nur bis Ende 2026 unterstützt. Diese Tabelle ist
-- deshalb bewusst so gebaut, dass später eine Automatisierung auf dem Handy an dieselbe
-- Stelle schreiben kann, ohne dass sich an der App etwas ändert.
--
-- Schlüssel ist (profil_id, datum) wie beim Gewicht: "die Schritte von Profil X am 25.9."
-- entstehen auf beiden Geräten unabhängig. Mit je einer zufälligen id stünden am Ende zwei
-- Zeilen für denselben Tag da.
-- =============================================================================

create table if not exists public.schritte (
  haushalt_id   uuid not null references public.haushalt(id) on delete cascade,
  profil_id     uuid not null references public.profil(id) on delete cascade,
  datum         date not null,
  anzahl        integer not null check (anzahl >= 0 and anzahl < 500000),
  erfasst_am    timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  geloescht_am  timestamptz,
  primary key (profil_id, datum)
);

comment on table public.schritte is
  'Ein Wert je Profil und Tag. (profil_id, datum) ist bewusst der Primärschlüssel — siehe Migration 20260925090000.';

-- Der Abgleich holt je Datenart alles, was seit seinem Zeiger neuer ist.
create index if not exists schritte_stand_idx on public.schritte (haushalt_id, updated_at);

-- `updated_at`/`geaendert_am` fortschreiben wie bei jeder anderen abgeglichenen Tabelle.
drop trigger if exists trg_schritte_stand on public.schritte;
create trigger trg_schritte_stand before insert or update on public.schritte
  for each row execute function public.stand_fortschreiben();

alter table public.schritte enable row level security;

drop policy if exists schritte_haushalt on public.schritte;
create policy schritte_haushalt on public.schritte for all to authenticated
  using (haushalt_id in (select private.meine_haushalte()))
  with check (haushalt_id in (select private.meine_haushalte()));
