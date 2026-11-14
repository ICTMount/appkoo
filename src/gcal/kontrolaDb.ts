// Běh kontroly MWF ↔ Google Kalendář nad databází (importní job, po synchronizaci kalendářů).
// Zakázky s dohodnutým termínem z MWF se porovnají s událostmi v kalendářích techniků (zrcadlo
// v tabulce kalendar_udalost) a výsledek se uloží do tabulky kontrola_kalendare – při každém běhu
// se přepíše celý, takže v ní je vždy jen aktuální stav (opravené rozpory zmizí samy).

import type { Db, Dotaz } from "../db/db.js";
import { ts } from "../db/db.js";
import { nactiCiselnik } from "../db/ciselniky.js";
import { addDays, atTime, fmtDate, fmtTime, isoDate } from "../domain/time.js";
import { zakladniCisloObjednavky } from "../domain/slovnik.js";
import { techniciZCiselniku } from "../plan/planovac.js";
import { udalostiMrizky } from "../zdroje/sync.js";
import { zRadku, type ZakazkaRow } from "../web/data.js";
import { pripravSloupceZakazky } from "../db/zakazky.js";
import { jeBlok, jeVolneOkno, zkontroluj, type UdalostTechnika, type Zavaznost } from "./kontrola.js";

const TABULKA = `
CREATE TABLE IF NOT EXISTS kontrola_kalendare (
  id           bigserial PRIMARY KEY,
  zkontrolovano timestamp NOT NULL,           -- čas běhu (Praha)
  id_aktivity  text,                          -- null = událost, ke které v MWF není otevřená zakázka
  objednavka   text NOT NULL,
  zakaznik     text,
  technik      text,                          -- technik z MWF (u „jen v kalendáři“ technik kalendáře)
  zavaznost    text NOT NULL CHECK (zavaznost IN ('shoda', 'admin', 'rozpor', 'jen_kalendar')),
  problemy     text[] NOT NULL DEFAULT '{}',
  termin_mwf   timestamp,
  kalendar     text,
  event_id     text,
  termin_kal   timestamp,
  odkaz        text
);
CREATE INDEX IF NOT EXISTS kontrola_kalendare_zavaznost ON kontrola_kalendare (zavaznost)`;

const pripraveno = new WeakMap<Dotaz, Promise<unknown>>();
export function pripravKontrolu(db: Dotaz): Promise<unknown> {
  let p = pripraveno.get(db);
  if (!p) {
    p = (async () => {
      for (const sql of TABULKA.split(";").map((x) => x.trim()).filter(Boolean)) await db.query(sql);
    })().catch((e) => {
      pripraveno.delete(db);
      throw e;
    });
    pripraveno.set(db, p);
  }
  return p;
}

export type ZavaznostRadku = Zavaznost | "jen_kalendar";

export interface RadekKontroly {
  idAktivity: string | null;
  objednavka: string;
  zakaznik: string;
  technik: string;
  zavaznost: ZavaznostRadku;
  problemy: string[];
  terminMwf: Date | null;
  kalendar: string | null;
  eventId: string | null;
  terminKal: Date | null;
  odkaz: string | null;
}

export interface SouhrnKontroly {
  od: string;
  do: string;
  zkontrolovano: number;
  shoda: number;
  admin: number;
  rozpor: number;
  jenVKalendari: number;
  /** zakázky s termínem u technika, jehož kalendář aplikace nezná (číselník Technici) – nekontrolují se */
  bezKalendare: number;
  radky: RadekKontroly[];
}

/** Technik z MWF („Hristov Anton (Vegacom)“) → technik z číselníku podle příjmení */
function najdiTechnika<T extends { jmeno: string }>(technici: T[], mwf: string): T | undefined {
  const n = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const m = n(mwf);
  return technici.find((t) => {
    const prvni = n(t.jmeno).split(/\s+/)[0];
    return !!prvni && new RegExp(`(^|[^\\p{L}])${prvni}($|[^\\p{L}])`, "u").test(m);
  });
}

/**
 * Zkontroluje termíny od dneška na `dni` dní dopředu. Kontrolují se jen zakázky techniků, kteří mají
 * v číselníku ID kalendáře. Výsledek přepíše tabulku kontrola_kalendare (v jedné transakci).
 */
export async function kontrolaKalendaru(db: Db, now: Date, dni = 14): Promise<SouhrnKontroly> {
  await pripravSloupceZakazky(db);
  await pripravKontrolu(db);
  const dnes = isoDate(now);
  const od = atTime(dnes, 0);
  const do_ = atTime(addDays(dnes, dni + 1), 0);

  const technici = techniciZCiselniku(await nactiCiselnik(db, "technici"));
  const kalendarTechnika = new Map(technici.map((t) => [t.kalendar, t]));

  const { rows } = await db.query<ZakazkaRow>(
    `SELECT id_aktivity, id_objednavky, id_objednavky_zaklad, id_s7, technik, stav_mwf, typ_aktivity, infrastruktura,
       predobjednavka, zakaznik, telefony, psc, adresa, subregion, balik, produkt, zakladni_produkt, kategorie_tt, prideleno, termin_od, termin_do, parkovani,
       parkovani_nestandardni, vysledek, preferovany_datum, rfs, do_splneni_min, poznamka, pocet_mv, uzavreno
     FROM zakazka WHERE uzavreno IS NULL`,
  );
  const otevrene = rows.map(zRadku);
  const vOkne = otevrene.filter((z) => z.termin && z.termin.od >= od && z.termin.od < do_);
  const kontrolovane = vOkne.filter((z) => z.technik && najdiTechnika(technici, z.technik));
  const bezKalendare = vOkne.length - kontrolovane.length;

  const udalostiDb = await udalostiMrizky(db, technici.map((t) => t.kalendar), od, do_);
  const odkazy = new Map(udalostiDb.map((u) => [`${u.kalendar}|${u.id}`, u.odkaz]));
  const udalosti: UdalostTechnika[] = udalostiDb.map((u) => ({
    kalendar: u.kalendar,
    technik: kalendarTechnika.get(u.kalendar)?.jmeno ?? u.kalendar,
    id: u.id,
    summary: u.summary,
    description: u.description,
    location: u.location,
    od: u.od,
    do: u.do,
    ...(u.barvaId ? { barva: u.barvaId } : {}),
  }));

  const { vysledky } = zkontroluj(kontrolovane, udalosti);
  const radky: RadekKontroly[] = vysledky.map((v) => {
    const z = kontrolovane.find((x) => x.idAktivity === v.zakazka)!;
    return {
      idAktivity: z.idAktivity,
      objednavka: z.idObjednavkyZaklad,
      zakaznik: z.zakaznik,
      technik: z.technik,
      zavaznost: v.zavaznost,
      problemy: v.problemy,
      terminMwf: z.termin!.od,
      kalendar: v.udalost?.kalendar ?? null,
      eventId: v.udalost?.id ?? null,
      terminKal: v.udalost?.od ?? null,
      odkaz: v.udalost ? (odkazy.get(`${v.udalost.kalendar}|${v.udalost.id}`) ?? null) : null,
    };
  });

  // Události zakázek, které v MWF termín v okně nemají (zrušený / přesunutý termín, zapomenutá událost).
  // Jen k otevřeným zakázkám – po instalaci zakázka z exportu zmizí a její událost v kalendáři zůstává právem.
  const sparovane = new Set(radky.filter((r) => r.eventId).map((r) => `${r.kalendar}|${r.eventId}`));
  const podleObjednavky = new Map(otevrene.map((z) => [z.idObjednavkyZaklad, z]));
  for (const u of udalosti) {
    if (sparovane.has(`${u.kalendar}|${u.id}`) || jeVolneOkno(u) || jeBlok(u)) continue;
    const cisla = [...`${u.summary}\n${u.description}`.matchAll(/O-\d{6,}/gi)].map((m) => zakladniCisloObjednavky(m[0]));
    const z = cisla.map((c) => podleObjednavky.get(c)).find(Boolean);
    if (!z) continue;
    const kde = `${fmtDate(u.od)} ${fmtTime(u.od)} (${kalendarTechnika.get(u.kalendar)?.jmeno ?? u.kalendar})`;
    const problem = !z.termin
      ? `V kalendáři je termín ${kde}, v MWF termín chybí.`
      : isoDate(z.termin.od) === isoDate(u.od) && vOkne.includes(z) && !kontrolovane.includes(z)
        ? `V kalendáři je termín ${kde}, technik v MWF (${z.technik || "nepřidělen"}) nemá kalendář v číselníku.`
        : `V kalendáři je termín ${kde}, v MWF je ${fmtDate(z.termin.od)} ${fmtTime(z.termin.od)} – stará nebo zdvojená událost?`;
    radky.push({
      idAktivity: z.idAktivity,
      objednavka: z.idObjednavkyZaklad,
      zakaznik: z.zakaznik,
      technik: kalendarTechnika.get(u.kalendar)?.jmeno ?? "",
      zavaznost: "jen_kalendar",
      problemy: [problem],
      terminMwf: z.termin?.od ?? null,
      kalendar: u.kalendar,
      eventId: u.id,
      terminKal: u.od,
      odkaz: odkazy.get(`${u.kalendar}|${u.id}`) ?? null,
    });
  }

  await db.tx(async (q) => {
    await q.query("DELETE FROM kontrola_kalendare");
    for (const r of radky) {
      await q.query(
        `INSERT INTO kontrola_kalendare (zkontrolovano, id_aktivity, objednavka, zakaznik, technik, zavaznost, problemy, termin_mwf, kalendar, event_id, termin_kal, odkaz)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [ts(now), r.idAktivity, r.objednavka, r.zakaznik || null, r.technik || null, r.zavaznost, r.problemy, ts(r.terminMwf), r.kalendar, r.eventId, ts(r.terminKal), r.odkaz],
      );
    }
  });

  const pocet = (z: ZavaznostRadku) => radky.filter((r) => r.zavaznost === z).length;
  return {
    od: dnes,
    do: addDays(dnes, dni),
    zkontrolovano: vysledky.length,
    shoda: pocet("shoda"),
    admin: pocet("admin"),
    rozpor: pocet("rozpor"),
    jenVKalendari: pocet("jen_kalendar"),
    bezKalendare,
    radky,
  };
}

/** Uložené nesoulady pro web (bez shod), seřazené: rozpor → jen v kalendáři → admin, pak podle termínu */
export async function nactiNesoulady(db: Dotaz): Promise<(RadekKontroly & { zkontrolovano: Date })[]> {
  await pripravKontrolu(db);
  const { rows } = await db.query<{
    zkontrolovano: Date; id_aktivity: string | null; objednavka: string; zakaznik: string | null; technik: string | null; zavaznost: ZavaznostRadku;
    problemy: string[]; termin_mwf: Date | null; kalendar: string | null; event_id: string | null; termin_kal: Date | null; odkaz: string | null;
  }>(
    `SELECT * FROM kontrola_kalendare WHERE zavaznost <> 'shoda'
     ORDER BY CASE zavaznost WHEN 'rozpor' THEN 0 WHEN 'jen_kalendar' THEN 1 ELSE 2 END, coalesce(termin_mwf, termin_kal), objednavka`,
  );
  return rows.map((r) => ({
    zkontrolovano: r.zkontrolovano,
    idAktivity: r.id_aktivity,
    objednavka: r.objednavka,
    zakaznik: r.zakaznik ?? "",
    technik: r.technik ?? "",
    zavaznost: r.zavaznost,
    problemy: r.problemy,
    terminMwf: r.termin_mwf,
    kalendar: r.kalendar,
    eventId: r.event_id,
    terminKal: r.termin_kal,
    odkaz: r.odkaz,
  }));
}
