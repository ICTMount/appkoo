// Vzdálenost chůzí mezi dvěma místy (záfuk: ZB → adresa instalace) – Google Routes API, režim WALK.
// Když Routes API není dostupné (nepovolené na klíči, chyba sítě), vrátí se odhad vzdušnou čarou × 1,3
// se zřetelným označením, aby koordinátorka věděla, že nejde o trasu.

import type { Geokoder } from "./geokod.js";
import { vzdusnaKm, type Bod } from "./geo.js";

export interface VzdalenostChuzi {
  metry: number;
  /** chuze = trasa pro pěší z Routes API; odhad = vzdušná čára × 1,3 */
  zpusob: "chuze" | "odhad";
  /** proč jen odhad (text chyby Routes API) */
  poznamka?: string;
}

export type Chuze = (zb: string, adresa: string) => Promise<VzdalenostChuzi | null>;

/** „50.0755, 14.4378“ / „50.0755N 14.4378E“ → souřadnice; jinak null (bere se jako adresa) */
export function gpsZTextu(s: string): Bod | null {
  const m = /^\s*(-?\d{1,2}[.,]\d{3,})\s*°?\s*[NS]?\s*[,; ]\s*(-?\d{1,3}[.,]\d{3,})\s*°?\s*[EW]?\s*$/i.exec(s);
  if (!m) return null;
  const lat = Number(m[1]!.replace(",", ".")), lon = Number(m[2]!.replace(",", "."));
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

const misto = (s: string) => {
  const g = gpsZTextu(s);
  return g ? { location: { latLng: { latitude: g.lat, longitude: g.lon } } } : { address: /česk|czech/i.test(s) ? s : `${s}, Česko` };
};

export function googleChuze(geokoder: Geokoder | null, apiKey = process.env.GOOGLE_MAPS_API_KEY ?? "", fetchFn: typeof fetch = fetch): Chuze {
  return async (zb, adresa) => {
    let duvod = "";
    try {
      const res = await fetchFn("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "routes.distanceMeters" },
        body: JSON.stringify({ origin: misto(zb), destination: misto(adresa), travelMode: "WALK", languageCode: "cs", regionCode: "cz" }),
      });
      const data = (await res.json().catch(() => ({}))) as { routes?: { distanceMeters?: number }[]; error?: { message?: string; status?: string } };
      const m = data.routes?.[0]?.distanceMeters;
      if (res.ok && typeof m === "number") return { metry: Math.round(m), zpusob: "chuze" };
      // trasa o nulové délce přijde bez distanceMeters (ZB na stejné adrese)
      if (res.ok && data.routes?.length) return { metry: 0, zpusob: "chuze" };
      duvod = res.ok ? "trasa pro pěší nenalezena" : `Routes API: ${data.error?.status ?? `HTTP ${res.status}`}${data.error?.message ? ` – ${data.error.message.slice(0, 140)}` : ""}`;
    } catch (e) {
      duvod = `Routes API: ${e instanceof Error ? e.message : String(e)}`;
    }
    // záloha: vzdušná čára × 1,3
    if (!geokoder) return null;
    const a = gpsZTextu(zb) ?? (await geokoder.najdi(zb).catch(() => null))?.bod ?? null;
    const b = gpsZTextu(adresa) ?? (await geokoder.najdi(adresa).catch(() => null))?.bod ?? null;
    if (!a || !b) return null;
    return { metry: Math.round(vzdusnaKm(a, b) * 1300), zpusob: "odhad", poznamka: duvod };
  };
}
