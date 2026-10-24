// Historie aktivit uživatelů (Konfigurace → Historie uživatelů).
// Zapisuje se každý požadavek přihlášeného uživatele, který něco znamená: hledání, otevření zakázky,
// nabídka termínů, zápis do kalendáře, Doplnit technika, Konfigurace a odepřený přístup.
// Zápis je „fire and forget“ – chyba logu nikdy nezastaví práci v aplikaci. Záznamy starší 180 dní se mažou.

import type { Dotaz } from "../db/db.js";
import { fmtDate, fmtTime } from "../domain/time.js";
import type { StavImportu } from "./data.js";
import type { RadekPrehleduNotifikaci } from "../ingest/notifikace.js";
import { esc, stranka } from "./html.js";

export type Akce = "uvod" | "hledani" | "detail" | "terminy" | "formular" | "zapis" | "technik" | "konfigurace" | "ulozeni" | "odepreno";

export const POPIS_AKCE: Record<Akce, string> = {
  uvod: "úvodní stránka",
  hledani: "hledání",
  detail: "detail zakázky",
  terminy: "pozdější termíny",
  formular: "výběr termínu",
  zapis: "zápis do kalendáře",
  technik: "Doplnit technika",
  konfigurace: "Konfigurace",
  ulozeni: "uložení číselníku",
  odepreno: "přístup odepřen",
};

export interface ZaznamLogu {
  email: string;
  akce: Akce;
  objekt?: string | null;
  detail?: string | null;
  stav: number;
}

const TABULKA = `CREATE TABLE IF NOT EXISTS uzivatel_log (
  id      bigserial PRIMARY KEY,
  kdy     timestamptz NOT NULL DEFAULT now(),
  email   text NOT NULL,
  akce    text NOT NULL,
  objekt  text,
  detail  text,
  stav    integer NOT NULL
)`;

let pripraveno: Promise<unknown> | null = null;
const priprav = (db: Dotaz) =>
  (pripraveno ??= db
    .query(TABULKA)
    .then(() => db.query("CREATE INDEX IF NOT EXISTS uzivatel_log_email_kdy ON uzivatel_log (email, kdy DESC)"))
    .catch((e) => {
      pripraveno = null;
      throw e;
    }));

/** Co požadavek znamenal – null = do historie nepatří (přepínač vzhledu, healthz…) */
export function akcePozadavku(metoda: string, url: URL, stav: number): Omit<ZaznamLogu, "email"> | null {
  const p = url.pathname;
  const q = url.searchParams;
  if (stav === 403) return { akce: "odepreno", detail: p, stav };
  if (p === "/") {
    const dotaz = (q.get("q") ?? "").trim();
    return dotaz ? { akce: "hledani", detail: dotaz.slice(0, 200), stav } : { akce: "uvod", stav };
  }
  let m = p.match(/^\/zakazka\/([^/]+)$/);
  if (m) {
    const od = q.get("od");
    return { akce: od ? "terminy" : "detail", objekt: decodeURIComponent(m[1]!), detail: od ? `od ${od}` : null, stav };
  }
  m = p.match(/^\/zakazka\/([^/]+)\/zapis$/);
  if (m) {
    const slot = [q.get("t"), q.get("od") ?? q.get("den")].filter(Boolean).join(" · ");
    return { akce: metoda === "POST" ? "zapis" : "formular", objekt: decodeURIComponent(m[1]!), detail: slot || null, stav };
  }
  if (p === "/technik") {
    const d = [q.get("t") || "přehled dne", q.get("den"), q.get("e") ? "výběr slotu" : ""].filter(Boolean).join(" · ");
    return { akce: "technik", detail: d, stav };
  }
  if (p === "/konfigurace" || p.startsWith("/konfigurace/")) {
    if (p === "/konfigurace/log" || p === "/konfigurace/notifikace") return null; // prohlížení diagnostiky se do historie nepíše
    const u = p.match(/^\/konfigurace\/([A-Za-z]+)\/ulozit$/);
    return u ? { akce: "ulozeni", detail: u[1]!, stav } : { akce: "konfigurace", detail: p.replace(/^\/konfigurace\/?/, "") || "přehled", stav };
  }
  return null;
}

export async function zaznamenej(db: Dotaz, z: ZaznamLogu): Promise<void> {
  try {
    await priprav(db);
    await db.query("INSERT INTO uzivatel_log (email, akce, objekt, detail, stav) VALUES ($1, $2, $3, $4, $5)", [
      z.email.toLowerCase(),
      z.akce,
      z.objekt ?? null,
      z.detail ?? null,
      z.stav,
    ]);
    if (Math.random() < 0.01) await db.query("DELETE FROM uzivatel_log WHERE kdy < now() - interval '180 days'");
  } catch {
    /* log nesmí zastavit práci */
  }
}

export interface SouhrnUzivatele {
  email: string;
  posledni: Date;
  dnes: number;
  tyden: number;
  mesic: number;
  zapisu: number;
  hledani: number;
}

export interface RadekLogu {
  kdy: Date;
  email: string;
  akce: Akce;
  objekt: string | null;
  oid: string | null;
  detail: string | null;
  stav: number;
}

export async function nactiLog(db: Dotaz, filtr: { email?: string; akce?: string; dni: number }) {
  await priprav(db);
  const { rows: souhrn } = await db.query<SouhrnUzivatele>(
    `SELECT email, max(kdy) AS posledni,
            count(*) FILTER (WHERE kdy >= date_trunc('day', now() AT TIME ZONE 'Europe/Prague') AT TIME ZONE 'Europe/Prague')::int AS dnes,
            count(*) FILTER (WHERE kdy >= now() - interval '7 days')::int AS tyden,
            count(*)::int AS mesic,
            count(*) FILTER (WHERE akce = 'zapis' AND stav < 400)::int AS zapisu,
            count(*) FILTER (WHERE akce = 'hledani')::int AS hledani
       FROM uzivatel_log WHERE kdy >= now() - interval '30 days'
      GROUP BY email ORDER BY max(kdy) DESC`,
  );
  const { rows } = await db.query<RadekLogu>(
    `SELECT l.kdy, l.email, l.akce, l.objekt, z.id_objednavky AS oid, l.detail, l.stav
       FROM uzivatel_log l LEFT JOIN zakazka z ON z.id_aktivity = l.objekt
      WHERE l.kdy >= now() - make_interval(days => $1::int)
        AND ($2::text IS NULL OR l.email = $2) AND ($3::text IS NULL OR l.akce = $3)
      ORDER BY l.kdy DESC LIMIT 500`,
    [filtr.dni, filtr.email ?? null, filtr.akce ?? null],
  );
  return { souhrn, zaznamy: rows };
}

const praha = (d: Date) => {
  const p = new Date(new Date(d).toLocaleString("en-US", { timeZone: "Europe/Prague" }));
  const u = new Date(Date.UTC(p.getFullYear(), p.getMonth(), p.getDate(), p.getHours(), p.getMinutes()));
  return `${fmtDate(u)} ${fmtTime(u)}`;
};

export function strankaLogu(
  data: { souhrn: SouhrnUzivatele[]; zaznamy: RadekLogu[] },
  filtr: { email?: string; akce?: string; dni: number },
  stav: StavImportu,
  uzivatel: string,
): string {
  const odkaz = (o: { email?: string; akce?: string; dni?: number }) => {
    const p = new URLSearchParams();
    const e = o.email === undefined ? filtr.email : o.email;
    const a = o.akce === undefined ? filtr.akce : o.akce;
    if (e) p.set("u", e);
    if (a) p.set("a", a);
    p.set("dni", String(o.dni ?? filtr.dni));
    return `/konfigurace/log?${p.toString()}`;
  };
  const souhrn = data.souhrn
    .map(
      (s) => `<tr${s.email === filtr.email ? ` class="vyb"` : ""}><td><a href="${esc(odkaz({ email: s.email }))}"><b>${esc(s.email)}</b></a></td>
<td class="nowrap">${esc(praha(s.posledni))}</td><td>${s.dnes}</td><td>${s.tyden}</td><td>${s.mesic}</td><td>${s.hledani}</td><td>${s.zapisu}</td></tr>`,
    )
    .join("");
  const radky = data.zaznamy
    .map((r) => {
      const obj = r.objekt ? `<a href="/zakazka/${encodeURIComponent(r.objekt)}">${esc(r.oid || r.objekt)}</a>` : "";
      const chyba = r.stav >= 400 ? ` <span class="c-cerv">(${r.stav})</span>` : "";
      return `<tr><td class="nowrap">${esc(praha(r.kdy))}</td><td><a href="${esc(odkaz({ email: r.email }))}">${esc(r.email)}</a></td>
<td class="nowrap">${esc(POPIS_AKCE[r.akce] ?? r.akce)}${chyba}</td><td class="nowrap">${obj}</td><td>${esc(r.detail ?? "")}</td></tr>`;
    })
    .join("");
  const volbyAkce = (Object.keys(POPIS_AKCE) as Akce[])
    .map((a) => `<option value="${a}"${a === filtr.akce ? " selected" : ""}>${esc(POPIS_AKCE[a])}</option>`)
    .join("");
  const volbyUziv = data.souhrn.map((s) => `<option${s.email === filtr.email ? " selected" : ""}>${esc(s.email)}</option>`).join("");
  const telo = `<p><a href="/konfigurace">← Konfigurace</a></p>
<h1>Historie uživatelů <small>kdo co v aplikaci dělal – hledání, zakázky, zápisy do kalendáře, Konfigurace; uchovává se 180 dní</small></h1>
<h2>Posledních 30 dní</h2>
<div class="tbl"><table><thead><tr><th>Uživatel</th><th>Naposledy</th><th>Dnes</th><th>7 dní</th><th>30 dní</th><th>Hledání</th><th>Zápisy do kalendáře</th></tr></thead>
<tbody>${souhrn || `<tr><td colspan="7" class="muted">Zatím žádná aktivita.</td></tr>`}</tbody></table></div>
<h2 style="margin-top:18px">Záznamy</h2>
<form class="filtr" method="get" action="/konfigurace/log">
<label>Uživatel<select name="u"><option value="">– všichni –</option>${volbyUziv}</select></label>
<label>Akce<select name="a"><option value="">– všechny –</option>${volbyAkce}</select></label>
<label>Období<select name="dni">${[1, 7, 30, 90, 180].map((d) => `<option value="${d}"${d === filtr.dni ? " selected" : ""}>${d === 1 ? "dnes a včera" : `${d} dní`}</option>`).join("")}</select></label>
<button>Filtrovat</button>${filtr.email || filtr.akce ? ` <a href="${esc(`/konfigurace/log?dni=${filtr.dni}`)}">zrušit filtr</a>` : ""}
</form>
<div class="tbl"><table><thead><tr><th>Kdy</th><th>Uživatel</th><th>Akce</th><th>Zakázka</th><th>Podrobnosti</th></tr></thead>
<tbody>${radky || `<tr><td colspan="5" class="muted">Nic nenalezeno.</td></tr>`}</tbody></table></div>
${data.zaznamy.length === 500 ? `<p class="muted">Zobrazeno posledních 500 záznamů – zužte filtr.</p>` : ""}`;
  return stranka("Historie uživatelů", uzivatel, stav, telo, { zalozka: "konfigurace" });
}

/** Konfigurace → Notifikační PDF: diagnostika importu PDF ze složky na Drive */
export function strankaNotifikaci(data: { celkem: number; chyb: number; radky: RadekPrehleduNotifikaci[] }, hledat: string, stav: StavImportu, uzivatel: string): string {
  const radky = data.radky
    .map((r) => {
      const pdf = `<a href="https://drive.google.com/file/d/${encodeURIComponent(r.soubor_id)}/view" target="_blank" rel="noopener">${esc(r.nazev)}</a>`;
      const zak = r.zakazka ? `<a href="/zakazka/${encodeURIComponent(r.zakazka)}">${esc(r.zakazka)}</a>` : `<span class="muted">žádná</span>`;
      const stavPdf = r.chyba ? `<span class="c-cerv">${esc(r.chyba)}</span>` : `${r.predpis_radku} ř. předpisu · ${esc(r.cpe_mode ?? "–")} · ${esc(r.zoznam ?? "–")}`;
      return `<tr><td class="nowrap">${pdf}</td><td class="nowrap">${esc(praha(r.vznik))}</td><td>${esc(r.id_aktivity ?? "")}</td><td>${esc(r.id_objednavky ?? "")}</td><td>${esc((r.id_s7 ?? []).join(", "))}</td><td>${zak}</td><td>${stavPdf}</td></tr>`;
    })
    .join("");
  const telo = `<p><a href="/konfigurace">← Konfigurace</a></p>
<h1>Notifikační PDF <small>načteno ${data.celkem} souborů, z toho ${data.chyb} s chybou · složka na Drive se čte při každém běhu importu</small></h1>
<form class="filtr" method="get" action="/konfigurace/notifikace">
<label>Hledat<input type="search" name="q" value="${esc(hledat)}" placeholder="O-…, S7, ID aktivity, název souboru"></label>
<button>Filtrovat</button>${hledat ? ` <a href="/konfigurace/notifikace">zrušit</a>` : ""}
</form>
<div class="tbl"><table><thead><tr><th>Soubor</th><th>Vznik</th><th>MWF ID aktivity</th><th>Identifikátor</th><th>ID S7</th><th>Spárovaná zakázka</th><th>Načteno</th></tr></thead>
<tbody>${radky || `<tr><td colspan="7" class="muted">Nic nenalezeno.</td></tr>`}</tbody></table></div>`;
  return stranka("Notifikační PDF", uzivatel, stav, telo, { zalozka: "konfigurace" });
}
