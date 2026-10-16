import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { googleGeokoder, klicAdresy, sCache, variantyAdresy } from "../src/plan/geokod.js";

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
    // odmítnutý klíč není „nenalezeno“ – musí skončit chybou (a neuložit se do cache)
    const odmitnuto = googleGeokoder("SPATNY", (async () => new Response(JSON.stringify({ status: "REQUEST_DENIED", error_message: "API key not authorized", results: [] }))) as unknown as typeof fetch);
    await expect(odmitnuto.najdi("Moravská 1553/52, Praha")).rejects.toThrow(/REQUEST_DENIED.*GOOGLE_MAPS_API_KEY/);
  });

  it("varianty adresy z MWF: český tvar, bez čísla orientačního, nakonec obec", async () => {
    expect(variantyAdresy("Praha, Moravská 1553/52, 12000").map((v) => v.text)).toEqual([
      "Praha, Moravská 1553/52, 12000",
      "Moravská 1553/52, 120 00 Praha",
      "Moravská 1553, Praha",
      "120 00 Praha",
    ]);
    expect(variantyAdresy("Příbram").map((v) => v.text)).toEqual(["Příbram"]);
    const dotazy: string[] = [];
    const g = googleGeokoder("K", (async (url: URL) => {
      const a = url.searchParams.get("address")!;
      dotazy.push(a);
      return new Response(JSON.stringify(a.startsWith("Moravská 1553/52")
        ? { status: "OK", results: [{ geometry: { location: { lat: 50.07, lng: 14.44 }, location_type: "ROOFTOP" } }] }
        : { status: "ZERO_RESULTS", results: [] }));
    }) as unknown as typeof fetch);
    expect((await g.najdi("Praha, Moravská 1553/52, 12000")).presnost).toBe("adresa");
    expect(dotazy).toHaveLength(2);
  });

  it("cache: staré „nenalezeno“ (před opravou) se zkusí znovu, čerstvé ne", async () => {
    const pg = new PGlite();
    await pg.exec(readFileSync("db/schema.sql", "utf8"));
    await pg.query("INSERT INTO geokod (adresa, lat, lon, presnost, zdroj) VALUES ('moravská 1553/52, praha', NULL, NULL, 'nenalezeno', 'google')");
    let n = 0;
    const g = sCache({ query: (s, p) => pg.query(s, p) as never }, { najdi: async (a) => (n++, a.includes("Moravská") ? { bod: { lat: 50.07, lon: 14.44 }, presnost: "adresa", zdroj: "google" } : { bod: null, presnost: "nenalezeno", zdroj: "google" }) });
    expect((await g.najdi("Moravská 1553/52, Praha")).bod).toEqual({ lat: 50.07, lon: 14.44 });
    await g.najdi("Neexistující 1");
    expect((await g.najdi("Neexistující 1")).presnost).toBe("nenalezeno");
    expect(n).toBe(2);
  }, 60_000);

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
