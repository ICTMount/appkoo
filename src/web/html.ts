// HTML stránky webového rozhraní (vykreslují se na serveru, bez JavaScriptu na klientu).
// Zakázka se vždy označuje ID O- (ID obj. v ext. systému); S7 je doplňkové.

import { addDays, fmtDate, fmtTime, isoDate } from "../domain/time.js";
import { kVytvoreni, radekPriebehu } from "../ingest/priebeh.js";
import type { Priorita } from "../domain/priorita.js";
import type { Detail, PolozkaFronty, StavImportu } from "./data.js";
import { pokusyZakazky } from "./data.js";
import type { Brany, DenPrehledu, MoznostSlotu, Nabidka, NavrhySlotu, TechnikPlanu, VybranySlot } from "../plan/planovac.js";
import { jeVolneOkno, jeVyhrazeneVolno, vytizeniDne, type UdalostTechnika, type VytizeniDne } from "../gcal/kontrola.js";
import { POVINNA_POTVRZENI, type IruLokalita } from "./planovani.js";
import type { Nalez, NalezLokality, VysledekZdroje, Zdroj } from "../zdroje/hledani.js";
import { webcalendar, type Webcalendar } from "../domain/webcalendar.js";
import { migrace, zasuvkaUsed, type Migrace } from "../domain/migrace.js";
import type { Zaznam } from "../import/notes.js";

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
.card h2{font-size:14px;margin:0 0 8px}.predobj{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.03em;padding:1px 6px;border-radius:4px;background:#7b1fa2;color:#fff;vertical-align:middle;margin-top:4px}.predobj-pruh{border-left:4px solid #7b1fa2}.webcal{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.03em;padding:1px 6px;border-radius:4px;background:#00796b;color:#fff;vertical-align:middle;margin-top:4px}.webcal-pruh{border-left:4px solid #00796b}.migrace{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.03em;padding:1px 6px;border-radius:4px;background:#c62828;color:#fff;vertical-align:middle;margin-top:4px}.migrace-pruh{border-left:4px solid #c62828}.used{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.03em;padding:1px 6px;border-radius:4px;background:#ef6c00;color:#fff;vertical-align:middle;margin-top:4px}.used-pruh{border-left:4px solid #ef6c00}.iru{display:inline-block;padding:2px 8px;border-radius:6px;background:rgba(123,31,162,.10);border-left:3px solid #7b1fa2}.webcal-pruh .btn{margin-left:8px}
.termin-box{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.termin-box ul{margin:6px 0 0}
a.btn.velke{font-size:15px;padding:10px 18px;font-weight:700}tr.na-dohodnuty td{background:rgba(0,121,107,.12)}h2.s-ikonou{display:flex;align-items:center;gap:6px}h2.s-ikonou small{margin-left:2px}.ikona{flex:none;display:block}.i-email{color:#d93025}.i-kalendar{color:#1a73e8}.i-chat{color:#188038}.i-drive{color:#f9ab00}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0}dt{color:var(--muted)}dd{margin:0}
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
.gc-karta{max-width:860px;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.10);padding:18px 22px 16px}
.gc-hlava{display:flex;gap:14px;align-items:flex-start;margin-bottom:14px}.gc-barva{flex:none;width:16px;height:16px;border-radius:4px;background:#795548;margin-top:9px}
.gc-nadpis{font-size:22px;font-weight:400;line-height:1.25}.gc-kdy{color:var(--muted);font-size:14px;margin-top:4px}
.gc-blok{display:flex;gap:14px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line)}.gc-blok>.gc-ikona{flex:none;width:20px;height:20px;color:var(--muted);margin-top:2px}.gc-blok>.gc-ikona svg{width:20px;height:20px}
.gc-misto{font-size:14px;padding-top:2px}.gc-popis{flex:1;min-width:0;font-size:13.5px;line-height:1.9}
.gc-radek{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px}.gc-stitek{font-weight:600;letter-spacing:.01em}.gc-mezi{color:var(--text)}
.gc-radek{padding:3px 8px;margin:2px 0;border-radius:6px;border-left:3px solid transparent}
.gc-povinne{background:var(--warn-bg,#fff4d6);border-left-color:#e65100}.gc-povinne .gc-stitek{color:#e65100}.gc-povinne input,.gc-povinne select{border:1px solid #e65100;background:var(--panel)}
.gc-volitelne{color:var(--muted);border-left-color:var(--line)}.gc-volitelne .gc-stitek{font-weight:500;color:var(--muted)}.gc-volitelne input,.gc-volitelne select{border:1px solid var(--line);background:var(--panel)}
.gc-vedlejsi{font-size:12px;color:var(--muted);line-height:1.6}.gcal input.gc-ram{border:1px solid #e65100;background:var(--panel);padding:4px 8px}
.gc-flex label.volba{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel);font-size:13px;cursor:pointer}.gc-flex label.volba small{color:var(--muted)}.gc-flex label.volba:has(input:checked){border-color:#e65100;background:#e65100;color:#fff}.gc-flex label.volba:has(input:checked) small{color:#ffe0c2}.gc-flex input[type=radio]{margin:0;accent-color:#e65100}.gc-vedlejsi .gc-stitek{font-weight:500;color:var(--muted)}
.gcal input,.gcal select{padding:2px 6px;font-size:13px;border-radius:4px;background:transparent;border:1px solid transparent;border-bottom:1px solid var(--line)}
.gcal input:hover,.gcal select:hover,.gcal input:focus,.gcal select:focus{border-color:var(--line);background:var(--panel)}
.gc-predpis{align-items:flex-start;flex-direction:column;margin-top:6px}.gc-predpis textarea{min-height:140px;font-size:13px;line-height:1.5}
.gc-pata{padding-top:12px;border-top:1px solid var(--line);display:flex;align-items:center;gap:10px}
.zapis-dva{display:grid;grid-template-columns:minmax(0,860px) minmax(320px,1fr);gap:16px;align-items:start}@media (max-width:1100px){.zapis-dva{grid-template-columns:1fr}}
.gc-nestd{margin:-4px 0 10px;padding:6px 10px;border:1px dashed var(--line);border-radius:8px}.gc-nestd .gc-nestd-pole{display:none;margin-top:8px}.gc-nestd:has(input[name=nestandard]:checked){border:2px solid #c62828;background:rgba(198,40,40,.06)}.gc-nestd:has(input[name=nestandard]:checked) .gc-nestd-pole{display:block}
.gc-nestd label{display:block}.gc-nestd .gc-nestd-pole input[name=nadpis]{width:100%;border:1px solid #c62828;background:var(--panel);font-size:14px;padding:6px 8px}.gc-nestd .gc-nestd-pole input[name^=cas]{border:1px solid #c62828;background:var(--panel)}
.gc-den{background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.08);padding:14px 16px;margin-bottom:14px}.gc-den h2{font-size:15px;font-weight:600;margin:0 0 10px}
.gc-ud{display:flex;gap:10px;padding:6px 0;border-top:1px solid var(--line);font-size:13px}.gc-ud:first-of-type{border-top:0}.gc-cas{flex:none;width:44px;font-size:12px;line-height:1.3;color:var(--text)}.gc-den:last-child .gc-cas{width:78px}.gc-ud.stejny-den .gc-cas b{color:var(--accent)}
.gc-tel{flex:1;display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-radius:8px;background:rgba(121,85,72,.10);border-left:4px solid #795548}.gc-tel .gc-barva{display:none}
.gc-ud.volny .gc-tel{background:rgba(46,157,75,.12);border-left-color:#2e9d4b}iframe.trasa-mapa{height:300px}.legenda{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.7}.legenda .zast.tato{color:var(--accent);font-weight:700}
.poradi{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#795548;color:#fff;font-size:12px;font-weight:700;margin-right:6px;vertical-align:middle}.poradi.tato{background:var(--accent)}.gc-ud.tato .gc-tel{background:rgba(31,95,191,.14);border-left-color:var(--accent);outline:2px solid var(--accent)}.gcal label.check{display:block;padding:2px 0}
.pole label{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--muted)}
.pole input,.pole select,textarea{color:var(--text)}textarea{width:100%;min-height:90px;font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel)}
.check{display:flex;gap:8px;align-items:flex-start;margin:6px 0}
pre.mwf{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px;font-size:15px;user-select:all;white-space:pre-wrap}
header{display:block;padding:0;position:sticky;top:0;z-index:5}
header .lista{display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:start;padding:10px 20px}
header .vlevo{justify-self:start}header .logo{font-size:20px}
header .stred{display:flex;flex-direction:column;align-items:center;gap:8px}header .stred .export{align-items:center;text-align:center;font-size:12px;color:var(--muted)}
@media (max-width:760px){header .lista{grid-template-columns:1fr}header .vlevo,header .stred,header .vpravo{justify-self:stretch;align-items:flex-start}}
nav.zalozky{display:flex;gap:8px;justify-content:flex-start;padding:4px 20px 10px}nav.zalozky a{font-size:15px;padding:8px 22px}nav.zalozky a{padding:7px 14px;border-radius:6px;color:var(--text);font-weight:600}
nav.zalozky a.on{background:var(--accent);color:#fff}nav.zalozky a:hover{text-decoration:none;background:var(--line)}nav.zalozky a.on:hover{background:var(--accent)}
header .vpravo{justify-self:end;display:flex;flex-direction:column;align-items:flex-end;gap:5px;font-size:12px;color:var(--muted)}
header .kdo{color:var(--text)}a.konfig{font-size:12px;font-weight:600}a.konfig.on{text-decoration:underline}
.export{display:flex;flex-direction:column;gap:3px;min-width:230px}.export b{color:var(--text)}.export .soubor{font-size:11px;color:var(--muted);max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{position:relative;align-self:stretch;width:100%;height:6px;border-radius:3px;margin-top:3px;background:linear-gradient(90deg,#2e9d4b 0%,#2e9d4b 20%,#e08a00 37%,#d32f2f 55%,#d32f2f 100%)}.bar span{position:absolute;top:-3px;width:4px;height:12px;margin-left:-2px;border-radius:2px;background:var(--text);box-shadow:0 0 0 2px var(--bg)}
.b-zel{background:#2e9d4b}.b-oranz{background:#e08a00}.b-cerv{background:#d32f2f}
.c-zel{color:#2e9d4b;font-weight:600}.c-oranz{color:#e08a00;font-weight:600}.c-cerv{color:#d32f2f;font-weight:600}
form.hledani{display:flex;gap:8px;padding:8px 20px;border-top:1px solid var(--line)}form.hledani .pole-hledani{flex:1;position:relative;display:flex}form.hledani input{flex:1;font-size:15px;padding:8px 36px 8px 10px}
form.hledani input::-webkit-search-cancel-button{display:none}
form.hledani .pole-hledani input:placeholder-shown~button.zrusit{display:none}form.hledani .zrusit{position:absolute;border:0;padding:0;cursor:pointer;right:6px;top:50%;transform:translateY(-50%);width:26px;height:26px;line-height:24px;text-align:center;border-radius:50%;font-size:20px;color:var(--muted);background:var(--panel)}form.hledani .zrusit:hover{text-decoration:none;color:var(--text);background:var(--line)}
.infra{display:inline-block;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;border:1px solid currentColor;vertical-align:middle;white-space:nowrap}
.i-TMCZ{color:#d1006b}.i-CETIN{color:#1769c2}.i-VDF{color:#d10000}.i-jin{color:var(--muted)}

h2.sekce{font-size:17px;margin:22px 0 10px;padding-top:14px;border-top:2px solid var(--line)}
.card.scroll{max-height:360px;overflow:auto}
.tyden{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px}
.tyden .card{padding:10px}.tyden h3{font-size:13px;margin:0 0 6px}
.ud{font-size:12px;padding:4px 0;border-top:1px solid var(--line)}.ud:first-of-type{border-top:0}.ud .cas{color:var(--muted);margin-right:4px}
a.volny{display:block;font-size:12px;padding:5px 8px;margin:4px 0;border-radius:6px;background:#e6f4ea;color:#1e5e2e;font-weight:600}
a.volny.vyb{outline:2px solid var(--accent)}
.vytizeni{display:flex;align-items:center;gap:6px;margin-top:4px;white-space:nowrap}.vytizeni .pruh{display:inline-flex;gap:2px}.vytizeni i{display:inline-block;width:14px;height:8px;border-radius:2px}
.vytizeni .d-volno{background:#2e9d4b}.vytizeni .d-obsazeno{background:#8a8a85}.vytizeni .d-blok{background:repeating-linear-gradient(45deg,#8a8a85 0 2px,transparent 2px 4px)}.vytizeni .d-vyhrazeno{background:#2e9d4b;opacity:.35}
.vytizeni .d-navrh{outline:2px solid var(--accent);outline-offset:1px}.vytizeni small{font-size:11px;color:var(--muted)}.vytizeni small b{color:var(--text)}
.vyhrazeny{font-size:12px;padding:5px 8px;margin:4px 0;border-radius:6px;border:1px dashed var(--line);color:var(--muted)}
.card.kompakt{padding:8px 12px;font-size:12px;min-width:0;overflow:hidden}.posun{overflow-x:auto;max-height:210px;overflow-y:auto}.posun.zdroj{max-height:340px}.posun.maly{max-height:120px}
.notif dl{grid-template-columns:max-content 1fr}.notif .predpis{margin:0 0 6px;padding:0;list-style:none}.notif .predpis li{padding:1px 0;border-bottom:1px dotted var(--border, #e3e3e3)}.notif .predpis li:last-child{border:0}.notif h3{font-size:11px;margin:6px 0 2px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.grid>*{min-width:0}.grid.tretiny{grid-template-columns:1fr 1fr 1fr}.sloupec{display:flex;flex-direction:column;gap:12px;min-width:0}@media (max-width:900px){.grid.tretiny{grid-template-columns:1fr}}.card.kompakt h2{font-size:12px;margin-bottom:4px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.card.kompakt dl{gap:2px 10px}
.konec-detailu{margin:26px 0 18px;border-top:3px double var(--line)}
section.planovani{border:2px solid var(--accent);border-radius:10px;padding:14px 16px 6px;background:color-mix(in srgb,var(--accent) 6%,var(--panel));box-shadow:0 2px 10px rgba(0,0,0,.06)}
section.planovani>h2{font-size:20px;margin:0 0 12px;color:var(--accent)}section.planovani>h2 small{font-size:13px;color:var(--muted);font-weight:400}
section.planovani .tbl{border-color:var(--accent)}
iframe.mapa{width:100%;height:220px;border:1px solid var(--line);border-radius:6px;margin:8px 0}
table.male{font-size:12px}table.male th,table.male td{padding:3px 6px}details summary{cursor:pointer;margin-top:6px}
form.terminy{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}form.terminy label{display:flex;gap:6px;align-items:center}
.jiny-cas{margin-top:6px;font-size:12px;color:var(--muted)}.jiny-cas a{font-weight:600}
.trasa{margin-top:6px;font-size:12px;border-left:2px solid var(--line);padding-left:8px}.soused{padding:1px 0;color:var(--muted)}
.soused .smer{display:inline-block;min-width:42px}.soused b{color:var(--text);font-weight:600}.soused .km{white-space:nowrap;font-weight:600;color:var(--text)}
.soused.zakl{font-style:italic}.soused .km.dlouhy{color:var(--p1)}.soused.tato{color:var(--accent);font-weight:600}
.mc{display:inline-block;font-size:11px;font-weight:600;padding:0 6px;margin-left:4px;border-radius:4px;background:var(--line);color:var(--text);white-space:nowrap}
.adr{color:var(--muted)}.pozn{font-size:12px;margin-top:4px;padding-left:6px;border-left:2px solid var(--line);color:var(--muted);max-width:520px}.pozn b{color:var(--text);font-weight:600}a.volny.radek{display:block;margin:3px 0}a.volny .cas{margin-right:4px}
form.vyber-tech{display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap;margin-bottom:18px}
form.vyber-tech .pole{display:flex;flex-direction:column;gap:6px}
form.vyber-tech .pole label{display:flex;flex-direction:row;align-items:center;gap:4px;white-space:nowrap;font-size:12px;color:var(--muted);height:18px;line-height:18px}form.vyber-tech label b{color:var(--text)}
form.vyber-tech select,form.vyber-tech input,form.vyber-tech button{height:38px;box-sizing:border-box}form.vyber-tech select{min-width:320px}
form.vyber-tech label.chk{display:flex;align-items:center;gap:8px;height:38px;font-size:14px;color:var(--text);line-height:normal}form.vyber-tech .pole small{max-width:260px}form.vyber-tech .radek{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.rychle{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}.rychle a{padding:4px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--text)}
.rychle a.on{border-color:var(--accent);background:var(--accent);color:#fff}.rychle a:hover{text-decoration:none}
form.filtr label b{color:var(--text);margin-left:4px}
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
const ZDROJ_EXPORTU: Record<string, string> = { email: "e-mail", drive: "Google Drive", upload: "nahráno v aplikaci", cli: "ruční import" };

export function cerstvost(stav: StavImportu): string {
  const h = stav.stariHodin;
  const trida = h === null || h > 2 ? "cerv" : h > 1 ? "oranz" : "zel";
  // ukazatel na škále 0–4 h: zelená do 1 h, oranžová do 2 h, pak červená
  const sirka = h === null ? 98 : Math.min(98, Math.max(2, (h / 4) * 100));
  const popis = h === null ? "zatím žádný export" : `před ${String(h).replace(".", ",")} h`;
  const zdroj = stav.zdroj ? `${ZDROJ_EXPORTU[stav.zdroj] ?? stav.zdroj}${stav.odesilatel ? ` (${stav.odesilatel})` : ""}` : "";
  const nazev = stav.soubor?.replace(/^.*[\\/]/, "") ?? "";
  return `<div class="export"><div>Export MWF <b>${esc(dt(stav.posledniExport) || "–")}</b> · <span class="c-${trida}">${esc(popis)}</span></div>${
    nazev || zdroj ? `<div class="soubor" title="${esc(nazev)}">${esc(nazev)}${nazev && zdroj ? " · " : ""}${zdroj ? `zdroj: ${esc(zdroj)}` : ""}</div>` : ""
  }<div class="bar" title="do 1 h zelená, do 2 h oranžová, přes 2 h červená"><span class="b-${trida}" style="left:${sirka.toFixed(0)}%"></span></div></div>`;
}

/** Městská část k adrese („Praha 4 – Krč“) – mapa adresa → část připravená serverem */
export type Casti = Map<string, string>;
const mc = (adresa: string | undefined | null, casti?: Casti) => {
  const c = adresa ? casti?.get(adresa) : undefined;
  return c ? ` <span class="mc">${esc(c)}</span>` : "";
};
const adresaZakazky = (z: { adresa: string; psc: string }) => [z.adresa, bezRovna(z.psc)].filter(Boolean).join(", ");

/** Vlastník infrastruktury (TMCZ / CETIN / VDF) – štítek všude, kde je zakázka */
/** ID S7 obj.; předobjednávka ho nemá – místo něj typ aktivity (Predobjednavka_FTTH) */
const s7 = (z: { idS7: string; predobjednavka?: boolean; typAktivity: string }) => bezRovna(z.idS7) || (z.predobjednavka ? z.typAktivity || "Predobjednavka_FTTH" : "");

/** Předobjednávka (Typ aktivity Predobjednavka_*) – realizovat až po změně na standardní zakázku */
export const predobjStitek = (z: { predobjednavka?: boolean }) =>
  z.predobjednavka ? ` <span class="predobj" title="Předobjednávka – termín lze naplánovat, realizace až po změně na standardní zakázku v MWF">PŘEDOBJEDNÁVKA</span>` : "";
/** Zakázka z webového kalendáře – přišla už s termínem, který si zákazník vybral sám */
export const webcalStitek = (z: { zaznamy?: Zaznam[] }) =>
  webcalendar(z) ? ` <span class="webcal" title="Webcalendar – zákazník si termín vybral sám, zakázka přišla s dohodnutým termínem">WEBCALENDAR</span>` : "";
/** SWAP / FIS MOP – migrace s tvrdým pravidlem termínu (zlatá pravidla 4 a 5) */
export const migraceStitek = (z: Parameters<typeof migrace>[0]) => {
  const m = migrace(z);
  return m ? ` <span class="migrace" title="${m.typ === "SWAP" ? "SWAP migrace – instalace do 7 dní od CASEID, jinak zákazník bez internetu" : "FIS MOP – termín instalace nesmí být před datem portace"}">${m.typ}</span>` : "";
};
/** Obsazená zásuvka (USED) – neplánovat, čeká se na PEP */
export const usedStitek = (z: Parameters<typeof zasuvkaUsed>[0]) =>
  zasuvkaUsed(z) ? ` <span class="used" title="Zásuvka USED / obsazená – termín neplánovat, dokud PEP nepotvrdí uvolnění">ZÁSUVKA USED</span>` : "";
function pruhUsed(u: NonNullable<ReturnType<typeof zasuvkaUsed>>): string {
  return `<div class="warn used-pruh"><b>Zásuvka USED / obsazená</b>${u.at ? ` (zápis ${esc(fmtDate(u.at))})` : ""} – <b>termín neplánovat</b>, dokud PEP nepotvrdí datum uvolnění (parkování r_2 / r_3, PEP linka 4000 volba 6).<br><span class="muted">${esc(u.text)}</span></div>`;
}
function pruhMigrace(m: Migrace, now: Date): string {
  const caseId = m.caseId ? ` CASEID <b>${esc(m.caseId)}</b>` : "";
  if (m.typ === "SWAP") {
    const lhuta = m.nejpozdeji
      ? ` – CASEID z ${esc(fmtDate(m.od!))}, instalace <b>nejpozději ${esc(fmtDate(m.nejpozdeji))}</b>${m.nejpozdeji.getTime() < now.getTime() ? ` <b class="c-cerv">(lhůta uplynula)</b>` : ""}`
      : "";
    return `<div class="err migrace-pruh"><b>SWAP migrace</b>${caseId}${lhuta}. Instalace <b>do 7 dní od CASEID</b>, jinak je zákazník bez internetu. (Hnízdilovej 603 602 634)</div>`;
  }
  const portace = m.portace ? ` Datum portace <b>${esc(fmtDate(m.portace))}</b> – termín <b>až po něm</b>.` : ` Datum portace v poznámce nenalezeno – ověřte v ticketu.`;
  return `<div class="err migrace-pruh"><b>FIS MOP</b>${caseId} – termín instalace <b>nesmí být před datem portace</b>.${portace}</div>`;
}
/** Výrazný pruh u zakázky z webcalendar: termín si vybral zákazník, je jen v MWF – je potřeba ho zapsat do GCAL */
function pruhWebcal(w: NonNullable<PlanovaniZakazky["webcal"]>, idAktivity: string, bezTlacitka = false): string {
  const kdy = `${fmtDate(w.at)} ${fmtTime(w.at)}`;
  const termin = w.termin ? ` <b>${esc(w.termin)}</b>` : "";
  if (w.vKalendari) {
    return `<div class="warn webcal-pruh"><b>WEBCALENDAR</b> – původní termín${termin} (${esc(kdy)}). V kalendáři je zapsaný u <b>${esc(w.vKalendari.technik)}</b> ${esc(`${fmtDate(w.vKalendari.od)} ${fmtTime(w.vKalendari.od)}–${fmtTime(w.vKalendari.do)}`)}.</div>`;
  }
  return `<div class="warn webcal-pruh"><b>WEBCALENDAR</b> – zákazník si sám vybral termín${termin} (${esc(kdy)}). Termín je <b>jen v MWF, v kalendáři technika chybí</b> – zapište ho do GCAL na dohodnutý, nebo náhradní termín.${bezTlacitka ? "" : `<a class="btn" href="/zakazka/${encodeURIComponent(idAktivity)}#planovani">Doplánovat do GCAL ↓</a>`}</div>`;
}

/** Sloupec P17: vlastník sítě a pod ním štítky předobjednávky / webcalendar */
const p17Bunka = (z: { infrastruktura: string; predobjednavka?: boolean; zaznamy?: Zaznam[]; poznamka?: string; uvodPoznamky?: string }) =>
  `${infraStitek(z.infrastruktura)}${z.predobjednavka ? `<br>${predobjStitek(z).trim()}` : ""}${webcalendar(z) ? `<br>${webcalStitek(z).trim()}` : ""}${migrace(z) ? `<br>${migraceStitek(z).trim()}` : ""}${zasuvkaUsed(z) ? `<br>${usedStitek(z).trim()}` : ""}`;

/** Buňka ID v seznamech: O-ID (+ předobjednávka), pod tím malým písmem ID S7 obj. a u předobjednávky RFS */
const idBunka = (z: { idAktivity: string; idObjednavky: string; idS7: string; predobjednavka?: boolean; typAktivity: string; rfs?: Date | null }) =>
  `<a href="/zakazka/${encodeURIComponent(z.idAktivity)}">${esc(z.idObjednavky || z.idAktivity)}</a>${s7(z) ? `<br><small>${esc(s7(z))}</small>` : ""}${
    z.predobjednavka && z.rfs ? `<br><small>RFS ${esc(den(z.rfs))}</small>` : ""
  }`;

/** Priority P1–P0 v UI: vypnuté do odvolání (Nastavení plánování → pouzivatPriority); nastavuje server při každém požadavku */
let prioritySvisible = false;
export function nastavZobrazeniPriorit(zap: boolean) {
  prioritySvisible = zap;
}
const prio = (p: string) => (prioritySvisible ? `<span class="prio ${esc(p)}">${esc(p)}</span>` : "");
const prioTh = () => (prioritySvisible ? "<th>Priorita</th>" : "");
const prioTd = (p: string) => (prioritySvisible ? `<td>${prio(p)}</td>` : "");

/** Vytížení technika v den: proužek slotů podle času (zelená = volno, šedá = obsazeno) a % obsazení */
export function barVytizeni(v: VytizeniDne, zvyraznit?: string): string {
  if (!v.dilky.length) return `<div class="vytizeni"><span class="muted">bez slotů</span></div>`;
  const POPIS = { volno: "volno", obsazeno: "obsazeno", blok: "blokováno", vyhrazeno: "VOLNY sz – vyhrazeno" } as const;
  const dilky = v.dilky
    .map((d) => `<i class="d-${d.stav}${d.id === zvyraznit ? " d-navrh" : ""}" title="${esc(`${fmtTime(d.od)}–${fmtTime(d.do)} ${POPIS[d.stav]}${d.id === zvyraznit ? " · navržený slot" : ""}`)}"></i>`)
    .join("");
  const pct = v.procento === null ? "" : `<b>${v.procento} %</b> obsazeno · ${v.obsazenych}/${v.obsazenych + v.volnych}`;
  return `<div class="vytizeni"><span class="pruh">${dilky}</span><small>${pct}</small></div>`;
}

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
<nav class="zalozky"><a href="/" class="${zal === "zakazka" ? "on" : ""}">Plánovat zakázku</a><!--doplnit:${zal === "technik" ? "on" : "off"}--></nav>
<form class="hledani" action="/" method="get"><span class="pole-hledani"><input type="search" name="q" value="${esc(o.dotaz ?? "")}" placeholder="O-ID, S7, telefon, příjmení nebo adresa zakázky" aria-label="Najít zakázku" autocomplete="off">${
    o.dotaz
      ? `<a class="zrusit" href="/" title="Zrušit hledání" aria-label="Zrušit hledání">×</a>`
      : `<button type="reset" class="zrusit" title="Vymazat" aria-label="Vymazat hledání">×</button>`
  }</span><button>Najít a plánovat</button></form></header>
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
  polozky: { z: PolozkaFronty["z"]; priorita: Priorita; uzavreno?: Date | null }[],
  zdroje: VysledekZdroje[] | null,
  stav: StavImportu,
  uzivatel: string,
  casti?: Casti,
): string {
  const radky = polozky.map(
    ({ z, priorita, uzavreno }) => `<tr${uzavreno ? ` class="muted"` : ""}><td class="oid">${idBunka(z)}</td>
<td>${p17Bunka(z)}</td><td>${esc(z.zakaznik)}<br><small>${esc(adresaZakazky(z))}</small>${mc(adresaZakazky(z), casti)}</td>
<td>${esc(z.typAktivity)}</td><td>${uzavreno ? `<b>uzavřená</b> ${esc(dt(uzavreno))}<br>` : ""}${esc(z.stavMwf)}${z.termin ? `<br><small>termín ${esc(dt(z.termin.od))}</small>` : ""}</td>${prioTd(priorita)}</tr>`,
  );
  const telo = `<h1>Hledání „${esc(dotaz)}“ <small>${polozky.length} zakázek</small></h1>
<div class="tbl"><table><thead><tr><th>ID obj. v ext. systému / ID S7 obj.</th><th>P17: Vlastník sítě</th><th>Zákazník / Adresa</th><th>Typ aktivity</th><th>Stav</th>${prioTh()}</tr></thead>
<tbody>${radky.join("") || `<tr><td colspan="6" class="muted">V zakázkách MWF (otevřených i uzavřených) nic. Zkuste celé O-ID (O-8553361721), S7, telefon nebo příjmení.</td></tr>`}</tbody></table></div>
${sekceZdroju(zdroje)}`;
  return stranka("Hledání", uzivatel, stav, telo, { dotaz });
}

/** Výpis z notifikačního PDF z MWF: „Inštalačný predpis k“ celý, ze „Zoznam KZ“ jen CPE Mode a kompatibilní zařízení */
export function sekceNotifikace(n: Detail["notifikace"]): string {
  const odkaz = n ? `<a href="https://drive.google.com/file/d/${encodeURIComponent(n.souborId)}/view" target="_blank" rel="noopener">PDF</a>` : "";
  const radek = (k: string, v: string) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
  const priebeh = () => {
    if (!n!.priebeh) return `<span class="muted">tabulka se přečte při příštím běhu importu</span>`;
    if (!n!.priebeh.length) return `<span class="muted">tabulka v PDF nenalezena</span>`;
    const v = kVytvoreni(n!.priebeh);
    if (!v.length) return `<span class="muted">vše Ponechať (${n!.priebeh.length} linek, žádná akce NEW / Vytvoriť)</span>`;
    return `<ul class="predpis">${v.map((r) => `<li>${esc(radekPriebehu(r))}</li>`).join("")}</ul>`;
  };
  // pořadí oddílů jako v PDF: Priebeh optický → Inštalačný predpis → Zoznam KZ
  const telo = !n
    ? `<span class="muted">Notifikační PDF k této aktivitě zatím nedorazilo.</span>`
    : `<h3>Priebeh optický – akce technika <small class="muted">Názov linky / A uzol / Akcia na linke / Z akcia / Typ linky</small></h3>
${priebeh()}
<h3>Inštalačný predpis k</h3>
${n.predpis.length ? `<ul class="predpis">${n.predpis.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : `<span class="muted">v PDF chybí</span>`}
<h3>Zoznam KZ</h3>
<dl>${radek("CPE Mode", esc(n.cpeMode ?? "") || `<span class="muted">neuvedeno</span>`)}${radek("Zoznam kompatibilných zariadení", esc(n.zoznam ?? "") || `<span class="muted">neuvedeno</span>`)}</dl>`;
  return `<div class="card kompakt notif"><h2 class="s-ikonou"><span class="i-drive">${IKONA.drive}</span>Výpis z notifikačního PDF${n ? ` <small class="muted">${esc(n.nazev)} · ${esc(fmtDate(n.vznik))} · ${odkaz}</small>` : ""}</h2><div class="posun">${telo}</div></div>`;
}

/** Instalovali jsme v lokalitě: null nalezy = adresa bez ulice a čísla popisného */
export interface Lokalita {
  nalezy: NalezLokality[] | null;
  chyba?: string;
}

export interface PlanovaniZakazky {
  lokalita?: Lokalita | null;
  /** městské části adres na stránce */
  casti?: Casti;
  /** „jiné termíny“: hledá se od tohoto dne (YYYY-MM-DD) */
  odData?: string;
  brany: Brany;
  nabidka: Nabidka | null;
  zapis: { zapnuty: boolean; smiTechnik: (t: string) => boolean };
  /** plánovač není zapnutý (chybí kalendáře) */
  nedostupne?: boolean;
  /** role technik: jen detail se zdroji, bez „Kam naplánovat“ */
  jenNahled?: boolean;
  /** IRU lokalita z číselníku (město zakázky má nestandardní postup) */
  iru?: IruLokalita | null;
  /** zakázka z webcalendar: termín si vybral zákazník; vKalendari = našla se událost u technika */
  webcal?: (Webcalendar & { vKalendari: { technik: string; od: Date; do: Date } | null }) | null;
  /** režim „Přeplánovat zakázku“ */
  preplanovat?: boolean;
  /** termín zatím není v kalendáři → zapsat jako nový (pp=1) */
  doplnit?: boolean;
  /** přeplánování: původní událost, která se po zápisu vrátí na VOLNY */
  presun?: { kalendar: string; eventId: string; technik: string; od: Date; do: Date } | null;
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
    ? `<div class="card"><h2>Adresa a mapa</h2><div>${esc(adresa)}${mc(adresa, plan.casti)}</div>
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

  const telo = `<h1>${esc(z.idObjednavky || z.idAktivity)} ${infraStitek(z.infrastruktura)}${predobjStitek(z)}${webcalStitek(z)}${migraceStitek(z)}${usedStitek(z)} ${prio(d.priorita)} <small>${esc(z.zakaznik)}${s7(z) ? ` · ID S7 obj. ${esc(s7(z))}` : ""} · ID aktivity ${esc(z.idAktivity)}</small></h1>
${z.predobjednavka ? `<div class="warn predobj-pruh"><b>Předobjednávka</b> (${esc(z.typAktivity)}) – termín lze naplánovat, realizace až po změně na standardní zakázku v MWF${z.rfs ? ` (RFS ${esc(den(z.rfs))})` : ""}.</div>` : ""}
${plan.webcal ? pruhWebcal(plan.webcal, z.idAktivity, !!plan.jenNahled) : ""}
${(() => { const m = migrace(z); return m ? pruhMigrace(m, now) : ""; })()}
${(() => { const u = zasuvkaUsed(z); return u ? pruhUsed(u) : ""; })()}
${d.uzavreno ? `<div class="warn">Zakázka už v exportu MWF není (uzavřená ${esc(dt(d.uzavreno))}).</div>` : ""}
<div class="grid">
<div class="card"><h2>Zákazník</h2><dl>
${radek("Zákazník", esc(z.zakaznik))}
${radek("Kontakt", z.telefony.map((t) => `<a href="tel:${esc(t.replace(/\s/g, ""))}">${esc(t)}</a>`).join(", "))}
${radek("Adresa / PSČ", esc(adresa) + mc(adresa, plan.casti))}
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
${plan.iru ? radek("IRU lokalita", `<span class="iru"><b>${esc(plan.iru.mesto)}</b> – ${esc(plan.iru.popis)}${plan.iru.odkaz && /^https?:\/\//.test(plan.iru.odkaz) ? ` · <a href="${esc(plan.iru.odkaz)}" target="_blank" rel="noopener">dokument</a>` : ""}</span>`) : ""}
${radek("Typ aktivity", `${esc(z.typAktivity)}${predobjStitek(z)}`)}
${radek("P3: Typ balíčku", esc(z.balik) || `<span class="muted">neuvedeno</span>`)}
${prioritySvisible ? radek("Priorita", `${prio(d.priorita)} ${esc(d.duvod)}`) : ""}
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
<div class="grid tretiny" style="margin-top:12px">
${sekceNotifikace(d.notifikace)}
<div class="card kompakt"><h2 class="s-ikonou"><span class="i-kalendar">${IKONA.kalendar}</span>Instalovali jsme v lokalitě</h2><div class="posun">${sekceLokality(plan.lokalita)}</div></div>
<div class="sloupec">
<div class="card kompakt"><h2>Kontaktování</h2><div class="posun maly"><dl>
${radek("Stav", esc(stavKontaktu(d, now)))}
${radek("Další kontakt", esc(denIso(d.dalsiKontakt)))}
${radek("Navolané dny", esc(`${d.plan.navolaneDny} (cíl ${d.plan.pokusuDenne} pokus/y denně)`))}
${radek("SMS", esc(`odesláno ${d.plan.sms.odeslano}${d.plan.sms.doporucena ? " · doporučena další" : ""}${d.plan.sms.nejdrive ? ` · nejdřív ${dt(d.plan.sms.nejdrive)}` : ""}`))}
${radek("Pokusy", esc(pokusy.map((p) => `${dt(p.at)} ${p.dovolano ? "dovoláno" : "nedovoláno"}${p.sms ? " + SMS" : ""}`).join("; ")))}
${radek("Upozornění", esc(d.plan.varovani.join("; ")))}
</dl></div></div>
<div class="card kompakt"><h2>Historie změn mezi exporty</h2><div class="posun maly">${historieHtml}</div></div>
</div>
</div>
${plan.jenNahled ? "" : `<div class="konec-detailu"></div>
<section class="planovani" id="planovani"><h2>Kam naplánovat <small>${esc(z.idObjednavky || z.idAktivity)} · ${esc(z.zakaznik)}</small></h2>
${sekcePlanovani(d, plan)}</section>`}`;

  return stranka(z.idObjednavky || z.idAktivity, uzivatel, stav, telo, { dotaz: z.idObjednavky || z.idAktivity });
}

/** Ikony služeb Google Workspace (obecné, bez log): obálka = e-mail, kalendář, bublina = chat */
const svg = (cesta: string) =>
  `<svg class="ikona" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${cesta}</svg>`;
const IKONA: Record<Zdroj | "drive", string> = {
  drive: svg('<path d="M8 3h8l5 11-4 7H7l-4-7z"/><path d="M8 3l4 7h9M3 14h9l4-11M12 10l-5 11"/>'),
  email: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  kalendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
};

const NAZEV_ZDROJE: Record<Zdroj, string> = { email: "E-mail (koordinace)", kalendar: "Kalendáře techniků", chat: "Google Chat" };

function nalez(n: Nalez): string {
  return `<div class="zaznam${n.veVlakne ? " muted" : ""}"><div class="hl"><b>${odkazyOId(esc(n.titulek))}</b>${n.cas ? ` · ${esc(dt(n.cas))}` : ""}${
    n.kdo ? ` · ${esc(n.kdo)}` : ""
  }${n.kde && n.kde !== n.titulek ? ` · ${esc(n.kde)}` : ""}${n.veVlakne ? " · ve vlákně" : ""}${
    n.odkaz ? ` · <a href="${esc(n.odkaz)}" target="_blank" rel="noopener">otevřít</a>` : ""
  }</div>${odkazyOId(esc(n.text.length > 160 ? `${n.text.slice(0, 159)}…` : n.text))}</div>`;
}

/** O-ID v textu (e-mail, kalendář, chat) jako odkaz na plánování zakázky */
const odkazyOId = (html: string) => html.replace(/O-\d{8,}/g, (o) => `<a href="/?q=${o}">${o}</a>`);

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
      // dlouhý seznam (hlavně e-mail) se neroztahuje přes celou stránku – roluje uvnitř karty
      return `<div class="card kompakt"><h2 class="s-ikonou"><span class="i-${v.zdroj}">${IKONA[v.zdroj]}</span>${esc(NAZEV_ZDROJE[v.zdroj])}${v.nalezy.length ? ` <small class="muted">${v.nalezy.length}</small>` : ""}</h2><div class="posun zdroj">${obsah}</div></div>`;
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
<h1>Termín pro ${esc(z.idObjednavky || z.idAktivity)} ${infraStitek(z.infrastruktura)}${predobjStitek(z)} <small>${esc(z.zakaznik)} · ${esc([z.adresa, bezRovna(z.psc)].filter(Boolean).join(", "))} · ${esc(z.typAktivity)}</small></h1>`;
}


function sekceLokality(l: Lokalita | null | undefined): string {
  if (!l) return `<span class="muted">Kalendáře techniků nejsou zapnuté (chybí delegace účtu tmcz01).</span>`;
  if (l.chyba) return `<div class="err">Kalendáře nedostupné: ${esc(l.chyba)}</div>`;
  if (!l.nalezy) return `<span class="muted">Adresa nemá ulici a číslo popisné – nelze hledat.</span>`;
  if (!l.nalezy.length) return `<span class="muted">Na této adrese jsme v posledních 2 letech nic nerealizovali.</span>`;
  return `<table class="male"><tbody>${l.nalezy
    .map(
      (n) => `<tr${n.budouci ? ` class="muted"` : ""}><td class="nowrap">${esc(n.cas ? fmtDate(n.cas) : "")}${n.budouci ? "<br><small>plán</small>" : ""}</td>
<td>${odkazyOId(esc(n.titulek.replace(/^[^-]+-\s*/, "")))}<br><small class="muted">${esc(n.kde ?? "")}${n.text ? ` · ${esc(n.text)}` : ""}</small></td>
<td class="nowrap">${n.odkaz ? `<a href="${esc(n.odkaz)}" target="_blank" rel="noopener">v kalendáři →</a>` : ""}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function sekcePlanovani(d: Detail, plan: PlanovaniZakazky): string {
  const z = d.z;
  const { brany, nabidka, zapis } = plan;
  // zakázka s dohodnutým termínem: místo chyby výrazné tlačítko „Přeplánovat zakázku“
  const zakl0 = `/zakazka/${encodeURIComponent(z.idAktivity)}`;
  const jeTermin = (b: string) => b.startsWith("Zakázka už má dohodnutý termín");
  const ostatni = brany.blokace.filter((b) => !jeTermin(b));
  const blok = ostatni.length
    ? `<div class="err"><b>Termín teď nelze naplánovat:</b><ul>${ostatni.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`
    : "";
  const upoz = brany.upozorneni.length ? `<div class="warn">${brany.upozorneni.map(esc).join("<br>")}</div>` : "";
  if (blok) return blok + upoz;
  if (z.termin && brany.blokace.some(jeTermin)) {
    return `<div class="err termin-box"><div><b>Termín teď nelze naplánovat:</b><ul><li>Zakázka už má dohodnutý termín <b>${esc(slot(z.termin.od, z.termin.do))}</b>${z.technik ? ` · ${esc(z.technik)}` : ""}.</li></ul></div>
<a class="btn velke" href="${esc(`${zakl0}?preplanovat=1#planovani`)}">Přeplánovat zakázku</a></div>${upoz}`;
  }
  if (d.uzavreno) return `<div class="warn">Uzavřená zakázka se neplánuje.</div>`;
  if (!nabidka) return `${upoz}<div class="warn">${plan.nedostupne ? "Kalendáře techniků nejsou v této instalaci zapnuté." : "Nabídku se nepodařilo spočítat."}</div>`;

  const info = [
    nabidka.nedostupne.length ? `Kalendář nejde přečíst: ${nabidka.nedostupne.join(", ")}.` : "",
    nabidka.bezZakladny.length ? `Technik bez adresy výjezdu v číselníku: ${nabidka.bezZakladny.join(", ")}.` : "",
    nabidka.bezPolohy ? `${nabidka.bezPolohy} zakázek v kalendářích nemá dohledatelnou adresu – v trasách chybí.` : "",
  ].filter(Boolean);
  // přeplánování / doplnění termínu: parametry, které jdou s výběrem slotu do zápisu
  const navic = (q: URLSearchParams) => {
    if (plan.presun) {
      q.set("pk", plan.presun.kalendar);
      q.set("pe", plan.presun.eventId);
      q.set("pt", plan.presun.technik);
    } else if (plan.doplnit) q.set("pp", "1");
    return q;
  };
  const radky = nabidka.moznosti.map((m: MoznostSlotu, i) => {
    const smi = zapis.zapnuty && zapis.smiTechnik(m.technik) && (!plan.presun || zapis.smiTechnik(plan.presun.technik));
    const q = navic(new URLSearchParams({ k: m.kalendar, e: m.eventId, t: m.technik, od: m.od.toISOString(), do: m.do.toISOString() }));
    const so = m.sousede;
    const radekSouseda = (smer: string, x: NonNullable<MoznostSlotu["sousede"]>["pred"]) =>
      `<div class="soused${x.zakladna ? " zakl" : ""}"><span class="smer">${smer}</span> ${x.cas ? `<b>${esc(x.cas)}</b> ` : ""}${esc(x.popis)}${mc(x.adresa, plan.casti)} <span class="km${x.km > DLOUHY_PREJEZD_KM ? " dlouhy" : ""}">${x.km.toFixed(1)} km</span></div>`;
    const adresaZ = [z.adresa, bezRovna(z.psc)].filter(Boolean).join(", ");
    const mapa = so && adresaZ
      ? `https://www.google.com/maps/dir/${[so.pred.adresa ?? "", adresaZ, so.po.adresa ?? ""].filter(Boolean).map((a) => encodeURIComponent(a)).join("/")}`
      : "";
    const trasa = so
      ? `${radekSouseda("↑ před", so.pred)}<div class="soused tato">● tato zakázka – příjezd cca ${esc(`${String(Math.floor(so.prijezd / 60)).padStart(2, "0")}:${String(Math.round(so.prijezd % 60)).padStart(2, "0")}`)}</div>${radekSouseda("↓ po", so.po)}${
          mapa ? `<div class="soused"><a href="${esc(mapa)}" target="_blank" rel="noopener">trasa v mapě →</a></div>` : ""
        }`
      : "";
    const odkazZapisu = (x: MoznostSlotu) =>
      `/zakazka/${encodeURIComponent(z.idAktivity)}/zapis?${navic(new URLSearchParams({ k: x.kalendar, e: x.eventId, t: x.technik, od: x.od.toISOString(), do: x.do.toISOString() }))}`;
    const jinyCas = m.alternativy?.length
      ? `<div class="jiny-cas">jiný čas téhož dne: ${m.alternativy
          .map((a) => (smi ? `<a href="${esc(odkazZapisu(a))}">${esc(`${fmtTime(a.od)}–${fmtTime(a.do)}`)}</a>` : esc(`${fmtTime(a.od)}–${fmtTime(a.do)}`)))
          .join(" · ")}</div>`
      : "";
    return `<tr${m.naDohodnuty ? ` class="na-dohodnuty"` : ""}><td>${i + 1}</td><td><b>${esc(slot(m.od, m.do))}</b>${m.naDohodnuty ? ` <span class="webcal">= DOHODNUTÝ TERMÍN</span>` : ""}${trasa ? `<div class="trasa">${trasa}</div>` : ""}${jinyCas}</td><td>${esc(m.technik)}${m.vytizeni ? barVytizeni(m.vytizeni, m.eventId) : ""}</td>
<td class="nowrap">+${m.kmNavic.toFixed(1)} km<br><small>den ${m.kmDne.toFixed(0)} km</small></td>
<td>${smi ? `<a class="btn" href="/zakazka/${encodeURIComponent(z.idAktivity)}/zapis?${esc(q.toString())}">Vybrat</a>` : `<small class="muted">${zapis.zapnuty ? "zápis pro technika vypnutý" : "zápis vypnutý"}</small>`}</td></tr>`;
  });
  // Jiné termíny: zákazník nemůže → posun dopředu (od dne po posledním nabídnutém), nebo od zvoleného data
  const pp = plan.preplanovat ? "preplanovat=1&" : "";
  const zakl = `/zakazka/${encodeURIComponent(z.idAktivity)}`;
  const posledni = nabidka.moznosti.map((m) => isoDate(m.od)).sort().at(-1) ?? nabidka.obdobi?.do;
  const pozdeji = posledni ? addDays(posledni, 1) : null;
  const terminy = `<form class="terminy" method="get" action="${esc(zakl)}#planovani">
${nabidka.obdobi ? `<span>Hledáno <b>${esc(fmtDate(nabidka.obdobi.od))} – ${esc(fmtDate(nabidka.obdobi.do))}</b></span>` : ""}
${plan.preplanovat ? `<input type="hidden" name="preplanovat" value="1"><span class="webcal">PŘEPLÁNOVÁNÍ</span> <a href="${esc(zakl)}#planovani">zrušit</a>` : ""}
${plan.odData ? `<a href="${esc(`${zakl}${pp ? `?${pp.slice(0, -1)}` : ""}`)}#planovani">← nejbližší termíny</a>` : ""}
${pozdeji ? `<a class="btn" href="${esc(`${zakl}?${pp}od=${pozdeji}#planovani`)}">Pozdější termíny →</a>` : ""}
<label>od data <input type="date" name="od" value="${esc(plan.odData ?? "")}"></label><button>Hledat</button>
</form>`;
  return `${upoz}${terminy}${nabidka.chyba ? `<div class="err">${esc(nabidka.chyba)}</div>` : ""}
${info.length ? `<div class="warn">${info.map(esc).join("<br>")}</div>` : ""}
<div class="tbl"><table><thead><tr><th>#</th><th>Slot</th><th>Technik</th><th>Km navíc</th><th></th></tr></thead>
<tbody>${radky.join("") || `<tr><td colspan="5" class="muted">${nabidka.chyba ? "" : "V tomto období žádný volný slot v dosahu – zkuste Pozdější termíny."}</td></tr>`}</tbody></table></div>
<p class="muted">Prohledáno ${nabidka.technikuCelkem} techniků s dovedností pro tento typ zakázky. Pořadí: zaplnění dne, km navíc oproti trase dne, preferované okno 10–14 h. U každého slotu je vidět, kam technik jede před ní a po ní (km = přejezd, odhad vzdušnou čarou × 1,3).</p>`;
}

/** přejezd nad tento limit se v nabídce zvýrazní (červeně) – na první pohled vidět nesmyslnou cestu */
const DLOUHY_PREJEZD_KM = 30;

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
  vyb: { k: string; e: string; t: string; od: Date; do: Date; presun?: Presun | null; pp?: boolean },
  brany: Brany,
  zapisPovolen: boolean,
  stav: StavImportu,
  uzivatel: string,
  chyby: string[] = [],
  hodnoty: URLSearchParams = new URLSearchParams(),
  nahled: { summary: string; location: string } | null = null,
  okoli: OkoliZapisu | null = null,
): string {
  const z = d.z;
  const h = (n: string) => esc(hodnoty.get(n) ?? "");
  const v = (n: string, moznosti: [string, string][], vychozi = "") => vyber(n, moznosti, hodnoty.get(n) ?? vychozi);
  // instalační předpis: předvyplnit vším z notifikačního PDF (předpis, KZ, akce technika z Priebeh optický)
  const n = d.notifikace;
  const zPdf = n
    ? [
        n.priebeh?.length ? `Priebeh optický:\n${kVytvoreni(n.priebeh).length ? kVytvoreni(n.priebeh).map(radekPriebehu).join("\n") : "vše Ponechať"}` : "",
        n.predpis.length ? `Inštalačný predpis:\n${n.predpis.join("\n")}` : "",
        n.cpeMode || n.zoznam ? `Zoznam KZ:\nCPE Mode ${n.cpeMode ?? "?"}${n.zoznam ? ` · ${n.zoznam}` : ""}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";
  const predpis = hodnoty.get("predpis") ?? zPdf;
  const flex = hodnoty.get("flex") ?? "ne";
  // předpojen: když v Priebeh optický není žádná akce technika (vše Ponechať), je přípojka předpojená
  const predpojenZPdf = n?.priebeh?.length ? (kVytvoreni(n.priebeh).length ? "ne" : "ano") : "";
  const infra = z.infrastruktura === "TMCZ" ? "" : ` ${z.infrastruktura}`;
  const nadpis = nahled?.summary ?? `${vyb.t} - ${z.typAktivity.includes("PIV") ? "PIV" : "FTTH"}${infra} ${z.idObjednavkyZaklad} ${z.zakaznik}`;
  const misto = nahled?.location ?? z.adresa;
  const nestd = hodnoty.get("nestandard") === "1";
  const casOd = hodnoty.get("casOd") || fmtTime(vyb.od);
  const casDo = hodnoty.get("casDo") || fmtTime(vyb.do);
  const kdy = `${DNY_CELE[vyb.od.getUTCDay()]} ${vyb.od.getUTCDate()}. ${MESICE[vyb.od.getUTCMonth()]} · ${nestd ? `${esc(casOd)}–${esc(casDo)}` : `${fmtTime(vyb.od)}–${fmtTime(vyb.do)}`}`;
  // řádek popisu události: ŠTÍTEK: hodnota – ve stejném pořadí, jak se zapíše do kalendáře
  // váha = povinne (musí být vyplněno – zvýrazněný řádek se štítkem) | volitelne (doplňkové, ztlumené) | "" (informace)
  const r = (stitek: string, obsah: string, vaha = "") => `<div class="gc-radek${vaha ? ` gc-${vaha}` : ""}"><span class="gc-stitek">${esc(stitek)}</span>${obsah}</div>`;
  const form = `<form method="post" action="/zakazka/${encodeURIComponent(z.idAktivity)}/zapis" class="gcal">
<input type="hidden" name="k" value="${esc(vyb.k)}"><input type="hidden" name="e" value="${esc(vyb.e)}"><input type="hidden" name="t" value="${esc(vyb.t)}">
<input type="hidden" name="od" value="${esc(vyb.od.toISOString())}"><input type="hidden" name="do" value="${esc(vyb.do.toISOString())}">${presunPole(vyb.presun)}${vyb.pp && !vyb.presun ? `<input type="hidden" name="pp" value="1">` : ""}
<div class="gc-karta">
<div class="gc-hlava"><span class="gc-barva"></span><div><div class="gc-nadpis">${esc(nadpis)}</div><div class="gc-kdy">${kdy}</div></div></div>
<div class="gc-nestd">
<label class="check"><input type="checkbox" name="nestandard" value="1"${nestd ? " checked" : ""}> Editace úpravy názvu a času události <span class="muted">(nestandardní zásah)</span></label>
<div class="gc-nestd-pole">
<div class="err"><b>POZOR – nestandardní úprava zakázky.</b> Název a čas níže se zapíšou do Google Kalendáře přesně tak, jak jsou zde uvedené, místo standardní šablony. Slot VOLNY se přepíše celý; MWF upravte ručně na stejný čas.</div>
<label>Název události<input name="nadpis" value="${esc(hodnoty.get("nadpis") ?? nadpis)}" size="90"></label>
<div class="gc-radek"><span class="gc-stitek">Čas:</span> <input name="casOd" value="${esc(casOd)}" size="5" placeholder="HH:MM"> <span class="gc-mezi">–</span> <input name="casDo" value="${esc(casDo)}" size="5" placeholder="HH:MM"> <span class="muted">(den zůstává ${esc(fmtDate(vyb.od))})</span></div>
</div></div>
<div class="gc-blok"><span class="gc-ikona">${IKONA_GC.misto}</span><div class="gc-misto">${esc(misto)}</div></div>
<div class="gc-blok"><span class="gc-ikona">${IKONA_GC.popis}</span><div class="gc-popis">
${r("ZAKÁZKA:", `<span>${esc(z.idObjednavkyZaklad)}${z.idS7 ? ` · S7 ${esc(z.idS7)}` : ""}</span>`)}
${r("Tel:", `<span>${esc(z.telefony.join(", ")) || "–"}</span> <input name="kontakt" class="gc-ram" placeholder="U instalace bude jiná osoba – telefon, vztah, jméno" value="${h("kontakt")}" size="46">`)}
<div class="gc-radek gc-povinne gc-flex"><span class="gc-stitek">Flex:</span>
<label class="volba"><input type="radio" name="flex" value="ne"${flex === "ne" ? " checked" : ""}> Pevný termín <small>(není FLEX)</small></label>
<label class="volba"><input type="radio" name="flex" value="den"${flex === "den" ? " checked" : ""}> FLEX ten den <small>(čas v rámci dne lze posunout)</small></label>
<label class="volba"><input type="radio" name="flex" value="obecne"${flex === "obecne" ? " checked" : ""}> FLEX obecně <small>(důchodce, rodičovská, často HO)</small></label>
<input name="flexPozn" placeholder="upřesnění – např. jen do 14 h, odchod k lékaři" value="${h("flexPozn")}" size="36"></div>
${r("Zásuvka:", `${v("instalace", [["nova", "Nová instalace"], ["existujici", "Existující zásuvka"]], "nova")} <span class="gc-mezi">– číslo / foto</span> <input name="zasuvka" placeholder="číslo zásuvky" value="${h("zasuvka")}" size="14">`, "povinne")}
${r("Číslo patra a bytu:", `<input name="patro" placeholder="patro" value="${h("patro")}" size="6"> <span class="gc-mezi">/</span> <input name="byt" placeholder="byt" value="${h("byt")}" size="6">`, "povinne")}
${r("Patra volně přístupná:", v("patraPristupna", ANO_NE), "volitelne")}
${r("Stoupačka je zajištěna (nebo jen čtyřhran):", v("stoupacka", ANO_NE_NEVIM, "NEVÍM"), "volitelne")}
${r("Vzdálenost od stoupačky (řádově):", `<input name="vzdalenost" inputmode="numeric" value="${h("vzdalenost")}" size="5"> <span class="gc-mezi">metrů</span>`, "volitelne")}
${r("Stávající lišty / omezení v lištování od SVJ:", v("listy", ANO_NE_NEVIM, "NEVÍM"), "volitelne")}
${r("Souhlas s vrtáním:", `${v("vrtani", ANO_NE)} <span class="gc-mezi muted">(NE = vrátit na PEP, nebo STORNO)</span>`, "povinne")}
${r("Koncové zařízení umístíme v:", `<input name="umisteni" placeholder="předsíň / obývací pokoj / dle konzultace" value="${h("umisteni")}" size="30"> <span class="gc-mezi">– el. zásuvka:</span> ${v("elZasuvka", ANO_NE)}`, "povinne")}
${r("KZ:", `${v("kz", [["", "?"], ["ROUTE", "ROUTE"], ["BRIDGE", "BRIDGE"]])} <span class="gc-mezi">STB:</span> <input name="stb" value="${h("stb")}" size="10">${d.notifikace?.cpeMode ? ` <span class="gc-mezi muted">(z PDF: ${esc(d.notifikace.cpeMode)}${d.notifikace.zoznam ? ` · ${esc(d.notifikace.zoznam)}` : ""})</span>` : ""}`, "povinne")}
${r("Předpojen:", `${v("predpojen", ANO_NE, predpojenZPdf)}${predpojenZPdf ? ` <span class="gc-mezi muted">(z PDF – Priebeh optický: ${predpojenZPdf === "ano" ? "vše Ponechať" : "technik má akci NEW / Vytvoriť"})</span>` : ""}`, "volitelne")}
${r("PODB (adresa):", `<input name="podb" value="${h("podb")}" size="30"> <span class="gc-mezi muted">(T-Mobile)</span>`, "volitelne")}
${r("CASEID:", `<input name="caseid" value="${h("caseid")}" size="16"> <span class="gc-mezi muted">(SWAP / FIS MOP)</span>`, "volitelne")}
<div class="gc-radek gc-predpis"><span class="gc-stitek">INSTALAČNÍ PŘEDPIS:</span><textarea name="predpis" placeholder="zkopírovat z ticketu">${esc(predpis)}</textarea>${zPdf && !hodnoty.get("predpis") ? `<span class="muted">předvyplněno z notifikačního PDF ${esc(n!.nazev)} – zkontrolujte a případně doplňte</span>` : ""}</div>
</div></div>
<div class="gc-blok"><span class="gc-ikona">${IKONA_GC.potvrzeni}</span><div>
${POVINNA_POTVRZENI.map((p) => `<label class="check"><input type="checkbox" name="${p.pole}" value="ano"${hodnoty.get(p.pole) === "ano" ? " checked" : ""}> ${esc(p.text)}</label>`).join("")}
</div></div>
<div class="gc-pata"><button class="btn"${zapisPovolen ? "" : " disabled"}>Uložit do kalendáře</button>
${zapisPovolen ? "" : `<span class="muted"> Zápis do kalendáře je vypnutý (pilotní režim) – formulář slouží jen k náhledu.</span>`}</div>
</div>
</form>`;

  const telo = `${hlavickaZakazky(d)}
<div class="card" style="margin-bottom:12px"><b>${esc(slot(vyb.od, vyb.do))}</b> · technik <b>${esc(vyb.t)}</b> · slot VOLNY se přepíše na zakázku${
    vyb.presun && z.termin ? `<br><b>Přesun</b> z ${esc(slot(z.termin.od, z.termin.do))} (${esc(vyb.presun.pt)}) – původní událost se vrátí na VOLNY` : ""
  }</div>
${chyby.length ? `<div class="err">${chyby.map(esc).join("<br>")}</div>` : ""}
${brany.upozorneni.length ? `<div class="warn">${brany.upozorneni.map(esc).join("<br>")}</div>` : ""}
<div class="zapis-dva">
<div>${form}</div>
<div>${okoli ? sekceOkoli(okoli, vyb, nadpis) : ""}</div>
</div>`;
  return stranka("Zápis termínu", uzivatel, stav, telo);
}

/** Pravý sloupec zápisu: den technika (vzhled Google Kalendáře) s vyznačeným slotem a zakázky v okolí */
export interface OkoliZapisu {
  den: string;
  denTechnika: UdalostTechnika[];
  slotId: string;
  okoli: { u: UdalostTechnika; km: number }[];
  bezAdresy: boolean;
  /** adresa plánované zakázky (do mapy trasy) */
  adresaZakazky: string;
}

function sekceOkoli(o: OkoliZapisu, vyb: { t: string; e: string; od: Date; do: Date }, nadpis: string): string {
  const titulek = (u: UdalostTechnika) => esc(u.summary.replace(/^[^-]+-\s*/, ""));
  // zastávky trasy: zakázky technika v den termínu podle času + tato zakázka na místě slotu; číslo pořadí = písmeno na mapě (1 = A, 2 = B…)
  const zastavky = o.denTechnika
    .filter((u) => u.id === vyb.e || (!jeVolneOkno(u) && u.location))
    .map((u) => (u.id === vyb.e ? { id: u.id, adresa: o.adresaZakazky, tato: true, od: u.od } : { id: u.id, adresa: u.location, tato: false, od: u.od }))
    .filter((z) => z.adresa);
  if (!zastavky.some((z) => z.tato) && o.adresaZakazky) zastavky.push({ id: vyb.e, adresa: o.adresaZakazky, tato: true, od: vyb.od });
  zastavky.sort((a, b) => a.od.getTime() - b.od.getTime());
  const poradi = new Map(zastavky.map((z, i) => [z.id, i + 1]));
  const pismeno = (i: number) => String.fromCharCode(64 + i);
  const cislo = (i: number | undefined, tato = false) => (i ? `<span class="poradi${tato ? " tato" : ""}" title="na mapě bod ${pismeno(i)}">${i}</span>` : "");
  const radek = (u: UdalostTechnika) => {
    const tato = u.id === vyb.e;
    const volny = jeVolneOkno(u);
    const trida = tato ? "gc-ud tato" : volny ? "gc-ud volny" : "gc-ud";
    const text = tato ? `<b>${esc(nadpis)}</b><div class="muted">← tato zakázka (přepíše slot ${titulek(u)})</div>` : `${titulek(u)}${u.location ? `<div class="muted">${esc(u.location)}</div>` : ""}`;
    return `<div class="${trida}"><div class="gc-cas">${fmtTime(u.od)}<br><span class="muted">${fmtTime(u.do)}</span></div><div class="gc-tel"><span class="gc-barva ${volny && !tato ? "b-vol" : ""}"></span>${cislo(poradi.get(u.id), tato)}<div>${text}</div></div></div>`;
  };
  const den = `${DNY_CELE[vyb.od.getUTCDay()]} ${fmtDate(vyb.od)}`;
  const udalosti = o.denTechnika.length ? o.denTechnika.map(radek).join("") : `<div class="muted">V kalendáři technika ten den nic není.</div>`;
  const okoli = o.bezAdresy
    ? `<div class="muted">Adresu zakázky se nepodařilo najít na mapě – okolí nelze spočítat.</div>`
    : o.okoli.length
      ? o.okoli.map(({ u, km }) => `<div class="gc-ud${isoDate(u.od) === o.den ? " stejny-den" : ""}"><div class="gc-cas"><b>${esc(`${DNY[u.od.getUTCDay()]} ${u.od.getUTCDate()}.${u.od.getUTCMonth() + 1}.`)}</b><br>${fmtTime(u.od)}–${fmtTime(u.do)}</div><div class="gc-tel"><span class="gc-barva"></span><div><b>${esc(u.technik)}</b> · ${titulek(u)}<div class="muted">${esc(u.location)} · <b>${km} km</b></div></div></div></div>`).join("")
      : `<div class="muted">±5 dní kolem termínu není do 30 km naplánovaná žádná jiná zakázka.</div>`;
  const mapa = (() => {
    if (zastavky.length < 2) return zastavky.length === 1 ? `<iframe class="mapa" title="Mapa" loading="lazy" referrerpolicy="no-referrer" src="https://www.google.com/maps?q=${esc(encodeURIComponent(zastavky[0]!.adresa))}&amp;z=12&amp;output=embed"></iframe>` : `<div class="muted">Bez adres – mapu nelze sestavit.</div>`;
    const [prvni, ...dalsi] = zastavky;
    const src = `https://www.google.com/maps?saddr=${encodeURIComponent(prvni!.adresa)}&daddr=${encodeURIComponent(dalsi.map((z) => z.adresa).join(" to:"))}&output=embed`;
    return `<iframe class="mapa trasa-mapa" title="Trasa technika" loading="lazy" referrerpolicy="no-referrer" src="${esc(src)}"></iframe>`;
  })();
  const legenda = zastavky.map((z, i) => `<div class="${z.tato ? "zast tato" : "zast"}">${cislo(i + 1, z.tato)} <b>${pismeno(i + 1)}</b> · ${fmtTime(z.od)} · ${esc(z.adresa)}</div>`).join("");
  return `<div class="gc-den"><h2>${esc(vyb.t)} · ${esc(den)}</h2>${udalosti}</div>
<div class="gc-den"><h2>Trasa technika <small class="muted">${esc(den)}, orientačně podle času zakázek · číslo = pořadí, písmeno = bod na mapě</small></h2>${mapa}<div class="legenda">${legenda}</div></div>
<div class="gc-den"><h2>Naplánováno v okolí <small class="muted">všichni technici, ±5 dní kolem ${esc(fmtDate(vyb.od))}, do 30 km</small></h2>${okoli}</div>`;
}

const MESICE = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const IKONA_GC = {
  misto: svg('<path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  popis: svg('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  potvrzeni: svg('<path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>'),
};

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
const DNY_CELE = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

const odkazSlotu = (u: UdalostTechnika, den: string) =>
  `/technik?${new URLSearchParams({ t: u.technik, den, k: u.kalendar, e: u.id, od: u.od.toISOString(), do: u.do.toISOString() })}`;

/** Text události bez jména technika na začátku; O-ID jako odkaz na plánování zakázky; adresa (MWF, jinak z kalendáře) */
function textUdalosti(u: UdalostTechnika, adresy?: Map<string, string>, casti?: Casti): string {
  const t = esc(u.summary.replace(/^[^-]+-\s*/, "")).replace(/O-\d{6,}/g, (o) => `<a href="/?q=${o}">${o}</a>`);
  const o = u.summary.match(/O-\d{6,}/)?.[0];
  const adresa = (o && adresy?.get(o)) || u.location;
  return `${t}${adresa ? ` <span class="adr">· ${esc(adresa)}</span>${mc(adresa, casti)}` : ""}`;
}

export interface StrankaTechnika {
  technici: TechnikPlanu[];
  technik: TechnikPlanu | null;
  den: string;
  predchozi: string | null;
  dalsi: string;
  /** dny vybraného technika (nahoře) */
  dny: { datum: string; udalosti: UdalostTechnika[] }[];
  /** O-číslo → úplná adresa z MWF (jinak se bere místo z kalendáře) */
  adresy?: Map<string, string>;
  casti?: Casti;
  /** rychlá volba dne: nejbližší pracovní dny */
  rychleDny: string[];
  /** bez vybraného technika: přehled všech techniků pro den */
  prehled: { dny: DenPrehledu[]; nedostupne: string[] } | null;
  slot: VybranySlot | null;
  navrhy: NavrhySlotu | null;
  chyba?: string;
  zapis: { zapnuty: boolean; smiTechnik: (t: string) => boolean };
  /** „Zvýšit toleranci“ – rozšíří nabídku zakázek do slotu */
  tolerance?: boolean;
  tolerancePct?: number;
}

export function strankaTechnika(s: StrankaTechnika, stav: StavImportu, uzivatel: string): string {
  const volby = s.technici
    .map((t) => `<option value="${esc(t.jmeno)}"${s.technik?.jmeno === t.jmeno ? " selected" : ""}>${esc(t.jmeno)} – ${esc(t.skupiny.join(", "))} · ${esc(t.vyjezd)}</option>`)
    .join("");
  const navT = `${s.technik ? `&t=${encodeURIComponent(s.technik.jmeno)}` : ""}${s.tolerance ? "&tol=1" : ""}`;
  const slotOdkaz = (u: UdalostTechnika) => `${odkazSlotu(u, s.den)}${s.tolerance ? "&tol=1" : ""}`;
  const skryteSlotu = s.slot
    ? `<input type="hidden" name="k" value="${esc(s.slot.technik.kalendar)}"><input type="hidden" name="e" value="${esc(s.slot.eventId)}"><input type="hidden" name="od" value="${esc(s.slot.od.toISOString())}"><input type="hidden" name="do" value="${esc(s.slot.do.toISOString())}">`
    : "";
  const krok = s.technik ? "o týden" : "o den";
  // Technik vlevo, Den vpravo: popisky na stejné výšce, pod Dnem posun a rychlá volba dnů
  const formular = `<form class="vyber-tech" method="get" action="/technik">
<div class="pole"><label for="vt">Technik</label><select id="vt" name="t"><option value="">– všichni (přehled dne) –</option>${volby}</select></div>
<div class="pole"><label for="vd">${s.technik ? "Od dne" : "Den"} · <b>${esc(DNY_CELE[new Date(`${s.den}T00:00:00Z`).getUTCDay()]!)}</b></label>
<div class="radek"><input id="vd" type="date" name="den" value="${esc(s.den)}"><button>Zobrazit</button>
${s.predchozi ? `<a href="/technik?den=${esc(s.predchozi)}${esc(navT)}">← ${krok} zpět</a>` : ""}<a href="/technik?den=${esc(s.dalsi)}${esc(navT)}">${krok} dál →</a></div>
<div class="rychle">${s.rychleDny
    .map((d) => `<a class="${d === s.den ? "on" : ""}" href="/technik?den=${esc(d)}${esc(navT)}">${esc(DNY_DLOUHE(d))} ${esc(fmtDate(d).slice(0, 6))}</a>`)
    .join("")}</div>
</div>
<div class="pole"><label>Doplnění slotu</label><label class="chk"><input type="checkbox" name="tol" value="1"${s.tolerance ? " checked" : ""}> Zvýšit toleranci o ${s.tolerancePct ?? 25} %</label>
<small class="muted">víc zakázek do slotu – pozdější příjezd na další zakázku o ${s.tolerancePct ?? 25} % slotu (2h slot = ${Math.round(120 * (s.tolerancePct ?? 25) / 100)} min) a delší zajížďka; potvrďte Zobrazit</small></div>${skryteSlotu}
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
            jeVyhrazeneVolno(u)
              ? `<div class="vyhrazeny">${esc(hm(u.od))}–${esc(hm(u.do))} ${VYHRAZENY}</div>`
              : jeVolneOkno(u)
              ? `<a class="volny${s.slot?.eventId === u.id ? " vyb" : ""}" href="${esc(slotOdkaz(u))}">${esc(hm(u.od))}–${esc(hm(u.do))} volno → doplnit</a>`
              : `<div class="ud"><span class="cas">${esc(hm(u.od))}–${esc(hm(u.do))}</span>${textUdalosti(u, s.adresy, s.casti)}</div>`,
          )
          .join("");
        return `<div class="card"><h3>${esc(DNY_DLOUHE(d.datum))} ${esc(fmtDate(d.datum))} <small class="muted">· ${zak.length} ${zak.length === 1 ? "událost" : "událostí"}</small></h3>${barVytizeni(vytizeniDne(d.udalosti, t.jmeno, d.datum), s.slot?.eventId)}${obsah || `<span class="muted">prázdný den</span>`}</div>`;
      })
      .join("")}</div>`;
  } else if (s.prehled) {
    // den technika jako časová osa: zakázky a volné sloty VOLNY v pořadí podle času
    const radky = s.prehled.dny.map((d) => {
      const osa = [...d.zakazky, ...d.volne, ...d.vyhrazene]
        .sort((a, b) => a.od.getTime() - b.od.getTime())
        .map((u) =>
          d.vyhrazene.includes(u)
            ? `<div class="vyhrazeny"><span class="cas">${esc(hm(u.od))}–${esc(hm(u.do))}</span> ${VYHRAZENY}</div>`
            : d.volne.includes(u)
            ? `<a class="volny radek" href="${esc(slotOdkaz(u))}"><span class="cas">${esc(hm(u.od))}–${esc(hm(u.do))}</span> volno → doplnit</a>`
            : `<div class="ud"><span class="cas">${esc(hm(u.od))}–${esc(hm(u.do))}</span>${textUdalosti(u, s.adresy, s.casti)}</div>`,
        )
        .join("");
      return `<tr><td><a href="/technik?t=${encodeURIComponent(d.technik.jmeno)}&den=${esc(s.den)}"><b>${esc(d.technik.jmeno)}</b></a><br><small class="muted">${esc(d.technik.skupiny.join(", "))}</small>${barVytizeni(vytizeniDne([...d.zakazky, ...d.volne, ...d.vyhrazene], d.technik.jmeno, s.den))}</td>
<td class="nowrap">${d.zakazky.length}</td><td class="nowrap">${d.volne.length}</td><td>${osa || `<span class="muted">prázdný den</span>`}</td></tr>`;
    });
    horni = `<h1>Doplnit technika <small>přehled ${esc(DNY_DLOUHE(s.den))} ${esc(fmtDate(s.den))} – od nejméně vytížených</small></h1>
${s.prehled.nedostupne.length ? `<div class="warn">Kalendář nejde přečíst: ${esc(s.prehled.nedostupne.join(", "))}.</div>` : ""}
<div class="tbl"><table><thead><tr><th>Technik</th><th>Zakázek</th><th>Volných</th><th>Den – zakázky a volné sloty podle času</th></tr></thead>
<tbody>${radky.join("") || `<tr><td colspan="4" class="muted">Žádný technik s čitelným kalendářem (zkontrolujte číselník Technici).</td></tr>`}</tbody></table></div>`;
  }

  const dolni = s.slot && s.navrhy ? sekceNavrhu(s.slot, s.navrhy, s.zapis, s.casti) : s.technik ? `<p class="muted">Vyberte nahoře volný slot (zelený) – dole se nabídnou zakázky, které ho nejlépe doplní.</p>` : "";
  return stranka("Doplnit technika", uzivatel, stav, `${formular}${horni}${dolni}`, { zalozka: "technik" });
}

const VYHRAZENY = "VOLNY sz – zkrácený slot (změna smlouvy FTTH / servis PIV), nenabízí se";

/** Dvě poslední poznámky z MWF (nejnovější první), zkrácené – aby bylo vidět, co se se zakázkou naposledy dělo */
function posledniPoznamky(zaznamy: PolozkaFronty["z"]["zaznamy"], pocet = 2, delka = 180): string {
  const posledni = zaznamy.slice(-pocet).reverse();
  if (!posledni.length) return `<div class="pozn muted">bez poznámky v MWF</div>`;
  return posledni
    .map((x) => {
      const text = x.text.length > delka ? `${x.text.slice(0, delka - 1)}…` : x.text;
      return `<div class="pozn"><b>${esc(`${fmtDate(x.at).slice(0, 6)} ${fmtTime(x.at)}`)}</b> ${esc(x.autor.replace(/\s*\(Vegacom\)/i, ""))}${x.kody.length ? ` · ${esc(x.kody.join(", "))}` : ""}: ${esc(text)}</div>`;
    })
    .join("");
}

function sekceNavrhu(vyb: VybranySlot, v: NavrhySlotu, zapis: { zapnuty: boolean; smiTechnik: (t: string) => boolean }, casti?: Casti): string {
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
<td class="oid">${idBunka(z)}</td>
<td>${p17Bunka(z)}</td>
<td>${esc(z.zakaznik)}<br><small>${esc(adresaZakazky(z))}</small>${mc(adresaZakazky(z), casti)}${posledniPoznamky(z.zaznamy)}</td>
${prioTd(n.kandidat.priorita)}
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
${v.den.length ? barVytizeni(vytizeniDne(v.den, vyb.technik.jmeno, isoDate(vyb.od)), vyb.eventId) : ""}
${v.chyba ? `<div class="err">${esc(v.chyba)}</div>` : ""}
${info.length ? `<div class="warn">${info.map(esc).join("<br>")}</div>` : ""}
<div class="tbl"><table><thead><tr><th>#</th><th>ID obj. v ext. systému / ID S7 obj.</th><th>P17: Vlastník sítě</th><th>Zákazník / Adresa</th>${prioTh()}<th>Do splnění</th><th>Km navíc</th><th>Proč</th><th></th></tr></thead>
<tbody>${radky.join("") || `<tr><td colspan="9" class="muted">${v.chyba ? "" : "Žádná vhodná zakázka v dosahu (max 75 km zajížďky)."}</td></tr>`}</tbody></table></div>
<p class="muted">Kandidátů ${v.kandidatu} (z toho flex k přesunu ${v.flex}). Pořadí: naléhavost SLA a priorita, pak km navíc oproti trase dne. Zákazníkovi je vždy potřeba zavolat a termín potvrdit.</p>`;
}
