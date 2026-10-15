import { PGlite } from "@electric-sql/pglite";
import iconv from "iconv-lite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/db.js";
import type { ZdrojExportu } from "../src/ingest/google.js";
import type { DoslyExport } from "../src/ingest/prijem.js";
import { prijmiSoubory, spustImport } from "../src/jobs/importJob.js";

function pgliteDb(pg: PGlite): Db {
  return {
    query: (sql, params) => pg.query(sql, params) as never,
    tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never })),
  };
}

const HLAVICKA = "ID aktivity;ID objednávky;ID obj. v ext. systéme;Stav;Typ aktivity;Poznámka;Dôvod parkovania;Dohodnutý termín";
const csv = (radky: string[]) => iconv.encode([HLAVICKA, ...radky].join("\r\n"), "win1250");
const soubor = (nazev: string, obsah: Buffer, zdroj: DoslyExport["zdroj"] = "drive"): DoslyExport => ({ zdroj, nazev, obsah, prijato: new Date() });
const jmeno = (hhmm: string) => `zakazky paw-grid-export-csv 20261015 ${hhmm}.csv`;

let pg: PGlite;
let db: Db;
beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(readFileSync("db/schema.sql", "utf8"));
  db = pgliteDb(pg);
}, 60_000);

describe("automatický import do databáze", () => {
  it("uloží zakázky, pozná změny, uzavřené zakázky a vede historii", async () => {
    const r1 = await prijmiSoubory(db, [soubor(jmeno("09_00"), csv([
      "A1;1;O-1000000001:1;Riešená dodávateľom - odovzdaná;Inst_Pristupu_FTTH;;;",
      "A2;2;O-1000000002;Zaparkovaná;CETIN_Inst_Pristupu_FTTH;;Zákazník - odklad termínu;",
    ]))]);
    expect(r1[0]).toMatchObject({ vysledek: "importovat", ulozeno: { nove: 2, zmenene: 0, uzavrene: 0 } });

    const r2 = await prijmiSoubory(db, [soubor(jmeno("12_00"), csv([
      "A1;1;O-1000000001:1;Riešená dodávateľom - akceptovaná;Inst_Pristupu_FTTH;;;16.10.2026 10:00 / 16.10.2026 11:59",
      "A3;3;O-1000000003;Riešená dodávateľom - odovzdaná;VDF_Inst_Pristupu_FTTH;;;",
    ]))]);
    expect(r2[0]!.ulozeno).toMatchObject({ nove: 1, zmenene: 1, uzavrene: 1 });

    const a1 = (await pg.query<any>("SELECT * FROM zakazka WHERE id_aktivity = 'A1'")).rows[0];
    expect(a1.id_objednavky_zaklad).toBe("O-1000000001");
    expect(a1.stav_mwf).toBe("Riešená dodávateľom - akceptovaná");
    expect((await pg.query<any>("SELECT uzavreno FROM zakazka WHERE id_aktivity = 'A2'")).rows[0].uzavreno).not.toBeNull();
    expect((await pg.query<any>("SELECT count(*)::int AS n FROM zakazka_historie WHERE id_aktivity = 'A1'")).rows[0].n).toBe(2);
  });

  it("duplicita, starší export a odmítnutí se zapíšou do logu, zakázky nezmění", async () => {
    const obsah = csv(["A1;1;O-1;Zaparkovaná;Inst_Pristupu_FTTH;;;"]);
    await prijmiSoubory(db, [soubor(jmeno("12_00"), obsah)]);
    const r = await prijmiSoubory(db, [
      { ...soubor(jmeno("12_00"), obsah, "email"), odesilatel: "adela@ictmount.com" },
      soubor(jmeno("08_00"), csv(["A9;9;O-9;Zaparkovaná;Inst_Pristupu_FTTH;;;"]), "upload"),
      soubor("export.xlsx", obsah, "upload"),
    ]);
    expect(r.map((x) => x.vysledek).sort()).toEqual(["odmitnout", "preskocit", "preskocit"]);
    const log = (await pg.query<any>("SELECT vysledek, count(*)::int AS n FROM import_run GROUP BY 1 ORDER BY 1")).rows;
    expect(log).toEqual([{ vysledek: "importovano", n: 1 }, { vysledek: "odmitnuto", n: 1 }, { vysledek: "preskoceno", n: 2 }]);
    expect((await pg.query<any>("SELECT count(*)::int AS n FROM zakazka")).rows[0].n).toBe(1);
  });

  it("projde zdroje, výpadek jednoho nezastaví ostatní, zpracované označí", async () => {
    const oznacene: string[] = [];
    const drive: ZdrojExportu = {
      nacti: async () => [soubor(jmeno("10_00"), csv(["A1;1;O-1;Zaparkovaná;Inst_Pristupu_FTTH;;;"]))],
      oznacZpracovano: async (d) => void oznacene.push(d.nazev),
    };
    const rozbity: ZdrojExportu = { nacti: async () => { throw new Error("Gmail nedostupný"); }, oznacZpracovano: async () => {} };
    const r = await spustImport(db, [rozbity, drive]);
    expect(r).toHaveLength(1);
    expect(oznacene).toEqual([jmeno("10_00")]);
  });
});
