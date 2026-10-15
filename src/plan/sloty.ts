// Nabídka termínů a návrh plánu s ohledem na trasy a KPI zakázky (SLA).
//
// Nabídka termínů (při hovoru): pro zakázku se zkusí každé volné okno každého vhodného technika,
// vloží se do jeho dne a spočítá nejkratší proveditelná trasa. Hodnotí se o kolik km se den
// prodlouží; okno po termínu SLA dostane penalizaci, pozdější den mírnou penalizaci podle
// priority. Výsledek: seřazené nejlepší možnosti.
//
// Návrh plánu (dávkově, např. „doplnit zítřek“): zakázky podle hodnoty (priorita, SLA) se
// postupně vkládají do nejlepšího okna, pak se zkouší přesuny, které sníží celkové km.

import type { Bod, Vzdalenosti } from "./geo.js";
import { nejlepsiPoradi, vyhodnotTrasu, type DenTechnika, type VyhodnoceniTrasy } from "./trasa.js";
import type { Priorita } from "../domain/priorita.js";

export interface Okno {
  od: number; // minuty od půlnoci
  do: number;
}

export interface DenSOkny {
  den: DenTechnika;
  volnaOkna: Okno[];
}

export interface ZakazkaKPlanu {
  id: string;
  bod: Bod;
  trvani: number;
  priorita: Priorita;
  /** termín SLA (MWF „LT ST (Dátum realizácie)“ / Do splnění) */
  slaKonec: Date | null;
}

export interface NastaveniPlanu {
  /** maximální zajížďka v km pro jednu zakázku */
  maxZajizdkaKm: number;
  /** penalizace okna po termínu SLA (v km) */
  penalizacePoSlaKm: number;
  /** penalizace za každý den odkladu podle priority (v km) */
  penalizaceDneKm: Record<Priorita, number>;
}

export const NASTAVENI_PLANU: NastaveniPlanu = {
  maxZajizdkaKm: 60,
  penalizacePoSlaKm: 80,
  penalizaceDneKm: { P1: 15, P2: 8, P3: 3, P0: 0 },
};

export interface Moznost {
  technik: string;
  datum: string;
  okno: Okno;
  kmNavic: number;
  kmDne: number;
  poSla: boolean;
  skore: number;
  trasa: VyhodnoceniTrasy;
}

const den0 = (d: string) => Date.parse(`${d}T00:00:00Z`);

function zakladTrasy(den: DenTechnika, v: Vzdalenosti): VyhodnoceniTrasy {
  return nejlepsiPoradi(den, v) ?? vyhodnotTrasu(den, [...den.navstevy].sort((a, b) => a.od - b.od), v);
}

export function nabidniTerminy(
  z: ZakazkaKPlanu,
  dny: DenSOkny[],
  v: Vzdalenosti,
  dnes: string,
  n: Partial<NastaveniPlanu> = {},
  pocet = 3,
): Moznost[] {
  const nast = { ...NASTAVENI_PLANU, ...n };
  const moznosti: Moznost[] = [];
  for (const { den, volnaOkna } of dny) {
    const zaklad = zakladTrasy(den, v);
    for (const okno of volnaOkna) {
      const s = { ...den, navstevy: [...den.navstevy, { id: z.id, bod: z.bod, od: okno.od, do: okno.do, trvani: z.trvani }] };
      const t = nejlepsiPoradi(s, v);
      if (!t) continue;
      const kmNavic = t.km - zaklad.km;
      if (kmNavic > nast.maxZajizdkaKm) continue;
      const zacatek = new Date(den0(den.datum) + okno.od * 60_000);
      const poSla = !!z.slaKonec && zacatek > z.slaKonec;
      const dniOdkladu = Math.max(0, Math.round((den0(den.datum) - den0(dnes)) / 86_400_000));
      const skore = kmNavic + (poSla ? nast.penalizacePoSlaKm : 0) + dniOdkladu * nast.penalizaceDneKm[z.priorita];
      moznosti.push({ technik: den.technik, datum: den.datum, okno, kmNavic, kmDne: t.km, poSla, skore, trasa: t });
    }
  }
  return moznosti.sort((a, b) => a.skore - b.skore).slice(0, pocet);
}

export interface Prirazeni {
  zakazka: string;
  technik: string;
  datum: string;
  okno: Okno;
  kmNavic: number;
  poSla: boolean;
}

export interface NavrhPlanu {
  prirazeni: Prirazeni[];
  neprirazene: { zakazka: string; duvod: string }[];
  kmCelkem: number;
  dny: { technik: string; datum: string; trasa: VyhodnoceniTrasy }[];
}

const VAHA: Record<Priorita, number> = { P1: 3, P2: 2, P3: 1, P0: 0 };

/** Hodnota zakázky pro pořadí vkládání: priorita, pak blízkost SLA */
function hodnota(z: ZakazkaKPlanu, dnes: string): number {
  const doSla = z.slaKonec ? (z.slaKonec.getTime() - den0(dnes)) / 86_400_000 : 30;
  return VAHA[z.priorita] * 100 - Math.min(doSla, 30);
}

export function navrhniPlan(zakazky: ZakazkaKPlanu[], dny: DenSOkny[], v: Vzdalenosti, dnes: string, n: Partial<NastaveniPlanu> = {}): NavrhPlanu {
  const stav = dny.map((d) => ({ den: { ...d.den, navstevy: [...d.den.navstevy] }, volnaOkna: [...d.volnaOkna] }));
  const prirazeni: Prirazeni[] = [];
  const neprirazene: NavrhPlanu["neprirazene"] = [];

  for (const z of [...zakazky].filter((x) => x.priorita !== "P0").sort((a, b) => hodnota(b, dnes) - hodnota(a, dnes))) {
    const m = nabidniTerminy(z, stav, v, dnes, n, 1)[0];
    if (!m) {
      neprirazene.push({ zakazka: z.id, duvod: "žádné volné okno v regionu nebo zajížďka nad limit" });
      continue;
    }
    const cil = stav.find((d) => d.den.technik === m.technik && d.den.datum === m.datum)!;
    cil.den.navstevy.push({ id: z.id, bod: z.bod, od: m.okno.od, do: m.okno.do, trvani: z.trvani });
    cil.volnaOkna = cil.volnaOkna.filter((o) => o !== m.okno);
    prirazeni.push({ zakazka: z.id, technik: m.technik, datum: m.datum, okno: m.okno, kmNavic: m.kmNavic, poSla: m.poSla });
  }

  const vysledneDny = stav.map((d) => ({ technik: d.den.technik, datum: d.den.datum, trasa: zakladTrasy(d.den, v) }));
  return { prirazeni, neprirazene, kmCelkem: vysledneDny.reduce((s, d) => s + d.trasa.km, 0), dny: vysledneDny };
}
