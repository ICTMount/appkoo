// Režim B plánování (fáze 1): vybraný time slot technika → zakázky, které ho nejlépe doplní.
//
// Kandidáti: otevřené zakázky bez termínu, které projdou branami (ZAK, JP, blokace), se správnou
// dovedností – a navíc už naplánované zakázky s poznámkou „flex“ (zákazník je flexibilní), pokud
// je slot dřív než jejich současný termín (přesun dopředu).
// Každý kandidát se zkusmo vloží do trasy dne technika (TSP s časovými okny); řadí se podle
// naléhavosti SLA a priority, pak podle km navíc. Zajížďka nad limit (75 km) se nenabízí.

import type { Priorita } from "../domain/priorita.js";
import type { Zakazka } from "../import/mwfExport.js";
import type { Bod, Vzdalenosti } from "./geo.js";
import type { Okno, DenSOkny } from "./sloty.js";
import { NASTAVENI_PLANU } from "./sloty.js";
import { nejlepsiPoradi, vyhodnotTrasu } from "./trasa.js";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Pozitivní poznámka „flex“ – zákazník je flexibilní, termín jde přeplánovat
 * („Flex tento den“, „flexibilní“, „flex kdykoli“). Zápory („ne flex“, „neflex“, „není flex“, „flex ne“) se nepočítají.
 */
export function jeFlex(text: string): boolean {
  const t = norm(text);
  if (!/flex/.test(t)) return false;
  return !/\b(ne|neni|bez)\s*-?\s*flex|\bneflex|flex\w*\s*[:-]?\s*(ne|neni|nelze)\b/.test(t);
}

export interface Kandidat {
  z: Zakazka;
  priorita: Priorita;
  slaKonec: Date | null;
  bod: Bod;
  /** naplánovaná zakázka s „flex“ – kde je dnes (po zápisu se vrátí na VOLNY) */
  presun?: { kalendar: string; eventId: string; technik: string; od: Date };
}

export interface NavrhDoplneni {
  kandidat: Kandidat;
  kmNavic: number;
  kmDne: number;
  poSla: boolean;
  skore: number;
  duvody: string[];
}

export interface NastaveniDoplneni {
  maxZajizdkaKm: number;
  /** bonus (v km) podle naléhavosti SLA vzhledem k začátku slotu */
  bonusSlaProslo: number;
  bonusSlaDo48h: number;
  bonusSlaDo5dni: number;
  bonusPriorita: Record<Priorita, number>;
  trvaniMin: number;
  /** „zvýšit toleranci“: povolený pozdější příjezd na další zakázku jako podíl délky okna (0,25 = 25 %) */
  tolerance?: number;
}

export const NASTAVENI_DOPLNENI: NastaveniDoplneni = {
  maxZajizdkaKm: NASTAVENI_PLANU.maxZajizdkaKm, // 75 km – bude se zpřesňovat
  bonusSlaProslo: 60,
  bonusSlaDo48h: 40,
  bonusSlaDo5dni: 20,
  bonusPriorita: { P1: 20, P2: 10, P3: 0, P0: 0 },
  trvaniMin: 90,
};

/** Začátek slotu v daný den („Praha v UTC“) */
const zacatek = (datum: string, okno: Okno) => new Date(Date.parse(`${datum}T00:00:00Z`) + okno.od * 60_000);

export function doplnSlot(den: DenSOkny, okno: Okno, kandidati: Kandidat[], v: Vzdalenosti, n: Partial<NastaveniDoplneni> = {}, pocet = 10): NavrhDoplneni[] {
  const nast = { ...NASTAVENI_DOPLNENI, ...n };
  const d = nast.tolerance ? { ...den.den, tolerance: nast.tolerance } : den.den;
  const zaklad = nejlepsiPoradi(d, v) ?? vyhodnotTrasu(d, [...d.navstevy].sort((a, b) => a.od - b.od), v);
  const start = zacatek(d.datum, okno);
  const vysledek: NavrhDoplneni[] = [];

  for (const k of kandidati) {
    if (k.presun && k.presun.od <= start) continue; // přesouvat jen dopředu
    if (d.navstevy.some((x) => x.id === k.z.idAktivity)) continue; // už je v tomto dni
    const t = nejlepsiPoradi({ ...d, navstevy: [...d.navstevy, { id: k.z.idAktivity, bod: k.bod, od: okno.od, do: okno.do, trvani: nast.trvaniMin }] }, v);
    if (!t) continue;
    const kmNavic = t.km - zaklad.km;
    if (kmNavic > nast.maxZajizdkaKm) continue;

    const duvody: string[] = [];
    let bonus = 0;
    const poSla = !!k.slaKonec && start > k.slaKonec;
    if (k.slaKonec) {
      const hodin = (k.slaKonec.getTime() - start.getTime()) / 3_600_000;
      if (hodin <= 0) {
        bonus += nast.bonusSlaProslo;
        duvody.push("SLA už prošlo");
      } else if (hodin <= 48) {
        bonus += nast.bonusSlaDo48h;
        duvody.push("SLA do 48 h");
      } else if (hodin <= 120) {
        bonus += nast.bonusSlaDo5dni;
        duvody.push("SLA do 5 dní");
      }
    }
    bonus += nast.bonusPriorita[k.priorita] ?? 0;
    if (k.priorita === "P1" || k.priorita === "P2") duvody.push(`priorita ${k.priorita}`);
    if (k.presun) duvody.push("přesun dopředu (flex)");
    const pozde = Math.max(0, ...t.zastavky.map((x) => x.zpozdeni));
    if (pozde > 0) duvody.push(`další zakázka o ${Math.round(pozde)} min později`);
    const sem = t.zastavky.find((x) => x.id === k.z.idAktivity);
    if (sem && sem.prijezd - (t.zastavky[t.zastavky.indexOf(sem) - 1]?.konec ?? d.pracujeOd) > 30) {
      duvody.push(`přejezd ${Math.round(sem.prijezd - (t.zastavky[t.zastavky.indexOf(sem) - 1]?.konec ?? d.pracujeOd))} min`);
    }
    vysledek.push({ kandidat: k, kmNavic, kmDne: t.km, poSla, skore: kmNavic - bonus, duvody });
  }
  return vysledek.sort((a, b) => a.skore - b.skore).slice(0, pocet);
}
