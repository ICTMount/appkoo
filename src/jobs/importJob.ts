// Automatický import MWF exportu – spouští Cloud Scheduler (např. každých 15 min).
// Projde všechny zdroje (Drive, e-mail), soubory posoudí, uloží a označí jako zpracované.
// Nahrání v aplikaci volá stejnou cestu přes prijmiSoubory().

import type { Db } from "../db/db.js";
import { nactiStavPrijmu, ulozPrijem, type VysledekUlozeni } from "../db/zakazky.js";
import type { ZdrojExportu } from "../ingest/google.js";
import { zpracujDosle, type DoslyExport, type Posouzeni } from "../ingest/prijem.js";

export interface ZaznamBehu {
  soubor: string;
  zdroj: DoslyExport["zdroj"];
  vysledek: Posouzeni["akce"];
  duvod?: string;
  ulozeno?: VysledekUlozeni | null;
}

export async function prijmiSoubory(db: Db, dosle: DoslyExport[], povoleniOdesilatele?: string[]): Promise<ZaznamBehu[]> {
  const stav = await nactiStavPrijmu(db);
  const vysledky: ZaznamBehu[] = [];
  for (const { export: d, posouzeni } of zpracujDosle(dosle, stav, povoleniOdesilatele)) {
    const ulozeno = await ulozPrijem(db, d, posouzeni);
    vysledky.push({
      soubor: d.nazev,
      zdroj: d.zdroj,
      vysledek: posouzeni.akce,
      ...(posouzeni.akce === "importovat" ? { ulozeno } : { duvod: posouzeni.duvod }),
    });
  }
  return vysledky;
}

export async function spustImport(db: Db, zdroje: ZdrojExportu[], povoleniOdesilatele?: string[]): Promise<ZaznamBehu[]> {
  const { rows } = await db.query<{ posledni: Date | null }>("SELECT max(prijato) AS posledni FROM import_run WHERE zdroj = 'drive'");
  // Hodina rezerva: soubor nahraný na Drive těsně před minulým během se nesmí ztratit (duplicity řeší otisk)
  const od = rows[0]?.posledni ? new Date(rows[0].posledni.getTime() - 60 * 60 * 1000) : null;

  const dosle: { d: DoslyExport; z: ZdrojExportu }[] = [];
  for (const z of zdroje) {
    try {
      for (const d of await z.nacti(od)) dosle.push({ d, z });
    } catch (e) {
      // Výpadek jednoho zdroje nesmí zastavit ostatní; chyba jde do logu (Cloud Logging → upozornění)
      console.error("Zdroj exportu nedostupný:", e instanceof Error ? e.message : e);
    }
  }
  const vysledky = await prijmiSoubory(db, dosle.map((x) => x.d), povoleniOdesilatele);
  for (const { d, z } of dosle) await z.oznacZpracovano(d);
  return vysledky;
}
