import { describe, expect, it } from "vitest";
import { barvaTextu, barvaUdalosti, castAdresy, miniMesic, pondeli, radkyDetailu, rozsahMrizky, sestavMrizku, strankaMrizky, type TechnikMrizky, type VolbyMrizky } from "../src/web/mrizka.js";
import type { UdalostMrizky } from "../src/zdroje/sync.js";

const T: TechnikMrizky[] = [
  { jmeno: "Tomáš Vajc", nazevVKalendari: "Vajc", kalendar: "K1", vyjezd: "Praha 4, Krč" },
  { jmeno: "Anton Hristov", nazevVKalendari: "Hristov", kalendar: "K2" },
];
const u = (kalendar: string, den: string, od: string, do_: string, summary: string, o: Partial<UdalostMrizky> = {}): UdalostMrizky => ({
  kalendar, id: `${kalendar}-${den}-${od}`, summary, location: "", description: "", od: new Date(`${den}T${od}:00Z`), do: new Date(`${den}T${do_}:00Z`), barvaId: null, kalendarBarva: "#3f51b5", odkaz: "https://cal/x", ...o,
});
const UD: UdalostMrizky[] = [
  u("K1", "2026-11-16", "08:00", "10:00", "Vajc - FTTH O-8559960553 Eckhardt SLA 20.11.2026 13:39 (ST)", { location: " Bellušova 1827 / 53, Praha 13 Stodůlky", description: "TEL: 605227589\nČASOVÉ MOŽNOSTI: pevný termín\n\nINSTALAČNÍ PŘEDPIS\nVlastnosti uzla" }),
  u("K1", "2026-11-16", "10:00", "12:00", "Vajc - VOLNY", { barvaId: "10", description: "šablona\n[SHEET2CAL] K1" }),
  u("K1", "2026-11-16", "12:00", "13:30", "Vajc - VOLNY", { barvaId: "10" }),
  u("K2", "2026-11-16", "08:00", "18:00", "Hristov - NEPLANOVAT", { kalendarBarva: "#f6bf26" }),
  u("K2", "2026-11-18", "18:00", "21:30", "Hristov - MESCH O-8552317579 Novák", { kalendarBarva: "#8e24aa" }),
];
const volby = (o: Partial<VolbyMrizky> = {}): VolbyMrizky => ({ pohled: "den", den: "2026-11-16", vybrani: [], jenVolny: false, ...o });

describe("mřížka kalendáře (zrcadlo Google Kalendáře)", () => {
  it("den: sloupec na technika, bloky podle skutečných časů, barvy ze zdroje", () => {
    const m = sestavMrizku(UD, T, volby());
    expect(m.sloupce.map((s) => s.nadpis)).toEqual(["Vajc", "Hristov"]);
    expect(m.hodiny[0]).toBe(8);
    expect(m.hodiny.length).toBe(13); // 8–21
    const [zak, v1, v2] = m.sloupce[0]!.pod[0]!.bloky;
    expect(zak).toMatchObject({ volny: false, bg: "#3f51b5", fg: "#fff", oid: "O-8559960553", cas: "8:00 – 10:00", ulice: "Bellušova 1827 / 53", cast: "Praha 13 Stodůlky" });
    expect(zak!.top).toBeCloseTo(0);
    expect(zak!.vyska).toBeCloseTo((2 / 13) * 100);
    expect(zak!.detail).toEqual(["TEL: 605227589", "ČASOVÉ MOŽNOSTI: pevný termín"]); // bez instalačního předpisu
    expect(v1).toMatchObject({ volny: true, bg: "#0b8043", nazev: "Vajc - VOLNY" });
    expect(v2!.vyska).toBeCloseTo((1.5 / 13) * 100); // 12:00–13:30 – délka podle kalendáře
    // NEPLANOVAT má barvu kalendáře technika; na světlé barvě tmavý text
    expect(m.sloupce[1]!.pod[0]!.bloky[0]).toMatchObject({ volny: false, bg: "#f6bf26", fg: "#1f1f1f", nazev: "Hristov - NEPLANOVAT" });
  });

  it("týden: 7 dní, v každém vybraní technici vedle sebe; rozsah dne se roztáhne podle událostí; hustý režim zkracuje názvy", () => {
    const m = sestavMrizku(UD, T, volby({ pohled: "tyden", den: "2026-11-18" }));
    expect(m.sloupce.map((s) => s.nadpis)).toEqual(["Po 16.11.", "Út 17.11.", "St 18.11.", "Čt 19.11.", "Pá 20.11.", "So 21.11.", "Ne 22.11."]);
    expect(m.sloupce[0]!.pod.map((p) => p.stitek)).toEqual(["Vajc", "Hristov"]);
    expect(m.podsloupcu).toBe(14);
    expect(m.husta).toBe(true);
    expect(m.hodiny.at(-1)).toBe(21); // 8–22 kvůli události do 21:30
    expect(m.sloupce[0]!.pod[0]!.bloky[0]!.nazev).toBe("FTTH O-8559960553 Eckhardt"); // bez jména technika a SLA
    expect(m.sloupce[0]!.pod[0]!.bloky[0]).toMatchObject({ ulice: "", cast: "Praha 13 Stodůlky" });
    expect(m.sloupce[0]!.pod[0]!.bloky[0]!.plnyNazev).toContain("SLA 20.11.2026"); // detail má vše
    expect(m.sloupce[0]!.pod[0]!.bloky[1]!.nazev).toBe("Vajc - VOLNY"); // VOLNY se nezkracuje ani v hustém režimu
    expect(pondeli("2026-11-22")).toBe("2026-11-16");
    expect(rozsahMrizky({ pohled: "tyden", den: "2026-11-18" }).dny.length).toBe(7);
  });

  it("jen VOLNY: zůstanou jen volné sloty, technici bez volna zmizí; výběr techniků", () => {
    const d = sestavMrizku(UD, T, volby({ jenVolny: true }));
    expect(d.sloupce.map((s) => s.nadpis)).toEqual(["Vajc"]);
    expect(d.sloupce[0]!.pod[0]!.bloky.map((b) => [b.nazev, b.cas])).toEqual([["Vajc - VOLNY", "10:00 – 12:00"], ["Vajc - VOLNY", "12:00 – 13:30"]]); // v hlavičce vždy „technik - VOLNY“
    const t = sestavMrizku(UD, T, volby({ pohled: "tyden", jenVolny: true }));
    expect(t.sloupce.map((s) => s.pod.length)).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(sestavMrizku(UD, T, volby({ vybrani: ["Anton Hristov"] })).sloupce.map((s) => s.nadpis)).toEqual(["Hristov"]);
  });

  it("barvy a detail", () => {
    expect(barvaUdalosti({ barvaId: "10", kalendarBarva: "#123456" })).toBe("#0b8043");
    expect(barvaUdalosti({ barvaId: null, kalendarBarva: "#123456" })).toBe("#123456");
    expect(barvaUdalosti({ barvaId: null, kalendarBarva: "javascript:x" })).toBe("#1967d2");
    expect(barvaTextu("#0b8043")).toBe("#fff");
    expect(barvaTextu("#f6bf26")).toBe("#1f1f1f");
    expect(radkyDetailu("TEL: 1<br>patro 3\n\n[SHEET2CAL] x\nINSTALAČNÍ PŘEDPIS\ndlouhý text")).toEqual(["TEL: 1", "patro 3"]);
  });

  it("stránka: formulář výběru, odkazy den/týden a na zakázku, žádný skript, escapování", () => {
    const v = volby({ zakazka: { idAktivity: "19902219", oid: "O-8559472664", adresa: "Brožíkova 445, Pardubice" } });
    const zle = [...UD, u("K2", "2026-11-16", "19:00", "20:00", "<script>alert(1)</script>")];
    const h = strankaMrizky({ volby: v, technici: T, barvy: new Map([["K1", "#3f51b5"]]), mrizka: sestavMrizku(zle, T, v), synchronizace: new Date("2026-11-11T18:19:00Z"), uzivatel: "a@b.cz" }, "2026-11-11");
    expect(h).not.toContain("<script");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain('href="/o/O-8559960553"');
    expect(h).toContain('name="t" value="Tomáš Vajc" checked');
    expect(h).toContain("pohled=tyden&amp;den=2026-11-16");
    expect(h).toContain("den=2026-11-17"); // šipka další den
    expect(h).toContain('href="/zakazka/19902219"');
    expect(h).toContain("Stav k 18:19");
    expect(h).toContain('name="z" value="19902219"');
  });

  it("městská část adresy se oddělí a zvýrazní; výjezd technika v záhlaví; měsíční kalendář vlevo nahoře", () => {
    expect(castAdresy(" Bellušova 1827 / 53, Praha 13 Stodůlky")).toEqual({ ulice: "Bellušova 1827 / 53", cast: "Praha 13 Stodůlky" });
    expect(castAdresy("Plovdivská 3265/4, 143 00 Praha 12 - Modřany")).toEqual({ ulice: "Plovdivská 3265/4", cast: "Praha 12 - Modřany" });
    expect(castAdresy("Brožíkova 445, 530 09 Pardubice II, Česko")).toEqual({ ulice: "Brožíkova 445", cast: "Pardubice II" });
    expect(castAdresy("Krčská 991")).toEqual({ ulice: "Krčská 991", cast: "" });
    const v = volby();
    const m = sestavMrizku(UD, T, v);
    expect(m.sloupce[0]!.pod[0]!.stitek).toBe("výjezd: Praha 4, Krč");
    const h = strankaMrizky({ volby: v, technici: T, barvy: new Map(), mrizka: m, synchronizace: null, uzivatel: "a@b.cz" }, "2026-11-11");
    expect(h).toContain("Bellušova 1827 / 53, <b>Praha 13 Stodůlky</b>");
    expect(h).toContain("<small>Praha 4, Krč</small>");
    const mm = miniMesic(v, "2026-11-11");
    expect(mm).toContain("Listopad 2026");
    expect(mm).toContain('<td class="t">47</td>'); // týden 16.–22.11.
    expect(mm).toContain('class="dnes" href="/kalendar?pohled=den&amp;den=2026-11-11"');
    expect(mm).toContain('class="vyb" href="/kalendar?pohled=den&amp;den=2026-11-16"');
    expect(mm).toContain("den=2026-12-16"); // šipka na další měsíc
    expect(miniMesic(volby({ pohled: "tyden" }), "2026-11-11")).toContain('<tr class="vyb"><td class="t">47</td>');
  });

  it("plánování: klik na VOLNY vede na formulář zápisu jen s oprávněním, živými daty a bez blokace; doporučené sloty a současný termín jsou označené", () => {
    const zak = { idAktivity: "P1", oid: "O-8559711037", adresa: "Štefánikova 12, 150 00 Praha 5 Smíchov", zakaznik: "Novák", telefon: "602 123 456", infra: "TMCZ", stitky: ["FTTH + IPTV"], blokace: [] as string[] };
    const v = volby({ zakazka: zak, navrh: true });
    const m = sestavMrizku(UD, T, v, { navrhy: new Map([["K1|K1-2026-11-16-10:00", { poradi: 1, duvod: "+2.0 km navíc" }]]), tato: { kalendar: "K1", eventId: "K1-2026-11-16-08:00" } });
    expect(m.sloupce[0]!.pod[0]!.bloky.map((b) => [b.navrh?.poradi ?? null, !!b.tato])).toEqual([[null, true], [1, false], [null, false]]);
    const zaklad = { volby: v, technici: T, barvy: new Map<string, string>(), mrizka: m, synchronizace: null, uzivatel: "a@b.cz", nacteno: new Date("2026-11-11T20:31:05Z") };
    const ano = strankaMrizky({ ...zaklad, zive: true, planovani: { smi: (t) => t === "Tomáš Vajc", navic: { pk: "K9", pe: "e9", pt: "Anton Hristov" } } }, "2026-11-11");
    expect(ano).toContain('href="/zakazka/P1/zapis?k=K1&amp;e=K1-2026-11-16-10%3A00&amp;t=Tom%C3%A1%C5%A1+Vajc&amp;od=2026-11-16T10%3A00%3A00.000Z&amp;do=2026-11-16T12%3A00%3A00.000Z&amp;pk=K9&amp;pe=e9&amp;pt=Anton+Hristov"');
    expect(ano).toContain("nejoptimálnější 1");
    expect(ano).toContain("tato zakázka");
    expect(ano).toContain("Štefánikova 12, <b>Praha 5 Smíchov</b>");
    expect(ano).toContain("živě z Google Kalendáře · načteno 20:31:05");
    expect(ano).toContain('http-equiv="refresh" content="120"');
    // záloha z databáze, chybějící oprávnění nebo blokace → žádný odkaz na zápis
    expect(strankaMrizky({ ...zaklad, zive: false, planovani: { smi: () => true, navic: {} } }, "2026-11-11")).not.toContain("/zapis?");
    expect(strankaMrizky({ ...zaklad, zive: true, planovani: null }, "2026-11-11")).not.toContain("/zapis?");
    const blok = strankaMrizky({ ...zaklad, volby: volby({ zakazka: { ...zak, blokace: ["Zásuvka USED – čeká se na PEP."] } }), zive: true, planovani: { smi: () => true, navic: {} } }, "2026-11-11");
    expect(blok).not.toContain("/zapis?");
    expect(blok).toContain("Termín teď nelze naplánovat: Zásuvka USED");
    expect(blok).not.toContain("Vybrat nejoptimálnější VOLNY");
  });
});
