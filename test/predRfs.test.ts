import { describe, expect, it } from "vitest";
import { instalacePredRfs, radekUdalostiPredRfs, upozorneniPredRfs } from "../src/domain/predRfs.js";

const now = new Date("2026-11-05T09:00:00Z");
const zakl = { typAktivity: "Inst_Pristupu_FTTH", infrastruktura: "TMCZ", predobjednavka: false, rfs: new Date("2026-11-11T00:00:00Z"), idS7: "=10666331" };

describe("instalace před RFS (postup TMCZ v1.0)", () => {
  it("TMCZ Inst_Pristupu_FTTH s RFS v budoucnu → před RFS; jinak ne", () => {
    expect(instalacePredRfs(zakl, now)).toEqual({ rfs: zakl.rfs, rfsText: "11.11.2026" });
    expect(instalacePredRfs({ ...zakl, infrastruktura: "CETIN", typAktivity: "CETIN_Inst_Pristupu_FTTH" }, now)).toBeNull(); // postup platí jen pro TMCZ
    expect(instalacePredRfs({ ...zakl, predobjednavka: true, typAktivity: "Predobjednavka_FTTH" }, now)).toBeNull(); // předobjednávka má vlastní pravidla
    expect(instalacePredRfs({ ...zakl, rfs: new Date("2026-11-05T00:00:00Z") }, now)).toBeNull(); // RFS dnes = běžná zakázka
    expect(instalacePredRfs({ ...zakl, rfs: new Date("2026-09-09T00:00:00Z") }, now)).toBeNull(); // RFS v minulosti
    expect(instalacePredRfs({ ...zakl, rfs: null }, now)).toBeNull();
    expect(instalacePredRfs({ ...zakl, typAktivity: "Zafuk_Pristupu_FTTH" }, now)).toBeNull();
    expect(instalacePredRfs({ ...zakl, idS7: "" }, now)).toBeNull(); // bez ID S7 to instalace před RFS není
    expect(instalacePredRfs({ ...zakl, idS7: "=" }, now)).toBeNull();
  });

  it("texty: call script bez „nebude fungovat“, řádek události s kroky technika", () => {
    const p = instalacePredRfs(zakl, now)!;
    expect(upozorneniPredRfs(p)).toContain("instalujeme v předstihu");
    expect(upozorneniPredRfs(p)).toContain("SMS");
    expect(radekUdalostiPredRfs(p)).toMatch(/^INSTALACE PŘED RFS 11\.11\.2026:/);
    expect(radekUdalostiPredRfs(p)).toContain("Aktivace služby: 11.11.2026");
    expect(radekUdalostiPredRfs(p)).toContain("vytáhnout napájecí zdroj");
  });
});
