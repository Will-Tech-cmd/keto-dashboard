-- Rücknahme zu 20260925090000_schritte.sql
drop policy if exists schritte_haushalt on public.schritte;
drop trigger if exists trg_schritte_stand on public.schritte;
drop index if exists public.schritte_stand_idx;
drop table if exists public.schritte;
