import { PGlite } from "@electric-sql/pglite";
import iconv from "iconv-lite";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/db.js";
import { local } from "../src/domain/time.js";
import { prijmiSoubory } from "../src/jobs/importJob.js";
import { hodiSe, nactiDetail, nactiFrontu, zRadku } from "../src/web/data.js";
import { esc } from "../src/web/html.js";
import { povolenUzivatel, vytvorHandler } from "../src/web/server.js";

function pgliteDb(pg: PGlite): Db {
  return {
    query: (sql, params) => pg.query(sql, params) as never,
    tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never })),
  };
}

const SLOUPCE = ["ID aktivity", "ID objednávky", "ID obj. v ext. systéme", "ID S7 obj.", "Pracovný zdroj", "Stav", "Typ aktivity", "Zákazník", "Kontakt", "Adresa", "Subregión", "Poznámka", "Dôvod parkovania", "Dohodnutý termín"];
const radek = (o: Record<string, string>) => SLOUPCE.map((s) => (o[s] ?? "").replace(/;/g, ",")).join(";");
const csv = (radky: Record<string, string>[]) => iconv.encode([SLOUPCE.join(";"), ...radky.map(radek)].join("\r\n"), "win1250");

// „Teď“ = 15.10.2026 10:00 Praha (čas v aplikaci = Praha uložená jako UTC)
const TED = local(2026, 10, 15, 10, 0);

const ZAKAZKY: Record<string, string>[] = [
  // nová, bez zápisu koordinace → P1
  { "ID aktivity": "A1", "ID objednávky": "1", "ID obj. v ext. systéme": "O-8550000001", "ID S7 obj.": "1-D111", "Pracovný zdroj": "Jana Hadravová", "Stav": "Riešená dodávateľom - odovzdaná", "Typ aktivity": "Inst_Pristupu_FTTH", "Zákazník": "Novák, Jan", "Kontakt": "+420 603 111 222", "Adresa": "Pravá 1, Praha", "Subregión": "CZ_P_PH_2002" },
  // má termín v budoucnu → P0
  { "ID aktivity": "A2", "ID objednávky": "2", "ID obj. v ext. systéme": "O-8550000002", "Pracovný zdroj": "Hristov", "Stav": "Riešená dodávateľom - akceptovaná", "Typ aktivity": "CETIN_Inst_Pristupu_FTTH", "Zákazník": "Dvořák, Petr", "Subregión": "CZ_P_PH_2004",
    "Poznámka": "[Dojednávania] 14.10.2026 9:07, Lenka Havlíčková (Vegacom): Zákazník: Dvořák, Petr (20.10.2026, 10:00 - 11:59)", "Dohodnutý termín": "20.10.2026 10:00 / 20.10.2026 11:59" },
  // nedovoláno včera → probíhá kontaktování
  { "ID aktivity": "A3", "ID objednávky": "3", "ID obj. v ext. systéme": "O-8550000003", "Pracovný zdroj": "Markéta Kraitlová", "Stav": "Riešená dodávateľom - odovzdaná", "Typ aktivity": "Inst_Pristupu_FTTH", "Zákazník": "Černá, <Eva>", "Subregión": "CZ_V_PA_1001",
    "Poznámka": "[Dojednávania] 14.10.2026 9:07, Markéta Kraitlová (Vegacom): zkz. nezvedá tlf., sms" },
];

let db: Db;
let server: Server | null = null;

beforeEach(async () => {
  const pg = new PGlite();
  await pg.exec(readFileSync("db/schema.sql", "utf8"));
  db = pgliteDb(pg);
  await prijmiSoubory(db, [{ zdroj: "drive", nazev: "zakazky paw-grid-export-csv 20261015 09_00.csv", obsah: csv(ZAKAZKY), prijato: new Date() }]);
}, 60_000);

afterEach(async () => {
  if (!server) return;
  const s = server;
  server = null;
  s.closeAllConnections();
  await new Promise<void>((r) => s.close(() => r()));
});

async function spust(povoleni = ["@ictmount.com"], devUser?: string) {
  server = createServer(vytvorHandler(db, { povoleni, devUser, ted: () => TED }));
  await new Promise<void>((r) => server!.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return (cesta: string, email?: string) =>
    fetch(`http://127.0.0.1:${port}${cesta}`, { redirect: "manual", headers: email ? { "x-goog-authenticated-user-email": `accounts.google.com:${email}` } : {} });
}

describe("data pro web", () => {
  it("fronta: priorita podle pravidel, P1 nahoře, počty a filtry", async () => {
    const f = await nactiFrontu(db, TED);
    expect(f.celkem).toBe(3);
    const podleId = Object.fromEntries(f.polozky.map((p) => [p.z.idAktivity, p.priorita]));
    expect(podleId.A1).toBe("P1");
    expect(podleId.A2).toBe("P0");
    expect(f.polozky[0]!.priorita).toBe("P1");
    expect(f.polozky.find((p) => p.z.idAktivity === "A3")!.plan.stav).toBe("probiha");
    expect(f.zdroje).toEqual(["Hristov", "Jana Hadravová", "Markéta Kraitlová"]);

    const jenKraitlova = await nactiFrontu(db, TED, { zdroj: "Markéta Kraitlová" });
    expect(jenKraitlova.polozky.map((p) => p.z.idAktivity)).toEqual(["A3"]);
    const jenP0 = await nactiFrontu(db, TED, { priorita: "P0" });
    expect(jenP0.polozky.map((p) => p.z.idAktivity)).toEqual(["A2"]);
    expect(jenP0.pocty.P1 + jenP0.pocty.P2 + jenP0.pocty.P3 + jenP0.pocty.P0).toBe(3);
  });

  it("hledání bez diakritiky a podle telefonu", async () => {
    const f = await nactiFrontu(db, TED);
    const a1 = f.polozky.find((p) => p.z.idAktivity === "A1")!.z;
    expect(hodiSe(a1, "novak")).toBe(true);
    expect(hodiSe(a1, "O-8550000001")).toBe(true);
    expect(hodiSe(a1, "603111222")).toBe(true);
    expect(hodiSe(a1, "dvorak")).toBe(false);
  });

  it("detail: záznamy poznámky, historie a termín", async () => {
    const d = (await nactiDetail(db, "A2", TED))!;
    expect(d.z.zaznamy).toHaveLength(1);
    expect(d.historie).toHaveLength(1);
    expect(d.z.termin).not.toBeNull(); // přesný čas závisí na převodu timestamp v PGlite
    expect(await nactiDetail(db, "NEEXISTUJE", TED)).toBeNull();
  });

  it("řádek z DB bez poznámky dá prázdné záznamy", () => {
    const z = zRadku({ id_aktivity: "X", id_objednavky: "O-1", id_objednavky_zaklad: "O-1", poznamka: "", telefony: [] } as never);
    expect(z.zaznamy).toEqual([]);
    expect(z.termin).toBeNull();
  });
});

describe("webový server", () => {
  it("bez přihlášení 401, cizí doména 403, povolený uživatel vidí frontu", async () => {
    const get = await spust();
    expect((await get("/")).status).toBe(401);
    expect((await get("/", "nekdo@gmail.com")).status).toBe(403);
    const r = await get("/", "davidh@ictmount.com");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("O-8550000001");
    expect(html).toContain("davidh@ictmount.com");
    expect(html.indexOf("O-8550000001")).toBeLessThan(html.indexOf("O-8550000002")); // P1 před P0
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("escapuje data z MWF (žádné HTML z poznámek a jmen)", async () => {
    const get = await spust();
    const html = await (await get("/?zdroj=Mark%C3%A9ta%20Kraitlov%C3%A1", "davidh@ictmount.com")).text();
    expect(html).toContain("Černá, &lt;Eva&gt;");
    expect(html).not.toContain("<Eva>");
    expect(esc(`"<a>'&`)).toBe("&quot;&lt;a&gt;&#39;&amp;");
  });

  it("detail, hledání podle O-ID (přesměrování), 404 a healthz", async () => {
    const get = await spust(["davidh@ictmount.com"]);
    const detail = await get("/zakazka/A2", "davidh@ictmount.com");
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain("Dvořák, Petr");
    const hledani = await get("/hledat?q=O-8550000003", "davidh@ictmount.com");
    expect(hledani.status).toBe(302);
    expect(hledani.headers.get("location")).toBe("/zakazka/A3");
    expect((await get("/zakazka/NIC", "davidh@ictmount.com")).status).toBe(404);
    expect((await get("/", "jina@ictmount.com")).status).toBe(403); // jen vyjmenovaní uživatelé
    expect(await (await get("/healthz")).text()).toBe("ok");
  });

  it("lokální vývoj přes DEV_USER bez IAP", async () => {
    const get = await spust(["@ictmount.com"], "dev@ictmount.com");
    expect((await get("/")).status).toBe(200);
  });

  it("povolení uživatelé: e-mail i doména", () => {
    expect(povolenUzivatel("Davidh@ICTMOUNT.com", ["@ictmount.com"])).toBe(true);
    expect(povolenUzivatel("x@ictmount.com.evil.cz", ["@ictmount.com"])).toBe(false);
    expect(povolenUzivatel("a@ictmount.com", ["b@ictmount.com"])).toBe(false);
  });
});
