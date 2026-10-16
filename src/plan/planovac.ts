// Plánovač pro web: nabídka termínů pro jednu zakázku a kontrola, jestli se smí plánovat.
//
// 1. Brány (zlatá pravidla koordinace): ZAK čeká na PEP, smlouva s JP (r_2), blacklist lokalit,
//    už dohodnutý termín, chybějící adresa → termín se nenabídne.
// 2. Technici z číselníku Technici (aktivní, s kalendářem, se správnou dovedností FTTH / PIV / SAT).
// 3. Kalendáře techniků na N pracovních dní: zakázky + volné sloty VOLNY (SHEET2CAL).
// 4. Trasa dne s časovými okny → nejlepší sloty podle km navíc, SLA, priority a vytížení (src/plan/sloty.ts).

import type { calendar_v3 } from "@googleapis/calendar";
import type { Polozka } from "../config/ciselniky.js";
import { nactiUdalosti } from "../gcal/kalendar.js";
import { jeBlok, jeVolneOkno, jeVyhrazeneVolno, type UdalostTechnika } from "../gcal/kontrola.js";
import type { Zakazka } from "../import/mwfExport.js";
import type { Fakta, Priorita } from "../domain/priorita.js";
import { addDays, atTime, isoDate, minutesOfDay } from "../domain/time.js";
import { isWorkday } from "../domain/workdays.js";
import { sestavDny } from "./dny.js";
import type { Vzdalenosti } from "./geo.js";
import type { Geokoder } from "./geokod.js";
import { nabidniTerminy, type DenSOkny, type Moznost, type NastaveniPlanu } from "./sloty.js";
import { doplnSlot, jeFlex, type Kandidat, type NastaveniDoplneni, type NavrhDoplneni } from "./doplneni.js";
import type { Bod } from "./geo.js";

export type Skupina = "FTTH" | "PIV" | "SAT/TV" | "ZAFUK";

export interface TechnikPlanu {
  jmeno: string;
  /** jméno na začátku událostí v kalendáři („Brestansky - FTTH …“) */
  nazevVKalendari: string;
  kalendar: string;
  vyjezd: string;
  /** 2. adresa výjezdu (volitelná) */
  vyjezd2?: string;
  email?: string;
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
        ...(p.vyjezd2 ? { vyjezd2: String(p.vyjezd2) } : {}),
        ...(p.email ? { email: String(p.email) } : {}),
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
export function kontrolaBran(z: Zakazka, f: Fakta, blokovane: Polozka[], opts: { presun?: boolean } = {}): Brany {
  const blokace: string[] = [];
  const upozorneni: string[] = [];
  if (!z.adresa) blokace.push("Zakázka nemá adresu – nelze spočítat trasu.");
  if (z.parkovaniSkupina === "ZAK") blokace.push("Zaparkováno ZAK – čeká na PEP, neplánovat.");
  if (f.posledniKodR === "r_2" && f.dalsiKontakt && f.dalsiKontakt > f.dnes) {
    blokace.push(`Smlouva s jiným poskytovatelem (r_2) – neplánovat před ${f.dalsiKontakt.split("-").reverse().join(".")}.`);
  }
  if (z.termin && !opts.presun) blokace.push("Zakázka už má dohodnutý termín – přesunout lze jen zakázku s poznámkou „flex“ (režim doplnění slotu).");
  if (z.termin && opts.presun) upozorneni.push(`Přesun: zakázka má termín ${isoDate(z.termin.od).split("-").reverse().join(".")} – po zápisu se původní událost vrátí na VOLNY; změňte termín i v MWF.`);
  if (z.predobjednavka) {
    const rfs = z.rfs ? ` (RFS ${isoDate(z.rfs).split("-").reverse().join(".")})` : "";
    upozorneni.push(`Předobjednávka${rfs} – termín lze naplánovat, realizace až po změně na standardní zakázku v MWF.`);
  }
  if (z.pocetMv >= 2) upozorneni.push(`Už ${z.pocetMv} marné výjezdy – zvážit storno / eskalaci.`);

  const adresa = norm(`${z.adresa} ${z.psc}`);
  for (const b of blokovane) {
    const lok = norm(String(b.adresa ?? ""));
    const infra = String(b.infrastruktura ?? "");
    if (lok && adresa.includes(lok) && (!infra || infra === z.infrastruktura)) {
      blokace.push(`Lokalita na blacklistu „${String(b.adresa)}“${infra ? ` (${infra})` : ""}: ${String(b.duvod ?? "")}`);
    }
  }
  return { blokace, upozorneni };
}

/** Soused v trase dne: zakázka před / po navrženém slotu, nebo výjezd / návrat na základnu */
export interface Soused {
  /** „08:00–09:59“ (u základny prázdné) */
  cas: string;
  popis: string;
  /** přejezd mezi sousedem a navrženou zakázkou (km) */
  km: number;
  zakladna?: boolean;
  /** adresa pro odkaz na trasu v mapě */
  adresa?: string;
}

export interface MoznostSlotu extends Moznost {
  /** další volné sloty stejného technika ve stejný den (jiný čas, horší skóre) */
  alternativy?: MoznostSlotu[];
  /** jak slot zapadá do trasy dne: předchozí a následující zastávka, odhad příjezdu */
  sousede?: { pred: Soused; po: Soused; prijezd: number };
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
  /** prohledané pracovní dny (YYYY-MM-DD) */
  obdobi?: { od: string; do: string };
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

/**
 * Události techniků v rozsahu dní (od–do jsou „Praha v UTC“). Kalendáře se čtou souběžně a po jednom –
 * nečitelný kalendář (nenasdílený, chybí delegace) nesmí shodit ostatní.
 */
export async function nactiKalendare(api: calendar_v3.Calendar, technici: TechnikPlanu[], od: Date, do_: Date) {
  const vysledky = await Promise.all(
    technici.map(async (t) => {
      try {
        // API chce skutečný čas (UTC); „Praha v UTC“ posuneme o 3 h – rezerva, filtruje se podle dne
        return { t, u: await nactiUdalosti(api, [{ technik: t.jmeno, kalendar: t.kalendar }], new Date(od.getTime() - 3 * 3_600_000), do_) };
      } catch {
        return { t, u: null };
      }
    }),
  );
  return {
    udalosti: vysledky.flatMap((r) => r.u ?? []),
    citelni: vysledky.filter((r) => r.u).map((r) => r.t),
    nedostupne: vysledky.filter((r) => !r.u).map((r) => r.t.jmeno),
  };
}

export async function nabidniProZakazku(
  z: Zakazka,
  priorita: Priorita,
  slaKonec: Date | null,
  technici: TechnikPlanu[],
  zav: ZavislostiPlanovace,
  now: Date,
  opts: { dni?: number; pocet?: number; trvaniMin?: number; nastaveni?: Partial<NastaveniPlanu>; adresyZMwf?: Map<string, string>; odData?: string } = {},
): Promise<Nabidka> {
  const skupina = skupinaZakazky(z.typAktivity);
  const vhodni = technici.filter((t) => t.skupiny.includes(skupina));
  const prazdna: Nabidka = { moznosti: [], nedostupne: [], bezZakladny: [], bezPolohy: 0, technikuCelkem: vhodni.length };
  if (!vhodni.length) return { ...prazdna, chyba: `V číselníku Technici není aktivní technik s dovedností ${skupina} a kalendářem.` };

  const adresa = [z.adresa, z.psc.replace(/^=+/, "")].filter(Boolean).join(", ");
  const bod = (await zav.geokoder.najdi(adresa)).bod;
  if (!bod) return { ...prazdna, chyba: `Adresu „${adresa}“ se nepodařilo najít na mapě.` };

  const dnes = isoDate(now);
  // „jiné termíny“: hledat až od zvoleného dne (zákazník nemůže dřív)
  const dny = pracovniDny(opts.odData && opts.odData > dnes ? opts.odData : dnes, opts.dni ?? 10);
  const od = atTime(dny[0]!, 0);
  const do_ = atTime(addDays(dny.at(-1)!, 1), 0);

  const { udalosti, nedostupne, citelni } = await nactiKalendare(zav.api, vhodni, od, do_);

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
    const s = await sestavDny(citelni.map((t) => ({ jmeno: t.jmeno, vyjezd: t.vyjezd, vyjezd2: t.vyjezd2 })), udalosti, d, zav.geokoder, opts.trvaniMin ?? 110, adresaZMwf);
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
    (opts.pocet ?? 5) * 10,
  );

  const podleJmena = new Map(citelni.map((t) => [t.jmeno, t]));
  const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
  const popisUdalosti = (technik: string, id: string) => {
    const u = udalosti.find((x) => x.technik === technik && (x.appkoo ?? x.id) === id);
    if (!u) return { cas: "", popis: id };
    const adresa = adresaZMwf(u) ?? u.location;
    const text = [u.summary.replace(/^[^-]+-\s*/, ""), adresa].filter(Boolean).join(" · ");
    return { cas: `${hm(minutesOfDay(u.od))}–${hm(minutesOfDay(u.do) - 1)}`, popis: text.length > 90 ? `${text.slice(0, 89)}…` : text, ...(adresa ? { adresa } : {}) };
  };
  const sousede = (m: Moznost): MoznostSlotu["sousede"] => {
    const zs = m.trasa.zastavky;
    const i = zs.findIndex((x) => x.id === z.idAktivity);
    if (i < 0) return undefined;
    const t = podleJmena.get(m.technik);
    const pred: Soused = i === 0 ? { cas: "", popis: `výjezd z ${t?.vyjezd || "základny"}`, km: zs[0]!.kmPrejezd, zakladna: true, ...(t?.vyjezd ? { adresa: t.vyjezd } : {}) } : { ...popisUdalosti(m.technik, zs[i - 1]!.id), km: zs[i]!.kmPrejezd };
    const po: Soused = i === zs.length - 1 ? { cas: "", popis: "návrat na základnu (konec dne)", km: m.trasa.kmZpet, zakladna: true, ...(t?.vyjezd ? { adresa: t.vyjezd } : {}) } : { ...popisUdalosti(m.technik, zs[i + 1]!.id), km: zs[i + 1]!.kmPrejezd };
    return { pred, po, prijezd: zs[i]!.zacatek };
  };
  // Jeden řádek = technik + den (nejlepší slot); další volné sloty téhož dne jako alternativy „jiný čas“
  const moznosti: MoznostSlotu[] = [];
  const skupiny = new Map<string, MoznostSlotu>();
  const videne = new Set<string>();
  for (const m of zakladni) {
    // technik se 2. adresou má den ve dvou variantách – stejný slot jen jednou (lepší varianta je první)
    const klic = `${m.technik}|${m.datum}|${m.okno.od}`;
    if (videne.has(klic)) continue;
    videne.add(klic);
    const t = podleJmena.get(m.technik)!;
    const slot = udalosti.find((u) => u.technik === m.technik && isoDate(u.od) === m.datum && minutesOfDay(u.od) === m.okno.od && jeVolneOkno(u));
    if (!slot) continue;
    const ms: MoznostSlotu = { ...m, kalendar: t.kalendar, nazevVKalendari: t.nazevVKalendari, eventId: slot.id, od: slot.od, do: slot.do };
    const hlavni = skupiny.get(`${m.technik}|${m.datum}`);
    if (hlavni) {
      (hlavni.alternativy ??= []).push(ms);
      continue;
    }
    if (moznosti.length >= (opts.pocet ?? 5)) continue;
    ms.sousede = sousede(m);
    skupiny.set(`${m.technik}|${m.datum}`, ms);
    moznosti.push(ms);
  }
  for (const m of moznosti) m.alternativy?.sort((a, b) => a.od.getTime() - b.od.getTime());
  return { moznosti, nedostupne, bezZakladny: [...bezZakladny], bezPolohy, technikuCelkem: vhodni.length, obdobi: { od: dny[0]!, do: dny.at(-1)! } };
}

// ---------- Režim B: vybraný slot → zakázky, které ho doplní ----------

export interface ZakazkaKDoplneni {
  z: Zakazka;
  priorita: Priorita;
  slaKonec: Date | null;
}

export interface VybranySlot {
  technik: TechnikPlanu;
  eventId: string;
  od: Date;
  do: Date;
}

export interface NavrhySlotu {
  navrhy: NavrhDoplneni[];
  /** kandidátů s dovedností technika (bez termínu + flex) */
  kandidatu: number;
  /** z toho naplánovaných s poznámkou „flex“, u kterých se našla událost v kalendáři */
  flex: number;
  /** kandidáti, jejichž adresu nejde najít na mapě */
  bezPolohy: number;
  /** zakázky ve dni technika bez dohledatelné adresy (v trase chybí) */
  bezPolohyVeDni: number;
  /** události dne technika (pro přehled) */
  den: UdalostTechnika[];
  nedostupne: string[];
  chyba?: string;
}

/** Geokódování po dávkách (cache v DB; poprvé může trvat déle) */
export async function geokodujVse(geokoder: Geokoder, adresy: string[], soubeh = 8): Promise<Map<string, Bod | null>> {
  const vysledek = new Map<string, Bod | null>();
  const fronta = [...new Set(adresy)];
  await Promise.all(
    Array.from({ length: Math.min(soubeh, fronta.length) }, async () => {
      for (let a = fronta.shift(); a !== undefined; a = fronta.shift()) {
        try {
          vysledek.set(a, (await geokoder.najdi(a)).bod);
        } catch {
          vysledek.set(a, null);
        }
      }
    }),
  );
  return vysledek;
}

const adresaZakazky = (z: Zakazka) => [z.adresa, z.psc.replace(/^=+/, "")].filter(Boolean).join(", ");
const oCislo = (u: UdalostTechnika) => `${u.summary} ${u.appkoo ?? ""}`.match(/O-\d{6,}/)?.[0];

/**
 * Režim B (zadání fáze 1): koordinátorka vybere volný slot technika a aplikace nabídne zakázky,
 * které ho nejlépe doplní – otevřené bez termínu a naplánované s pozitivní poznámkou „flex“
 * (přesun dopředu; po zápisu se jejich původní událost vrátí na VOLNY).
 */
export async function navrhyProSlot(
  slot: VybranySlot,
  zakazky: ZakazkaKDoplneni[],
  technici: TechnikPlanu[],
  zav: ZavislostiPlanovace,
  opts: { adresyZMwf?: Map<string, string>; pocet?: number; nastaveni?: Partial<NastaveniDoplneni>; flexDni?: number } = {},
): Promise<NavrhySlotu> {
  const t = slot.technik;
  const datum = isoDate(slot.od);
  const prazdne: NavrhySlotu = { navrhy: [], kandidatu: 0, flex: 0, bezPolohy: 0, bezPolohyVeDni: 0, den: [], nedostupne: [] };

  const denKal = await nactiKalendare(zav.api, [t], atTime(datum, 0), atTime(addDays(datum, 1), 0));
  if (denKal.nedostupne.length) return { ...prazdne, nedostupne: denKal.nedostupne, chyba: `Kalendář technika ${t.jmeno} nejde přečíst.` };
  const den = denKal.udalosti.filter((u) => isoDate(u.od) === datum).sort((a, b) => a.od.getTime() - b.od.getTime());
  const vybrany = den.find((u) => u.id === slot.eventId);
  if (!vybrany || !jeVolneOkno(vybrany) || jeVyhrazeneVolno(vybrany) || vybrany.od.getTime() !== slot.od.getTime()) {
    return { ...prazdne, den, chyba: "Slot už není volný nebo se změnil jeho čas – vyberte slot znovu." };
  }

  const adresaZMwf = (u: UdalostTechnika) => {
    const o = oCislo(u);
    return o ? opts.adresyZMwf?.get(o) : undefined;
  };
  const s = await sestavDny([{ jmeno: t.jmeno, vyjezd: t.vyjezd, vyjezd2: t.vyjezd2 }], den, datum, zav.geokoder, opts.nastaveni?.trvaniMin ?? 110, adresaZMwf);
  if (!s.dny.length) return { ...prazdne, den, chyba: `Technik ${t.jmeno} nemá v číselníku adresu výjezdu (nebo ji nejde najít na mapě).` };

  // Kandidáti se správnou dovedností; naplánované jen s termínem po slotu (přesun dopředu)
  const vhodne = zakazky.filter((k) => t.skupiny.includes(skupinaZakazky(k.z.typAktivity)) && (!k.z.termin || k.z.termin.od > slot.od));
  const bezTerminu = vhodne.filter((k) => !k.z.termin);
  const sTerminem = vhodne.filter((k) => k.z.termin);

  // Flex: událost zakázky v kalendářích techniků (do flexDni dní dopředu) + „flex“ v poznámce MWF nebo v události
  const flexKandidati: { k: ZakazkaKDoplneni; presun: NonNullable<Kandidat["presun"]> }[] = [];
  let nedostupne: string[] = [];
  if (sTerminem.length) {
    const doData = addDays(datum, opts.flexDni ?? 21);
    const kal = await nactiKalendare(zav.api, technici, atTime(datum, 0), atTime(doData, 0));
    nedostupne = kal.nedostupne;
    const podleO = new Map<string, UdalostTechnika>();
    for (const u of kal.udalosti) {
      if (jeVolneOkno(u) || jeBlok(u)) continue;
      const o = oCislo(u);
      if (o) podleO.set(o, u);
    }
    for (const k of sTerminem) {
      const u = podleO.get(k.z.idObjednavkyZaklad);
      if (!u || u.od <= slot.od) continue;
      if (!jeFlex(k.z.poznamka) && !jeFlex(`${u.summary} ${u.description}`)) continue;
      const tu = technici.find((x) => x.jmeno === u.technik);
      if (!tu) continue;
      flexKandidati.push({ k, presun: { kalendar: u.kalendar, eventId: u.id, technik: tu.jmeno, od: u.od } });
    }
  }

  const vsichni = [...bezTerminu.map((k) => ({ k, presun: undefined })), ...flexKandidati];
  const body = await geokodujVse(zav.geokoder, vsichni.map((x) => adresaZakazky(x.k.z)).filter(Boolean));
  const kandidati: Kandidat[] = [];
  let bezPolohy = 0;
  for (const { k, presun } of vsichni) {
    const bod = body.get(adresaZakazky(k.z));
    if (!bod) {
      bezPolohy++;
      continue;
    }
    kandidati.push({ z: k.z, priorita: k.priorita, slaKonec: k.slaKonec, bod, ...(presun ? { presun } : {}) });
  }

  const okno = { od: minutesOfDay(slot.od), do: minutesOfDay(slot.do) - 1 };
  // varianty dne (primární / 2. adresa výjezdu): u každé zakázky platí výhodnější varianta
  const nejlepsi = new Map<string, NavrhDoplneni>();
  for (const d of s.dny) {
    for (const n of doplnSlot(d, okno, kandidati, zav.vzdalenosti, opts.nastaveni, kandidati.length)) {
      const id = n.kandidat.z.idAktivity;
      const dosud = nejlepsi.get(id);
      if (!dosud || n.skore < dosud.skore) nejlepsi.set(id, n);
    }
  }
  const navrhy = [...nejlepsi.values()].sort((a, b) => a.skore - b.skore).slice(0, opts.pocet ?? 10);
  return {
    navrhy,
    kandidatu: vsichni.length,
    flex: flexKandidati.length,
    bezPolohy,
    bezPolohyVeDni: s.bezPolohy.length,
    den,
    nedostupne,
  };
}

/** Přehled dne pro režim B: technici seřazení od nejméně vytížených, jejich zakázky a volné sloty */
export interface DenPrehledu {
  technik: TechnikPlanu;
  zakazky: UdalostTechnika[];
  volne: UdalostTechnika[];
  /** VOLNY sz – zkrácený slot (změna smlouvy FTTH / servis PIV), nenabízí se */
  vyhrazene: UdalostTechnika[];
}

export async function prehledDne(api: calendar_v3.Calendar, technici: TechnikPlanu[], datum: string) {
  const kal = await nactiKalendare(api, technici, atTime(datum, 0), atTime(addDays(datum, 1), 0));
  const dny: DenPrehledu[] = kal.citelni.map((t) => {
    const jeho = kal.udalosti.filter((u) => u.technik === t.jmeno && isoDate(u.od) === datum).sort((a, b) => a.od.getTime() - b.od.getTime());
    return { technik: t, zakazky: jeho.filter((u) => !jeVolneOkno(u) && !jeBlok(u)), volne: jeho.filter((u) => jeVolneOkno(u) && !jeVyhrazeneVolno(u)), vyhrazene: jeho.filter((u) => jeVyhrazeneVolno(u)) };
  });
  dny.sort((a, b) => Number(!a.volne.length) - Number(!b.volne.length) || a.zakazky.length - b.zakazky.length || a.technik.jmeno.localeCompare(b.technik.jmeno, "cs"));
  return { dny, nedostupne: kal.nedostupne };
}

/** Text termínu do MWF: „Zákazník: Novák, Jan (05.05.2026, 10:00 - 11:59)“ */
export function textProMwf(zakaznik: string, od: Date, do_: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const konec = new Date(do_.getTime() - 60_000);
  const datum = isoDate(od).split("-").reverse().join(".");
  return `Zákazník: ${zakaznik} (${datum}, ${hm(od)} - ${hm(konec)})`;
}
