// Priorita zakázky ve frontě (P1 volat dnes … P0 nevolat) podle pravidel z Konfigurace.
// Pravidla jsou číselník „Pravidla priority“ (upravitelný v aplikaci i přes CSV):
// projdou se podle pořadí a platí PRVNÍ, jehož podmínka je splněná.
// Podmínky jsou pevně dané (kód je umí vyhodnotit), vedoucí volí pořadí, parametr a prioritu.

import type { Zakazka } from "../import/mwfExport.js";
import { pokusyZPoznamky } from "../import/notes.js";
import { planKontaktu, type PlanKontaktu } from "./contact.js";
import { najdiKody, SKUPINA_PARKOVANI } from "./mwf.js";
import { DAY, fromIso, isoDate, local, type IsoDate } from "./time.js";

export type Priorita = "P1" | "P2" | "P3" | "P0";
export const PRIORITY: Priorita[] = ["P1", "P2", "P3", "P0"];

/** Fakta o zakázce, ze kterých se priorita počítá */
export interface Fakta {
  dnes: IsoDate;
  plan: PlanKontaktu;
  /** poslední datum „kontaktovat DD.MM.RRRR“ v zápisech Vegacomu */
  dalsiKontakt: IsoDate | null;
  /** zápis koordinace od Vegacomu existuje (zakázka už byla řešena) */
  resena: boolean;
  parkovaniSkupina: "DOD" | "ZAK" | null;
  parkovani: string | null;
  termin: { od: Date } | null;
  vysledek: string | null;
  posledniKodR: string | null;
  predobjednavka: boolean;
  rfs: Date | null;
  doSplneniMin: number | null;
}

const DATUM_KONTAKTU = /kontakt\w*\s+(?:dne\s+|až\s+|po\s+)?(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})?/gi;

export function faktaZakazky(z: Zakazka, now: Date): Fakta {
  const dnes = isoDate(now);
  let dalsiKontakt: IsoDate | null = null;
  for (const zaz of z.zaznamy.filter((x) => x.vegacom)) {
    for (const m of zaz.text.matchAll(DATUM_KONTAKTU)) {
      const rok = m[3] ? Number(m[3]) : zaz.at.getUTCFullYear();
      let d = isoDate(local(rok, Number(m[2]), Number(m[1])));
      if (!m[3] && d < isoDate(zaz.at)) d = isoDate(local(rok + 1, Number(m[2]), Number(m[1]))); // „15.1.“ napsané v prosinci
      dalsiKontakt = d;
    }
  }
  const kodyR = najdiKody(z.zaznamy.filter((x) => x.vegacom).map((x) => x.text).join("\n")).filter((k) => k.startsWith("r_"));
  return {
    dnes,
    plan: planKontaktu(pokusyZPoznamky(z.zaznamy), now),
    dalsiKontakt,
    resena: z.zaznamy.some((x) => x.vegacom),
    parkovaniSkupina: z.parkovani ? SKUPINA_PARKOVANI[z.parkovani] : null,
    parkovani: z.parkovani,
    termin: z.termin,
    vysledek: z.vysledek,
    posledniKodR: kodyR.at(-1) ?? null,
    predobjednavka: z.predobjednavka,
    rfs: z.rfs,
    doSplneniMin: z.doSplneniMin,
  };
}

interface Podminka {
  popis: string;
  /** význam parametru, pokud ho podmínka používá */
  parametr?: string;
  test: (f: Fakta, p: number) => boolean;
}

const dniDo = (f: Fakta, d: IsoDate) => Math.round((fromIso(d).getTime() - fromIso(f.dnes).getTime()) / DAY);

export const PODMINKY = {
  ceka_na_pep: { popis: "Zaparkováno ZAK – čeká na PEP", test: (f) => f.parkovaniSkupina === "ZAK" },
  smlouva_jp: { popis: "Smlouva s JP (r_2) a kontakt je až v budoucnu", test: (f) => f.posledniKodR === "r_2" && !!f.dalsiKontakt && f.dalsiKontakt > f.dnes },
  ma_termin: { popis: "Má dohodnutý termín v budoucnu", test: (f) => !!f.termin && isoDate(f.termin.od) >= f.dnes },
  termin_probehl: { popis: "Termín proběhl a zakázka není uzavřená (nedokončená)", test: (f) => !!f.termin && isoDate(f.termin.od) < f.dnes },
  predobjednavka_po_rfs: { popis: "Předobjednávka, RFS už nastalo nebo nastane do N dní", parametr: "dní před RFS", test: (f, p) => f.predobjednavka && !!f.rfs && dniDo(f, isoDate(f.rfs)) <= p },
  predobjednavka: { popis: "Předobjednávka před RFS", test: (f) => f.predobjednavka },
  kontakt_promeskany: { popis: "Datum kontaktu už prošlo", test: (f) => !!f.dalsiKontakt && f.dalsiKontakt < f.dnes },
  ceka_na_tmcz: { popis: "Legislatívne problémy – čeká na T-Mobile / infrastrukturu", test: (f) => f.parkovani === "Legislatívne problémy" && (!f.dalsiKontakt || f.dalsiKontakt > f.dnes) },
  po_mv: { popis: "Po marném výjezdu, k zavolání", test: (f) => f.vysledek === "Márny výjazd" && (!f.dalsiKontakt || f.dalsiKontakt <= f.dnes) },
  nova_bez_hovoru: { popis: "Nová zakázka, zatím bez zápisu koordinace", test: (f) => !f.resena },
  nedovolano_dni: { popis: "Nedovoláno N a více pracovních dní", parametr: "pracovních dní", test: (f, n) => f.plan.stav === "probiha" && f.plan.denRady >= n },
  navrh_zak: { popis: "Splněna pravidla pro parkování ZAK (3 navolané pracovní dny)", test: (f) => f.plan.stav === "navrh_zak" },
  kontakt_do_dni: { popis: "Datum kontaktu do N dní (0 = dnes)", parametr: "dní", test: (f, p) => !!f.dalsiKontakt && dniDo(f, f.dalsiKontakt) <= p },
  nedovolano: { popis: "Probíhá kontaktování, zákazník zatím nedovolán", test: (f) => f.plan.stav === "probiha" },
  sla_po_terminu: { popis: "Po termínu SLA (Do splnění je záporné)", test: (f) => f.doSplneniMin !== null && f.doSplneniMin < 0 },
  sla_do_hodin: { popis: "Do konce SLA zbývá N hodin a méně", parametr: "hodin", test: (f, p) => f.doSplneniMin !== null && f.doSplneniMin <= p * 60 },
  kontakt_pozdeji: { popis: "Datum kontaktu je až za N a více dní", parametr: "dní", test: (f, p) => !!f.dalsiKontakt && dniDo(f, f.dalsiKontakt) >= p },
  vse: { popis: "Ostatní (výchozí)", test: () => true },
} satisfies Record<string, Podminka>;

export type PodminkaId = keyof typeof PODMINKY;
export const PODMINKY_ID = Object.keys(PODMINKY) as PodminkaId[];

export interface PravidloPriority {
  poradi: number;
  podminka: PodminkaId;
  parametr: number | null;
  priorita: Priorita;
  poznamka?: string | null;
}

/** Výchozí pravidla (podle dashboardu a procesu koordinace) – vedoucí je může změnit */
export const VYCHOZI_PRAVIDLA: PravidloPriority[] = [
  { poradi: 10, podminka: "ceka_na_pep", parametr: null, priorita: "P0" },
  { poradi: 20, podminka: "smlouva_jp", parametr: null, priorita: "P0" },
  { poradi: 30, podminka: "ma_termin", parametr: null, priorita: "P0" },
  { poradi: 40, podminka: "termin_probehl", parametr: null, priorita: "P1" },
  { poradi: 50, podminka: "predobjednavka_po_rfs", parametr: 0, priorita: "P1" },
  { poradi: 60, podminka: "predobjednavka", parametr: null, priorita: "P0" },
  { poradi: 70, podminka: "kontakt_promeskany", parametr: null, priorita: "P1" },
  { poradi: 75, podminka: "ceka_na_tmcz", parametr: null, priorita: "P3" },
  { poradi: 80, podminka: "po_mv", parametr: null, priorita: "P1" },
  { poradi: 90, podminka: "nova_bez_hovoru", parametr: null, priorita: "P1" },
  { poradi: 100, podminka: "navrh_zak", parametr: null, priorita: "P1" },
  { poradi: 110, podminka: "nedovolano_dni", parametr: 3, priorita: "P1" },
  { poradi: 120, podminka: "kontakt_do_dni", parametr: 1, priorita: "P2" },
  { poradi: 130, podminka: "nedovolano", parametr: null, priorita: "P2" },
  { poradi: 140, podminka: "kontakt_do_dni", parametr: 4, priorita: "P3" },
  { poradi: 150, podminka: "kontakt_pozdeji", parametr: 5, priorita: "P0" },
  { poradi: 160, podminka: "vse", parametr: null, priorita: "P3" },
];

export function urciPrioritu(f: Fakta, pravidla: PravidloPriority[] = VYCHOZI_PRAVIDLA): { priorita: Priorita; pravidlo: PravidloPriority | null; duvod: string } {
  for (const r of [...pravidla].sort((a, b) => a.poradi - b.poradi)) {
    const podm = PODMINKY[r.podminka] as Podminka | undefined;
    if (podm && podm.test(f, r.parametr ?? 0)) {
      return { priorita: r.priorita, pravidlo: r, duvod: podm.popis.replace("N", String(r.parametr ?? "")) };
    }
  }
  return { priorita: "P3", pravidlo: null, duvod: "žádné pravidlo neplatí" };
}
