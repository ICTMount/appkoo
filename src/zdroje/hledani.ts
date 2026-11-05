// Pilíř 1: hledání zakázky ve všech zdrojích – e-mail (schránka koordinace), kalendáře techniků, Google Chat.
// MWF je v databázi (src/web/data.ts); tady jsou ostatní zdroje. Vše jen ke čtení, jménem tmcz01
// (delegace, src/google/delegace.ts). Každý zdroj má časový limit a vlastní chybu – výpadek jednoho
// nezastaví ostatní.

import type { calendar_v3 } from "@googleapis/calendar";
import type { gmail_v1 } from "@googleapis/gmail";
import { tedPraha } from "../domain/time.js";
import type { Dotaz } from "../db/db.js";
import { hledejChatDb, hledejKalendarDb, stavSynchronizace } from "./sync.js";

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
  /** fotky, PDF a další soubory u zprávy (chat, e-mail) – k uložení do složky zakázky */
  prilohy?: Priloha[];
}

/** Příloha zprávy; `ref` říká, odkud ji lze stáhnout (krok 2: uložení do složky zakázky) */
export interface Priloha {
  nazev: string;
  /** MIME typ, např. image/jpeg */
  typ: string;
  /** bajty, když je zdroj udává */
  velikost: number | null;
  /** odkaz pro uživatele (Chat: downloadUri, Disk: soubor) */
  odkaz: string | null;
  ref:
    | { zdroj: "chat"; /** attachmentDataRef.resourceName – nahraný soubor (Chat media.download) */ media?: string; /** driveDataRef.driveFileId – soubor vložený z Disku */ driveId?: string }
    | { zdroj: "email"; zprava: string; priloha: string };
}

export const jeObrazek = (p: Priloha) => /^image\//.test(p.typ);

export interface VysledekZdroje {
  zdroj: Zdroj;
  nalezy: Nalez[];
  chyba?: string;
  /** trvání hledání v ms (do logu výkonu) */
  ms?: number;
}

export interface ZavislostiZdroju {
  /** databáze se synchronizovanými kalendáři a Chatem (sync.ts) – když je čerstvá, hledá se v ní a Google se nevolá */
  db?: Dotaz;
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

/** Skupiny s interními notifikacemi – e-maily poslané na ně se v přehledu zakázky nezobrazují */
export const INTERNI_SKUPINY = (process.env.INTERNI_SKUPINY ?? "cml@ictmount.com")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Zpráva šla na interní skupinu (To/Cc nebo hlavičky skupiny Google Groups) */
export function naInterniSkupinu(hlavicky: { name?: string | null; value?: string | null }[], skupiny = INTERNI_SKUPINY): boolean {
  const text = hlavicky
    .filter((x) => /^(to|cc|list-id|mailing-list|x-original-to)$/i.test(x.name ?? ""))
    .map((x) => x.value ?? "")
    .join(" ")
    .toLowerCase();
  return skupiny.some((s) => text.includes(s) || text.includes(s.replace("@", ".")));
}

/** Čitelný text těla e-mailu: text/plain, jinak text/html bez značek; citace starších zpráv se uříznou */
export function teloZpravy(p: gmail_v1.Schema$MessagePart | undefined): string {
  const casti: { typ: string; data: string }[] = [];
  const projdi = (x: gmail_v1.Schema$MessagePart | undefined) => {
    if (!x) return;
    if (x.body?.data && /^text\/(plain|html)/i.test(x.mimeType ?? "")) casti.push({ typ: x.mimeType!.toLowerCase(), data: x.body.data });
    for (const c of x.parts ?? []) projdi(c);
  };
  projdi(p);
  const vyber = casti.find((c) => c.typ.startsWith("text/plain")) ?? casti.find((c) => c.typ.startsWith("text/html"));
  if (!vyber) return "";
  let t = Buffer.from(vyber.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  if (vyber.typ.startsWith("text/html")) {
    t = t
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
  }
  t = t.replace(/\r/g, "").split(/\n(?:On .+wrote:|Dne .+napsal|-{2,} ?Original|> )/)[0]!;
  return t.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim().slice(0, 5000);
}

/** Přílohy e-mailu: části s názvem souboru a attachmentId (vložené obrázky bez názvu se přeskočí) */
export function prilohyEmailu(idZpravy: string, p: gmail_v1.Schema$MessagePart | undefined): Priloha[] {
  const v: Priloha[] = [];
  const projdi = (x: gmail_v1.Schema$MessagePart | undefined) => {
    if (!x) return;
    if (x.filename && x.body?.attachmentId) {
      v.push({ nazev: x.filename, typ: (x.mimeType ?? "application/octet-stream").toLowerCase(), velikost: x.body.size ?? null, odkaz: null, ref: { zdroj: "email", zprava: idZpravy, priloha: x.body.attachmentId } });
    }
    for (const c of x.parts ?? []) projdi(c);
  };
  projdi(p);
  return v;
}

export async function hledejEmaily(gmail: gmail_v1.Gmail, vyrazy: string[], max = 15, skupiny = INTERNI_SKUPINY): Promise<Nalez[]> {
  if (!vyrazy.length) return [];
  const bezSkupin = skupiny.map((s) => ` -to:${s} -cc:${s} -list:${s}`).join("");
  const q = `${vyrazy.map((v) => `"${v}"`).join(" OR ")} newer_than:365d${bezSkupin}`;
  const { data } = await gmail.users.messages.list({ userId: "me", q, maxResults: max });
  const odkaz = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`${vyrazy.map((v) => `"${v}"`).join(" OR ")}${bezSkupin}`)}`;
  const zpravy = await Promise.all(
    (data.messages ?? []).map(async ({ id }) => {
      // format "full" – celé tělo zprávy (dřív jen náhled ~200 znaků); v kartě se roluje
      const m = (await gmail.users.messages.get({ userId: "me", id: id!, format: "full" })).data;
      if (naInterniSkupinu(m.payload?.headers ?? [], skupiny)) return null;
      const h = (n: string) => m.payload?.headers?.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
      return {
        zdroj: "email" as const,
        cas: m.internalDate ? tedPraha(new Date(Number(m.internalDate))) : null,
        titulek: h("Subject") || "(bez předmětu)",
        kdo: h("From"),
        text: teloZpravy(m.payload) || m.snippet || "",
        odkaz,
        prilohy: prilohyEmailu(m.id ?? id!, m.payload),
      };
    }),
  );
  return zpravy.filter((z): z is NonNullable<typeof z> => z !== null).sort((a, b) => (b.cas?.getTime() ?? 0) - (a.cas?.getTime() ?? 0));
}

// ---------- Kalendáře techniků ----------

/** Nejvýš N úloh najednou – přes 100 souběžných dotazů na Calendar API Google brzdí a hledání nestihne limit */
export async function poDavkach<T>(ulohy: (() => Promise<T>)[], soubezne = 8): Promise<T[]> {
  const vysledky: T[] = new Array(ulohy.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(soubezne, ulohy.length) }, async () => {
      for (let j = i++; j < ulohy.length; j = i++) vysledky[j] = await ulohy[j]!();
    }),
  );
  return vysledky;
}

/** Seznam kalendářů techniků se mění zřídka – cache 10 min na API objekt (dva dotazy méně na každý detail zakázky) */
const SEZNAM_CACHE_MS = 10 * 60_000;
const seznamCache = new WeakMap<calendar_v3.Calendar, { do: number; p: Promise<calendar_v3.Schema$CalendarListEntry[]> }>();
export const vycistitCacheKalendaru = (cal: calendar_v3.Calendar) => seznamCache.delete(cal);

async function seznamKalendaru(cal: calendar_v3.Calendar): Promise<calendar_v3.Schema$CalendarListEntry[]> {
  const hit = seznamCache.get(cal);
  if (hit && hit.do > Date.now()) return hit.p;
  const p = cal.calendarList.list({ maxResults: 250 }).then(({ data }) => (data.items ?? []).filter((k) => k.id && !k.id.endsWith("@group.v.calendar.google.com"))); // bez svátků
  seznamCache.set(cal, { do: Date.now() + SEZNAM_CACHE_MS, p });
  p.catch(() => seznamCache.delete(cal));
  return p;
}

/**
 * Paměť událostí techniků: všechny kalendáře, okno 2 roky zpět až 90 dní dopředu, načtené jednou a obnovované
 * na pozadí (stale-while-revalidate). Detail zakázky tak nečeká na desítky dotazů do Calendar API –
 * hledání zakázky i lokality běží nad pamětí instance. Nabídka termínů má vlastní, čerstvější cache (30 s).
 */
export interface UdalostVPameti {
  kalendar: string;
  kalendarNazev: string;
  id: string;
  summary: string;
  location: string;
  /** popis zkrácený na 2000 znaků – pro hledání adresy a čísla zakázky */
  description: string;
  cas: Date | null;
  odkaz: string | null;
  /** malá písmena bez diakritiky: summary + description + location */
  hledani: string;
}
export interface PametKalendaru {
  nacteno: number;
  udalosti: Map<string, UdalostVPameti[]>;
}
const PAMET_CERSTVA_MS = 5 * 60_000; // po této době se obnoví na pozadí, zatím se vrací stará
const PAMET_MAX_MS = 45 * 60_000; // po této době se raději počká na obnovu (obnova na pozadí opakovaně selhávala)
const OKNO_ZPET_DNI = 730;
const OKNO_DOPREDU_DNI = 90;
const pametKalendaru = new WeakMap<calendar_v3.Calendar, { p: Promise<PametKalendaru> | null; data: PametKalendaru | null; obnova: Promise<PametKalendaru> | null }>();
export const vycistitPametUdalosti = (cal: calendar_v3.Calendar) => pametKalendaru.delete(cal);

export async function nactiPamet(cal: calendar_v3.Calendar, now: Date): Promise<PametKalendaru> {
  const kalendare = await seznamKalendaru(cal);
  const timeMin = new Date(now.getTime() - OKNO_ZPET_DNI * 86_400_000).toISOString();
  const timeMax = new Date(now.getTime() + OKNO_DOPREDU_DNI * 86_400_000).toISOString();
  const udalosti = new Map<string, UdalostVPameti[]>();
  await poDavkach(
    kalendare.map((k) => async () => {
      const seznam: UdalostVPameti[] = [];
      let pageToken: string | undefined;
      do {
        const r = await cal.events.list({
          calendarId: k.id!,
          singleEvents: true,
          timeMin,
          timeMax,
          maxResults: 2500,
          pageToken,
          fields: "nextPageToken,items(id,status,summary,description,location,start,htmlLink)",
        });
        for (const e of r.data.items ?? []) {
          if (!e.id || e.status === "cancelled") continue;
          const description = (e.description ?? "").slice(0, 2000);
          seznam.push({
            kalendar: k.id!,
            kalendarNazev: k.summary ?? k.id!,
            id: e.id,
            summary: e.summary ?? "",
            location: e.location ?? "",
            description,
            cas: zApi(e.start?.dateTime ?? e.start?.date),
            odkaz: e.htmlLink ?? null,
            hledani: bezDiakritiky(`${e.summary ?? ""} ${description} ${e.location ?? ""}`),
          });
        }
        pageToken = r.data.nextPageToken ?? undefined;
      } while (pageToken);
      udalosti.set(k.id!, seznam);
    }),
  );
  return { nacteno: Date.now(), udalosti };
}

/** Události z paměti; první volání načte, další vrací hned a po 5 min obnovují na pozadí */
export async function udalostiZPameti(cal: calendar_v3.Calendar, now: Date): Promise<UdalostVPameti[]> {
  let z = pametKalendaru.get(cal);
  if (!z) pametKalendaru.set(cal, (z = { p: null, data: null, obnova: null }));
  const stari = z.data ? Date.now() - z.data.nacteno : Infinity;
  if (!z.data || stari > PAMET_MAX_MS) {
    // první načtení (nebo paměť příliš stará): počkat; souběžné požadavky sdílí jeden slib
    if (!z.p) {
      z.p = nactiPamet(cal, now).finally(() => (z!.p = null));
    }
    z.data = await z.p;
  } else if (stari > PAMET_CERSTVA_MS && !z.obnova) {
    z.obnova = nactiPamet(cal, now)
      .then((d) => (z!.data = d))
      .catch((e) => {
        console.log(JSON.stringify({ severity: "WARNING", message: `Obnova paměti kalendářů selhala: ${e instanceof Error ? e.message : String(e)}` }));
        return z!.data!;
      })
      .finally(() => (z!.obnova = null));
  }
  return [...z.data.udalosti.values()].flat();
}

export async function hledejKalendar(cal: calendar_v3.Calendar, vyrazy: string[], od: Date, do_: Date, now: Date = new Date()): Promise<Nalez[]> {
  if (!vyrazy.length) return [];
  const hledane = vyrazy.map(bezDiakritiky);
  const vse = await udalostiZPameti(cal, now);
  const nalezy: Nalez[] = [];
  for (const u of vse) {
    if (!u.cas || u.cas < od || u.cas > do_) continue;
    if (!hledane.some((v) => u.hledani.includes(v))) continue;
    nalezy.push({
      zdroj: "kalendar",
      cas: u.cas,
      titulek: u.summary,
      kde: u.kalendarNazev,
      // jen název, čas a adresa – popis události se v detailu nezobrazuje
      text: u.location,
      odkaz: u.odkaz,
    });
  }
  return nalezy.sort((a, b) => (b.cas?.getTime() ?? 0) - (a.cas?.getTime() ?? 0));
}

// ---------- Google Chat ----------

interface ChatPriloha {
  name?: string;
  contentName?: string;
  contentType?: string;
  downloadUri?: string;
  attachmentDataRef?: { resourceName?: string };
  driveDataRef?: { driveFileId?: string };
}

export interface ChatZprava {
  name: string;
  text?: string;
  createTime?: string;
  sender?: { displayName?: string; name?: string };
  thread?: { name?: string };
  attachment?: ChatPriloha[];
}

/** Přílohy chatové zprávy: nahrané soubory (media) i soubory vložené z Disku */
export function prilohyChatu(a: ChatPriloha[] | undefined): Priloha[] {
  return (a ?? []).flatMap((x) => {
    const media = x.attachmentDataRef?.resourceName;
    const driveId = x.driveDataRef?.driveFileId;
    if (!media && !driveId) return [];
    return [{
      nazev: x.contentName || (driveId ? "soubor z Disku" : "příloha"),
      typ: (x.contentType ?? "application/octet-stream").toLowerCase(),
      velikost: null,
      odkaz: x.downloadUri ?? (driveId ? `https://drive.google.com/file/d/${driveId}/view` : null),
      ref: { zdroj: "chat", ...(media ? { media } : {}), ...(driveId ? { driveId } : {}) },
    }];
  });
}

/**
 * Zprávy prostoru za posledních N dní v paměti instance. První načtení stáhne vše (až 10 stran po 1000),
 * další už jen zprávy novější než poslední známá (filter createTime >). Po 60 s se obnovuje na pozadí –
 * detail zakázky nikdy nečeká na stahování, jen první otevření po startu instance.
 */
interface PametProstoru {
  kdy: number;
  zpravy: ChatZprava[];
  nazev: string;
  /** createTime poslední známé zprávy – odtud se dočítá */
  posledni: string | null;
  obnova: Promise<void> | null;
}
const CHAT_CERSTVY_MS = 60_000;
const CHAT_MAX_MS = 30 * 60_000;
const cacheChatu = new Map<string, PametProstoru>();
export const vycistitCacheChatu = () => cacheChatu.clear();

export async function stahniZpravy(prostor: string, auth: Record<string, string>, fetchFn: typeof fetch, od: string, nazev: string, maxStran: number): Promise<ChatZprava[]> {
  const api = "https://chat.googleapis.com/v1";
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
  return zpravy;
}

async function zpravyProstoru(prostor: string, token: string, fetchFn: typeof fetch, dniZpet: number, maxStran = 10): Promise<{ zpravy: ChatZprava[]; nazev: string }> {
  const auth = { authorization: `Bearer ${token}` };
  const api = "https://chat.googleapis.com/v1";
  const hranice = new Date(Date.now() - dniZpet * 86_400_000).toISOString();
  const c = cacheChatu.get(prostor);
  const doplnit = async (p: PametProstoru) => {
    const nove = await stahniZpravy(prostor, auth, fetchFn, p.posledni ?? hranice, p.nazev, maxStran);
    const zname = new Set(p.zpravy.map((m) => m.name));
    p.zpravy = [...p.zpravy.filter((m) => (m.createTime ?? "") >= hranice), ...nove.filter((m) => !zname.has(m.name))];
    p.posledni = p.zpravy.reduce<string | null>((max, m) => (m.createTime && (!max || m.createTime > max) ? m.createTime : max), p.posledni);
    p.kdy = Date.now();
  };
  if (c && Date.now() - c.kdy < CHAT_MAX_MS) {
    if (Date.now() - c.kdy > CHAT_CERSTVY_MS && !c.obnova) {
      c.obnova = doplnit(c)
        .catch((e) => console.log(JSON.stringify({ severity: "WARNING", message: `Obnova Chatu ${c.nazev} selhala: ${e instanceof Error ? e.message : String(e)}` })))
        .finally(() => (c.obnova = null));
    }
    return c;
  }
  const info = await fetchFn(`${api}/${prostor}`, { headers: auth });
  if (!info.ok) throw new Error(`Chat ${prostor}: HTTP ${info.status} ${(await info.text()).slice(0, 200)}`);
  const nazev = ((await info.json()) as { displayName?: string }).displayName ?? prostor;
  const p: PametProstoru = c ?? { kdy: 0, zpravy: [], nazev, posledni: null, obnova: null };
  p.nazev = nazev;
  await doplnit(p);
  cacheChatu.set(prostor, p);
  return p;
}

export async function hledejChat(prostory: string[], vyrazy: string[], token: string, fetchFn: typeof fetch = fetch, dniZpet = 60): Promise<Nalez[]> {
  if (!vyrazy.length || !prostory.length) return [];
  const hledane = vyrazy.map((v) => v.toLowerCase());
  const vysledek: Nalez[] = [];
  // prostory souběžně – postupně to u velkých prostorů nestihlo časový limit
  const nactene = await Promise.all(prostory.map(async (prostor) => ({ prostor, ...(await zpravyProstoru(prostor, token, fetchFn, dniZpet)) })));
  for (const { prostor, zpravy, nazev } of nactene) {
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
        text: (m.text ?? "").slice(0, 5000),
        odkaz: `https://mail.google.com/chat/u/0/#chat/space/${idProstoru}${idVlakna ? `/${idVlakna}` : ""}`,
        veVlakne: !shoda,
        prilohy: prilohyChatu(m.attachment),
      });
    }
  }
  return vysledek.sort((a, b) => (b.cas?.getTime() ?? 0) - (a.cas?.getTime() ?? 0));
}

/**
 * Zahřátí paměti (po startu instance a pak každých 5 min z časovače): události kalendářů a zprávy Chatu
 * se načtou dřív, než je někdo potřebuje – první ranní otevření zakázky nečeká na Google.
 */
export async function prohrejPamet(zav: ZavislostiZdroju, now: Date): Promise<void> {
  const chyba = (co: string) => (e: unknown) => console.log(JSON.stringify({ severity: "WARNING", message: `Zahřátí paměti (${co}) selhalo: ${e instanceof Error ? e.message : String(e)}` }));
  await Promise.all([
    (async () => udalostiZPameti(await zav.kalendar(), now))().catch(chyba("kalendáře")),
    (async () => {
      const token = await zav.chatToken();
      await Promise.all(zav.prostory.map((p) => zpravyProstoru(p, token, zav.fetchFn ?? fetch, 60)));
    })().catch(chyba("chat")),
  ]);
}

// ---------- Vše najednou ----------

export async function sLimitem<T>(ms: number, p: Promise<T>): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`zdroj neodpověděl do ${ms / 1000} s`)), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

export async function hledejVsude(zav: ZavislostiZdroju, vyrazy: string[], now: Date, limitMs = 20_000, limitChatMs = 25_000): Promise<VysledekZdroje[]> {
  const od = new Date(now.getTime() - 180 * 86_400_000);
  const do_ = new Date(now.getTime() + 90 * 86_400_000);
  const zdroj = async (z: Zdroj, f: () => Promise<Nalez[]>): Promise<VysledekZdroje> => {
    const t = Date.now();
    try {
      return { zdroj: z, nalezy: await sLimitem(z === "chat" ? limitChatMs : limitMs, f()), ms: Date.now() - t };
    } catch (e) {
      return { zdroj: z, nalezy: [], chyba: e instanceof Error ? e.message : String(e), ms: Date.now() - t };
    }
  };
  const [kalDb, chatDb] = await Promise.all([synchronizovano(zav.db, "kalendare"), synchronizovano(zav.db, "chat")]);
  return Promise.all([
    zdroj("email", async () => hledejEmaily(await zav.gmail(), vyrazy)),
    zdroj("kalendar", async () => (kalDb ? hledejKalendarDb(zav.db!, vyrazy, od, do_) : hledejKalendar(await zav.kalendar(), vyrazy, od, do_, now))),
    zdroj("chat", async () => (chatDb ? hledejChatDb(zav.db!, zav.prostory, vyrazy) : hledejChat(zav.prostory, vyrazy, await zav.chatToken(), zav.fetchFn))),
  ]);
}

/** Databáze má synchronizaci mladší než 24 h → hledat v ní (po víkendu bez importů se do pondělí dojede z paměti) */
export async function synchronizovano(db: Dotaz | undefined, klic: "kalendare" | "chat", maxStariMs = 24 * 3_600_000): Promise<boolean> {
  if (!db) return false;
  const kdy = await stavSynchronizace(db, klic);
  return !!kdy && Date.now() - kdy.getTime() < maxStariMs;
}

// ---------- Instalovali jsme v lokalitě ----------

export const bezDiakritiky = (x: string) => x.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Ulice a číslo popisné z adresy MWF („Praha, Krčská 991/63“ → Krčská, 991) */
export function uliceCislo(adresa: string): { ulice: string; cp: string } | null {
  for (const cast of adresa.split(",").map((x) => x.trim())) {
    const m = cast.match(/^(\p{L}[\p{L}\s.'-]*?)\s+(\d+)(?:\/\d+\w*)?$/u);
    if (m && !/^praha$/i.test(m[1]!.trim())) return { ulice: m[1]!.trim(), cp: m[2]! };
  }
  return null;
}

export interface NalezLokality extends Nalez {
  oId?: string;
  budouci: boolean;
}

/**
 * Události v kalendářích techniků na stejné adrese (ulice + číslo popisné) za poslední 2 roky i dopředu –
 * co už jsme na lokalitě dělali (zásuvky, přístup, SVJ…). Události této zakázky a volné sloty se vynechají.
 */
export async function hledejNaLokalite(cal: calendar_v3.Calendar, adresa: string, vyloucitOId: string, now: Date, max = 20): Promise<NalezLokality[] | null> {
  const uc = uliceCislo(adresa);
  if (!uc) return null;
  const ulice = bezDiakritiky(uc.ulice);
  const cislo = new RegExp(`(^|[^\\d])${uc.cp}(/|[^\\d]|$)`);
  const horni = new Date(now.getTime() + 60 * 86_400_000);
  const nalezy: NalezLokality[] = [];
  for (const u of await udalostiZPameti(cal, now)) {
    if (!u.cas || u.cas > horni) continue;
    if (/\bvoln[yae]\b/i.test(bezDiakritiky(u.summary)) || (vyloucitOId && u.summary.includes(vyloucitOId))) continue;
    const kde = bezDiakritiky(`${u.location} ${u.description}`);
    if (!kde.includes(ulice) || !cislo.test(kde)) continue;
    nalezy.push({
      zdroj: "kalendar",
      cas: u.cas,
      titulek: u.summary,
      kde: u.kalendarNazev,
      text: u.location,
      odkaz: u.odkaz,
      oId: u.summary.match(/O-\d{8,}/)?.[0],
      budouci: u.cas > now,
    });
  }
  return nalezy.sort((a, b) => (b.cas?.getTime() ?? 0) - (a.cas?.getTime() ?? 0)).slice(0, max);
}
