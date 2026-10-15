import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { googleGeokoder, klicAdresy, sCache } from "../src/plan/geokod.js";

describe("geokódování", () => {
  it("Google: přesnost podle typu výsledku, nenalezeno bez chyby", async () => {
    const volani: string[] = [];
    const fakeFetch = (async (url: URL) => {
      volani.push(url.toString());
      const nic = url.searchParams.get("address")!.includes("Neexistující");
      return new Response(JSON.stringify(nic ? { status: "ZERO_RESULTS", results: [] } : {
        status: "OK", results: [{ geometry: { location: { lat: 50.03, lng: 14.45 }, location_type: "ROOFTOP" } }],
      }));
    }) as unknown as typeof fetch;
    const g = googleGeokoder("KLIC", fakeFetch);
    expect(await g.najdi("Na Strži 1702/65, Praha")).toEqual({ bod: { lat: 50.03, lon: 14.45 }, presnost: "adresa", zdroj: "google" });
    expect((await g.najdi("Neexistující 1")).presnost).toBe("nenalezeno");
    expect(volani[0]).toContain("components=country%3ACZ");
  });

  it("cache: stejná adresa podruhé bez volání služby", async () => {
    const pg = new PGlite();
    await pg.exec(readFileSync("db/schema.sql", "utf8"));
    let n = 0;
    const g = sCache({ query: (s, p) => pg.query(s, p) as never }, { najdi: async () => (n++, { bod: { lat: 1, lon: 2 }, presnost: "adresa", zdroj: "test" }) });
    await g.najdi("Švermova 1381/22, Beroun");
    expect(await g.najdi("švermova  1381/22,  Beroun")).toEqual({ bod: { lat: 1, lon: 2 }, presnost: "adresa", zdroj: "test" });
    expect(n).toBe(1);
    expect(klicAdresy("Na Drážce 1561, Pardubice", "530 03")).toBe("na drážce 1561, pardubice, 530 03");
  }, 60_000);
});
