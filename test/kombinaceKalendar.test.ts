import { describe, expect, it } from "vitest";
import { doplnKombinaci, radekUdalostiKombinace, ZNACKA_KOMBINACE } from "../src/gcal/kombinaceKalendar.js";
import type { Kombinace } from "../src/domain/kombinace.js";

const iptv: Kombinace = { iptv: true, setTopBoxu: 2, mesh: 0, doruceni: { stb: "Technik" }, zdroj: ["export", "pdf"] };
const mesh: Kombinace = { iptv: false, setTopBoxu: 0, mesh: 2, doruceni: { mesh: "Technik" }, zdroj: ["pdf"] };

describe("kombinovaná objednávka → existující událost v kalendáři technika", () => {
  it("doplní FTTH+IPTV do názvu a řádek KOMBINOVANÁ OBJEDNÁVKA na začátek popisu; podruhé beze změny", () => {
    const u = { summary: "Koštál - FTTH TMCZ O-8559472664 Šimůnková, Taťjana", description: "TEL: 445224284\nZÁKAZNÍK: Šimůnková" };
    const n = doplnKombinaci(u, iptv)!;
    expect(n.summary).toBe("Koštál - FTTH+IPTV TMCZ O-8559472664 Šimůnková, Taťjana");
    expect(n.description.split("\n")[0]).toBe(radekUdalostiKombinace(iptv));
    expect(n.description).toContain("2× set-top box");
    expect(n.description).toContain("(přiveze technik)");
    expect(n.description.endsWith("ZÁKAZNÍK: Šimůnková")).toBe(true);
    expect(doplnKombinaci(n, iptv)).toBeNull(); // idempotentní
  });

  it("HTML popis dostane <br>; starší zkratka se nahradí úplnou; změněný počet zařízení přepíše řádek", () => {
    const n = doplnKombinaci({ summary: "Hristov - FTTH+MESH CETIN O-8506009298 Kuncová", description: "<b>TEL:</b> 777" }, { ...mesh, iptv: true, setTopBoxu: 1 })!;
    expect(n.summary).toBe("Hristov - FTTH+IPTV+MESH CETIN O-8506009298 Kuncová");
    expect(n.description).toBe(`${radekUdalostiKombinace({ ...mesh, iptv: true, setTopBoxu: 1 })}<br><b>TEL:</b> 777`);
    const zmena = doplnKombinaci({ summary: "Hristov - FTTH+MESH CETIN O-1", description: `${ZNACKA_KOMBINACE} FTTH + MESH (1) – mesh aktivovat jen z MWF app, ověřit doručení\nTEL: 1` }, mesh)!;
    expect(zmena.description).toBe(`${radekUdalostiKombinace(mesh)}\nTEL: 1`);
    expect(zmena.description).toContain("MESH (2)");
    expect(zmena.description).toContain("jednotky přiveze technik");
  });

  it("název bez FTTH (ruční událost) dostane zkratku na začátek; prázdný popis jen řádek", () => {
    const n = doplnKombinaci({ summary: "Vajc O-1 Novák", description: "" }, mesh)!;
    expect(n.summary).toBe("FTTH+MESH Vajc O-1 Novák");
    expect(n.description).toBe(radekUdalostiKombinace(mesh));
  });
});
