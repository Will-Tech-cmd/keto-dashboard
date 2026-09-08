-- =============================================================================
-- Rücknahme zu 20260908120000_gewicht.sql
--
-- Kein Teil des normalen Migrationslaufs. Nimmt die Tabelle samt Inhalt mit: jedes
-- eingetragene Gewicht wäre danach weg, und zwar auf allen Geräten, sobald sie das
-- nächste Mal abgleichen. Vorher exportieren.
-- =============================================================================

drop policy if exists gewicht_haushalt on public.gewicht;
drop trigger if exists trg_gewicht_stand on public.gewicht;
drop table if exists public.gewicht;
