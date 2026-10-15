// KPI zakázek a plánu. Zakázka: SLA (Do splnění v exportu = minuty do termínu realizace),
// stáří od přidělení, termín v SLA. Plán: km na instalaci, dlouhé přejezdy, vytížení.

import type { Zakazka } from "../import/mwfExport.js";
import type { VyhodnoceniTrasy } from "./trasa.js";

/** Konec SLA = čas exportu + „Do splnění“ */
export function slaKonec(z: Pick<Zakazka, "doSplneniMin">, exportAt: Date): Date | null {
  return z.doSplneniMin === null ? null : new Date(exportAt.getTime() + z.doSplneniMin * 60_000);
}

export interface KpiZakazek {
  aktivni: number;
  poSla: number;
  podilPoSla: number;
  slaDo24h: number;
  sTerminem: number;
  terminVSla: number;
  podilTerminuVSla: number;
  bezTerminu: number;
  prumerneStariDni: number;
}

export function kpiZakazek(zakazky: Zakazka[], exportAt: Date): KpiZakazek {
  const akt = zakazky.filter((z) => !z.predobjednavka);
  const poSla = akt.filter((z) => z.doSplneniMin !== null && z.doSplneniMin < 0).length;
  const slaDo24h = akt.filter((z) => z.doSplneniMin !== null && z.doSplneniMin >= 0 && z.doSplneniMin <= 24 * 60).length;
  const sTerminem = akt.filter((z) => z.termin);
  const vSla = sTerminem.filter((z) => {
    const k = slaKonec(z, exportAt);
    return !k || z.termin!.od <= k;
  }).length;
  const stari = akt.filter((z) => z.prideleno).map((z) => (exportAt.getTime() - z.prideleno!.getTime()) / 86_400_000);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    aktivni: akt.length,
    poSla,
    podilPoSla: pct(poSla, akt.length),
    slaDo24h,
    sTerminem: sTerminem.length,
    terminVSla: vSla,
    podilTerminuVSla: pct(vSla, sTerminem.length),
    bezTerminu: akt.length - sTerminem.length,
    prumerneStariDni: stari.length ? Math.round((stari.reduce((s, x) => s + x, 0) / stari.length) * 10) / 10 : 0,
  };
}

export interface KpiPlanu {
  dni: number;
  instalaci: number;
  km: number;
  kmNaInstalaci: number;
  instalaciNaDen: number;
  dlouhePrejezdy: number;
  neproveditelneDny: number;
}

export function kpiPlanu(dny: { trasa: VyhodnoceniTrasy }[]): KpiPlanu {
  const sPraci = dny.filter((d) => d.trasa.poradi.length);
  const instalaci = sPraci.reduce((s, d) => s + d.trasa.poradi.length, 0);
  const km = sPraci.reduce((s, d) => s + d.trasa.km, 0);
  return {
    dni: sPraci.length,
    instalaci,
    km: Math.round(km),
    kmNaInstalaci: instalaci ? Math.round((km / instalaci) * 10) / 10 : 0,
    instalaciNaDen: sPraci.length ? Math.round((instalaci / sPraci.length) * 10) / 10 : 0,
    dlouhePrejezdy: sPraci.reduce((s, d) => s + d.trasa.dlouhePrejezdy.length, 0),
    neproveditelneDny: sPraci.filter((d) => !d.trasa.proveditelna).length,
  };
}
