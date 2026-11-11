// Mřížka kalendáře – zrcadlo Google Kalendáře techniků (etapa 1: jen pro čtení).
// Den = sloupec na technika, týden = 7 dní a v každém zaškrtnutí technici vedle sebe. Časy, názvy i barvy bloků
// jsou přesně podle zdrojového kalendáře (žádné vlastní šablony slotů); celodenní události se nezobrazují.
// Bez JavaScriptu: výběr techniků je formulář GET, detail události se ukazuje přes CSS :hover / :focus-within.

import { addDays, fromIso, isoDate, type IsoDate } from "../domain/time.js";
import { jeVolneOkno } from "../gcal/kontrola.js";
import { zHtml } from "../gcal/kalendar.js";
import type { UdalostMrizky } from "../zdroje/sync.js";

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
  zakazka?: { idAktivity: string; oid: string; adresa: string; doSplneni?: string } | null;
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
}

export interface SloupecMrizky {
  nadpis: string;
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

/** Sestaví mřížku z událostí (čistá funkce – testuje se bez databáze) */
export function sestavMrizku(udalosti: UdalostMrizky[], technici: TechnikMrizky[], v: VolbyMrizky): Mrizka {
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
  const skupiny: { nadpis: string; pod: Pod[] }[] =
    v.pohled === "den"
      ? vyb.map((t) => ({ nadpis: t.nazevVKalendari, pod: [{ t, den: dny[0]!, seznam: podle.get(`${t.kalendar}|${dny[0]}`) ?? [] }] }))
      : dny.map((d) => ({ nadpis: denKratce(d), pod: vyb.map((t) => ({ t, den: d, seznam: podle.get(`${t.kalendar}|${d}`) ?? [] })) }));
  // jen VOLNY: technici (den: sloupce, týden: podsloupce) bez volného slotu se nezobrazí
  const filtr = v.jenVolny
    ? (v.pohled === "den" ? skupiny.filter((s) => s.pod[0]!.seznam.length) : skupiny.map((s) => ({ ...s, pod: s.pod.filter((p) => p.seznam.length) })))
    : skupiny;
  const podsloupcu = filtr.reduce((n, s) => n + Math.max(1, s.pod.length), 0);
  const husta = podsloupcu > 12;
  let poradi = 0;
  const sloupce = filtr.map((s) => ({
    nadpis: s.nadpis,
    pod: s.pod.map((p) => {
      const vlevo = poradi++ >= podsloupcu / 2;
      const prefix = new RegExp(`^${p.t.nazevVKalendari.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*-\\s*`, "i");
      return {
        // den: pod jménem technika místo výjezdu; týden: jméno, výjezd v nápovědě
        stitek: v.pohled === "den" ? (p.t.vyjezd ? `výjezd: ${p.t.vyjezd}` : "") : p.t.nazevVKalendari,
        napoveda: p.t.vyjezd ? `${p.t.jmeno} – výjezd: ${p.t.vyjezd}` : p.t.jmeno,
        bloky: p.seznam.map((u): BlokMrizky => {
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
          };
        }),
      };
    }),
  }));
  return { sloupce, hodiny: Array.from({ length: delka }, (_, i) => start + i), podsloupcu, husta };
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;font-family:Roboto,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:clamp(12px,.42vw + 5px,21px);color:#1f1f1f;background:#fff}
a{color:#1967d2;text-decoration:none}a:hover{text-decoration:underline}
button,input{font:inherit}
.k{height:100vh;min-height:620px;display:flex;flex-direction:column}
.k-lista{display:flex;flex-wrap:wrap;align-items:center;gap:.3em .9em;padding:.45em 1em;border-bottom:1px solid #dadce0}
.k-logo{font-size:1.35em;font-weight:700;color:#1967d2}
.k-zak{font-size:1.15em;font-weight:500}
.k-sedy{color:#444746}
.k-nav{margin-left:auto;display:flex;flex-wrap:wrap;align-items:center;gap:.5em}
.k-tl{display:inline-flex;align-items:center;min-height:36px;padding:0 1.1em;border-radius:18px;border:1px solid #747775;background:#fff;font-weight:500;color:#1f1f1f}
.k-tl:hover{background:#f1f3f4;text-decoration:none}
.k-sipka{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:36px;border-radius:18px;font-size:1.5em;color:#444746}
.k-sipka:hover{background:#f1f3f4;text-decoration:none}
.k-datum{font-size:1.35em}
.k-prep{display:flex;border:1px solid #747775;border-radius:18px;overflow:hidden}
.k-prep a{display:inline-flex;align-items:center;min-height:36px;padding:0 1.2em;font-weight:500;color:#1f1f1f}
.k-prep a+a{border-left:1px solid #747775}
.k-prep a.on{background:#d3e3fd;color:#0b2e6b}
.k-telo{display:flex;flex-wrap:wrap;flex:1;min-height:0}
.k-panel{flex:0 0 16em;max-width:100%;padding:.5em .9em .9em;display:flex;flex-direction:column;gap:.1em;overflow-y:auto;max-height:100%}
.k-panel label{display:flex;align-items:center;gap:.6em;min-height:26px;cursor:pointer}
.k-panel input[type=checkbox]{width:1.2em;height:1.2em;flex:none}
.k-panel b{font-weight:500;margin:.5em 0 .3em}
.k-panel .k-tl{justify-content:center;margin-top:.6em;cursor:pointer}
.k-pozn{color:#444746;font-size:.9em;margin-top:.6em}
.k-panel label small{display:block;color:#444746;font-size:.8em;line-height:1.1}
.k-panel label>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mm{margin:.2em 0 .6em;font-size:.82em}
.mm-h{display:flex;align-items:center;justify-content:space-between;white-space:nowrap;font-weight:500;font-size:1.1em;padding:0 .2em .3em}
.mm-h span+span{display:flex}.mm-h a{display:inline-flex;align-items:center;justify-content:center;min-width:28px;min-height:28px;border-radius:50%;color:#444746;font-size:1.3em}
.mm-h a:hover{background:#f1f3f4;text-decoration:none}
.mm table{width:100%;border-collapse:collapse;table-layout:fixed;text-align:center}
.mm th{font-weight:400;color:#444746;padding:.15em 0}
.mm td{padding:0}
.mm td.t{color:#444746;background:#f1f3f4;font-size:.9em}
.mm td a{display:inline-flex;align-items:center;justify-content:center;width:1.9em;height:1.9em;border-radius:50%;color:#1f1f1f}
.mm td a:hover{background:#f1f3f4;text-decoration:none}
.mm td a.jiny{color:#80868b}
.mm td a.dnes{background:#1967d2;color:#fff}
.mm td a.vyb{background:#d3e3fd;color:#0b2e6b}
.mm tr.vyb td{background:#eef3fd}.mm tr.vyb td.t{background:#d3e3fd}
.ev-b b,.tip b{font-weight:700}
.k-mriz{flex:999 1 560px;min-width:0;min-height:0;overflow-x:auto;display:flex}
.k-vnitrek{flex:1;display:flex;flex-direction:column;padding-right:.5em}
.k-hl,.k-grid{display:flex}
.k-grid{flex:1;min-height:0;border-top:1px solid #dadce0}
.k-osa{width:3.4em;flex:none;display:flex;flex-direction:column}
.k-osa div{flex:1 1 0;font-size:.8em;color:#444746;text-align:right;padding-right:.5em}
.k-sl{min-width:0;border-left:1px solid #dadce0}
.k-hl .k-sl{text-align:center;padding:.25em .2em 0}
.k-hl .k-sl>div:first-child{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-pods{display:flex}
.k-pods div{flex:1 1 0;min-width:0;font-size:.8em;color:#444746;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-bottom:.2em}
.k-grid .k-sl{display:flex;background-image:linear-gradient(to bottom,#dadce0 1px,transparent 1px)}
.k-pod{flex:1 1 0;min-width:0;position:relative}
.ev{position:absolute;left:1px;right:2px}
.ev-b{display:flex;flex-direction:column;gap:1px;width:100%;height:100%;border-radius:4px;padding:.15em .4em;overflow:hidden;border:1px solid #fff;font-size:.9em;line-height:1.2;text-decoration:none}
.ev-b:hover{text-decoration:none;filter:brightness(.93)}
.ev-b span:first-child{font-weight:500}
.tip{display:none;position:absolute;width:24em;max-width:60vw;background:#fff;color:#1f1f1f;border:1px solid #dadce0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:.7em .9em;font-size:14px;line-height:1.4;text-align:left}
.tip-n{display:flex;gap:.6em;align-items:flex-start;font-size:1.1em;font-weight:500}
.tip-n i{flex:none;width:.9em;height:.9em;border-radius:3px;margin-top:.3em}
.tip-c{color:#444746;margin:.2em 0 .4em 1.5em}
.tip div.r{margin-left:1.5em;overflow-wrap:anywhere}
.ev:hover,.ev:focus-within{z-index:5}
.ev:hover .tip,.ev:focus-within .tip{display:block}
.k-prazdno{padding:2em;color:#444746}
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
}

/** Parametry odkazu se zachováním výběru */
function odkaz(v: VolbyMrizky, zmena: Partial<Pick<VolbyMrizky, "pohled" | "den" | "jenVolny">>): string {
  const n = { ...v, ...zmena };
  const q = new URLSearchParams({ pohled: n.pohled, den: n.den });
  for (const t of n.vybrani) q.append("t", t);
  if (n.jenVolny) q.set("volne", "1");
  if (n.zakazka) q.set("z", n.zakazka.idAktivity);
  return `/kalendar?${q}`;
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
  const krok = v.pohled === "den" ? 1 : 7;
  const { dny } = rozsahMrizky(v);
  const datum = v.pohled === "den" ? denDlouze(v.den) : `${denKratce(dny[0]!)} – ${denKratce(dny[6]!)} ${fromIso(dny[6]!).getUTCFullYear()}`;
  const vybrano = (t: TechnikMrizky) => !v.vybrani.length || v.vybrani.includes(t.jmeno);
  const sirka = v.jenVolny ? 34 : m.husta ? 58 : 96;
  const pismo = v.jenVolny && m.podsloupcu > 30 ? 0.72 : m.husta ? 0.78 : 0.9;
  const vaha = (sl: SloupecMrizky) => Math.max(1, sl.pod.length);
  const blok = (b: BlokMrizky) => {
    const cil = b.oid ? `/o/${encodeURIComponent(b.oid)}` : b.odkaz;
    const misto = [b.ulice ? esc(b.ulice) : "", b.cast ? `<b>${esc(b.cast)}</b>` : ""].filter(Boolean).join(", ");
    const obsah = `<span>${esc(b.nazev)}</span><span>${esc(b.cas)}</span>${misto && !b.volny ? `<span>${misto}</span>` : ""}`;
    const styl = `background:${b.bg};color:${b.fg}`;
    const telo = cil
      ? `<a class="ev-b" style="${styl}" href="${esc(cil)}"${b.oid ? "" : ` target="_blank" rel="noopener"`}>${obsah}</a>`
      : `<div class="ev-b" tabindex="0" style="${styl}">${obsah}</div>`;
    const tip = `<div class="tip" style="${b.vlevo ? "right:100%" : "left:100%"};${b.dole ? "bottom:0" : "top:0"}"><div class="tip-n"><i style="background:${b.bg}"></i><span>${esc(b.plnyNazev)}</span></div><div class="tip-c">${esc(b.cas)}</div>${b.adresa ? `<div class="r">${(() => { const a = castAdresy(b.adresa); return a.cast ? `${esc(a.ulice)}, <b>${esc(a.cast)}</b>` : esc(a.ulice); })()}</div>` : ""}${b.detail.map((r) => `<div class="r">${esc(r)}</div>`).join("")}</div>`;
    return `<div class="ev" style="top:${b.top.toFixed(3)}%;height:${b.vyska.toFixed(3)}%">${telo}${tip}</div>`;
  };
  const mrizka = m.sloupce.length
    ? `<div class="k-vnitrek" style="min-width:${60 + m.podsloupcu * sirka}px">
<div class="k-hl"><div class="k-osa"></div>${m.sloupce.map((sl) => `<div class="k-sl" style="flex:${vaha(sl)} 1 0"><div>${esc(sl.nadpis)}</div><div class="k-pods">${sl.pod.map((p) => `<div title="${esc(p.napoveda)}">${esc(p.stitek)}</div>`).join("")}</div></div>`).join("")}</div>
<div class="k-grid"><div class="k-osa">${m.hodiny.map((h) => `<div>${h}:00</div>`).join("")}</div>${m.sloupce
        .map((sl) => `<div class="k-sl" style="flex:${vaha(sl)} 1 0;background-size:100% ${(100 / m.hodiny.length).toFixed(4)}%">${sl.pod.map((p) => `<div class="k-pod" style="font-size:${pismo}em">${p.bloky.map(blok).join("")}</div>`).join("")}</div>`)
        .join("")}</div></div>`
    : `<div class="k-prazdno">${v.jenVolny ? "V zobrazeném období nemá žádný vybraný technik volný slot." : "Není vybraný žádný technik."}</div>`;
  const z = v.zakazka;
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kalendář techniků – AppKoo</title><style>${CSS}</style></head><body><div class="k">
<div class="k-lista"><a class="k-logo" href="/">AppKoo</a>${
    z ? `<a class="k-zak" href="/zakazka/${encodeURIComponent(z.idAktivity)}">${esc(z.oid)}</a><span class="k-sedy">${esc([z.adresa, z.doSplneni ? `do splnění ${z.doSplneni}` : ""].filter(Boolean).join(" · "))}</span>` : `<span class="k-zak">Kalendář techniků</span>`
  }
<div class="k-nav"><a class="k-tl" href="${esc(odkaz(v, { den: dnes }))}">Dnes</a><a class="k-sipka" href="${esc(odkaz(v, { den: addDays(v.den, -krok) }))}" aria-label="Předchozí">‹</a><a class="k-sipka" href="${esc(odkaz(v, { den: addDays(v.den, krok) }))}" aria-label="Další">›</a><span class="k-datum">${esc(datum)}</span>
<span class="k-prep"><a class="${v.pohled === "den" ? "on" : ""}" href="${esc(odkaz(v, { pohled: "den" }))}">Den</a><a class="${v.pohled === "tyden" ? "on" : ""}" href="${esc(odkaz(v, { pohled: "tyden" }))}">Týden</a></span></div></div>
<div class="k-telo">
<form class="k-panel" method="get" action="/kalendar"><input type="hidden" name="pohled" value="${v.pohled}"><input type="hidden" name="den" value="${v.den}">${z ? `<input type="hidden" name="z" value="${esc(z.idAktivity)}">` : ""}
${miniMesic(v, dnes)}
<label style="font-weight:500"><input type="checkbox" name="volne" value="1"${v.jenVolny ? " checked" : ""} style="accent-color:#0b8043">Jen VOLNY</label>
<b>Kalendáře techniků</b>
${s.technici.map((t) => `<label><input type="checkbox" name="t" value="${esc(t.jmeno)}"${vybrano(t) ? " checked" : ""} style="accent-color:${s.barvy.get(t.kalendar) ?? VYCHOZI_BARVA}"><span title="${esc(t.vyjezd ? `výjezd: ${t.vyjezd}` : t.jmeno)}">${esc(t.jmeno)}${t.vyjezd ? `<small>${esc(t.vyjezd)}</small>` : ""}</span></label>`).join("\n")}
<button class="k-tl" type="submit">Zobrazit výběr</button>
<div class="k-pozn">Zrcadlo Google Kalendáře: časy a barvy podle zdroje. ${s.synchronizace ? `Stav k ${hm(s.synchronizace)} (${denKratce(isoDate(s.synchronizace))}).` : "Kalendáře se zatím nesynchronizovaly."}</div>
<div class="k-pozn">${esc(s.uzivatel)}</div>
</form>
<div class="k-mriz">${mrizka}</div>
</div></div></body></html>`;
}
