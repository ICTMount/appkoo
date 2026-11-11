import { describe, expect, it } from "vitest";
import { kombinaceZakazky, popisKombinace, zkratkaKombinace } from "../src/domain/kombinace.js";

const P9_FTTH = "All:1|HDD:0/0|bezHDD:0/0|HDDready:0/0|HAG:0|ONT:1|WIFI:0";
const P9_STB = "All:1|HDD:0/0|bezHDD:1/0|HDDready:0/0|HAG:0|ONT:0|WIFI:0";

describe("kombinované objednávky (FTTH + IPTV / MESH)", () => {
  it("FTTH + IPTV z P8 „FTTH Subscription; TVoI“, počet set-top boxů ze skupiny TVoI v P9", () => {
    const k = kombinaceZakazky({ zakladniProdukt: "FTTH Subscription; TVoI", kategorieTt: `${P9_FTTH}; ${P9_STB}` });
    expect(k).toEqual({ iptv: true, setTopBoxu: 1, mesh: 0 });
    expect(popisKombinace(k!)).toBe("FTTH + IPTV (1× set-top box)");
    expect(zkratkaKombinace(k!)).toBe("FTTH+IPTV");
    // dva set-top boxy, jeden s diskem
    expect(kombinaceZakazky({ zakladniProdukt: "FTTH Subscription; TVoI", kategorieTt: `${P9_FTTH}; All:2|HDD:1/0|bezHDD:1/0|HDDready:0/0|HAG:0|ONT:0|WIFI:0` })!.setTopBoxu).toBe(2);
  });

  it("FTTH + MESH z WIFI:n v P9; obojí najednou", () => {
    const mesh = kombinaceZakazky({ zakladniProdukt: "FTTH Subscription", kategorieTt: "All:2|HDD:0/0|bezHDD:0/0|HDDready:0/0|HAG:0|ONT:1|WIFI:1" });
    expect(mesh).toEqual({ iptv: false, setTopBoxu: 0, mesh: 1 });
    expect(popisKombinace(mesh!)).toBe("FTTH + MESH (1)");
    const oboje = kombinaceZakazky({ zakladniProdukt: "FTTH Subscription; TVoI", kategorieTt: `All:3|HDD:0/0|bezHDD:0/0|HDDready:0/0|HAG:0|ONT:1|WIFI:2; ${P9_STB}` });
    expect(oboje).toEqual({ iptv: true, setTopBoxu: 1, mesh: 2 });
    expect(popisKombinace(oboje!)).toBe("FTTH + IPTV (1× set-top box) + MESH (2)");
    expect(zkratkaKombinace(oboje!)).toBe("FTTH+IPTV+MESH");
  });

  it("běžná FTTH není kombinace; bez P8 pozná IPTV ze sloupce Produkt „TV(ADD)“", () => {
    expect(kombinaceZakazky({ zakladniProdukt: "FTTH Subscription", kategorieTt: P9_FTTH, produkt: "INTERNET_CHANNEL(ADD)" })).toBeNull();
    expect(kombinaceZakazky({ zakladniProdukt: "OPTIC:INT", kategorieTt: "" })).toBeNull();
    expect(kombinaceZakazky({})).toBeNull();
    expect(kombinaceZakazky({ produkt: "INTERNET_CHANNEL(ADD), TV(ADD)" })).toEqual({ iptv: true, setTopBoxu: 0, mesh: 0 });
    expect(popisKombinace(kombinaceZakazky({ produkt: "TV(ADD), INTERNET_CHANNEL(ADD)" })!)).toBe("FTTH + IPTV");
  });
});
