import { describe, expect, it } from "vitest";
import { odhadVzdalenosti, vzdusnaKm, type Bod } from "../src/plan/geo.js";
import { kpiPlanu, kpiZakazek, slaKonec } from "../src/plan/kpi.js";
import { nabidniTerminy, navrhniPlan, type DenSOkny } from "../src/plan/sloty.js";
import { nejlepsiPoradi, vyhodnotTrasu, type DenTechnika, type Navsteva } from "../src/plan/trasa.js";
import { local } from "../src/domain/time.js";
import type { Zakazka } from "../src/import/mwfExport.js";

const v = odhadVzdalenosti();
const B: Record<string, Bod> = {
  hloubetin: { lat: 50.105, lon: 14.535 },
  krc: { lat: 50.03, lon: 14.45 },
  strasnice: { lat: 50.07, lon: 14.49 },
  prosek: { lat: 50.12, lon: 14.5 },
  pribram: { lat: 49.69, lon: 14.01 },
  benesov: { lat: 49.78, lon: 14.687 },
  brno: { lat: 49.195, lon: 16.608 },
};
const h = (hh: number, mm = 0) => hh * 60 + mm;
const nv = (id: string, bod: Bod, od = h(8), do_ = h(17), trvani = 90): Navsteva => ({ id, bod, od, do: do_, trvani });
const den = (technik: string, zakladna: Bod, navstevy: Navsteva[], datum = "2026-10-16"): DenTechnika => ({
  technik, datum, zakladna, pracujeOd: h(7, 30), pracujeDo: h(19), navstevy,
});

describe("vzdálenosti", () => {
  it("vzdušná čára Praha–Brno ≈ 185 km", () => {
    expect(vzdusnaKm({ lat: 50.087, lon: 14.421 }, B.brno!)).toBeGreaterThan(180);
    expect(vzdusnaKm({ lat: 50.087, lon: 14.421 }, B.brno!)).toBeLessThan(190);
  });
});

describe("trasa dne technika (TSP s časovými okny)", () => {
  it("bez pevných termínů zvolí kratší pořadí", () => {
    const d = den("Hristov", B.hloubetin!, [nv("Krč", B.krc!), nv("Prosek", B.prosek!), nv("Strašnice", B.strasnice!)]);
    const t = nejlepsiPoradi(d, v)!;
    expect(t.proveditelna).toBe(true);
    // porovnání se všemi 6 pořadími: nalezená trasa je nejkratší
    const perm = (xs: Navsteva[]): Navsteva[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perm([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
    const minimum = Math.min(...perm(d.navstevy).map((p) => vyhodnotTrasu(d, p, v).km));
    expect(t.km).toBeCloseTo(minimum, 6);
  });

  it("dodrží dohodnuté okno i za cenu delší trasy", () => {
    const d = den("Hristov", B.hloubetin!, [nv("Krč", B.krc!, h(8), h(9, 59)), nv("Prosek", B.prosek!, h(14), h(15, 59))]);
    const t = nejlepsiPoradi(d, v)!;
    expect(t.poradi).toEqual(["Krč", "Prosek"]);
    expect(t.zastavky[1]!.zacatek).toBe(h(14));
  });

  it("když okna nejdou stihnout, trasa neexistuje", () => {
    const d = den("Hristov", B.hloubetin!, [nv("Krč", B.krc!, h(10), h(10)), nv("Příbram", B.pribram!, h(11), h(11))]);
    expect(nejlepsiPoradi(d, v)).toBeNull();
  });

  it("hlásí přejezd přes 50 km", () => {
    const t = vyhodnotTrasu(den("Dostál", B.hloubetin!, []), [nv("Příbram", B.pribram!)], v);
    expect(t.dlouhePrejezdy[0]).toMatchObject({ z: "základna", do: "Příbram" });
  });

  it("víc než 8 návštěv řeší heuristika a výsledek je proveditelný", () => {
    const body = Array.from({ length: 10 }, (_, i) => nv(`Z${i}`, { lat: 50.0 + (i % 5) * 0.03, lon: 14.4 + Math.floor(i / 5) * 0.08 }, h(7, 30), h(18), 30));
    const d = den("Vajc", B.hloubetin!, body);
    const t = nejlepsiPoradi(d, v)!;
    expect(t.proveditelna).toBe(true);
    expect(t.km).toBeLessThanOrEqual(vyhodnotTrasu(d, body, v).km);
  });
});

describe("nabídka termínů a návrh plánu", () => {
  const dny = (): DenSOkny[] => [
    { den: den("Hristov", B.hloubetin!, [nv("X1", B.krc!, h(8), h(9, 59))]), volnaOkna: [{ od: h(10), do: h(11, 59) }, { od: h(14), do: h(15, 59) }] },
    { den: den("Lipka", B.pribram!, [nv("X2", B.pribram!, h(8), h(9, 59))]), volnaOkna: [{ od: h(10), do: h(11, 59) }] },
  ];

  it("nabídne nejdřív technika, kterému zakázka leží na trase", () => {
    const m = nabidniTerminy({ id: "N", bod: B.strasnice!, trvani: 90, priorita: "P2", slaKonec: null }, dny(), v, "2026-10-15");
    expect(m[0]).toMatchObject({ technik: "Hristov", okno: { od: h(10) } });
    expect(m.every((x) => x.technik !== "Lipka")).toBe(true); // zajížďka nad 75 km
  });

  it("okno po termínu SLA má horší pořadí", () => {
    const m = nabidniTerminy({ id: "N", bod: B.strasnice!, trvani: 90, priorita: "P2", slaKonec: local(2026, 10, 16, 12, 0) }, dny(), v, "2026-10-15");
    expect(m[0]!.poSla).toBe(false);
    expect(m.find((x) => x.okno.od === h(14))!.poSla).toBe(true);
  });

  it("návrh plánu: P1 dostane volné okno dřív než P3, P0 se neplánuje", () => {
    const d: DenSOkny[] = [{ den: den("Hristov", B.hloubetin!, []), volnaOkna: [{ od: h(10), do: h(11, 59) }] }];
    const p = navrhniPlan([
      { id: "nizka", bod: B.strasnice!, trvani: 90, priorita: "P3", slaKonec: null },
      { id: "vysoka", bod: B.krc!, trvani: 90, priorita: "P1", slaKonec: null },
      { id: "cekame", bod: B.prosek!, trvani: 90, priorita: "P0", slaKonec: null },
    ], d, v, "2026-10-15");
    expect(p.prirazeni.map((x) => x.zakazka)).toEqual(["vysoka"]);
    expect(p.neprirazene.map((x) => x.zakazka)).toEqual(["nizka"]);
    expect(kpiPlanu(p.dny)).toMatchObject({ instalaci: 1, dni: 1 });
  });
});

describe("KPI zakázek", () => {
  it("SLA, termíny v SLA a stáří", () => {
    const exportAt = local(2026, 10, 15, 9, 0);
    const z = (o: Partial<Zakazka>) => ({ predobjednavka: false, termin: null, prideleno: local(2026, 10, 10, 9, 0), doSplneniMin: 3000, ...o }) as Zakazka;
    const k = kpiZakazek([
      z({ doSplneniMin: -60 }),
      z({ doSplneniMin: 600, termin: { od: local(2026, 10, 16, 8, 0), do: local(2026, 10, 16, 9, 59) } }),
      z({ termin: { od: local(2026, 10, 15, 10, 0), do: local(2026, 10, 15, 11, 59) } }),
      z({ predobjednavka: true }),
    ], exportAt);
    expect(k).toMatchObject({ aktivni: 3, poSla: 1, slaDo24h: 1, sTerminem: 2, terminVSla: 1, bezTerminu: 1, prumerneStariDni: 5 });
    expect(slaKonec({ doSplneniMin: 60 }, exportAt)).toEqual(local(2026, 10, 15, 10, 0));
  });
});

describe("pravidla plánování ze SKILLS v5", () => {
  it("přednost má zaplnění rozpracovaného dne, pak okno 10–14 (zadání fáze 1)", () => {
    const tech = (jmeno: string, navstevy: Navsteva[]): DenSOkny => ({ den: den(jmeno, B.hloubetin!, navstevy), volnaOkna: [{ od: h(8), do: h(9, 59) }, { od: h(10), do: h(11, 59) }] });
    const z = { id: "N", bod: B.strasnice!, trvani: 90, priorita: "P2" as const, slaKonec: null };
    const m = nabidniTerminy(z, [tech("Plny", [nv("A", B.hloubetin!, h(14), h(15, 59)), nv("B", B.hloubetin!, h(16), h(17))]), tech("Volny", [])], v, "2026-10-15", {}, 4);
    expect(m[0]).toMatchObject({ technik: "Plny", okno: { od: h(10) } });
    expect(m.at(-1)!.technik).toBe("Volny"); // prázdný den až nakonec
  });
});

describe("dny techniků z kalendáře", async () => {
  const { sestavDny } = await import("../src/plan/dny.js");
  const geo = { najdi: async (a: string) => ({ bod: a.includes("Krč") ? B.krc! : a.includes("Hloubětín") ? B.hloubetin! : null, presnost: "adresa" as const, zdroj: "test" }) };
  const u = (o: Record<string, unknown>) => ({ kalendar: "c", technik: "Hristov", id: "e", summary: "", description: "", location: "", od: local(2026, 10, 16, 10, 0), do: local(2026, 10, 16, 12, 0), ...o }) as any;

  it("zakázky z událostí, volná okna z VOLNY, chybějící polohy a základny nahlásí", async () => {
    const r = await sestavDny(
      [{ jmeno: "Hristov", vyjezd: "Praha-Hloubětín" }, { jmeno: "Novák", vyjezd: "" }],
      [
        u({ id: "e1", location: "Na Strži, Praha 4-Krč", appkoo: "A1" }),
        u({ id: "e2", location: "neznámo", od: local(2026, 10, 16, 8, 0), do: local(2026, 10, 16, 9, 0) }),
        u({ id: "e3", summary: "VOLNY", od: local(2026, 10, 16, 14, 0), do: local(2026, 10, 16, 16, 0) }),
      ],
      "2026-10-16",
      geo,
    );
    expect(r.bezZakladny).toEqual(["Novák"]);
    expect(r.bezPolohy.map((x) => x.id)).toEqual(["e2"]);
    expect(r.dny[0]!.den.navstevy).toEqual([{ id: "A1", bod: B.krc, od: 600, do: 719, trvani: 110 }]);
    expect(r.dny[0]!.volnaOkna).toEqual([{ od: 840, do: 959 }]);
  });
});
