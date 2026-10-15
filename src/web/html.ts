// HTML stránky webového rozhraní (vykreslují se na serveru, bez JavaScriptu na klientu).
// Zakázka se vždy označuje ID O- (ID obj. v ext. systéme); S7 je doplňkové.

import { fmtDate, fmtTime, isoDate } from "../domain/time.js";
import { PRIORITY, type Priorita } from "../domain/priorita.js";
import type { Detail, Filtr, Fronta, PolozkaFronty, StavImportu } from "./data.js";
import { pokusyZakazky } from "./data.js";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** MWF dává před čísla „=“ (ochrana proti Excelu) – pro zobrazení pryč */
export const bezRovna = (s: string | null | undefined) => (s ?? "").replace(/^=+/, "").trim();

const dt = (d: Date | null | undefined) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : "");
const den = (d: Date | null | undefined) => (d ? fmtDate(d) : "");
const denIso = (d: string | null) => (d ? fmtDate(d) : "");

const POPIS_PRIORITY: Record<Priorita, string> = { P1: "volat dnes", P2: "volat", P3: "později", P0: "nevolat" };

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
@media (prefers-color-scheme:dark){:root{--bg:#161615;--panel:#1f1f1d;--text:#ecebe6;--muted:#a3a29c;--line:#34332f;
--accent:#7fa8ff;--p1:#ff6b6b;--p2:#ffab40;--p3:#9ccc65;--p0:#9a9993;--warn-bg:#3a2c12;--warn:#ffcc80}}
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
`;

function stranka(titulek: string, uzivatel: string, stav: StavImportu, telo: string): string {
  const stary = stav.stariHodin !== null && stav.stariHodin > 6;
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulek)} – AppKoo</title><style>${CSS}</style></head><body>
<header><a class="logo" href="/">AppKoo</a><a href="/">Fronta k volání</a>
<form action="/hledat" method="get" style="display:flex;gap:6px"><input name="q" placeholder="O-…, S7, ID aktivity" aria-label="Najít zakázku"><button>Najít</button></form>
<div class="info">${esc(uzivatel)}<br>Export MWF: ${esc(dt(stav.posledniExport) || "zatím žádný")}${stav.stariHodin !== null ? ` (před ${esc(stav.stariHodin)} h)` : ""}</div></header>
<main>${stary ? `<div class="warn">Poslední importovaný export MWF je starý ${esc(stav.stariHodin)} h – data nemusí být aktuální.</div>` : ""}${telo}</main></body></html>`;
}

function odkazFiltru(f: Filtr, zmena: Partial<Filtr>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...zmena })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

function moznosti(hodnoty: string[], vybrano: string | undefined, prazdna: string): string {
  return [`<option value="">${esc(prazdna)}</option>`, ...hodnoty.map((h) => `<option${h === vybrano ? " selected" : ""}>${esc(h)}</option>`)].join("");
}

export function strankaFronty(fronta: Fronta, filtr: Filtr, stav: StavImportu, uzivatel: string, now: Date): string {
  const soucet = PRIORITY.reduce((n, p) => n + fronta.pocty[p], 0);
  const tabs = [
    `<a href="${esc(odkazFiltru(filtr, { priorita: undefined }))}" class="${filtr.priorita ? "" : "on"}">Vše<b>${soucet}</b></a>`,
    ...PRIORITY.map(
      (p) =>
        `<a href="${esc(odkazFiltru(filtr, { priorita: p }))}" class="${filtr.priorita === p ? "on" : ""}"><span class="prio ${p}">${p}</span> ${esc(POPIS_PRIORITY[p])}<b>${fronta.pocty[p]}</b></a>`,
    ),
  ].join("");

  const MAX = 500;
  const radky = fronta.polozky.slice(0, MAX).map((p) => {
    const z = p.z;
    const tel = z.telefony[0];
    return `<tr>
<td><span class="prio ${p.priorita}">${p.priorita}</span></td>
<td class="oid"><a href="/zakazka/${encodeURIComponent(z.idAktivity)}">${esc(z.idObjednavky || z.idAktivity)}</a>${bezRovna(z.idS7) ? `<br><small>${esc(bezRovna(z.idS7))}</small>` : ""}</td>
<td>${esc(z.zakaznik)}${z.adresa ? `<br><small>${esc(z.adresa)}${bezRovna(z.psc) ? `, ${esc(bezRovna(z.psc))}` : ""}</small>` : ""}</td>
<td class="nowrap">${tel ? `<a href="tel:${esc(tel.replace(/\s/g, ""))}">${esc(tel)}</a>` : ""}</td>
<td>${esc(z.typAktivity)}<br><small>${esc(z.infrastruktura)}</small></td>
<td>${esc(z.subregion)}<br><small>${esc(z.technik)}</small></td>
<td>${esc(stavKontaktu(p, now))}${p.dalsiKontakt ? `<br><small>kontakt ${esc(denIso(p.dalsiKontakt))}</small>` : ""}</td>
<td>${esc(z.parkovani ?? "")}${z.termin ? `<br><small>termín ${esc(dt(z.termin.od))}</small>` : ""}</td>
<td><small>${esc(p.duvod)}</small></td></tr>`;
  });

  const telo = `<h1>Fronta k volání <small>${fronta.polozky.length} zakázek${fronta.polozky.length !== fronta.celkem ? ` z ${fronta.celkem} otevřených` : ""}</small></h1>
<form class="filtr" method="get" action="/">
<label>Fronta / technik<select name="zdroj">${moznosti(fronta.zdroje, filtr.zdroj, "všichni")}</select></label>
<label>Subregión<select name="subregion">${moznosti(fronta.subregiony, filtr.subregion, "všechny")}</select></label>
<label>Hledat<input name="hledat" value="${esc(filtr.hledat ?? "")}" placeholder="O-ID, jméno, adresa, telefon"></label>
${filtr.priorita ? `<input type="hidden" name="priorita" value="${esc(filtr.priorita)}">` : ""}
<button>Filtrovat</button>${filtr.zdroj || filtr.subregion || filtr.hledat || filtr.priorita ? ` <a href="/">zrušit filtr</a>` : ""}</form>
<div class="tabs">${tabs}</div>
<div class="tbl"><table><thead><tr><th>Priorita</th><th>ID O- / S7</th><th>Zákazník / adresa</th><th>Telefon</th><th>Typ</th><th>Subregión / zdroj</th><th>Kontakt</th><th>Parkování / termín</th><th>Proč</th></tr></thead>
<tbody>${radky.join("") || `<tr><td colspan="9" class="muted">Žádná zakázka neodpovídá filtru.</td></tr>`}</tbody></table></div>
${fronta.polozky.length > MAX ? `<p class="muted">Zobrazeno prvních ${MAX} z ${fronta.polozky.length} – zužte filtr.</p>` : ""}`;

  return stranka("Fronta k volání", uzivatel, stav, telo);
}

export function strankaDetailu(d: Detail, stav: StavImportu, uzivatel: string, now: Date): string {
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

  const historie = d.historie
    .map(
      (h) => `<tr><td class="nowrap">${esc(dt(h.export_at))}</td><td>${esc(h.stav_mwf)}</td><td>${esc(h.parkovani ?? "")}</td><td>${esc(h.vysledek ?? "")}</td><td>${esc(dt(h.termin_od))}</td><td>${esc(h.technik ?? "")}</td></tr>`,
    )
    .join("");

  const telo = `<p><a href="/">← Fronta</a></p>
<h1>${esc(z.idObjednavky || z.idAktivity)} <small>${esc(z.zakaznik)}${bezRovna(z.idS7) ? ` · S7 ${esc(bezRovna(z.idS7))}` : ""} · aktivita ${esc(z.idAktivity)}</small></h1>
${d.uzavreno ? `<div class="warn">Zakázka už v exportu MWF není (uzavřená ${esc(dt(d.uzavreno))}).</div>` : ""}
<div class="grid">
<div class="card"><h2>Zákazník</h2><dl>
${radek("Jméno", esc(z.zakaznik))}
${radek("Telefon", z.telefony.map((t) => `<a href="tel:${esc(t.replace(/\s/g, ""))}">${esc(t)}</a>`).join(", "))}
${radek("Adresa", esc([z.adresa, bezRovna(z.psc)].filter(Boolean).join(", ")))}
${radek("Subregión", esc(z.subregion))}
${radek("Balík / produkt", esc([z.balik, z.produkt].filter(Boolean).join(" · ")))}
</dl></div>
<div class="card"><h2>Zakázka</h2><dl>
${radek("Priorita", `<span class="prio ${d.priorita}">${d.priorita}</span> ${esc(d.duvod)}`)}
${radek("Typ", esc(`${z.typAktivity} · ${z.infrastruktura}${z.predobjednavka ? " · předobjednávka" : ""}`))}
${radek("Stav MWF", esc(z.stavMwf))}
${radek("Zdroj", esc(z.technik))}
${radek("Přiděleno", esc(dt(z.prideleno)))}
${radek("Termín", esc(z.termin ? `${dt(z.termin.od)} – ${fmtTime(z.termin.do)}` : ""))}
${radek("Parkování", esc([z.parkovani, z.parkovaniSkupina, z.parkovaniNestandardni && `nestandardní: ${z.parkovaniNestandardni}`].filter(Boolean).join(" · ")))}
${radek("Výsledek dojednávání", esc(z.vysledek ?? ""))}
${radek("Preferovaný datum", esc(den(z.preferovanyDatum)))}
${radek("RFS", esc(den(z.rfs)))}
${radek("Do splnění SLA", z.doSplneniMin !== null ? esc(`${Math.round(z.doSplneniMin / 60)} h (k času exportu)`) : "")}
${radek("Marné výjezdy", z.pocetMv ? esc(String(z.pocetMv)) : "")}
</dl></div>
<div class="card"><h2>Kontaktování</h2><dl>
${radek("Stav", esc(stavKontaktu(d, now)))}
${radek("Další kontakt", esc(denIso(d.dalsiKontakt)))}
${radek("Navolané dny", esc(`${d.plan.navolaneDny} (cíl ${d.plan.pokusuDenne} pokus/y denně)`))}
${radek("SMS", esc(`odesláno ${d.plan.sms.odeslano}${d.plan.sms.doporucena ? " · doporučena další" : ""}${d.plan.sms.nejdrive ? ` · nejdřív ${dt(d.plan.sms.nejdrive)}` : ""}`))}
${radek("Pokusy", esc(pokusy.map((p) => `${dt(p.at)} ${p.dovolano ? "dovoláno" : "nedovoláno"}${p.sms ? " + SMS" : ""}`).join("; ")))}
${radek("Upozornění", esc(d.plan.varovani.join("; ")))}
</dl></div>
</div>
${d.souvisejici.length ? `<div class="card" style="margin-top:12px"><h2>Další aktivity se stejným O-ID</h2>${d.souvisejici
    .map((s) => `<div><a href="/zakazka/${encodeURIComponent(s.id_aktivity)}">${esc(s.id_aktivity)}</a> · ${esc(s.typ_aktivity)} · ${esc(s.stav_mwf)}${s.uzavreno ? " · uzavřeno" : ""}</div>`)
    .join("")}</div>` : ""}
<div class="grid" style="margin-top:12px">
<div class="card"><h2>Poznámka MWF (nejnovější nahoře)</h2>${zaznamy || `<span class="muted">bez záznamů</span>`}${z.uvodPoznamky ? `<div class="zaznam"><div class="hl"><b>Úvod poznámky</b></div>${esc(z.uvodPoznamky)}</div>` : ""}</div>
<div class="card"><h2>Historie změn mezi exporty</h2><div class="tbl" style="border:0"><table><thead><tr><th>Export</th><th>Stav</th><th>Parkování</th><th>Výsledek</th><th>Termín</th><th>Zdroj</th></tr></thead><tbody>${historie || `<tr><td colspan="6" class="muted">bez historie</td></tr>`}</tbody></table></div></div>
</div>`;

  return stranka(z.idObjednavky || z.idAktivity, uzivatel, stav, telo);
}

export function strankaVysledkuHledani(dotaz: string, nalezene: { id: string }[], stav: StavImportu, uzivatel: string): string {
  const telo = `<h1>Hledání „${esc(dotaz)}“</h1>${
    nalezene.length
      ? `<ul>${nalezene.map((n) => `<li><a href="/zakazka/${encodeURIComponent(n.id)}">${esc(n.id)}</a></li>`).join("")}</ul>`
      : `<p>Nic nenalezeno. Zkuste celé O-ID (např. O-8553361721), S7 nebo ID aktivity, případně hledání ve <a href="/?hledat=${encodeURIComponent(dotaz)}">frontě</a>.</p>`
  }`;
  return stranka("Hledání", uzivatel, stav, telo);
}

export function strankaChyby(kod: number, zprava: string): string {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${kod} – AppKoo</title><style>${CSS}</style></head>
<body><main><h1>${kod}</h1><p>${esc(zprava)}</p><p><a href="/">Zpět na frontu</a></p></main></body></html>`;
}
