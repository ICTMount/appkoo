// Notifikační PDF z MWF (složka na Google Drive, soubor = <MWF ID aktivity>.pdf).
// Z textu PDF (pdftotext -layout) se vytáhne „Inštalačný predpis k“ a ze „Zoznam KZ“ jen režim KZ
// (CPE Mode) a seznam kompatibilních zařízení. Výpis se ukáže v detailu zakázky.

import { execFile } from "node:child_process";
import type { drive_v3 } from "@googleapis/drive";
import type { Dotaz } from "../db/db.js";
import { zakladniCisloObjednavky } from "../domain/slovnik.js";
import { bboxZPdf, parsujPriebeh, type RadekPriebehu } from "./priebeh.js";

export interface Notifikace {
  /** MWF ID aktivity (z textu PDF, jinak z názvu souboru) */
  idAktivity: string;
  /** Identifikátor O-… (ID obj. v ext. systému) */
  idObjednavky: string | null;
  /** O-… bez přípon – párování se zakázkou (stačí shoda O-čísla) */
  idObjednavkyZaklad: string | null;
  /** ID S7 z PDF: „ID objednávky/TT“ (1-DDWV6LB) a část za # v Identifikátoru (1-DDWX4YA) – párování s „ID S7 obj.“ */
  idS7: string[];
  /** řádky oddílu „Inštalačný predpis k“ (bez prázdných) */
  predpis: string[];
  /** Zoznam KZ → CPE Mode (Route / Bridge…) */
  cpeMode: string | null;
  /** Zoznam KZ → Zoznam kompatibilných zariadení */
  zoznam: string | null;
  /** Priebeh optický – řádky tabulky (Názov linky, A uzol, Z akcia); null = PDF načteno starší verzí, tabulka se ještě nečetla */
  priebeh: RadekPriebehu[] | null;
  /** Zařízení ze všech oddílů „Zoznam KZ“ (ONT, mesh AP, set-top boxy); null = PDF načteno starší verzí */
  zariadenia: Zariadenie[] | null;
  /** Oddíly PDF po pracovních požadavcích (kombinovaná objednávka má FTTH a IPTV zvlášť); null = načteno starší verzí */
  oddily: OddilNotifikace[] | null;
}

/** Jeden pracovní požadavek v PDF – u kombinované objednávky je nadřazená služba vždy FTTH, IPTV je její část */
export interface OddilNotifikace {
  /** číslo pracovního požadavku („26843734“) */
  pozadavek: string;
  /** FTTH / IPTV / jiné (z „Metóda/popis inst“: optic… / tvoi…) */
  sluzba: "FTTH" | "IPTV" | string;
  /** řádky „Inštalačný predpis k“ tohoto oddílu */
  predpis: string[];
  /** TVoI: účet (Login) a balíček – heslo se nepřenáší, je v PDF */
  tv?: { ucet: string; balicek: string };
}

/** „Inštalačný predpis k“ v úseku řádků (až po „Zoznam KZ:“) */
function predpisZ(radky: string[]): string[] {
  const iPredpis = radky.findIndex((r) => /Inštalačný predpis k/i.test(r));
  const iKz = radky.findIndex((r, i) => i > iPredpis && /Zoznam KZ\s*:/i.test(r));
  const predpis: string[] = [];
  if (iPredpis < 0) return predpis;
  const konec = iKz >= 0 ? iKz + 1 : radky.length;
  for (let i = iPredpis; i < konec; i++) {
    let r = radky[i]!;
    if (i === iPredpis) r = r.slice(r.search(/Inštalačný predpis k/i) + "Inštalačný predpis k".length); // na stejném řádku bývá konec předchozího oddílu
    if (i === iKz) r = r.replace(/Zoznam KZ\s*:[\s\S]*$/i, ""); // „Zoznam KZ:“ bývá na konci posledního řádku poznámky
    const c = uklid(r);
    if (c) predpis.push(c);
  }
  return predpis.filter((p) => p !== "");
}

/** Oddíly PDF: od každého „Pracovní požadavek:“ k dalšímu; bez nich jeden oddíl z celého textu */
export function parsujOddily(radky: string[]): OddilNotifikace[] {
  const zacatky = radky.map((r, i) => (/^\f?Pracovní požadavek\s*:/i.test(r) ? i : -1)).filter((i) => i >= 0);
  const useky = zacatky.length ? zacatky.map((z, k) => radky.slice(z, zacatky[k + 1] ?? radky.length)) : [radky];
  return useky.map((u) => {
    const text = u.join("\n");
    const pozadavek = /Pracovní požadavek\s*:\s*(\d+)/i.exec(text)?.[1] ?? "";
    const metoda = /\b(tvoi|optic|piv|fwa|dsl)\w*(?:\s+\w+){0,2}\s*\//i.exec(text)?.[1]?.toLowerCase();
    const sluzba = metoda === "tvoi" ? "IPTV" : metoda === "optic" ? "FTTH" : metoda ? metoda.toUpperCase() : /Typ technológie\s*:\s*TVoI/i.test(text) ? "IPTV" : "FTTH";
    const ucet = /Id účtu\s*:\s*(\S+)/i.exec(text)?.[1];
    const balicek = /Typ technológie\s*:\s*TVoI[\s\S]*?Názov\s*:\s*([^\n]+)/i.exec(text)?.[1];
    const o: OddilNotifikace = { pozadavek, sluzba, predpis: predpisZ(u) };
    if (sluzba === "IPTV" && ucet) o.tv = { ucet, balicek: uklid(balicek ?? "") };
    return o;
  });
}

/** Jeden řádek tabulky „Zoznam KZ“ */
export interface Zariadenie {
  /** „ONT - Optical Network Terminal“, „AP - Access Point“, „TVoI - Set-top-box“ */
  typ: string;
  /** „4FE 2FX“, „Mesh“, „LAN“ */
  subtyp: string;
  /** Add / Delete / Modify */
  aktivita: string;
  /** Spôsob doručenia: Technik (přiveze technik) / kurýr… */
  doruceni: string;
  model: string;
  druh: "ont" | "mesh" | "stb" | "jine";
}

/** Slova buňky zalomené přes řádky: „Set-top-“ + „box“ → „Set-top-box“, samostatná pomlčka s mezerami */
const spojSlova = (slova: string[]) => slova.reduce((acc, t) => (/\w-$/.test(acc) && t !== "-" ? acc + t : acc ? `${acc} ${t}` : t), "");

const druhZariadenia = (typ: string, subtyp: string): Zariadenie["druh"] =>
  /set-?top|\bSTB\b/i.test(typ) ? "stb" : /mesh/i.test(subtyp) || /access\s*point|^AP\b/i.test(typ) ? "mesh" : /\bONT\b/i.test(typ) ? "ont" : "jine";

/**
 * Všechny oddíly „Zoznam KZ“ (PDF jich má jeden na pracovní požadavek – zvlášť internet, zvlášť TV).
 * Tabulka je v „-layout“ textu po sloupcích; jeden záznam je na 3–5 řádcích se slovem Aktivita (Add/ADD) uprostřed,
 * ostatní řádky se přiřadí k nejbližšímu záznamu.
 */
export function parsujZariadenia(radky: string[]): Zariadenie[] {
  type Sloupec = "model" | "aktivita" | "typ" | "subtyp" | "seriove" | "doruceni" | "vlastnictvo" | "mac" | "cpe" | "zoznam";
  const vysledek: Zariadenie[] = [];
  for (let i = 0; i < radky.length; i++) {
    if (!/Zoznam KZ\s*:/i.test(radky[i]!)) continue;
    const iHl = radky.findIndex((r, j) => j > i && j < i + 6 && /\bAktivita\b/.test(r) && /\bModel\b/.test(r));
    if (iHl < 0) continue;
    // střed slova záhlaví každého sloupce (buňky jsou centrované, slovo patří do sloupce s nejbližším středem);
    // záhlaví posledních sloupců je na více řádcích („Sériove čislo / KZ“, „Sposob / doručenia“, „Zoznam / kompatibilných / zariadení“)
    const stredy = new Map<Sloupec, number>();
    let konecHl = iHl;
    for (let j = Math.max(i + 1, iHl - 2); j < Math.min(radky.length, iHl + 4); j++) {
      for (const s of slova(radky[j]!)) {
        const stred = s.od + s.text.length / 2;
        const t = s.text;
        if (j === iHl && /^Model$/i.test(t)) stredy.set("model", stred);
        else if (j === iHl && /^Aktivita$/i.test(t)) stredy.set("aktivita", stred);
        else if (j === iHl && /^Typ$/i.test(t)) stredy.set("typ", stred);
        else if (j === iHl && /^Subtyp$/i.test(t)) stredy.set("subtyp", stred);
        else if (j === iHl && /^Vlastníctvo$/i.test(t)) stredy.set("vlastnictvo", stred);
        else if (j === iHl && /^Mac$/i.test(t)) stredy.set("mac", stred + 4);
        else if (j === iHl && /^CPE$/i.test(t)) stredy.set("cpe", stred + 3);
        else if (/^Sériove$/i.test(t)) stredy.set("seriove", stred + 3);
        else if (/^Sposob$/i.test(t)) stredy.set("doruceni", stred + 1);
        else if (/^kompatibiln[yý]ch$/i.test(t)) { stredy.set("zoznam", stred); konecHl = Math.max(konecHl, j); }
        else if (/^(KZ|doručenia|zariaden[ií]|Zoznam|čislo)$/i.test(t)) konecHl = Math.max(konecHl, j);
      }
    }
    if (!stredy.has("aktivita") || !stredy.has("typ")) continue;
    // hranice mezi sloupci = polovina mezi středy sousedních záhlaví; slovo patří do sloupce podle svého začátku
    // (buňky jsou centrované, víceslovné hodnoty začínají vlevo od středu – střed slova by u nich klamal)
    const poradi = [...stredy.entries()].sort((x, y) => x[1] - y[1]);
    const sloupec = (s: { od: number; text: string }): Sloupec => {
      let nej: Sloupec = poradi[0]![0];
      for (let k = 1; k < poradi.length; k++) {
        const hranice = (poradi[k - 1]![1] + poradi[k]![1]) / 2;
        if (s.od + Math.min(2, s.text.length / 2) >= hranice) nej = poradi[k]![0];
      }
      return nej;
    };
    // řádky oddílu: až po další oddíl (text od okraje stránky; nová stránka začíná \f) nebo další Zoznam KZ
    const telo: { od: number; text: string }[][] = [];
    for (let j = konecHl + 1; j < radky.length; j++) {
      const r = radky[j]!.replace(/^\f/, "");
      if (/^\S/.test(r) || /Zoznam KZ\s*:/i.test(r)) break;
      telo.push(slova(r));
    }
    const maAkt = (s: { od: number; text: string }[]) => s.some((x) => sloupec(x) === "aktivita" && /^(Add|Delete|Modify|Remove|Pridaj|Zru[sš]|Zme[nň])/i.test(x.text));
    const maTyp = (s: { od: number; text: string }[]) => s.some((x) => sloupec(x) === "typ");
    // záznam = řádek se slovem Aktivita + řádky s textem Typu těsně nad ním + vše pod ním až k dalšímu záznamu
    const zacatky: number[] = [];
    telo.forEach((s, j) => {
      if (!maAkt(s)) return;
      let z = j;
      const predchozi = zacatky.length ? zacatky[zacatky.length - 1]! : -1;
      const predchoziAkt = zacatky.length ? telo.findIndex((t, q) => q >= predchozi && maAkt(t)) : -1;
      // nahoru jen přes řádky, které jsou blíž tomuto záznamu než předchozímu (text buňky je svisle centrovaný kolem řádku s Aktivitou)
      while (z - 1 > predchozi && telo[z - 1]!.length && maTyp(telo[z - 1]!) && !maAkt(telo[z - 1]!) && (predchoziAkt < 0 || j - (z - 1) < (z - 1) - predchoziAkt)) z--;
      zacatky.push(z);
    });
    if (!zacatky.length) { i = konecHl; continue; }
    zacatky.forEach((od, k) => {
      const do_ = k + 1 < zacatky.length ? zacatky[k + 1]! : telo.length;
      const z = { typ: [] as string[], subtyp: [] as string[], aktivita: [] as string[], doruceni: [] as string[], model: [] as string[] };
      for (let j = od; j < do_; j++) {
        for (const x of telo[j]!) {
          const c = sloupec(x);
          if (c === "typ") z.typ.push(x.text);
          else if (c === "subtyp") z.subtyp.push(x.text);
          else if (c === "aktivita") z.aktivita.push(x.text);
          else if (c === "doruceni") z.doruceni.push(x.text);
          else if (c === "zoznam") z.model.push(x.text);
        }
      }
      const typ = spojSlova(z.typ);
      const subtyp = z.subtyp.join(" ");
      vysledek.push({ typ, subtyp, aktivita: z.aktivita.join(" "), doruceni: z.doruceni.join(" "), model: z.model.join(" ").replace(/\s*\|\s*/g, " | ").trim(), druh: druhZariadenia(typ, subtyp) });
    });
    i = konecHl;
  }
  return vysledek;
}

export interface UlozenaNotifikace extends Notifikace {
  souborId: string;
  nazev: string;
  vznik: Date;
}

const ZNAME_REZIMY = /^(route|routed|router|bridge|bridged)$/i;

/** Slova řádku s pozicí (sloupcem), ve které začínají – pro čtení tabulky z „-layout“ textu. */
function slova(radek: string): { od: number; text: string }[] {
  const v: { od: number; text: string }[] = [];
  for (const m of radek.matchAll(/\S+/g)) v.push({ od: m.index, text: m[0] });
  return v;
}

const uklid = (s: string) => s.replace(/\s+/g, " ").trim();

/** Režim KZ a kompatibilní zařízení ze „Zoznam KZ“. Nejdřív podle sloupců tabulky, jinak podle známých hodnot. */
export function parsujKz(radky: string[]): { cpeMode: string | null; zoznam: string | null } {
  const iHlavicka = radky.findIndex((r) => /CPE\s+Mode/i.test(r));
  if (iHlavicka >= 0) {
    const cpeOd = radky[iHlavicka]!.search(/CPE\s+Mode/i);
    // záhlaví posledního sloupce je na víc řádcích („Zoznam / kompatibilných / zariadení“) – vzít nejlevější začátek
    let zozOd = Infinity;
    let konecHlavicky = iHlavicka;
    for (let i = Math.max(0, iHlavicka - 3); i < Math.min(radky.length, iHlavicka + 4); i++) {
      for (const s of slova(radky[i]!)) {
        if (/^(Zoznam|kompatibiln[yý]ch|zariaden[ií])$/i.test(s.text) && s.od > cpeOd) {
          zozOd = Math.min(zozOd, s.od);
          konecHlavicky = Math.max(konecHlavicky, i);
        }
      }
    }
    if (zozOd === Infinity) zozOd = cpeOd + 12;
    const cpe: string[] = [];
    const zoz: string[] = [];
    for (const r of radky.slice(konecHlavicky + 1)) {
      for (const s of slova(r)) {
        if (s.od >= zozOd - 2) zoz.push(s.text);
        else if (s.od >= cpeOd - 2) cpe.push(s.text);
      }
    }
    if (cpe.length || zoz.length) {
      // do sloupce CPE Mode občas spadnou i slova z okolí („Spôsob inštalácie Technik“) – když je tam známý režim, vzít jen ten
      const rezim = cpe.find((t) => ZNAME_REZIMY.test(t));
      return { cpeMode: rezim ?? (cpe.join(" ") || null), zoznam: zoz.join(" ") || null };
    }
  }
  // text bez sloupců (např. slitý do jednoho řádku): režim je známé slovo, zařízení jsou za ním
  const tokeny = uklid(radky.join(" ")).split(" ");
  const iZariadeni = tokeny.findIndex((t) => /^zariaden[ií]$/i.test(t));
  const iRezim = tokeny.findIndex((t, i) => i > iZariadeni && ZNAME_REZIMY.test(t));
  if (iRezim < 0) return { cpeMode: null, zoznam: null };
  return { cpeMode: tokeny[iRezim]!, zoznam: tokeny.slice(iRezim + 1).join(" ") || null };
}

/** Rozbor textu notifikačního PDF (výstup `pdftotext -layout`). null = není notifikace z MWF. */
export function parsujNotifikaci(text: string, nazevSouboru = "", bboxHtml = ""): Notifikace | null {
  const radky = text.split(/\r?\n/);
  const idZTextu = text.match(/MWF ID aktivity:\s*(\d+)/)?.[1] ?? null;
  const idZNazvu = nazevSouboru.match(/^(\d+)\.pdf$/i)?.[1] ?? null;
  const idAktivity = idZTextu ?? idZNazvu;
  if (!idAktivity) return null;
  const idObjednavky = text.match(/Identifikátor:\s*(O-[\w#-]+)/)?.[1] ?? text.match(/\b(O-\d{6,})\b/)?.[1] ?? null;
  const idS7 = [...new Set([
    ...[...text.matchAll(/ID objednávky(?:\/TT)?:\s*(1-[A-Z0-9]{6,})/g)].map((m) => m[1]!.toUpperCase()),
    ...[...(idObjednavky ?? "").matchAll(/#(1-[A-Z0-9]{6,})/gi)].map((m) => m[1]!.toUpperCase()),
  ])];

  const iPredpis = radky.findIndex((r) => /Inštalačný predpis k/i.test(r));
  const iKz = radky.findIndex((r, i) => i > iPredpis && /Zoznam KZ\s*:/i.test(r));
  // předpis zakázky = předpis nadřazené služby (FTTH); u kombinované objednávky má IPTV svůj oddíl (viz oddily)
  const oddily = parsujOddily(radky);
  const predpis = (oddily.find((o) => o.sluzba === "FTTH") ?? oddily[0])?.predpis ?? predpisZ(radky);
  const kzRadky = iKz >= 0 ? [radky[iKz]!.replace(/^[\s\S]*?Zoznam KZ\s*:/i, (m) => " ".repeat(m.length)), ...radky.slice(iKz + 1)] : [];
  const { cpeMode, zoznam } = parsujKz(kzRadky);
  return { idAktivity, idObjednavky, idObjednavkyZaklad: idObjednavky ? zakladniCisloObjednavky(idObjednavky) : null, idS7, predpis, cpeMode, zoznam, priebeh: bboxHtml ? parsujPriebeh(bboxHtml) : [], zariadenia: parsujZariadenia(radky), oddily };
}

/** Text PDF přes poppler (`pdftotext -layout`), v image je balík poppler-utils. */
export function textZPdf(pdf: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = execFile("pdftotext", ["-layout", "-enc", "UTF-8", "-", "-"], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      // pdftotext hlásí drobné chyby syntaxe PDF na stderr a přesto text vrátí – stačí nenulový výstup
      if (err && !stdout) reject(new Error(`pdftotext selhal: ${err.message}`));
      else resolve(stdout);
    });
    p.stdin?.on("error", () => undefined);
    p.stdin?.end(pdf);
  });
}

// ---------- uložení a import ----------

const TABULKA = `CREATE TABLE IF NOT EXISTS notifikace_pdf (
  soubor_id     text PRIMARY KEY,
  nazev         text NOT NULL,
  vznik         timestamptz NOT NULL,
  id_aktivity   text,
  id_objednavky text,
  id_objednavky_zaklad text,
  id_s7         text[],
  predpis       text[],
  cpe_mode      text,
  zoznam        text,
  priebeh       jsonb,
  chyba         text,
  nacteno       timestamptz NOT NULL DEFAULT now()
)`;

// příprava tabulky jednou na každé připojení (v testech běží víc databází vedle sebe)
const pripraveno = new WeakMap<Dotaz, Promise<unknown>>();
function priprav(db: Dotaz): Promise<unknown> {
  let p = pripraveno.get(db);
  if (!p) {
    p = db
      .query(TABULKA)
      .then(() => db.query("ALTER TABLE notifikace_pdf ADD COLUMN IF NOT EXISTS id_objednavky_zaklad text"))
      .then(() => db.query("ALTER TABLE notifikace_pdf ADD COLUMN IF NOT EXISTS id_s7 text[]"))
      .then(() => db.query("ALTER TABLE notifikace_pdf ADD COLUMN IF NOT EXISTS priebeh jsonb"))
      .then(() => db.query("ALTER TABLE notifikace_pdf ADD COLUMN IF NOT EXISTS zariadenia jsonb"))
      .then(() => db.query("ALTER TABLE notifikace_pdf ADD COLUMN IF NOT EXISTS oddily jsonb"))
      .then(() => db.query("UPDATE notifikace_pdf SET id_objednavky_zaklad = upper(substring(id_objednavky from '^O-[0-9]+')) WHERE id_objednavky_zaklad IS NULL AND id_objednavky IS NOT NULL"))
      .then(() => db.query("CREATE INDEX IF NOT EXISTS notifikace_pdf_aktivita ON notifikace_pdf (id_aktivity, vznik DESC)"))
      .then(() => db.query("CREATE INDEX IF NOT EXISTS notifikace_pdf_objednavka ON notifikace_pdf (id_objednavky_zaklad, vznik DESC)"))
      .catch((e) => {
        pripraveno.delete(db);
        throw e;
      });
    pripraveno.set(db, p);
  }
  return p;
}

export async function ulozNotifikaci(db: Dotaz, n: UlozenaNotifikace | { souborId: string; nazev: string; vznik: Date; chyba: string }): Promise<void> {
  await priprav(db);
  if ("chyba" in n) {
    await db.query(
      `INSERT INTO notifikace_pdf (soubor_id, nazev, vznik, chyba) VALUES ($1, $2, $3, $4)
       ON CONFLICT (soubor_id) DO UPDATE SET chyba = EXCLUDED.chyba, nacteno = now()`,
      [n.souborId, n.nazev, n.vznik, n.chyba],
    );
    return;
  }
  await db.query(
    `INSERT INTO notifikace_pdf (soubor_id, nazev, vznik, id_aktivity, id_objednavky, id_objednavky_zaklad, id_s7, predpis, cpe_mode, zoznam, priebeh, zariadenia, oddily, chyba)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, NULL)
     ON CONFLICT (soubor_id) DO UPDATE SET id_aktivity = EXCLUDED.id_aktivity, id_objednavky = EXCLUDED.id_objednavky, id_objednavky_zaklad = EXCLUDED.id_objednavky_zaklad,
       id_s7 = EXCLUDED.id_s7, predpis = EXCLUDED.predpis, cpe_mode = EXCLUDED.cpe_mode, zoznam = EXCLUDED.zoznam, priebeh = EXCLUDED.priebeh, zariadenia = EXCLUDED.zariadenia, oddily = EXCLUDED.oddily, chyba = NULL, nacteno = now()`,
    [n.souborId, n.nazev, n.vznik, n.idAktivity, n.idObjednavky, n.idObjednavkyZaklad, n.idS7, n.predpis, n.cpeMode, n.zoznam, JSON.stringify(n.priebeh), JSON.stringify(n.zariadenia ?? []), JSON.stringify(n.oddily ?? [])],
  );
}

/**
 * Nejnovější notifikace k zakázce (null = PDF zatím nedorazilo). Pořadí párování:
 * 1. stejné MWF ID aktivity, 2. ID S7 obj. zakázky je v PDF (ID objednávky/TT nebo část za #), 3. stejné O-číslo.
 */
export async function nactiNotifikaci(db: Dotaz, idAktivity: string, klice: { idObjednavkyZaklad?: string | null; idS7?: string | null } = {}): Promise<UlozenaNotifikace | null> {
  try {
    await priprav(db);
    const zaklad = klice.idObjednavkyZaklad ? zakladniCisloObjednavky(klice.idObjednavkyZaklad) : null;
    const s7 = klice.idS7?.trim().toUpperCase() || null;
    const { rows } = await db.query<{ soubor_id: string; nazev: string; vznik: Date; id_aktivity: string; id_objednavky: string | null; id_objednavky_zaklad: string | null; id_s7: string[] | null; predpis: string[] | null; cpe_mode: string | null; zoznam: string | null; priebeh: RadekPriebehu[] | null; zariadenia: Zariadenie[] | null; oddily: OddilNotifikace[] | null }>(
      `SELECT soubor_id, nazev, vznik, id_aktivity, id_objednavky, id_objednavky_zaklad, id_s7, predpis, cpe_mode, zoznam, priebeh, zariadenia, oddily FROM notifikace_pdf
        WHERE chyba IS NULL AND (id_aktivity = $1 OR ($2::text IS NOT NULL AND $2 = ANY(id_s7)) OR ($3::text IS NOT NULL AND id_objednavky_zaklad = $3))
        ORDER BY (id_aktivity = $1) DESC, ($2::text IS NOT NULL AND $2 = ANY(id_s7)) DESC, vznik DESC LIMIT 1`,
      [idAktivity, s7, zaklad],
    );
    const r = rows[0];
    if (!r) return null;
    return { souborId: r.soubor_id, nazev: r.nazev, vznik: new Date(r.vznik), idAktivity: r.id_aktivity, idObjednavky: r.id_objednavky, idObjednavkyZaklad: r.id_objednavky_zaklad, idS7: r.id_s7 ?? [], predpis: r.predpis ?? [], cpeMode: r.cpe_mode, zoznam: r.zoznam, priebeh: Array.isArray(r.priebeh) ? r.priebeh : null, zariadenia: Array.isArray(r.zariadenia) ? r.zariadenia : null, oddily: Array.isArray(r.oddily) ? r.oddily : null };
  } catch {
    return null; // detail zakázky nesmí spadnout kvůli notifikacím
  }
}

export const MAX_PDF_NA_BEH = 400;

export interface VysledekNotifikaci {
  /** kolik PDF je ve složce vidět (0 = složka je prázdná nebo není nasdílená servisnímu účtu) */
  veSlozce: number;
  nacteno: number;
  chyb: number;
  zprávy: string[];
}

/** Projde složku na Drive, nové PDF stáhne, přečte a uloží. Už zpracované soubory (podle ID) přeskočí. */
export async function importujNotifikace(
  db: Dotaz,
  api: drive_v3.Drive,
  slozkaId: string,
  deps: { textZPdf?: (pdf: Buffer) => Promise<string>; bboxZPdf?: (pdf: Buffer) => Promise<string>; ted?: () => Date } = {},
): Promise<VysledekNotifikaci> {
  await priprav(db);
  const naText = deps.textZPdf ?? textZPdf;
  const naBbox = deps.bboxZPdf ?? bboxZPdf;
  // neúspěšné soubory se po dni zkusí znovu (výpadek Drive apod.); PDF načtená starší verzí (bez tabulky Priebeh,
  // bez sloupce Typ linky v ní, nebo bez zařízení ze Zoznamu KZ) se přečtou znovu
  const { rows } = await db.query<{ soubor_id: string }>(
    `SELECT soubor_id FROM notifikace_pdf
      WHERE (chyba IS NULL AND priebeh IS NOT NULL AND (priebeh = '[]'::jsonb OR priebeh->0 ? 'typLinky') AND zariadenia IS NOT NULL AND oddily IS NOT NULL)
         OR (chyba IS NOT NULL AND nacteno > now() - interval '1 day')`,
  );
  const znama = new Set(rows.map((r) => r.soubor_id));

  const soubory: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await api.files.list({
      q: `'${slozkaId}' in parents and trashed = false and mimeType = 'application/pdf'`,
      orderBy: "createdTime desc",
      pageSize: 100,
      pageToken,
      fields: "nextPageToken,files(id,name,createdTime)",
    });
    soubory.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken && soubory.filter((f) => !znama.has(f.id!)).length < MAX_PDF_NA_BEH);

  const v: VysledekNotifikaci = { veSlozce: soubory.length, nacteno: 0, chyb: 0, zprávy: [] };
  if (!soubory.length) v.zprávy.push("Ve složce není vidět žádné PDF – je složka nasdílená servisnímu účtu jobu jako Čtenář?");
  const fronta = soubory.filter((s) => !znama.has(s.id!)).slice(0, MAX_PDF_NA_BEH);
  // několik souborů najednou (stažení + 2× pdftotext na soubor), ale ne víc – job má omezené CPU
  await Promise.all(
    Array.from({ length: Math.min(SOUBEZNE, fronta.length) }, async () => {
      for (let f = fronta.shift(); f; f = fronta.shift()) {
        const r = await nactiAUloz(db, api, f, { ...deps, ted: deps.ted ? () => deps.ted!().getTime() : undefined });
        if (r.ok) v.nacteno++;
        else {
          v.chyb++;
          v.zprávy.push(`${f.name}: ${r.chyba}`);
        }
      }
    }),
  );
  return v;
}

const SOUBEZNE = 4;

/** Stáhne PDF z Drive, přečte ho a uloží (i s chybou, aby se nestahovalo pořád dokola) */
async function nactiAUloz(
  db: Dotaz,
  api: drive_v3.Drive,
  f: drive_v3.Schema$File,
  deps: { textZPdf?: (pdf: Buffer) => Promise<string>; bboxZPdf?: (pdf: Buffer) => Promise<string>; ted?: () => number },
): Promise<{ ok: true; n: Notifikace } | { ok: false; chyba: string }> {
  const vznik = new Date(f.createdTime ?? (deps.ted ?? Date.now)());
  const nazev = f.name ?? "";
  try {
    const res = await api.files.get({ fileId: f.id!, alt: "media" }, { responseType: "arraybuffer" });
    const pdf = Buffer.from(res.data as ArrayBuffer);
    const [text, bbox] = await Promise.all([(deps.textZPdf ?? textZPdf)(pdf), (deps.bboxZPdf ?? bboxZPdf)(pdf).catch(() => "")]);
    const n = parsujNotifikaci(text, nazev, bbox);
    if (!n) {
      await ulozNotifikaci(db, { souborId: f.id!, nazev, vznik, chyba: "v PDF chybí MWF ID aktivity" });
      return { ok: false, chyba: "není notifikace z MWF" };
    }
    await ulozNotifikaci(db, { ...n, souborId: f.id!, nazev, vznik });
    return { ok: true, n };
  } catch (e) {
    const chyba = e instanceof Error ? e.message : String(e);
    await ulozNotifikaci(db, { souborId: f.id!, nazev, vznik, chyba: chyba.slice(0, 500) }).catch(() => undefined);
    return { ok: false, chyba };
  }
}

export interface RadekPrehleduNotifikaci {
  soubor_id: string;
  nazev: string;
  vznik: Date;
  nacteno: Date;
  id_aktivity: string | null;
  id_objednavky: string | null;
  id_s7: string[] | null;
  cpe_mode: string | null;
  zoznam: string | null;
  predpis_radku: number;
  chyba: string | null;
  /** ID aktivity zakázky v DB, ke které se PDF spáruje (null = zatím k ničemu) */
  zakazka: string | null;
}

/** Přehled pro Konfiguraci: co je načteno, chyby, a jestli se PDF spáruje s nějakou zakázkou. */
export async function prehledNotifikaci(db: Dotaz, hledat?: string): Promise<{ celkem: number; chyb: number; radky: RadekPrehleduNotifikaci[] }> {
  await priprav(db);
  const { rows: [souhrn] } = await db.query<{ celkem: number | string; chyb: number | string }>("SELECT count(*) AS celkem, count(*) FILTER (WHERE chyba IS NOT NULL) AS chyb FROM notifikace_pdf");
  const q = hledat?.trim() ? `%${hledat.trim()}%` : null;
  const { rows } = await db.query<RadekPrehleduNotifikaci>(
    `SELECT n.soubor_id, n.nazev, n.vznik, n.nacteno, n.id_aktivity, n.id_objednavky, n.id_s7, n.cpe_mode, n.zoznam,
            coalesce(array_length(n.predpis, 1), 0)::int AS predpis_radku, n.chyba,
            (SELECT z.id_aktivity FROM zakazka z
              WHERE z.id_aktivity = n.id_aktivity OR (n.id_s7 IS NOT NULL AND upper(z.id_s7) = ANY(n.id_s7)) OR z.id_objednavky_zaklad = n.id_objednavky_zaklad
              ORDER BY (z.id_aktivity = n.id_aktivity) DESC LIMIT 1) AS zakazka
       FROM notifikace_pdf n
      WHERE $1::text IS NULL OR n.nazev ILIKE $1 OR n.id_objednavky ILIKE $1 OR n.id_aktivity ILIKE $1 OR array_to_string(n.id_s7, ' ') ILIKE $1
      ORDER BY n.nacteno DESC LIMIT 200`,
    [q],
  );
  return { celkem: Number(souhrn?.celkem ?? 0), chyb: Number(souhrn?.chyb ?? 0), radky: rows };
}

/** Negativní výsledky dohledání (žádné PDF ve složce) – nehledat na Drive při každém otevření detailu */
const nenalezeno = new Map<string, number>();
const NENALEZENO_MS = 10 * 60_000;

/**
 * Dohledání na vyžádání z webu: když detail zakázky PDF ještě nemá, zkusí ho najít ve složce podle názvu
 * (<MWF ID aktivity>.pdf), stáhnout a uložit hned – nečeká se na další běh importu.
 */
export async function dohledejNotifikaci(
  db: Dotaz,
  api: drive_v3.Drive,
  slozkaId: string,
  idAktivity: string,
  klice: { idObjednavkyZaklad?: string | null; idS7?: string | null } = {},
  deps: { textZPdf?: (pdf: Buffer) => Promise<string>; bboxZPdf?: (pdf: Buffer) => Promise<string>; ted?: () => number } = {},
): Promise<UlozenaNotifikace | null> {
  const ted = deps.ted ?? Date.now;
  if (!/^\d+$/.test(idAktivity)) return null;
  const kdy = nenalezeno.get(idAktivity);
  const stavajici = await nactiNotifikaci(db, idAktivity, klice);
  if (stavajici?.priebeh) return stavajici; // už kompletní
  if (kdy && ted() - kdy < NENALEZENO_MS) return stavajici;
  try {
    let f: drive_v3.Schema$File | undefined;
    if (stavajici) {
      // PDF už máme (jen bez tabulky Priebeh) – přečíst znovu stejný soubor
      f = { id: stavajici.souborId, name: stavajici.nazev, createdTime: stavajici.vznik.toISOString() };
    } else {
      const { data } = await api.files.list({
        q: `'${slozkaId}' in parents and trashed = false and name = '${idAktivity}.pdf'`,
        orderBy: "createdTime desc",
        pageSize: 3,
        fields: "files(id,name,createdTime)",
      });
      f = data.files?.[0];
    }
    if (!f?.id) {
      nenalezeno.set(idAktivity, ted());
      return null;
    }
    const r = await nactiAUloz(db, api, f, deps);
    return r.ok ? nactiNotifikaci(db, idAktivity, klice) : stavajici;
  } catch (e) {
    console.log(JSON.stringify({ severity: "WARNING", message: `Notifikační PDF ${idAktivity} nejde dohledat: ${e instanceof Error ? e.message : String(e)}` }));
    return stavajici;
  }
}
