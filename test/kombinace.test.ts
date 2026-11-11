import { describe, expect, it } from "vitest";
import { kombinaceZakazky, popisKombinace, privezeTechnik, zkratkaKombinace } from "../src/domain/kombinace.js";

const P9_FTTH = "All:1|HDD:0/0|bezHDD:0/0|HDDready:0/0|HAG:0|ONT:1|WIFI:0";
const P9_STB = "All:1|HDD:0/0|bezHDD:1/0|HDDready:0/0|HAG:0|ONT:0|WIFI:0";

describe("kombinované objednávky (FTTH + IPTV / MESH)", () => {
  it("FTTH + IPTV z P8 „FTTH Subscription; TVoI“, počet set-top boxů ze skupiny TVoI v P9", () => {
    const k = kombinaceZakazky({ zakladniProdukt: "FTTH Subscription; TVoI", kategorieTt: `${P9_FTTH}; ${P9_STB}` });
    expect(k).toMatchObject({ iptv: true, setTopBoxu: 1, mesh: 0, zdroj: ["export"] });
    expect(popisKombinace(k!)).toBe("FTTH + IPTV (1× set-top box)");
    expect(zkratkaKombinace(k!)).toBe("FTTH+IPTV");
    // dva set-top boxy, jeden s diskem
    expect(kombinaceZakazky({ zakladniProdukt: "FTTH Subscription; TVoI", kategorieTt: `${P9_FTTH}; All:2|HDD:1/0|bezHDD:1/0|HDDready:0/0|HAG:0|ONT:0|WIFI:0` })!.setTopBoxu).toBe(2);
  });

  it("FTTH + MESH z WIFI:n v P9; obojí najednou", () => {
    const mesh = kombinaceZakazky({ zakladniProdukt: "FTTH Subscription", kategorieTt: "All:2|HDD:0/0|bezHDD:0/0|HDDready:0/0|HAG:0|ONT:1|WIFI:1" });
    expect(mesh).toMatchObject({ iptv: false, setTopBoxu: 0, mesh: 1 });
    expect(popisKombinace(mesh!)).toBe("FTTH + MESH (1)");
    const oboje = kombinaceZakazky({ zakladniProdukt: "FTTH Subscription; TVoI", kategorieTt: `All:3|HDD:0/0|bezHDD:0/0|HDDready:0/0|HAG:0|ONT:1|WIFI:2; ${P9_STB}` });
    expect(oboje).toMatchObject({ iptv: true, setTopBoxu: 1, mesh: 2 });
    expect(popisKombinace(oboje!)).toBe("FTTH + IPTV (1× set-top box) + MESH (2)");
    expect(zkratkaKombinace(oboje!)).toBe("FTTH+IPTV+MESH");
  });

  it("běžná FTTH není kombinace; bez P8 pozná IPTV ze sloupce Produkt „TV(ADD)“", () => {
    expect(kombinaceZakazky({ zakladniProdukt: "FTTH Subscription", kategorieTt: P9_FTTH, produkt: "INTERNET_CHANNEL(ADD)" })).toBeNull();
    expect(kombinaceZakazky({ zakladniProdukt: "OPTIC:INT", kategorieTt: "" })).toBeNull();
    expect(kombinaceZakazky({})).toBeNull();
    expect(kombinaceZakazky({ produkt: "INTERNET_CHANNEL(ADD), TV(ADD)" })).toMatchObject({ iptv: true, setTopBoxu: 0, mesh: 0 });
    expect(popisKombinace(kombinaceZakazky({ produkt: "TV(ADD), INTERNET_CHANNEL(ADD)" })!)).toBe("FTTH + IPTV");
  });

  it("z notifikačního PDF (Zoznam KZ): mesh AP i set-top boxy, počet AP z předpisu, doručení Technik; export to doplní", () => {
    const ap = { druh: "mesh", aktivita: "Add", doruceni: "Technik" };
    const pdf = { zariadenia: [ap, ap, ap, ap, ap, ap, { druh: "ont", aktivita: "Add", doruceni: "Technik" }], predpis: ["Kód partnera : CETIN", "Wi-Fi pokrytie: Predpokladaný počet AP : 2"] };
    // 1-CR59111: CETIN export mesh nenese, v PDF je 6 (zdvojených) řádků AP, předpis říká 2
    const k = kombinaceZakazky({ zakladniProdukt: "FTTH Subscription", kategorieTt: P9_FTTH }, pdf)!;
    expect(k).toMatchObject({ iptv: false, setTopBoxu: 0, mesh: 2, doruceni: { mesh: "Technik" }, zdroj: ["pdf"] });
    expect(privezeTechnik(k.doruceni.mesh)).toBe(true);
    expect(privezeTechnik(k.doruceni.stb)).toBeNull();
    // bez předpisu platí počet řádků
    expect(kombinaceZakazky({}, { zariadenia: [ap, ap] })!.mesh).toBe(2);
    // set-top boxy z PDF + export: větší z obou počtů, zdroj obojí
    const stb = { druh: "stb", aktivita: "ADD", doruceni: "Technik" };
    const k2 = kombinaceZakazky({ zakladniProdukt: "FTTH Subscription; TVoI", kategorieTt: `${P9_FTTH}; ${P9_STB}` }, { zariadenia: [{ druh: "ont", aktivita: "ADD", doruceni: "Technik" }, stb, stb] })!;
    expect(k2).toMatchObject({ iptv: true, setTopBoxu: 2, mesh: 0, doruceni: { stb: "Technik" }, zdroj: ["export", "pdf"] });
    // odebíraná zařízení (Delete) se nepočítají; jen ONT = žádná kombinace
    expect(kombinaceZakazky({}, { zariadenia: [{ druh: "ont", aktivita: "Add", doruceni: "Technik" }, { druh: "stb", aktivita: "Delete", doruceni: "" }] })).toBeNull();
    expect(kombinaceZakazky({}, { zariadenia: null })).toBeNull();
  });
});
