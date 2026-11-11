// Synchronizace kalendářů techniků a Google Chatu do databáze (importní úloha, každých 5 min).
// Web pak hledá zakázku, lokalitu i zprávy v databázi – instance nečekají na Google a nestartují prázdné.
// Paměť v instanci (hledani.ts) zůstává jako záloha, dokud databáze synchronizaci nemá.

import type { calendar_v3 } from "@googleapis/calendar";
import type { Db, Dotaz } from "../db/db.js";
import { tedPraha } from "../domain/time.js";
import { bezDiakritiky, nactiUdalostiKalendare, oknoUdalosti, poDavkach, prilohyChatu, seznamKalendaruTechniku, stahniZpravy, uliceCislo, type Nalez, type NalezLokality, type UdalostVPameti } from "./hledani.js";

const TABULKY = `
CREATE TABLE IF NOT EXISTS kalendar_udalost (
  kalendar       text NOT NULL,
  id             text NOT NULL,
  kalendar_nazev text NOT NULL,
  summary        text NOT NULL,
  location       text NOT NULL,
  description    text NOT NULL,
  cas            timestamptz,
  odkaz          text,
  hledani        text NOT NULL,
  PRIMARY KEY (kalendar, id)
);
CREATE INDEX IF NOT EXISTS kalendar_udalost_cas ON kalendar_udalost (cas);
CREATE TABLE IF NOT EXISTS chat_zprava (
  name        text PRIMARY KEY,
  prostor     text NOT NULL,
  vlakno      text,
  create_time timestamptz NOT NULL,
  odesilatel  text,
  text        text NOT NULL,
  prilohy     jsonb,
  hledani     text NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_zprava_prostor_cas ON chat_zprava (prostor, create_time DESC);
CREATE TABLE IF NOT EXISTS sync_stav (
  klic   text PRIMARY KEY,
  kdy    timestamptz NOT NULL DEFAULT now(),
  pocet  integer NOT NULL DEFAULT 0,
  nazev  text
)`;

// Trigramový index (pg_trgm) jsme zkusili a zavrhli: na db-f1-micro zdržoval zápis desítek tisíc řádků
// na desítky minut, zatímco hledání bez indexu trvá stovky ms. Dříve založené indexy se odstraní.
// Sloupce pro mřížku kalendáře (konec, barvy) – doplněné později
const SLOUPCE_MRIZKY = `
ALTER TABLE kalendar_udalost ADD COLUMN IF NOT EXISTS konec timestamptz;
ALTER TABLE kalendar_udalost ADD COLUMN IF NOT EXISTS barva_id text;
ALTER TABLE kalendar_udalost ADD COLUMN IF NOT EXISTS kalendar_barva text;
ALTER TABLE kalendar_udalost ADD COLUMN IF NOT EXISTS celodenni boolean NOT NULL DEFAULT false`;

const ODSTRANIT_INDEXY = `
DROP INDEX IF EXISTS kalendar_udalost_hledani_trgm;
DROP INDEX IF EXISTS chat_zprava_hledani_trgm`;

const pripraveno = new WeakMap<Dotaz, Promise<unknown>>();
export function pripravSync(db: Dotaz): Promise<unknown> {
  let p = pripraveno.get(db);
  if (!p) {
    p = (async () => {
      for (const sql of TABULKY.split(";").map((x) => x.trim()).filter(Boolean)) await db.query(sql);
      for (const sql of SLOUPCE_MRIZKY.split(";").map((x) => x.trim()).filter(Boolean)) await db.query(sql);
      for (const sql of ODSTRANIT_INDEXY.split(";").map((x) => x.trim()).filter(Boolean)) await db.query(sql).catch(() => undefined);
    })().catch((e) => {
      pripraveno.delete(db);
      throw e;
    });
    pripraveno.set(db, p);
  }
  return p;
}

// ---------- kalendáře ----------

const PLNE_NACTENI_MS = 24 * 3_600_000; // jednou denně plné nahrání kalendáře (úklid), jinak jen změny

async function zapisUdalosti(db: Db, kalendar: string, seznam: UdalostVPameti[], smazane: string[], nahradit: boolean): Promise<void> {
  await db.tx(async (q) => {
    if (nahradit) await q.query("DELETE FROM kalendar_udalost WHERE kalendar = $1", [kalendar]);
    else if (smazane.length) await q.query("DELETE FROM kalendar_udalost WHERE kalendar = $1 AND id = ANY($2::text[])", [kalendar, smazane]);
    // hromadný zápis přes unnest; při přírůstku se změněné řádky přepíšou (ON CONFLICT … UPDATE)
    for (let i = 0; i < seznam.length; i += 500) {
      const davka = seznam.slice(i, i + 500);
      await q.query(
        `INSERT INTO kalendar_udalost (kalendar, id, kalendar_nazev, summary, location, description, cas, odkaz, hledani, konec, barva_id, kalendar_barva, celodenni)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::timestamptz[], $8::text[], $9::text[], $10::timestamptz[], $11::text[], $12::text[], $13::boolean[])
         ON CONFLICT (kalendar, id) DO UPDATE SET kalendar_nazev = EXCLUDED.kalendar_nazev, summary = EXCLUDED.summary, location = EXCLUDED.location,
           description = EXCLUDED.description, cas = EXCLUDED.cas, odkaz = EXCLUDED.odkaz, hledani = EXCLUDED.hledani,
           konec = EXCLUDED.konec, barva_id = EXCLUDED.barva_id, kalendar_barva = EXCLUDED.kalendar_barva, celodenni = EXCLUDED.celodenni
         WHERE (kalendar_udalost.summary, kalendar_udalost.location, kalendar_udalost.description, kalendar_udalost.cas, kalendar_udalost.odkaz,
                kalendar_udalost.konec, kalendar_udalost.barva_id, kalendar_udalost.kalendar_barva, kalendar_udalost.celodenni)
               IS DISTINCT FROM (EXCLUDED.summary, EXCLUDED.location, EXCLUDED.description, EXCLUDED.cas, EXCLUDED.odkaz,
                EXCLUDED.konec, EXCLUDED.barva_id, EXCLUDED.kalendar_barva, EXCLUDED.celodenni)`,
        [
          kalendar,
          davka.map((u) => u.id),
          davka.map((u) => u.kalendarNazev),
          davka.map((u) => u.summary),
          davka.map((u) => u.location),
          davka.map((u) => u.description),
          davka.map((u) => u.cas),
          davka.map((u) => u.odkaz),
          davka.map((u) => u.hledani),
          davka.map((u) => u.konec ?? null),
          davka.map((u) => u.barvaId ?? null),
          davka.map((u) => u.kalendarBarva ?? null),
          davka.map((u) => !!u.celodenni),
        ],
      );
    }
  });
}

/**
 * Zámek proti souběhu dvou běhů úlohy (Cloud Scheduler spustí další, i když předchozí ještě běží):
 * řádek `bezi` v sync_stav; starší než 15 min se považuje za opuštěný.
 */
export async function zamekSync(db: Dotaz): Promise<boolean> {
  await pripravSync(db);
  const { rows } = await db.query(
    `INSERT INTO sync_stav (klic, kdy) VALUES ('bezi', now())
     ON CONFLICT (klic) DO UPDATE SET kdy = now() WHERE sync_stav.kdy < now() - interval '15 minutes'
     RETURNING klic`,
  );
  return rows.length > 0;
}
export const odemkniSync = (db: Dotaz) => db.query("DELETE FROM sync_stav WHERE klic = 'bezi'");

/**
 * Kalendáře techniků do databáze. Jednou denně plné nahrání kalendáře, jinak jen události změněné od minulého
 * běhu (updatedMin, včetně zrušených) – obvykle jednotky až desítky řádků, databázi to nezatíží.
 */
export async function synchronizujKalendare(db: Db, cal: calendar_v3.Calendar, now: Date = tedPraha()): Promise<{ kalendaru: number; udalosti: number; plne: number; ms: number }> {
  const t0 = Date.now();
  await pripravSync(db);
  const kalendare = await seznamKalendaruTechniku(cal);
  const okno = oknoUdalosti(now);
  const { rows: stavy } = await db.query<{ klic: string; kdy: Date }>("SELECT klic, kdy FROM sync_stav WHERE klic LIKE 'kal:%'");
  const posledni = new Map(stavy.map((r) => [r.klic.slice(4), new Date(r.kdy)]));
  // kalendáře nahrané před zavedením mřížky (události bez konce) se jednou nahrají znovu celé
  const { rows: stare } = await db.query<{ kalendar: string }>("SELECT DISTINCT kalendar FROM kalendar_udalost WHERE konec IS NULL AND cas IS NOT NULL AND cas >= now() - interval '30 days'");
  const bezKonce = new Set(stare.map((r) => r.kalendar));
  let celkem = 0;
  let plne = 0;
  await poDavkach(
    kalendare.map((k) => async () => {
      const zacatek = new Date();
      const minule = posledni.get(k.id);
      const nahradit = !minule || Date.now() - minule.getTime() > PLNE_NACTENI_MS || bezKonce.has(k.id);
      // rezerva 10 min – změny provedené těsně před minulým během se nesmí ztratit
      const { udalosti, smazane } = await nactiUdalostiKalendare(cal, k, okno, nahradit ? undefined : new Date(minule!.getTime() - 10 * 60_000).toISOString());
      if (nahradit || udalosti.length || smazane.length) await zapisUdalosti(db, k.id, udalosti, smazane, nahradit);
      await db.query("INSERT INTO sync_stav (klic, kdy, pocet) VALUES ($1, $2, $3) ON CONFLICT (klic) DO UPDATE SET kdy = EXCLUDED.kdy, pocet = EXCLUDED.pocet", [`kal:${k.id}`, zacatek, udalosti.length]);
      celkem += udalosti.length;
      if (nahradit) plne++;
    }),
    4,
  );
  await db.query("INSERT INTO sync_stav (klic, kdy, pocet) VALUES ('kalendare', now(), $1) ON CONFLICT (klic) DO UPDATE SET kdy = now(), pocet = EXCLUDED.pocet", [celkem]);
  return { kalendaru: kalendare.length, udalosti: celkem, plne, ms: Date.now() - t0 };
}

/** Kdy proběhla poslední synchronizace (null = nikdy) */
export async function stavSynchronizace(db: Dotaz, klic: "kalendare" | "chat"): Promise<Date | null> {
  try {
    await pripravSync(db);
    const { rows } = await db.query<{ kdy: Date }>("SELECT kdy FROM sync_stav WHERE klic = $1", [klic]);
    return rows[0] ? new Date(rows[0].kdy) : null;
  } catch {
    return null;
  }
}

interface RadekUdalosti {
  kalendar_nazev: string;
  summary: string;
  location: string;
  description: string;
  cas: Date | null;
  odkaz: string | null;
}

/** Zakázka v kalendářích techniků – z databáze (hledani = malá písmena bez diakritiky) */
export async function hledejKalendarDb(db: Dotaz, vyrazy: string[], od: Date, do_: Date): Promise<Nalez[]> {
  if (!vyrazy.length) return [];
  await pripravSync(db);
  const vzory = vyrazy.map((v) => `%${bezDiakritiky(v).replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { rows } = await db.query<RadekUdalosti>(
    `SELECT kalendar_nazev, summary, location, description, cas, odkaz FROM kalendar_udalost
     WHERE cas BETWEEN $1 AND $2 AND hledani LIKE ANY($3::text[]) ORDER BY cas DESC LIMIT 100`,
    [od, do_, vzory],
  );
  return rows.map((r) => ({ zdroj: "kalendar" as const, cas: r.cas ? new Date(r.cas) : null, titulek: r.summary, kde: r.kalendar_nazev, text: r.location, odkaz: r.odkaz }));
}

/** Instalovali jsme v lokalitě – z databáze: předvýběr podle ulice, přesné ověření čísla popisného v JS */
export async function hledejNaLokaliteDb(db: Dotaz, adresa: string, vyloucitOId: string, now: Date, max = 20): Promise<NalezLokality[] | null> {
  const uc = uliceCislo(adresa);
  if (!uc) return null;
  await pripravSync(db);
  const ulice = bezDiakritiky(uc.ulice);
  const cislo = new RegExp(`(^|[^\\d])${uc.cp}(/|[^\\d]|$)`);
  const { rows } = await db.query<RadekUdalosti>(
    `SELECT kalendar_nazev, summary, location, description, cas, odkaz FROM kalendar_udalost
     WHERE cas <= $1 AND hledani LIKE $2 ORDER BY cas DESC LIMIT 400`,
    [new Date(now.getTime() + 60 * 86_400_000), `%${ulice.replace(/[%_\\]/g, (c) => `\\${c}`)}%`],
  );
  const nalezy: NalezLokality[] = [];
  for (const r of rows) {
    if (/\bvoln[yae]\b/i.test(bezDiakritiky(r.summary)) || (vyloucitOId && r.summary.includes(vyloucitOId))) continue;
    const kde = bezDiakritiky(`${r.location} ${r.description}`);
    if (!kde.includes(ulice) || !cislo.test(kde)) continue;
    const cas = r.cas ? new Date(r.cas) : null;
    nalezy.push({ zdroj: "kalendar", cas, titulek: r.summary, kde: r.kalendar_nazev, text: r.location, odkaz: r.odkaz, oId: r.summary.match(/O-\d{8,}/)?.[0], budouci: !!cas && cas > now });
    if (nalezy.length >= max) break;
  }
  return nalezy;
}

// ---------- chat ----------

const CHAT_DNI = 60;

/** Dočte nové zprávy prostorů (od poslední známé), uloží je, staré smaže */
export async function synchronizujChat(db: Db, prostory: string[], token: string, fetchFn: typeof fetch = fetch): Promise<{ prostoru: number; novych: number; ms: number }> {
  const t0 = Date.now();
  await pripravSync(db);
  const auth = { authorization: `Bearer ${token}` };
  const api = "https://chat.googleapis.com/v1";
  const hranice = new Date(Date.now() - CHAT_DNI * 86_400_000);
  let novych = 0;
  for (const prostor of prostory) {
    const info = await fetchFn(`${api}/${prostor}`, { headers: auth });
    if (!info.ok) throw new Error(`Chat ${prostor}: HTTP ${info.status} ${(await info.text()).slice(0, 200)}`);
    const nazev = ((await info.json()) as { displayName?: string }).displayName ?? prostor;
    const { rows } = await db.query<{ max: Date | null }>("SELECT max(create_time) AS max FROM chat_zprava WHERE prostor = $1", [prostor]);
    const od = rows[0]?.max ? new Date(rows[0].max) : hranice;
    const zpravy = await stahniZpravy(prostor, auth, fetchFn, (od > hranice ? od : hranice).toISOString(), nazev, 10);
    for (const m of zpravy) {
      if (!m.createTime) continue;
      const prilohy = prilohyChatu(m.attachment);
      await db.query(
        `INSERT INTO chat_zprava (name, prostor, vlakno, create_time, odesilatel, text, prilohy, hledani) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (name) DO UPDATE SET text = EXCLUDED.text, prilohy = EXCLUDED.prilohy, hledani = EXCLUDED.hledani`,
        [m.name, prostor, m.thread?.name ?? null, m.createTime, m.sender?.displayName ?? null, (m.text ?? "").slice(0, 5000), prilohy.length ? JSON.stringify(prilohy) : null, (m.text ?? "").toLowerCase()],
      );
      novych++;
    }
    await db.query("DELETE FROM chat_zprava WHERE prostor = $1 AND create_time < $2", [prostor, hranice]);
    await db.query("INSERT INTO sync_stav (klic, kdy, pocet, nazev) VALUES ($1, now(), $2, $3) ON CONFLICT (klic) DO UPDATE SET kdy = now(), pocet = sync_stav.pocet + EXCLUDED.pocet, nazev = EXCLUDED.nazev", [`chat:${prostor}`, novych, nazev]);
  }
  await db.query("INSERT INTO sync_stav (klic, kdy, pocet) VALUES ('chat', now(), $1) ON CONFLICT (klic) DO UPDATE SET kdy = now(), pocet = EXCLUDED.pocet", [novych]);
  return { prostoru: prostory.length, novych, ms: Date.now() - t0 };
}

/** Zprávy k zakázce z databáze: shody + odpovědi ve stejných vláknech */
export async function hledejChatDb(db: Dotaz, prostory: string[], vyrazy: string[]): Promise<Nalez[]> {
  if (!vyrazy.length || !prostory.length) return [];
  await pripravSync(db);
  const vzory = vyrazy.map((v) => `%${v.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const nazvy = new Map<string, string>();
  const { rows: st } = await db.query<{ klic: string; nazev: string | null }>("SELECT klic, nazev FROM sync_stav WHERE klic LIKE 'chat:%'");
  for (const r of st) nazvy.set(r.klic.slice(5), r.nazev ?? r.klic.slice(5));
  type R = { name: string; prostor: string; vlakno: string | null; create_time: Date; odesilatel: string | null; text: string; prilohy: unknown; shoda: boolean };
  const { rows } = await db.query<R>(
    `WITH shody AS (SELECT name, vlakno FROM chat_zprava WHERE prostor = ANY($1::text[]) AND hledani LIKE ANY($2::text[]))
     SELECT z.name, z.prostor, z.vlakno, z.create_time, z.odesilatel, z.text, z.prilohy, (z.name IN (SELECT name FROM shody)) AS shoda
       FROM chat_zprava z
      WHERE z.name IN (SELECT name FROM shody) OR (z.vlakno IS NOT NULL AND z.vlakno IN (SELECT vlakno FROM shody WHERE vlakno IS NOT NULL))
      ORDER BY z.create_time DESC LIMIT 100`,
    [prostory, vzory],
  );
  return rows.map((m) => {
    const idProstoru = m.prostor.replace(/^spaces\//, "");
    const idVlakna = m.vlakno?.split("/").at(-1);
    const nazev = nazvy.get(m.prostor) ?? m.prostor;
    return {
      zdroj: "chat" as const,
      cas: tedPraha(new Date(m.create_time)), // skutečný okamžik → „Praha v UTC“ (jako zApi v hledani.ts)
      titulek: nazev,
      kde: nazev,
      kdo: m.odesilatel ?? undefined,
      text: m.text,
      odkaz: `https://mail.google.com/chat/u/0/#chat/space/${idProstoru}${idVlakna ? `/${idVlakna}` : ""}`,
      veVlakne: !m.shoda,
      prilohy: Array.isArray(m.prilohy) ? (m.prilohy as Nalez["prilohy"]) : [],
    };
  });
}

// ---------- mřížka kalendáře (zrcadlo Google Kalendáře) ----------

export interface UdalostMrizky {
  kalendar: string;
  id: string;
  summary: string;
  location: string;
  description: string;
  /** „Praha v UTC“ */
  od: Date;
  do: Date;
  barvaId: string | null;
  kalendarBarva: string | null;
  odkaz: string | null;
}

/** Časové události vybraných kalendářů v intervalu (celodenní se do mřížky neberou) */
export async function udalostiMrizky(db: Dotaz, kalendare: string[], od: Date, do_: Date): Promise<UdalostMrizky[]> {
  if (!kalendare.length) return [];
  await pripravSync(db);
  const { rows } = await db.query<{ kalendar: string; id: string; summary: string; location: string; description: string; cas: Date; konec: Date | null; barva_id: string | null; kalendar_barva: string | null; odkaz: string | null }>(
    `SELECT kalendar, id, summary, location, description, cas, konec, barva_id, kalendar_barva, odkaz FROM kalendar_udalost
     WHERE kalendar = ANY($1::text[]) AND cas >= $2 AND cas < $3 AND NOT celodenni ORDER BY cas`,
    [kalendare, od, do_],
  );
  return rows.map((r) => {
    const o = new Date(r.cas);
    return { kalendar: r.kalendar, id: r.id, summary: r.summary, location: r.location, description: r.description, od: o, do: r.konec ? new Date(r.konec) : new Date(o.getTime() + 3_600_000), barvaId: r.barva_id, kalendarBarva: r.kalendar_barva, odkaz: r.odkaz };
  });
}
