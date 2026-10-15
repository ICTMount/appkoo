import { describe, expect, it } from "vitest";
import { lhutaZak, planKontaktu, pokusuDenneDleObjemu, type Pokus } from "../src/domain/contact.js";
import { dalsiMv, najdiKody, parkovaniPoMv, pocetMv, PARKOVANI } from "../src/domain/mwf.js";
import { fraze } from "../src/domain/phrases.js";
import { fmtDate, fmtTime, local } from "../src/domain/time.js";
import { isWorkday, nextWorkday, workdaysBetween } from "../src/domain/workdays.js";

const nedovolano = (t: Date, sms = false): Pokus => ({ at: t, dovolano: false, sms });

describe("pracovní dny", () => {
  it("víkend a státní svátky nejsou pracovní dny", () => {
    expect(isWorkday("2026-10-14")).toBe(true); // středa
    expect(isWorkday("2026-10-17")).toBe(false); // sobota
    expect(isWorkday("2026-10-28")).toBe(false); // vznik ČSR
    expect(isWorkday("2026-04-03")).toBe(false); // Velký pátek 2026
    expect(isWorkday("2026-04-06")).toBe(false); // Velikonoční pondělí 2026
    expect(isWorkday("2026-04-07")).toBe(true);
  });

  it("další pracovní den přeskočí víkend i svátek", () => {
    expect(nextWorkday("2026-10-16")).toBe("2026-10-19");
    expect(nextWorkday("2026-10-27")).toBe("2026-10-29");
    expect(nextWorkday("2026-04-02")).toBe("2026-04-07");
  });

  it("počítá pracovní dny včetně krajů", () => {
    expect(workdaysBetween("2026-10-15", "2026-10-19")).toBe(3); // Čt, Pá, Po
  });
});

describe("plán kontaktu", () => {
  it("nová zakázka – volat hned (v době volání)", () => {
    const now = local(2026, 10, 14, 9, 0);
    const p = planKontaktu([], now);
    expect(p.stav).toBe("novy");
    expect(p.dalsiPokus).toEqual(now);
  });

  it("po prvním nedovolání další pokus za 4 h a doporučí SMS", () => {
    const t = local(2026, 10, 14, 9, 10);
    const p = planKontaktu([nedovolano(t)], local(2026, 10, 14, 9, 15));
    expect(p.stav).toBe("probiha");
    expect(fmtTime(p.dalsiPokus!)).toBe("13:10");
    expect(p.sms.doporucena).toBe(true);
  });

  it("po 2 pokusech dnes je další pokus až další pracovní den v 8:00", () => {
    const pokusy = [nedovolano(local(2026, 10, 16, 9, 0), true), nedovolano(local(2026, 10, 16, 13, 30))];
    const p = planKontaktu(pokusy, local(2026, 10, 16, 14, 0)); // pátek
    expect(fmtDate(p.dalsiPokus!)).toBe("19.10.2026");
    expect(fmtTime(p.dalsiPokus!)).toBe("08:00");
  });

  it("varuje, když je první pokus po 15:00 (druhý se do 19:00 nestihne)", () => {
    const p = planKontaktu([nedovolano(local(2026, 10, 14, 15, 30))], local(2026, 10, 14, 15, 35));
    expect(p.varovani.join(" ")).toMatch(/15:00/);
    expect(fmtDate(p.dalsiPokus!)).toBe("15.10.2026");
  });

  it("SMS nejdřív 18 h po předchozí", () => {
    const pokusy = [nedovolano(local(2026, 10, 14, 16, 0), true), nedovolano(local(2026, 10, 15, 9, 0))];
    const p = planKontaktu(pokusy, local(2026, 10, 15, 9, 5));
    expect(p.sms.doporucena).toBe(false);
    expect(fmtTime(p.sms.nejdrive!)).toBe("10:00");
  });

  it("3 dny × 2 pokusy → návrh ZAK, splněná norma", () => {
    const dny = [14, 15, 16];
    const pokusy = dny.flatMap((d) => [nedovolano(local(2026, 10, d, 9, 0), true), nedovolano(local(2026, 10, d, 14, 0))]);
    const p = planKontaktu(pokusy, local(2026, 10, 16, 14, 5));
    expect(p.stav).toBe("navrh_zak");
    expect(p.navolaneDny).toBe(3);
    expect(p.splnujeNormu).toBe(true);
    expect(p.dalsiPokus).toBeNull();
  });

  it("den je navolaný už s 1 pokusem – 3 dny po 1 pokusu → návrh ZAK", () => {
    const pokusy = [14, 15, 16].map((d, i) => nedovolano(local(2026, 10, d, 10, 0), i !== 1));
    const p = planKontaktu(pokusy, local(2026, 10, 16, 10, 5), { pokusuDenne: 1 });
    expect(p.stav).toBe("navrh_zak");
    expect(p.navolaneDny).toBe(3);
    expect(p.splnujeNormu).toBe(true); // 3 pokusy s odstupem 4 h + 2 SMS s odstupem 18 h
  });

  it("1 pokus denně (velký objem): po pokusu je další až příští pracovní den", () => {
    const p = planKontaktu([nedovolano(local(2026, 10, 14, 9, 0))], local(2026, 10, 14, 9, 5), { pokusuDenne: 1 });
    expect(fmtDate(p.dalsiPokus!)).toBe("15.10.2026");
    expect(p.varovani).toEqual([]);
  });

  it("pokusů denně podle objemu práce", () => {
    expect(pokusuDenneDleObjemu(60, 40)).toBe(1);
    expect(pokusuDenneDleObjemu(25, 40)).toBe(2);
  });

  it("upozorní na vynechaný pracovní den", () => {
    const pokusy = [nedovolano(local(2026, 10, 14, 9, 0))];
    const p = planKontaktu(pokusy, local(2026, 10, 16, 9, 0));
    expect(p.varovani.join(" ")).toMatch(/15\.10\.2026/);
  });

  it("dovoláno ukončí řadu", () => {
    const pokusy = [nedovolano(local(2026, 10, 14, 9, 0)), { at: local(2026, 10, 14, 13, 0), dovolano: true, sms: false }];
    expect(planKontaktu(pokusy, local(2026, 10, 14, 13, 5)).stav).toBe("dovolano");
  });

  it("po dovolání začíná nová řada – staré pokusy se nepočítají", () => {
    const pokusy = [
      nedovolano(local(2026, 10, 12, 9, 0)), nedovolano(local(2026, 10, 12, 14, 0)),
      { at: local(2026, 10, 12, 16, 0), dovolano: true, sms: false }, // odklad na přání
      nedovolano(local(2026, 10, 20, 9, 0)),
    ];
    const p = planKontaktu(pokusy, local(2026, 10, 20, 9, 5));
    expect(p.navolaneDny).toBe(1);
    expect(p.denRady).toBe(1);
    expect(p.varovani).toEqual([]);
  });

  it("lhůta ZAK 5 kalendářních dní, urgovat poslední den", () => {
    const zaparkovano = local(2026, 10, 9, 10, 0);
    expect(lhutaZak(zaparkovano, local(2026, 10, 12, 10, 0)).urgovat).toBe(false);
    expect(lhutaZak(zaparkovano, local(2026, 10, 13, 12, 0))).toMatchObject({ urgovat: true, uplynula: false });
    expect(lhutaZak(zaparkovano, local(2026, 10, 14, 12, 0)).uplynula).toBe(true);
  });
});

describe("kódy a marné výjezdy", () => {
  const poznamky = "[Editácia] 1.10.2026 9:00, X (Vegacom): mv_1 zákazník nepřipraven r_1\n… mv_2 r_3 splitter";

  it("najde kódy a počet MV", () => {
    expect(najdiKody(poznamky)).toEqual(["mv_1", "r_1", "mv_2", "r_3"]);
    expect(pocetMv(poznamky)).toBe(2);
    expect(dalsiMv(poznamky)).toBe("mv_3");
    expect(dalsiMv("bez MV")).toBe("mv_1");
  });

  it("parkování po MV podle strany příčiny", () => {
    expect(parkovaniPoMv("tmcz", poznamky)).toMatchObject({ parkovani: PARKOVANI.LEGISLATIVA, kody: ["mv_3", "r_3"] });
    expect(parkovaniPoMv("zakaznik", "")).toMatchObject({ parkovani: PARKOVANI.ODKLAD, kody: ["mv_1"], volitelneKody: ["r_1"] });
  });
});

describe("fráze do MWF", () => {
  it("odpovídají call scriptu", () => {
    expect(fraze.nezvedá(true)).toBe("zkz. nezvedá tlf., sms");
    expect(fraze.odklad("2026-10-20")).toBe("na přání kontaktovat 20.10.2026 r_1");
    expect(fraze.smlouvaJp("2026-11-30")).toBe(
      "zkz. má smlouvu s JP, ověřuje si výpovědní dobu, přeje si kontaktovat 30.11.2026 r_2",
    );
    expect(fraze.instalaceNaPrani("2026-11-05")).toBe("na přání zákazníka instalace dne 05.11.2026 r_1");
    expect(fraze.marnyVyjezd(["mv_1", "r_3"], "nefunkční splitter", "2026-10-20")).toBe(
      "mv_1 r_3 – nefunkční splitter – kontaktovat 20.10.2026",
    );
  });
});
