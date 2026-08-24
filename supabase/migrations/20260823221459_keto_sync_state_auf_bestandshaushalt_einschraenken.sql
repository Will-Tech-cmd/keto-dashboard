-- =============================================================================
-- keto_sync_state: offene RLS schließen
--
-- Die Tabelle ist der letzte Rest aus der Blob-Zeit und trägt den kompletten
-- Zustand des Haushalts in EINER Zeile. Ihre Policy war "jeder Angemeldete darf
-- alles" — mit dem gemeinsamen Konto als einzigem Nutzer folgenlos, ab dem zweiten
-- Konto ein Datenleck. Nachgewiesen mit einer simulierten Anmeldung: ein fremdes
-- Konto sah 0 Rezepte, 0 Haushalte — aber 1 Zeile keto_sync_state, und darin steht
-- alles.
--
-- Die Einschränkung läuft über die Mitgliedschaft im Bestandshaushalt statt über
-- eine haushalt_id-Spalte auf der Tabelle: die ausgelieferte Keto-App schickt beim
-- Upsert nur id/daten/geaendert_von. Eine neue NOT-NULL-Spalte würde ihren
-- Schreibvorgang an der WITH-CHECK-Prüfung abweisen, und der Abgleich stünde.
--
-- Fällt zusammen mit der Tabelle in B3 weg.
-- =============================================================================
do $blk$
declare
  v_haushalt uuid;
begin
  select id into v_haushalt from public.haushalt order by created_at limit 1;
  if v_haushalt is null then
    raise exception 'Kein Bestandshaushalt gefunden — Migration haushalt_und_zeilenmodell zuerst anwenden.';
  end if;

  execute 'drop policy if exists keto_sync_alles on public.keto_sync_state';
  execute 'drop policy if exists keto_sync_bestandshaushalt on public.keto_sync_state';
  execute format(
    'create policy keto_sync_bestandshaushalt on public.keto_sync_state
     for all to authenticated
     using (%L::uuid in (select public.meine_haushalte()))
     with check (%L::uuid in (select public.meine_haushalte()))',
    v_haushalt, v_haushalt);
end;
$blk$;

-- Hinweis: die nachfolgende Migration rls_haerten_private_schema hängt diese Policy
-- auf private.meine_haushalte() um.
