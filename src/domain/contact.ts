// Pravidla kontaktování zákazníka při dojednávání termínu (spec kap. 2).
//
// Interní pravidlo Vegacom: 3 po sobě jdoucí pracovní dny; den je „navolaný“ už s 1 pokusem.
// Počet pokusů denně řídí objem práce: hodně zakázek → 1 pokus denně, málo → 2 pokusy
// s odstupem 4 h (vyšší šance naplánovat). SMS typicky 1× denně; volá se 8:00–19:00.
// Po 3 navolaných dnech → návrh parkování „Zákazník - nedostupný“ (ZAK).
// Všechny parametry jsou v Konfiguraci (NastaveniKontaktu).
// Závazné minimum normy TMCZ R-280-244: min. 3 pokusy během 3 PD s rozestupem 4 h,
// min. 2 SMS během 3 PD s odstupem min. 18 h, SMS jen 8:00–22:00.

import { atTime, fmtDate, HOUR, isoDate, minutesOfDay, type IsoDate } from "./time.js";
import { isWorkday, nextWorkday, workdaysBetween } from "./workdays.js";

export interface Pokus {
  at: Date;
  dovolano: boolean;
  sms: boolean;
}

export interface NastaveniKontaktu {
  volaniOd: number; // minuty od půlnoci
  volaniDo: number;
  odstupPokusu: number; // ms
  /** cílový počet pokusů za den (1 při velkém objemu, 2 při malém) */
  pokusuDenne: number;
  dnu: number;
  smsOd: number;
  smsDo: number;
  odstupSms: number; // ms
  minSms: number;
  minPokusuNorma: number;
}

export const PRAVIDLA: NastaveniKontaktu = {
  volaniOd: 8 * 60,
  volaniDo: 19 * 60,
  odstupPokusu: 4 * HOUR,
  pokusuDenne: 2,
  dnu: 3,
  smsOd: 8 * 60,
  smsDo: 22 * 60,
  odstupSms: 18 * HOUR,
  minSms: 2,
  minPokusuNorma: 3,
};

/**
 * Pokusů denně podle objemu práce: když je zakázek k volání na jednu koordinátorku víc než `prah`,
 * volá se 1× denně, jinak 2× (s odstupem 4 h).
 */
export function pokusuDenneDleObjemu(kVolaniNaKoordinatorku: number, prah: number): 1 | 2 {
  return kVolaniNaKoordinatorku > prah ? 1 : 2;
}

export interface PlanKontaktu {
  stav: "novy" | "probiha" | "dovolano" | "navrh_zak";
  /** kolikátý pracovní den řady (1–3, může přetéct) */
  denRady: number;
  pokusyDnes: number;
  /** pracovní dny s aspoň 1 neúspěšným pokusem */
  navolaneDny: number;
  /** cílový počet pokusů za den, se kterým plán počítal */
  pokusuDenne: number;
  dalsiPokus: Date | null;
  sms: { doporucena: boolean; nejdrive: Date | null; odeslano: number };
  splnujeNormu: boolean;
  varovani: string[];
}

/** Nejbližší okamžik ≥ t, kdy lze poslat SMS (okno SMS v pracovní den) */
function doOknaSms(t: Date, n: NastaveniKontaktu): Date {
  const d = isoDate(t);
  const m = minutesOfDay(t);
  if (isWorkday(d) && m >= n.smsOd && m < n.smsDo) return t;
  if (isWorkday(d) && m < n.smsOd) return atTime(d, 0, n.smsOd);
  return atTime(nextWorkday(d), 0, n.smsOd);
}

/** Kolik časů ze seřazeného seznamu lze vybrat tak, aby mezi sebou měly odstup ≥ gap */
function pocetSOdstupem(casy: Date[], gap: number): number {
  let n = 0;
  let posledni = -Infinity;
  for (const t of casy) {
    if (t.getTime() - posledni >= gap) {
      n++;
      posledni = t.getTime();
    }
  }
  return n;
}

/**
 * Plán dalšího kontaktu. `pokusy` = pokusy od posledního resetu (nová zakázka,
 * odpověď PEP, návrat z parkování), v libovolném pořadí.
 */
export function planKontaktu(pokusy: Pokus[], now: Date, nastaveni: Partial<NastaveniKontaktu> = {}): PlanKontaktu {
  const n: NastaveniKontaktu = { ...PRAVIDLA, ...nastaveni };
  const zacatekVolani = (d: IsoDate) => atTime(d, 0, n.volaniOd);
  const konecVolani = (d: IsoDate) => atTime(d, 0, n.volaniDo);
  const serazene = [...pokusy].sort((a, b) => a.at.getTime() - b.at.getTime());
  const dnes = isoDate(now);
  const varovani: string[] = [];
  const smsCasy = serazene.filter((p) => p.sms).map((p) => p.at);
  const posledniSms = smsCasy.at(-1);

  const posledni = serazene.at(-1);
  if (posledni?.dovolano) {
    return {
      stav: "dovolano",
      denRady: 0,
      pokusyDnes: 0,
      navolaneDny: 0,
      pokusuDenne: n.pokusuDenne,
      dalsiPokus: null,
      sms: { doporucena: false, nejdrive: null, odeslano: smsCasy.length },
      splnujeNormu: true,
      varovani,
    };
  }

  // Řada pokusů začíná po posledním dovolání (např. odklad na přání → v den kontaktu nová řada)
  const odDovolani = serazene.slice(serazene.findLastIndex((p) => p.dovolano) + 1);
  const neuspesne = odDovolani.filter((p) => !p.dovolano);
  const poDnech = new Map<IsoDate, Date[]>();
  for (const p of neuspesne) {
    const d = isoDate(p.at);
    poDnech.set(d, [...(poDnech.get(d) ?? []), p.at]);
  }

  const dnesni = poDnech.get(dnes) ?? [];
  // Den je navolaný už s 1 pokusem; 2 pokusy s odstupem 4 h jsou ideál při malém objemu
  const navolaneDny = [...poDnech.keys()].filter(isWorkday).length;

  const prvniDen = neuspesne[0] ? isoDate(neuspesne[0].at) : undefined;
  const denRady = prvniDen ? workdaysBetween(prvniDen, dnes) : 0;

  if (prvniDen) {
    for (let d = prvniDen; d < dnes; d = nextWorkday(d)) {
      if (isWorkday(d) && !poDnech.has(d)) {
        varovani.push(`Vynechaný pracovní den ${fmtDate(d)} – řada 3 PD po sobě je přerušená.`);
      }
    }
  }

  const prvniDnes = dnesni[0];
  const posledniMoznyPrvni = n.volaniDo - n.odstupPokusu / 60000;
  if (n.pokusuDenne >= 2 && prvniDnes && minutesOfDay(prvniDnes) > posledniMoznyPrvni) {
    varovani.push(`První pokus dne byl po ${Math.floor(posledniMoznyPrvni / 60)}:00 – druhý pokus s odstupem 4 h se dnes nestihne.`);
  }

  const splnujeNormu =
    pocetSOdstupem(
      neuspesne.map((p) => p.at),
      n.odstupPokusu,
    ) >= n.minPokusuNorma && pocetSOdstupem(smsCasy, n.odstupSms) >= n.minSms;

  const smsNejdrive = doOknaSms(
    posledniSms ? new Date(Math.max(posledniSms.getTime() + n.odstupSms, now.getTime())) : now,
    n,
  );
  const smsDnes = smsCasy.some((t) => isoDate(t) === dnes);
  const sms = {
    doporucena: dnesni.length > 0 && !smsDnes && smsNejdrive.getTime() <= now.getTime(),
    nejdrive: smsNejdrive,
    odeslano: smsCasy.length,
  };
  if (denRady >= n.dnu && pocetSOdstupem(smsCasy, n.odstupSms) < n.minSms) {
    varovani.push("Norma TMCZ: během 3 PD musí odejít min. 2 SMS s odstupem 18 h.");
  }

  if (navolaneDny >= n.dnu) {
    if (!splnujeNormu) varovani.push("Pokusy nesplňují minimum normy TMCZ – před parkováním ZAK doplnit.");
    return { stav: "navrh_zak", denRady, pokusyDnes: dnesni.length, navolaneDny, pokusuDenne: n.pokusuDenne, dalsiPokus: null, sms, splnujeNormu, varovani };
  }

  let dalsiPokus: Date;
  if (!isWorkday(dnes) || dnesni.length >= n.pokusuDenne) {
    dalsiPokus = zacatekVolani(nextWorkday(dnes));
  } else if (dnesni.length === 0) {
    const t = new Date(Math.max(now.getTime(), zacatekVolani(dnes).getTime()));
    dalsiPokus = t < konecVolani(dnes) ? t : zacatekVolani(nextWorkday(dnes));
  } else {
    const t = new Date(dnesni.at(-1)!.getTime() + n.odstupPokusu);
    dalsiPokus = t < konecVolani(dnes) ? t : zacatekVolani(nextWorkday(dnes));
  }

  return {
    stav: neuspesne.length ? "probiha" : "novy",
    denRady,
    pokusyDnes: dnesni.length,
    navolaneDny,
    pokusuDenne: n.pokusuDenne,
    dalsiPokus,
    sms,
    splnujeNormu,
    varovani,
  };
}

/** Lhůta PEP pro zaparkované ZAK: N kalendářních dní (výchozí 5) od zaparkování, upozornění den předem */
export function lhutaZak(zaparkovano: Date, now: Date, dni = 5) {
  const konec = new Date(zaparkovano.getTime() + dni * 24 * HOUR);
  const zbyva = konec.getTime() - now.getTime();
  return { konec, zbyvaHodin: Math.floor(zbyva / HOUR), urgovat: zbyva <= 24 * HOUR, uplynula: zbyva <= 0 };
}
