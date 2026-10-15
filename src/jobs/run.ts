// Spouštěcí skript Cloud Run jobu „appkoo-import“ – spouští ho Cloud Scheduler (každých 15 min).
//
// Proměnné prostředí:
//   DATABASE_URL          připojení k Cloud SQL (secret), např. postgresql://appkoo:…@/appkoo?host=/cloudsql/…
//   MWF_SLOZKA            ID složky s MWF exporty na Google Drive (nasdílená servisnímu účtu jako čtenáři)
//   GMAIL_SCHRANKA        volitelně: schránka s exporty v příloze (vyžaduje delegaci v rámci domény)
//   POVOLENI_ODESILATELE  volitelně: povolení odesílatelé e-mailů, čárkami (výchozí @ictmount.com)
//   STARY_EXPORT_HODIN    volitelně: po kolika hodinách bez nového exportu zalogovat varování (výchozí 6)
//
// Výstup jsou řádky JSON pro Cloud Logging (pole „severity“). Když některý zdroj nejde načíst,
// job skončí s kódem 1 → Cloud Run ho označí jako neúspěšný a Monitoring pošle upozornění.

import { pathToFileURL } from "node:url";
import type { Db } from "../db/db.js";
import { pgDb, ts } from "../db/db.js";
import { tedPraha } from "../domain/time.js";
import { driveZdroj, gmailZdroj, type ZdrojExportu } from "../ingest/google.js";
import { spustImport, type ZaznamBehu } from "./importJob.js";

export type Zavaznost = "INFO" | "WARNING" | "ERROR";
export type Logger = (severity: Zavaznost, message: string, data?: Record<string, unknown>) => void;

export const jsonLog: Logger = (severity, message, data = {}) => {
  console.log(JSON.stringify({ severity, message, ...data }));
};

/**
 * Čitelný popis chyby. U chyb Google API (gaxios) přidá důvod z odpovědi a volanou adresu,
 * protože samotné „Request failed with status code 403“ neřekne, co je špatně.
 */
export function popisChyby(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const g = e as Error & {
    response?: { status?: number; data?: unknown };
    config?: { url?: unknown };
  };
  const casti = [e.message];
  const data = g.response?.data;
  let detail: unknown = data;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) detail = Buffer.from(data as ArrayBuffer).toString("utf8");
  if (typeof detail === "string") {
    try { detail = JSON.parse(detail); } catch { /* text ponechat */ }
  }
  const err = (detail as { error?: { message?: string; errors?: { reason?: string }[] } } | undefined)?.error;
  if (err?.message) casti.push(`důvod: ${err.message}${err.errors?.[0]?.reason ? ` (${err.errors[0].reason})` : ""}`);
  else if (typeof detail === "string" && detail.trim()) casti.push(`odpověď: ${detail.trim().slice(0, 300)}`);
  const url = g.config?.url ? String(g.config.url).split("?")[0] : undefined;
  if (url) casti.push(`adresa: ${url}`);
  return casti.join(" | ");
}

/** Obalí zdroj, aby šlo poznat jeho výpadek – spustImport chybu jen zaloguje a pokračuje dál. */
export function sledovanyZdroj(nazev: string, z: ZdrojExportu, chyby: string[]): ZdrojExportu {
  return {
    async nacti(od) {
      try {
        return await z.nacti(od);
      } catch (e) {
        chyby.push(`${nazev}: ${popisChyby(e)}`);
        throw e;
      }
    },
    oznacZpracovano: (d) => z.oznacZpracovano(d),
  };
}

export interface VysledekBehu {
  vysledky: ZaznamBehu[];
  chyby: string[];
  /** stáří posledního importovaného exportu v hodinách (null = zatím žádný) */
  stariExportuHodin: number | null;
  /** návratový kód procesu: 0 = v pořádku, 1 = výpadek zdroje */
  kod: 0 | 1;
}

/** Jeden běh importu: načte zdroje, uloží exporty, zkontroluje stáří posledního exportu. */
export async function behImportu(
  db: Db,
  zdroje: { nazev: string; zdroj: ZdrojExportu }[],
  opts: { povoleniOdesilatele?: string[]; staryExportHodin?: number; ted?: Date; log?: Logger } = {},
): Promise<VysledekBehu> {
  const log = opts.log ?? jsonLog;
  const chyby: string[] = [];
  const sledovane = zdroje.map(({ nazev, zdroj }) => sledovanyZdroj(nazev, zdroj, chyby));

  const vysledky = await spustImport(db, sledovane, opts.povoleniOdesilatele?.length ? opts.povoleniOdesilatele : undefined);
  for (const v of vysledky) {
    log(v.vysledek === "odmitnout" ? "WARNING" : "INFO", `${v.vysledek}: ${v.soubor}`, {
      soubor: v.soubor,
      zdroj: v.zdroj,
      vysledek: v.vysledek,
      ...(v.duvod ? { duvod: v.duvod } : {}),
      ...(v.ulozeno ? { ulozeno: v.ulozeno } : {}),
    });
  }
  for (const c of chyby) log("ERROR", `Zdroj exportu nedostupný – ${c}`, { vypadek_zdroje: true });

  // Hlídání „nový export nepřišel“: časy v DB jsou místní čas Praha uložený jako UTC (src/domain/time.ts)
  // (rozdíl se počítá v SQL, aby nezáleželo na tom, jak ovladač převádí timestamp bez zóny)
  const { rows } = await db.query<{ hodin: number | string | null }>(
    "SELECT extract(epoch FROM ($1::timestamp - max(export_at))) / 3600 AS hodin FROM import_run WHERE vysledek = 'importovano'",
    [ts(opts.ted ?? tedPraha())],
  );
  const hodin = rows[0]?.hodin;
  const stariExportuHodin = hodin === null || hodin === undefined ? null : Math.round(Number(hodin) * 10) / 10;
  const limit = opts.staryExportHodin ?? 6;
  if (stariExportuHodin !== null && stariExportuHodin > limit) {
    log("WARNING", `Poslední importovaný MWF export je starý ${stariExportuHodin} h (limit ${limit} h).`, { stary_export: true, stari_hodin: stariExportuHodin });
  }

  const souhrn = {
    importovano: vysledky.filter((v) => v.vysledek === "importovat").length,
    preskoceno: vysledky.filter((v) => v.vysledek === "preskocit").length,
    odmitnuto: vysledky.filter((v) => v.vysledek === "odmitnout").length,
    vypadky: chyby.length,
    stari_hodin: stariExportuHodin,
  };
  log(chyby.length ? "ERROR" : "INFO", "Běh importu dokončen", { souhrn });

  return { vysledky, chyby, stariExportuHodin, kod: chyby.length ? 1 : 0 };
}

async function main(): Promise<number> {
  const env = process.env;
  if (!env.DATABASE_URL) throw new Error("Chybí proměnná DATABASE_URL.");
  if (!env.MWF_SLOZKA) throw new Error("Chybí proměnná MWF_SLOZKA (ID složky s MWF exporty na Drive).");

  const zdroje = [{ nazev: "drive", zdroj: driveZdroj(env.MWF_SLOZKA) }];
  if (env.GMAIL_SCHRANKA) zdroje.push({ nazev: "email", zdroj: gmailZdroj({ schranka: env.GMAIL_SCHRANKA }) });

  const { kod } = await behImportu(pgDb(env.DATABASE_URL), zdroje, {
    povoleniOdesilatele: env.POVOLENI_ODESILATELE?.split(",").map((s) => s.trim()).filter(Boolean),
    staryExportHodin: env.STARY_EXPORT_HODIN ? Number(env.STARY_EXPORT_HODIN) : undefined,
  });
  return kod;
}

// Spuštění jen při přímém volání (ne při importu z testů)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (kod) => process.exit(kod),
    (e) => {
      jsonLog("ERROR", `Import selhal: ${e instanceof Error ? e.message : String(e)}`, { stack: e instanceof Error ? e.stack : undefined });
      process.exit(1);
    },
  );
}
