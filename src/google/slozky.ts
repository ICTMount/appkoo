// Složka zakázky na Google Disku – zakládá se jen na vyžádání koordinátorky (tlačítko v detailu zakázky).
//   Zakázky (SLOZKA_ZAKAZEK) / 2026 / 2026_45 / APPKOO / O-8555864483
// Týden = ISO týden termínu instalace, bez termínu týden založení. Rok a týden se dohledají podle názvu,
// chybějící se založí. Jednou založená složka se nepřesouvá (při přeplánování odkaz platí dál) – ID je v databázi.

import type { drive_v3 } from "@googleapis/drive";
import type { Dotaz } from "../db/db.js";

const SLOZKA = "application/vnd.google-apps.folder";

/** Kalendářní den okamžiku v pražském čase (ne UTC – pondělí 0:30 patří do nového týdne) */
function prazskyDen(d: Date): { rok: number; mesic: number; den: number } {
  const c = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const n = (typ: string) => Number(c.find((p) => p.type === typ)!.value);
  return { rok: n("year"), mesic: n("month") - 1, den: n("day") };
}

/** ISO 8601 týden (pondělí–neděle; týden 1 obsahuje první čtvrtek roku) – stejně jako složky 2026_45 */
export function isoTyden(d: Date): { rok: number; tyden: number } {
  const p = prazskyDen(d);
  const t = new Date(Date.UTC(p.rok, p.mesic, p.den));
  const den = t.getUTCDay() || 7; // po = 1 … ne = 7
  t.setUTCDate(t.getUTCDate() + 4 - den); // čtvrtek téhož týdne určuje rok
  const rok = t.getUTCFullYear();
  const tyden = Math.ceil(((t.getTime() - Date.UTC(rok, 0, 1)) / 86_400_000 + 1) / 7);
  return { rok, tyden };
}

export const nazevTydne = (rok: number, tyden: number) => `${rok}_${String(tyden).padStart(2, "0")}`;

const uvozovky = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Podsložka daného jména (nejstarší, když jich je víc); když chybí, založí se */
export async function najdiNeboZaloz(drive: drive_v3.Drive, rodic: string, nazev: string): Promise<{ id: string; zalozena: boolean }> {
  const { data } = await drive.files.list({
    q: `'${rodic}' in parents and name = '${uvozovky(nazev)}' and mimeType = '${SLOZKA}' and trashed = false`,
    orderBy: "createdTime",
    pageSize: 5,
    fields: "files(id,name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const f = data.files?.[0];
  if (f?.id) return { id: f.id, zalozena: false };
  const { data: nova } = await drive.files.create({
    requestBody: { name: nazev, mimeType: SLOZKA, parents: [rodic] },
    fields: "id",
    supportsAllDrives: true,
  });
  return { id: nova.id!, zalozena: true };
}

export interface SlozkaZakazky {
  objednavka: string;
  slozkaId: string;
  odkaz: string;
  /** „2026 / 2026_45 / APPKOO / O-8555864483“ */
  cesta: string;
  zalozil: string;
  zalozeno: Date;
}

export const odkazSlozky = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/** Založí (nebo najde) složku zakázky v týdnu podle data; vrátí ID a cestu */
export async function zalozSlozkuZakazky(drive: drive_v3.Drive, koren: string, objednavka: string, datum: Date) {
  const { rok, tyden } = isoTyden(datum);
  const r = await najdiNeboZaloz(drive, koren, String(rok));
  const t = await najdiNeboZaloz(drive, r.id, nazevTydne(rok, tyden));
  const a = await najdiNeboZaloz(drive, t.id, "APPKOO");
  const z = await najdiNeboZaloz(drive, a.id, objednavka);
  return { slozkaId: z.id, cesta: `${rok} / ${nazevTydne(rok, tyden)} / APPKOO / ${objednavka}`, novaSlozka: z.zalozena };
}

// ---------- evidence v databázi ----------

const TABULKA = `CREATE TABLE IF NOT EXISTS slozka_zakazky (
  objednavka text PRIMARY KEY,
  slozka_id  text NOT NULL,
  cesta      text NOT NULL,
  zalozil    text NOT NULL,
  zalozeno   timestamptz NOT NULL DEFAULT now()
)`;

const pripraveno = new WeakMap<Dotaz, Promise<unknown>>();
function priprav(db: Dotaz): Promise<unknown> {
  let p = pripraveno.get(db);
  if (!p) {
    p = db.query(TABULKA).catch((e) => {
      pripraveno.delete(db);
      throw e;
    });
    pripraveno.set(db, p);
  }
  return p;
}

export async function nactiSlozku(db: Dotaz, objednavka: string): Promise<SlozkaZakazky | null> {
  try {
    await priprav(db);
    const { rows } = await db.query<{ objednavka: string; slozka_id: string; cesta: string; zalozil: string; zalozeno: Date }>(
      "SELECT objednavka, slozka_id, cesta, zalozil, zalozeno FROM slozka_zakazky WHERE objednavka = $1",
      [objednavka],
    );
    const r = rows[0];
    return r ? { objednavka: r.objednavka, slozkaId: r.slozka_id, odkaz: odkazSlozky(r.slozka_id), cesta: r.cesta, zalozil: r.zalozil, zalozeno: new Date(r.zalozeno) } : null;
  } catch {
    return null; // detail zakázky nesmí spadnout kvůli evidenci složek
  }
}

export async function ulozSlozku(db: Dotaz, s: { objednavka: string; slozkaId: string; cesta: string; zalozil: string }): Promise<void> {
  await priprav(db);
  // první záznam vyhrává (dvě koordinátorky současně) – Drive najdiNeboZaloz vrátí stejnou složku
  await db.query(
    "INSERT INTO slozka_zakazky (objednavka, slozka_id, cesta, zalozil) VALUES ($1, $2, $3, $4) ON CONFLICT (objednavka) DO NOTHING",
    [s.objednavka, s.slozkaId, s.cesta, s.zalozil],
  );
}
