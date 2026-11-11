// Kombinovaná objednávka (FTTH + IPTV / MESH) se musí propsat i do událostí v kalendáři technika, které nevznikly
// v AppKoo (termín domluvený v MWF / SHEET2CAL). Událost zakázky se najde v synchronizované tabulce kalendar_udalost,
// do názvu se doplní „FTTH+IPTV“ a do popisu řádek KOMBINOVANÁ OBJEDNÁVKA; změna je idempotentní (podruhé se nic nemění).
// Spouští to import job po synchronizaci kalendářů a tlačítko v detailu zakázky.

import type { calendar_v3 } from "@googleapis/calendar";
import type { Db, Dotaz } from "../db/db.js";
import { kombinaceZakazky, popisKombinace, privezeTechnik, zkratkaKombinace, type Kombinace, type NotifikaceProKombinaci } from "../domain/kombinace.js";
import { bezDiakritiky } from "../zdroje/hledani.js";

export const ZNACKA_KOMBINACE = "KOMBINOVANÁ OBJEDNÁVKA:";

/** Řádek do popisu události v kalendáři technika */
export const radekUdalostiKombinace = (k: Kombinace) =>
  `${ZNACKA_KOMBINACE} ${popisKombinace(k)}${k.mesh ? ` – mesh aktivovat jen z MWF app${privezeTechnik(k.doruceni.mesh) ? ", jednotky přiveze technik" : ", ověřit doručení"}` : ""}${k.iptv ? ` – zapojit a ověřit i set-top box${privezeTechnik(k.doruceni.stb) ? " (přiveze technik)" : ""}` : ""}`;

/** Název a popis události s doplněnou kombinací; null = už tam je (nebo není co doplnit) */
export function doplnKombinaci(u: { summary: string; description: string }, k: Kombinace): { summary: string; description: string } | null {
  const zkratka = zkratkaKombinace(k);
  let summary = u.summary;
  if (!summary.includes(zkratka)) {
    // „Hristov - FTTH CETIN O-…“ → „Hristov - FTTH+IPTV CETIN O-…“; starší tvar „FTTH+MESH“ se nahradí úplným
    summary = /\bFTTH(\+[A-Z+]+)?\b/.test(summary) ? summary.replace(/\bFTTH(\+[A-Z+]+)?\b/, zkratka) : `${zkratka} ${summary}`.trim();
  }
  const radek = radekUdalostiKombinace(k);
  let description = u.description;
  if (!description.includes(ZNACKA_KOMBINACE)) {
    const html = /<\w+[^>]*>/.test(description);
    description = description ? `${radek}${html ? "<br>" : "\n"}${description}` : radek;
  } else if (!description.includes(radek)) {
    // jiný text (jiný počet zařízení) → nahradit celý řádek
    description = description.replace(new RegExp(`${ZNACKA_KOMBINACE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n<]*`), radek);
  }
  if (summary === u.summary && description === u.description) return null;
  return { summary, description };
}

export interface VysledekPropisu {
  /** budoucí události zakázky v kalendářích techniků */
  nalezeno: number;
  upraveno: number;
  /** už bylo propsáno */
  bezeZmeny: number;
  chyby: string[];
}

/**
 * Propíše kombinaci do budoucích událostí zakázky (podle čísla objednávky O-… v názvu/popisu).
 * Čte živou událost z API (popis v tabulce je zkrácený), zapisuje přes events.patch a hned aktualizuje tabulku.
 */
export async function propisKombinaciDoKalendare(
  db: Dotaz,
  api: calendar_v3.Calendar,
  z: { idObjednavkyZaklad: string; idAktivity: string },
  k: Kombinace,
  now: Date,
): Promise<VysledekPropisu> {
  const v: VysledekPropisu = { nalezeno: 0, upraveno: 0, bezeZmeny: 0, chyby: [] };
  const klice = [z.idObjednavkyZaklad, z.idAktivity].filter((x) => x && x.length >= 8).map((x) => `%${bezDiakritiky(x).replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (!klice.length) return v;
  const { rows } = await db.query<{ kalendar: string; id: string; summary: string; description: string }>(
    `SELECT kalendar, id, summary, description FROM kalendar_udalost
     WHERE cas >= $1 AND hledani LIKE ANY($2::text[]) ORDER BY cas LIMIT 5`,
    [new Date(now.getTime() - 86_400_000), klice],
  );
  for (const r of rows) {
    if (/\bvoln[yae]\b/i.test(bezDiakritiky(r.summary))) continue;
    v.nalezeno++;
    try {
      const ziva = (await api.events.get({ calendarId: r.kalendar, eventId: r.id, fields: "summary,description,location" } as never)).data as calendar_v3.Schema$Event;
      const nove = doplnKombinaci({ summary: ziva.summary ?? r.summary, description: ziva.description ?? "" }, k);
      if (!nove) { v.bezeZmeny++; continue; }
      await api.events.patch({ calendarId: r.kalendar, eventId: r.id, requestBody: nove });
      const description = nove.description.slice(0, 2000);
      await db.query(
        "UPDATE kalendar_udalost SET summary = $3, description = $4, hledani = $5 WHERE kalendar = $1 AND id = $2",
        [r.kalendar, r.id, nove.summary, description, bezDiakritiky(`${nove.summary} ${ziva.location ?? ""} ${description.slice(0, 600)}`)],
      );
      v.upraveno++;
    } catch (e) {
      v.chyby.push(`${r.summary}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return v;
}

/** Import job: všechny otevřené kombinované zakázky s termínem v budoucnu (export + notifikační PDF) */
export async function propisKombinaceVsem(db: Db, api: calendar_v3.Calendar, now: Date): Promise<{ zakazek: number; udalosti: number; upraveno: number; chyby: number }> {
  const { rows } = await db.query<{ id_aktivity: string; id_objednavky_zaklad: string; zakladni_produkt: string | null; kategorie_tt: string | null; produkt: string | null; zariadenia: NotifikaceProKombinaci["zariadenia"]; predpis: string[] | null }>(
    `SELECT z.id_aktivity, z.id_objednavky_zaklad, z.zakladni_produkt, z.kategorie_tt, z.produkt, n.zariadenia, n.predpis
       FROM zakazka z
       LEFT JOIN LATERAL (SELECT zariadenia, predpis FROM notifikace_pdf n WHERE n.chyba IS NULL AND (n.id_aktivity = z.id_aktivity OR n.id_objednavky_zaklad = z.id_objednavky_zaklad)
                          ORDER BY (n.id_aktivity = z.id_aktivity) DESC, vznik DESC LIMIT 1) n ON true
      WHERE z.uzavreno IS NULL AND z.termin_od >= $1`,
    [new Date(now.getTime() - 86_400_000)],
  );
  const s = { zakazek: 0, udalosti: 0, upraveno: 0, chyby: 0 };
  for (const r of rows) {
    const k = kombinaceZakazky({ zakladniProdukt: r.zakladni_produkt ?? "", kategorieTt: r.kategorie_tt ?? "", produkt: r.produkt ?? "" }, { zariadenia: r.zariadenia, predpis: r.predpis ?? [] });
    if (!k) continue;
    s.zakazek++;
    const v = await propisKombinaciDoKalendare(db, api, { idObjednavkyZaklad: r.id_objednavky_zaklad, idAktivity: r.id_aktivity }, k, now);
    s.udalosti += v.nalezeno;
    s.upraveno += v.upraveno;
    s.chyby += v.chyby.length;
  }
  return s;
}
