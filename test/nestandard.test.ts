import { describe, expect, it } from "vitest";
import { nestandardZFormulare } from "../src/web/planovani.js";
import { local } from "../src/domain/time.js";

describe("nestandardní úprava události", () => {
  const od = local(2026, 10, 29, 14, 30);
  const do_ = local(2026, 10, 29, 16, 30);
  it("bez zaškrtnutí se nic nemění", () => {
    expect(nestandardZFormulare(new URLSearchParams({ nadpis: "X", casOd: "08:00", casDo: "09:00" }), od, do_)).toBeNull();
  });
  it("vlastní název a čas ve stejném dni", () => {
    const n = nestandardZFormulare(new URLSearchParams({ nestandard: "1", nadpis: " Vajc - FTTH O-1 Novák (DH) ", casOd: "9:00", casDo: "11:30" }), od, do_)!;
    expect(n.nadpis).toBe("Vajc - FTTH O-1 Novák (DH)");
    expect(n.od?.toISOString()).toBe("2026-10-29T09:00:00.000Z");
    expect(n.do?.toISOString()).toBe("2026-10-29T11:30:00.000Z");
  });
  it("neplatný nebo obrácený čas se ignoruje (zůstane čas slotu), název prázdný = šablona", () => {
    const n = nestandardZFormulare(new URLSearchParams({ nestandard: "1", nadpis: "", casOd: "12:00", casDo: "11:00" }), od, do_)!;
    expect(n.nadpis).toBeNull();
    expect(n.od).toBeNull();
  });
});

describe("povinná pole formuláře hovoru", async () => {
  const { chybejiciPole } = await import("../src/web/planovani.js");
  it("vyjmenuje chybějící povinné údaje", () => {
    expect(chybejiciPole(new URLSearchParams({ flex: "ne", instalace: "nova", patro: "1", byt: "2", vrtani: "ano", umisteni: "chodba", elZasuvka: "ano", kz: "ROUTE", predpojen: "ne" }))).toEqual([]);
    expect(chybejiciPole(new URLSearchParams({ flex: "ne", patro: " " }))).toContain("Číslo patra");
    expect(chybejiciPole(new URLSearchParams({ flex: "ne", patro: " " }))).toContain("KZ");
  });
});
