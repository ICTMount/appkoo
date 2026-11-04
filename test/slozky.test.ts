import { describe, expect, it } from "vitest";
import { isoTyden, nazevTydne, zalozSlozkuZakazky } from "../src/google/slozky.js";

describe("složka zakázky na Disku", () => {
  it("ISO týden jako složky 2026_45", () => {
    expect(isoTyden(new Date(Date.UTC(2026, 10, 4)))).toEqual({ rok: 2026, tyden: 45 }); // st 4. 11. 2026
    expect(isoTyden(new Date(Date.UTC(2026, 0, 1)))).toEqual({ rok: 2026, tyden: 1 }); // čt 1. 1. 2026
    expect(isoTyden(new Date(Date.UTC(2027, 0, 1)))).toEqual({ rok: 2026, tyden: 53 }); // pá 1. 1. 2027 patří do 2026_53
    expect(nazevTydne(2026, 5)).toBe("2026_05");
    // pondělí 9. 11. 2026 0:30 Praha = neděle 23:30 UTC → patří už do týdne 46
    expect(isoTyden(new Date("2026-11-08T23:30:00Z"))).toEqual({ rok: 2026, tyden: 46 });
  });

  it("dohledá existující rok a týden, chybějící APPKOO a O-… založí; podruhé nic nového", async () => {
    const slozky: { id: string; name: string; parent: string }[] = [
      { id: "rok", name: "2026", parent: "KOREN" },
      { id: "tyd", name: "2026_45", parent: "rok" },
    ];
    let n = 0;
    const drive = {
      files: {
        list: async (p: { q: string }) => {
          const parent = p.q.match(/'([^']+)' in parents/)![1];
          const name = p.q.match(/name = '([^']+)'/)![1];
          return { data: { files: slozky.filter((s) => s.parent === parent && s.name === name).map((s) => ({ id: s.id, name: s.name })) } };
        },
        create: async (p: { requestBody: { name: string; parents: string[] } }) => {
          const id = `nova${++n}`;
          slozky.push({ id, name: p.requestBody.name, parent: p.requestBody.parents[0]! });
          return { data: { id } };
        },
      },
    } as never;
    const s = await zalozSlozkuZakazky(drive, "KOREN", "O-8555864483", new Date(Date.UTC(2026, 10, 4, 10)));
    expect(s.cesta).toBe("2026 / 2026_45 / APPKOO / O-8555864483");
    expect(s.novaSlozka).toBe(true);
    expect(n).toBe(2); // APPKOO + O-…
    const znovu = await zalozSlozkuZakazky(drive, "KOREN", "O-8555864483", new Date(Date.UTC(2026, 10, 5)));
    expect(znovu.slozkaId).toBe(s.slozkaId);
    expect(n).toBe(2);
  });
});
