// Pilíř 1: hledání zakázky ve všech zdrojích – e-mail (schránka koordinace), kalendáře techniků, Google Chat.
// MWF je v databázi (src/web/data.ts); tady jsou ostatní zdroje. Vše jen ke čtení, jménem tmcz01
// (delegace, src/google/delegace.ts). Každý zdroj má časový limit a vlastní chybu – výpadek jednoho
// nezastaví ostatní.

import type { calendar_v3 } from "@googleapis/calendar";
import type { gmail_v1 } from "@googleapis/gmail";
import { tedPraha } from "../domain/time.js";

export type Zdroj = "email" | "kalendar" | "chat";

export interface Nalez {
  zdroj: Zdroj;
  /** „Praha v UTC“ */
  cas: Date | null;
  titulek: string;
  text: string;
  /** kde: kalendář technika, chatový prostor */
  kde?: string;
  kdo?: string;
  odkaz?: string | null;
  /** chat: zpráva ve vlákně, kde se zakázka zmiňuje, ale sama číslo neobsahuje */
  veVlakne?: boolean;
}

export interface VysledekZdroje {
  zdroj: Zdroj;
  nalezy: Nalez[];
  chyba?: string;
}

export interface ZavislostiZdroju {
  gmail(): Promise<gmail_v1.Gmail>;
  kalendar(): Promise<calendar_v3.Calendar>;
  /** přístupový token pro Chat API (REST) */
  chatToken(): Promise<string>;
  /** chatové prostory k prohledání, např. ["spaces/AAQAoP43WQk"] */
  prostory: string[];
  fetchFn?: typeof fetch;
}

/** Výrazy, podle kterých se zakázka hledá: O-číslo (bez přípon), celé O-ID, S7 */
export function vyrazyZakazky(z: { idObjednavky: string; idObjednavkyZaklad: string; idS7: string }): string[] {
  const s7 = z.idS7.replace(/^=+/, "").trim();
  return [...new Set([z.idObjednavkyZaklad, z.idObjednavky, /^1-[A-Z0-9]{4,}$/i.test(s7) ? s7 : ""].filter((v) => v && v.length >= 6))];
}

/** Hledaný výraz od uživatele → výrazy pro zdroje (bez uvozovek a operátorů Gmailu) */
export function ocistitDotaz(q: string): string {
  return q.replace(/["()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

const zApi = (s: string | null | undefined) => (s ? tedPraha(new Date(s)) : null);

// ---------- E-mail ----------

export async function hledejEmaily(gmail: gmail_v1.Gmail, vyrazy: string[], max = 15): Promise<Nalez[]> {
  if (!vyrazy.length) return [];
  const q = `${vyrazy.map((v) => `"${v}"`).join(" OR ")} newer_than:365d`;
  const { data } = await gmail.users.messages.list({ userId: "me", q, maxResults: max });
  const odkaz = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(vyrazy.map((v) => `"${v}"`).join(" OR "))}`;
  const zpravy = await Promise.all(
    (data.messages ?? []).map(async ({ id }) => {
      const m = (await gmail.users.messages.get({ userId: "me", id: id!, format: "metadata", metadataHeaders: ["Subject", "From", "Date"] })).data;
      const h = (n: string) => m.payload?.headers?.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
      return {
        zdroj: "email" as const,
        cas: m.internalDate ? tedPraha(new Date(Number(m.internalDate))) : null,
        titulek: h("Subject") || "(bez předmětu)",
        kdo: h("From"),
        text: m.snippet ?? "",
        odkaz,
      };
    }),
  );
  return zpravy.sort((a, b) => (b.cas?.getTime() ?? 0) - (a.cas?.getTime() ?? 0));
}

// ---------- Kalendáře techniků ----------

export async function hledejKalendar(cal: calendar_v3.Calendar, vyrazy: string[], od: Date, do_: Date): Promise<Nalez[]> {
  if (!vyrazy.length) return [];
  const { data } = await cal.calendarList.list({ maxResults: 250 });
  const kalendare = (data.items ?? []).filter((k) => k.id && !k.id.endsWith("@group.v.calendar.google.com")); // bez svátků
  const nalezy = new Map<string, Nalez>();
  await Promise.all(
    kalendare.flatMap((k) =>
      vyrazy.map(async (v) => {
        const r = await cal.events.list({ calendarId: k.id!, q: v, singleEvents: true, timeMin: od.toISOString(), timeMax: do_.toISOString(), maxResults: 50 });
        for (const e of r.data.items ?? []) {
          if (!e.id || e.status === "cancelled" || nalezy.has(`${k.id}/${e.id}`)) continue;
          nalezy.set(`${k.id}/${e.id}`, {
            zdroj: "kalendar",
            cas: zApi(e.start?.dateTime ?? e.start?.date),
            titulek: e.summary ?? "",
            kde: k.summary ?? k.id!,
            text: [e.location, (e.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300)].filter(Boolean).join(" · "),
            odkaz: e.htmlLink ?? null,
          });
        }
      }),
    ),
  );
  return [...nalezy.values()].sort((a, b) => (b.cas?.getTime() ?? 0) - (a.cas?.getTime() ?? 0));
}

// ---------- Google Chat ----------

interface ChatZprava {
  name: string;
  text?: string;
  createTime?: string;
  sender?: { displayName?: string; name?: string };
  thread?: { name?: string };
}

/** Zprávy prostoru za posledních N dní – krátká cache, aby opakované hledání nečetlo vše znovu */
const cacheChatu = new Map<string, { kdy: number; zpravy: ChatZprava[]; nazev: string }>();
export const vycistitCacheChatu = () => cacheChatu.clear();

async function zpravyProstoru(prostor: string, token: string, fetchFn: typeof fetch, dniZpet: number, maxStran = 10) {
  const c = cacheChatu.get(prostor);
  if (c && Date.now() - c.kdy < 5 * 60_000) return c;
  const auth = { authorization: `Bearer ${token}` };
  const api = "https://chat.googleapis.com/v1";
  const info = await fetchFn(`${api}/${prostor}`, { headers: auth });
  if (!info.ok) throw new Error(`Chat ${prostor}: HTTP ${info.status} ${(await info.text()).slice(0, 200)}`);
  const nazev = ((await info.json()) as { displayName?: string }).displayName ?? prostor;

  const od = new Date(Date.now() - dniZpet * 86_400_000).toISOString();
  const zpravy: ChatZprava[] = [];
  let pageToken = "";
  for (let i = 0; i < maxStran; i++) {
    const p = new URLSearchParams({ pageSize: "1000", filter: `createTime > "${od}"` });
    if (pageToken) p.set("pageToken", pageToken);
    const r = await fetchFn(`${api}/${prostor}/messages?${p}`, { headers: auth });
    if (!r.ok) throw new Error(`Chat ${nazev}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const d = (await r.json()) as { messages?: ChatZprava[]; nextPageToken?: string };
    zpravy.push(...(d.messages ?? []));
    if (!d.nextPageToken) break;
    pageToken = d.nextPageToken;
  }
  const v = { kdy: Date.now(), zpravy, nazev };
  cacheChatu.set(prostor, v);
  return v;
}

export async function hledejChat(prostory: string[], vyrazy: string[], token: string, fetchFn: typeof fetch = fetch, dniZpet = 120): Promise<Nalez[]> {
  if (!vyrazy.length || !prostory.length) return [];
  const hledane = vyrazy.map((v) => v.toLowerCase());
  const vysledek: Nalez[] = [];
  for (const prostor of prostory) {
    const { zpravy, nazev } = await zpravyProstoru(prostor, token, fetchFn, dniZpet);
    const shody = zpravy.filter((m) => hledane.some((v) => (m.text ?? "").toLowerCase().includes(v)));
    const vlakna = new Set(shody.map((m) => m.thread?.name).filter(Boolean));
    const idProstoru = prostor.replace(/^spaces\//, "");
    for (const m of zpravy) {
      const shoda = shody.includes(m);
      if (!shoda && !(m.thread?.name && vlakna.has(m.thread.name))) continue;
      const idVlakna = m.thread?.name?.split("/").at(-1);
      vysledek.push({
        zdroj: "chat",
        cas: zApi(m.createTime),
        titulek: nazev,
        kde: nazev,
        kdo: m.sender?.displayName || undefined,
        text: (m.text ?? "").slice(0, 1000),
        odkaz: `https://mail.google.com/chat/u/0/#chat/space/${idProstoru}${idVlakna ? `/${idVlakna}` : ""}`,
        veVlakne: !shoda,
      });
    }
  }
  return vysledek.sort((a, b) => (b.cas?.getTime() ?? 0) - (a.cas?.getTime() ?? 0));
}

// ---------- Vše najednou ----------

async function sLimitem<T>(ms: number, p: Promise<T>): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`zdroj neodpověděl do ${ms / 1000} s`)), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

export async function hledejVsude(zav: ZavislostiZdroju, vyrazy: string[], now: Date, limitMs = 12_000): Promise<VysledekZdroje[]> {
  const od = new Date(now.getTime() - 180 * 86_400_000);
  const do_ = new Date(now.getTime() + 90 * 86_400_000);
  const zdroj = async (z: Zdroj, f: () => Promise<Nalez[]>): Promise<VysledekZdroje> => {
    try {
      return { zdroj: z, nalezy: await sLimitem(limitMs, f()) };
    } catch (e) {
      return { zdroj: z, nalezy: [], chyba: e instanceof Error ? e.message : String(e) };
    }
  };
  return Promise.all([
    zdroj("email", async () => hledejEmaily(await zav.gmail(), vyrazy)),
    zdroj("kalendar", async () => hledejKalendar(await zav.kalendar(), vyrazy, od, do_)),
    zdroj("chat", async () => hledejChat(zav.prostory, vyrazy, await zav.chatToken(), zav.fetchFn)),
  ]);
}
