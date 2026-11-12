// Mřížka kalendáře – zrcadlo Google Kalendáře techniků (etapa 1: jen pro čtení).
// Den = sloupec na technika, týden = 7 dní a v každém zaškrtnutí technici vedle sebe. Časy, názvy i barvy bloků
// jsou přesně podle zdrojového kalendáře (žádné vlastní šablony slotů); celodenní události se nezobrazují.
// Bez JavaScriptu: výběr techniků je formulář GET, detail události se ukazuje přes CSS :hover / :focus-within.

import { addDays, fromIso, isoDate, type IsoDate } from "../domain/time.js";
import { jeVolneOkno } from "../gcal/kontrola.js";
import { zHtml } from "../gcal/kalendar.js";
import type { UdalostMrizky } from "../zdroje/sync.js";
import type { Bod } from "../plan/geo.js";
import { CSS_NAV, navDne, rychleDny } from "./navigace.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Barvy událostí Google Kalendáře podle colorId */
export const BARVY_UDALOSTI: Record<string, string> = {
  "1": "#7986cb", "2": "#33b679", "3": "#8e24aa", "4": "#e67c73", "5": "#f6bf26", "6": "#f4511e",
  "7": "#039be5", "8": "#616161", "9": "#3f51b5", "10": "#0b8043", "11": "#d50000",
};
const VYCHOZI_BARVA = "#1967d2";

/** Barva bloku: barva události, jinak barva kalendáře technika */
export const barvaUdalosti = (u: Pick<UdalostMrizky, "barvaId" | "kalendarBarva">): string =>
  (u.barvaId && BARVY_UDALOSTI[u.barvaId]) || (u.kalendarBarva && /^#[0-9a-f]{6}$/i.test(u.kalendarBarva) ? u.kalendarBarva : VYCHOZI_BARVA);

/** Tmavý nebo bílý text podle světlosti pozadí (jako Google Kalendář) */
export function barvaTextu(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? "#1f1f1f" : "#fff";
}

export interface TechnikMrizky {
  jmeno: string;
  nazevVKalendari: string;
  kalendar: string;
  /** odkud technik vyjíždí (adresa z číselníku Technici) */
  vyjezd?: string;
  /** první adresa výjezdu – od ní se počítají přejezdy */
  vyjezdAdresa?: string;
}

/** Adresa události rozdělená na ulici a městskou část / obec („Bellušova 1827/53“ + „Praha 13 Stodůlky“) – část se v mřížce zvýrazňuje */
export function castAdresy(location: string): { ulice: string; cast: string } {
  const casti = location.split(",").map((s) => s.trim()).filter(Boolean);
  if (casti.length > 1 && /^(česko|czechia|česká republika|cz)$/i.test(casti.at(-1)!)) casti.pop();
  if (casti.length < 2) return { ulice: casti[0] ?? "", cast: "" };
  const cast = casti.pop()!.replace(/^\d{3}\s?\d{2}\s+/, "");
  return { ulice: casti.join(", "), cast };
}

export interface VolbyMrizky {
  pohled: "den" | "tyden";
  /** den (denní pohled) nebo kterýkoli den týdne */
  den: IsoDate;
  /** jména vybraných techniků; prázdné = všichni */
  vybrani: string[];
  jenVolny: boolean;
  /** zakázka, pro kterou se hledá termín (kontext stránky) */
  zakazka?: ZakazkaMrizky | null;
  /** vyznačit nejoptimálnější VOLNY sloty (našeptávač) */
  navrh?: boolean;
}

/** Zakázka v horním pruhu kalendáře – vše důležité pro hovor se zákazníkem */
export interface ZakazkaMrizky {
  idAktivity: string;
  oid: string;
  adresa: string;
  zakaznik?: string;
  telefon?: string;
  typ?: string;
  /** vlastník sítě (TMCZ / CETIN / VDF) */
  infra?: string;
  /** konec SLA („Praha v UTC“) */
  sla?: Date | null;
  /** FTTH + IPTV, PŘED RFS, ZÁSUVKA USED, PŘEDOBJEDNÁVKA… (druh určuje barvu – stejnou jako v detailu zakázky) */
  stitky?: (string | { text: string; druh: "kombi" | "predobj" | "pred-rfs" | "used" | "webcal" })[];
  /** zlatá pravidla, která plánování blokují */
  blokace?: string[];
  upozorneni?: string[];
  /** současný termín zakázky (přeplánování) */
  termin?: string;
  /** dohodnutý termín je jen v MWF, v kalendáři technika chybí (webcalendar) */
  terminChybi?: boolean;
}

/** Označení bloků: doporučené sloty našeptávače a současná událost plánované zakázky */
export interface OznaceniMrizky {
  /** klíč „kalendář|eventId“ */
  navrhy?: Map<string, { poradi: number; duvod: string }>;
  tato?: { kalendar: string; eventId: string } | null;
  /** dohodnutý termín zakázky, který v kalendáři chybí (webcalendar) – VOLNY sloty, které se s ním kryjí, se označí */
  dohodnuty?: { od: Date; do: Date } | null;
  /** přejezdy: polohy adres (klíč = adresa události / výjezdu, oříznutá), výpočet km a poloha plánované zakázky */
  prejezdy?: { polohy: Map<string, Bod | null>; km: (a: Bod, b: Bod) => number; minuty?: (a: Bod, b: Bod) => number; cil?: Bod | null };
}

const hm = (t: Date) => `${t.getUTCHours()}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
const hodina = (t: Date) => t.getUTCHours() + t.getUTCMinutes() / 60;
const DNY_KR = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const DNY = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
const MESICE = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const denKratce = (d: IsoDate) => { const t = fromIso(d); return `${DNY_KR[t.getUTCDay()]} ${t.getUTCDate()}.${t.getUTCMonth() + 1}.`; };
const denDlouze = (d: IsoDate) => { const t = fromIso(d); return `${DNY[t.getUTCDay()]} ${t.getUTCDate()}. ${MESICE[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };

/** Pondělí týdne, do kterého den patří */
export function pondeli(d: IsoDate): IsoDate {
  const wd = fromIso(d).getUTCDay();
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

/** Interval, který je potřeba načíst z databáze */
export function rozsahMrizky(v: Pick<VolbyMrizky, "pohled" | "den">): { od: Date; do: Date; dny: IsoDate[] } {
  const prvni = v.pohled === "den" ? v.den : pondeli(v.den);
  const dny = Array.from({ length: v.pohled === "den" ? 1 : 7 }, (_, i) => addDays(prvni, i));
  return { od: fromIso(prvni), do: fromIso(addDays(prvni, dny.length)), dny };
}

export interface BlokMrizky {
  top: number;
  vyska: number;
  volny: boolean;
  bg: string;
  fg: string;
  /** text v bloku (v hustém režimu zkrácený) */
  nazev: string;
  cas: string;
  /** ulice a číslo (v hustém režimu prázdné) */
  ulice: string;
  /** městská část / obec – zvýrazněná */
  cast: string;
  /** celá adresa do detailu */
  adresa: string;
  /** detail po najetí myší */
  plnyNazev: string;
  detail: string[];
  odkaz: string | null;
  /** číslo objednávky v názvu události */
  oid: string | null;
  /** detail se otevírá vlevo / kotví dole (aby nevyjel z obrazovky) */
  vlevo: boolean;
  dole: boolean;
  /** identifikace slotu pro zápis: kalendář, událost, technik (jméno z číselníku), časy „Praha v UTC“ */
  kalendar: string;
  id: string;
  technik: string;
  odIso: string;
  doIso: string;
  /** doporučený slot našeptávače */
  navrh?: { poradi: number; duvod: string };
  /** současná událost plánované zakázky */
  tato?: boolean;
  /** VOLNY slot, který se kryje s dohodnutým termínem zákazníka (webcalendar) */
  dohod?: boolean;
  /** přejezd na tuto adresu z předchozí zastávky dne (nebo z výjezdu technika), km */
  prejezd?: { km: number; zVyjezdu: boolean; min?: number };
  /** VOLNY + plánovaná zakázka: přejezd z předchozí zastávky na adresu zakázky a z ní na další zastávku (nebo zpět na výjezd), km */
  vlozeni?: { pred: number; po: number; predVyjezd: boolean; poVyjezd: boolean };
}

export interface SloupecMrizky {
  nadpis: string;
  /** krátký tvar dne („Út 10.11.“) – jen značí sloupec dne v týdenním pohledu; v záhlaví je vždy celý název, úzký sloupec ho ořízne */
  kratky?: string;
  /** týden: den sloupce (kotva „den-RRRR-MM-DD“ pro odrolování na vybraný den) */
  datum?: IsoDate;
  pod: { stitek: string; napoveda: string; bloky: BlokMrizky[] }[];
}

export interface Mrizka {
  sloupce: SloupecMrizky[];
  /** hodiny na ose (první .. poslední začátek hodiny) */
  hodiny: number[];
  podsloupcu: number;
  husta: boolean;
}

/** Řádky popisu události do detailu: vše nad „INSTALAČNÍ PŘEDPIS“, bez prázdných, nejvýš 10 */
export function radkyDetailu(popis: string): string[] {
  const text = zHtml(popis).split(/INSTALAČNÍ PŘEDPIS/i)[0]!;
  return text.split(/\r?\n/).map((r) => r.trim()).filter((r) => r && !/^\[SHEET2CAL\]/.test(r)).slice(0, 10);
}

/**
 * Přejezdy v jednom dni technika: u každé zakázky km z předchozí zastávky (první z výjezdu), u VOLNY slotu
 * km „předchozí zastávka → plánovaná zakázka → další zastávka“. Zastávka = událost s adresou, kterou známe na mapě.
 */
function prejezdyDne(bloky: BlokMrizky[], t: TechnikMrizky, pr: OznaceniMrizky["prejezdy"]): BlokMrizky[] {
  if (!pr) return bloky;
  const bod = (a: string | undefined) => (a ? pr.polohy.get(a.trim()) ?? null : null);
  const vyjezd = bod(t.vyjezdAdresa);
  const serazene = [...bloky].sort((a, b) => a.odIso.localeCompare(b.odIso));
  const zastavky = serazene.map((b) => (!b.volny ? bod(b.adresa) : null));
  let minula = vyjezd;
  let minulaVyjezd = true;
  serazene.forEach((b, i) => {
    const z = zastavky[i];
    if (z) {
      if (minula) b.prejezd = { km: pr.km(minula, z), zVyjezdu: minulaVyjezd, ...(pr.minuty ? { min: pr.minuty(minula, z) } : {}) };
      minula = z;
      minulaVyjezd = false;
    } else if (b.volny && pr.cil) {
      const dalsiI = zastavky.findIndex((x, j) => j > i && !!x);
      const dalsi = dalsiI >= 0 ? zastavky[dalsiI]! : vyjezd;
      if (minula && dalsi) b.vlozeni = { pred: pr.km(minula, pr.cil), po: pr.km(pr.cil, dalsi), predVyjezd: minulaVyjezd, poVyjezd: dalsiI < 0 };
    }
  });
  return bloky;
}

/** Sestaví mřížku z událostí (čistá funkce – testuje se bez databáze) */
export function sestavMrizku(udalosti: UdalostMrizky[], technici: TechnikMrizky[], v: VolbyMrizky, oznaceni: OznaceniMrizky = {}): Mrizka {
  const { dny } = rozsahMrizky(v);
  const vyb = v.vybrani.length ? technici.filter((t) => v.vybrani.includes(t.jmeno)) : technici;
  const podle = new Map<string, UdalostMrizky[]>();
  for (const u of udalosti) {
    if (!dny.includes(isoDate(u.od))) continue;
    if (v.jenVolny && !jeVolneOkno({ summary: u.summary, barva: u.barvaId ?? undefined })) continue;
    const k = `${u.kalendar}|${isoDate(u.od)}`;
    (podle.get(k) ?? podle.set(k, []).get(k)!).push(u);
  }
  // rozsah dne: 8–21, roztáhne se podle skutečných událostí (nejvýš 5–23)
  let start = 8;
  let konec = 21;
  for (const seznam of podle.values()) {
    for (const u of seznam) {
      start = Math.min(start, Math.max(5, Math.floor(hodina(u.od))));
      const k = isoDate(u.do) > isoDate(u.od) ? 23 : Math.ceil(hodina(u.do));
      konec = Math.max(konec, Math.min(23, k));
    }
  }
  const delka = konec - start;
  type Pod = { t: TechnikMrizky; den: IsoDate; seznam: UdalostMrizky[] };
  const denCely = (d: IsoDate) => { const t = fromIso(d); return `${DNY[t.getUTCDay()]} ${t.getUTCDate()}. ${t.getUTCMonth() + 1}. ${t.getUTCFullYear()}`; };
  const skupiny: { nadpis: string; kratky?: string; datum?: IsoDate; pod: Pod[] }[] =
    v.pohled === "den"
      ? vyb.map((t) => ({ nadpis: t.nazevVKalendari, pod: [{ t, den: dny[0]!, seznam: podle.get(`${t.kalendar}|${dny[0]}`) ?? [] }] }))
      : dny.map((d) => ({ nadpis: denCely(d), kratky: denKratce(d), datum: d, pod: vyb.map((t) => ({ t, den: d, seznam: podle.get(`${t.kalendar}|${d}`) ?? [] })) }));
  // jen VOLNY: technici (den: sloupce, týden: podsloupce) bez volného slotu se nezobrazí
  const filtr = v.jenVolny
    ? (v.pohled === "den" ? skupiny.filter((s) => s.pod[0]!.seznam.length) : skupiny.map((s) => ({ ...s, pod: s.pod.filter((p) => p.seznam.length) })))
    : skupiny;
  const podsloupcu = filtr.reduce((n, s) => n + Math.max(1, s.pod.length), 0);
  const husta = podsloupcu > 12;
  let poradi = 0;
  const sloupce = filtr.map((s) => ({
    nadpis: s.nadpis,
    ...(s.kratky ? { kratky: s.kratky } : {}),
    ...(s.datum ? { datum: s.datum } : {}),
    pod: s.pod.map((p) => {
      const vlevo = poradi++ >= podsloupcu / 2;
      const prefix = new RegExp(`^${p.t.nazevVKalendari.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*-\\s*`, "i");
      return {
        // den: pod jménem technika místo výjezdu; týden: jméno, výjezd v nápovědě
        stitek: v.pohled === "den" ? (p.t.vyjezd ? `výjezd: ${p.t.vyjezd}` : "") : p.t.nazevVKalendari,
        napoveda: p.t.vyjezd ? `${p.t.jmeno} – výjezd: ${p.t.vyjezd}` : p.t.jmeno,
        bloky: prejezdyDne(p.seznam.map((u): BlokMrizky => {
          const od = Math.max(start, hodina(u.od));
          const doH = isoDate(u.do) > isoDate(u.od) ? konec : Math.min(konec, Math.max(od + 0.25, hodina(u.do)));
          const volny = jeVolneOkno({ summary: u.summary, barva: u.barvaId ?? undefined });
          const bg = barvaUdalosti(u);
          const adr = castAdresy(u.location);
          const kratky = u.summary.replace(prefix, "").replace(/\s+(SLA|RFS)\b.*$/i, "");
          return {
            top: ((od - start) / delka) * 100,
            vyska: ((doH - od) / delka) * 100,
            volny,
            bg,
            fg: barvaTextu(bg),
            // VOLNY má v hlavičce vždy celý název ze zdroje („Kostal - VOLNY“), zkracují se jen zakázky v hustém režimu
            nazev: volny || !husta ? u.summary : kratky,
            cas: `${hm(u.od)} – ${hm(u.do)}`,
            ulice: husta && adr.cast ? "" : adr.ulice,
            cast: adr.cast,
            adresa: u.location.trim(),
            plnyNazev: u.summary,
            detail: radkyDetailu(u.description),
            odkaz: u.odkaz,
            oid: u.summary.match(/O-\d{8,}/)?.[0] ?? null,
            vlevo,
            dole: od - start > delka * 0.45,
            kalendar: u.kalendar,
            id: u.id,
            technik: p.t.jmeno,
            odIso: u.od.toISOString(),
            doIso: u.do.toISOString(),
            ...(oznaceni.navrhy?.has(`${u.kalendar}|${u.id}`) ? { navrh: oznaceni.navrhy.get(`${u.kalendar}|${u.id}`)! } : {}),
            ...(oznaceni.tato && oznaceni.tato.kalendar === u.kalendar && oznaceni.tato.eventId === u.id ? { tato: true } : {}),
            ...(volny && oznaceni.dohodnuty && u.od < oznaceni.dohodnuty.do && u.do > oznaceni.dohodnuty.od ? { dohod: true } : {}),
          };
        }), p.t, oznaceni.prejezdy),
      };
    }),
  }));
  return { sloupce, hodiny: Array.from({ length: delka }, (_, i) => start + i), podsloupcu, husta };
}

const CSS = `${CSS_NAV}
*{box-sizing:border-box}
/* barvy, písmo, tlačítka a štítky jsou stejné jako ve zbytku aplikace (web/html.ts) */
:root{color-scheme:light dark;--bg:#f7f7f5;--panel:#fff;--text:#1d1d1b;--muted:#6b6b66;--line:#e3e2dd;--line2:#f1f0ec;--okraj:#e3e2dd;--hover:#f1f0ec;--accent:#1f5fbf;--vyb-bg:#dfe9f9;--vyb-fg:#123c7c;--vyb2:#eef3fb}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#161615;--panel:#1f1f1d;--text:#ecebe6;--muted:#a3a29c;--line:#34332f;--line2:#292825;--okraj:#34332f;--hover:#2a2a27;--accent:#7fa8ff;--vyb-bg:#2a3b63;--vyb-fg:#dbe7ff;--vyb2:#232b40}}
:root[data-theme=dark]{--bg:#161615;--panel:#1f1f1d;--text:#ecebe6;--muted:#a3a29c;--line:#34332f;--line2:#292825;--okraj:#34332f;--hover:#2a2a27;--accent:#7fa8ff;--vyb-bg:#2a3b63;--vyb-fg:#dbe7ff;--vyb2:#232b40}
:root[data-theme=light]{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}
body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text);background:var(--bg)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
button,input{font:inherit}
.k{height:100vh;min-height:620px;display:flex;flex-direction:column}
.k-lista{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:8px 20px;background:var(--panel);border-bottom:1px solid var(--line)}
.k-zal{display:flex;gap:6px;flex-wrap:wrap}.k-zal a{padding:7px 14px;border-radius:6px;color:var(--text);font-weight:600}.k-zal a:hover{background:var(--hover);text-decoration:none}.k-zal a.on{background:var(--accent);color:#fff}
.k-logo{font-size:20px;font-weight:700;color:var(--accent)}
.k-zak{font-size:15px;font-weight:600}
.k-sedy{color:var(--muted)}
.k-nav{margin-left:auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.k-tl{display:inline-flex;align-items:center;min-height:34px;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--panel);font-weight:600;color:var(--text)}
.k-tl:hover{background:var(--hover);text-decoration:none}
.k-sipka{display:inline-flex;align-items:center;justify-content:center;min-width:36px;min-height:34px;border-radius:6px;border:1px solid var(--line);background:var(--panel);font-size:18px;color:var(--text)}
.k-sipka:hover{background:var(--hover);text-decoration:none}
.k-datum{font-size:18px;font-weight:600}
.k-prep{display:flex;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--panel)}
.k-prep a{display:inline-flex;align-items:center;min-height:34px;padding:6px 14px;font-weight:600;color:var(--text)}
.k-prep a+a{border-left:1px solid var(--line)}
.k-prep a.on{background:var(--accent);color:#fff}
.k-telo{display:flex;flex-wrap:wrap;flex:1;min-height:0}
.k-panel{flex:0 0 232px;max-width:100%;padding:8px 14px 14px 20px;display:flex;flex-direction:column;gap:1px;overflow-y:auto;max-height:100%;font-size:13px}
.k-panel label{display:flex;align-items:center;gap:.6em;min-height:26px;cursor:pointer}
.k-panel input[type=checkbox]{width:1.2em;height:1.2em;flex:none}
.k-panel>*{flex-shrink:0}
.k-panel>b{font-weight:600;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:10px 0 4px}
.k-panel .k-tl{justify-content:center;margin-top:8px;cursor:pointer;font-size:13px}
.k-pozn{color:var(--muted);font-size:12px;margin-top:8px}.zdr{display:inline-block;font-size:10.5px;font-weight:400;color:var(--muted);border:1px solid var(--line);border-radius:10px;padding:0 7px;white-space:nowrap;line-height:1.5}
.k-panel label small{display:block;color:var(--muted);font-size:11px;line-height:1.15}
.k-panel label>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mm{margin:2px 0 8px;font-size:12px}
.mm-h{display:flex;align-items:center;justify-content:space-between;white-space:nowrap;font-weight:600;font-size:13px;padding:0 2px 4px}
.mm-h span+span{display:flex}.mm-h a{display:inline-flex;align-items:center;justify-content:center;min-width:28px;min-height:28px;border-radius:50%;color:var(--muted);font-size:1.3em}
.mm-h a:hover{background:var(--hover);text-decoration:none}
.mm table{width:100%;border-collapse:collapse;table-layout:fixed;text-align:center}
.mm th{font-weight:400;color:var(--muted);padding:.15em 0}
.mm td{padding:0}
.mm td.t{color:var(--muted);background:var(--hover);font-size:.9em}
.mm td a{display:inline-flex;align-items:center;justify-content:center;width:1.9em;height:1.9em;border-radius:50%;color:var(--text)}
.mm td a:hover{background:var(--hover);text-decoration:none}
.mm td a.jiny{color:var(--muted)}
.mm td a.dnes{background:var(--accent);color:var(--panel)}
.mm td a.vyb{background:var(--vyb-bg);color:var(--vyb-fg)}
.mm tr.vyb td{background:var(--vyb2)}.mm tr.vyb td.t{background:var(--vyb-bg)}
.ev-b b{font-weight:700}.tip b{font-weight:600}.tip div.r{color:var(--muted)}.tip div.r b{color:var(--text)}
.ev-b{position:relative}
.ev-dole{position:absolute;left:3px;right:3px;bottom:2px;display:flex;flex-wrap:wrap-reverse;justify-content:space-between;align-items:flex-end;gap:2px .3em;font-weight:400}
.ev-b .ev-dole,.ev-b span.ev-dole:first-child{font-weight:400}
.ev-km{background:rgba(0,0,0,.45);color:#fff;border-radius:1em;padding:0 .5em;font-weight:500;white-space:nowrap;font-size:.95em}
.ev.navrh .ev-dole{left:10px;right:10px;bottom:9px}
/* text v mřížce roste s šířkou monitoru (1080p → 4K), okolní prvky mají pevné velikosti jako zbytek aplikace */
.k-mriz{flex:999 1 560px;min-width:0;min-height:0;overflow-x:auto;display:flex;background:var(--panel);border-left:1px solid var(--line);font-size:clamp(12px,.42vw + 5px,19px)}
.k-vnitrek{flex:1;display:flex;flex-direction:column;padding-right:.5em}
.k-hl,.k-grid{display:flex}
.k-mriz.tyden .k-hl,.k-mriz.tyden .k-grid{background:var(--bg)}
.k-mriz.tyden .k-sl,.k-mriz.tyden .k-osa{background-color:var(--panel)}
.k-hl .k-sl{position:relative}.k-hl .k-sl:has(.k-kotva:target) .k-den{color:var(--accent)}
.k-kotva{position:absolute;left:calc(-3.4em - 20px);top:0;width:100vw;height:1px;pointer-events:none}
.k-vnitrek{overflow:clip}
.k-mriz.tyden .k-sl+.k-sl{margin-left:16px;border-left:2px solid var(--muted)}
.k-grid{flex:1;min-height:0;border-top:1px solid var(--line)}
.k-osa{width:3.4em;flex:none;display:flex;flex-direction:column;position:sticky;left:0;z-index:3;background:var(--panel)}
.k-osa div{flex:1 1 0;font-size:.8em;color:var(--muted);text-align:right;padding-right:.5em}
.k-sl{min-width:0;border-left:1px solid var(--line)}
.k-hl .k-sl{text-align:center;padding:.25em .2em 0}
.k-hl .k-sl>div:first-child{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-hl .k-den{font-size:1.15em;font-weight:600;letter-spacing:.06em;padding-bottom:.15em}
.k-pods{display:flex}
.k-pods div{flex:1 1 0;min-width:0;font-size:.8em;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-bottom:.2em}
/* mřížka po 15 minutách jako v Google Kalendáři: hodina výrazně, čtvrthodiny jemně */
.k-grid .k-sl{display:flex;background-image:linear-gradient(to bottom,var(--line) 1px,transparent 1px),linear-gradient(to bottom,var(--line2) 1px,transparent 1px)}
.k-pod{flex:1 1 0;min-width:0;position:relative}
.ev{position:absolute;left:1px;right:2px}
.ev-b{display:flex;flex-direction:column;gap:1px;width:100%;height:100%;border-radius:4px;padding:.15em .4em;overflow:hidden;border:1px solid var(--panel);font-size:.9em;line-height:1.2;text-decoration:none}
.ev-b:hover{text-decoration:none;filter:brightness(.93)}
.ev-b span:first-child{font-weight:500}
.tip{display:none;position:absolute;width:24em;max-width:60vw;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:.8em 1em;font-size:13px;font-weight:400;line-height:1.5;text-align:left;letter-spacing:.01em}
.tip-n{display:flex;gap:.6em;align-items:flex-start;font-size:15px;font-weight:400}
.tip-n i{flex:none;width:.9em;height:.9em;border-radius:3px;margin-top:.3em}
.tip-c{color:var(--muted);margin:.2em 0 .4em 1.5em}
.tip div.r{margin-left:1.5em;overflow-wrap:anywhere}
.ev:hover,.ev:focus-within{z-index:5}
.ev:hover .tip,.ev:focus-within .tip{display:block}
.k-prazdno{padding:2em;color:var(--muted)}
/* stejný rámeček jako .planovani v detailu zakázky */
.k-zakazka{margin:12px 20px 10px;border:2px solid var(--accent);border-radius:10px;padding:14px 16px 12px;background:color-mix(in srgb,var(--accent) 6%,var(--panel));box-shadow:0 2px 10px rgba(0,0,0,.06);display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}
.k-zakazka h2{flex:1 1 100%;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin:0 0 6px;font-size:20px;font-weight:700;color:var(--accent)}
.k-zakazka h2 small{font-size:13px;font-weight:400;color:var(--muted)}
.k-zakazka h2 small a{color:inherit;text-decoration:underline}
.k-zakazka h2 .k-tl{margin-left:auto;font-size:13px;min-height:32px}
/* štítky stejné jako v detailu zakázky: vlastník sítě (.infra), kombinace, předobjednávka, před RFS, USED */
.infra{display:inline-block;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;border:1px solid currentColor;white-space:nowrap}
.i-TMCZ{color:#d1006b}.i-CETIN{color:#1769c2}.i-VDF{color:#d10000}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .i-TMCZ{color:#ff5fb0}:root:not([data-theme=light]) .i-CETIN{color:#6fb0ff}:root:not([data-theme=light]) .i-VDF{color:#ff6b6b}}
:root[data-theme=dark] .i-TMCZ{color:#ff5fb0}:root[data-theme=dark] .i-CETIN{color:#6fb0ff}:root[data-theme=dark] .i-VDF{color:#ff6b6b}
.st{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.03em;padding:1px 6px;border-radius:4px;color:#fff}
.st-kombi{background:#fdd835;color:#000;border:1px solid #c6a700;font-weight:800}.st-predobj{background:#7b1fa2}.st-pred-rfs{background:#283593}.st-used{background:#ef6c00}.st-webcal{background:#00796b}
.k-blok{flex-basis:100%;background:#fde8e8;color:#8a1c1c;border-radius:6px;padding:8px 12px}
.k-upoz{flex-basis:100%;background:#fff4e0;color:#8a5300;border-radius:6px;padding:8px 12px}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .k-blok{background:#3b1717;color:#ff9e9e}:root:not([data-theme=light]) .k-upoz{background:#3a2c12;color:#ffcc80}}
:root[data-theme=dark] .k-blok{background:#3b1717;color:#ff9e9e}:root[data-theme=dark] .k-upoz{background:#3a2c12;color:#ffcc80}
.k-zive{font-size:12px;color:var(--muted)}
.k-zive.zaloha{color:#8c1d18;font-weight:700}
.ev.navrh .ev-b{outline:4px solid var(--text);outline-offset:-4px;box-shadow:inset 0 0 0 7px #fdd835}
.ev.navrh .ev-b{padding:.55em .7em}
.ev.navrh .ev-znak{background:#fdd835;color:#000;font-size:1.15em;padding:.05em .6em;border:2px solid #1f1f1f}
.s-navrhem .ev{background:var(--panel);border-radius:4px}
.s-navrhem .ev:not(.navrh):not(.tato) .ev-b{opacity:.3}
.s-navrhem .ev:not(.navrh):not(.tato):hover .ev-b{opacity:1}
@keyframes blik{0%,100%{box-shadow:0 0 0 0 rgba(253,216,53,0)}50%{box-shadow:0 0 0 10px rgba(253,216,53,.9)}}
.ev:target{z-index:4;border-radius:6px;animation:blik .8s ease-in-out 4}
.k-dop{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:center;gap:.4em .6em}
.k-dop a{display:inline-flex;align-items:center;gap:.4em;background:#fdd835;color:#000;border:2px solid #1f1f1f;border-radius:1em;padding:.1em .7em;font-weight:500}
.k-dop a b{font-weight:700}
.k-dop a.jinde{background:#fff}
.ev.tato .ev-b{outline:3px dashed var(--text);outline-offset:-3px}
.ev.dohod:not(.navrh) .ev-b{outline:3px solid #fff;outline-offset:-3px;box-shadow:inset 0 0 0 6px #1a73e8}
.ev.dohod:not(.navrh) .ev-znak{background:#1a73e8;color:#fff}
.s-navrhem .ev.dohod .ev-b{opacity:1}
.ev-znak{background:#fff;color:#0b5a2f;font-weight:700;border-radius:1em;padding:0 .5em}
.k-navrhy{margin:.4em 0 0;padding:0;list-style:none;font-size:.9em}
.k-navrhy li{margin:.25em 0}
.k-panel .k-tl.zel{background:var(--accent);border-color:var(--accent);color:#fff}
`;

export interface StrankaMrizky {
  volby: VolbyMrizky;
  technici: TechnikMrizky[];
  /** barva kalendáře technika (pro zaškrtávátka) */
  barvy: Map<string, string>;
  mrizka: Mrizka;
  /** kdy se kalendáře naposledy synchronizovaly */
  synchronizace: Date | null;
  uzivatel: string;
  /** data načtená teď přímo z Google Kalendáře (false = záloha z databáze, plánovat nejde) */
  zive?: boolean;
  /** čas načtení („Praha v UTC“) */
  nacteno?: Date;
  /** kalendáře, které se nepodařilo přečíst */
  nedostupne?: string[];
  /** plánování klikem na VOLNY: kdo smí do kterého kalendáře a parametry přesunu (pk/pe/pt, pp) */
  planovani?: { smi: (technik: string) => boolean; navic: Record<string, string> } | null;
  /** doporučené sloty (seznam vlevo; mohou být i mimo zobrazený den) */
  navrhy?: { poradi: number; den: IsoDate; cas: string; technik: string; duvod: string }[];
  navrhChyba?: string;
  /** rychlá volba dnů v horní liště (nejbližší pracovní dny) – stejná jako v Doplnit technika */
  rychleDny?: IsoDate[];
}

/** Parametry odkazu se zachováním výběru */
function odkaz(v: VolbyMrizky, zmena: Partial<Pick<VolbyMrizky, "pohled" | "den" | "jenVolny" | "navrh">>): string {
  const n = { ...v, ...zmena };
  const q = new URLSearchParams({ pohled: n.pohled, den: n.den });
  for (const t of n.vybrani) q.append("t", t);
  if (n.jenVolny) q.set("volne", "1");
  if (n.zakazka) q.set("z", n.zakazka.idAktivity);
  if (n.navrh && n.zakazka) q.set("navrh", "1");
  // týden: vodorovně odroluje na vybraný den (kotva na sloupci dne), ne na začátek týdne
  return `/kalendar?${q}${n.pohled === "tyden" ? `#den-${n.den}` : ""}`;
}

/** Měsíční kalendář v levém horním rohu (jako v Google Kalendáři): čísla týdnů, dnešek, vybraný den / týden */
export function miniMesic(v: VolbyMrizky, dnes: IsoDate): string {
  const d = fromIso(v.den);
  const prvni = isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  const mesic = d.getUTCMonth();
  const posun = (n: number) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), mesic + n, 1));
    const posledni = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return isoDate(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d.getUTCDate(), posledni))));
  };
  const isoTyden = (x: IsoDate) => {
    const t = fromIso(x);
    t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
    const t1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((t.getTime() - t1.getTime()) / 86_400_000 - 3 + ((t1.getUTCDay() + 6) % 7)) / 7);
  };
  const vybranyTyden = pondeli(v.den);
  const radky: string[] = [];
  for (let po = pondeli(prvni), i = 0; i < 6; i++, po = addDays(po, 7)) {
    if (i > 3 && fromIso(po).getUTCMonth() !== mesic) break;
    const bunky = Array.from({ length: 7 }, (_, k) => {
      const x = addDays(po, k);
      const tr = [x === dnes ? "dnes" : v.pohled === "den" && x === v.den ? "vyb" : "", fromIso(x).getUTCMonth() !== mesic ? "jiny" : ""].filter(Boolean).join(" ");
      return `<td><a${tr ? ` class="${tr}"` : ""} href="${esc(odkaz(v, { den: x }))}">${fromIso(x).getUTCDate()}</a></td>`;
    }).join("");
    radky.push(`<tr${v.pohled === "tyden" && po === vybranyTyden ? ` class="vyb"` : ""}><td class="t">${isoTyden(po)}</td>${bunky}</tr>`);
  }
  const NAZVY = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
  return `<div class="mm"><div class="mm-h"><span>${NAZVY[mesic]} ${d.getUTCFullYear()}</span><span><a href="${esc(odkaz(v, { den: posun(-1) }))}" aria-label="Předchozí měsíc">‹</a><a href="${esc(odkaz(v, { den: posun(1) }))}" aria-label="Další měsíc">›</a></span></div>
<table><tr><th></th><th>P</th><th>Ú</th><th>S</th><th>Č</th><th>P</th><th>S</th><th>N</th></tr>${radky.join("")}</table></div>`;
}

export function strankaMrizky(s: StrankaMrizky, dnes: IsoDate): string {
  const { volby: v, mrizka: m } = s;
  const z = v.zakazka;
  const krok = v.pohled === "den" ? 1 : 7;
  const { dny } = rozsahMrizky(v);
  const datum = v.pohled === "den" ? denDlouze(v.den) : `${denKratce(dny[0]!)} – ${denKratce(dny[6]!)} ${fromIso(dny[6]!).getUTCFullYear()}`;
  const vybrano = (t: TechnikMrizky) => !v.vybrani.length || v.vybrani.includes(t.jmeno);
  const sirka = v.jenVolny ? 34 : m.husta ? 58 : 96;
  const pismo = v.jenVolny && m.podsloupcu > 30 ? 0.72 : m.husta ? 0.78 : 0.9;
  const vaha = (sl: SloupecMrizky) => Math.max(1, sl.pod.length);
  const blok = (b: BlokMrizky) => {
    // VOLNY + plánovaná zakázka + oprávnění + živá data + žádná blokace → klik otevře formulář zápisu
    const lzePlanovat = b.volny && !!z && !!s.planovani && s.zive !== false && !(z.blokace ?? []).length && s.planovani.smi(b.technik);
    const cil = lzePlanovat
      ? `/zakazka/${encodeURIComponent(z!.idAktivity)}/zapis?${new URLSearchParams({ k: b.kalendar, e: b.id, t: b.technik, od: b.odIso, do: b.doIso, ...s.planovani!.navic })}`
      : b.oid ? `/o/${encodeURIComponent(b.oid)}` : b.odkaz;
    const znak = b.navrh ? `<span class="ev-znak">${m.husta ? `${b.navrh.poradi}.` : `nejoptimálnější ${b.navrh.poradi}`}</span>` : b.tato ? `<span class="ev-znak">tato zakázka</span>` : b.dohod ? `<span class="ev-znak">${m.husta ? "termín" : "termín zákazníka"}</span>` : "";
    const misto = [b.ulice ? esc(b.ulice) : "", b.cast ? `<b>${esc(b.cast)}</b>` : ""].filter(Boolean).join(", ");
    const km = (x: number) => `${x.toFixed(1).replace(".", ",")} km`;
    // přejezdy: zakázka = km z předchozí zastávky; VOLNY = km sem z předchozí a odsud na další (s plánovanou zakázkou)
    const prejezd = b.prejezd
      ? `<span class="ev-km">${m.husta ? "" : b.prejezd.zVyjezdu ? "z výjezdu " : "přejezd "}${km(b.prejezd.km)}${b.prejezd.min != null && !m.husta ? ` · ${Math.round(b.prejezd.min)} min` : ""}</span>`
      : b.vlozeni ? `<span class="ev-km">${m.husta ? "" : "sem "}${km(b.vlozeni.pred)} · ${m.husta ? "" : "dál "}${km(b.vlozeni.po)}</span>` : "";
    const prejezdDetail = b.prejezd
      ? `<div class="r">Přejezd ${b.prejezd.zVyjezdu ? "z výjezdu technika" : "z předchozí zakázky"}: <b>${km(b.prejezd.km)}</b>${b.prejezd.min != null ? `, asi ${Math.round(b.prejezd.min)} min` : ""}</div>`
      : b.vlozeni ? `<div class="r">S touto zakázkou: ${b.vlozeni.predVyjezd ? "z výjezdu" : "z předchozí zakázky"} <b>${km(b.vlozeni.pred)}</b>, ${b.vlozeni.poVyjezd ? "zpět na výjezd" : "na další zakázku"} <b>${km(b.vlozeni.po)}</b></div>` : "";
    // přejezd je vždy úplně dole v okně události (vpravo dole, i u krátkých bloků)
    const obsah = `<span>${esc(b.nazev)}</span><span>${esc(b.cas)}</span>${misto && !b.volny ? `<span>${misto}</span>` : ""}${znak || prejezd ? `<span class="ev-dole">${znak || "<i></i>"}${prejezd}</span>` : ""}`;
    const styl = `background:${b.bg};color:${b.fg}`;
    const telo = cil
      ? `<a class="ev-b" style="${styl}" href="${esc(cil)}"${lzePlanovat || b.oid ? "" : ` target="_blank" rel="noopener"`}>${obsah}</a>`
      : `<div class="ev-b" tabindex="0" style="${styl}">${obsah}</div>`;
    const tip = `<div class="tip" style="${b.vlevo ? "right:100%" : "left:100%"};${b.dole ? "bottom:0" : "top:0"}"><div class="tip-n"><i style="background:${b.bg}"></i><span>${esc(b.plnyNazev)}</span></div><div class="tip-c">${esc(b.cas)}</div>${b.adresa ? `<div class="r">${(() => { const a = castAdresy(b.adresa); return a.cast ? `${esc(a.ulice)}, <b>${esc(a.cast)}</b>` : esc(a.ulice); })()}</div>` : ""}${prejezdDetail}${b.detail.map((r) => `<div class="r">${esc(r)}</div>`).join("")}${lzePlanovat ? `<div class="r"><b>Klik = naplánovat ${esc(z!.oid)} do tohoto slotu.</b></div>` : ""}${b.navrh ? `<div class="r">Nejoptimálnější ${b.navrh.poradi}: ${esc(b.navrh.duvod)}</div>` : ""}</div>`;
    return `<div class="ev${b.navrh ? " navrh" : ""}${b.tato ? " tato" : ""}${b.dohod ? " dohod" : ""}"${b.navrh ? ` id="navrh-${b.navrh.poradi}"` : ""} style="top:${b.top.toFixed(3)}%;height:${b.vyska.toFixed(3)}%">${telo}${tip}</div>`;
  };
  const mrizka = m.sloupce.length
    ? `<div class="k-vnitrek" style="min-width:${60 + m.podsloupcu * sirka}px">
<div class="k-hl"><div class="k-osa"></div>${m.sloupce.map((sl) => `<div class="k-sl" style="flex:${vaha(sl)} 1 0">${sl.datum ? `<span class="k-kotva" id="den-${sl.datum}"></span>` : ""}<div${sl.kratky ? ` class="k-den" title="${esc(sl.nadpis)}"` : ""}>${esc(sl.nadpis)}</div><div class="k-pods">${sl.pod.map((p) => `<div title="${esc(p.napoveda)}">${esc(p.stitek)}</div>`).join("")}</div></div>`).join("")}</div>
<div class="k-grid"><div class="k-osa">${m.hodiny.map((h) => `<div>${h}:00</div>`).join("")}</div>${m.sloupce
        .map((sl) => `<div class="k-sl" style="flex:${vaha(sl)} 1 0;background-size:100% ${(100 / m.hodiny.length).toFixed(4)}%,100% ${(25 / m.hodiny.length).toFixed(4)}%">${sl.pod.map((p) => `<div class="k-pod" style="font-size:${pismo}em">${p.bloky.map(blok).join("")}</div>`).join("")}</div>`)
        .join("")}</div></div>`
    : `<div class="k-prazdno">${v.jenVolny ? "V zobrazeném období nemá žádný vybraný technik volný slot." : "Není vybraný žádný technik."}</div>`;
  const slaText = (t: Date) => `${DNY_KR[t.getUTCDay()]!.toLowerCase()} ${t.getUTCDate()}.${t.getUTCMonth() + 1}. ${hm(t)}`;
  const adrZ = z ? castAdresy(z.adresa) : null;
  const pruh = z
    ? `<div class="k-zakazka"><h2>Kam naplánovat <small><a href="/zakazka/${encodeURIComponent(z.idAktivity)}" title="Zpět na detail zakázky">${esc(z.oid)}</a>${z.zakaznik ? ` · ${esc(z.zakaznik)}` : ""}</small><span class="zdr" title="Zdroj informace">zdroj: MWF export</span><a class="k-tl" href="/zakazka/${encodeURIComponent(z.idAktivity)}">← Detail zakázky</a></h2>
${z.infra ? `<span class="infra i-${esc(z.infra)}">${esc(z.infra)}</span>` : ""}${(z.stitky ?? []).map((x) => (typeof x === "string" ? { text: x, druh: "kombi" } : x)).map((x) => `<span class="st st-${x.druh}">${esc(x.text)}</span>`).join("")}
${z.telefon ? `<span><a href="tel:${esc(z.telefon.replace(/[^+\d]/g, ""))}">${esc(z.telefon)}</a></span>` : ""}
<span>${adrZ!.cast ? `${esc(adrZ!.ulice)}, <b>${esc(adrZ!.cast)}</b>` : esc(adrZ!.ulice)}</span>
${z.typ ? `<span class="k-sedy">${esc(z.typ)}</span>` : ""}${z.sla ? `<span>do splnění <b>${esc(slaText(z.sla))}</b></span>` : ""}${z.termin ? (z.terminChybi ? `<span>přidělena s dohodnutým termínem <b>${esc(z.termin)}</b> – v kalendáři technika zatím není; odpovídající VOLNY je označený „termín zákazníka“</span>` : `<span>současný termín <b>${esc(z.termin)}</b> – klik na VOLNY zakázku přeplánuje</span>`) : ""}
${v.navrh && (s.navrhy ?? []).length ? `<div class="k-dop"><b>Nejoptimálnější VOLNY:</b>${s.navrhy!.map((n) => `<a class="${dny.includes(n.den) ? "" : "jinde"}" href="${esc(odkaz(v, { pohled: "den", den: n.den }))}#navrh-${n.poradi}" title="${esc(n.duvod)} – klik zobrazí den a slot"><b>${n.poradi}</b> ${esc(denKratce(n.den))} ${esc(n.cas)} · ${esc(n.technik)}</a>`).join("")}<span class="k-sedy">klik zobrazí den technika a doporučený slot</span></div>` : ""}
${(z.blokace ?? []).length ? `<div class="k-blok">Termín teď nelze naplánovat: ${z.blokace!.map(esc).join(" · ")}</div>` : ""}${(z.upozorneni ?? []).length ? `<div class="k-upoz">${z.upozorneni!.map(esc).join(" · ")}</div>` : ""}</div>`
    : "";
  const zive = s.zive === false
    ? `<span class="k-zive zaloha">Google Kalendář neodpovídá – záloha z databáze${s.synchronizace ? ` (stav k ${hm(s.synchronizace)})` : ""}, plánovat teď nelze.</span>`
    : s.nacteno ? `<span class="k-zive">živě z Google Kalendáře · načteno ${hm(s.nacteno)}:${String(s.nacteno.getUTCSeconds()).padStart(2, "0")}</span>` : "";
  const navrhy = z && !(z.blokace ?? []).length
    ? `<a class="k-tl${v.navrh ? "" : " zel"}" href="${esc(odkaz(v, { navrh: !v.navrh }) + (v.navrh ? "" : "&skok=1"))}">${v.navrh ? "Skrýt nejoptimálnější VOLNY" : "Vybrat nejoptimálnější VOLNY"}</a>${
        v.navrh
          ? s.navrhChyba ? `<div class="k-pozn">${esc(s.navrhChyba)}</div>`
            : (s.navrhy ?? []).length ? `<ol class="k-navrhy">${s.navrhy!.map((n) => `<li><a href="${esc(odkaz(v, { pohled: "den", den: n.den }))}#navrh-${n.poradi}"><b>${n.poradi}. ${esc(denKratce(n.den))} ${esc(n.cas)}</b> ${esc(n.technik)}</a><br><span class="k-sedy">${esc(n.duvod)}</span></li>`).join("")}</ol>`
            : `<div class="k-pozn">V prohledaném období žádný vhodný volný slot.</div>`
          : ""
      }`
    : "";
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="120">
<title>${z ? `${esc(z.oid)} – ` : ""}Kalendář techniků – AppKoo</title><style>${CSS}</style></head><body><div class="k">
<div class="k-lista"><a class="k-logo" href="/">AppKoo</a>${
    `<nav class="k-zal"><a href="/">Plánovat zakázku</a><a href="/technik">Doplnit technika</a><a class="on" href="/kalendar">Kalendář techniků</a></nav>`
  }${zive}<a class="k-tl" href="${esc(odkaz(v, {}))}">Obnovit</a>
<div class="k-nav">${(s.rychleDny ?? []).length ? rychleDny(s.rychleDny!, v.pohled === "den" ? v.den : "", (d) => odkaz(v, { pohled: "den", den: d })) : ""}${navDne({ dnes: odkaz(v, { den: dnes }), zpet: odkaz(v, { den: addDays(v.den, -krok) }), dal: odkaz(v, { den: addDays(v.den, krok) }), datum, krok: krok === 1 ? "den" : "týden" })}
<span class="k-prep"><a class="${v.pohled === "den" ? "on" : ""}" href="${esc(odkaz(v, { pohled: "den" }))}">Den</a><a class="${v.pohled === "tyden" ? "on" : ""}" href="${esc(odkaz(v, { pohled: "tyden" }))}">Týden</a></span></div></div>
${pruh}
<div class="k-telo">
<form class="k-panel" method="get" action="/kalendar"><input type="hidden" name="pohled" value="${v.pohled}"><input type="hidden" name="den" value="${v.den}">${z ? `<input type="hidden" name="z" value="${esc(z.idAktivity)}">` : ""}${v.navrh && z ? `<input type="hidden" name="navrh" value="1">` : ""}
${miniMesic(v, dnes)}
<label style="font-weight:500"><input type="checkbox" name="volne" value="1"${v.jenVolny ? " checked" : ""} style="accent-color:#0b8043">Jen VOLNY</label>
<b>Technici</b>
${s.technici.map((t) => `<label><input type="checkbox" name="t" value="${esc(t.jmeno)}"${vybrano(t) ? " checked" : ""} style="accent-color:${s.barvy.get(t.kalendar) ?? VYCHOZI_BARVA}"><span title="${esc(t.vyjezd ? `výjezd: ${t.vyjezd}` : t.jmeno)}">${esc(t.jmeno)}${t.vyjezd ? `<small>${esc(t.vyjezd)}</small>` : ""}</span></label>`).join("\n")}
<button class="k-tl" type="submit">Zobrazit výběr</button>
${navrhy}
<div class="k-pozn">Zdroj: Google Kalendář tmcz01; km přejezdů = odhad AppKoo. ${s.nacteno && s.zive !== false ? "Stránka se sama obnovuje po 2 minutách." : s.synchronizace ? `Stav k ${hm(s.synchronizace)} (${denKratce(isoDate(s.synchronizace))}).` : "Kalendáře se zatím nesynchronizovaly."}${(s.nedostupne ?? []).length ? ` Kalendář nejde přečíst: ${esc(s.nedostupne!.join(", "))}.` : ""}</div>
<div class="k-pozn">${esc(s.uzivatel)}</div>
</form>
<div class="k-mriz${v.pohled === "tyden" ? " tyden" : ""}${v.navrh && m.sloupce.some((sl) => sl.pod.some((p) => p.bloky.some((b) => b.navrh))) ? " s-navrhem" : ""}">${mrizka}</div>
</div></div></body></html>`;
}
