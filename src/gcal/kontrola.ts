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

/** Vytížení dne technika pro jednoduchý „bar“: sloty v pořadí podle času a podíl obsazených */
export interface DilekDne {
  id: string;
  od: Date;
  do: Date;
  stav: "volno" | "obsazeno" | "blok" | "vyhrazeno";
}
export interface VytizeniDne {
  dilky: DilekDne[];
  volnych: number;
  obsazenych: number;
  /** obsazené / (obsazené + volné) v %, null = den bez slotů */
  procento: number | null;
}

export function vytizeniDne(udalosti: UdalostTechnika[], technik: string, den: string): VytizeniDne {
  const dilky: DilekDne[] = udalosti
    .filter((u) => u.technik === technik && isoDate(u.od) === den && u.do.getTime() > u.od.getTime())
    .sort((a, b) => a.od.getTime() - b.od.getTime())
    .map((u) => ({
      id: u.id,
      od: u.od,
      do: u.do,
      stav: jeVyhrazeneVolno(u) ? "vyhrazeno" : jeVolneOkno(u) ? "volno" : jeBlok(u) ? "blok" : "obsazeno",
    }));
  const volnych = dilky.filter((d) => d.stav === "volno").length;
  const obsazenych = dilky.filter((d) => d.stav === "obsazeno").length;
  const celkem = volnych + obsazenych;
  return { dilky, volnych, obsazenych, procento: celkem ? Math.round((obsazenych / celkem) * 100) : null };
}

// ---------- Kontrolka u události v Kalendáři techniků: MWF export ↔ kalendář ----------
// zelená = sedí; oranžová = drobný nesoulad (začátek o 31–60 min, adresa sedí jen na 75 %); červená = jiný den, začátek o víc než
// 60 min, adresa nesedí, zakázka chybí v jednom ze systémů nebo Pracovní zdroj v MWF není technik kalendáře.
// Porovnává se jen ZAČÁTEK termínu. Uzavřené zakázky a události bez čísla zakázky kontrolku nemají.

export type StavKontrolky = "ok" | "pozor" | "chyba";
export interface Kontrolka {
  stav: StavKontrolky;
  duvody: string[];
}
export interface UdalostKontroly {
  kalendar: string;
  id: string;
  summary: string;
  description: string;
  location: string;
  od: Date;
  appkoo?: string;
  barva?: string;
  /** jména technika kalendáře (číselník i jméno v kalendáři) – MWF musí odpovídat aspoň jednomu */
  technik: string[];
}
export type ZakazkaKontroly = Pick<Zakazka, "idAktivity" | "idObjednavkyZaklad" | "idS7" | "technik" | "termin" | "adresa"> & { uzavreno: boolean };
export interface ChybiVKalendari {
  idAktivity: string;
  oid: string;
  termin: Date;
  technik: string;
}

const hhmm = (t: Date) => `${t.getUTCHours()}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
const dm = (t: Date) => `${t.getUTCDate()}.${t.getUTCMonth() + 1}.`;

/** Čísla O- (základ) v názvu a popisu události */
export const oCislaUdalosti = (u: Pick<UdalostKontroly, "summary" | "description">): string[] =>
  [...new Set([...`${u.summary}\n${u.description}`.matchAll(/O-\d{6,}/gi)].map((m) => zakladniCisloObjednavky(m[0])))];

/**
 * Shoda adresy MWF ↔ kalendář pro kontrolku (0–1): ulice 50 %, číslo popisné 25 %, číslo orientační 25 %
 * (adresa bez orientačního čísla: popisné 50 %). Obec se neporovnává – kalendář ji často nemá.
 * 100 % = zelená, 75 % (např. chybí orientační číslo) = oranžová, méně = červená.
 */
export function shodaAdres(mwf: string, kalendar: string): number {
  const a = norm(mwf).replace(/\b\d{3}\s?\d{2}\b/g, " "); // bez PSČ
  const b = norm(kalendar);
  const obce = new Set(["praha", "brno", "ostrava", "plzen"]);
  const ulice = (a.match(/\p{L}{4,}/gu) ?? []).filter((w) => !obce.has(w));
  const uliceSedi = !ulice.length || ulice.some((w) => b.includes(w));
  const m = /(\d+)\s*\/\s*(\d+\w?)/.exec(a);
  const cislo = (c: string) => new RegExp(`(^|[^\\d])${c}($|[^\\d])`).test(b);
  const popisne = m ? m[1]! : (a.match(/\d+\w?/g) ?? []).at(-1) ?? "";
  const orientacni = m ? m[2]! : "";
  if (!popisne) return uliceSedi ? 1 : 0;
  const cisla = orientacni ? (cislo(popisne) ? 0.25 : 0) + (cislo(orientacni) ? 0.25 : 0) : cislo(popisne) ? 0.5 : 0;
  return (uliceSedi ? 0.5 : 0) + cisla;
}

export function kontrolkyUdalosti(
  zakazky: ZakazkaKontroly[],
  udalosti: UdalostKontroly[],
  obdobi: { od: Date; do: Date },
): { kontrolky: Map<string, Kontrolka>; chybi: ChybiVKalendari[] } {
  const kontrolky = new Map<string, Kontrolka>();
  const sparovane = new Set<string>();
  for (const u of udalosti) {
    if (jeVolneOkno(u) || jeBlok(u)) continue;
    const text = `${u.summary}\n${u.description}`;
    const oCisla = oCislaUdalosti(u);
    const s7 = (z: ZakazkaKontroly) => { const id = z.idS7.replace(/^=+/, "").trim(); return id.length >= 6 && text.includes(id); };
    const kandidati = zakazky.filter((z) => (u.appkoo ? z.idAktivity === u.appkoo : false) || oCisla.includes(z.idObjednavkyZaklad) || s7(z));
    if (!kandidati.length) {
      // bez čísla zakázky to není zakázka (soukromá poznámka, školení…) – kontrolka se neukazuje
      if (oCisla.length || u.appkoo) kontrolky.set(`${u.kalendar}|${u.id}`, { stav: "chyba", duvody: ["Zakázka z kalendáře není v exportu MWF."] });
      continue;
    }
    const otevrene = kandidati.filter((z) => !z.uzavreno);
    for (const z of otevrene) sparovane.add(z.idAktivity);
    if (!otevrene.length) continue; // uzavřená zakázka – bez kontrolky
    const den = isoDate(u.od);
    const z = otevrene.find((x) => x.termin && isoDate(x.termin.od) === den) ?? otevrene.find((x) => x.termin) ?? otevrene[0]!;
    const duvody: string[] = [];
    let stav: StavKontrolky = "ok";
    const chyba = (d: string) => (duvody.push(d), (stav = "chyba"));
    const pozor = (d: string) => (duvody.push(d), stav === "ok" && (stav = "pozor"));
    if (!z.termin) chyba("V MWF není u zakázky termín.");
    else if (isoDate(z.termin.od) !== den) chyba(`Jiný den: MWF ${dm(z.termin.od)} ${hhmm(z.termin.od)}, kalendář ${dm(u.od)} ${hhmm(u.od)}.`);
    else {
      const rozdil = Math.abs(minutesOfDay(u.od) - minutesOfDay(z.termin.od));
      if (rozdil > 60) chyba(`Začátek se liší o ${rozdil} min: MWF ${hhmm(z.termin.od)}, kalendář ${hhmm(u.od)}.`);
      else if (rozdil > 30) pozor(`Začátek se liší o ${rozdil} min: MWF ${hhmm(z.termin.od)}, kalendář ${hhmm(u.od)}.`);
    }
    if (!z.technik.trim()) chyba("V MWF není Pracovní zdroj.");
    else if (!u.technik.some((t) => stejnyTechnik(z.technik, t))) chyba(`Pracovní zdroj v MWF: ${z.technik}, kalendář: ${u.technik[0] ?? "?"}.`);
    if (z.adresa) {
      const shoda = shodaAdres(z.adresa, `${u.location} ${u.summary}`);
      if (shoda < 0.75) chyba(`Adresa nesedí (shoda ${Math.round(shoda * 100)} %): MWF ${z.adresa}.`);
      else if (shoda < 1) pozor(`Adresa sedí jen na ${Math.round(shoda * 100)} %: MWF ${z.adresa}.`);
    }
    kontrolky.set(`${u.kalendar}|${u.id}`, { stav, duvody });
  }
  // termín v MWF v zobrazeném období, u zobrazeného technika, a v jeho kalendáři zakázka není
  const jmena = [...new Set(udalosti.flatMap((u) => u.technik))];
  const chybi = zakazky
    .filter((z) => !z.uzavreno && z.termin && z.termin.od >= obdobi.od && z.termin.od < obdobi.do && !sparovane.has(z.idAktivity))
    .filter((z) => jmena.some((t) => stejnyTechnik(z.technik, t)))
    .map((z) => ({ idAktivity: z.idAktivity, oid: z.idObjednavkyZaklad || z.idAktivity, termin: z.termin!.od, technik: z.technik }))
    .sort((a, b) => a.termin.getTime() - b.termin.getTime());
  return { kontrolky, chybi };
}
