-- =============================================================================
-- Rücknahme zu 20260825120000_mahlzeit_geplant.sql
--
-- Kein Teil des normalen Migrationslaufs. Gefahrlos, solange kein Plan
-- übernommen wurde: dann steht überall false und die Spalte trägt keine
-- Information. Danach gingen mit ihr die noch unbestätigten Pläne verloren —
-- die Zeilen bleiben, gälten aber alle als gegessen.
-- =============================================================================

alter table public.mahlzeit drop column if exists geplant;
