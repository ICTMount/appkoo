// Sestaví dny techniků pro optimalizaci ze skutečných dat:
// zakázky = události v kalendáři technika (adresa → souřadnice), volná okna = události VOLNY,
// start a konec dne = adresa výjezdu technika z číselníku Technici. Má-li technik i 2. adresu výjezdu,
// vzniknou dvě varianty dne (z každé adresy) a nabídka si vezme výhodnější.

import { isoDate, minutesOfDay } from "../domain/time.js";
import { jeBlok, jeVolneOkno, volnaOkna, type UdalostTechnika } from "../gcal/kontrola.js";
import type { Bod } from "./geo.js";
import type { Geokoder } from "./geokod.js";
import type { DenSOkny } from "./sloty.js";
import type { Navsteva } from "./trasa.js";

export interface TechnikProPlan {
  jmeno: string;
  vyjezd: string; // primární adresa z číselníku
  /** druhá adresa výjezdu – den se zkusí z obou a plánovač vezme výhodnější */
  vyjezd2?: string;
  pracujeOd?: number;
  pracujeDo?: number;
}

export interface SestaveneDny {
  dny: DenSOkny[];
  /** události, u kterých se nepodařilo zjistit polohu – v trase chybí, je potřeba doplnit adresu */
  bezPolohy: UdalostTechnika[];
  /** technici bez adresy výjezdu – nelze je plánovat */
  bezZakladny: string[];
}

export async function sestavDny(
  technici: TechnikProPlan[],
  udalosti: UdalostTechnika[],
  datum: string,
  geokoder: Geokoder,
  vychoziDelkaMin = 90,
  /** úplná adresa z MWF (místo v kalendáři bývá bez obce: „Podolská 348/88“) */
  adresaZMwf: (u: UdalostTechnika) => string | undefined = () => undefined,
): Promise<SestaveneDny> {
  const dny: DenSOkny[] = [];
  const bezPolohy: UdalostTechnika[] = [];
  const bezZakladny: string[] = [];

  // všechny adresy dne najednou (souběžně) – pak už se jen skládá
  const adresy = new Set<string>();
  const vDni = udalosti.filter((u) => isoDate(u.od) === datum && !jeVolneOkno(u) && !jeBlok(u));
  for (const t of technici) [t.vyjezd, t.vyjezd2].forEach((a) => a && adresy.add(a));
  for (const u of vDni) {
    const a = adresaZMwf(u) ?? u.location;
    if (a) adresy.add(a);
  }
  const body = new Map<string, Bod | null>();
  await Promise.all([...adresy].map(async (a) => body.set(a, (await geokoder.najdi(a)).bod)));
  const bodAdresy = (a: string | undefined | null) => (a ? (body.get(a) ?? null) : null);

  for (const t of technici) {
    const zakladna = bodAdresy(t.vyjezd);
    const zakladna2 = bodAdresy(t.vyjezd2);
    if (!zakladna) {
      bezZakladny.push(t.jmeno);
      continue;
    }
    const jeho = vDni.filter((u) => u.technik === t.jmeno);
    const navstevy: Navsteva[] = [];
    for (const u of jeho) {
      const adresa = adresaZMwf(u) ?? u.location;
      const bod = bodAdresy(adresa);
      if (!bod) {
        bezPolohy.push(u);
        continue;
      }
      // dohodnutý termín = okno pro příjezd; délka práce z události, jinak výchozí (MWF 1 h 50 min)
      const delka = Math.round((u.do.getTime() - u.od.getTime()) / 60_000);
      navstevy.push({ id: u.appkoo ?? u.id, bod, od: minutesOfDay(u.od), do: minutesOfDay(u.do) - 1, trvani: Math.min(delka, vychoziDelkaMin) || vychoziDelkaMin });
    }
    for (const z of zakladna2 ? [zakladna, zakladna2] : [zakladna]) {
      dny.push({
        den: { technik: t.jmeno, datum, zakladna: z, pracujeOd: t.pracujeOd ?? 7 * 60 + 30, pracujeDo: t.pracujeDo ?? 19 * 60, navstevy },
        volnaOkna: volnaOkna(udalosti, t.jmeno, datum),
      });
    }
  }
  return { dny, bezPolohy, bezZakladny };
}
