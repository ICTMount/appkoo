// Stránka „Kontrola MWF ↔ kalendář“: nesoulady z posledního běhu kontroly (zlaté pravidlo č. 1 –
// termín v MWF a v kalendáři technika musí být 100% shodný: technik, datum, čas, zákazník).

import { fmtDate, fmtTime } from "../domain/time.js";
import type { RadekKontroly, ZavaznostRadku } from "../gcal/kontrolaDb.js";
import type { StavImportu } from "./data.js";
import { esc, stranka } from "./html.js";

const POPIS: Record<Exclude<ZavaznostRadku, "shoda">, { text: string; trida: string; vysvetleni: string }> = {
  rozpor: { text: "Rozpor", trida: "c-cerv", vysvetleni: "jiný technik, den nebo čas – nebo termín v kalendáři chybí. Opravit hned." },
  jen_kalendar: { text: "Jen v kalendáři", trida: "c-oranz", vysvetleni: "událost zakázky, která v MWF tento termín nemá (stará, zdvojená nebo nezapsaná v MWF)." },
  admin: { text: "Zápis", trida: "", vysvetleni: "termín sedí, ale v události chybí nebo se liší telefon, adresa, jméno zákazníka nebo konec okna." },
};

const dt = (d: Date | null) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : "–");

export function strankaKontroly(radky: (RadekKontroly & { zkontrolovano: Date })[], filtr: ZavaznostRadku | "", stav: StavImportu, uzivatel: string): string {
  const pocty = { rozpor: 0, jen_kalendar: 0, admin: 0 } as Record<Exclude<ZavaznostRadku, "shoda">, number>;
  for (const r of radky) if (r.zavaznost !== "shoda") pocty[r.zavaznost]++;
  const kdy = radky[0]?.zkontrolovano;
  const vybrane = filtr ? radky.filter((r) => r.zavaznost === filtr) : radky;

  const filtry = (["", "rozpor", "jen_kalendar", "admin"] as const)
    .map((f) => {
      const pocet = f ? pocty[f] : radky.length;
      const nazev = f ? POPIS[f].text : "Vše";
      return `<a class="${f === filtr ? "on" : ""}" href="/kontrola${f ? `?z=${f}` : ""}">${esc(nazev)} (${pocet})</a>`;
    })
    .join("");

  const tbody = vybrane
    .map((r) => {
      const p = POPIS[r.zavaznost as Exclude<ZavaznostRadku, "shoda">];
      const zak = r.idAktivity ? `<a href="/zakazka/${encodeURIComponent(r.idAktivity)}">${esc(r.objednavka)}</a>` : esc(r.objednavka);
      const kal = r.odkaz ? `<a href="${esc(r.odkaz)}" target="_blank" rel="noopener">${esc(dt(r.terminKal))}</a>` : esc(dt(r.terminKal));
      return `<tr><td class="${p.trida} nowrap">${esc(p.text)}</td><td class="nowrap">${zak}</td><td>${esc(r.zakaznik)}</td><td>${esc(r.technik)}</td>
<td class="nowrap">${esc(dt(r.terminMwf))}</td><td class="nowrap">${kal}</td><td>${r.problemy.map(esc).join("<br>")}</td></tr>`;
    })
    .join("");

  const telo = `<h1>Kontrola MWF ↔ kalendář <small>${kdy ? `poslední kontrola ${esc(dt(kdy))} · termíny od dneška na 14 dní` : "kontrola zatím neproběhla (spouští ji import po synchronizaci kalendářů)"}</small></h1>
<p class="muted">Zlaté pravidlo: termín v MWF a v kalendáři technika musí být 100% shodný (technik, datum, čas, zákazník).
${(["rozpor", "jen_kalendar", "admin"] as const).map((z) => `<br><b>${esc(POPIS[z].text)}</b> – ${esc(POPIS[z].vysvetleni)}`).join("")}</p>
<div class="rychle">${filtry}</div>
<div class="tbl"><table><thead><tr><th>Stav</th><th>Zakázka</th><th>Zákazník</th><th>Technik</th><th>Termín MWF</th><th>Kalendář</th><th>Co nesedí</th></tr></thead>
<tbody>${tbody || `<tr><td colspan="7" class="muted">${kdy ? "Bez nesouladů – MWF a kalendáře se shodují." : "Zatím žádná data."}</td></tr>`}</tbody></table></div>`;
  return stranka("Kontrola MWF ↔ kalendář", uzivatel, stav, telo, { zalozka: "kontrola" });
}
