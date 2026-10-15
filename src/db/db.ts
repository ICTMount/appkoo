// Přístup k PostgreSQL. V provozu pg (Cloud SQL), v testech PGlite – obojí přes stejné rozhraní.

import pg from "pg";

export interface Dotaz {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface Db extends Dotaz {
  /** Spustí funkci v transakci; při chybě vše vrátí zpět */
  tx<T>(fn: (q: Dotaz) => Promise<T>): Promise<T>;
}

export function pgDb(connectionString = process.env.DATABASE_URL): Db {
  // timestamp bez časové zóny = místní čas Praha uložený jako UTC Date (viz src/domain/time.ts)
  pg.types.setTypeParser(1114, (s) => new Date(s.replace(" ", "T") + "Z"));
  const pool = new pg.Pool({ connectionString });
  return {
    query: async (sql, params) => pool.query(sql, params as unknown[]) as never,
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn({ query: async (sql, params) => c.query(sql, params as unknown[]) as never });
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  };
}

/** Timestamp bez zóny pro SQL: Date („Praha v UTC“) → '2026-10-14 18:01:00' */
export function ts(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 19).replace("T", " ") : null;
}
