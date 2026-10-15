// Vzdálenosti a doby jízdy. Výchozí odhad: vzdušná čara × silniční koeficient a průměrná rychlost
// (stejně jako dashboard 55 km/h + 5 min na zaparkování). Přesnější matice (Google Routes, OSRM)
// jde dosadit přes rozhraní Vzdalenosti beze změny optimalizace.

export interface Bod {
  lat: number;
  lon: number;
}

export interface Vzdalenosti {
  km(a: Bod, b: Bod): number;
  /** doba jízdy v minutách */
  minuty(a: Bod, b: Bod): number;
}

export function vzdusnaKm(a: Bod, b: Bod): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface NastaveniOdhadu {
  /** poměr silniční a vzdušné vzdálenosti */
  koeficient: number;
  rychlostKmH: number;
  /** minuty navíc na každý přejezd (parkování, cesta k domu) */
  rezervaMin: number;
}

export const ODHAD: NastaveniOdhadu = { koeficient: 1.3, rychlostKmH: 55, rezervaMin: 5 };

export function odhadVzdalenosti(n: Partial<NastaveniOdhadu> = {}): Vzdalenosti {
  const o = { ...ODHAD, ...n };
  return {
    km: (a, b) => vzdusnaKm(a, b) * o.koeficient,
    minuty: (a, b) => {
      const km = vzdusnaKm(a, b) * o.koeficient;
      return km < 0.05 ? 0 : (km / o.rychlostKmH) * 60 + o.rezervaMin;
    },
  };
}
