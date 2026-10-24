import { describe, expect, it } from "vitest";
import { parsujKz, parsujNotifikaci } from "../src/ingest/notifikace.js";

// Výřez textu notifikačního PDF (pdftotext -layout) pro O-8555864483_22243701#1-DDWX4YA
const TEXT = `                                                  CZ_CETIN_Instalace přístupu FTTH
Rezervačná                                                                    Termín:                24.10.2026 16:18 - 02.11.2026 00:00

Identifikátor:             O-8555864483_22243701#1-DDWX4YA

MWF ID objednávky:         22243701                                           MWF ID aktivity:       19846155

Priebeh partnera:
  Názov boxu:         -

  Názov OLT:          -                 Splitter:   -       Farba portu:   -     Číslo portu:   -        Inštalačný predpis k
  Inštalačný Predpis ACCESS(Ethernet Bearer) Pridaj : Vlastnosti uzla Inštalácia prístupu potrebná : Y
  Kód partnera : CETIN
  Lokalita.kontaktný email : Dvorak.zbk@gmail.com
  Lokalita.kontaktný telefón : 602 288 359
  Označenie zásuvky požadované : Y
  Rozšírený čas inštalácie : 0
  Spôsob realizácie vnútorných rozvodov : Lišta bez omezení
  Typ inštalačného prepojenie : Near Door Terminal
  Typ smerovania : Virtual
  Ukončenie zapojenia : Fiber in House
  Poznámka:
  Poznámka Poznámka : ...
  1. Typ objektu: Bytový dům
  2. Vlastnictví: Prostor v nájmu
  3. Stav objektu (Souhlasíte s případným vrtáním?): Běžný stav
  4. Číslo patra: 0
  5. Číslo bytu: 7
  6. Má byt vybudovanou optickou zásuvku s QR kódem a zeleným konektorem zespodu?: Nejsem si jistý
  7. Preferované umístění zásuvky: Vstupní chodba
  8. Dodatečné požadavky na instalaci: null                                                   Zoznam KZ:
  Spôsob inštalácie   Technik
  Model            Aktivita   Typ       Subtyp   Sériove čislo   Sposob       Vlastníctvo   Mac adresa   CPE Mode   Zoznam
                                                 KZ              doručenia                                          kompatibilných
                                                                                                                    zariadení

  ONT - Optical    Add        4FE 2FX                            Technik      Rent                       Route      Sagemcom
  Network                                                                                                           5670
  Terminal
`;

describe("notifikační PDF z MWF", () => {
  it("vytáhne ID, instalační předpis a ze Zoznamu KZ jen CPE Mode a kompatibilní zařízení", () => {
    const n = parsujNotifikaci(TEXT, "19846155.pdf")!;
    expect(n.idAktivity).toBe("19846155");
    expect(n.idObjednavky).toBe("O-8555864483_22243701#1-DDWX4YA");
    expect(n.predpis[0]).toBe("Inštalačný Predpis ACCESS(Ethernet Bearer) Pridaj : Vlastnosti uzla Inštalácia prístupu potrebná : Y");
    expect(n.predpis).toContain("Kód partnera : CETIN");
    expect(n.predpis).toContain("5. Číslo bytu: 7");
    expect(n.predpis.at(-1)).toBe("8. Dodatečné požadavky na instalaci: null"); // „Zoznam KZ:“ ze stejného řádku nepatří do předpisu
    expect(n.predpis.some((r) => /Zoznam KZ/.test(r))).toBe(false);
    expect(n.predpis.some((r) => /Názov OLT/.test(r))).toBe(false); // konec předchozího oddílu na řádku nadpisu
    expect(n.cpeMode).toBe("Route");
    expect(n.zoznam).toBe("Sagemcom 5670");
  });

  it("ID aktivity vezme z názvu souboru, když v textu chybí", () => {
    expect(parsujNotifikaci("nic", "19846609.pdf")?.idAktivity).toBe("19846609");
    expect(parsujNotifikaci("nic", "export.pdf")).toBeNull();
  });

  it("KZ bez sloupců (slitý text): režim je známé slovo, zařízení za ním", () => {
    const r = parsujKz(["Model Aktivita Typ Subtyp Sériove čislo KZ Sposob doručenia Vlastníctvo Mac adresa CPE Mode kompatibilných Zoznam zariadení Add ONT - Optical Network Terminal 4FE 2FX Technik Rent Bridge Sagemcom 5670"]);
    expect(r).toEqual({ cpeMode: "Bridge", zoznam: "Sagemcom 5670" });
    expect(parsujKz([])).toEqual({ cpeMode: null, zoznam: null });
  });

  it("predpis chybí → prázdný seznam, KZ neuvedeno", () => {
    const n = parsujNotifikaci("MWF ID aktivity: 1\nIdentifikátor: O-1_2#3\n", "1.pdf")!;
    expect(n.predpis).toEqual([]);
    expect(n.cpeMode).toBeNull();
  });
});
