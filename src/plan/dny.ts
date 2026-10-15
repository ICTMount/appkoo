// Sestaví dny techniků pro optimalizaci ze skutečných dat:
// zakázky = události v kalendáři technika (adresa → souřadnice), volná okna = události VOLNY,
// start a konec dne = adresa výjezdu technika z číselníku Technici.

import { isoDate, minutesOfDay } from "../domain/time.js";
import { jeBlok, jeVolneOkno, volnaOkna, type UdalostTechnika } from "../gcal/kontrola.js";
import type { Bod } from "./geo.js";
import type { Geokoder } from "./geokod.js";
import type { DenSOkny } from "./sloty.js";
import type { Navsteva } from "./trasa.js";

export interface TechnikProPlan {
  jmeno: string;
  vyjezd: string; // adresa z číselníku
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
  vychoziDelkaMin = 110,
  /** úplná adresa z MWF (místo v kalendáři bývá bez obce: „Podolská 348/88“) */
  adresaZMwf: (u: UdalostTechnika) => string | undefined = () => undefined,
): Promise<SestaveneDny> {
  const dny: DenSOkny[] = [];
  const bezPolohy: UdalostTechnika[] = [];
  const bezZakladny: string[] = [];

  for (const t of technici) {
    const zakladna = t.vyjezd ? (await geokoder.najdi(t.vyjezd)).bod : null;
    if (!zakladna) {
      bezZakladny.push(t.jmeno);
      continue;
    }
    const jeho = udalosti.filter((u) => u.technik === t.jmeno && isoDate(u.od) === datum && !jeVolneOkno(u) && !jeBlok(u));
    const navstevy: Navsteva[] = [];
    for (const u of jeho) {
      const adresa = adresaZMwf(u) ?? u.location;
      const bod: Bod | null = adresa ? (await geokoder.najdi(adresa)).bod : null;
      if (!bod) {
        bezPolohy.push(u);
        continue;
      }
      // dohodnutý termín = okno pro příjezd; délka práce z události, jinak výchozí (MWF 1 h 50 min)
      const delka = Math.round((u.do.getTime() - u.od.getTime()) / 60_000);
      navstevy.push({ id: u.appkoo ?? u.id, bod, od: minutesOfDay(u.od), do: minutesOfDay(u.do) - 1, trvani: Math.min(delka, vychoziDelkaMin) || vychoziDelkaMin });
    }
    dny.push({
      den: { technik: t.jmeno, datum, zakladna, pracujeOd: t.pracujeOd ?? 7 * 60 + 30, pracujeDo: t.pracujeDo ?? 19 * 60, navstevy },
      volnaOkna: volnaOkna(udalosti, t.jmeno, datum),
    });
  }
  return { dny, bezPolohy, bezZakladny };
}
