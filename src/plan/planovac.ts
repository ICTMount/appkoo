// Plánovač pro web: nabídka termínů pro jednu zakázku a kontrola, jestli se smí plánovat.
//
// 1. Brány (zlatá pravidla koordinace): ZAK čeká na PEP, smlouva s JP (r_2), blokovaná lokalita,
//    už dohodnutý termín, chybějící adresa → termín se nenabídne.
// 2. Technici z číselníku Technici (aktivní, s kalendářem, se správnou dovedností FTTH / PIV / SAT).
// 3. Kalendáře techniků na N pracovních dní: zakázky + volné sloty VOLNY (SHEET2CAL).
// 4. Trasa dne s časovými okny → nejlepší sloty podle km navíc, SLA, priority a vytížení (src/plan/sloty.ts).

import type { calendar_v3 } from "@googleapis/calendar";
import type { Polozka } from "../config/ciselniky.js";
import { nactiUdalosti } from "../gcal/kalendar.js";
import { jeVolneOkno, type UdalostTechnika } from "../gcal/kontrola.js";
import type { Zakazka } from "../import/mwfExport.js";
import type { Fakta, Priorita } from "../domain/priorita.js";
import { addDays, atTime, isoDate, minutesOfDay } from "../domain/time.js";
import { isWorkday } from "../domain/workdays.js";
import { sestavDny } from "./dny.js";
import type { Vzdalenosti } from "./geo.js";
import type { Geokoder } from "./geokod.js";
import { nabidniTerminy, type DenSOkny, type Moznost, type NastaveniPlanu } from "./sloty.js";

export type Skupina = "FTTH" | "PIV" | "SAT/TV" | "ZAFUK";

export interface TechnikPlanu {
  jmeno: string;
  /** jméno na začátku událostí v kalendáři („Brestansky - FTTH …“) */
  nazevVKalendari: string;
  kalendar: string;
  vyjezd: string;
  skupiny: Skupina[];
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export function skupinaZakazky(typAktivity: string): Skupina {
  if (/PIV/i.test(typAktivity)) return "PIV";
  if (/SAT|TV_/i.test(typAktivity)) return "SAT/TV";
  return "FTTH";
}

/** Technici z číselníku; dovednosti jsou ve sloupci „Typy akcí“ (FTTH, PIV, SAT/TV, ZAFUK), prázdné = FTTH */
export function techniciZCiselniku(polozky: Polozka[]): TechnikPlanu[] {
  return polozky
    .filter((p) => p.aktivni !== false && typeof p.kalendar === "string" && p.kalendar && typeof p.jmeno === "string")
    .map((p) => {
      const skupiny = (Array.isArray(p.typyAkci) ? p.typyAkci : []).map((s) => String(s).toUpperCase()) as Skupina[];
      return {
        jmeno: String(p.jmeno),
        nazevVKalendari: String(p.nazevVKalendari || p.jmeno),
        kalendar: String(p.kalendar),
        vyjezd: String(p.vyjezd ?? ""),
        skupiny: skupiny.length ? skupiny : ["FTTH"],
      };
    });
}

export interface Brany {
  /** důvody, proč termín nabídnout nelze */
  blokace: string[];
  /** co musí koordinátorka ověřit (zobrazí se u zápisu) */
  upozorneni: string[];
}

/** Zlatá pravidla koordinace (SKILLS v5) – kdy se termín plánovat nesmí */
export function kontrolaBran(z: Zakazka, f: Fakta, blokovane: Polozka[]): Brany {
  const blokace: string[] = [];
  const upozorneni: string[] = [];
  if (!z.adresa) blokace.push("Zakázka nemá adresu – nelze spočítat trasu.");
  if (z.parkovaniSkupina === "ZAK") blokace.push("Zaparkováno ZAK – čeká na PEP, neplánovat.");
  if (f.posledniKodR === "r_2" && f.dalsiKontakt && f.dalsiKontakt > f.dnes) {
    blokace.push(`Smlouva s jiným poskytovatelem (r_2) – neplánovat před ${f.dalsiKontakt.split("-").reverse().join(".")}.`);
  }
  if (z.termin) blokace.push("Zakázka už má dohodnutý termín – přeplánování zatím ručně v kalendáři a MWF.");
  if (z.predobjednavka && z.rfs && isoDate(z.rfs) > f.dnes) upozorneni.push(`Předobjednávka – RFS ${isoDate(z.rfs).split("-").reverse().join(".")}; termín až po RFS.`);
  if (z.pocetMv >= 2) upozorneni.push(`Už ${z.pocetMv} marné výjezdy – zvážit storno / eskalaci.`);

  const adresa = norm(`${z.adresa} ${z.psc}`);
  for (const b of blokovane) {
    const lok = norm(String(b.adresa ?? ""));
    const infra = String(b.infrastruktura ?? "");
    if (lok && adresa.includes(lok) && (!infra || infra === z.infrastruktura)) {
      blokace.push(`Blokovaná lokalita „${String(b.adresa)}“${infra ? ` (${infra})` : ""}: ${String(b.duvod ?? "")}`);
    }
  }
  return { blokace, upozorneni };
}

export interface MoznostSlotu extends Moznost {
  kalendar: string;
  nazevVKalendari: string;
  /** událost VOLNY, která se přepíše na zakázku */
  eventId: string;
  /** začátek a konec slotu („Praha v UTC“) */
  od: Date;
  do: Date;
}

export interface Nabidka {
  moznosti: MoznostSlotu[];
  /** technici, jejichž kalendář nejde přečíst (nenasdílený servisnímu účtu) */
  nedostupne: string[];
  bezZakladny: string[];
  /** zakázky v kalendářích, u kterých nejde zjistit poloha (v trase chybí) */
  bezPolohy: number;
  technikuCelkem: number;
  chyba?: string;
}

export interface ZavislostiPlanovace {
  api: calendar_v3.Calendar;
  geokoder: Geokoder;
  vzdalenosti: Vzdalenosti;
}

/** Pracovní dny od dneška (včetně) – `pocet` dní */
export function pracovniDny(dnes: string, pocet: number): string[] {
  const dny: string[] = [];
  for (let d = dnes; dny.length < pocet; d = addDays(d, 1)) if (isWorkday(d)) dny.push(d);
  return dny;
}

export async function nabidniProZakazku(
  z: Zakazka,
  priorita: Priorita,
  slaKonec: Date | null,
  technici: TechnikPlanu[],
  zav: ZavislostiPlanovace,
  now: Date,
  opts: { dni?: number; pocet?: number; trvaniMin?: number; nastaveni?: Partial<NastaveniPlanu>; adresyZMwf?: Map<string, string> } = {},
): Promise<Nabidka> {
  const skupina = skupinaZakazky(z.typAktivity);
  const vhodni = technici.filter((t) => t.skupiny.includes(skupina));
  const prazdna: Nabidka = { moznosti: [], nedostupne: [], bezZakladny: [], bezPolohy: 0, technikuCelkem: vhodni.length };
  if (!vhodni.length) return { ...prazdna, chyba: `V číselníku Technici není aktivní technik s dovedností ${skupina} a kalendářem.` };

  const adresa = [z.adresa, z.psc.replace(/^=+/, "")].filter(Boolean).join(", ");
  const bod = (await zav.geokoder.najdi(adresa)).bod;
  if (!bod) return { ...prazdna, chyba: `Adresu „${adresa}“ se nepodařilo najít na mapě.` };

  const dnes = isoDate(now);
  const dny = pracovniDny(dnes, opts.dni ?? 10);
  const od = atTime(dny[0]!, 0);
  const do_ = atTime(addDays(dny.at(-1)!, 1), 0);

  // Kalendáře po jednom – nenasdílený kalendář nesmí shodit celou nabídku
  const udalosti: UdalostTechnika[] = [];
  const nedostupne: string[] = [];
  const citelni: TechnikPlanu[] = [];
  for (const t of vhodni) {
    try {
      // API chce skutečný čas (UTC); „Praha v UTC“ posuneme o 2 h – rezerva stačí, filtruje se podle dne
      udalosti.push(...(await nactiUdalosti(zav.api, [{ technik: t.jmeno, kalendar: t.kalendar }], new Date(od.getTime() - 3 * 3_600_000), new Date(do_.getTime()))));
      citelni.push(t);
    } catch {
      nedostupne.push(t.jmeno);
    }
  }

  // Volné sloty, které už začaly nebo začnou do hodiny, se nenabízejí
  const nejdrive = minutesOfDay(now) + 60;
  const adresaZMwf = (u: UdalostTechnika) => {
    const o = `${u.summary} ${u.appkoo ?? ""}`.match(/O-\d{6,}/)?.[0];
    return o ? opts.adresyZMwf?.get(o) : undefined;
  };

  const vsechnyDny: DenSOkny[] = [];
  const bezZakladny = new Set<string>();
  let bezPolohy = 0;
  for (const d of dny) {
    const s = await sestavDny(citelni.map((t) => ({ jmeno: t.jmeno, vyjezd: t.vyjezd })), udalosti, d, zav.geokoder, opts.trvaniMin ?? 110, adresaZMwf);
    s.bezZakladny.forEach((x) => bezZakladny.add(x));
    bezPolohy += s.bezPolohy.length;
    for (const den of s.dny) {
      if (d === dnes) den.volnaOkna = den.volnaOkna.filter((o) => o.od >= nejdrive);
      if (den.volnaOkna.length) vsechnyDny.push(den);
    }
  }

  const zakladni = nabidniTerminy(
    { id: z.idAktivity, bod, trvani: opts.trvaniMin ?? 110, priorita, slaKonec },
    vsechnyDny,
    zav.vzdalenosti,
    dnes,
    opts.nastaveni,
    opts.pocet ?? 5,
  );

  const podleJmena = new Map(citelni.map((t) => [t.jmeno, t]));
  const moznosti: MoznostSlotu[] = [];
  for (const m of zakladni) {
    const t = podleJmena.get(m.technik)!;
    const slot = udalosti.find((u) => u.technik === m.technik && isoDate(u.od) === m.datum && minutesOfDay(u.od) === m.okno.od && jeVolneOkno(u));
    if (!slot) continue;
    moznosti.push({ ...m, kalendar: t.kalendar, nazevVKalendari: t.nazevVKalendari, eventId: slot.id, od: slot.od, do: slot.do });
  }
  return { moznosti, nedostupne, bezZakladny: [...bezZakladny], bezPolohy, technikuCelkem: vhodni.length };
}

/** Text termínu do MWF: „Zákazník: Novák, Jan (05.05.2026, 10:00 - 11:59)“ */
export function textProMwf(zakaznik: string, od: Date, do_: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const konec = new Date(do_.getTime() - 60_000);
  const datum = isoDate(od).split("-").reverse().join(".");
  return `Zákazník: ${zakaznik} (${datum}, ${hm(od)} - ${hm(konec)})`;
}
