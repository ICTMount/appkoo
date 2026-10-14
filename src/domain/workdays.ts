// Pracovní dny pro pravidla kontaktování: Po–Pá bez státních svátků ČR
// (spec kap. 2 a kap. 8, bod 7). Lhůta PEP 5 KD je v kalendářních dnech – svátky se tam počítají.

import { addDays, fromIso, isoDate, type IsoDate } from "./time.js";

/** Velikonoční neděle (anonymní gregoriánský algoritmus) */
function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(new Date(Date.UTC(year, month - 1, day)));
}

const FIXED = ["01-01", "05-01", "05-08", "07-05", "07-06", "09-28", "10-28", "11-17", "12-24", "12-25", "12-26"];

const cache = new Map<number, Set<IsoDate>>();

export function czechHolidays(year: number): Set<IsoDate> {
  let set = cache.get(year);
  if (!set) {
    const easter = easterSunday(year);
    set = new Set([...FIXED.map((md) => `${year}-${md}`), addDays(easter, -2), addDays(easter, 1)]);
    cache.set(year, set);
  }
  return set;
}

export function isWorkday(d: IsoDate): boolean {
  const dow = fromIso(d).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !czechHolidays(Number(d.slice(0, 4))).has(d);
}

export function nextWorkday(d: IsoDate): IsoDate {
  let n = addDays(d, 1);
  while (!isWorkday(n)) n = addDays(n, 1);
  return n;
}

/** Počet pracovních dnů v intervalu <from, to> včetně obou krajů */
export function workdaysBetween(from: IsoDate, to: IsoDate): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d)) n++;
  return n;
}
