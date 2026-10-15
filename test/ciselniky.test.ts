import { describe, expect, it } from "vitest";
import { exportCsv, nahledImportu, type Polozka } from "../src/config/ciselniky.js";

const regiony: Polozka[] = [
  { kod: "PHA", nazev: "Praha", subregiony: ["CZ_V_PHA_2002"], psc: ["1"] },
  { kod: "PB", nazev: "Příbram", subregiony: [], psc: [] },
];
const technici: Polozka[] = [
  { jmeno: "Vajc", typyAkci: ["Inst_Pristupu_FTTH"], regiony: ["PHA"], vyjezd: "Praha", kalendar: null, nazevVKalendari: null, dovednosti: [], aktivni: true },
  { jmeno: "Lipka", typyAkci: [], regiony: ["PB"], vyjezd: "Příbram", kalendar: null, nazevVKalendari: "Brestanský", dovednosti: [], aktivni: true },
];

describe("import číselníku z CSV", () => {
  it("rozpozná nové, změněné a nezměněné řádky; sloupce v libovolném pořadí", () => {
    const csv = [
      "Regiony;Technik;Výjezd z (adresa);Aktivní",
      "PHA;Vajc;Praha;ano",
      "PB, BE;Lipka;Příbram, Žežická 1;ano",
      "PHA;Novák;Praha-Libeň;",
    ].join("\n");
    const n = nahledImportu("technici", csv, technici, { regiony });
    expect(n.nove.map((p) => p.jmeno)).toEqual(["Novák"]);
    expect(n.zmenene).toHaveLength(1);
    expect(n.zmenene[0]!.sloupce).toEqual(["Regiony", "Výjezd z (adresa)"]);
    expect(n.zmenene[0]!.po.nazevVKalendari).toBe("Brestanský"); // sloupec v CSV chybí → zůstane
    expect(n.bezeZmeny).toBe(1);
    expect(n.nove[0]!.aktivni).toBe(true);
    // BE není v číselníku regionů → jen upozornění, uložit lze
    expect(n.chyby).toEqual([expect.objectContaining({ radek: 3, zavaznost: "upozornění" })]);
    expect(n.lzeUlozit).toBe(true);
  });

  it("chyby: chybí povinný sloupec, špatná hodnota výběru, duplicita", () => {
    const n = nahledImportu("typyAkci", "Typ aktivity v MWF,Skupina,Délka práce (min)\nInst_Pristupu_FTTH,FTTX,90\nInst_Pristupu_FTTH,FTTH,abc", []);
    const zpravy = n.chyby.map((c) => c.zprava).join(" | ");
    expect(zpravy).toMatch(/chybí povinný sloupec „Název v aplikaci“/);
    expect(zpravy).toMatch(/FTTX/);
    expect(zpravy).toMatch(/není číslo/);
    expect(zpravy).toMatch(/duplicitní/);
    expect(n.lzeUlozit).toBe(false);
  });

  it("řádky, které v CSV chybí, jen nahlásí", () => {
    const n = nahledImportu("regiony", "Kód;Region\nPHA;Praha", regiony);
    expect(n.chybiVCsv.map((p) => p.kod)).toEqual(["PB"]);
  });

  it("výběr nezávisí na velikosti písmen a diakritice", () => {
    const n = nahledImportu("koordinatorky", "E-mail;Jméno;Role\na@ictmount.com;Adéla;operatorka", []);
    expect(n.nove[0]!.role).toBe("operátorka");
    expect(n.lzeUlozit).toBe(true);
  });

  it("export a zpětný import dá stejná data", () => {
    const csv = exportCsv("technici", technici);
    expect(csv.startsWith("﻿Technik;Typy akcí;")).toBe(true);
    const n = nahledImportu("technici", csv, technici);
    expect(n.bezeZmeny).toBe(2);
    expect(n.chyby).toEqual([]);
  });
});
