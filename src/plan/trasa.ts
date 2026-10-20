// Den technika jako trasa s časovými okny (problém obchodního cestujícího s okny, TSPTW).
// Návštěvy s dohodnutým termínem mají pevné okno; návštěvy bez termínu mají okno celý den.
// Pro malý počet návštěv (≤ 8) hledá přesně nejkratší proveditelné pořadí, jinak
// nejbližší soused + 2-opt.

import type { Bod, Vzdalenosti } from "./geo.js";

export interface Navsteva {
  id: string;
  bod: Bod;
  /** časové okno začátku práce v minutách od půlnoci */
  od: number;
  do: number;
  /** délka práce v minutách (MWF „Časová náročnosť“) */
  trvani: number;
}

export interface DenTechnika {
  technik: string;
  datum: string; // YYYY-MM-DD
  zakladna: Bod;
  /** kam se technik večer vrací (výchozí základna) */
  konec?: Bod;
  pracujeOd: number; // minuty od půlnoci
  pracujeDo: number;
  navstevy: Navsteva[];
  /** povolený pozdější příjezd po konci okna v % délky okna (0,25 = 25 %) – „zvýšit toleranci“ */
  tolerance?: number;
}

export interface Zastavka {
  id: string;
  prijezd: number;
  zacatek: number;
  konec: number;
  kmPrejezd: number;
  /** o kolik minut přijede po konci okna (0 = v pořádku) */
  zpozdeni: number;
}

export interface VyhodnoceniTrasy {
  poradi: string[];
  zastavky: Zastavka[];
  km: number;
  /** km z poslední zakázky zpět na základnu */
  kmZpet: number;
  navrat: number;
  proveditelna: boolean;
  /** přejezdy delší než limit (výchozí 50 km) */
  dlouhePrejezdy: { z: string; do: string; km: number }[];
}

export const LIMIT_DLOUHY_PREJEZD_KM = 50;

/** Tolerance pozdějšího příjezdu pro návštěvu (min): podíl délky jejího okna (2h slot × 25 % = 30 min) */
const tolerance = (den: DenTechnika, n: Navsteva) => (den.tolerance ? Math.round((n.do - n.od + 1) * den.tolerance) : 0);

export function vyhodnotTrasu(den: DenTechnika, poradi: Navsteva[], v: Vzdalenosti): VyhodnoceniTrasy {
  let cas = den.pracujeOd;
  let poloha = den.zakladna;
  let predchozi = "základna";
  let km = 0;
  let proveditelna = true;
  const zastavky: Zastavka[] = [];
  const dlouhe: VyhodnoceniTrasy["dlouhePrejezdy"] = [];

  for (const n of poradi) {
    const k = v.km(poloha, n.bod);
    if (k > LIMIT_DLOUHY_PREJEZD_KM) dlouhe.push({ z: predchozi, do: n.id, km: Math.round(k) });
    const prijezd = cas + v.minuty(poloha, n.bod);
    const zacatek = Math.max(prijezd, n.od);
    const zpozdeni = Math.max(0, zacatek - n.do);
    if (zpozdeni > tolerance(den, n)) proveditelna = false;
    zastavky.push({ id: n.id, prijezd, zacatek, konec: zacatek + n.trvani, kmPrejezd: k, zpozdeni });
    km += k;
    cas = zacatek + n.trvani;
    poloha = n.bod;
    predchozi = n.id;
  }
  const cil = den.konec ?? den.zakladna;
  const kmZpet = poradi.length ? v.km(poloha, cil) : 0;
  const navrat = cas + (poradi.length ? v.minuty(poloha, cil) : 0);
  if (navrat > den.pracujeDo) proveditelna = false;
  return { poradi: poradi.map((n) => n.id), zastavky, km: km + kmZpet, kmZpet, navrat, proveditelna, dlouhePrejezdy: dlouhe };
}

/** Pořadí s nejmenším počtem km, které dodrží všechna časová okna (null = žádné neexistuje) */
export function nejlepsiPoradi(den: DenTechnika, v: Vzdalenosti): VyhodnoceniTrasy | null {
  const n = den.navstevy;
  if (n.length <= 8) return presne(den, v);
  return heuristika(den, v);
}

function presne(den: DenTechnika, v: Vzdalenosti): VyhodnoceniTrasy | null {
  let nejlepsi: VyhodnoceniTrasy | null = null;
  const pouzite = new Array(den.navstevy.length).fill(false);
  const cesta: Navsteva[] = [];

  // Prohledávání s ořezáváním: větev končí, když poruší okno nebo už je delší než nejlepší
  const krok = (cas: number, poloha: Bod, km: number) => {
    if (nejlepsi && km >= nejlepsi.km) return;
    if (cesta.length === den.navstevy.length) {
      const t = vyhodnotTrasu(den, cesta, v);
      if (t.proveditelna && (!nejlepsi || t.km < nejlepsi.km)) nejlepsi = t;
      return;
    }
    den.navstevy.forEach((nv, i) => {
      if (pouzite[i]) return;
      const zacatek = Math.max(cas + v.minuty(poloha, nv.bod), nv.od);
      if (zacatek > nv.do + tolerance(den, nv)) return;
      pouzite[i] = true;
      cesta.push(nv);
      krok(zacatek + nv.trvani, nv.bod, km + v.km(poloha, nv.bod));
      cesta.pop();
      pouzite[i] = false;
    });
  };
  krok(den.pracujeOd, den.zakladna, 0);
  return nejlepsi;
}

function heuristika(den: DenTechnika, v: Vzdalenosti): VyhodnoceniTrasy | null {
  // Start: podle začátku okna (pevné termíny drží pořadí), mezi rovnými nejbližší soused
  const zbyva = [...den.navstevy];
  const poradi: Navsteva[] = [];
  let poloha = den.zakladna;
  while (zbyva.length) {
    zbyva.sort((a, b) => a.do - b.do || v.km(poloha, a.bod) - v.km(poloha, b.bod));
    const dalsi = zbyva.shift()!;
    poradi.push(dalsi);
    poloha = dalsi.bod;
  }
  let nejlepsi = vyhodnotTrasu(den, poradi, v);
  // 2-opt: otočení úseku, přijme se jen proveditelné zlepšení
  let zlepseni = true;
  while (zlepseni) {
    zlepseni = false;
    for (let i = 0; i < poradi.length - 1; i++) {
      for (let j = i + 1; j < poradi.length; j++) {
        const zkusit = [...poradi.slice(0, i), ...poradi.slice(i, j + 1).reverse(), ...poradi.slice(j + 1)];
        const t = vyhodnotTrasu(den, zkusit, v);
        if (t.proveditelna && (!nejlepsi.proveditelna || t.km < nejlepsi.km - 0.01)) {
          poradi.splice(0, poradi.length, ...zkusit);
          nejlepsi = t;
          zlepseni = true;
        }
      }
    }
  }
  return nejlepsi.proveditelna ? nejlepsi : null;
}
