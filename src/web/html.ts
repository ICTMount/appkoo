// HTML stránky webového rozhraní (vykreslují se na serveru, bez JavaScriptu na klientu).
// Zakázka se vždy označuje ID O- (ID obj. v ext. systému); S7 je doplňkové.

import { fmtDate, fmtTime, isoDate } from "../domain/time.js";
import type { Priorita } from "../domain/priorita.js";
import type { Detail, PolozkaFronty, StavImportu } from "./data.js";
import { pokusyZakazky } from "./data.js";
import type { Brany, DenPrehledu, MoznostSlotu, Nabidka, NavrhySlotu, TechnikPlanu, VybranySlot } from "../plan/planovac.js";
import { jeVolneOkno, type UdalostTechnika } from "../gcal/kontrola.js";
import { POVINNA_POTVRZENI } from "./planovani.js";
import type { Nalez, VysledekZdroje, Zdroj } from "../zdroje/hledani.js";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** MWF dává před čísla „=“ (ochrana proti Excelu) – pro zobrazení pryč */
export const bezRovna = (s: string | null | undefined) => (s ?? "").replace(/^=+/, "").trim();

const dt = (d: Date | null | undefined) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : "");
const den = (d: Date | null | undefined) => (d ? fmtDate(d) : "");
const denIso = (d: string | null) => (d ? fmtDate(d) : "");


const STAV_KONTAKTU: Record<PolozkaFronty["plan"]["stav"], string> = {
  novy: "bez pokusu",
  probiha: "nedovoláno",
  dovolano: "dovoláno",
  navrh_zak: "návrh ZAK",
};

function stavKontaktu(p: PolozkaFronty, now: Date): string {
  const { plan } = p;
  if (plan.stav === "dovolano" || plan.stav === "novy") return STAV_KONTAKTU[plan.stav];
  const dalsi = plan.dalsiPokus
    ? isoDate(plan.dalsiPokus) === isoDate(now)
      ? `další ${fmtTime(plan.dalsiPokus)}`
      : `další ${den(plan.dalsiPokus)}`
    : "";
  // nad 3 dny je řada pokusů za námi (typicky zaparkovaná zakázka se staršími pokusy)
  const rada = plan.denRady <= 3 ? `den ${plan.denRady}/3` : `${plan.navolaneDny} navolané dny (řada ukončena)`;
  return [`${STAV_KONTAKTU[plan.stav]} · ${rada}`, dalsi, plan.sms.odeslano ? `SMS ${plan.sms.odeslano}×` : ""]
    .filter(Boolean)
    .join(" · ");
}

const CSS = `
:root{--bg:#f7f7f5;--panel:#fff;--text:#1d1d1b;--muted:#6b6b66;--line:#e3e2dd;--accent:#1f5fbf;
--p1:#c62828;--p2:#e07a00;--p3:#4a7a2c;--p0:#8a8a85;--warn-bg:#fff4e0;--warn:#8a5300}

*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:10px 20px;background:var(--panel);border-bottom:1px solid var(--line)}
header .logo{font-weight:700;font-size:16px}header .info{color:var(--muted);font-size:12px;margin-left:auto;text-align:right}
main{padding:16px 20px;max-width:1600px;margin:0 auto}
.warn{background:var(--warn-bg);color:var(--warn);padding:8px 12px;border-radius:6px;margin-bottom:12px}
form.filtr{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:12px}
form.filtr label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:2px}
select,input,button{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text)}
button{background:var(--accent);color:#fff;border-color:var(--accent);cursor:pointer}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.tabs a{padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--text)}
.tabs a.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);font-weight:600}
.tabs b{margin-left:4px}
.tbl{width:100%;overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap;position:sticky;top:0;background:var(--panel)}
tr:last-child td{border-bottom:0}td.oid a{font-weight:600;white-space:nowrap}td small,.muted{color:var(--muted)}
.prio{display:inline-block;min-width:30px;text-align:center;font-weight:700;border-radius:4px;padding:1px 6px;color:#fff;font-size:12px}
.P1{background:var(--p1)}.P2{background:var(--p2)}.P3{background:var(--p3)}.P0{background:var(--p0)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.card h2{font-size:14px;margin:0 0 8px}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0}dt{color:var(--muted)}dd{margin:0}
.zaznam{border-top:1px solid var(--line);padding:6px 0}.zaznam:first-child{border-top:0}
.zaznam .hl{font-size:12px;color:var(--muted)}.zaznam.veg .hl b{color:var(--accent)}
h1{font-size:20px;margin:4px 0 12px}h1 small{font-size:14px;color:var(--muted);font-weight:400}
.nowrap{white-space:nowrap}
a.btn,button.btn{display:inline-block;background:var(--accent);color:#fff;border-radius:6px;padding:6px 12px;border:0;font-weight:600}
a.btn:hover{text-decoration:none;opacity:.9}button[disabled]{opacity:.45;cursor:not-allowed}
.ok{background:#e6f4ea;color:#1e5e2e;padding:10px 12px;border-radius:6px;margin-bottom:12px}

.err{background:#fde8e8;color:#8a1c1c;padding:10px 12px;border-radius:6px;margin-bottom:12px}

fieldset{border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:0 0 12px}legend{font-weight:600;padding:0 4px}
.pole{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.pole label{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--muted)}
.pole input,.pole select,textarea{color:var(--text)}textarea{width:100%;min-height:90px;font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel)}
.check{display:flex;gap:8px;align-items:flex-start;margin:6px 0}
pre.mwf{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px;font-size:15px;user-select:all;white-space:pre-wrap}
header{display:block;padding:0;position:sticky;top:0;z-index:5}
header .lista{display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:start;padding:10px 20px}
header .vlevo{justify-self:start}header .logo{font-size:20px}
header .stred{display:flex;flex-direction:column;align-items:center;gap:8px}header .stred .export{align-items:center;text-align:center;font-size:12px;color:var(--muted)}
@media (max-width:760px){header .lista{grid-template-columns:1fr}header .vlevo,header .stred,header .vpravo{justify-self:stretch;align-items:flex-start}}
nav.zalozky{display:flex;gap:8px;justify-content:center;padding:4px 20px 10px}nav.zalozky a{font-size:15px;padding:8px 22px}nav.zalozky a{padding:7px 14px;border-radius:6px;color:var(--text);font-weight:600}
nav.zalozky a.on{background:var(--accent);color:#fff}nav.zalozky a:hover{text-decoration:none;background:var(--line)}nav.zalozky a.on:hover{background:var(--accent)}
header .vpravo{justify-self:end;display:flex;flex-direction:column;align-items:flex-end;gap:5px;font-size:12px;color:var(--muted)}
header .kdo{color:var(--text)}a.konfig{font-size:12px;font-weight:600}a.konfig.on{text-decoration:underline}
.export{display:flex;flex-direction:column;gap:3px;min-width:230px}.export b{color:var(--text)}
.bar{height:5px;border-radius:3px;background:var(--line);overflow:hidden}.bar span{display:block;height:100%}
.b-zel{background:#2e9d4b}.b-oranz{background:#e08a00}.b-cerv{background:#d32f2f}
.c-zel{color:#2e9d4b;font-weight:600}.c-oranz{color:#e08a00;font-weight:600}.c-cerv{color:#d32f2f;font-weight:600}
form.hledani{display:flex;gap:8px;padding:8px 20px;border-top:1px solid var(--line)}form.hledani input{flex:1;font-size:15px;padding:8px 10px}
.infra{display:inline-block;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;border:1px solid currentColor;vertical-align:middle;white-space:nowrap}
.i-TMCZ{color:#d1006b}.i-CETIN{color:#1769c2}.i-VDF{color:#d10000}.i-jin{color:var(--muted)}

h2.sekce{font-size:17px;margin:22px 0 10px;padding-top:14px;border-top:2px solid var(--line)}
.card.scroll{max-height:360px;overflow:auto}
.tyden{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px}
.tyden .card{padding:10px}.tyden h3{font-size:13px;margin:0 0 6px}
.ud{font-size:12px;padding:4px 0;border-top:1px solid var(--line)}.ud:first-of-type{border-top:0}.ud .cas{color:var(--muted);margin-right:4px}
a.volny{display:block;font-size:12px;padding:5px 8px;margin:4px 0;border-radius:6px;background:#e6f4ea;color:#1e5e2e;font-weight:600}
a.volny.vyb{outline:2px solid var(--accent)}
.card.kompakt{padding:8px 12px;font-size:12px}.card.kompakt h2{font-size:12px;margin-bottom:4px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.card.kompakt dl{gap:2px 10px}
.konec-detailu{margin:26px 0 18px;border-top:3px double var(--line)}
section.planovani{border:2px solid var(--accent);border-radius:10px;padding:14px 16px 6px;background:color-mix(in srgb,var(--accent) 6%,var(--panel));box-shadow:0 2px 10px rgba(0,0,0,.06)}
section.planovani>h2{font-size:20px;margin:0 0 12px;color:var(--accent)}section.planovani>h2 small{font-size:13px;color:var(--muted);font-weight:400}
section.planovani .tbl{border-color:var(--accent)}
iframe.mapa{width:100%;height:220px;border:1px solid var(--line);border-radius:6px;margin:8px 0}
table.male{font-size:12px}table.male th,table.male td{padding:3px 6px}details summary{cursor:pointer;margin-top:6px}
.uvod{max-width:720px;margin:40px auto;text-align:center}.uvod p{color:var(--muted)}
/* tmavý režim: podle systému, nebo ručně přepínačem (atribut data-theme na <html>, cookie „tema“) */
:root{color-scheme:light dark}:root[data-theme=light]{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#161615;--panel:#1f1f1d;--text:#ecebe6;--muted:#a3a29c;--line:#34332f;
--accent:#7fa8ff;--p1:#ff6b6b;--p2:#ffab40;--p3:#9ccc65;--p0:#9a9993;--warn-bg:#3a2c12;--warn:#ffcc80}:root:not([data-theme=light]) .ok{background:#173322;color:#a5d6a7}:root:not([data-theme=light]) .err{background:#3b1717;color:#ff9e9e}:root:not([data-theme=light]) .i-TMCZ{color:#ff5fb0}:root:not([data-theme=light]) .i-CETIN{color:#6fb0ff}:root:not([data-theme=light]) .i-VDF{color:#ff6b6b}:root:not([data-theme=light]) a.volny{background:#173322;color:#a5d6a7}}
:root[data-theme=dark]{--bg:#161615;--panel:#1f1f1d;--text:#ecebe6;--muted:#a3a29c;--line:#34332f;
--accent:#7fa8ff;--p1:#ff6b6b;--p2:#ffab40;--p3:#9ccc65;--p0:#9a9993;--warn-bg:#3a2c12;--warn:#ffcc80}:root[data-theme=dark] .ok{background:#173322;color:#a5d6a7}:root[data-theme=dark] .err{background:#3b1717;color:#ff9e9e}:root[data-theme=dark] .i-TMCZ{color:#ff5fb0}:root[data-theme=dark] .i-CETIN{color:#6fb0ff}:root[data-theme=dark] .i-VDF{color:#ff6b6b}:root[data-theme=dark] a.volny{background:#173322;color:#a5d6a7}
.tema{display:flex;border:1px solid var(--line);border-radius:999px;overflow:hidden}.tema a{padding:3px 9px;color:var(--muted);font-size:12px}.tema a:hover{text-decoration:none;background:var(--line)}:root:not([data-theme]) .tema .t-auto,:root[data-theme=light] .tema .t-light,:root[data-theme=dark] .tema .t-dark{background:var(--accent);color:#fff}
`;

export type Zalozka = "zakazka" | "technik" | "konfigurace";

/** Stáří posledního exportu MWF: do 1 h zelená, do 2 h oranžová, déle červená */
export function cerstvost(stav: StavImportu): string {
  const h = stav.stariHodin;
  const trida = h === null || h > 2 ? "cerv" : h > 1 ? "oranz" : "zel";
  const sirka = h === null ? 100 : Math.min(100, Math.max(4, (h / 3) * 100));
  const popis = h === null ? "zatím žádný export" : `před ${String(h).replace(".", ",")} h`;
  return `<div class="export"><div>Export MWF <b>${esc(dt(stav.posledniExport) || "–")}</b> · <span class="c-${trida}">${esc(popis)}</span></div><div class="bar" title="do 1 h zelená, do 2 h oranžová, přes 2 h červená"><span class="b-${trida}" style="width:${sirka.toFixed(0)}%"></span></div></div>`;
}

/** Vlastník infrastruktury (TMCZ / CETIN / VDF) – štítek všude, kde je zakázka */
export const infraStitek = (i: string) => `<span class="infra i-${esc(/^(TMCZ|CETIN|VDF)$/.test(i) ? i : "jin")}" title="P17: Vlastník sítě">${esc(i || "?")}</span>`;

export function stranka(titulek: string, uzivatel: string, stav: StavImportu, telo: string, o: { zalozka?: Zalozka; dotaz?: string } = {}): string {
  const zal = o.zalozka ?? "zakazka";
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulek)} – AppKoo</title><style>${CSS}</style></head><body>
<header><div class="lista">
<div class="vlevo"><a class="logo" href="/">AppKoo</a></div>
<div class="stred">${cerstvost(stav)}</div>
<div class="vpravo"><nav class="tema" aria-label="Vzhled"><a class="t-light" href="/tema?t=light" title="Světlý">☀ Světlý</a><a class="t-auto" href="/tema?t=auto" title="Podle systému">Auto</a><a class="t-dark" href="/tema?t=dark" title="Tmavý">☾ Tmavý</a></nav>
<div class="kdo">${esc(uzivatel)}<!--role--></div><!--konfigurace:${zal === "konfigurace" ? "on" : "off"}--></div></div>
<nav class="zalozky"><a href="/" class="${zal === "zakazka" ? "on" : ""}">Plánovat zakázku</a><a href="/technik" class="${zal === "technik" ? "on" : ""}">Doplnit technika</a></nav>
<form class="hledani" action="/" method="get"><input name="q" value="${esc(o.dotaz ?? "")}" placeholder="O-ID, S7, telefon, příjmení nebo adresa zakázky" aria-label="Najít zakázku"><button>Najít a plánovat</button></form></header>
<main>${telo}</main></body></html>`;
}

export function strankaUvod(stav: StavImportu, uzivatel: string): string {
  const telo = `<div class="uvod"><h1>Plánovat zakázku</h1>
<p>Zadejte nahoře O-ID zakázky (nebo S7, telefon, příjmení). Nahoře uvidíte detail zakázky se všemi podklady – MWF, e-mail, kalendáře, chat –
a dole nabídku, kam ji ideálně naplánovat.</p>
<p>Chcete naopak doplnit volný čas technika? Přepněte na <a href="/technik">Doplnit technika</a>.</p></div>`;
  return stranka("Plánovat zakázku", uzivatel, stav, telo);
}

export function strankaVysledku(
  dotaz: string,
  polozky: { z: PolozkaFronty["z"]; priorita: Priorita }[],
  zdroje: VysledekZdroje[] | null,
  stav: StavImportu,
  uzivatel: string,
): string {
  const radky = polozky.map(
    ({ z, priorita }) => `<tr><td class="oid"><a href="/zakazka/${encodeURIComponent(z.idAktivity)}">${esc(z.idObjednavky || z.idAktivity)}</a>${bezRovna(z.idS7) ? `<br><small>${esc(bezRovna(z.idS7))}</small>` : ""}</td>
<td>${infraStitek(z.infrastruktura)}</td><td>${esc(z.zakaznik)}<br><small>${esc([z.adresa, bezRovna(z.psc)].filter(Boolean).join(", "))}</small></td>
<td>${esc(z.typAktivity)}</td><td>${esc(z.stavMwf)}${z.termin ? `<br><small>termín ${esc(dt(z.termin.od))}</small>` : ""}</td><td><span class="prio ${priorita}">${priorita}</span></td></tr>`,
  );
  const telo = `<h1>Hledání „${esc(dotaz)}“ <small>${polozky.length} zakázek</small></h1>
<div class="tbl"><table><thead><tr><th>ID obj. v ext. systému / ID S7 obj.</th><th>P17: Vlastník sítě</th><th>Zákazník / Adresa</th><th>Typ aktivity</th><th>Stav</th><th>Priorita</th></tr></thead>
<tbody>${radky.join("") || `<tr><td colspan="6" class="muted">V zakázkách MWF nic. Zkuste celé O-ID (O-8553361721), S7, telefon nebo příjmení.</td></tr>`}</tbody></table></div>
${sekceZdroju(zdroje)}`;
  return stranka("Hledání", uzivatel, stav, telo, { dotaz });
}

export interface PlanovaniZakazky {
  brany: Brany;
  nabidka: Nabidka | null;
  zapis: { zapnuty: boolean; smiTechnik: (t: string) => boolean };
  /** plánovač není zapnutý (chybí kalendáře) */
  nedostupne?: boolean;
}

/** Zakázka: nahoře detail se všemi podklady, dole kam ji naplánovat */
export function strankaZakazky(d: Detail, stav: StavImportu, uzivatel: string, now: Date, zdroje: VysledekZdroje[] | null, plan: PlanovaniZakazky): string {
  const z = d.z;
  const pokusy = pokusyZakazky(z);
  const radek = (k: string, v: string) => (v ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : "");

  const zaznamy = [...z.zaznamy]
    .reverse()
    .map(
      (x) => `<div class="zaznam${x.vegacom ? " veg" : ""}"><div class="hl"><b>${esc(x.typ)}</b> · ${esc(dt(x.at))} · ${esc(x.autor)}${
        x.kody.length ? ` · ${esc(x.kody.join(", "))}` : ""
      }</div>${esc(x.text)}</div>`,
    )
    .join("");

  // SLA jako konkrétní čas: čas exportu + „Do splnění“ z MWF
  const sla = z.doSplneniMin !== null && stav.posledniExport ? new Date(stav.posledniExport.getTime() + z.doSplneniMin * 60_000) : null;
  const slaText = (() => {
    if (!sla) return "";
    const h = Math.round((sla.getTime() - now.getTime()) / 3_600_000);
    const kdy = `${denTydne(sla)} ${dt(sla)}`;
    return h < 0
      ? `<b class="c-cerv">${esc(kdy)} · po SLA ${esc(String(-h))} h</b>`
      : `<b class="${h <= 24 ? "c-oranz" : ""}">${esc(kdy)}</b> · zbývá ${esc(h >= 48 ? `${Math.round(h / 24)} dní` : `${h} h`)}`;
  })();

  const adresa = [z.adresa, bezRovna(z.psc)].filter(Boolean).join(", ");
  const mapa = adresa
    ? `<div class="card"><h2>Adresa a mapa</h2><div>${esc(adresa)}</div>
<iframe class="mapa" title="Mapa" loading="lazy" referrerpolicy="no-referrer" src="https://www.google.com/maps?q=${esc(encodeURIComponent(adresa))}&amp;z=15&amp;output=embed"></iframe>
<div><a href="https://www.google.com/maps/search/?api=1&amp;query=${esc(encodeURIComponent(adresa))}" target="_blank" rel="noopener">Google Mapy</a> · <a href="https://mapy.cz/zakladni?q=${esc(encodeURIComponent(adresa))}" target="_blank" rel="noopener">Mapy.cz</a></div></div>`
    : "";

  const POSLEDNI = 5;
  const radkyHistorie = (rows: typeof d.historie) =>
    rows
      .map(
        (h) => `<tr><td class="nowrap">${esc(dt(h.export_at))}</td><td>${esc(h.stav_mwf)}</td><td>${esc(h.parkovani ?? "")}</td><td>${esc(h.vysledek ?? "")}</td><td>${esc(dt(h.termin_od))}</td><td>${esc(h.technik ?? "")}</td></tr>`,
      )
      .join("");
  const hlavicka = `<thead><tr><th>Export</th><th>Stav</th><th>Důvod parkování</th><th>Výsledek dojednávání</th><th>Dohodnutý termín</th><th>Pracovní zdroj</th></tr></thead>`;
  const historieHtml = d.historie.length
    ? `<table class="male">${hlavicka}<tbody>${radkyHistorie(d.historie.slice(0, POSLEDNI))}</tbody></table>${
        d.historie.length > POSLEDNI
          ? `<details><summary class="muted">všech ${d.historie.length} změn</summary><table class="male">${hlavicka}<tbody>${radkyHistorie(d.historie.slice(POSLEDNI))}</tbody></table></details>`
          : ""
      }`
    : `<span class="muted">bez historie</span>`;

  const telo = `<h1>${esc(z.idObjednavky || z.idAktivity)} ${infraStitek(z.infrastruktura)} <span class="prio ${d.priorita}">${d.priorita}</span> <small>${esc(z.zakaznik)}${bezRovna(z.idS7) ? ` · ID S7 obj. ${esc(bezRovna(z.idS7))}` : ""} · ID aktivity ${esc(z.idAktivity)}</small></h1>
${d.uzavreno ? `<div class="warn">Zakázka už v exportu MWF není (uzavřená ${esc(dt(d.uzavreno))}).</div>` : ""}
<div class="grid">
<div class="card"><h2>Zákazník</h2><dl>
${radek("Zákazník", esc(z.zakaznik))}
${radek("Kontakt", z.telefony.map((t) => `<a href="tel:${esc(t.replace(/\s/g, ""))}">${esc(t)}</a>`).join(", "))}
${radek("Adresa / PSČ", esc(adresa))}
${radek("Subregion", esc(z.subregion))}
${radek("Produkt", esc(z.produkt))}
</dl></div>
<div class="card"><h2>Zakázka</h2><dl>
${radek("Stav", esc(z.stavMwf))}
${radek("Pracovní zdroj", esc(z.technik))}
${radek("Čas postoupení dod.", esc(dt(z.prideleno)))}
${radek("Výsledek dojednávání", esc(z.vysledek ?? ""))}
${radek("Do splnění", slaText)}
${radek("Dohodnutý termín", esc(z.termin ? `${dt(z.termin.od)} – ${fmtTime(z.termin.do)}` : ""))}
${radek("Důvod parkování", esc([z.parkovani, z.parkovaniSkupina, z.parkovaniNestandardni && `nestandardní: ${z.parkovaniNestandardni}`].filter(Boolean).join(" · ")))}
${radek("P17: Vlastník sítě", infraStitek(z.infrastruktura))}
${radek("Typ aktivity", esc(`${z.typAktivity}${z.predobjednavka ? " · předobjednávka" : ""}`))}
${radek("P3: Typ balíčku", esc(z.balik) || `<span class="muted">neuvedeno</span>`)}
${radek("Priorita", `<span class="prio ${d.priorita}">${d.priorita}</span> ${esc(d.duvod)}`)}
${radek("Preferované datum", esc(den(z.preferovanyDatum)))}
${radek("Datum RFS", esc(den(z.rfs)))}
${radek("Marné výjezdy", z.pocetMv ? esc(String(z.pocetMv)) : "")}
</dl></div>
${mapa}
</div>
${d.souvisejici.length ? `<div class="card" style="margin-top:12px"><h2>Další aktivity se stejným ID obj. v ext. systému</h2>${d.souvisejici
    .map((s) => `<div>ID aktivity <a href="/zakazka/${encodeURIComponent(s.id_aktivity)}">${esc(s.id_aktivity)}</a> · ${esc(s.typ_aktivity)} · ${esc(s.stav_mwf)}${s.uzavreno ? " · uzavřeno" : ""}</div>`)
    .join("")}</div>` : ""}
<div class="card scroll" style="margin-top:12px"><h2>Poznámka (nejnovější nahoře)</h2>${zaznamy || `<span class="muted">bez záznamů</span>`}${z.uvodPoznamky ? `<div class="zaznam"><div class="hl"><b>Úvod poznámky</b></div>${esc(z.uvodPoznamky)}</div>` : ""}</div>
${sekceZdroju(zdroje)}
<div class="grid" style="margin-top:12px">
<div class="card kompakt"><h2>Kontaktování</h2><dl>
${radek("Stav", esc(stavKontaktu(d, now)))}
${radek("Další kontakt", esc(denIso(d.dalsiKontakt)))}
${radek("Navolané dny", esc(`${d.plan.navolaneDny} (cíl ${d.plan.pokusuDenne} pokus/y denně)`))}
${radek("SMS", esc(`odesláno ${d.plan.sms.odeslano}${d.plan.sms.doporucena ? " · doporučena další" : ""}${d.plan.sms.nejdrive ? ` · nejdřív ${dt(d.plan.sms.nejdrive)}` : ""}`))}
${radek("Pokusy", esc(pokusy.map((p) => `${dt(p.at)} ${p.dovolano ? "dovoláno" : "nedovoláno"}${p.sms ? " + SMS" : ""}`).join("; ")))}
${radek("Upozornění", esc(d.plan.varovani.join("; ")))}
</dl></div>
<div class="card kompakt"><h2>Historie změn mezi exporty</h2>${historieHtml}</div>
</div>
<div class="konec-detailu"></div>
<section class="planovani" id="planovani"><h2>Kam naplánovat <small>${esc(z.idObjednavky || z.idAktivity)} · ${esc(z.zakaznik)}</small></h2>
${sekcePlanovani(d, plan)}</section>`;

  return stranka(z.idObjednavky || z.idAktivity, uzivatel, stav, telo, { dotaz: z.idObjednavky || z.idAktivity });
}

const NAZEV_ZDROJE: Record<Zdroj, string> = { email: "E-mail (koordinace)", kalendar: "Kalendáře techniků", chat: "Google Chat" };

function nalez(n: Nalez): string {
  return `<div class="zaznam${n.veVlakne ? " muted" : ""}"><div class="hl"><b>${esc(n.titulek)}</b>${n.cas ? ` · ${esc(dt(n.cas))}` : ""}${
    n.kdo ? ` · ${esc(n.kdo)}` : ""
  }${n.kde && n.kde !== n.titulek ? ` · ${esc(n.kde)}` : ""}${n.veVlakne ? " · ve vlákně" : ""}${
    n.odkaz ? ` · <a href="${esc(n.odkaz)}" target="_blank" rel="noopener">otevřít</a>` : ""
  }</div>${esc(n.text)}</div>`;
}

/** Nálezy z e-mailu, kalendářů a chatu – každý zdroj vlastní karta, chyba zdroje nezablokuje ostatní */
export function sekceZdroju(zdroje: VysledekZdroje[] | null): string {
  if (!zdroje) return `<div class="card" style="margin-top:12px"><h2>Ostatní zdroje</h2><span class="muted">Hledání v e-mailu, kalendářích a chatu zatím není zapnuté (chybí delegace účtu tmcz01).</span></div>`;
  return `<div class="grid" style="margin-top:12px">${zdroje
    .map((v) => {
      const obsah = v.chyba
        ? `<div class="err">Zdroj nedostupný: ${esc(v.chyba)}</div>`
        : v.nalezy.length
          ? v.nalezy.slice(0, 30).map(nalez).join("") + (v.nalezy.length > 30 ? `<p class="muted">… a dalších ${v.nalezy.length - 30}</p>` : "")
          : `<span class="muted">nic nenalezeno</span>`;
      return `<div class="card"><h2>${esc(NAZEV_ZDROJE[v.zdroj])}${v.nalezy.length ? ` <small class="muted">${v.nalezy.length}</small>` : ""}</h2>${obsah}</div>`;
    })
    .join("")}</div>`;
}

export function strankaChyby(kod: number, zprava: string): string {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${kod} – AppKoo</title><style>${CSS}</style></head>
<body><main><h1>${kod}</h1><p>${esc(zprava)}</p><p><a href="/">Zpět na frontu</a></p></main></body></html>`;
}

// ---------- Plánování termínu ----------


const DNY = ["ne", "po", "út", "st", "čt", "pá", "so"];
const denTydne = (d: Date) => DNY[d.getUTCDay()]!;
const slot = (od: Date, do_: Date) => `${denTydne(od)} ${fmtDate(od)} ${fmtTime(od)}–${fmtTime(do_)}`;

function hlavickaZakazky(d: Detail): string {
  const z = d.z;
  return `<p><a href="/zakazka/${encodeURIComponent(z.idAktivity)}">← ${esc(z.idObjednavky || z.idAktivity)}</a></p>
<h1>Termín pro ${esc(z.idObjednavky || z.idAktivity)} ${infraStitek(z.infrastruktura)} <small>${esc(z.zakaznik)} · ${esc([z.adresa, bezRovna(z.psc)].filter(Boolean).join(", "))} · ${esc(z.typAktivity)}</small></h1>`;
}


function sekcePlanovani(d: Detail, plan: PlanovaniZakazky): string {
  const z = d.z;
  const { brany, nabidka, zapis } = plan;
  const blok = brany.blokace.length
    ? `<div class="err"><b>Termín teď nelze naplánovat:</b><ul>${brany.blokace.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`
    : "";
  const upoz = brany.upozorneni.length ? `<div class="warn">${brany.upozorneni.map(esc).join("<br>")}</div>` : "";
  if (blok) return blok + upoz;
  if (d.uzavreno) return `<div class="warn">Uzavřená zakázka se neplánuje.</div>`;
  if (!nabidka) return `${upoz}<div class="warn">${plan.nedostupne ? "Kalendáře techniků nejsou v této instalaci zapnuté." : "Nabídku se nepodařilo spočítat."}</div>`;

  const info = [
    nabidka.nedostupne.length ? `Kalendář nejde přečíst: ${nabidka.nedostupne.join(", ")}.` : "",
    nabidka.bezZakladny.length ? `Technik bez adresy výjezdu v číselníku: ${nabidka.bezZakladny.join(", ")}.` : "",
    nabidka.bezPolohy ? `${nabidka.bezPolohy} zakázek v kalendářích nemá dohledatelnou adresu – v trasách chybí.` : "",
  ].filter(Boolean);
  const radky = nabidka.moznosti.map((m: MoznostSlotu, i) => {
    const smi = zapis.zapnuty && zapis.smiTechnik(m.technik);
    const q = new URLSearchParams({ k: m.kalendar, e: m.eventId, t: m.technik, od: m.od.toISOString(), do: m.do.toISOString() });
    return `<tr><td>${i + 1}</td><td><b>${esc(slot(m.od, m.do))}</b></td><td>${esc(m.technik)}</td>
<td class="nowrap">+${m.kmNavic.toFixed(1)} km<br><small>den ${m.kmDne.toFixed(0)} km</small></td>
<td>${m.poSla ? `<span class="prio P1">po SLA</span>` : "v SLA"}</td>
<td>${smi ? `<a class="btn" href="/zakazka/${encodeURIComponent(z.idAktivity)}/zapis?${esc(q.toString())}">Vybrat</a>` : `<small class="muted">${zapis.zapnuty ? "zápis pro technika vypnutý" : "zápis vypnutý"}</small>`}</td></tr>`;
  });
  return `${upoz}${nabidka.chyba ? `<div class="err">${esc(nabidka.chyba)}</div>` : ""}
${info.length ? `<div class="warn">${info.map(esc).join("<br>")}</div>` : ""}
<div class="tbl"><table><thead><tr><th>#</th><th>Slot</th><th>Technik</th><th>Km navíc</th><th>Do splnění</th><th></th></tr></thead>
<tbody>${radky.join("") || `<tr><td colspan="6" class="muted">${nabidka.chyba ? "" : "Žádný volný slot v dosahu (max 75 km zajížďky) v příštích 10 pracovních dnech."}</td></tr>`}</tbody></table></div>
<p class="muted">Prohledáno ${nabidka.technikuCelkem} techniků s dovedností pro tento typ zakázky. Pořadí: zaplnění dne, SLA, km navíc oproti trase dne, preferované okno 10–14 h.</p>`;
}

const vyber = (name: string, moznosti: [string, string][], vybrano = "") =>
  `<select name="${name}">${moznosti.map(([v, t]) => `<option value="${esc(v)}"${v === vybrano ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
const ANO_NE: [string, string][] = [["", "?"], ["ano", "ANO"], ["ne", "NE"]];
const ANO_NE_NEVIM: [string, string][] = [["NEVÍM", "NEVÍM"], ["ANO", "ANO"], ["NE", "NE"]];

export interface Presun {
  /** kalendář, událost a technik současného termínu (zakázka s poznámkou „flex“) */
  pk: string;
  pe: string;
  pt: string;
}

const presunPole = (p?: Presun | null) =>
  p ? `<input type="hidden" name="pk" value="${esc(p.pk)}"><input type="hidden" name="pe" value="${esc(p.pe)}"><input type="hidden" name="pt" value="${esc(p.pt)}">` : "";

export function strankaZapisu(
  d: Detail,
  vyb: { k: string; e: string; t: string; od: Date; do: Date; presun?: Presun | null },
  brany: Brany,
  zapisPovolen: boolean,
  stav: StavImportu,
  uzivatel: string,
  chyby: string[] = [],
  hodnoty: URLSearchParams = new URLSearchParams(),
): string {
  const z = d.z;
  const h = (n: string) => esc(hodnoty.get(n) ?? "");
  const form = `<form method="post" action="/zakazka/${encodeURIComponent(z.idAktivity)}/zapis">
<input type="hidden" name="k" value="${esc(vyb.k)}"><input type="hidden" name="e" value="${esc(vyb.e)}"><input type="hidden" name="t" value="${esc(vyb.t)}">
<input type="hidden" name="od" value="${esc(vyb.od.toISOString())}"><input type="hidden" name="do" value="${esc(vyb.do.toISOString())}">${presunPole(vyb.presun)}
<fieldset><legend>Zásuvka a instalace</legend><div class="pole">
<label>Instalace${vyber("instalace", [["nova", "Nová instalace"], ["existujici", "Existující zásuvka"]], hodnoty.get("instalace") ?? "nova")}</label>
<label>Číslo zásuvky / foto<input name="zasuvka" value="${h("zasuvka")}"></label>
<label>IPTV${vyber("iptv", [["ne", "ne"], ["ano", "ano"]], hodnoty.get("iptv") ?? "ne")}</label>
<label>CASEID (SWAP / FIS MOP)<input name="caseid" value="${h("caseid")}"></label>
</div></fieldset>
<fieldset><legend>Byt a trasa</legend><div class="pole">
<label>Patro<input name="patro" value="${h("patro")}"></label>
<label>Byt<input name="byt" value="${h("byt")}"></label>
<label>Patra volně přístupná${vyber("patraPristupna", ANO_NE, hodnoty.get("patraPristupna") ?? "")}</label>
<label>Stoupačka zajištěna${vyber("stoupacka", ANO_NE_NEVIM, hodnoty.get("stoupacka") ?? "NEVÍM")}</label>
<label>Vzdálenost od stoupačky (m)<input name="vzdalenost" inputmode="numeric" value="${h("vzdalenost")}"></label>
<label>Lišty / omezení SVJ${vyber("listy", ANO_NE_NEVIM, hodnoty.get("listy") ?? "NEVÍM")}</label>
<label>Souhlas s vrtáním${vyber("vrtani", ANO_NE, hodnoty.get("vrtani") ?? "")}</label>
</div></fieldset>
<fieldset><legend>Koncové zařízení</legend><div class="pole">
<label>Umístění KZ<input name="umisteni" placeholder="předsíň / obývací pokoj / dle konzultace" value="${h("umisteni")}"></label>
<label>El. zásuvka u KZ${vyber("elZasuvka", ANO_NE, hodnoty.get("elZasuvka") ?? "")}</label>
<label>KZ${vyber("kz", [["", "?"], ["ROUTE", "ROUTE"], ["BRIDGE", "BRIDGE"]], hodnoty.get("kz") ?? "")}</label>
<label>STB<input name="stb" value="${h("stb")}"></label>
<label>Předpojen${vyber("predpojen", ANO_NE, hodnoty.get("predpojen") ?? "")}</label>
<label>PODB (T-Mobile)<input name="podb" value="${h("podb")}"></label>
</div>
<label class="muted" style="display:block;margin-top:8px">Instalační předpis (zkopírovat z ticketu)<textarea name="predpis">${h("predpis")}</textarea></label>
</fieldset>
<fieldset><legend>Potvrzení</legend>
${POVINNA_POTVRZENI.map((p) => `<label class="check"><input type="checkbox" name="${p.pole}" value="ano"${hodnoty.get(p.pole) === "ano" ? " checked" : ""}> ${esc(p.text)}</label>`).join("")}
</fieldset>
<button class="btn"${zapisPovolen ? "" : " disabled"}>Zapsat termín do kalendáře</button>
${zapisPovolen ? "" : `<span class="muted"> Zápis do kalendáře je vypnutý (pilotní režim) – formulář slouží jen k náhledu.</span>`}
</form>`;

  const telo = `${hlavickaZakazky(d)}
<div class="card" style="margin-bottom:12px"><b>${esc(slot(vyb.od, vyb.do))}</b> · technik <b>${esc(vyb.t)}</b> · slot VOLNY se přepíše na zakázku${
    vyb.presun && z.termin ? `<br><b>Přesun</b> z ${esc(slot(z.termin.od, z.termin.do))} (${esc(vyb.presun.pt)}) – původní událost se vrátí na VOLNY` : ""
  }</div>
${chyby.length ? `<div class="err">${chyby.map(esc).join("<br>")}</div>` : ""}
${brany.upozorneni.length ? `<div class="warn">${brany.upozorneni.map(esc).join("<br>")}</div>` : ""}
${form}`;
  return stranka("Zápis termínu", uzivatel, stav, telo);
}

export function strankaZapsano(
  d: Detail,
  technik: string,
  od: Date,
  do_: Date,
  mwf: string,
  odkaz: string | null,
  stav: StavImportu,
  uzivatel: string,
  presun: { ok: boolean; zprava: string } | null = null,
): string {
  const z = d.z;
  const telo = `${hlavickaZakazky(d)}
<div class="ok"><b>Termín zapsán do kalendáře:</b> ${esc(technik)} · ${esc(slot(od, do_))}${odkaz ? ` · <a href="${esc(odkaz)}" target="_blank" rel="noopener">otevřít v kalendáři</a>` : ""}</div>
${presun ? `<div class="${presun.ok ? "ok" : "err"}">${esc(presun.zprava)}</div>` : ""}
<div class="card"><h2>Teď zapište do MWF (Dojednávania)</h2><p class="muted">MWF zůstává hlavní evidencí – zkopírujte řádek a uložte termín v MWF. Po dalším importu aplikace zkontroluje shodu MWF ↔ kalendář.</p>
<pre class="mwf">${esc(mwf)}</pre></div>
<p><a href="/zakazka/${encodeURIComponent(z.idAktivity)}">← Zpět na zakázku</a> · <a href="/technik">Doplnit technika</a></p>`;
  return stranka("Termín zapsán", uzivatel, stav, telo);
}


// ---------- Doplnit technika ----------

const hm = (d: Date) => fmtTime(d);
const DNY_DLOUHE = (iso: string) => DNY[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;

const odkazSlotu = (u: UdalostTechnika, den: string) =>
  `/technik?${new URLSearchParams({ t: u.technik, den, k: u.kalendar, e: u.id, od: u.od.toISOString(), do: u.do.toISOString() })}`;

/** Text události bez jména technika na začátku; O-ID jako odkaz na plánování zakázky */
function textUdalosti(u: UdalostTechnika): string {
  const t = esc(u.summary.replace(/^[^-]+-\s*/, ""));
  return t.replace(/O-\d{6,}/g, (o) => `<a href="/?q=${o}">${o}</a>`);
}

export interface StrankaTechnika {
  technici: TechnikPlanu[];
  technik: TechnikPlanu | null;
  den: string;
  predchozi: string | null;
  dalsi: string;
  /** dny vybraného technika (nahoře) */
  dny: { datum: string; udalosti: UdalostTechnika[] }[];
  /** bez vybraného technika: přehled všech techniků pro den */
  prehled: { dny: DenPrehledu[]; nedostupne: string[] } | null;
  slot: VybranySlot | null;
  navrhy: NavrhySlotu | null;
  chyba?: string;
  zapis: { zapnuty: boolean; smiTechnik: (t: string) => boolean };
}

export function strankaTechnika(s: StrankaTechnika, stav: StavImportu, uzivatel: string): string {
  const volby = s.technici
    .map((t) => `<option value="${esc(t.jmeno)}"${s.technik?.jmeno === t.jmeno ? " selected" : ""}>${esc(t.jmeno)} – ${esc(t.skupiny.join(", "))} · ${esc(t.vyjezd)}</option>`)
    .join("");
  const navT = s.technik ? `&t=${encodeURIComponent(s.technik.jmeno)}` : "";
  const formular = `<form class="filtr" method="get" action="/technik">
<label>Technik<select name="t"><option value="">– všichni (přehled dne) –</option>${volby}</select></label>
<label>Od dne<input type="date" name="den" value="${esc(s.den)}"></label><button>Zobrazit</button>
${s.predchozi ? `<a href="/technik?den=${esc(s.predchozi)}${esc(navT)}">← dřív</a>` : ""} <a href="/technik?den=${esc(s.dalsi)}${esc(navT)}">dál →</a>
</form>`;

  let horni = "";
  if (s.technik) {
    const t = s.technik;
    horni = `<h1>${esc(t.jmeno)} <small>${esc(t.skupiny.join(", "))} · výjezd ${esc(t.vyjezd)}${t.vyjezd2 ? ` / ${esc(t.vyjezd2)}` : ""}</small></h1>
${s.chyba ? `<div class="err">${esc(s.chyba)}</div>` : ""}
<div class="tyden">${s.dny
      .map((d) => {
        const zak = d.udalosti.filter((u) => !jeVolneOkno(u));
        const obsah = d.udalosti
          .map((u) =>
            jeVolneOkno(u)
              ? `<a class="volny${s.slot?.eventId === u.id ? " vyb" : ""}" href="${esc(odkazSlotu(u, s.den))}">${esc(hm(u.od))}–${esc(hm(u.do))} volno → doplnit</a>`
              : `<div class="ud"><span class="cas">${esc(hm(u.od))}–${esc(hm(u.do))}</span>${textUdalosti(u)}</div>`,
          )
          .join("");
        return `<div class="card"><h3>${esc(DNY_DLOUHE(d.datum))} ${esc(fmtDate(d.datum))} <small class="muted">· ${zak.length} ${zak.length === 1 ? "událost" : "událostí"}</small></h3>${obsah || `<span class="muted">prázdný den</span>`}</div>`;
      })
      .join("")}</div>`;
  } else if (s.prehled) {
    const radky = s.prehled.dny.map((d) => {
      const zak = d.zakazky.map((u) => `<div><small>${esc(hm(u.od))}–${esc(hm(u.do))}</small> ${textUdalosti(u)}</div>`).join("");
      const volne = d.volne.map((u) => `<a class="volny" style="display:inline-block" href="${esc(odkazSlotu(u, s.den))}">${esc(hm(u.od))}–${esc(hm(u.do))} doplnit</a>`).join(" ");
      return `<tr><td><a href="/technik?t=${encodeURIComponent(d.technik.jmeno)}&den=${esc(s.den)}"><b>${esc(d.technik.jmeno)}</b></a><br><small class="muted">${esc(d.technik.skupiny.join(", "))}</small></td>
<td class="nowrap">${d.zakazky.length}</td><td>${zak || `<span class="muted">prázdný den</span>`}</td><td>${volne || `<span class="muted">bez volného slotu</span>`}</td></tr>`;
    });
    horni = `<h1>Doplnit technika <small>přehled ${esc(DNY_DLOUHE(s.den))} ${esc(fmtDate(s.den))} – od nejméně vytížených</small></h1>
${s.prehled.nedostupne.length ? `<div class="warn">Kalendář nejde přečíst: ${esc(s.prehled.nedostupne.join(", "))}.</div>` : ""}
<div class="tbl"><table><thead><tr><th>Technik</th><th>Zakázek</th><th>Den</th><th>Volné sloty</th></tr></thead>
<tbody>${radky.join("") || `<tr><td colspan="4" class="muted">Žádný technik s čitelným kalendářem (zkontrolujte číselník Technici).</td></tr>`}</tbody></table></div>`;
  }

  const dolni = s.slot && s.navrhy ? sekceNavrhu(s.slot, s.navrhy, s.zapis) : s.technik ? `<p class="muted">Vyberte nahoře volný slot (zelený) – dole se nabídnou zakázky, které ho nejlépe doplní.</p>` : "";
  return stranka("Doplnit technika", uzivatel, stav, `${formular}${horni}${dolni}`, { zalozka: "technik" });
}

function sekceNavrhu(vyb: VybranySlot, v: NavrhySlotu, zapis: { zapnuty: boolean; smiTechnik: (t: string) => boolean }): string {
  const smi = zapis.zapnuty && zapis.smiTechnik(vyb.technik.jmeno);
  const radky = v.navrhy.map((n, i) => {
    const z = n.kandidat.z;
    const q = new URLSearchParams({ k: vyb.technik.kalendar, e: vyb.eventId, t: vyb.technik.jmeno, od: vyb.od.toISOString(), do: vyb.do.toISOString() });
    const p = n.kandidat.presun;
    if (p) {
      q.set("pk", p.kalendar);
      q.set("pe", p.eventId);
      q.set("pt", p.technik);
    }
    const smiZde = smi && (!p || zapis.smiTechnik(p.technik));
    return `<tr><td>${i + 1}</td>
<td class="oid"><a href="/zakazka/${encodeURIComponent(z.idAktivity)}">${esc(z.idObjednavky || z.idAktivity)}</a>${bezRovna(z.idS7) ? `<br><small>${esc(bezRovna(z.idS7))}</small>` : ""}</td>
<td>${infraStitek(z.infrastruktura)}</td>
<td>${esc(z.zakaznik)}<br><small>${esc([z.adresa, bezRovna(z.psc)].filter(Boolean).join(", "))}</small></td>
<td><span class="prio ${n.kandidat.priorita}">${n.kandidat.priorita}</span></td>
<td class="nowrap">${n.kandidat.slaKonec ? esc(dt(n.kandidat.slaKonec)) : ""}${n.poSla ? `<br><span class="prio P1">po SLA</span>` : ""}</td>
<td class="nowrap">+${n.kmNavic.toFixed(1)} km<br><small>den ${n.kmDne.toFixed(0)} km</small></td>
<td>${esc(n.duvody.join(", "))}${p ? `<br><small>teď ${esc(`${denTydne(p.od)} ${fmtDate(p.od)} ${fmtTime(p.od)}`)} · ${esc(p.technik)}</small>` : ""}</td>
<td>${smiZde ? `<a class="btn" href="/zakazka/${encodeURIComponent(z.idAktivity)}/zapis?${esc(q.toString())}">Vybrat</a>` : `<small class="muted">${zapis.zapnuty ? "zápis pro technika vypnutý" : "zápis vypnutý"}</small>`}</td></tr>`;
  });
  const info = [
    v.nedostupne.length ? `Kalendář nejde přečíst (flex zakázky tam nejsou vidět): ${v.nedostupne.join(", ")}.` : "",
    v.bezPolohy ? `${v.bezPolohy} kandidátů nemá adresu dohledatelnou na mapě.` : "",
    v.bezPolohyVeDni ? `${v.bezPolohyVeDni} zakázek ve dni technika nemá dohledatelnou adresu – v trase chybí.` : "",
  ].filter(Boolean);
  return `<h2 class="sekce">Zakázky do slotu ${esc(slot(vyb.od, vyb.do))} · ${esc(vyb.technik.jmeno)}</h2>
${v.chyba ? `<div class="err">${esc(v.chyba)}</div>` : ""}
${info.length ? `<div class="warn">${info.map(esc).join("<br>")}</div>` : ""}
<div class="tbl"><table><thead><tr><th>#</th><th>ID obj. v ext. systému / ID S7 obj.</th><th>P17: Vlastník sítě</th><th>Zákazník / Adresa</th><th>Priorita</th><th>Do splnění</th><th>Km navíc</th><th>Proč</th><th></th></tr></thead>
<tbody>${radky.join("") || `<tr><td colspan="9" class="muted">${v.chyba ? "" : "Žádná vhodná zakázka v dosahu (max 75 km zajížďky)."}</td></tr>`}</tbody></table></div>
<p class="muted">Kandidátů ${v.kandidatu} (z toho flex k přesunu ${v.flex}). Pořadí: naléhavost SLA a priorita, pak km navíc oproti trase dne. Zákazníkovi je vždy potřeba zavolat a termín potvrdit.</p>`;
}
