// Uložení importu do databáze: log příjmu, upsert zakázek, historie stavů, uzavřené zakázky.

import { createHash } from "node:crypto";
import type { Zakazka } from "../import/mwfExport.js";
import type { DoslyExport, Posouzeni, StavPrijmu } from "../ingest/prijem.js";
import { ts, type Db, type Dotaz } from "./db.js";

export async function nactiStavPrijmu(db: Dotaz): Promise<StavPrijmu> {
  const { rows } = await db.query<{ posledni: Date | null }>(
    "SELECT max(export_at) AS posledni FROM import_run WHERE vysledek = 'importovano'",
  );
  // soubor přeskočený jako „starší“ se smí posoudit znovu (špatné datum v názvu, ověří se vznikem souboru)
  const hashe = await db.query<{ hash: string }>(
    "SELECT DISTINCT hash FROM import_run WHERE vysledek = 'importovano' OR (vysledek = 'preskoceno' AND duvod NOT LIKE 'Export je starší%')",
  );
  return { posledniExportAt: rows[0]?.posledni ?? null, zpracovane: new Set(hashe.rows.map((r) => r.hash)) };
}

export interface VysledekUlozeni {
  importId: number;
  nove: number;
  zmenene: number;
  uzavrene: number;
}

const VYSLEDEK_DB = { importovat: "importovano", preskocit: "preskoceno", odmitnout: "odmitnuto" } as const;

/** Zapíše došlý soubor do logu; při „importovat“ v jedné transakci uloží i zakázky. */
export async function ulozPrijem(db: Db, d: DoslyExport, p: Posouzeni): Promise<VysledekUlozeni | null> {
  return db.tx(async (q) => {
    const { rows } = await q.query<{ id: number }>(
      `INSERT INTO import_run (zdroj, soubor, hash, odesilatel, zdroj_id, export_at, vysledek, duvod, pocet, chybejici_sloupce, prijato)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        d.zdroj, d.nazev, p.hash, d.odesilatel ?? null, d.zdrojId ?? null,
        p.akce === "importovat" ? ts(p.exportAt) : null,
        VYSLEDEK_DB[p.akce], p.akce === "importovat" ? null : p.duvod,
        p.akce === "importovat" ? p.import.zakazky.length : null,
        p.akce === "importovat" ? p.import.chybejiciSloupce : [],
        d.prijato,
      ],
    );
    const importId = Number(rows[0]!.id);
    if (p.akce !== "importovat") return null;
    return { importId, ...(await ulozZakazky(q, p.import.zakazky, importId, p.exportAt)) };
  });
}

const otiskPoznamky = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

async function ulozZakazky(q: Dotaz, zakazky: Zakazka[], importId: number, exportAt: Date) {
  const existujici = new Map(
    (await q.query<{ id_aktivity: string; stav_mwf: string; parkovani: string | null; vysledek: string | null; termin_od: Date | null; technik: string | null; poznamka_hash: string }>(
      "SELECT id_aktivity, stav_mwf, parkovani, vysledek, termin_od, technik, poznamka_hash FROM zakazka WHERE uzavreno IS NULL",
    )).rows.map((r) => [r.id_aktivity, r]),
  );
  let nove = 0;
  let zmenene = 0;

  for (const z of zakazky) {
    const hash = otiskPoznamky(z.poznamka);
    const pred = existujici.get(z.idAktivity);
    existujici.delete(z.idAktivity);
    const zmena =
      !pred ||
      pred.stav_mwf !== z.stavMwf || pred.parkovani !== z.parkovani || pred.vysledek !== z.vysledek ||
      pred.technik !== z.technik || ts(pred.termin_od) !== ts(z.termin?.od) || pred.poznamka_hash !== hash;
    if (!pred) nove++;
    else if (zmena) zmenene++;

    await q.query(
      `INSERT INTO zakazka (id_aktivity, id_objednavky, id_objednavky_mwf, id_objednavky_zaklad, id_s7, technik, stav_mwf, typ_aktivity,
         infrastruktura, predobjednavka, zakaznik, telefony, psc, adresa, subregion, balik, produkt, prideleno, termin_od, termin_do,
         parkovani, parkovani_skupina, parkovani_nestandardni, vysledek, preferovany_datum, rfs, do_splneni_min, poznamka, poznamka_hash,
         pocet_mv, prvni_import, posledni_import, uzavreno)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$31,NULL)
       ON CONFLICT (id_aktivity) DO UPDATE SET
         id_objednavky = EXCLUDED.id_objednavky, id_objednavky_mwf = EXCLUDED.id_objednavky_mwf, id_objednavky_zaklad = EXCLUDED.id_objednavky_zaklad,
         id_s7 = EXCLUDED.id_s7, technik = EXCLUDED.technik, stav_mwf = EXCLUDED.stav_mwf, typ_aktivity = EXCLUDED.typ_aktivity,
         infrastruktura = EXCLUDED.infrastruktura, predobjednavka = EXCLUDED.predobjednavka, zakaznik = EXCLUDED.zakaznik,
         telefony = EXCLUDED.telefony, psc = EXCLUDED.psc, adresa = EXCLUDED.adresa, subregion = EXCLUDED.subregion,
         balik = EXCLUDED.balik, produkt = EXCLUDED.produkt, prideleno = EXCLUDED.prideleno, termin_od = EXCLUDED.termin_od,
         termin_do = EXCLUDED.termin_do, parkovani = EXCLUDED.parkovani, parkovani_skupina = EXCLUDED.parkovani_skupina,
         parkovani_nestandardni = EXCLUDED.parkovani_nestandardni, vysledek = EXCLUDED.vysledek,
         preferovany_datum = EXCLUDED.preferovany_datum, rfs = EXCLUDED.rfs, do_splneni_min = EXCLUDED.do_splneni_min,
         poznamka = EXCLUDED.poznamka, poznamka_hash = EXCLUDED.poznamka_hash, pocet_mv = EXCLUDED.pocet_mv,
         posledni_import = EXCLUDED.posledni_import, uzavreno = NULL`,
      [
        z.idAktivity, z.idObjednavky, z.idObjednavkyMwf, z.idObjednavkyZaklad, z.idS7 || null, z.technik || null, z.stavMwf, z.typAktivity,
        z.infrastruktura, z.predobjednavka, z.zakaznik || null, z.telefony, z.psc || null, z.adresa || null, z.subregion || null,
        z.balik || null, z.produkt || null, ts(z.prideleno), ts(z.termin?.od), ts(z.termin?.do), z.parkovani, z.parkovaniSkupina,
        z.parkovaniNestandardni, z.vysledek, ts(z.preferovanyDatum), ts(z.rfs), z.doSplneniMin, z.poznamka, hash, z.pocetMv, importId,
      ],
    );
    if (zmena) {
      await q.query(
        `INSERT INTO zakazka_historie (id_aktivity, import_id, stav_mwf, parkovani, vysledek, termin_od, technik) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [z.idAktivity, importId, z.stavMwf, z.parkovani, z.vysledek, ts(z.termin?.od), z.technik || null],
      );
    }
  }

  // Zakázky, které v exportu už nejsou = uzavřené v MWF (instalace / storno / předání jinam)
  const uzavrene = [...existujici.keys()];
  if (uzavrene.length) {
    await q.query("UPDATE zakazka SET uzavreno = $1 WHERE id_aktivity = ANY($2::text[])", [ts(exportAt), uzavrene]);
  }
  return { nove, zmenene, uzavrene: uzavrene.length };
}
