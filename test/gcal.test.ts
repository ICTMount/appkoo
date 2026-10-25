import { describe, expect, it } from "vitest";
import { nactiUdalosti, zapisUdalost } from "../src/gcal/kalendar.js";
import { jeFlex } from "../src/plan/doplneni.js";
import { podobnostAdres, volnaOkna, zkontroluj, type UdalostTechnika } from "../src/gcal/kontrola.js";
import { sestavUdalost, textFlex } from "../src/gcal/udalost.js";
import { local } from "../src/domain/time.js";
import type { Zakazka } from "../src/import/mwfExport.js";

const zak = (o: Partial<Zakazka> = {}): Zakazka => ({
  idAktivity: "A1", idObjednavky: "O-8532577900:1", idObjednavkyZaklad: "O-8532577900", idS7: "1-D79CTLE",
  technik: "Hristov Nikolaj (Vegacom)", typAktivity: "CETIN_Inst_Pristupu_FTTH", infrastruktura: "CETIN",
  zakaznik: "Patera, Michal", telefony: ["603354035"], adresa: "Na Strži 1702/65, Praha 4", psc: "14000", balik: "Router",
  termin: { od: local(2026, 10, 16, 10, 0), do: local(2026, 10, 16, 11, 59) },
  ...o,
}) as Zakazka;

const ud = (o: Partial<UdalostTechnika> = {}): UdalostTechnika => ({
  kalendar: "cal-hristov", technik: "Hristov", id: "e1",
  summary: "Hristov - FTTH (CETIN) 1-D79CTLE, Patera, Michal", description: "TEL: 603 354 035\nZAKÁZKA: O-8532577900",
  location: "Na Strži 1702/65, Praha 4", od: local(2026, 10, 16, 10, 0), do: local(2026, 10, 16, 11, 59), ...o,
});

describe("šablona události", () => {
  it("vyplní název, telefon, ID zakázky a skryté vlastnosti; čas v pražské zóně", () => {
    const u = sestavUdalost(zak(), "Hristov", local(2026, 10, 16, 10, 0), local(2026, 10, 16, 11, 59), { patro: "3", byt: "12", souhlasSVrtanim: false, caseid: "CZ-1", kz: "BRIDGE Sagemcom" }, local(2026, 10, 17, 14, 51), "AP");
    // stejný tvar jako dnešní události v kalendářích techniků
    expect(u.summary).toBe("Bridge Hristov - FTTH CETIN O-8532577900 Patera, Michal SLA 17.10.2026 14:51 (AP)");
    expect(u.start).toEqual({ dateTime: "2026-10-16T10:00:00", timeZone: "Europe/Prague" });
    expect(u.description).toContain("TEL: 603354035");
    expect(u.description).toContain("ČÍSLO PATRA A BYTU: 3 / 12");
    expect(u.description).toContain("SOUHLAS S VRTÁNÍM: NE = vrátit na PEP, nebo STORNO");
    expect(u.description).toContain("CASEID: CZ-1");
    expect(u.description).not.toContain("PODB"); // jen pro síť T-Mobile
    expect(u.extendedProperties.private).toEqual({ appkoo: "A1", objednavka: "O-8532577900", s7: "1-D79CTLE" });
  });
});

describe("kontrola MWF ↔ kalendář", () => {
  it("shoda", () => {
    expect(zkontroluj([zak()], [ud()]).vysledky[0]).toMatchObject({ zavaznost: "shoda", problemy: [] });
  });

  it("chybí v kalendáři / jiný čas / jiný technik / jiný telefon", () => {
    expect(zkontroluj([zak()], []).vysledky[0]!.zavaznost).toBe("rozpor");
    expect(zkontroluj([zak()], [ud({ od: local(2026, 10, 16, 12, 0) })]).vysledky[0]!.problemy.join()).toMatch(/čas/);
    expect(zkontroluj([zak()], [ud({ technik: "Vajc" })]).vysledky[0]!.problemy.join()).toMatch(/technik/);
    const jinyTel = zkontroluj([zak()], [ud({ description: "TEL: 777000111 O-8532577900" })]).vysledky[0]!;
    expect(jinyTel).toMatchObject({ zavaznost: "admin", problemy: [expect.stringMatching(/Telefon/)] });
  });

  it("chybějící telefon a jiná adresa jsou jen administrativní", () => {
    const r = zkontroluj([zak()], [ud({ description: "O-8532577900", location: "Kolín" })]).vysledky[0]!;
    expect(r.zavaznost).toBe("admin");
    expect(r.problemy).toHaveLength(2);
  });

  it("páruje podle skrytého ID a hlásí události jen v kalendáři", () => {
    const r = zkontroluj([zak()], [ud({ summary: "přeplánováno", description: "TEL: 603354035", appkoo: "A1" }), ud({ id: "e2", description: "O-9999999999" })]);
    expect(r.vysledky[0]!.udalost!.id).toBe("e1");
    expect(r.jenVKalendari.map((u) => u.id)).toEqual(["e2"]);
  });

  it("volná okna VOLNY nejsou zakázky", () => {
    const u = [ud({ summary: "VOLNY", description: "", od: local(2026, 10, 16, 14, 0), do: local(2026, 10, 16, 16, 0) }), ud()];
    expect(volnaOkna(u, "Hristov", "2026-10-16")).toEqual([{ od: 14 * 60, do: 16 * 60 - 1 }]);
    expect(zkontroluj([], u).jenVKalendari.map((x) => x.summary)).not.toContain("VOLNY");
    // zelená událost bez čísla zakázky je volný slot i bez slova VOLNY
    expect(volnaOkna([ud({ summary: "Hristov", barva: "10", od: local(2026, 10, 16, 8, 0), do: local(2026, 10, 16, 10, 0) })], "Hristov", "2026-10-16")).toEqual([{ od: 480, do: 599 }]);
  });

  it("VOLNY sz (změna smlouvy FTTH / servis PIV) se pro instalaci nenabízí", async () => {
    const { jeVyhrazeneVolno } = await import("../src/gcal/kontrola.js");
    const sz = ud({ summary: "Papez - VOLNY sz", barva: "10", od: local(2026, 10, 16, 12, 0), do: local(2026, 10, 16, 13, 0) });
    const bezny = ud({ summary: "Papez - VOLNY", barva: "10", od: local(2026, 10, 16, 14, 0), do: local(2026, 10, 16, 16, 0) });
    expect(jeVyhrazeneVolno(sz)).toBe(true);
    expect(jeVyhrazeneVolno(bezny)).toBe(false);
    expect(volnaOkna([sz, bezny], "Hristov", "2026-10-16")).toEqual([{ od: 14 * 60, do: 16 * 60 - 1 }]);
    expect(zkontroluj([], [sz]).jenVKalendari).toEqual([]);
  });

  it("vytížení dne: volno / obsazeno / blok v pořadí času a % obsazení", async () => {
    const { vytizeniDne } = await import("../src/gcal/kontrola.js");
    const u = [
      ud({ id: "a", summary: "Hristov - FTTH O-1234567890", od: local(2026, 10, 16, 8, 0), do: local(2026, 10, 16, 10, 0) }),
      ud({ id: "b", summary: "Hristov - VOLNY", barva: "10", od: local(2026, 10, 16, 10, 0), do: local(2026, 10, 16, 12, 0) }),
      ud({ id: "c", summary: "Hristov - FTTH O-1234567891", od: local(2026, 10, 16, 12, 0), do: local(2026, 10, 16, 14, 0) }),
      ud({ id: "d", summary: "Hristov - VOLNY", barva: "10", od: local(2026, 10, 16, 14, 0), do: local(2026, 10, 16, 16, 0) }),
      ud({ id: "e", summary: "Hristov - NEPLANOVAT", od: local(2026, 10, 16, 16, 0), do: local(2026, 10, 16, 18, 0) }),
    ];
    const v = vytizeniDne(u, "Hristov", "2026-10-16");
    expect(v.dilky.map((d) => d.stav)).toEqual(["obsazeno", "volno", "obsazeno", "volno", "blok"]);
    expect(v).toMatchObject({ volnych: 2, obsazenych: 2, procento: 50 });
  });

  it("skutečné události: VOLNY a NEPLANOVAT nejsou zakázky, HTML popis se přečte", async () => {
    const { zHtml } = await import("../src/gcal/kalendar.js");
    const html = ud({ description: zHtml("<u>pero</u><br><br>TEL: 603354035<br>O-8532577900"), summary: "Hristov - FTTH O-8532577900 Patera SLA 23.10.2026 10:18 (LH)" });
    const r = zkontroluj([zak()], [html, ud({ id: "v", summary: "Hristov - VOLNY" }), ud({ id: "n", summary: "Hristov - NEPLANOVAT" })]);
    expect(r.vysledky[0]).toMatchObject({ zavaznost: "shoda" });
    expect(r.jenVKalendari).toEqual([]);
  });

  it("podobnost adres", () => {
    expect(podobnostAdres("Na Strži 1702/65, Praha 4", "Na Strzi 1702/65 Praha")).toBe(1);
    expect(podobnostAdres("Praha, Podolská 348/88", "Podolská 348/88")).toBe(1); // skutečný případ z kalendáře
    expect(podobnostAdres("Praha, Podolská 348/88", "Podolská 34")).toBe(0.5);
    expect(podobnostAdres("Na Strži 1702/65, Praha 4", "Tyršova 1840, Benešov")).toBe(0);
  });
});

describe("Google Calendar API", () => {
  it("čte události a převede čas na pražský", async () => {
    const api = { events: { list: async () => ({ data: { items: [
      { id: "e1", summary: "x", start: { dateTime: "2026-10-16T08:00:00Z" }, end: { dateTime: "2026-10-16T10:00:00Z" } },
      { id: "e2", summary: "dovolená", start: { date: "2026-10-16" }, end: { date: "2026-10-17" } },
    ] } }) } } as any;
    const u = await nactiUdalosti(api, [{ technik: "Hristov", kalendar: "c1" }], new Date(), new Date());
    expect(u).toHaveLength(1);
    expect(u[0]!.od).toEqual(local(2026, 10, 16, 10, 0)); // 08:00 UTC = 10:00 v Praze (letní čas)
  });

  it("zápis: nová událost, úprava, obsazení okna VOLNY a vrácení slotu při přesunu", async () => {
    const volani: string[] = [];
    const existujici: Record<string, string | undefined> = { c2: "e-stara" };
    const api = { events: {
      list: async (p: any) => ({ data: { items: existujici[p.calendarId] ? [{ id: existujici[p.calendarId] }] : [] } }),
      insert: async (p: any) => (volani.push(`insert ${p.calendarId}`), { data: { id: "e-nova" } }),
      patch: async (p: any) => (volani.push(`patch ${p.calendarId} ${p.eventId} ${p.requestBody.summary}`), { data: {} }),
    } } as any;
    const u = sestavUdalost(zak(), "Hristov", local(2026, 10, 16, 10, 0), local(2026, 10, 16, 11, 59));
    const s = u.summary;

    // mimo sloty, zakázka v kalendáři ještě není → nová událost
    expect(await zapisUdalost(api, "c1", u)).toEqual({ eventId: "e-nova", akce: "vytvořeno" });
    // zakázka už v kalendáři je → úprava, žádná druhá událost
    expect(await zapisUdalost(api, "c2", u)).toEqual({ eventId: "e-stara", akce: "upraveno" });
    // přesun do volného okna: okno se obsadí, původní událost se vrátí na VOLNY
    expect(await zapisUdalost(api, "c2", u, undefined, "e-volny")).toEqual({ eventId: "e-volny", akce: "obsazeno okno", uvolneno: "e-stara" });
    // přesun k jinému technikovi mimo sloty: nová událost + původní slot zpět na VOLNY
    expect(await zapisUdalost(api, "c1", u, { kalendar: "c3", eventId: "e-vajc", technik: "Vajc" })).toMatchObject({ akce: "vytvořeno", uvolneno: "e-vajc" });

    expect(volani).toEqual([
      "insert c1",
      `patch c2 e-stara ${s}`,
      `patch c2 e-volny ${s}`,
      "patch c2 e-stara Hristov - VOLNY",
      "insert c1",
      "patch c3 e-vajc Vajc - VOLNY",
    ]);
  });

});

describe("FLEX v popisu události", () => {
  it("pevný termín plánovač nepovažuje za flex, FLEX ten den / obecně ano", () => {
    expect(jeFlex(textFlex("ne"))).toBe(false);
    expect(jeFlex(textFlex("den", "jen do 14 h"))).toBe(true);
    expect(jeFlex(textFlex("obecne"))).toBe(true);
    expect(textFlex("den", "jen do 14 h")).toBe("FLEX ten den – jen do 14 h");
  });
});
