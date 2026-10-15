import { describe, expect, it } from "vitest";
import { cesky, sMwf, SLOVNIK, zakladniCisloObjednavky } from "../src/domain/slovnik.js";
import { PARKOVANI, VYSLEDEK } from "../src/domain/mwf.js";

describe("slovník MWF ↔ aplikace", () => {
  it("převádí slovenské názvy na české a ukáže originál z MWF", () => {
    expect(cesky("Riešená dodávateľom - odovzdaná")).toBe("Předaná Vegacomu");
    expect(sMwf("Legislatívne problémy")).toBe("Legislativní problémy (v MWF: Legislatívne problémy)");
    expect(sMwf("Zaparkovaná")).toBe("Zaparkovaná");
    expect(cesky("neznámá hodnota")).toBe("neznámá hodnota");
  });

  it("pokrývá všechny používané hodnoty parkování a výsledku dojednávání", () => {
    const mwf = new Set(SLOVNIK.map((p) => p.mwf));
    for (const v of [...Object.values(PARKOVANI), "Nezastihnutý", "Márny výjazd", "Chybný kontakt"]) expect(mwf).toContain(v);
    expect(VYSLEDEK).toContain("Nezastihnutý");
  });

  it("nemá duplicitní pojmy", () => {
    expect(new Set(SLOVNIK.map((p) => p.mwf)).size).toBe(SLOVNIK.length);
  });

  it("číslo objednávky bez přípon", () => {
    expect(zakladniCisloObjednavky("O-8532577900:1")).toBe("O-8532577900");
    expect(zakladniCisloObjednavky("O-8541450094-13075814")).toBe("O-8541450094");
    expect(zakladniCisloObjednavky("O-8538322609:1-D6OZZL8#1-D6P0P85")).toBe("O-8538322609");
    expect(zakladniCisloObjednavky("21892159")).toBe("21892159");
  });
});
