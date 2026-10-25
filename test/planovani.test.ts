import { PGlite } from "@electric-sql/pglite";
import iconv from "iconv-lite";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nahledImportu, nastaveniPlanovani } from "../src/config/ciselniky.js";
import { nactiCiselnik, ulozImport } from "../src/db/ciselniky.js";
import type { Db } from "../src/db/db.js";
import { faktaZakazky } from "../src/domain/priorita.js";
import { isoDate, local } from "../src/domain/time.js";
import { paticka } from "../src/gcal/kalendar.js";
import { prijmiSoubory } from "../src/jobs/importJob.js";
import { odhadVzdalenosti } from "../src/plan/geo.js";
import type { Geokoder } from "../src/plan/geokod.js";
import { kontrolaBran, nabidniProZakazku, pracovniDny, skupinaZakazky, techniciZCiselniku, textProMwf, type ZavislostiPlanovace } from "../src/plan/planovac.js";
import { nactiDetail } from "../src/web/data.js";
import { chybejiciPotvrzeni, udajeZFormulare } from "../src/web/planovani.js";
import { vytvorHandler, zVlastniStranky } from "../src/web/server.js";

function pgliteDb(pg: PGlite): Db {
  return {
    query: (sql, params) => pg.query(sql, params) as never,
    tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never })),
  };
}

const SLOUPCE = ["ID aktivity", "ID objednávky", "ID obj. v ext. systéme", "Pracovný zdroj", "Stav", "Typ aktivity", "Zákazník", "Kontakt", "Adresa", "Psč", "Subregión", "Poznámka", "Dôvod parkovania", "Dohodnutý termín"];
const csv = (radky: Record<string, string>[]) =>
  iconv.encode([SLOUPCE.join(";"), ...radky.map((o) => SLOUPCE.map((s) => o[s] ?? "").join(";"))].join("\r\n"), "win1250");

// Čtvrtek 15.10.2026 10:00 Praha
const TED = local(2026, 10, 15, 10, 0);

const ZAKAZKY: Record<string, string>[] = [
  { "ID aktivity": "P1", "ID objednávky": "1", "ID obj. v ext. systéme": "O-8560000001", "Pracovný zdroj": "Jana Hadravová (Vegacom)", "Stav": "Riešená dodávateľom - odovzdaná", "Typ aktivity": "Inst_Pristupu_FTTH", "Zákazník": "Novák, Jan", "Kontakt": "603111222", "Adresa": "Praha, Kolbenova 5", "Psč": "=19000", "Subregión": "CZ_V_PHA_2002" },
  { "ID aktivity": "P2", "ID objednávky": "2", "ID obj. v ext. systéme": "O-8560000002", "Pracovný zdroj": "Jana Hadravová (Vegacom)", "Stav": "Zaparkovaná", "Typ aktivity": "Inst_Pristupu_FTTH", "Zákazník": "Malá, Eva", "Adresa": "Praha, Pravá 245/19", "Subregión": "CZ_V_PHA_2004", "Dôvod parkovania": "Zákazník - nedostupný" },
  { "ID aktivity": "P3", "ID objednávky": "3", "ID obj. v ext. systéme": "O-8560000003", "Pracovný zdroj": "Ludmila Havlíčková (Vegacom)", "Stav": "Riešená dodávateľom - odovzdaná", "Typ aktivity": "PIV_Instalacia", "Zákazník": "Dlouhý, Petr", "Adresa": "Brno, Neznámá 1", "Subregión": "CZ_M_BR_1001",
    "Poznámka": "[Dojednávania] 14.10.2026 9:07, Ludmila Havlíčková (Vegacom): zkz. má smlouvu s JP, ověřuje si výpovědní dobu, přeje si kontaktovat 30.11.2026 r_2" },
  { "ID aktivity": "P4", "ID objednávky": "4", "ID obj. v ext. systéme": "O-8560000004", "Pracovný zdroj": "Hristov Anton (Vegacom)", "Stav": "Riešená dodávateľom - odovzdaná", "Typ aktivity": "Inst_Pristupu_FTTH", "Zákazník": "Rychlá, Ivana", "Adresa": "Praha, Vysočanská 10", "Subregión": "CZ_V_PHA_2002",
    "Poznámka": "[Dojednávania] 14.10.2026 9:07, Jana Hadravová (Vegacom): Zákazník: Rychlá, Ivana (22.10.2026, 10:00 - 11:59), flex – může i dřív", "Dohodnutý termín": "22.10.2026 10:00 / 22.10.2026 11:59" },
];

const TECHNICI_CSV = [
  "Technik;Jméno v kalendáři;ID kalendáře;Výjezd z (adresa);Typy akcí;Aktivní",
  "Hristov;Hristov;K1;Praha 9, Hloubětín;FTTH;ano",
  "Nekdo;Nekdo;K2;Praha 4;FTTH;ano",
  "Fedor;Fedor;K3;Kutná Hora;PIV;ano",
  "Hodza;Hodza;K4;Praha;FTTH;ne",
].join("\n");

const BLOKOVANE_CSV = "Lokalita;Infrastruktura;Důvod\nPravá 245/19;;CETIN hard blacklist od 2/2026";

/** Geokodér bez sítě: Praha = body kolem Hloubětína, Brno nenajde */
const geokoder: Geokoder = {
  async najdi(a) {
    if (/brno/i.test(a)) return { bod: null, presnost: "nenalezeno", zdroj: "test" };
    if (/hloub/i.test(a)) return { bod: { lat: 50.105, lon: 14.535 }, presnost: "adresa", zdroj: "test" };
    if (/kolbenova/i.test(a)) return { bod: { lat: 50.11, lon: 14.51 }, presnost: "adresa", zdroj: "test" };
    if (/kutn/i.test(a)) return { bod: { lat: 49.95, lon: 15.27 }, presnost: "obec", zdroj: "test" };
    return { bod: { lat: 50.08, lon: 14.43 }, presnost: "obec", zdroj: "test" };
  },
};

interface Udalost { id: string; summary: string; description: string; location?: string; colorId?: string; start: { dateTime: string }; end: { dateTime: string }; status: string; extendedProperties?: { private: Record<string, string> } }

/** Napodobený Google Calendar: K1 = Hristov (sloty VOLNY), K2 = nenasdílený kalendář */
function kalendar() {
  const ud: Record<string, Udalost[]> = {
    K1: [
      { id: "z1", summary: "Hristov - FTTH O-8559999999 Starý SLA 20.10.2026 12:00 (AP)", description: "", location: "Praha, Vysočanská 1", start: { dateTime: "2026-10-16T08:00:00+02:00" }, end: { dateTime: "2026-10-16T10:00:00+02:00" }, status: "confirmed" },
      { id: "v1", summary: "Hristov - VOLNY", colorId: "10", description: "Šablona\n\n[SHEET2CAL] K1", start: { dateTime: "2026-10-16T10:00:00+02:00" }, end: { dateTime: "2026-10-16T12:00:00+02:00" }, status: "confirmed" },
      { id: "v2", summary: "Hristov - VOLNY", colorId: "10", description: "Šablona\n\n[SHEET2CAL] K1", start: { dateTime: "2026-10-19T12:00:00+02:00" }, end: { dateTime: "2026-10-19T14:00:00+02:00" }, status: "confirmed" },
      { id: "v0", summary: "Hristov - VOLNY", colorId: "10", description: "[SHEET2CAL] K1", start: { dateTime: "2026-10-15T08:00:00+02:00" }, end: { dateTime: "2026-10-15T10:00:00+02:00" }, status: "confirmed" },
      { id: "f1", summary: "Hristov - FTTH O-8560000004 Rychlá, Ivana (JH)", description: "flex", location: "Praha, Vysočanská 10", start: { dateTime: "2026-10-22T10:00:00+02:00" }, end: { dateTime: "2026-10-22T12:00:00+02:00" }, status: "confirmed", extendedProperties: { private: { appkoo: "P4" } } },
    ],
  };
  const patche: { calendarId: string; eventId: string; requestBody: Record<string, unknown> }[] = [];
  const api = {
    events: {
      list: async (p: { calendarId: string }) => {
        if (!ud[p.calendarId]) throw new Error("Not Found");
        return { data: { items: ud[p.calendarId] } };
      },
      get: async (p: { calendarId: string; eventId: string }) => ({ data: ud[p.calendarId]!.find((e) => e.id === p.eventId)! }),
      patch: async (p: { calendarId: string; eventId: string; requestBody: Record<string, unknown> }) => {
        patche.push(p);
        const e = ud[p.calendarId]!.find((x) => x.id === p.eventId)!;
        Object.assign(e, { summary: p.requestBody.summary, description: p.requestBody.description, colorId: (p.requestBody.colorId as string | null) ?? undefined });
        return { data: { id: e.id, htmlLink: `https://calendar.test/${e.id}` } };
      },
    },
  };
  return { api: api as unknown as ZavislostiPlanovace["api"], patche, ud };
}

let db: Db;
const servery: Server[] = [];

beforeEach(async () => {
  const pg = new PGlite();
  await pg.exec(readFileSync("db/schema.sql", "utf8"));
  db = pgliteDb(pg);
  await prijmiSoubory(db, [{ zdroj: "drive", nazev: "zakazky paw-grid-export-csv 20261015 09_00.csv", obsah: csv(ZAKAZKY), prijato: new Date() }]);
  await ulozImport(db, "technici", nahledImportu("technici", TECHNICI_CSV, []), "test", "test");
  await ulozImport(db, "blokovaneLokality", nahledImportu("blokovaneLokality", BLOKOVANE_CSV, []), "test", "test");
}, 60_000);

afterEach(async () => {
  for (const s of servery.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

describe("číselník Technici v databázi", () => {
  it("uloží import a plánovač bere jen aktivní techniky s kalendářem", async () => {
    const t = techniciZCiselniku(await nactiCiselnik(db, "technici"));
    expect(t.map((x) => x.jmeno).sort()).toEqual(["Fedor", "Hristov", "Nekdo"]);
    expect(t.find((x) => x.jmeno === "Fedor")!.skupiny).toEqual(["PIV"]);
    const zmeny = (await (db.query<{ n: number }>("SELECT count(*)::int AS n FROM ciselnik_zmena WHERE ciselnik = 'technici'"))).rows[0]!.n;
    expect(zmeny).toBe(4);
  });
});

describe("brány plánování (zlatá pravidla)", () => {
  it("ZAK, blokovaná lokalita a smlouva s JP termín zablokují; volná zakázka projde", async () => {
    const blok = await nactiCiselnik(db, "blokovaneLokality");
    const brana = async (id: string) => {
      const d = (await nactiDetail(db, id, TED))!;
      return kontrolaBran(d.z, faktaZakazky(d.z, TED), blok);
    };
    expect((await brana("P1")).blokace).toEqual([]);
    const p2 = (await brana("P2")).blokace.join(" | ");
    expect(p2).toContain("ZAK");
    expect(p2).toContain("Pravá 245/19");
    expect((await brana("P3")).blokace.join(" ")).toContain("30.11.2026");
  });

  it("termín: bez přeplánování blokace, doplnění (webcalendar) a přesun ji ruší", async () => {
    const d = (await nactiDetail(db, "P1", TED))!;
    const z = { ...d.z, termin: { od: new Date("2026-10-23T08:00:00Z"), do: new Date("2026-10-23T10:00:00Z") } };
    const f = faktaZakazky(z, TED);
    expect(kontrolaBran(z, f, []).blokace.join(" ")).toContain("dohodnutý termín");
    const b = kontrolaBran(z, f, [], { doplnit: true });
    expect(b.blokace).toEqual([]);
    expect(b.upozorneni.join(" ")).toContain("zatím není v kalendáři");
    expect(kontrolaBran(z, f, [], { presun: true }).blokace).toEqual([]);
  });

  it("předobjednávka se plánovat smí, jen se upozorní na realizaci po změně na standardní zakázku", async () => {
    const d = (await nactiDetail(db, "P1", TED))!;
    const z = { ...d.z, predobjednavka: true, typAktivity: "Predobjednavka_FTTH" };
    const b = kontrolaBran(z, faktaZakazky(z, TED), []);
    expect(b.blokace).toEqual([]);
    expect(b.upozorneni.join(" ")).toContain("Předobjednávka");
  });

  it("skupina zakázky a pracovní dny (víkend se přeskočí)", () => {
    expect(skupinaZakazky("PIV_Instalacia")).toBe("PIV");
    expect(skupinaZakazky("CETIN_Inst_Pristupu_FTTH")).toBe("FTTH");
    expect(pracovniDny("2026-10-15", 3)).toEqual(["2026-10-15", "2026-10-16", "2026-10-19"]);
  });
});

describe("nabídka termínů", () => {
  it("najde volné sloty Hristova, nenasdílený kalendář jen nahlásí, dnešní prošlý slot vynechá", async () => {
    const k = kalendar();
    const d = (await nactDetail("P1"))!;
    const n = await nabidniProZakazku(d.z, "P1", null, techniciZCiselniku(await nactiCiselnik(db, "technici")), { api: k.api, geokoder, vzdalenosti: odhadVzdalenosti() }, TED);
    expect(n.chyba).toBeUndefined();
    expect(n.nedostupne).toEqual(["Nekdo"]);
    expect(n.technikuCelkem).toBe(2); // Fedor (PIV) se pro FTTH nenabízí
    expect(n.moznosti.map((m) => m.eventId)).toEqual(expect.arrayContaining(["v1", "v2"]));
    expect(n.moznosti.map((m) => m.eventId)).not.toContain("v0");
    expect(n.moznosti[0]!.technik).toBe("Hristov");
    // sousedé v trase: 16.10. má Hristov 8–10 zakázku O-8559999999, po slotu už nic → návrat na základnu
    const v1 = n.moznosti.find((m) => m.eventId === "v1")!;
    expect(v1.sousede!.pred.popis).toContain("O-8559999999");
    expect(v1.sousede!.pred.cas).toBe("08:00–09:59");
    expect(v1.sousede!.po.zakladna).toBe(true);
    expect(v1.sousede!.prijezd).toBeGreaterThanOrEqual(600);
    // jeden řádek na technika a den; „jiné termíny“ od zvoleného data
    expect(new Set(n.moznosti.map((m) => `${m.technik}|${isoDate(m.od)}`)).size).toBe(n.moznosti.length);
    const pozdeji = await nabidniProZakazku(d.z, "P1", null, techniciZCiselniku(await nactiCiselnik(db, "technici")), { api: k.api, geokoder, vzdalenosti: odhadVzdalenosti() }, TED, { odData: "2026-10-19" });
    expect(pozdeji.obdobi!.od).toBe("2026-10-19");
    expect(pozdeji.moznosti.map((m) => m.eventId)).toEqual(["v2"]);
  });

  it("adresa, kterou nejde najít, vrátí srozumitelnou chybu", async () => {
    const k = kalendar();
    const d = (await nactDetail("P3"))!;
    const n = await nabidniProZakazku(d.z, "P2", null, techniciZCiselniku(await nactiCiselnik(db, "technici")), { api: k.api, geokoder, vzdalenosti: odhadVzdalenosti() }, TED);
    expect(n.chyba).toContain("Brno");
  });

  it("text pro MWF a patička SHEET2CAL", () => {
    expect(textProMwf("Novák, Jan", local(2026, 10, 16, 10, 0), local(2026, 10, 16, 12, 0))).toBe("Zákazník: Novák, Jan (16.10.2026, 10:00 - 11:59)");
    expect(paticka("Šablona\n\n[SHEET2CAL] K1")).toBe("[SHEET2CAL] K1");
    expect(paticka("bez patičky")).toBeNull();
  });
});

const nactDetail = (id: string) => nactiDetail(db, id, TED);

describe("formulář hovoru", () => {
  it("převede pole na šablonu události a hlídá povinná potvrzení", () => {
    const f = new URLSearchParams({ instalace: "existujici", zasuvka: "0023A4145", vrtani: "ne", kz: "BRIDGE", stb: "1×", stoupacka: "ANO", vzdalenost: "12" });
    const u = udajeZFormulare(f);
    expect(u).toMatchObject({ novaInstalace: false, zasuvka: "0023A4145", souhlasSVrtanim: false, kz: "BRIDGE + STB 1×", stoupacka: "ANO", vzdalenostOdStoupackyM: 12 });
    expect(chybejiciPotvrzeni(f)).toHaveLength(3);
    expect(chybejiciPotvrzeni(new URLSearchParams({ overenoJmeno: "ano", overenaZasuvka: "ano", zakaznikSouhlasi: "ano" }))).toEqual([]);
  });

  it("formulář smí přijít jen z vlastní stránky", () => {
    const req = (h: Record<string, string>) => ({ headers: h }) as never;
    expect(zVlastniStranky(req({ host: "app.test", origin: "https://app.test" }))).toBe(true);
    expect(zVlastniStranky(req({ host: "app.test", origin: "https://zly.web" }))).toBe(false);
    expect(zVlastniStranky(req({ host: "app.test" }))).toBe(false);
  });
});

describe("web: nabídka a zápis termínu", () => {
  async function spust(zapis = { zapnuty: true, technici: ["Hristov"] as string[] | "vsichni" }) {
    const k = kalendar();
    const server = createServer(vytvorHandler(db, { povoleni: ["@ictmount.com"], ted: () => TED, planovac: () => ({ api: k.api, geokoder, vzdalenosti: odhadVzdalenosti() }), zapis }));
    servery.push(server);
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const hl = { "x-goog-authenticated-user-email": "accounts.google.com:davidh@ictmount.com" };
    return {
      k,
      get: (c: string) => fetch(base + c, { headers: hl, redirect: "manual" }),
      post: (c: string, f: Record<string, string>, origin: string | null = base) =>
        fetch(base + c, { method: "POST", headers: { ...hl, "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) }, body: new URLSearchParams(f).toString(), redirect: "manual" }),
    };
  }

  const vyber = { k: "K1", e: "v1", t: "Hristov", od: local(2026, 10, 16, 10, 0).toISOString(), do: local(2026, 10, 16, 12, 0).toISOString() };
  const potvrzeno = { overenoJmeno: "ano", overenaZasuvka: "ano", zakaznikSouhlasi: "ano" };

  it("nabídka termínů a formulář", async () => {
    const w = await spust();
    expect((await w.get("/zakazka/P1/terminy")).headers.get("location")).toBe("/zakazka/P1#planovani");
    const n = await w.get("/zakazka/P1");
    expect(n.status).toBe(200);
    const html = await n.text();
    expect(html).toContain("Hristov");
    expect(html).toContain("Vybrat");
    expect(html).toContain("Nekdo");
    expect(html).toContain("↑ před");
    expect(html).toContain("tato zakázka – příjezd cca");
    expect(html).toContain("Pozdější termíny →");
    expect(await (await w.get("/zakazka/P1?od=2026-10-19")).text()).toContain("Hledáno <b>19.10.2026");
    const f = await w.get(`/zakazka/P1/zapis?${new URLSearchParams(vyber)}`);
    expect(await f.text()).toContain("Uložit do kalendáře");
    const blok = await (await w.get("/zakazka/P2")).text();
    expect(blok).toContain("Termín teď nelze naplánovat");
  });

  it("zápis: kontrola původu a potvrzení, přepis slotu se zachovanou patičkou, evidence a text pro MWF", async () => {
    const w = await spust();
    expect((await w.post("/zakazka/P1/zapis", { ...vyber, ...potvrzeno }, null)).status).toBe(403);
    expect((await w.post("/zakazka/P1/zapis", { ...vyber })).status).toBe(422);

    const r = await w.post("/zakazka/P1/zapis", { ...vyber, ...potvrzeno, zasuvka: "0023A4145", kz: "ROUTE" });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Zákazník: Novák, Jan (16.10.2026, 10:00 - 11:59)");
    const patch = w.k.patche[0]!;
    expect(patch.eventId).toBe("v1");
    expect(String(patch.requestBody.summary)).toMatch(/^Hristov - FTTH O-8560000001 Novák, Jan/);
    expect(String(patch.requestBody.description)).toContain("zásuvka 0023A4145");
    expect(String(patch.requestBody.description).trim().endsWith("[SHEET2CAL] K1")).toBe(true);
    expect(String(patch.requestBody.location)).toBe("Praha, Kolbenova 5, 19000");
    const ev = (await db.query<{ event_id: string }>("SELECT event_id FROM gcal_udalost WHERE id_aktivity = 'P1'")).rows;
    expect(ev).toEqual([{ event_id: "v1" }]);

    // stejný slot podruhé – už není volný
    expect((await w.post("/zakazka/P1/zapis", { ...vyber, ...potvrzeno })).status).toBe(409);
  });

  it("zápis vypnutý nebo jiný technik → nic se nezapíše", async () => {
    const w = await spust({ zapnuty: false, technici: "vsichni" });
    expect((await w.post("/zakazka/P1/zapis", { ...vyber, ...potvrzeno })).status).toBe(403);
    expect(w.k.patche).toHaveLength(0);
    const w2 = await spust({ zapnuty: true, technici: ["Nekdo"] });
    expect((await w2.post("/zakazka/P1/zapis", { ...vyber, ...potvrzeno })).status).toBe(403);
    expect((await w2.post("/zakazka/P1/zapis", { ...vyber, k: "K9" })).status).toBe(400);
  });

  it("režim B: přehled dne, návrhy pro slot (vč. flex) a přesun s vrácením původní události na VOLNY", async () => {
    const w = await spust();
    const den = await w.get("/technik?den=2026-10-19");
    expect(den.status).toBe(200);
    const hd = await den.text();
    expect(hd).toContain("Hristov");
    expect(hd).toContain('<span class="cas">12:00–14:00</span> volno → doplnit');
    expect(hd).toContain("pondělí"); // den v týdnu u data
    expect(hd).toContain('href="/technik?den=2026-10-20"'); // o den dál = další pracovní den
    expect(hd.indexOf("O-8559999999")).toBe(-1); // jiný den se v přehledu 19.10. neukazuje
    expect(hd).toMatch(/Kalendář nejde přečíst: [^<]*Nekdo/);

    const slot = { k: "K1", e: "v2", t: "Hristov", od: local(2026, 10, 19, 12, 0).toISOString(), do: local(2026, 10, 19, 14, 0).toISOString() };
    const tyden = await (await w.get("/technik?t=Hristov&den=2026-10-19")).text();
    expect(tyden).toContain("12:00–14:00 volno → doplnit");
    expect(tyden).toContain('href="/?q=O-8560000004"'); // zakázka v kalendáři vede na plánování zakázky
    expect(tyden).toContain("· Praha, Vysočanská 10"); // adresa zakázky
    expect(tyden).toContain('href="/technik?den=2026-10-26&amp;t=Hristov"'); // o týden dál
    const ns = await w.get(`/technik?${new URLSearchParams({ ...slot, den: "2026-10-19" })}`);
    expect(ns.status).toBe(200);
    const hs = await ns.text();
    expect(hs).toContain("O-8560000001");
    expect(hs).toContain("O-8560000004");
    expect(hs).toContain("přesun dopředu (flex)");
    expect(hs).toContain('class="infra i-');
    expect(hs).toContain("může i dřív"); // poslední poznámka z MWF u kandidáta
    expect(hs).not.toContain("O-8560000002"); // blokovaná lokalita / ZAK
    expect(hs).not.toContain("O-8560000003"); // PIV + smlouva s JP

    // zakázka s termínem bez přesunu se plánovat nesmí
    expect((await w.post("/zakazka/P4/zapis", { ...slot, ...potvrzeno })).status).toBe(403);

    const presun = { pk: "K1", pe: "f1", pt: "Hristov" };
    const f = await w.get(`/zakazka/P4/zapis?${new URLSearchParams({ ...slot, ...presun })}`);
    expect(await f.text()).toContain("původní událost se vrátí na VOLNY");
    const r = await w.post("/zakazka/P4/zapis", { ...slot, ...presun, ...potvrzeno });
    expect(r.status).toBe(200);
    const hr = await r.text();
    expect(hr).toContain("vrácen v kalendáři na VOLNY");
    expect(hr).toContain("Zákazník: Rychlá, Ivana (19.10.2026, 12:00 - 13:59)");
    expect(w.k.patche.map((p) => p.eventId)).toEqual(["v2", "f1"]);
    expect(String(w.k.patche[0]!.requestBody.summary)).toContain("O-8560000004");
    expect(w.k.patche[1]!.requestBody).toMatchObject({ summary: "Hristov - VOLNY", colorId: "10", description: "[SHEET2CAL] K1" });
  });
});

describe("uživatelé a Konfigurace", () => {
  async function web(spravci: string[]) {
    const server = createServer(vytvorHandler(db, { povoleni: ["@ictmount.com"], spravci, ted: () => TED }));
    servery.push(server);
    await new Promise<void>((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const hl = (email: string) => ({ "x-goog-authenticated-user-email": `accounts.google.com:${email}` });
    return {
      get: (c: string, email = "davidh@ictmount.com") => fetch(base + c, { headers: hl(email), redirect: "manual" }),
      post: (c: string, body: string | FormData, email = "davidh@ictmount.com", ct?: string) =>
        fetch(base + c, { method: "POST", headers: { ...hl(email), origin: base, ...(ct ? { "content-type": ct } : {}) }, body, redirect: "manual" }),
    };
  }

  it("role: správce ze SPRAVCI, pak jen uživatelé z číselníku; jen čtení nezapisuje", async () => {
    const w = await web(["davidh@ictmount.com"]);
    // číselník Uživatelé prázdný → přechodně celá doména (koordinátorka), Konfigurace jen správce
    expect((await w.get("/", "jana@ictmount.com")).status).toBe(200);
    expect((await w.get("/konfigurace", "jana@ictmount.com")).status).toBe(403);
    const uvod = await (await w.get("/")).text();
    expect(uvod).toContain('href="/konfigurace"');
    expect(uvod).toContain("· správce");

    const csv = "E-mail;Jméno;Iniciály;Role;Aktivní\njana@ictmount.com;Jana Hadravová;JH;koordinátorka;ano\npetra@ictmount.com;Petra;PO;jen čtení;ano\nstara@ictmount.com;Stará;SS;koordinátorka;ne";
    await ulozImport(db, "koordinatorky", nahledImportu("koordinatorky", csv, []), "test", "test");
    expect((await w.get("/", "jana@ictmount.com")).status).toBe(200);
    expect((await w.get("/", "cizi@ictmount.com")).status).toBe(403);
    expect((await w.get("/", "stara@ictmount.com")).status).toBe(403);
    expect(await (await w.get("/", "petra@ictmount.com")).text()).toContain("· jen čtení");
    expect((await w.get("/")).status).toBe(200); // správce i bez řádku v číselníku
  });

  it("historie uživatelů: hledání, zakázka a odepřený přístup se zapíšou; vidí jen správce", async () => {
    const w = await web(["davidh@ictmount.com"]);
    await w.get("/?q=Nov%C3%A1k", "jana@ictmount.com");
    await w.get("/zakazka/P1", "jana@ictmount.com");
    await w.get("/konfigurace", "jana@ictmount.com"); // 403
    await new Promise((r) => setTimeout(r, 300)); // zápis logu běží po odeslání odpovědi
    expect((await w.get("/konfigurace/log", "jana@ictmount.com")).status).toBe(403);
    const log = await (await w.get("/konfigurace/log?u=jana@ictmount.com&dni=7")).text();
    expect(log).toContain("Historie uživatelů");
    expect(log).toContain("jana@ictmount.com");
    expect(log).toContain("hledání");
    expect(log).toContain("Novák");
    expect(log).toContain("detail zakázky");
    expect(log).toContain("přístup odepřen");
    expect(await (await w.get("/konfigurace")).text()).toContain('href="/konfigurace/log"');
  });

  it("CSV: stažení, nahrání souboru → náhled → uložení s historií", async () => {
    const w = await web(["davidh@ictmount.com"]);
    const prehled = await (await w.get("/konfigurace")).text();
    expect(prehled).toContain("Nastavení plánování");
    expect(prehled).toContain("Blacklist lokalit");

    const sablona = await w.get("/konfigurace/nastaveniPlanovani/csv");
    expect(sablona.headers.get("content-type")).toContain("text/csv");
    expect(await sablona.text()).toContain("maxZajizdkaKm;75;");

    const fd = new FormData();
    fd.append("soubor", new Blob(["Parametr;Hodnota\nmaxZajizdkaKm;60\ndniNabidky;7"], { type: "text/csv" }), "planovani.csv");
    const nahled = await w.post("/konfigurace/nastaveniPlanovani/nahled", fd);
    expect(nahled.status).toBe(200);
    const hn = await nahled.text();
    expect(hn).toContain("planovani.csv");
    expect(hn).toContain("Uložit změny");
    const csv64 = hn.match(/name="csv" value="([^"]+)"/)![1]!;

    const ulozeni = await w.post("/konfigurace/nastaveniPlanovani/ulozit", new URLSearchParams({ csv: csv64, soubor: "planovani.csv" }).toString(), undefined, "application/x-www-form-urlencoded");
    expect(ulozeni.status).toBe(303);
    expect(ulozeni.headers.get("location")).toContain("pridano=2");
    const detail = await (await w.get(ulozeni.headers.get("location")!)).text();
    expect(detail).toContain("Uloženo: přidáno 2");
    expect(detail).toContain("web: planovani.csv");
    expect(nastaveniPlanovani(await nactiCiselnik(db, "nastaveniPlanovani"))).toMatchObject({ dniNabidky: 7, plan: { maxZajizdkaKm: 60 }, doplneni: { maxZajizdkaKm: 60 } });
    // priority P1–P0 jsou do odvolání vypnuté; zapínají se parametrem pouzivatPriority = 1
    expect(nastaveniPlanovani([]).pouzivatPriority).toBe(false);
    expect(nastaveniPlanovani([{ parametr: "pouzivatPriority", hodnota: 1 }]).pouzivatPriority).toBe(true);

    // chybný soubor se neuloží; koordinátorka konfiguraci nesmí
    const spatne = new FormData();
    spatne.append("soubor", new Blob(["Parametr;Hodnota\nneznamy;1"]), "x.csv");
    expect(await (await w.post("/konfigurace/nastaveniPlanovani/nahled", spatne)).text()).toContain("Import obsahuje chyby");
    await ulozImport(db, "koordinatorky", nahledImportu("koordinatorky", "E-mail;Jméno;Role\njana@ictmount.com;Jana;koordinátorka", []), "test", "test");
    expect((await w.post("/konfigurace/technici/nahled", new FormData(), "jana@ictmount.com")).status).toBe(403);
  });
});
