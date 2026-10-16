// Kontrola MWF ↔ Google Kalendář (zlaté pravidlo č. 1: musí být 100% shodné).
// Každý dohodnutý termín z MWF se páruje s událostí v kalendáři technika – nejdřív podle
// skrytého ID zakázky (události vytvořené aplikací), jinak podle čísla O- nebo S7 v textu.
// Kontroluje se technik, den a čas (tolerance 30 min), adresa (shoda ≥ 80 %) a telefon.
// Události „VOLNY“ nejsou zakázky – jsou to volná okna pro plánovač.

import type { Zakazka } from "../import/mwfExport.js";
import { isoDate, minutesOfDay } from "../domain/time.js";
import { zakladniCisloObjednavky } from "../domain/slovnik.js";
import type { Okno } from "../plan/sloty.js";

export interface UdalostTechnika {
  kalendar: string;
  technik: string;
  id: string;
  summary: string;
  description: string;
  location: string;
  /** „Praha v UTC“ */
  od: Date;
  do: Date;
  appkoo?: string; // skryté ID zakázky
  /** colorId události; 10 (zelená) = volný slot ze SHEET2CAL */
  barva?: string;
}

export type Zavaznost = "shoda" | "admin" | "rozpor";

export interface VysledekKontroly {
  zakazka: string;
  objednavka: string;
  udalost: UdalostTechnika | null;
  zavaznost: Zavaznost;
  problemy: string[];
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const VOLNO = /\bvoln[yáé]\b|\bvolno\b/i;
/** Blokovaný čas technika („Hristov - NEPLANOVAT“) – není zakázka ani volné okno */
const BLOK = /neplanovat|nedostupn|dovolen|skoleni/i;

export const jeVolneOkno = (u: Pick<UdalostTechnika, "summary"> & { barva?: string }) =>
  (VOLNO.test(norm(u.summary)) || (u.barva === "10" && !/O-\d{6,}/.test(u.summary))) && !/dohod/i.test(u.summary);
/**
 * Nestandardní volný slot „Papez - VOLNY sz“: zkrácený slot pro změnu smlouvy u FTTH nebo servisní
 * zásah u PIV. Není to zakázka, ale plánovač ho pro novou instalaci nenabízí – zobrazí se jen pro info.
 */
export const jeVyhrazeneVolno = (u: Pick<UdalostTechnika, "summary"> & { barva?: string }) =>
  jeVolneOkno(u) && /\bvoln[yae]\b\s*[-–:]?\s*sz\b/.test(norm(u.summary));
export const jeBlok = (u: Pick<UdalostTechnika, "summary">) => BLOK.test(norm(u.summary));

/**
 * Shoda adresy z MWF s textem události (0–1): číslo popisné + název ulice.
 * MWF píše „Praha, Podolská 348/88“, kalendář často jen „Podolská 348/88“ – obec se neporovnává.
 */
export function podobnostAdres(mwf: string, kalendar: string): number {
  const a = norm(mwf);
  const b = norm(kalendar);
  const cisla = a.match(/\d+(?:\/\d+\w?)?/g) ?? [];
  const cisloPopisne = cisla.find((c) => c.includes("/")) ?? cisla.at(-1);
  const obce = new Set(["praha", "brno", "ostrava", "plzen"]);
  const ulice = (a.match(/\p{L}{4,}/gu) ?? []).filter((w) => !obce.has(w));
  const cisloSedi = !!cisloPopisne && new RegExp(`(^|[^\\d])${cisloPopisne.replace("/", "\\/")}($|[^\\d])`).test(b);
  const uliceSedi = ulice.some((w) => b.includes(w));
  return (cisloSedi ? 0.5 : 0) + (uliceSedi ? 0.5 : 0);
}

/** Patří událost technikovi z MWF? MWF má „Příjmení Jméno (Vegacom)“, kalendář jméno technika. */
export function stejnyTechnik(mwf: string, technik: string): boolean {
  const t = norm(technik).split(/\s+/)[0] ?? "";
  return !!t && norm(mwf).includes(t);
}

function obsahujeId(u: UdalostTechnika, z: Zakazka): boolean {
  if (u.appkoo) return u.appkoo === z.idAktivity;
  const text = `${u.summary}\n${u.description}`;
  const oCisla = [...text.matchAll(/O-\d{6,}/gi)].map((m) => zakladniCisloObjednavky(m[0]));
  return oCisla.includes(z.idObjednavkyZaklad) || (!!z.idS7 && text.includes(z.idS7));
}

export function zkontroluj(zakazky: Zakazka[], udalosti: UdalostTechnika[]): { vysledky: VysledekKontroly[]; jenVKalendari: UdalostTechnika[] } {
  const zakazkoveUdalosti = udalosti.filter((u) => !jeVolneOkno(u) && !jeBlok(u));
  const sparovane = new Set<UdalostTechnika>();
  const vysledky: VysledekKontroly[] = [];

  for (const z of zakazky.filter((x) => x.termin)) {
    const kandidati = zakazkoveUdalosti.filter((u) => obsahujeId(u, z));
    // přednost má událost ve stejný den jako termín v MWF
    const u = kandidati.find((x) => isoDate(x.od) === isoDate(z.termin!.od)) ?? kandidati[0] ?? null;
    const problemy: string[] = [];
    let zavaznost: Zavaznost = "shoda";
    const rozpor = (p: string) => (problemy.push(p), (zavaznost = "rozpor"));
    const admin = (p: string) => (problemy.push(p), zavaznost === "shoda" && (zavaznost = "admin"));

    if (!u) rozpor("Termín je v MWF, v kalendáři technika chybí.");
    else {
      sparovane.add(u);
      if (z.technik && !stejnyTechnik(z.technik, u.technik)) rozpor(`Jiný technik: MWF ${z.technik}, kalendář ${u.technik}.`);
      if (isoDate(u.od) !== isoDate(z.termin!.od)) rozpor(`Jiný den: MWF ${isoDate(z.termin!.od)}, kalendář ${isoDate(u.od)}.`);
      else if (Math.abs(minutesOfDay(u.od) - minutesOfDay(z.termin!.od)) > 30) rozpor("Jiný čas začátku (rozdíl víc než 30 min).");
      const tel = (u.description.match(/TEL:([^\n]*)/i)?.[1] ?? "").replace(/\s/g, "");
      if (!tel) admin("V události chybí telefon (TEL:).");
      // jiné číslo bývá kontaktní osoba (rodina, správce) – upozornit, ne blokovat
      else if (z.telefony.length && !z.telefony.some((t) => tel.includes(t))) admin("Telefon v kalendáři se liší od MWF (jiná kontaktní osoba?).");
      if (z.adresa && podobnostAdres(z.adresa, `${u.location} ${u.summary}`) < 0.8) admin("Adresa v kalendáři se liší od MWF (shoda pod 80 %).");
    }
    vysledky.push({ zakazka: z.idAktivity, objednavka: z.idObjednavkyZaklad, udalost: u, zavaznost, problemy });
  }

  const jenVKalendari = zakazkoveUdalosti.filter((u) => !sparovane.has(u) && /O-\d{6,}|appkoo/i.test(`${u.summary} ${u.description} ${u.appkoo ?? ""}`));
  return { vysledky, jenVKalendari };
}

/** Volná okna technika v daný den z událostí „VOLNY“ – vstup pro nabídku termínů */
export function volnaOkna(udalosti: UdalostTechnika[], technik: string, den: string): Okno[] {
  return udalosti
    .filter((u) => u.technik === technik && isoDate(u.od) === den && jeVolneOkno(u) && !jeVyhrazeneVolno(u))
    .map((u) => ({ od: minutesOfDay(u.od), do: minutesOfDay(u.do) - 1 }))
    .sort((a, b) => a.od - b.od);
}
