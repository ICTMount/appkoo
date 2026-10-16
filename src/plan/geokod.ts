// Převod adresy zakázky na souřadnice. Každá adresa se geokóduje jen jednou (tabulka geokod).
// Výchozí služba: Google Geocoding API (ve stejném GCP projektu, klíč v Secret Manageru).
// Rozhraní dovoluje dosadit jinou službu (např. mapy.com) beze změny zbytku aplikace.

import type { Dotaz } from "../db/db.js";
import type { Bod } from "./geo.js";

export type Presnost = "adresa" | "ulice" | "obec" | "nenalezeno";

export interface VysledekGeokodu {
  bod: Bod | null;
  presnost: Presnost;
  zdroj: string;
}

export interface Geokoder {
  najdi(adresa: string): Promise<VysledekGeokodu>;
}

/** Klíč do cache: adresa + PSČ bez rozdílů v mezerách a velikosti písmen */
export function klicAdresy(adresa: string, psc?: string | null): string {
  return `${adresa}${psc ? `, ${psc}` : ""}`.replace(/\s+/g, " ").trim().toLowerCase();
}

const PRESNOST_GOOGLE: Record<string, Presnost> = {
  ROOFTOP: "adresa",
  RANGE_INTERPOLATED: "adresa",
  GEOMETRIC_CENTER: "ulice",
  APPROXIMATE: "obec",
};

/**
 * Varianty zápisu adresy pro geokódování. MWF píše „Praha, Moravská 1553/52“ + PSČ „12000“ – Google to
 * občas nenajde; zkusí se běžný český tvar „Moravská 1553/52, 120 00 Praha“, pak bez čísla orientačního
 * a nakonec jen obec (přesnost „obec“).
 */
export function variantyAdresy(adresa: string): { text: string; jenObec?: boolean }[] {
  const a = adresa.replace(/\s+/g, " ").trim();
  const casti = a.split(",").map((x) => x.trim()).filter(Boolean);
  const pscMatch = a.match(/\b(\d{3})\s?(\d{2})\b(?!\/)/);
  const psc = pscMatch ? `${pscMatch[1]} ${pscMatch[2]}` : "";
  const bezPsc = casti.filter((c) => !/^\d{3}\s?\d{2}$/.test(c));
  // obec: část bez čísel, nebo „Praha 9“, jinak první část (MWF píše „Obec, Ulice č.“); ulice: jiná část s číslem
  const obec = bezPsc.length > 1 ? (bezPsc.find((c) => !/\d/.test(c)) ?? bezPsc.find((c) => /^praha\s*\d+$/i.test(c)) ?? bezPsc[0]!) : "";
  const sCislem = bezPsc.find((c) => c !== obec && /\d/.test(c) && /\p{L}/u.test(c));
  const v: { text: string; jenObec?: boolean }[] = [{ text: a }];
  if (sCislem && obec) {
    v.push({ text: `${sCislem}, ${[psc, obec].filter(Boolean).join(" ")}` });
    const bezOrient = sCislem.replace(/(\d+)\/\d+\w*/, "$1");
    if (bezOrient !== sCislem) v.push({ text: `${bezOrient}, ${obec}` });
  }
  if (obec) v.push({ text: [psc, obec].filter(Boolean).join(" "), jenObec: true });
  return v.filter((x, i) => v.findIndex((y) => y.text === x.text) === i);
}

export function googleGeokoder(apiKey = process.env.GOOGLE_MAPS_API_KEY ?? "", fetchFn: typeof fetch = fetch): Geokoder {
  const dotaz = async (adresa: string): Promise<VysledekGeokodu> => {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.search = new URLSearchParams({ address: adresa, region: "cz", language: "cs", components: "country:CZ", key: apiKey }).toString();
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`Geokódování selhalo: HTTP ${res.status}`);
    const data = (await res.json()) as {
      status: string;
      error_message?: string;
      results?: { geometry: { location: { lat: number; lng: number }; location_type: string } }[];
    };
    // nejdřív stav: REQUEST_DENIED / OVER_QUERY_LIMIT nejsou „adresa neexistuje“ – nesmí se uložit jako nenalezeno
    if (data.status === "ZERO_RESULTS") return { bod: null, presnost: "nenalezeno", zdroj: "google" };
    if (data.status !== "OK") {
      const proc = data.status === "REQUEST_DENIED" ? " – zkontrolujte klíč GOOGLE_MAPS_API_KEY (Geocoding API povolené v omezení klíče, bez omezení na web)" : "";
      throw new Error(`Geokódování selhalo: ${data.status}${data.error_message ? ` (${data.error_message.slice(0, 160)})` : ""}${proc}`);
    }
    const r = data.results?.[0];
    if (!r) return { bod: null, presnost: "nenalezeno", zdroj: "google" };
    return {
      bod: { lat: r.geometry.location.lat, lon: r.geometry.location.lng },
      presnost: PRESNOST_GOOGLE[r.geometry.location_type] ?? "obec",
      zdroj: "google",
    };
  };
  return {
    async najdi(adresa) {
      for (const v of variantyAdresy(adresa)) {
        const r = await dotaz(v.text);
        if (r.bod) return v.jenObec ? { ...r, presnost: "obec" } : r;
      }
      return { bod: null, presnost: "nenalezeno", zdroj: "google" };
    },
  };
}

/** Geokodér s cache v databázi – službu volá jen pro adresy, které ještě nezná */
export function sCache(db: Dotaz, sluzba: Geokoder): Geokoder {
  return {
    async najdi(adresa) {
      const klic = klicAdresy(adresa);
      // „nenalezeno“ platí jen 24 h a jen od opravené verze (:2) – dřívější chyby klíče se uložily jako nenalezeno
      const { rows } = await db.query<{ lat: number | null; lon: number | null; presnost: Presnost; zdroj: string; cerstve: boolean }>(
        "SELECT lat, lon, presnost, zdroj, vytvoreno > now() - interval '24 hours' AS cerstve FROM geokod WHERE adresa = $1",
        [klic],
      );
      const r = rows[0];
      if (r && r.lat !== null && r.lon !== null) return { bod: { lat: r.lat, lon: r.lon }, presnost: r.presnost, zdroj: r.zdroj };
      if (r && r.cerstve && r.zdroj.endsWith(":2")) return { bod: null, presnost: r.presnost, zdroj: r.zdroj.slice(0, -2) };
      const v = await sluzba.najdi(adresa);
      await db.query(
        `INSERT INTO geokod (adresa, lat, lon, presnost, zdroj) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (adresa) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, presnost = EXCLUDED.presnost, zdroj = EXCLUDED.zdroj, vytvoreno = now()`,
        [klic, v.bod?.lat ?? null, v.bod?.lon ?? null, v.presnost, v.bod ? v.zdroj : `${v.zdroj}:2`],
      );
      return v;
    },
  };
}
