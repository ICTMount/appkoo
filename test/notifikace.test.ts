import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsujKz, parsujNotifikaci, parsujOddily, parsujZariadenia } from "../src/ingest/notifikace.js";
import { kVytvoreni, parsujPriebeh, radekPriebehu, textBunky } from "../src/ingest/priebeh.js";

// Výřez textu notifikačního PDF (pdftotext -layout) pro O-8555864483_22243701#1-DDWX4YA
const TEXT = `                                                  CZ_CETIN_Instalace přístupu FTTH
Rezervačná                                                                    Termín:                24.10.2026 16:18 - 02.11.2026 00:00

ID objednávky/TT:          1-DDWV6LB                                          Dátum realizácie:      30.10.2026 08:35

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

                            ONT - Optical                                                                           Sagemcom
                     Add               4FE 2FX                   Technik      Rent                       Route
                              Network                                                                               5670
                             Terminal
`;

// Dva oddíly „Zoznam KZ“ z notifikace 1-CR59111 (CETIN, mesh) a z TVoI objednávky (set-top boxy); druhý oddíl je na nové stránce (\f)
const TEXT_KZ = `Zoznam KZ:
  Spôsob inštalácie    Technik
                                                               Sériove čislo    Sposob                                                       Zoznam
       Model          Aktivita       Typ          Subtyp                                      Vlastníctvo    Mac adresa     CPE Mode
                                                                    KZ         doručenia                                                  kompatibilných
                                                                                                                                            zariadení
                                 AP - Access                                                                                                Sercomm
                       Add                         Mesh                         Technik          Rent
                                    Point                                                                                                  RP562BDT
                                 AP - Access                                                                                                Sercomm
                       Add                         Mesh                         Technik          Rent
                                    Point                                                                                                  RP562BDT
                                 ONT - Optical                                                                                             Sagemcom
                       Add                        4FE 2FX                       Technik          Rent                         Route
                                   Network                                                                                                    5670
                                  Terminal
\fPracovní požadavek:                26843733
Zoznam KZ:
                                                         Sériove čislo    Sposob                                      Zoznam
       Model       Aktivita        Typ          Subtyp                                  Vlastníctvo   Mac adresa
                                                              KZ         doručenia                                 kompatibilných
                                                                                                                     zariadení
                              TVoI - Set-top-                                                                          KAON
                    ADD                          LAN                     Technik           Rent
                                   box                                                                              KSTB6077 |
                                                                                                                   Skyworth STB-
                                                                                                                      HY4403
                              TVoI - Set-top-                                                                          KAON
                    ADD                          LAN                     Technik           Rent
                                   box                                                                              KSTB6077 |
                                                                                                                   Skyworth STB-
                                                                                                                      HY4403
Pracovní požadavek:                26843734
`;

describe("notifikační PDF z MWF", () => {
  it("vytáhne ID, instalační předpis a ze Zoznamu KZ jen CPE Mode a kompatibilní zařízení", () => {
    const n = parsujNotifikaci(TEXT, "19846155.pdf")!;
    expect(n.idAktivity).toBe("19846155");
    expect(n.idObjednavky).toBe("O-8555864483_22243701#1-DDWX4YA");
    expect(n.idObjednavkyZaklad).toBe("O-8555864483");
    expect(n.idS7).toEqual(["1-DDWV6LB", "1-DDWX4YA"]);
    expect(n.predpis[0]).toBe("Inštalačný Predpis ACCESS(Ethernet Bearer) Pridaj : Vlastnosti uzla Inštalácia prístupu potrebná : Y");
    expect(n.predpis).toContain("Kód partnera : CETIN");
    expect(n.predpis).toContain("5. Číslo bytu: 7");
    expect(n.predpis.at(-1)).toBe("8. Dodatečné požadavky na instalaci: null"); // „Zoznam KZ:“ ze stejného řádku nepatří do předpisu
    expect(n.predpis.some((r) => /Zoznam KZ/.test(r))).toBe(false);
    expect(n.predpis.some((r) => /Názov OLT/.test(r))).toBe(false); // konec předchozího oddílu na řádku nadpisu
    expect(n.cpeMode).toBe("Route");
    expect(n.zoznam).toBe("Sagemcom 5670");
  });

  it("Zoznam KZ → zařízení: ONT, mesh AP (6 řádků, centrované buňky přes 3 řádky), set-top boxy ve druhém oddílu", () => {
    expect(parsujNotifikaci(TEXT, "19846155.pdf")!.zariadenia).toEqual([{ typ: "ONT - Optical Network Terminal", subtyp: "4FE 2FX", aktivita: "Add", doruceni: "Technik", model: "Sagemcom 5670", druh: "ont" }]);
    const z = parsujZariadenia(TEXT_KZ.split("\n"));
    expect(z.map((x) => x.druh)).toEqual(["mesh", "mesh", "ont", "stb", "stb"]);
    expect(z[0]).toEqual({ typ: "AP - Access Point", subtyp: "Mesh", aktivita: "Add", doruceni: "Technik", model: "Sercomm RP562BDT", druh: "mesh" });
    expect(z[2]!.typ).toBe("ONT - Optical Network Terminal");
    expect(z[3]).toMatchObject({ typ: "TVoI - Set-top-box", subtyp: "LAN", aktivita: "ADD", doruceni: "Technik", model: "KAON KSTB6077 | Skyworth STB- HY4403" });
  });

  it("oddíly po pracovních požadavcích: FTTH je nadřazená (její předpis = předpis zakázky), IPTV má vlastní předpis a účet; bez požadavků jeden oddíl", () => {
    const text = `Pracovní požadavek:                 26843734
ID objednávky:                      10692184
                                            optic/SERVICE(Account)Pridaj, CPE(TVoI - Set-top-box)Pridaj
Metóda/popis inst                           INVENTORY(CPEMAN GPON)Pridaj
Inštalačný predpis k
  Kód partnera : TMCZ
  Poznámka:
Zoznam KZ:
\fPracovní požadavek:                26843733
                                           tvoi/SERVICE(Account)Pridaj, SERVICE(TVoI)Pridaj
Metóda/popis inst                          INVENTORY(CPEMAN GPON)Pridaj
Zriaďovaná služba:
  Zriaďovaná služba Element neobsahuje žiadne dáta Zoznam CFS parametrov Id účtu : TV144316498
  Heslo : tajne1
  Typ technológie : TVoI
  Názov : M TMCZ
Inštalačný predpis k
  STB zapojit k TV
Zoznam KZ:
`;
    const o = parsujOddily(text.split("\n"));
    expect(o).toEqual([
      { pozadavek: "26843734", sluzba: "FTTH", predpis: ["Kód partnera : TMCZ", "Poznámka:"] },
      { pozadavek: "26843733", sluzba: "IPTV", predpis: ["STB zapojit k TV"], tv: { ucet: "TV144316498", balicek: "M TMCZ" } },
    ]);
    expect(JSON.stringify(o)).not.toContain("tajne1"); // heslo se nepřenáší
    const n = parsujNotifikaci(`MWF ID aktivity: 1\n${text}`, "1.pdf")!;
    expect(n.predpis).toEqual(["Kód partnera : TMCZ", "Poznámka:"]); // předpis zakázky = FTTH
    expect(parsujNotifikaci(TEXT, "19846155.pdf")!.oddily).toEqual([{ pozadavek: "", sluzba: "FTTH", predpis: parsujNotifikaci(TEXT, "19846155.pdf")!.predpis }]);
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

  it("Priebeh optický: sloupce podle záhlaví, řádky podle Z akcia, zalomená slova se spojí", () => {
    const r = parsujPriebeh(readFileSync("test/fixtures/priebeh-bbox.html", "utf8"));
    expect(r).toEqual([{ nazovLinky: "ZAMB/CTN/CETIN/CZE-ZAMB/CTN/CETIN/CZEXGSPON 4", aUzol: "ZAMB1 X-31", akciaNaLinke: "Ponechať", zAkcia: "Ponechať", typLinky: "Relation" }]);
    expect(radekPriebehu({ nazovLinky: "SPP:000325:PH:1.3.32-ODF:0795:PH:32", aUzol: "SPP:000325:PH:Anežky Malé 11", akciaNaLinke: "NEW", zAkcia: "Vytvoriť", typLinky: "Patchcord" })).toBe(
      "SPP:000325:PH:1.3.32-ODF:0795:PH:32 / SPP:000325:PH:Anežky Malé 11 / NEW / Vytvoriť / Patchcord",
    );
    expect(kVytvoreni(r)).toEqual([]);
    expect(kVytvoreni([{ nazovLinky: "L", aUzol: "SPP:000221:PH:Steinerova 1", zAkcia: "Vytvor iť" }]).length).toBe(1);
    expect(kVytvoreni([{ nazovLinky: "L", aUzol: "X", akciaNaLinke: "NEW", zAkcia: "Vytvoriť" }, { nazovLinky: "M", aUzol: "Y", akciaNaLinke: "EXIST", zAkcia: "Ponechať" }]).map((r) => r.nazovLinky)).toEqual(["L"]);
  });

  it("textBunky: mezera jen mezi písmenem a číslicí nebo malým a velkým písmenem", () => {
    const w = (text: string, y: number) => ({ text, x: 10, y, yMin: y - 4, yMax: y + 4, xMin: 5, xMax: 15 });
    expect(textBunky([w("SPP:00", 10), w("0221:P", 20), w("H:Stein", 30), w("erova", 40), w("1", 50)])).toBe("SPP:000221:PH:Steinerova 1");
    expect(textBunky([w("Ponech", 10), w("ať", 20)])).toBe("Ponechať");
  });
});
