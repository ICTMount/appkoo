// Pravidla kontaktování zákazníka při dojednávání termínu (spec kap. 2).
//
// Interní pravidlo Vegacom: 2 pokusy denně s odstupem min. 4 h, 3 po sobě jdoucí
// pracovní dny, SMS typicky 1× denně; volá se 8:00–19:00. Po 6 neúspěšných pokusech
// (3 kompletní dny) → návrh parkování „Zákazník - nedostupný“ (ZAK).
// Závazné minimum normy TMCZ R-280-244: min. 3 pokusy během 3 PD s rozestupem 4 h,
// min. 2 SMS během 3 PD s odstupem min. 18 h, SMS jen 8:00–22:00.

import { atTime, fmtDate, HOUR, isoDate, minutesOfDay, type IsoDate } from "./time.js";
import { isWorkday, nextWorkday, workdaysBetween } from "./workdays.js";

export interface Pokus {
  at: Date;
  dovolano: boolean;
  sms: boolean;
}

export const PRAVIDLA = {
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

export interface PlanKontaktu {
  stav: "novy" | "probiha" | "dovolano" | "navrh_zak";
  /** kolikátý pracovní den řady (1–3, může přetéct) */
  denRady: number;
  pokusyDnes: number;
  /** pracovní dny s 2 neúspěšnými pokusy s odstupem ≥ 4 h */
  kompletniDny: number;
  dalsiPokus: Date | null;
  sms: { doporucena: boolean; nejdrive: Date | null; odeslano: number };
  splnujeNormu: boolean;
  varovani: string[];
}

function zacatekVolani(d: IsoDate): Date {
  return atTime(d, 0, PRAVIDLA.volaniOd);
}

function konecVolani(d: IsoDate): Date {
  return atTime(d, 0, PRAVIDLA.volaniDo);
}

/** Nejbližší okamžik ≥ t, kdy lze poslat SMS (8:00–22:00 v pracovní den) */
function doOknaSms(t: Date): Date {
  const d = isoDate(t);
  const m = minutesOfDay(t);
  if (isWorkday(d) && m >= PRAVIDLA.smsOd && m < PRAVIDLA.smsDo) return t;
  if (isWorkday(d) && m < PRAVIDLA.smsOd) return atTime(d, 0, PRAVIDLA.smsOd);
  return atTime(nextWorkday(d), 0, PRAVIDLA.smsOd);
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
export function planKontaktu(pokusy: Pokus[], now: Date): PlanKontaktu {
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
      kompletniDny: 0,
      dalsiPokus: null,
      sms: { doporucena: false, nejdrive: null, odeslano: smsCasy.length },
      splnujeNormu: true,
      varovani,
    };
  }

  const neuspesne = serazene.filter((p) => !p.dovolano);
  const poDnech = new Map<IsoDate, Date[]>();
  for (const p of neuspesne) {
    const d = isoDate(p.at);
    poDnech.set(d, [...(poDnech.get(d) ?? []), p.at]);
  }

  const dnesni = poDnech.get(dnes) ?? [];
  const kompletniDny = [...poDnech.values()].filter(
    (casy) => pocetSOdstupem(casy, PRAVIDLA.odstupPokusu) >= PRAVIDLA.pokusuDenne,
  ).length;

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
  if (prvniDnes && minutesOfDay(prvniDnes) > PRAVIDLA.volaniDo - 4 * 60) {
    varovani.push("První pokus dne byl až po 15:00 – druhý pokus s odstupem 4 h se dnes nestihne.");
  }

  const splnujeNormu =
    pocetSOdstupem(
      neuspesne.map((p) => p.at),
      PRAVIDLA.odstupPokusu,
    ) >= PRAVIDLA.minPokusuNorma && pocetSOdstupem(smsCasy, PRAVIDLA.odstupSms) >= PRAVIDLA.minSms;

  const smsNejdrive = doOknaSms(
    posledniSms ? new Date(Math.max(posledniSms.getTime() + PRAVIDLA.odstupSms, now.getTime())) : now,
  );
  const smsDnes = smsCasy.some((t) => isoDate(t) === dnes);
  const sms = {
    doporucena: dnesni.length > 0 && !smsDnes && smsNejdrive.getTime() <= now.getTime(),
    nejdrive: smsNejdrive,
    odeslano: smsCasy.length,
  };
  if (denRady >= PRAVIDLA.dnu && pocetSOdstupem(smsCasy, PRAVIDLA.odstupSms) < PRAVIDLA.minSms) {
    varovani.push("Norma TMCZ: během 3 PD musí odejít min. 2 SMS s odstupem 18 h.");
  }

  if (kompletniDny >= PRAVIDLA.dnu) {
    if (!splnujeNormu) varovani.push("Pokusy nesplňují minimum normy TMCZ – před parkováním ZAK doplnit.");
    return { stav: "navrh_zak", denRady, pokusyDnes: dnesni.length, kompletniDny, dalsiPokus: null, sms, splnujeNormu, varovani };
  }

  let dalsiPokus: Date;
  if (!isWorkday(dnes) || dnesni.length >= PRAVIDLA.pokusuDenne) {
    dalsiPokus = zacatekVolani(nextWorkday(dnes));
  } else if (dnesni.length === 0) {
    const t = new Date(Math.max(now.getTime(), zacatekVolani(dnes).getTime()));
    dalsiPokus = t < konecVolani(dnes) ? t : zacatekVolani(nextWorkday(dnes));
  } else {
    const t = new Date(dnesni.at(-1)!.getTime() + PRAVIDLA.odstupPokusu);
    dalsiPokus = t < konecVolani(dnes) ? t : zacatekVolani(nextWorkday(dnes));
  }

  return {
    stav: neuspesne.length ? "probiha" : "novy",
    denRady,
    pokusyDnes: dnesni.length,
    kompletniDny,
    dalsiPokus,
    sms,
    splnujeNormu,
    varovani,
  };
}

/** Lhůta PEP pro zaparkované ZAK: 5 kalendářních dní od zaparkování, upozornění den předem */
export function lhutaZak(zaparkovano: Date, now: Date) {
  const konec = new Date(zaparkovano.getTime() + 5 * 24 * HOUR);
  const zbyva = konec.getTime() - now.getTime();
  return { konec, zbyvaHodin: Math.floor(zbyva / HOUR), urgovat: zbyva <= 24 * HOUR, uplynula: zbyva <= 0 };
}
