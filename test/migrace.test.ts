import { describe, expect, it } from "vitest";
import { migrace, zasuvkaUsed } from "../src/domain/migrace.js";
import { rozlozPoznamku } from "../src/import/notes.js";

describe("migrace SWAP / FIS MOP z poznámky", () => {
  it("SWAP: CASEID a lhůta 7 dní od zápisu", () => {
    const { zaznamy, uvod } = rozlozPoznamku("[Dojednávania] 20.10.2026 9:10, Lenka Havlíčková (Vegacom): SWAP migrace, CASEID 123456789, volat zákazníkovi\n");
    const m = migrace({ zaznamy, uvodPoznamky: uvod })!;
    expect(m.typ).toBe("SWAP");
    expect(m.caseId).toBe("123456789");
    expect(m.nejpozdeji?.toISOString().slice(0, 10)).toBe("2026-10-27");
  });

  it("FIS MOP: datum portace", () => {
    const m = migrace({ poznamka: "FIS MOP – CASEID: ABC-4455, datum portace 28.10.2026, termín až po portaci" })!;
    expect(m.typ).toBe("FIS MOP");
    expect(m.caseId).toBe("ABC-4455");
    expect(m.portace?.toISOString().slice(0, 10)).toBe("2026-10-28");
  });

  it("běžná zakázka → null", () => {
    expect(migrace({ poznamka: "Zákazník: Novák (26.10.2026, 08:00 - 10:00)" })).toBeNull();
  });

  it("obsazená zásuvka (USED) – neplánovat; novější FREE příznak ruší; SWAP má přednost", () => {
    const u = rozlozPoznamku("[Parkovanie] 21.10.2026 9:00, Lenka Havlíčková (Vegacom): zásuvka je obsazená, r_2, čeká na PEP, příští kontakt 28.10.\n");
    expect(zasuvkaUsed({ zaznamy: u.zaznamy })?.at?.toISOString().slice(0, 10)).toBe("2026-10-21");
    expect(zasuvkaUsed({ poznamka: "Stav vlákna USED - cizí služba" })).not.toBeNull();
    const f = rozlozPoznamku(
      "[Dojednávania] 23.10.2026 10:00, Lenka Havlíčková (Vegacom): PEP potvrdil, zásuvka uvolněná, FREE, volat termín\n" +
        "[Parkovanie] 21.10.2026 9:00, Lenka Havlíčková (Vegacom): obsazená zásuvka, r_2\n",
    );
    expect(zasuvkaUsed({ zaznamy: f.zaznamy })).toBeNull();
    expect(zasuvkaUsed({ poznamka: "SWAP, CASEID 1234567, zásuvka USED" })).toBeNull();
    expect(zasuvkaUsed({ poznamka: "Zákazník: Novák (26.10.2026, 08:00 - 10:00)" })).toBeNull();
  });
});
