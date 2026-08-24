-- =============================================================================
-- Natürliche Schlüssel für den Abgleich
--
-- Der Abgleich schreibt mit „upsert": eine Zeile anlegen, und falls es sie schon gibt,
-- die vorhandene aktualisieren. Dafür braucht Postgres einen eindeutigen Schlüssel, an
-- dem es „schon da" festmacht — und der muss auf BEIDEN Geräten derselbe sein.
--
-- Bei mahlzeit, wasser und einkauf ist das die id: die App würfelt eine UUID, zwei
-- Geräte erzeugen nie dieselbe, jede Zeile hat genau einen Ursprung.
--
-- Bei tagesziel, listen_eintrag und produkt_korrektur ist es anders. „Das Tagesziel von
-- Profil X am 24.08." und „der Favorit mit Barcode Y" entstehen auf beiden Geräten
-- unabhängig voneinander — mit zwei verschiedenen zufälligen ids für dieselbe Sache.
-- Der zweite Upsert wäre am Unique-Index gescheitert statt zu aktualisieren.
--
-- Deshalb: der fachliche Schlüssel WIRD der Schlüssel. Die drei Tabellen waren noch
-- leer, der Umbau hat keine Daten gekostet.
-- =============================================================================

-- --- tagesziel: (profil_id, datum) statt einer eigenen id ---------------------
alter table public.tagesziel drop constraint if exists tagesziel_profil_id_datum_key;
alter table public.tagesziel drop constraint if exists tagesziel_pkey;
alter table public.tagesziel drop column if exists id;
alter table public.tagesziel add primary key (profil_id, datum);

-- --- listen_eintrag und produkt_korrektur: (haushalt_id, barcode) --------------
--
-- Der Index war bisher partiell („nur solange nicht gelöscht"). Als Ziel eines Upserts
-- taugt er nicht: Postgres zieht einen partiellen Index nur heran, wenn die Anweisung
-- dieselbe Bedingung mitschickt, und das tut PostgREST nicht.
--
-- Voller Index heißt: eine gelöschte Zeile behält ihren Barcode. Das ist das ehrlichere
-- Modell — ein wieder aufgenommener Favorit ist derselbe Eintrag, der zurückkommt
-- (geloescht_am wird geleert), keine zweite Zeile mit derselben Bedeutung.
drop index if exists public.listen_eintrag_barcode_uniq;
drop index if exists public.produkt_korrektur_barcode_uniq;

alter table public.listen_eintrag
  add constraint listen_eintrag_haushalt_barcode_key unique (haushalt_id, barcode);
alter table public.produkt_korrektur
  add constraint produkt_korrektur_haushalt_barcode_key unique (haushalt_id, barcode);

comment on constraint listen_eintrag_haushalt_barcode_key on public.listen_eintrag is
  'Zielspalten des Upserts beim Abgleich. Bewusst nicht partiell — siehe diese Migration.';
comment on constraint produkt_korrektur_haushalt_barcode_key on public.produkt_korrektur is
  'Zielspalten des Upserts beim Abgleich. Bewusst nicht partiell — siehe diese Migration.';
