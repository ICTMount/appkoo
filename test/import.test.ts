import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { pseudonymizuj } from "../src/ai/pseudonym.js";
import { planKontaktu } from "../src/domain/contact.js";
import { fmtDate, fmtTime, local } from "../src/domain/time.js";
import { parseCsv } from "../src/import/csv.js";
import { importExport, parseDoSplneni, parseTermin } from "../src/import/mwfExport.js";
import { pokusyZPoznamky, rozlozPoznamku } from "../src/import/notes.js";

// Syntetická data se skutečnými názvy sloupců MWF exportu (žádné reálné osobní údaje)
const HLAVICKA = [
  "", "ID aktivity", "ID objednávky", "ID obj. v ext. systéme", "ID S7 obj.  ", "Pracovný zdroj", "Stav",
  "Typ aktivity", "Zákazník", "Kontakt", "Psč", "Adresa", "Subregión", "P3: Typ balíka", "Čas postúpenia dod.",
  "Dohodnutý termín", "Poznámka", "Dôvod parkovania", "Posledný dôvod parkovania", "P17: Vlastník siete",
  "Výsledok dojednávania", "Preferovaný dátum", "Do splnění", "Dátum RFS", "Produkt",
];

const POZNAMKA_1 = [
  "PP ID:12345678 .",
  "[Dojednávania] 13.10.2026 9:05, Adéla Pastorová (Vegacom): zkz. nezvedá tlf., sms",
  "[Editácia] 13.10.2026 13:20, Adéla Pastorová (Vegacom): zkz. nezvedá tlf.",
  "[Editácia] 14.10.2026 9:01, Adéla Pastorová (Vegacom): nezvedá tel., sms, volat 777 123 456",
].join("\n");

const POZNAMKA_2 = [
  "[Dojednávania] 8.10.2026 10:00, Ludmila Havlíčková (Vegacom): mv_1 nepřipravená trasa, kontaktovat 12.10.2026",
  "[Parkovanie] 9.10.2026 11:00, Ludmila Havlíčková (Vegacom): zkz. opakovaně nedovoláno",
  "[Editácia] 12.10.2026 8:57, Renata Kohoutková: předáno k prověření.",
].join("\n");

const radek = (o: Record<string, string>) => HLAVICKA.map((h) => o[h.trim()] ?? "");
const csvPole = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function export_(radky: Record<string, string>[]): Buffer {
  const text = [HLAVICKA, ...radky.map(radek)].map((r) => r.map(csvPole).join(";")).join("\r\n");
  return iconv.encode(text, "win1250");
}

const BUF = export_([
  {
    "ID aktivity": "A1", "ID objednávky": "22000001", "ID obj. v ext. systéme": "O-1111111111", "ID S7 obj.": "1-AAA111", "Pracovný zdroj": "Adéla Pastorová (Vegacom)",
    Stav: "Riešená dodávateľom - akceptovaná", "Typ aktivity": "CETIN_Inst_Pristupu_FTTH", Zákazník: "Nováková, Jana",
    Kontakt: "Kontakty: 777123456; ", Psč: "150 00", Adresa: "Testovací 1, Praha", "P17: Vlastník siete": "CETIN",
    "Čas postúpenia dod.": "12.10.2026 15:59:44", Poznámka: POZNAMKA_1, "Výsledok dojednávania": "Nezastihnutý",
    "Do splnění": "-1t,2d,3h,4m",
  },
  {
    "ID aktivity": "A2", "ID objednávky": "22000002", "ID obj. v ext. systéme": "O-2222222222:1", Stav: "Zaparkovaná", "Typ aktivity": "Inst_Pristupu_FTTH",
    Zákazník: "Dvořák Petr", "P17: Vlastník siete": "TMCZ", Poznámka: POZNAMKA_2,
    "Dôvod parkovania": "Zákazník - nedostupný", "Výsledok dojednávania": "Márny výjazd",
  },
  {
    "ID aktivity": "A3", "ID objednávky": "22000003", "ID obj. v ext. systéme": "O-3333333333", Stav: "Riešená dodávateľom - akceptovaná",
    "Typ aktivity": "VDF_Inst_Pristupu_FTTH", "Dohodnutý termín": "11:00 / 12:59",
    "Dôvod parkovania": "Zákazník - termín - rieši BO",
  },
]);

const EXPORT_AT = local(2026, 10, 14, 18, 1);

describe("CSV", () => {
  it("zvládne uvozovky, zdvojené uvozovky a konce řádků v poli", () => {
    expect(parseCsv('a;"b ""x""\nc";d\r\n1;2;3')).toEqual([["a", 'b "x"\nc', "d"], ["1", "2", "3"]]);
  });
});

describe("import MWF exportu", () => {
  const { zakazky, chybejiciSloupce } = importExport(BUF, EXPORT_AT);
  const [z1, z2, z3] = zakazky;

  it("načte windows-1250 a všechny sloupce", () => {
    expect(chybejiciSloupce).toEqual([]);
    expect(zakazky).toHaveLength(3);
    expect(z1!.zakaznik).toBe("Nováková, Jana");
    expect(z1!.idS7).toBe("1-AAA111");
    expect(z1!.idObjednavky).toBe("O-1111111111");
    expect(z1!.idObjednavkyMwf).toBe("22000001");
    expect(z1!.psc).toBe("15000");
    expect(z1!.telefony).toEqual(["777123456"]);
    expect(z1!.infrastruktura).toBe("CETIN");
    expect(z3!.infrastruktura).toBe("VDF");
    expect(z1!.doSplneniMin).toBe(-(7 * 24 * 60 + 2 * 24 * 60 + 3 * 60 + 4));
  });

  it("rozpozná parkování, skupinu a nestandardní parkování", () => {
    expect(z2!.idObjednavky).toBe("O-2222222222:1");
    expect(z2!.idObjednavkyZaklad).toBe("O-2222222222");
    expect(z2!.parkovani).toBe("Zákazník - nedostupný");
    expect(z2!.parkovaniSkupina).toBe("ZAK");
    expect(z2!.vysledek).toBe("Márny výjazd");
    expect(z2!.pocetMv).toBe(1);
    expect(z3!.parkovani).toBeNull();
    expect(z3!.parkovaniNestandardni).toBe("Zákazník - termín - rieši BO");
  });

  it("termín bez data = den exportu", () => {
    expect(fmtDate(z3!.termin!.od)).toBe("14.10.2026");
    expect(fmtTime(z3!.termin!.do)).toBe("12:59");
    expect(parseTermin("15.10.2026 08:00 / 15.10.2026 08:59", "2026-10-14")!.od).toEqual(local(2026, 10, 15, 8, 0));
  });

  it("rozloží poznámku na záznamy a odvodí pokusy o kontakt", () => {
    const { uvod, zaznamy } = rozlozPoznamku(POZNAMKA_1);
    expect(uvod).toBe("PP ID:12345678 .");
    expect(zaznamy).toHaveLength(3);
    expect(zaznamy[0]).toMatchObject({ typ: "Dojednávania", autor: "Adéla Pastorová (Vegacom)", vegacom: true });

    const pokusy = pokusyZPoznamky(z1!.zaznamy);
    expect(pokusy.map((p) => p.sms)).toEqual([true, false, true]);
    const plan = planKontaktu(pokusy, EXPORT_AT);
    expect(plan.navolaneDny).toBe(2);
    expect(plan.denRady).toBe(2);
  });

  it("souhrnný zápis při parkování ZAK není další pokus", () => {
    const { zaznamy } = rozlozPoznamku(
      "[Parkovanie] 10.10.2026 10:00, A (Vegacom): x\n[Editácia] 10.10.2026 10:01, A (Vegacom): zkz. nedostupný, kontaktován dle pravidel 3 prac. dny, 6× tlf. – prosíme o součinnost PEP",
    );
    expect(pokusyZPoznamky(zaznamy)).toEqual([]);
  });

  it("zápis PEP nuluje počítadlo pokusů", () => {
    expect(pokusyZPoznamky(z2!.zaznamy)).toEqual([]);
  });

  it("parseDoSplneni", () => {
    expect(parseDoSplneni("5h,58m")).toBe(358);
    expect(parseDoSplneni("")).toBeNull();
  });
});

describe("pseudonymizace", () => {
  it("odstraní jméno (i s diakritikou) a telefony, ID objednávky nechá", () => {
    const p = pseudonymizuj("Zákazník: Nováková, Jana – volat 777 123 456 nebo +420777999888, obj. O-123456789", "Nováková, Jana");
    expect(p.text).not.toMatch(/Nováková|Jana|777/);
    expect(p.text).toContain("O-123456789");
    expect(p.text).toContain("[ZÁKAZNÍK]");
    expect(p.obnov("zavolat na [TEL_2]")).toBe("zavolat na +420777999888");
  });
});
