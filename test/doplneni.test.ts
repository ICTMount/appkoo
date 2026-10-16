import { describe, expect, it } from "vitest";
import { local } from "../src/domain/time.js";
import { doplnSlot, jeFlex, type Kandidat } from "../src/plan/doplneni.js";
import { odhadVzdalenosti } from "../src/plan/geo.js";
import type { DenSOkny } from "../src/plan/sloty.js";

describe("poznámka flex", () => {
  it("pozitivní flex ano, zápory ne", () => {
    for (const t of ["Flex tento den", "zákazník flexibilní, může i dřív", "FLEX kdykoli", "flex – volat"]) expect(jeFlex(t), t).toBe(true);
    for (const t of ["ne flex", "neflexibilní", "není flex", "flex: ne", "bez flexu", "zákazník chce přesně 10:00"]) expect(jeFlex(t), t).toBe(false);
  });
});

const HLOUBETIN = { lat: 50.105, lon: 14.535 };
const kand = (id: string, bod: { lat: number; lon: number }, o: Partial<Kandidat> = {}): Kandidat => ({
  z: { idAktivity: id, idObjednavky: `O-${id}`, idObjednavkyZaklad: `O-${id}` } as never,
  priorita: "P3",
  slaKonec: null,
  bod,
  ...o,
});

// Pátek 16.10.2026: Hristov má zakázku 8–10 v Hloubětíně, volný slot 10–12
const den: DenSOkny = {
  den: { technik: "Hristov", datum: "2026-10-16", zakladna: HLOUBETIN, pracujeOd: 450, pracujeDo: 1140, navstevy: [{ id: "z1", bod: { lat: 50.11, lon: 14.51 }, od: 480, do: 599, trvani: 110 }] },
  volnaOkna: [{ od: 600, do: 719 }],
};
const okno = { od: 600, do: 719 };
const v = odhadVzdalenosti();

describe("doplnění slotu (režim B)", () => {
  it("řadí podle km navíc, zajížďku nad 75 km vynechá", () => {
    const n = doplnSlot(den, okno, [kand("BLIZKO", { lat: 50.1, lon: 14.52 }), kand("DAL", { lat: 50.05, lon: 14.3 }), kand("BRNO", { lat: 49.19, lon: 16.61 })], v);
    expect(n.map((x) => x.kandidat.z.idAktivity)).toEqual(["BLIZKO", "DAL"]);
    expect(n[0]!.kmNavic).toBeLessThan(n[1]!.kmNavic);
  });

  it("naléhavé SLA a priorita předběhnou o něco bližší zakázku", () => {
    const sla = local(2026, 10, 16, 20, 0); // do 48 h od slotu
    const n = doplnSlot(den, okno, [kand("BLIZKO", { lat: 50.1, lon: 14.52 }), kand("SLA", { lat: 50.07, lon: 14.45 }, { slaKonec: sla, priorita: "P1" })], v);
    expect(n[0]!.kandidat.z.idAktivity).toBe("SLA");
    expect(n[0]!.duvody).toEqual(expect.arrayContaining(["SLA do 48 h", "priorita P1"]));
  });

  it("flex: přesouvá se jen dopředu, zakázka už ve dni se nenabízí", () => {
    const pozdeji = { kalendar: "K2", eventId: "e9", technik: "Koval", od: local(2026, 10, 22, 10, 0) };
    const drive = { ...pozdeji, od: local(2026, 10, 15, 10, 0) };
    const n = doplnSlot(den, okno, [kand("FLEX", { lat: 50.1, lon: 14.52 }, { presun: pozdeji }), kand("STARY", { lat: 50.1, lon: 14.52 }, { presun: drive }), kand("z1", { lat: 50.1, lon: 14.52 })], v);
    expect(n.map((x) => x.kandidat.z.idAktivity)).toEqual(["FLEX"]);
    expect(n[0]!.duvody).toContain("přesun dopředu (flex)");
  });
});
