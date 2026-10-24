// Notifikační PDF z MWF (složka na Google Drive, soubor = <MWF ID aktivity>.pdf).
// Z textu PDF (pdftotext -layout) se vytáhne „Inštalačný predpis k“ a ze „Zoznam KZ“ jen režim KZ
// (CPE Mode) a seznam kompatibilních zařízení. Výpis se ukáže v detailu zakázky.

import { execFile } from "node:child_process";
import type { drive_v3 } from "@googleapis/drive";
import type { Dotaz } from "../db/db.js";
import { zakladniCisloObjednavky } from "../domain/slovnik.js";

export interface Notifikace {
  /** MWF ID aktivity (z textu PDF, jinak z názvu souboru) */
  idAktivity: string;
  /** Identifikátor O-… (ID obj. v ext. systému) */
  idObjednavky: string | null;
  /** O-… bez přípon – párování se zakázkou (stačí shoda O-čísla) */
  idObjednavkyZaklad: string | null;
  /** ID S7 z PDF: „ID objednávky/TT“ (1-DDWV6LB) a část za # v Identifikátoru (1-DDWX4YA) – párování s „ID S7 obj.“ */
  idS7: string[];
  /** řádky oddílu „Inštalačný predpis k“ (bez prázdných) */
  predpis: string[];
  /** Zoznam KZ → CPE Mode (Route / Bridge…) */
  cpeMode: string | null;
  /** Zoznam KZ → Zoznam kompatibilných zariadení */
  zoznam: string | null;
}

export interface UlozenaNotifikace extends Notifikace {
  souborId: string;
  nazev: string;
  vznik: Date;
}

const ZNAME_REZIMY = /^(route|routed|router|bridge|bridged)$/i;

/** Slova řádku s pozicí (sloupcem), ve které začínají – pro čtení tabulky z „-layout“ textu. */
function slova(radek: string): { od: number; text: string }[] {
  const v: { od: number; text: string }[] = [];
  for (const m of radek.matchAll(/\S+/g)) v.push({ od: m.index, text: m[0] });
  return v;
}

const uklid = (s: string) => s.replace(/\s+/g, " ").trim();

/** Režim KZ a kompatibilní zařízení ze „Zoznam KZ“. Nejdřív podle sloupců tabulky, jinak podle známých hodnot. */
export function parsujKz(radky: string[]): { cpeMode: string | null; zoznam: string | null } {
  const iHlavicka = radky.findIndex((r) => /CPE\s+Mode/i.test(r));
  if (iHlavicka >= 0) {
    const cpeOd = radky[iHlavicka]!.search(/CPE\s+Mode/i);
    // záhlaví posledního sloupce je na víc řádcích („Zoznam / kompatibilných / zariadení“) – vzít nejlevější začátek
    let zozOd = Infinity;
    let konecHlavicky = iHlavicka;
    for (let i = Math.max(0, iHlavicka - 3); i < Math.min(radky.length, iHlavicka + 4); i++) {
      for (const s of slova(radky[i]!)) {
        if (/^(Zoznam|kompatibiln[yý]ch|zariaden[ií])$/i.test(s.text) && s.od > cpeOd) {
          zozOd = Math.min(zozOd, s.od);
          konecHlavicky = Math.max(konecHlavicky, i);
        }
      }
    }
    if (zozOd === Infinity) zozOd = cpeOd + 12;
    const cpe: string[] = [];
    const zoz: string[] = [];
    for (const r of radky.slice(konecHlavicky + 1)) {
      for (const s of slova(r)) {
        if (s.od >= zozOd - 2) zoz.push(s.text);
        else if (s.od >= cpeOd - 2) cpe.push(s.text);
      }
    }
    if (cpe.length || zoz.length) return { cpeMode: cpe.join(" ") || null, zoznam: zoz.join(" ") || null };
  }
  // text bez sloupců (např. slitý do jednoho řádku): režim je známé slovo, zařízení jsou za ním
  const tokeny = uklid(radky.join(" ")).split(" ");
  const iZariadeni = tokeny.findIndex((t) => /^zariaden[ií]$/i.test(t));
  const iRezim = tokeny.findIndex((t, i) => i > iZariadeni && ZNAME_REZIMY.test(t));
  if (iRezim < 0) return { cpeMode: null, zoznam: null };
  return { cpeMode: tokeny[iRezim]!, zoznam: tokeny.slice(iRezim + 1).join(" ") || null };
}

/** Rozbor textu notifikačního PDF (výstup `pdftotext -layout`). null = není notifikace z MWF. */
export function parsujNotifikaci(text: string, nazevSouboru = ""): Notifikace | null {
  const radky = text.split(/\r?\n/);
  const idZTextu = text.match(/MWF ID aktivity:\s*(\d+)/)?.[1] ?? null;
  const idZNazvu = nazevSouboru.match(/^(\d+)\.pdf$/i)?.[1] ?? null;
  const idAktivity = idZTextu ?? idZNazvu;
  if (!idAktivity) return null;
  const idObjednavky = text.match(/Identifikátor:\s*(O-[\w#-]+)/)?.[1] ?? text.match(/\b(O-\d{6,})\b/)?.[1] ?? null;
  const idS7 = [...new Set([
    ...[...text.matchAll(/ID objednávky(?:\/TT)?:\s*(1-[A-Z0-9]{6,})/g)].map((m) => m[1]!.toUpperCase()),
    ...[...(idObjednavky ?? "").matchAll(/#(1-[A-Z0-9]{6,})/gi)].map((m) => m[1]!.toUpperCase()),
  ])];

  const iPredpis = radky.findIndex((r) => /Inštalačný predpis k/i.test(r));
  const iKz = radky.findIndex((r, i) => i > iPredpis && /Zoznam KZ\s*:/i.test(r));
  const predpis: string[] = [];
  if (iPredpis >= 0) {
    const konec = iKz >= 0 ? iKz + 1 : radky.length;
    for (let i = iPredpis; i < konec; i++) {
      let r = radky[i]!;
      if (i === iPredpis) r = r.slice(r.search(/Inštalačný predpis k/i) + "Inštalačný predpis k".length); // na stejném řádku bývá konec předchozího oddílu
      if (i === iKz) r = r.replace(/Zoznam KZ\s*:[\s\S]*$/i, ""); // „Zoznam KZ:“ bývá na konci posledního řádku poznámky
      const c = uklid(r);
      if (c) predpis.push(c);
    }
  }
  const kzRadky = iKz >= 0 ? [radky[iKz]!.replace(/^[\s\S]*?Zoznam KZ\s*:/i, (m) => " ".repeat(m.length)), ...radky.slice(iKz + 1)] : [];
  const { cpeMode, zoznam } = parsujKz(kzRadky);
  return { idAktivity, idObjednavky, idObjednavkyZaklad: idObjednavky ? zakladniCisloObjednavky(idObjednavky) : null, idS7, predpis: predpis.filter((p) => p !== ""), cpeMode, zoznam };
}

/** Text PDF přes poppler (`pdftotext -layout`), v image je balík poppler-utils. */
export function textZPdf(pdf: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = execFile("pdftotext", ["-layout", "-enc", "UTF-8", "-", "-"], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      // pdftotext hlásí drobné chyby syntaxe PDF na stderr a přesto text vrátí – stačí nenulový výstup
      if (err && !stdout) reject(new Error(`pdftotext selhal: ${err.message}`));
      else resolve(stdout);
    });
    p.stdin?.on("error", () => undefined);
    p.stdin?.end(pdf);
  });
}

// ---------- uložení a import ----------

const TABULKA = `CREATE TABLE IF NOT EXISTS notifikace_pdf (
  soubor_id     text PRIMARY KEY,
  nazev         text NOT NULL,
  vznik         timestamptz NOT NULL,
  id_aktivity   text,
  id_objednavky text,
  id_objednavky_zaklad text,
  id_s7         text[],
  predpis       text[],
  cpe_mode      text,
  zoznam        text,
  chyba         text,
  nacteno       timestamptz NOT NULL DEFAULT now()
)`;

let pripraveno: Promise<unknown> | null = null;
const priprav = (db: Dotaz) =>
  (pripraveno ??= db
    .query(TABULKA)
    .then(() => db.query("ALTER TABLE notifikace_pdf ADD COLUMN IF NOT EXISTS id_objednavky_zaklad text"))
    .then(() => db.query("ALTER TABLE notifikace_pdf ADD COLUMN IF NOT EXISTS id_s7 text[]"))
    .then(() => db.query("UPDATE notifikace_pdf SET id_objednavky_zaklad = upper(substring(id_objednavky from '^O-[0-9]+')) WHERE id_objednavky_zaklad IS NULL AND id_objednavky IS NOT NULL"))
    .then(() => db.query("CREATE INDEX IF NOT EXISTS notifikace_pdf_aktivita ON notifikace_pdf (id_aktivity, vznik DESC)"))
    .then(() => db.query("CREATE INDEX IF NOT EXISTS notifikace_pdf_objednavka ON notifikace_pdf (id_objednavky_zaklad, vznik DESC)"))
    .catch((e) => {
      pripraveno = null;
      throw e;
    }));

export async function ulozNotifikaci(db: Dotaz, n: UlozenaNotifikace | { souborId: string; nazev: string; vznik: Date; chyba: string }): Promise<void> {
  await priprav(db);
  if ("chyba" in n) {
    await db.query(
      `INSERT INTO notifikace_pdf (soubor_id, nazev, vznik, chyba) VALUES ($1, $2, $3, $4)
       ON CONFLICT (soubor_id) DO UPDATE SET chyba = EXCLUDED.chyba, nacteno = now()`,
      [n.souborId, n.nazev, n.vznik, n.chyba],
    );
    return;
  }
  await db.query(
    `INSERT INTO notifikace_pdf (soubor_id, nazev, vznik, id_aktivity, id_objednavky, id_objednavky_zaklad, id_s7, predpis, cpe_mode, zoznam, chyba)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)
     ON CONFLICT (soubor_id) DO UPDATE SET id_aktivity = EXCLUDED.id_aktivity, id_objednavky = EXCLUDED.id_objednavky, id_objednavky_zaklad = EXCLUDED.id_objednavky_zaklad,
       id_s7 = EXCLUDED.id_s7, predpis = EXCLUDED.predpis, cpe_mode = EXCLUDED.cpe_mode, zoznam = EXCLUDED.zoznam, chyba = NULL, nacteno = now()`,
    [n.souborId, n.nazev, n.vznik, n.idAktivity, n.idObjednavky, n.idObjednavkyZaklad, n.idS7, n.predpis, n.cpeMode, n.zoznam],
  );
}

/**
 * Nejnovější notifikace k zakázce (null = PDF zatím nedorazilo). Pořadí párování:
 * 1. stejné MWF ID aktivity, 2. ID S7 obj. zakázky je v PDF (ID objednávky/TT nebo část za #), 3. stejné O-číslo.
 */
export async function nactiNotifikaci(db: Dotaz, idAktivity: string, klice: { idObjednavkyZaklad?: string | null; idS7?: string | null } = {}): Promise<UlozenaNotifikace | null> {
  try {
    await priprav(db);
    const zaklad = klice.idObjednavkyZaklad ? zakladniCisloObjednavky(klice.idObjednavkyZaklad) : null;
    const s7 = klice.idS7?.trim().toUpperCase() || null;
    const { rows } = await db.query<{ soubor_id: string; nazev: string; vznik: Date; id_aktivity: string; id_objednavky: string | null; id_objednavky_zaklad: string | null; id_s7: string[] | null; predpis: string[] | null; cpe_mode: string | null; zoznam: string | null }>(
      `SELECT soubor_id, nazev, vznik, id_aktivity, id_objednavky, id_objednavky_zaklad, id_s7, predpis, cpe_mode, zoznam FROM notifikace_pdf
        WHERE chyba IS NULL AND (id_aktivity = $1 OR ($2::text IS NOT NULL AND $2 = ANY(id_s7)) OR ($3::text IS NOT NULL AND id_objednavky_zaklad = $3))
        ORDER BY (id_aktivity = $1) DESC, ($2::text IS NOT NULL AND $2 = ANY(id_s7)) DESC, vznik DESC LIMIT 1`,
      [idAktivity, s7, zaklad],
    );
    const r = rows[0];
    if (!r) return null;
    return { souborId: r.soubor_id, nazev: r.nazev, vznik: new Date(r.vznik), idAktivity: r.id_aktivity, idObjednavky: r.id_objednavky, idObjednavkyZaklad: r.id_objednavky_zaklad, idS7: r.id_s7 ?? [], predpis: r.predpis ?? [], cpeMode: r.cpe_mode, zoznam: r.zoznam };
  } catch {
    return null; // detail zakázky nesmí spadnout kvůli notifikacím
  }
}

export const MAX_PDF_NA_BEH = 40;

export interface VysledekNotifikaci {
  /** kolik PDF je ve složce vidět (0 = složka je prázdná nebo není nasdílená servisnímu účtu) */
  veSlozce: number;
  nacteno: number;
  chyb: number;
  zprávy: string[];
}

/** Projde složku na Drive, nové PDF stáhne, přečte a uloží. Už zpracované soubory (podle ID) přeskočí. */
export async function importujNotifikace(
  db: Dotaz,
  api: drive_v3.Drive,
  slozkaId: string,
  deps: { textZPdf?: (pdf: Buffer) => Promise<string>; ted?: () => Date } = {},
): Promise<VysledekNotifikaci> {
  await priprav(db);
  const naText = deps.textZPdf ?? textZPdf;
  // neúspěšné soubory se po dni zkusí znovu (výpadek Drive apod.)
  const { rows } = await db.query<{ soubor_id: string }>("SELECT soubor_id FROM notifikace_pdf WHERE chyba IS NULL OR nacteno > now() - interval '1 day'");
  const znama = new Set(rows.map((r) => r.soubor_id));

  const soubory: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await api.files.list({
      q: `'${slozkaId}' in parents and trashed = false and mimeType = 'application/pdf'`,
      orderBy: "createdTime desc",
      pageSize: 100,
      pageToken,
      fields: "nextPageToken,files(id,name,createdTime)",
    });
    soubory.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken && soubory.filter((f) => !znama.has(f.id!)).length < MAX_PDF_NA_BEH);

  const v: VysledekNotifikaci = { veSlozce: soubory.length, nacteno: 0, chyb: 0, zprávy: [] };
  if (!soubory.length) v.zprávy.push("Ve složce není vidět žádné PDF – je složka nasdílená servisnímu účtu jobu jako Čtenář?");
  for (const f of soubory.filter((s) => !znama.has(s.id!)).slice(0, MAX_PDF_NA_BEH)) {
    const vznik = new Date(f.createdTime ?? (deps.ted ?? (() => new Date()))());
    try {
      const res = await api.files.get({ fileId: f.id!, alt: "media" }, { responseType: "arraybuffer" });
      const text = await naText(Buffer.from(res.data as ArrayBuffer));
      const n = parsujNotifikaci(text, f.name ?? "");
      if (!n) {
        await ulozNotifikaci(db, { souborId: f.id!, nazev: f.name ?? "", vznik, chyba: "v PDF chybí MWF ID aktivity" });
        v.chyb++;
        v.zprávy.push(`${f.name}: není notifikace z MWF`);
        continue;
      }
      await ulozNotifikaci(db, { ...n, souborId: f.id!, nazev: f.name ?? "", vznik });
      v.nacteno++;
    } catch (e) {
      const zprava = e instanceof Error ? e.message : String(e);
      await ulozNotifikaci(db, { souborId: f.id!, nazev: f.name ?? "", vznik, chyba: zprava.slice(0, 500) }).catch(() => undefined);
      v.chyb++;
      v.zprávy.push(`${f.name}: ${zprava}`);
    }
  }
  return v;
}
