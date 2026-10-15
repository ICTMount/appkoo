import { PGlite } from "@electric-sql/pglite";
import iconv from "iconv-lite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/db.js";
import type { ZdrojExportu } from "../src/ingest/google.js";
import type { DoslyExport } from "../src/ingest/prijem.js";
import { behImportu, type Logger } from "../src/jobs/run.js";

function pgliteDb(pg: PGlite): Db {
  return {
    query: (sql, params) => pg.query(sql, params) as never,
    tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never })),
  };
}

const HLAVICKA = "ID aktivity;ID objednávky;ID obj. v ext. systéme;Stav;Typ aktivity;Poznámka;Dôvod parkovania;Dohodnutý termín";
const csv = (radky: string[]) => iconv.encode([HLAVICKA, ...radky].join("\r\n"), "win1250");
const soubor = (hhmm: string): DoslyExport => ({
  zdroj: "drive",
  nazev: `zakazky paw-grid-export-csv 20261015 ${hhmm}.csv`,
  obsah: csv(["A1;1;O-1000000001;Riešená dodávateľom - odovzdaná;Inst_Pristupu_FTTH;;;"]),
  prijato: new Date(),
});

const zdrojZ = (soubory: DoslyExport[]): ZdrojExportu => ({ nacti: async () => soubory, oznacZpracovano: async () => {} });
const vypadek: ZdrojExportu = { nacti: async () => { throw new Error("403 Forbidden"); }, oznacZpracovano: async () => {} };
// Praha jako UTC (src/domain/time.ts)
const praha = (iso: string) => new Date(`${iso}Z`);

let db: Db;
let logy: { severity: string; message: string; data?: Record<string, unknown> }[];
const log: Logger = (severity, message, data) => { logy.push({ severity, message, data }); };

beforeEach(async () => {
  const pg = new PGlite();
  await pg.exec(readFileSync("db/schema.sql", "utf8"));
  db = pgliteDb(pg);
  logy = [];
}, 60_000);

describe("spouštěcí skript importu (Cloud Run job)", () => {
  it("naimportuje export z Drive a skončí kódem 0", async () => {
    const r = await behImportu(db, [{ nazev: "drive", zdroj: zdrojZ([soubor("09_00")]) }], { ted: praha("2026-10-15T09:15:00"), log });
    expect(r.kod).toBe(0);
    expect(r.vysledky[0]).toMatchObject({ vysledek: "importovat" });
    expect(r.stariExportuHodin).toBe(0.3);
    expect(logy.at(-1)).toMatchObject({ severity: "INFO", message: "Běh importu dokončen" });
  });

  it("výpadek zdroje zaloguje jako chybu a vrátí kód 1, ostatní zdroje se zpracují", async () => {
    const r = await behImportu(db, [{ nazev: "drive", zdroj: vypadek }, { nazev: "email", zdroj: zdrojZ([soubor("10_00")]) }], { ted: praha("2026-10-15T10:05:00"), log });
    expect(r.kod).toBe(1);
    expect(r.chyby).toEqual(["drive: 403 Forbidden"]);
    expect(r.vysledky).toHaveLength(1);
    expect(logy.some((l) => l.severity === "ERROR" && l.data?.vypadek_zdroje === true)).toBe(true);
  });

  it("upozorní, když poslední export je starší než limit", async () => {
    await behImportu(db, [{ nazev: "drive", zdroj: zdrojZ([soubor("06_00")]) }], { ted: praha("2026-10-15T06:10:00"), log });
    logy = [];
    const r = await behImportu(db, [{ nazev: "drive", zdroj: zdrojZ([]) }], { ted: praha("2026-10-15T13:30:00"), staryExportHodin: 6, log });
    expect(r.kod).toBe(0);
    expect(r.stariExportuHodin).toBe(7.5);
    expect(logy.some((l) => l.severity === "WARNING" && l.data?.stary_export === true)).toBe(true);
  });
});
