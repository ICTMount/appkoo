// Konfigurace (jen správce): číselníky – přehled, obsah, stažení a nahrání CSV s náhledem změn, historie.

import { CISELNIKY, type Ciselnik, type CiselnikId, type Hodnota, type NahledImportu, type Polozka } from "../config/ciselniky.js";
import type { Dotaz } from "../db/db.js";
import { fmtDate, fmtTime } from "../domain/time.js";
import type { StavImportu } from "./data.js";
import { esc, stranka } from "./html.js";

/** Pořadí číselníků v Konfiguraci */
export const PORADI_CISELNIKU: CiselnikId[] = [
  "koordinatorky", "technici", "blokovaneLokality", "nastaveniPlanovani", "typyAkci", "regiony", "pravidlaPriority", "nastaveniKontaktu", "kontakty",
];

const POPIS: Partial<Record<CiselnikId, string>> = {
  koordinatorky: "Kdo smí do aplikace a s jakou rolí (správce / koordinátorka / jen čtení); iniciály do názvu události v kalendáři.",
  technici: "Koho plánovat: kalendář, adresy výjezdu, typy akcí (FTTH / PIV / SAT/TV), aktivní.",
  blokovaneLokality: "Adresy, kam se neplánuje (např. CETIN hard blacklist).",
  nastaveniPlanovani: "Limity a váhy plánovače: max. zajížďka, zaplnění dne, SLA, preferované okno, horizont nabídky.",
  typyAkci: "Typy aktivit z MWF, skupina a délka práce.",
  regiony: "Regiony a jejich subregiony / PSČ.",
  pravidlaPriority: "Pravidla priority P1–P0 (pořadí podmínek).",
  nastaveniKontaktu: "Pokusy, SMS, okno volání (minimum normy TMCZ nejde snížit).",
  kontakty: "Telefonní čísla a adresy (linka 4000, PEP, CETIN…).",
};

export interface PrehledCiselniku {
  id: CiselnikId;
  aktivnich: number;
  celkem: number;
  posledni: { kdy: Date; zmenil: string } | null;
}

export async function nactiPrehled(db: Dotaz): Promise<PrehledCiselniku[]> {
  const [pocty, zmeny] = await Promise.all([
    db.query<{ ciselnik: string; aktivnich: number; celkem: number }>(
      "SELECT ciselnik, count(*) FILTER (WHERE aktivni)::int AS aktivnich, count(*)::int AS celkem FROM ciselnik_polozka GROUP BY ciselnik",
    ),
    db.query<{ ciselnik: string; kdy: Date; zmenil: string }>(
      "SELECT DISTINCT ON (ciselnik) ciselnik, kdy, zmenil FROM ciselnik_zmena ORDER BY ciselnik, kdy DESC",
    ),
  ]);
  return PORADI_CISELNIKU.map((id) => {
    const p = pocty.rows.find((r) => r.ciselnik === id);
    const z = zmeny.rows.find((r) => r.ciselnik === id);
    return { id, aktivnich: p?.aktivnich ?? 0, celkem: p?.celkem ?? 0, posledni: z ? { kdy: new Date(z.kdy), zmenil: z.zmenil } : null };
  });
}

export interface ZmenaCiselniku {
  kdy: Date;
  klic: string;
  akce: "pridano" | "zmeneno" | "odebrano";
  zdroj: string;
  zmenil: string;
}

export async function nactiHistorii(db: Dotaz, id: CiselnikId, pocet = 50): Promise<ZmenaCiselniku[]> {
  const { rows } = await db.query<ZmenaCiselniku>(
    "SELECT kdy, klic, akce, zdroj, zmenil FROM ciselnik_zmena WHERE ciselnik = $1 ORDER BY kdy DESC, id DESC LIMIT $2",
    [id, pocet],
  );
  return rows.map((r) => ({ ...r, kdy: new Date(r.kdy) }));
}

/** Položky včetně neaktivních (pro zobrazení v Konfiguraci) */
export async function nactiPolozky(db: Dotaz, id: CiselnikId): Promise<{ data: Polozka; aktivni: boolean }[]> {
  const { rows } = await db.query<{ data: Polozka; aktivni: boolean }>(
    "SELECT data, aktivni FROM ciselnik_polozka WHERE ciselnik = $1 ORDER BY aktivni DESC, klic",
    [id],
  );
  return rows;
}

// Čas z DB (timestamptz) se zobrazí v pražském čase
const praha = (d: Date) => {
  const p = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Prague" }));
  const u = new Date(Date.UTC(p.getFullYear(), p.getMonth(), p.getDate(), p.getHours(), p.getMinutes()));
  return `${fmtDate(u)} ${fmtTime(u)}`;
};

const hodnota = (v: Hodnota | undefined) =>
  v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "ano" : "ne") : String(v);

const AKCE: Record<ZmenaCiselniku["akce"], string> = { pridano: "přidáno", zmeneno: "změněno", odebrano: "deaktivováno" };

export function strankaKonfigurace(prehled: PrehledCiselniku[], stav: StavImportu, uzivatel: string): string {
  const radky = prehled.map((p) => {
    const def = CISELNIKY[p.id];
    return `<tr><td><a href="/konfigurace/${p.id}"><b>${esc(def.nazev)}</b></a><br><small class="muted">${esc(POPIS[p.id] ?? "")}</small></td>
<td class="nowrap">${p.aktivnich}${p.celkem !== p.aktivnich ? ` <small class="muted">(+${p.celkem - p.aktivnich} neaktivních)</small>` : ""}</td>
<td class="nowrap">${p.posledni ? `${esc(praha(p.posledni.kdy))}<br><small class="muted">${esc(p.posledni.zmenil)}</small>` : `<span class="muted">–</span>`}</td>
<td class="nowrap"><a href="/konfigurace/${p.id}">upravit</a> · <a href="/konfigurace/${p.id}/csv">stáhnout CSV</a></td></tr>`;
  });
  const telo = `<h1>Konfigurace <small>číselníky a uživatelé – změny přes CSV s náhledem, každá změna se zapisuje do historie</small></h1>
<div class="tbl"><table><thead><tr><th>Číselník</th><th>Položek</th><th>Poslední změna</th><th></th></tr></thead><tbody>${radky.join("")}</tbody></table></div>
<p class="muted">Postup: stáhněte CSV → upravte v Excelu (uložit jako „CSV UTF-8 (oddělený středníkem)“) → nahrajte → zkontrolujte náhled → Uložit.</p>`;
  return stranka("Konfigurace", uzivatel, stav, telo, { zalozka: "konfigurace" });
}

function napovedaSloupcu(def: Ciselnik): string {
  return def.sloupce
    .map((s) => {
      const typ = s.typ === "vyber" ? `jedna z: ${(s.hodnoty ?? []).filter(Boolean).join(", ")}` : s.typ === "seznam" ? "seznam oddělený čárkou" : s.typ === "anoNe" ? "ano / ne (prázdné = ano)" : s.typ === "cislo" ? "číslo" : "text";
      return `<tr><td><b>${esc(s.nazev)}</b>${s.povinny ? " *" : ""}${s.klic === def.klic ? ` <small class="muted">(klíč řádku)</small>` : ""}</td><td><small>${esc(typ)}</small></td></tr>`;
    })
    .join("");
}

export function strankaCiselniku(
  id: CiselnikId,
  polozky: { data: Polozka; aktivni: boolean }[],
  historie: ZmenaCiselniku[],
  zprava: string | null,
  stav: StavImportu,
  uzivatel: string,
): string {
  const def = CISELNIKY[id];
  const hlavicka = def.sloupce.map((s) => `<th>${esc(s.nazev)}</th>`).join("");
  const radky = polozky.map(
    (p) => `<tr${p.aktivni ? "" : ` class="muted"`}>${def.sloupce.map((s) => `<td>${esc(hodnota(p.data[s.klic]))}</td>`).join("")}</tr>`,
  );
  const hist = historie
    .map((h) => `<tr><td class="nowrap">${esc(praha(h.kdy))}</td><td>${esc(AKCE[h.akce])}</td><td>${esc(h.klic)}</td><td><small>${esc(h.zdroj)}</small></td><td><small>${esc(h.zmenil)}</small></td></tr>`)
    .join("");
  const telo = `<p><a href="/konfigurace">← Konfigurace</a></p>
<h1>${esc(def.nazev)} <small>${polozky.filter((p) => p.aktivni).length} aktivních</small></h1>
${zprava ? `<div class="ok">${esc(zprava)}</div>` : ""}
<p class="muted">${esc(POPIS[id] ?? "")}</p>
<div class="grid">
<div class="card"><h2>Nahrát CSV</h2>
<form method="post" action="/konfigurace/${id}/nahled" enctype="multipart/form-data">
<p><input type="file" name="soubor" accept=".csv,text/csv" required></p>
<label class="check"><input type="checkbox" name="nahradit" value="ano"> Položky, které v CSV chybí, deaktivovat (jinak zůstanou beze změny)</label>
<p><button class="btn">Zobrazit náhled změn</button> · <a href="/konfigurace/${id}/csv">stáhnout aktuální CSV</a></p>
</form>
<p class="muted">Nic se neuloží, dokud náhled nepotvrdíte. Na pořadí sloupců nezáleží; chybějící sloupec u existujících řádků zůstane beze změny.</p></div>
<div class="card"><h2>Sloupce</h2><table class="male"><tbody>${napovedaSloupcu(def)}</tbody></table><p class="muted">* povinné</p></div>
</div>
<h2 class="sekce">Obsah</h2>
<div class="tbl"><table><thead><tr>${hlavicka}</tr></thead><tbody>${radky.join("") || `<tr><td colspan="${def.sloupce.length}" class="muted">Zatím prázdné${id === "nastaveniPlanovani" || id === "nastaveniKontaktu" ? " – platí výchozí hodnoty (stáhněte CSV jako šablonu)" : ""}.</td></tr>`}</tbody></table></div>
<h2 class="sekce">Historie změn</h2>
<div class="tbl"><table class="male"><thead><tr><th>Kdy</th><th>Akce</th><th>Položka</th><th>Zdroj</th><th>Kdo</th></tr></thead><tbody>${hist || `<tr><td colspan="5" class="muted">bez změn</td></tr>`}</tbody></table></div>`;
  return stranka(def.nazev, uzivatel, stav, telo, { zalozka: "konfigurace" });
}

export function strankaNahledu(id: CiselnikId, n: NahledImportu, csvBase64: string, soubor: string, nahradit: boolean, stav: StavImportu, uzivatel: string): string {
  const def = CISELNIKY[id];
  const klic = (p: Polozka) => esc(hodnota(p[def.klic]));
  const chyby = n.chyby
    .map((c) => `<li class="${c.zavaznost === "chyba" ? "" : "muted"}"><b>${c.zavaznost === "chyba" ? "CHYBA" : "pozor"}</b> ř. ${c.radek}${c.sloupec ? ` (${esc(c.sloupec)})` : ""}: ${esc(c.zprava)}</li>`)
    .join("");
  const telo = `<p><a href="/konfigurace/${id}">← ${esc(def.nazev)}</a></p>
<h1>Náhled importu <small>${esc(def.nazev)} · ${esc(soubor)}</small></h1>
<div class="grid">
<div class="card"><h2>Souhrn</h2><dl>
<dt>Řádků v CSV</dt><dd>${n.polozky.length}</dd>
<dt>Nové</dt><dd><b>${n.nove.length}</b></dd>
<dt>Změněné</dt><dd><b>${n.zmenene.length}</b></dd>
<dt>Beze změny</dt><dd>${n.bezeZmeny}</dd>
<dt>V CSV chybí</dt><dd>${n.chybiVCsv.length}${n.chybiVCsv.length ? (nahradit ? " → <b>deaktivují se</b>" : " → zůstanou beze změny") : ""}</dd>
</dl></div>
${chyby ? `<div class="card"><h2>Chyby a upozornění</h2><ul>${chyby}</ul></div>` : ""}
</div>
${n.nove.length ? `<h2 class="sekce">Nové</h2><p>${n.nove.map(klic).join(", ")}</p>` : ""}
${n.zmenene.length ? `<h2 class="sekce">Změněné</h2><ul>${n.zmenene.map((z) => `<li><b>${klic(z.po)}</b>: ${z.sloupce.map((s) => esc(s)).join(", ")}</li>`).join("")}</ul>` : ""}
${n.chybiVCsv.length ? `<h2 class="sekce">V CSV chybí</h2><p>${n.chybiVCsv.map(klic).join(", ")}</p>` : ""}
${
  n.lzeUlozit
    ? `<form method="post" action="/konfigurace/${id}/ulozit"><input type="hidden" name="csv" value="${esc(csvBase64)}"><input type="hidden" name="soubor" value="${esc(soubor)}">${nahradit ? `<input type="hidden" name="nahradit" value="ano">` : ""}
<p><button class="btn"${n.nove.length + n.zmenene.length + (nahradit ? n.chybiVCsv.length : 0) ? "" : " disabled"}>Uložit změny</button> · <a href="/konfigurace/${id}">zrušit</a></p></form>`
    : `<div class="err">Import obsahuje chyby – opravte CSV a nahrajte znovu.</div>`
}`;
  return stranka("Náhled importu", uzivatel, stav, telo, { zalozka: "konfigurace" });
}
