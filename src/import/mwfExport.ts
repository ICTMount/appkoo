// Import MWF exportu (paw-grid-export-csv, windows-1250, oddělovač ;) do doménového modelu.

import {
  jeParkovani,
  PARKOVANI_NESTANDARDNI,
  pocetMv,
  SKUPINA_PARKOVANI,
  VYSLEDEK,
  type Parkovani,
  type Vysledek,
} from "../domain/mwf.js";
import { zakladniCisloObjednavky } from "../domain/slovnik.js";
import { isoDate, parseCzDateTime, type IsoDate } from "../domain/time.js";
import { decodeExport, parseCsv } from "./csv.js";
import { rozlozPoznamku, type Zaznam } from "./notes.js";

export type Infrastruktura = "TMCZ" | "CETIN" | "VDF" | "jiná";

export interface Zakazka {
  idAktivity: string;
  /** číslo objednávky O-… (sloupec „ID obj. v ext. systéme“) */
  idObjednavky: string;
  /** interní číslo objednávky v MWF (sloupec „ID objednávky“) */
  idObjednavkyMwf: string;
  /** O-číslo bez přípon (":1", "-13075814") – pro párování s kalendářem a chatem */
  idObjednavkyZaklad: string;
  idS7: string;
  technik: string; // Pracovný zdroj
  stavMwf: string;
  typAktivity: string;
  infrastruktura: Infrastruktura;
  predobjednavka: boolean;
  zakaznik: string;
  telefony: string[];
  psc: string;
  adresa: string;
  subregion: string;
  balik: string;
  produkt: string;
  prideleno: Date | null; // Čas postúpenia dod.
  termin: { od: Date; do: Date } | null;
  parkovani: Parkovani | null;
  parkovaniSkupina: "DOD" | "ZAK" | null;
  /** parkování, které MWF umožňuje, ale Vegacom nepoužívá (spec 9.4 C) */
  parkovaniNestandardni: string | null;
  posledniParkovani: string;
  vysledek: Vysledek | null;
  preferovanyDatum: Date | null;
  rfs: Date | null;
  /** minuty do splnění SLA; záporné = po termínu */
  doSplneniMin: number | null;
  poznamka: string;
  uvodPoznamky: string;
  zaznamy: Zaznam[];
  pocetMv: number;
}

const COL = {
  idAktivity: "ID aktivity",
  idObjednavky: "ID objednávky",
  idExt: "ID obj. v ext. systéme",
  idS7: "ID S7 obj.",
  technik: "Pracovný zdroj",
  stav: "Stav",
  typ: "Typ aktivity",
  zakaznik: "Zákazník",
  kontakt: "Kontakt",
  psc: "Psč",
  adresa: "Adresa",
  subregion: "Subregión",
  balik: "P3: Typ balíka",
  prideleno: "Čas postúpenia dod.",
  termin: "Dohodnutý termín",
  poznamka: "Poznámka",
  parkovani: "Dôvod parkovania",
  posledniParkovani: "Posledný dôvod parkovania",
  vlastnik: "P17: Vlastník siete",
  vysledek: "Výsledok dojednávania",
  preferovany: "Preferovaný dátum",
  doSplneni: "Do splnění",
  rfs: "Dátum RFS",
  produkt: "Produkt",
} as const;

function infrastruktura(vlastnik: string, typ: string): Infrastruktura {
  const s = `${vlastnik} ${typ}`.toUpperCase();
  if (s.includes("CETIN")) return "CETIN";
  if (s.includes("VODAFONE") || s.includes("VDF")) return "VDF";
  if (s.includes("TMCZ") || s.includes("FTTH")) return "TMCZ";
  return "jiná";
}

/** "15.10.2026 08:00 / 15.10.2026 08:59"; u dnešních termínů MWF vynechá datum: "11:00 / 12:59" */
export function parseTermin(s: string, denExportu: IsoDate): { od: Date; do: Date } | null {
  const [a, b] = s.split("/").map((x) => x.trim());
  if (!a || !b) return null;
  const [d, mo, y] = denExportu.split("-").reverse();
  const doplnit = (x: string) => (/^\d{1,2}:\d{2}$/.test(x) ? `${d}.${mo}.${y} ${x}` : x);
  const od = parseCzDateTime(doplnit(a));
  const do_ = parseCzDateTime(doplnit(b));
  return od && do_ ? { od, do: do_ } : null;
}

/** "-41t,5d,1h,15m" (t = týdny) → minuty */
export function parseDoSplneni(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const sign = t.startsWith("-") ? -1 : 1;
  const mult: Record<string, number> = { t: 7 * 24 * 60, d: 24 * 60, h: 60, m: 1 };
  let total = 0;
  for (const m of t.replace("-", "").matchAll(/(\d+)([tdhm])/g)) total += Number(m[1]) * mult[m[2]!]!;
  return sign * total;
}

export function telefony(kontakt: string): string[] {
  return [...kontakt.matchAll(/(?:\+?420\s?)?(\d{3}\s?\d{3}\s?\d{3})/g)].map((m) => m[1]!.replace(/\s/g, ""));
}

export interface VysledekImportu {
  zakazky: Zakazka[];
  chybejiciSloupce: string[];
}

export function importExport(buf: Buffer, exportAt: Date): VysledekImportu {
  const [hlavicka, ...radky] = parseCsv(decodeExport(buf));
  if (!hlavicka) return { zakazky: [], chybejiciSloupce: Object.values(COL) };
  const idx = new Map(hlavicka.map((h, i) => [h.trim(), i]));
  const chybejiciSloupce = Object.values(COL).filter((c) => !idx.has(c));
  const denExportu = isoDate(exportAt);

  const zakazky = radky.map((r): Zakazka => {
    const get = (c: string) => (r[idx.get(c) ?? -1] ?? "").trim();
    const parkRaw = get(COL.parkovani);
    const parkovani = jeParkovani(parkRaw) ? parkRaw : null;
    const vys = get(COL.vysledek);
    const poznamka = get(COL.poznamka);
    const { uvod, zaznamy } = rozlozPoznamku(poznamka);
    const typ = get(COL.typ);
    return {
      idAktivity: get(COL.idAktivity),
      idObjednavky: get(COL.idExt),
      idObjednavkyMwf: get(COL.idObjednavky),
      idObjednavkyZaklad: zakladniCisloObjednavky(get(COL.idExt)),
      idS7: get(COL.idS7),
      technik: get(COL.technik),
      stavMwf: get(COL.stav),
      typAktivity: typ,
      infrastruktura: infrastruktura(get(COL.vlastnik), typ),
      predobjednavka: /^Predobjednavka/i.test(typ),
      zakaznik: get(COL.zakaznik),
      telefony: telefony(get(COL.kontakt)),
      psc: get(COL.psc).replace(/\s/g, ""),
      adresa: get(COL.adresa),
      subregion: get(COL.subregion),
      balik: get(COL.balik),
      produkt: get(COL.produkt),
      prideleno: parseCzDateTime(get(COL.prideleno)),
      termin: parseTermin(get(COL.termin), denExportu),
      parkovani,
      parkovaniSkupina: parkovani ? SKUPINA_PARKOVANI[parkovani] : null,
      parkovaniNestandardni: (PARKOVANI_NESTANDARDNI as readonly string[]).includes(parkRaw) ? parkRaw : null,
      posledniParkovani: get(COL.posledniParkovani),
      vysledek: (VYSLEDEK as readonly string[]).includes(vys) ? (vys as Vysledek) : null,
      preferovanyDatum: parseCzDateTime(get(COL.preferovany)),
      rfs: parseCzDateTime(get(COL.rfs)),
      doSplneniMin: parseDoSplneni(get(COL.doSplneni)),
      poznamka,
      uvodPoznamky: uvod,
      zaznamy,
      pocetMv: pocetMv(poznamka),
    };
  });

  return { zakazky, chybejiciSloupce };
}
