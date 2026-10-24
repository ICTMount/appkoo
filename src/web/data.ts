// Data pro webové rozhraní: fronta k volání a detail zakázky.
// Čte jen databázi (jen čtení). Priorita a plán kontaktu se počítají stejnými pravidly
// jako v importu (src/domain/priorita.ts, src/domain/contact.ts) z poznámky uložené v DB.

import type { Dotaz } from "../db/db.js";
import { ts } from "../db/db.js";
import { planKontaktu, type PlanKontaktu } from "../domain/contact.js";
import { SKUPINA_PARKOVANI, type Parkovani, type Vysledek } from "../domain/mwf.js";
import { faktaZakazky, urciPrioritu, PRIORITY, type Priorita, type PravidloPriority, VYCHOZI_PRAVIDLA } from "../domain/priorita.js";
import { pravidlaPriority } from "../config/ciselniky.js";
import type { Infrastruktura, Zakazka } from "../import/mwfExport.js";
import { pokusyZPoznamky, rozlozPoznamku } from "../import/notes.js";
import { nactiNotifikaci, type UlozenaNotifikace } from "../ingest/notifikace.js";

/** Řádek tabulky `zakazka` (jen sloupce, které web používá) */
export interface ZakazkaRow {
  id_aktivity: string;
  id_objednavky: string;
  id_objednavky_zaklad: string;
  id_s7: string | null;
  technik: string | null;
  stav_mwf: string;
  typ_aktivity: string;
  infrastruktura: Infrastruktura;
  predobjednavka: boolean;
  zakaznik: string | null;
  telefony: string[];
  psc: string | null;
  adresa: string | null;
  subregion: string | null;
  balik: string | null;
  produkt: string | null;
  prideleno: Date | null;
  termin_od: Date | null;
  termin_do: Date | null;
  parkovani: string | null;
  parkovani_nestandardni: string | null;
  vysledek: string | null;
  preferovany_datum: Date | null;
  rfs: Date | null;
  do_splneni_min: number | null;
  poznamka: string;
  pocet_mv: number;
  uzavreno: Date | null;
}

const SLOUPCE = `id_aktivity, id_objednavky, id_objednavky_zaklad, id_s7, technik, stav_mwf, typ_aktivity, infrastruktura,
  predobjednavka, zakaznik, telefony, psc, adresa, subregion, balik, produkt, prideleno, termin_od, termin_do, parkovani,
  parkovani_nestandardni, vysledek, preferovany_datum, rfs, do_splneni_min, poznamka, pocet_mv, uzavreno`;

/** Řádek z DB → doménová zakázka (poznámka se znovu rozloží na záznamy) */
export function zRadku(r: ZakazkaRow): Zakazka {
  const { uvod, zaznamy } = rozlozPoznamku(r.poznamka);
  const parkovani = (r.parkovani as Parkovani | null) ?? null;
  return {
    idAktivity: r.id_aktivity,
    idObjednavky: r.id_objednavky,
    idObjednavkyMwf: "",
    idObjednavkyZaklad: r.id_objednavky_zaklad,
    idS7: r.id_s7 ?? "",
    technik: r.technik ?? "",
    stavMwf: r.stav_mwf,
    typAktivity: r.typ_aktivity,
    infrastruktura: r.infrastruktura,
    predobjednavka: r.predobjednavka,
    zakaznik: r.zakaznik ?? "",
    telefony: r.telefony ?? [],
    psc: r.psc ?? "",
    adresa: r.adresa ?? "",
    subregion: r.subregion ?? "",
    balik: r.balik ?? "",
    produkt: r.produkt ?? "",
    prideleno: r.prideleno,
    termin: r.termin_od ? { od: r.termin_od, do: r.termin_do ?? r.termin_od } : null,
    parkovani,
    parkovaniSkupina: parkovani ? (SKUPINA_PARKOVANI[parkovani] ?? null) : null,
    parkovaniNestandardni: r.parkovani_nestandardni,
    posledniParkovani: "",
    vysledek: (r.vysledek as Vysledek | null) ?? null,
    preferovanyDatum: r.preferovany_datum,
    rfs: r.rfs,
    doSplneniMin: r.do_splneni_min,
    poznamka: r.poznamka,
    uvodPoznamky: uvod,
    zaznamy,
    pocetMv: r.pocet_mv,
  };
}

export interface PolozkaFronty {
  z: Zakazka;
  priorita: Priorita;
  duvod: string;
  plan: PlanKontaktu;
  /** datum dalšího kontaktu z poznámek (YYYY-MM-DD) */
  dalsiKontakt: string | null;
}

export interface Filtr {
  /** Pracovný zdroj (fronta koordinátorky nebo technik) */
  zdroj?: string;
  subregion?: string;
  priorita?: Priorita;
  /** hledání v O-ID, S7, zákazníkovi, adrese, telefonu */
  hledat?: string;
}

export interface Fronta {
  polozky: PolozkaFronty[];
  /** počty podle priority před filtrem priority (pro záložky) */
  pocty: Record<Priorita, number>;
  zdroje: string[];
  subregiony: string[];
  celkem: number;
}

const PORADI_PRIORITY: Record<Priorita, number> = { P1: 0, P2: 1, P3: 2, P0: 3 };

/** Pravidla priority z číselníku v DB; když tam nejsou, výchozí */
export async function nactiPravidla(db: Dotaz): Promise<PravidloPriority[]> {
  const { rows } = await db.query<{ data: Record<string, unknown> }>(
    "SELECT data FROM ciselnik_polozka WHERE ciselnik = 'pravidlaPriority' AND aktivni",
  );
  const pravidla = pravidlaPriority(rows.map((r) => r.data as never));
  return pravidla.length ? pravidla : VYCHOZI_PRAVIDLA;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function hodiSe(z: Zakazka, hledat: string): boolean {
  const q = norm(hledat.trim());
  if (!q) return true;
  const qCisla = q.replace(/\D/g, "");
  const pole = [z.idObjednavky, z.idS7, z.idAktivity, z.zakaznik, z.adresa, z.psc].map((x) => norm(x.replace(/^=+/, "")));
  if (pole.some((p) => p.includes(q))) return true;
  return qCisla.length >= 6 && z.telefony.some((t) => t.replace(/\D/g, "").includes(qCisla));
}

/** Fronta k volání: otevřené zakázky s prioritou, seřazené P1 → P0 a podle dalšího pokusu */
export async function nactiFrontu(db: Dotaz, now: Date, filtr: Filtr = {}, pravidla?: PravidloPriority[]): Promise<Fronta> {
  const { rows } = await db.query<ZakazkaRow>(`SELECT ${SLOUPCE} FROM zakazka WHERE uzavreno IS NULL`);
  const pr = pravidla ?? (await nactiPravidla(db));

  const vse: PolozkaFronty[] = rows.map((r) => {
    const z = zRadku(r);
    const f = faktaZakazky(z, now);
    const { priorita, duvod } = urciPrioritu(f, pr);
    return { z, priorita, duvod, plan: f.plan, dalsiKontakt: f.dalsiKontakt };
  });

  const zdroje = [...new Set(vse.map((p) => p.z.technik).filter(Boolean))].sort((a, b) => a.localeCompare(b, "cs"));
  const subregiony = [...new Set(vse.map((p) => p.z.subregion).filter(Boolean))].sort();

  const predPrioritou = vse.filter(
    (p) =>
      (!filtr.zdroj || p.z.technik === filtr.zdroj) &&
      (!filtr.subregion || p.z.subregion === filtr.subregion) &&
      (!filtr.hledat || hodiSe(p.z, filtr.hledat)),
  );
  const pocty = Object.fromEntries(PRIORITY.map((p) => [p, 0])) as Record<Priorita, number>;
  for (const p of predPrioritou) pocty[p.priorita]++;

  const polozky = predPrioritou
    .filter((p) => !filtr.priorita || p.priorita === filtr.priorita)
    .sort(
      (a, b) =>
        PORADI_PRIORITY[a.priorita] - PORADI_PRIORITY[b.priorita] ||
        (a.plan.dalsiPokus?.getTime() ?? Infinity) - (b.plan.dalsiPokus?.getTime() ?? Infinity) ||
        (a.z.prideleno?.getTime() ?? Infinity) - (b.z.prideleno?.getTime() ?? Infinity),
    );

  return { polozky, pocty, zdroje, subregiony, celkem: vse.length };
}

export interface HistorieRadek {
  export_at: Date | null;
  stav_mwf: string;
  parkovani: string | null;
  vysledek: string | null;
  termin_od: Date | null;
  technik: string | null;
}

export interface Detail extends PolozkaFronty {
  uzavreno: Date | null;
  historie: HistorieRadek[];
  /** další aktivity se stejným O-ID (např. instalace + demontáž) */
  souvisejici: { id_aktivity: string; typ_aktivity: string; stav_mwf: string; uzavreno: Date | null }[];
  /** výpis z notifikačního PDF z MWF (null = PDF zatím nedorazilo) */
  notifikace: UlozenaNotifikace | null;
}

export async function nactiDetail(db: Dotaz, idAktivity: string, now: Date, pravidla?: PravidloPriority[]): Promise<Detail | null> {
  const { rows } = await db.query<ZakazkaRow>(`SELECT ${SLOUPCE} FROM zakazka WHERE id_aktivity = $1`, [idAktivity]);
  const r = rows[0];
  if (!r) return null;
  const z = zRadku(r);
  const f = faktaZakazky(z, now);
  const { priorita, duvod } = urciPrioritu(f, pravidla ?? (await nactiPravidla(db)));

  const historie = (
    await db.query<HistorieRadek>(
      `SELECT i.export_at, h.stav_mwf, h.parkovani, h.vysledek, h.termin_od, h.technik
         FROM zakazka_historie h JOIN import_run i ON i.id = h.import_id
        WHERE h.id_aktivity = $1 ORDER BY i.export_at DESC NULLS LAST, h.import_id DESC`,
      [idAktivity],
    )
  ).rows;
  const souvisejici = (
    await db.query<Detail["souvisejici"][number]>(
      `SELECT id_aktivity, typ_aktivity, stav_mwf, uzavreno FROM zakazka
        WHERE id_objednavky_zaklad = $1 AND id_aktivity <> $2 ORDER BY uzavreno NULLS FIRST, id_aktivity`,
      [r.id_objednavky_zaklad, idAktivity],
    )
  ).rows;

  const notifikace = await nactiNotifikaci(db, idAktivity, r.id_objednavky_zaklad);

  return { z, priorita, duvod, plan: f.plan, dalsiKontakt: f.dalsiKontakt, uzavreno: r.uzavreno, historie, souvisejici, notifikace };
}

/** Najde aktivitu podle O-ID / S7 / ID aktivity (pro rychlé hledání z hlavičky) */
export async function najdiAktivitu(db: Dotaz, dotaz: string): Promise<string[]> {
  const q = dotaz.trim();
  if (!q) return [];
  const { rows } = await db.query<{ id_aktivity: string }>(
    `SELECT id_aktivity FROM zakazka
      WHERE id_aktivity = $1 OR id_objednavky = $1 OR id_objednavky_zaklad = $1 OR id_s7 = $1 OR id_s7 = '=' || $1
      ORDER BY uzavreno NULLS FIRST LIMIT 20`,
    [q],
  );
  return rows.map((r) => r.id_aktivity);
}

/**
 * Volné hledání ve všech zakázkách z MWF (i uzavřených): telefon (v Kontaktu i v poznámce), jméno, adresa, ID.
 * Otevřené zakázky první, pak nejnovější.
 */
export async function hledejZakazky(db: Dotaz, dotaz: string, limit = 30): Promise<string[]> {
  const q = dotaz.trim();
  const cisla = q.replace(/\D/g, "");
  if (/^[+\d\s/-]+$/.test(q) && cisla.length >= 6) {
    const posledni9 = cisla.slice(-9); // +420 603 111 222 → 603111222
    const { rows } = await db.query<{ id_aktivity: string }>(
      `SELECT id_aktivity FROM zakazka
        WHERE array_to_string(telefony, ',') LIKE $1 OR regexp_replace(poznamka, '[[:space:]/-]', '', 'g') LIKE $1
        ORDER BY uzavreno NULLS FIRST, prideleno DESC NULLS LAST LIMIT $2`,
      [`%${posledni9}%`, limit],
    );
    return rows.map((r) => r.id_aktivity);
  }
  if (q.length < 3) return [];
  const vzor = `%${q.replace(/[%_]/g, "")}%`;
  const { rows } = await db.query<{ id_aktivity: string }>(
    `SELECT id_aktivity FROM zakazka
      WHERE zakaznik ILIKE $1 OR adresa ILIKE $1 OR id_objednavky ILIKE $1 OR id_s7 ILIKE $1
      ORDER BY uzavreno NULLS FIRST, prideleno DESC NULLS LAST LIMIT $2`,
    [vzor, limit],
  );
  return rows.map((r) => r.id_aktivity);
}

export interface StavImportu {
  posledniExport: Date | null;
  posledniBeh: Date | null;
  stariHodin: number | null;
  /** poslední importovaný export: název souboru a odkud přišel */
  soubor?: string | null;
  zdroj?: string | null;
  odesilatel?: string | null;
}

export async function nactiStavImportu(db: Dotaz, now: Date): Promise<StavImportu> {
  const { rows } = await db.query<{ posledni_export: Date | null; posledni_beh: Date | null; hodin: number | string | null }>(
    `SELECT max(export_at) FILTER (WHERE vysledek = 'importovano') AS posledni_export,
            max(prijato) AS posledni_beh,
            extract(epoch FROM ($1::timestamp - max(export_at) FILTER (WHERE vysledek = 'importovano'))) / 3600 AS hodin
       FROM import_run`,
    [ts(now)],
  );
  const r = rows[0];
  const { rows: posl } = await db.query<{ soubor: string; zdroj: string; odesilatel: string | null }>(
    `SELECT soubor, zdroj, odesilatel FROM import_run WHERE vysledek = 'importovano' ORDER BY export_at DESC NULLS LAST, prijato DESC LIMIT 1`,
  );
  return {
    soubor: posl[0]?.soubor ?? null,
    zdroj: posl[0]?.zdroj ?? null,
    odesilatel: posl[0]?.odesilatel ?? null,
    posledniExport: r?.posledni_export ?? null,
    posledniBeh: r?.posledni_beh ?? null,
    stariHodin: r?.hodin === null || r?.hodin === undefined ? null : Math.round(Number(r.hodin) * 10) / 10,
  };
}

/** Pokusy z poznámky (pro detail – kdo, kdy, výsledek) */
export const pokusyZakazky = (z: Zakazka) => pokusyZPoznamky(z.zaznamy);
export { planKontaktu };
