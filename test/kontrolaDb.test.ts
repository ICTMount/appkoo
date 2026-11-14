import { PGlite } from "@electric-sql/pglite";
import iconv from "iconv-lite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { nahledImportu } from "../src/config/ciselniky.js";
import { ulozImport } from "../src/db/ciselniky.js";
import type { Db } from "../src/db/db.js";
import { local } from "../src/domain/time.js";
import { kontrolaKalendaru, nactiNesoulady } from "../src/gcal/kontrolaDb.js";
import { prijmiSoubory } from "../src/jobs/importJob.js";
import { strankaKontroly } from "../src/web/kontrola.js";
import { pripravSync } from "../src/zdroje/sync.js";

const pgliteDb = (pg: PGlite): Db => ({
  query: (sql, params) => pg.query(sql, params) as never,
  tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never })),
});

const SLOUPCE = ["ID aktivity", "ID objednávky", "ID obj. v ext. systéme", "Pracovný zdroj", "Stav", "Typ aktivity", "Zákazník", "Kontakt", "Adresa", "Psč", "Subregión", "Poznámka", "Dohodnutý termín"];
const csv = (radky: Record<string, string>[]) =>
  iconv.encode([SLOUPCE.join(";"), ...radky.map((o) => SLOUPCE.map((s) => o[s] ?? "").join(";"))].join("\r\n"), "win1250");
const zak = (id: string, o: string, technik: string, zakaznik: string, termin: string, adresa = "Praha, Kolbenova 5") => ({
  "ID aktivity": id, "ID objednávky": id, "ID obj. v ext. systéme": o, "Pracovný zdroj": technik, "Stav": "Riešená dodávateľom - odovzdaná",
  "Typ aktivity": "Inst_Pristupu_FTTH", "Zákazník": zakaznik, "Kontakt": "603111222", "Adresa": adresa, "Subregión": "CZ_V_PHA_2002", "Dohodnutý termín": termin,
});

// Pondělí 16.11.2026 8:00 Praha
const TED = local(2026, 11, 16, 8, 0);

const ZAKAZKY = [
  zak("A1", "O-8560000001", "Hristov Anton (Vegacom)", "Novák, Jan", "17.11.2026 10:00 / 17.11.2026 11:59"), // shoda
  zak("A2", "O-8560000002", "Hristov Anton (Vegacom)", "Malá, Eva", "17.11.2026 13:00 / 17.11.2026 14:59"), // jiný čas v kalendáři
  zak("A3", "O-8560000003", "Vajc Tomas (Vegacom)", "Dlouhý, Petr", "18.11.2026 10:00 / 18.11.2026 11:59"), // v kalendáři chybí
  zak("A4", "O-8560000004", "Hristov Anton (Vegacom)", "Rychlá, Ivana", ""), // jen v kalendáři (v MWF bez termínu)
  zak("A5", "O-8560000005", "Petko Jan (Vegacom)", "Krátký, Ota", "18.11.2026 08:00 / 18.11.2026 09:59"), // technik bez kalendáře
  zak("A6", "O-8560000006", "Hristov Anton (Vegacom)", "Bílá, Jana", "19.11.2026 08:00 / 19.11.2026 09:59"), // jiný zákazník v události
];

const TECHNICI = ["Technik;Jméno v kalendáři;ID kalendáře;Výjezd z (adresa);Typy akcí;Aktivní", "Hristov;Hristov;K1;Praha 9;FTTH;ano", "Vajc;Vajc;K2;Praha 4;FTTH;ano"].join("\n");

async function udalost(db: Db, kalendar: string, id: string, summary: string, od: string, do_: string, description = "TEL: 603111222") {
  await db.query(
    `INSERT INTO kalendar_udalost (kalendar, id, kalendar_nazev, summary, location, description, cas, konec, odkaz, hledani, celodenni)
     VALUES ($1, $2, $1, $3, 'Kolbenova 5, Praha', $4, $5, $6, $7, '', false)`,
    [kalendar, id, summary, description, od, do_, `https://cal/${id}`],
  );
}

let db: Db;
beforeEach(async () => {
  const pg = new PGlite();
  await pg.exec(readFileSync("db/schema.sql", "utf8"));
  db = pgliteDb(pg);
  await prijmiSoubory(db, [{ zdroj: "drive", nazev: "zakazky paw-grid-export-csv 20261116 07_00.csv", obsah: csv(ZAKAZKY), prijato: new Date() }]);
  await ulozImport(db, "technici", nahledImportu("technici", TECHNICI, []), "test", "test");
  await pripravSync(db);
  // časy v DB = místní čas Praha uložený jako UTC
  await udalost(db, "K1", "e1", "Hristov - FTTH O-8560000001 Novák, Jan", "2026-11-17T10:00:00Z", "2026-11-17T11:59:00Z");
  await udalost(db, "K1", "e2", "Hristov - FTTH O-8560000002 Malá", "2026-11-17T15:00:00Z", "2026-11-17T16:59:00Z");
  await udalost(db, "K1", "e4", "Hristov - FTTH O-8560000004 Rychlá", "2026-11-19T12:00:00Z", "2026-11-19T13:59:00Z");
  await udalost(db, "K1", "e6", "Hristov - FTTH O-8560000006 Černý", "2026-11-19T08:00:00Z", "2026-11-19T09:59:00Z");
  await udalost(db, "K1", "v1", "Hristov - VOLNY", "2026-11-18T10:00:00Z", "2026-11-18T11:59:00Z", "");
  await udalost(db, "K1", "old", "Hristov - FTTH O-8559999999 Uzavřená", "2026-11-17T08:00:00Z", "2026-11-17T09:59:00Z"); // zakázka v MWF není
}, 60_000);

describe("kontrola MWF ↔ kalendář nad databází", () => {
  it("rozdělí termíny na shodu, rozpor, zápis a jen v kalendáři; technik bez kalendáře se nekontroluje", async () => {
    const s = await kontrolaKalendaru(db, TED);
    expect(s).toMatchObject({ od: "2026-11-16", do: "2026-11-30", zkontrolovano: 4, shoda: 1, rozpor: 2, admin: 1, jenVKalendari: 1, bezKalendare: 1 });
    const podle = Object.fromEntries(s.radky.map((r) => [`${r.idAktivity}|${r.zavaznost}`, r]));
    expect(podle["A2|rozpor"]!.problemy).toEqual(["Jiný čas začátku: MWF 13:00, kalendář 15:00."]);
    expect(podle["A3|rozpor"]!.problemy).toEqual(["Termín je v MWF, v kalendáři technika chybí."]);
    expect(podle["A6|admin"]!.problemy).toEqual(["Zákazník v události chybí nebo se liší (MWF: Bílá, Jana)."]);
    expect(podle["A4|jen_kalendar"]).toMatchObject({ eventId: "e4", odkaz: "https://cal/e4", problemy: ["V kalendáři je termín 19.11.2026 12:00 (Hristov), v MWF termín chybí."] });
    expect(s.radky.some((r) => r.eventId === "old" || r.eventId === "v1")).toBe(false);
  });

  it("uloží jen aktuální stav; web ukáže nesoulady seřazené od rozporů", async () => {
    await kontrolaKalendaru(db, TED);
    await kontrolaKalendaru(db, TED); // druhý běh přepíše, nepřidá
    const n = await nactiNesoulady(db);
    expect(n.map((r) => r.zavaznost)).toEqual(["rozpor", "rozpor", "jen_kalendar", "admin"]);
    const html = strankaKontroly(n, "", { posledniExport: null, posledniBeh: null, hodin: null } as never, "koordinace@test");
    expect(html).toContain("Rozpor (2)");
    expect(html).toContain('href="/zakazka/A3"');
    expect(html).toContain("Jiný čas začátku: MWF 13:00, kalendář 15:00.");
    expect(strankaKontroly(n, "admin", { posledniExport: null, posledniBeh: null, hodin: null } as never, "x")).not.toContain("A3");
  });
});
