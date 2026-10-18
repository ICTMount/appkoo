import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("schéma databáze", () => {
  it("jde aplikovat na PostgreSQL a obsahuje všechny tabulky", async () => {
    const db = new PGlite();
    await db.exec(readFileSync("db/schema.sql", "utf8"));
    const { rows } = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by 1",
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      "ciselnik_polozka", "ciselnik_zmena", "gcal_udalost", "geokod", "import_run", "note_eval", "pokus", "uzivatel_log", "zakazka", "zakazka_historie",
    ]);
    await db.close();
  }, 60_000); // první start PGlite (WASM) trvá několik sekund
});
