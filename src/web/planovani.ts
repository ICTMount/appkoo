// Plánování termínu z webu: kontext z databáze, údaje z formuláře, zápis do kalendáře a evidence.

import { nactiCiselnik } from "../db/ciselniky.js";
import { prahaZPsc, type Geokoder } from "../plan/geokod.js";
import type { Dotaz } from "../db/db.js";
import { ts } from "../db/db.js";
import type { UdajeHovoru } from "../gcal/udalost.js";
import { kontrolaBran, techniciZCiselniku, type TechnikPlanu, type ZakazkaKDoplneni } from "../plan/planovac.js";
import { faktaZakazky } from "../domain/priorita.js";
import { slaKonec } from "../plan/kpi.js";
import { nactiFrontu } from "./data.js";
import { nastaveniPlanovani, type NastaveniPlanovaniApp, type Polozka } from "../config/ciselniky.js";

export interface KontextPlanovani {
  technici: TechnikPlanu[];
  blokovane: Polozka[];
  koordinatorky: Polozka[];
  /** O-číslo → úplná adresa z MWF (místo v kalendáři bývá bez obce) */
  adresyZMwf: Map<string, string>;
  /** číselník Nastavení plánování (limity, bonusy, horizont) */
  nastaveni: NastaveniPlanovaniApp;
}

export async function nactiKontext(db: Dotaz): Promise<KontextPlanovani> {
  const [technici, blokovane, koordinatorky, adresy, planovani] = await Promise.all([
    nactiCiselnik(db, "technici"),
    nactiCiselnik(db, "blokovaneLokality"),
    nactiCiselnik(db, "koordinatorky"),
    db.query<{ o: string; adresa: string | null; psc: string | null }>(
      "SELECT id_objednavky_zaklad AS o, adresa, psc FROM zakazka WHERE uzavreno IS NULL AND adresa IS NOT NULL",
    ),
    nactiCiselnik(db, "nastaveniPlanovani"),
  ]);
  return {
    technici: techniciZCiselniku(technici),
    blokovane,
    koordinatorky,
    nastaveni: nastaveniPlanovani(planovani),
    adresyZMwf: new Map(adresy.rows.map((r) => [r.o, [r.adresa, (r.psc ?? "").replace(/^=+/, "")].filter(Boolean).join(", ")])),
  };
}

/** Iniciály koordinátorky do názvu události („(AP)“) podle e-mailu v číselníku Koordinátorky */
/**
 * Iniciály koordinátorky do názvu události („… SLA 18.10.2026 13:27 (DH)“):
 * z číselníku Uživatelé (sloupec Iniciály), jinak ze jména („David Hnát“ → DH), jinak z e-mailu
 * („david.hnat@“ → DH, „davidh@“ → DH = první písmeno + poslední písmeno loginu).
 */
export function inicialy(koordinatorky: Polozka[], email: string): string | undefined {
  const k = koordinatorky.find((p) => String(p.email ?? "").toLowerCase() === email.toLowerCase());
  if (k?.inicialy && String(k.inicialy).trim()) return String(k.inicialy).trim().toUpperCase();
  const zeSlov = (s: string) =>
    s
      .split(/[\s._-]+/)
      .filter(Boolean)
      .map((w) => w[0]!)
      .join("")
      .toUpperCase();
  const jmeno = String(k?.jmeno ?? "").trim();
  if (jmeno.split(/\s+/).length >= 2) return zeSlov(jmeno);
  const login = email.split("@")[0] ?? "";
  if (!login) return undefined;
  if (/[._-]/.test(login)) return zeSlov(login);
  return login.length >= 2 ? `${login[0]}${login[login.length - 1]}`.toUpperCase() : login.toUpperCase();
}

const anoNe = (v: string | null): boolean | null => (v === "ano" ? true : v === "ne" ? false : null);
const text = (v: string | null) => (v && v.trim() ? v.trim().slice(0, 4000) : undefined);

/** Údaje z kontrolního seznamu hovoru (formulář) → šablona události */
export function udajeZFormulare(f: URLSearchParams): UdajeHovoru {
  const stoupacka = f.get("stoupacka");
  const listy = f.get("listy");
  const vzd = f.get("vzdalenost");
  const kz = [f.get("kz"), text(f.get("stb")) ? `+ STB ${text(f.get("stb"))}` : ""].filter(Boolean).join(" ");
  return {
    novaInstalace: f.get("instalace") === "existujici" ? false : f.get("instalace") === "nova" ? true : undefined,
    zasuvka: text(f.get("zasuvka")),
    kontaktNaMiste: text(f.get("kontakt")),
    flex: f.get("flex") === "ne" || f.get("flex") === "den" || f.get("flex") === "obecne" ? (f.get("flex") as "ne" | "den" | "obecne") : undefined,
    flexPoznamka: text(f.get("flexPozn")),
    iptv: f.get("iptv") === "ano", // pole už ve formuláři není (IPTV se neřeší) – zůstává kvůli starým odkazům
    patro: text(f.get("patro")),
    byt: text(f.get("byt")),
    patraPristupna: anoNe(f.get("patraPristupna")),
    stoupacka: stoupacka === "ANO" || stoupacka === "NE" ? stoupacka : "NEVÍM",
    vzdalenostOdStoupackyM: vzd && Number.isFinite(Number(vzd)) ? Number(vzd) : null,
    listyOmezeniSvj: listy === "ANO" || listy === "NE" ? listy : "NEVÍM",
    souhlasSVrtanim: anoNe(f.get("vrtani")),
    umisteniKz: text(f.get("umisteni")),
    elZasuvka: anoNe(f.get("elZasuvka")),
    kz: kz || undefined,
    predpojen: anoNe(f.get("predpojen")),
    podb: text(f.get("podb")),
    instalacniPredpis: text(f.get("predpis")),
    caseid: text(f.get("caseid")),
  };
}

/** Povinné potvrzení koordinátorky před zápisem (call script: shoda údajů, stav zásuvky) */
export const POVINNA_POTVRZENI = [
  { pole: "overenoJmeno", text: "Jméno a adresa zákazníka souhlasí se zakázkou (100 %)." },
  { pole: "overenaZasuvka", text: "Zásuvka je FREE, nebo jsou splněné podmínky SWAP (CASEID, do 7 dní) / FIS MOP (po datu portace)." },
  { pole: "zakaznikSouhlasi", text: "Zákazník termín potvrdil." },
] as const;

export function chybejiciPotvrzeni(f: URLSearchParams): string[] {
  return POVINNA_POTVRZENI.filter((p) => f.get(p.pole) !== "ano").map((p) => p.text);
}

/** Evidence události vytvořené aplikací (párování MWF ↔ kalendář, kontrola rozporů) */
export async function ulozUdalost(db: Dotaz, idAktivity: string, kalendar: string, eventId: string, od: Date, do_: Date) {
  await db.query(
    `INSERT INTO gcal_udalost (id_aktivity, kalendar, event_id, zacatek, konec, vytvorila_app)
     VALUES ($1,$2,$3,$4,$5,true)
     ON CONFLICT (kalendar, event_id) DO UPDATE SET id_aktivity = EXCLUDED.id_aktivity, zacatek = EXCLUDED.zacatek,
       konec = EXCLUDED.konec, vytvorila_app = true, zmeneno = now()`,
    [idAktivity, kalendar, eventId, ts(od), ts(do_)],
  );
}

export function smiZapisovat(technik: string, povoleniTechnici: string[] | "vsichni"): boolean {
  return povoleniTechnici === "vsichni" || povoleniTechnici.some((t) => t.toLowerCase() === technik.toLowerCase());
}

/**
 * Kandidáti pro režim B: otevřené zakázky, které projdou branami. Bez termínu jen s prioritou
 * P1–P3 (P0 = nevolat; předobjednávka se plánovat smí – je označená); s termínem jen jako možný přesun – „flex“ se ověří v plánovači.
 */
export async function kandidatiKDoplneni(db: Dotaz, now: Date, blokovane: Polozka[], exportAt: Date, priority = true): Promise<ZakazkaKDoplneni[]> {
  const { polozky } = await nactiFrontu(db, now);
  return polozky
    .filter((p) => (!priority || p.z.termin || p.z.predobjednavka ? true : p.priorita !== "P0"))
    .filter((p) => !kontrolaBran(p.z, faktaZakazky(p.z, now), blokovane, { presun: !!p.z.termin }).blokace.length)
    .map((p) => ({ z: p.z, priorita: priority ? p.priorita : ("P3" as const), slaKonec: slaKonec(p.z, exportAt) }));
}

/** Přesun z parametrů (pk = kalendář, pe = událost, pt = technik současného termínu) */
export function presunZParametru(p: URLSearchParams): { pk: string; pe: string; pt: string } | null {
  const pk = p.get("pk") ?? "";
  const pe = p.get("pe") ?? "";
  const pt = p.get("pt") ?? "";
  return pk && pe && pt ? { pk, pe, pt } : null;
}

export async function smazUdalost(db: Dotaz, kalendar: string, eventId: string) {
  await db.query("DELETE FROM gcal_udalost WHERE kalendar = $1 AND event_id = $2", [kalendar, eventId]);
}

/**
 * Městské části k adresám na stránce („Praha 4 – Krč“): z geokódování (cache v DB), jinak „Praha N“ podle PSČ.
 * Chyba služby stránku nezastaví – adresa jen zůstane bez části.
 */
export async function mestskeCasti(geokoder: Geokoder | null, adresy: (string | undefined | null)[]): Promise<Map<string, string>> {
  const vysledek = new Map<string, string>();
  const fronta = [...new Set(adresy.filter((a): a is string => !!a && a.trim().length > 2))];
  await Promise.all(
    Array.from({ length: Math.min(8, fronta.length) }, async () => {
      for (let a = fronta.shift(); a !== undefined; a = fronta.shift()) {
        let cast: string | null | undefined = null;
        try {
          cast = geokoder ? (await geokoder.najdi(a)).cast : null;
        } catch {
          cast = null;
        }
        const c = cast || prahaZPsc(a);
        if (c) vysledek.set(a, c);
      }
    }),
  );
  return vysledek;
}

/** Nestandardní úprava události (zaškrtnuté „nestandardní úprava“): vlastní název a čas; null = standardní zápis */
export interface Nestandard {
  nadpis: string | null;
  od: Date | null;
  do: Date | null;
}

export function nestandardZFormulare(f: URLSearchParams, slotOd: Date, slotDo: Date): Nestandard | null {
  if (f.get("nestandard") !== "1") return null;
  const cas = (v: string | null, zaklad: Date): Date | null => {
    const m = v?.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const d = new Date(zaklad);
    d.setUTCHours(+m[1]!, +m[2]!, 0, 0);
    return d;
  };
  const nadpis = text(f.get("nadpis"))?.slice(0, 200) ?? null;
  const od = cas(f.get("casOd"), slotOd);
  const do_ = cas(f.get("casDo"), slotDo);
  const platne = od && do_ && do_.getTime() > od.getTime() ? { od, do: do_ } : { od: null, do: null };
  return { nadpis, ...platne };
}
