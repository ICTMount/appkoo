// Číselníky v databázi: načtení a uložení importu z CSV (s historií změn).

import type { CiselnikId, NahledImportu, Polozka } from "../config/ciselniky.js";
import { CISELNIKY } from "../config/ciselniky.js";
import type { Db, Dotaz } from "./db.js";

/**
 * Krátká cache číselníků v paměti instance (30 s): role uživatele a Nastavení plánování se čtou
 * při každém požadavku. Uložení číselníku cache dané databáze hned vyprázdní; jiné instance
 * Cloud Run uvidí změnu nejpozději za 30 s.
 */
const CACHE_MS = 30_000;
const cache = new WeakMap<Dotaz, Map<string, { do: number; data: Promise<Polozka[]> }>>();

export function vyprazdniCacheCiselniku(db: Dotaz) {
  cache.delete(db);
}

export async function nactiCiselnik(db: Dotaz, id: CiselnikId, jenAktivni = true): Promise<Polozka[]> {
  let mapa = cache.get(db);
  if (!mapa) cache.set(db, (mapa = new Map()));
  const klic = `${id}|${jenAktivni}`;
  const hit = mapa.get(klic);
  if (hit && hit.do > Date.now()) return hit.data;
  const data = db
    .query<{ data: Polozka }>(`SELECT data FROM ciselnik_polozka WHERE ciselnik = $1 ${jenAktivni ? "AND aktivni" : ""} ORDER BY klic`, [id])
    .then((r) => r.rows.map((x) => x.data));
  mapa.set(klic, { do: Date.now() + CACHE_MS, data });
  data.catch(() => mapa!.delete(klic));
  return data;
}

const klicPolozky = (id: CiselnikId, p: Polozka) => String(p[CISELNIKY[id].klic] ?? "").trim();

/**
 * Uloží náhled importu: nové a změněné položky; v režimu „nahradit“ deaktivuje položky, které v CSV chybí.
 * Každá změna se zapíše do historie (ciselnik_zmena).
 */
export async function ulozImport(
  db: Db,
  id: CiselnikId,
  n: NahledImportu,
  zdroj: string,
  zmenil: string,
  nahradit = false,
): Promise<{ pridano: number; zmeneno: number; odebrano: number }> {
  if (!n.lzeUlozit) throw new Error("Import obsahuje chyby – nelze uložit.");
  vyprazdniCacheCiselniku(db);
  const vysledek = await db.tx(async (q) => {
    const uloz = async (p: Polozka, akce: "pridano" | "zmeneno", pred: Polozka | null) => {
      const klic = klicPolozky(id, p);
      const aktivni = p.aktivni === undefined ? true : p.aktivni !== false;
      await q.query(
        `INSERT INTO ciselnik_polozka (ciselnik, klic, data, aktivni, zmeneno, zmenil) VALUES ($1,$2,$3,$4,now(),$5)
         ON CONFLICT (ciselnik, klic) DO UPDATE SET data = EXCLUDED.data, aktivni = EXCLUDED.aktivni, zmeneno = now(), zmenil = EXCLUDED.zmenil`,
        [id, klic, JSON.stringify(p), aktivni, zmenil],
      );
      await q.query(
        "INSERT INTO ciselnik_zmena (ciselnik, klic, akce, pred, po, zdroj, zmenil) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, klic, akce, pred ? JSON.stringify(pred) : null, JSON.stringify(p), zdroj, zmenil],
      );
    };
    for (const p of n.nove) await uloz(p, "pridano", null);
    for (const z of n.zmenene) await uloz(z.po, "zmeneno", z.pred);
    let odebrano = 0;
    if (nahradit) {
      for (const p of n.chybiVCsv) {
        const klic = klicPolozky(id, p);
        await q.query("UPDATE ciselnik_polozka SET aktivni = false, zmeneno = now(), zmenil = $3 WHERE ciselnik = $1 AND klic = $2", [id, klic, zmenil]);
        await q.query(
          "INSERT INTO ciselnik_zmena (ciselnik, klic, akce, pred, po, zdroj, zmenil) VALUES ($1,$2,'odebrano',$3,NULL,$4,$5)",
          [id, klic, JSON.stringify(p), zdroj, zmenil],
        );
        odebrano++;
      }
    }
    return { pridano: n.nove.length, zmeneno: n.zmenene.length, odebrano };
  });
  vyprazdniCacheCiselniku(db);
  return vysledek;
}
