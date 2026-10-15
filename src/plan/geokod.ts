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

export function googleGeokoder(apiKey = process.env.GOOGLE_MAPS_API_KEY ?? "", fetchFn: typeof fetch = fetch): Geokoder {
  return {
    async najdi(adresa) {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.search = new URLSearchParams({ address: adresa, region: "cz", language: "cs", components: "country:CZ", key: apiKey }).toString();
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`Geokódování selhalo: HTTP ${res.status}`);
      const data = (await res.json()) as { status: string; results: { geometry: { location: { lat: number; lng: number }; location_type: string } }[] };
      const r = data.results[0];
      if (data.status === "ZERO_RESULTS" || !r) return { bod: null, presnost: "nenalezeno", zdroj: "google" };
      if (data.status !== "OK") throw new Error(`Geokódování selhalo: ${data.status}`);
      return {
        bod: { lat: r.geometry.location.lat, lon: r.geometry.location.lng },
        presnost: PRESNOST_GOOGLE[r.geometry.location_type] ?? "obec",
        zdroj: "google",
      };
    },
  };
}

/** Geokodér s cache v databázi – službu volá jen pro adresy, které ještě nezná */
export function sCache(db: Dotaz, sluzba: Geokoder): Geokoder {
  return {
    async najdi(adresa) {
      const klic = klicAdresy(adresa);
      const { rows } = await db.query<{ lat: number | null; lon: number | null; presnost: Presnost; zdroj: string }>(
        "SELECT lat, lon, presnost, zdroj FROM geokod WHERE adresa = $1",
        [klic],
      );
      const r = rows[0];
      if (r) return { bod: r.lat === null || r.lon === null ? null : { lat: r.lat, lon: r.lon }, presnost: r.presnost, zdroj: r.zdroj };
      const v = await sluzba.najdi(adresa);
      await db.query(
        "INSERT INTO geokod (adresa, lat, lon, presnost, zdroj) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (adresa) DO NOTHING",
        [klic, v.bod?.lat ?? null, v.bod?.lon ?? null, v.presnost, v.zdroj],
      );
      return v;
    },
  };
}
