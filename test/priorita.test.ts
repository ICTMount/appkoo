import { describe, expect, it } from "vitest";
import { nahledImportu, nastaveniKontaktu, pravidlaPriority, VYCHOZI_NASTAVENI_KONTAKTU } from "../src/config/ciselniky.js";
import { faktaZakazky, urciPrioritu, VYCHOZI_PRAVIDLA } from "../src/domain/priorita.js";
import { local, HOUR } from "../src/domain/time.js";
import { rozlozPoznamku } from "../src/import/notes.js";
import type { Zakazka } from "../src/import/mwfExport.js";

const NOW = local(2026, 10, 15, 9, 0);
function zak(o: Partial<Zakazka> & { poznamka?: string }): Zakazka {
  const poznamka = o.poznamka ?? "";
  return {
    parkovani: null, termin: null, vysledek: null, predobjednavka: false, rfs: null, doSplneniMin: 1000,
    ...o, poznamka, zaznamy: rozlozPoznamku(poznamka).zaznamy,
  } as unknown as Zakazka;
}
const prio = (z: Zakazka) => urciPrioritu(faktaZakazky(z, NOW));

describe("priorita podle pravidel", () => {
  it("nová zakázka bez zápisu → P1", () => {
    expect(prio(zak({}))).toMatchObject({ priorita: "P1", pravidlo: { podminka: "nova_bez_hovoru" } });
  });

  it("promeškaný datum kontaktu → P1; kontakt zítra → P2; za 3 dny → P3; za týden → P0", () => {
    const s = (d: string) => zak({ poznamka: `[Editácia] 10.10.2026 9:00, A (Vegacom): na přání kontaktovat ${d} r_1` });
    expect(prio(s("14.10.2026")).priorita).toBe("P1");
    expect(prio(s("16.10.2026")).priorita).toBe("P2");
    expect(prio(s("18.10.2026")).priorita).toBe("P3");
    expect(prio(s("22.10.2026")).priorita).toBe("P0");
  });

  it("ZAK a smlouva s JP → P0, termín proběhl → P1", () => {
    expect(prio(zak({ parkovani: "Zákazník - nedostupný", poznamka: "[Editácia] 10.10.2026 9:00, A (Vegacom): x" })).priorita).toBe("P0");
    expect(prio(zak({ poznamka: "[Editácia] 10.10.2026 9:00, A (Vegacom): zkz. má smlouvu s JP, přeje si kontaktovat 30.11.2026 r_2" })).priorita).toBe("P0");
    expect(prio(zak({ termin: { od: local(2026, 10, 14, 10, 0), do: local(2026, 10, 14, 12, 0) } }))).toMatchObject({ priorita: "P1", pravidlo: { podminka: "termin_probehl" } });
  });

  it("předobjednávka: před RFS P0, po RFS P1", () => {
    expect(prio(zak({ predobjednavka: true, rfs: local(2026, 11, 30) })).priorita).toBe("P0");
    expect(prio(zak({ predobjednavka: true, rfs: local(2026, 10, 15) })).priorita).toBe("P1");
  });

  it("datum kontaktu bez roku napsané v prosinci patří do dalšího roku", () => {
    const z = zak({ poznamka: "[Editácia] 15.12.2026 9:00, A (Vegacom): kontaktovat 8.1." });
    expect(faktaZakazky(z, NOW).dalsiKontakt).toBe("2027-01-08");
  });

  it("vlastní pravidla z CSV změní výsledek", () => {
    const csv = "Pořadí;Podmínka;Parametr;Priorita\n10;nova_bez_hovoru;;P2\n99;vse;;P3";
    const n = nahledImportu("pravidlaPriority", csv, []);
    expect(n.lzeUlozit).toBe(true);
    expect(urciPrioritu(faktaZakazky(zak({}), NOW), pravidlaPriority(n.nove)).priorita).toBe("P2");
    expect(nahledImportu("pravidlaPriority", "Pořadí;Podmínka;Priorita\n1;neexistuje;P1", []).lzeUlozit).toBe(false);
  });

  it("výchozí pravidla končí záchytným pravidlem", () => {
    expect(VYCHOZI_PRAVIDLA.at(-1)!.podminka).toBe("vse");
  });
});

describe("nastavení kontaktování", () => {
  it("auto: velký objem → 1 pokus denně, malý → 2", () => {
    expect(nastaveniKontaktu(VYCHOZI_NASTAVENI_KONTAKTU, 55).nastaveni.pokusuDenne).toBe(1);
    expect(nastaveniKontaktu(VYCHOZI_NASTAVENI_KONTAKTU, 20).nastaveni.pokusuDenne).toBe(2);
  });

  it("pevná hodnota a časy volání", () => {
    const n = nastaveniKontaktu([{ parametr: "pokusuDenne", hodnota: "1" }, { parametr: "volaniDo", hodnota: "18:30" }], 0).nastaveni;
    expect(n.pokusuDenne).toBe(1);
    expect(n.volaniDo).toBe(18 * 60 + 30);
  });

  it("minimum normy TMCZ nejde snížit", () => {
    const r = nastaveniKontaktu([{ parametr: "odstupPokusuHodin", hodnota: "2" }, { parametr: "dnu", hodnota: "2" }]);
    expect(r.nastaveni.odstupPokusu).toBe(4 * HOUR);
    expect(r.nastaveni.dnu).toBe(3);
    expect(r.upozorneni).toHaveLength(2);
  });
});
