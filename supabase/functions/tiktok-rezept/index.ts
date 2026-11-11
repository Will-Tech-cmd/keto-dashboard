// tiktok-rezept — holt zu einem TikTok-Link die Videobeschreibung (Zutaten, Zubereitung).
//
// Warum ein Server-Stück: der Browser darf tiktok.com nicht abrufen (CORS), und die
// oEmbed-Schnittstelle liefert inzwischen nur noch das Einbett-HTML — Titel/Beschreibung
// stehen dort nicht mehr (geprüft 11/2026). Die Beschreibung steht aber in der Videoseite
// selbst, im eingebetteten JSON `__UNIVERSAL_DATA_FOR_REHYDRATION__`, sofern man mit einem
// Browser-User-Agent fragt. Genau das tut diese Funktion und gibt nur den Text zurück —
// kein Video, kein Download.
//
// Aufruf aus der App (tiktok-import.js): POST { url } mit der Supabase-Sitzung des
// Haushalts (verify_jwt an). Antwort: { text, autor, url } oder { fehler }.
//
// Deploy: über das Supabase-Dashboard oder `supabase functions deploy tiktok-rezept`.
// Risiko: TikTok kann die Seite jederzeit umbauen oder Rechenzentrums-Adressen mit einem
// Captcha abspeisen — dann kommt { fehler } zurück und die App bietet an, den Text von
// Hand einzufügen.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ERLAUBTE_HOSTS = new Set(["www.tiktok.com", "tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function antwort(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Nur TikTok-Links, nur https — sonst wäre das ein offener Abruf-Dienst für beliebige Seiten. */
function pruefeLink(roh: unknown): URL | null {
  if (typeof roh !== "string") return null;
  let u: URL;
  try { u = new URL(roh.trim()); } catch { return null; }
  if (u.protocol !== "https:" || !ERLAUBTE_HOSTS.has(u.hostname)) return null;
  return u;
}

/** Beschreibung + Autor aus dem Seiten-JSON; null, wenn TikTok etwas anderes geschickt hat. */
export function beschreibungAus(html: string): { text: string; autor: string } | null {
  const m = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    const daten = JSON.parse(m[1]);
    const item = daten?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
    const text = typeof item?.desc === "string" ? item.desc.trim() : "";
    if (!text) return null;
    const autor = item?.author?.nickname || item?.author?.uniqueId || "";
    return { text, autor: String(autor) };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort({ fehler: "Nur POST." }, 405);

  let body: { url?: unknown } = {};
  try { body = await req.json(); } catch { /* leer */ }
  const link = pruefeLink(body.url);
  if (!link) return antwort({ fehler: "Das ist kein TikTok-Link." }, 400);

  let res: Response;
  try {
    res = await fetch(link.toString(), {
      redirect: "follow",
      headers: {
        // Ohne Browser-Kennung liefert TikTok eine leere Hülle ohne das Seiten-JSON.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
      },
    });
  } catch {
    return antwort({ fehler: "TikTok antwortet nicht." }, 502);
  }
  if (!res.ok) return antwort({ fehler: `TikTok antwortet mit ${res.status}.` }, 502);

  const html = await res.text();
  const gefunden = beschreibungAus(html);
  if (!gefunden) return antwort({ fehler: "Keine Beschreibung im Video gefunden — Text von Hand einfügen." }, 404);

  return antwort({ text: gefunden.text, autor: gefunden.autor, url: res.url || link.toString() });
});
