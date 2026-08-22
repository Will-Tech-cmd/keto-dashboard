// config.js — Verbindungsdaten des Supabase-Projekts. Der "anon key" ist bewusst öffentlich
// (so von Supabase vorgesehen): er darf nichts, was RLS nicht erlaubt. Ohne Anmeldung lässt
// sich damit keine Zeile lesen oder schreiben — siehe die Policies aus der Migration
// "kochbuch_init" (nur die Rolle "authenticated" hat Zugriff, Registrierung ist gesperrt).
export const SUPABASE_URL = "https://viedjnpmvnkufoysuxvl.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpZWRqbnBtdm5rdWZveXN1eHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwODg0MTcsImV4cCI6MjEwMjY2NDQxN30.VRZ05x3wIr-6CKgwwSggFnQjpB3bHt5qF0HdcfQh26c";

// Ein gemeinsames Konto für euch beide — siehe README, Abschnitt "Kochbuch".
export const SHARED_ACCOUNT_EMAIL = "kochbuch@keto-dashboard.app";

export const PHOTOS_BUCKET = "kochbuch-fotos";
