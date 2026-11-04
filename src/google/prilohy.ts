// Přílohy zpráv (fotky, PDF z Chatu a e-mailu) → složka zakázky na Disku.
// Koordinátorka si v detailu zakázky zaškrtne, co uložit; nic se nekopíruje automaticky.
// Odkaz z Chat API (downloadUri) platí jen pro účet, který ho vyžádal (tmcz01) – proto jde zobrazení
// i uložení přes aplikaci: stáhne jménem tmcz01 a předá prohlížeči / nahraje na Disk.

import type { drive_v3 } from "@googleapis/drive";
import type { gmail_v1 } from "@googleapis/gmail";
import { Readable } from "node:stream";
import type { Dotaz } from "../db/db.js";
import type { Priloha } from "../zdroje/hledani.js";

/** Co z přílohy potřebuje formulář: reference + název + typ + datum a odesílatel zprávy (do názvu souboru) */
export interface VyberPrilohy {
  priloha: Priloha;
  /** ISO datum zprávy (YYYY-MM-DD), když je známé */
  den: string | null;
  kdo: string | null;
}

const B64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const zB64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** Hodnota checkboxu / parametru odkazu: base64url JSON (bez JS v prohlížeči je to nejjednodušší přenos) */
export function kodujVyber(v: VyberPrilohy): string {
  return B64(JSON.stringify({ n: v.priloha.nazev, t: v.priloha.typ, r: v.priloha.ref, d: v.den, k: v.kdo }));
}

// skutečný tvar attachmentDataRef.resourceName se od dokumentace liší – kontrola jen na bezpečné znaky a cestu spaces/…/attachments/…
const RE_MEDIA = /^spaces\/[\w.=+%-]+\/messages\/[\w.=+%-]+\/attachments\/[\w.=+%/-]{1,400}$/;
const RE_ID = /^[\w-]{1,200}$/;

/** Zpět z hodnoty formuláře; neplatné (podvržené) hodnoty vrátí null */
export function dekodujVyber(s: string): VyberPrilohy | null {
  try {
    const o = JSON.parse(zB64(s)) as { n?: unknown; t?: unknown; r?: Record<string, unknown>; d?: unknown; k?: unknown };
    if (typeof o.n !== "string" || typeof o.t !== "string" || !o.r || typeof o.r !== "object") return null;
    let ref: Priloha["ref"];
    if (o.r.zdroj === "chat") {
      const media = typeof o.r.media === "string" ? o.r.media : undefined;
      const driveId = typeof o.r.driveId === "string" ? o.r.driveId : undefined;
      if ((!media || !RE_MEDIA.test(media)) && (!driveId || !RE_ID.test(driveId))) {
        console.log(JSON.stringify({ severity: "WARNING", message: "Příloha chat: reference neprošla kontrolou", media, driveId }));
        return null;
      }
      ref = { zdroj: "chat", ...(media && RE_MEDIA.test(media) ? { media } : {}), ...(driveId && RE_ID.test(driveId) ? { driveId } : {}) };
    } else if (o.r.zdroj === "email") {
      if (typeof o.r.zprava !== "string" || typeof o.r.priloha !== "string" || !RE_ID.test(o.r.zprava) || !/^[\w-]{1,500}$/.test(o.r.priloha)) return null;
      ref = { zdroj: "email", zprava: o.r.zprava, priloha: o.r.priloha };
    } else return null;
    return {
      priloha: { nazev: o.n.slice(0, 200), typ: o.t.slice(0, 100), velikost: null, odkaz: null, ref },
      den: typeof o.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.d) ? o.d : null,
      kdo: typeof o.k === "string" ? o.k.slice(0, 80) : null,
    };
  } catch (e) {
    console.log(JSON.stringify({ severity: "WARNING", message: `Příloha: neplatná hodnota (${e instanceof Error ? e.message : String(e)})`, hodnota: s.slice(0, 300) }));
    return null;
  }
}

/** Klíč pro evidenci (jedna příloha se neukládá dvakrát) */
export function klicPrilohy(ref: Priloha["ref"]): string {
  return ref.zdroj === "chat" ? `chat:${ref.media ?? `drive:${ref.driveId}`}` : `email:${ref.zprava}:${ref.priloha}`;
}

/** „2026-11-04 Chat Krechter – 15254.jpeg“ – ve složce je vidět, odkud a kdy fotka přišla */
export function nazevSouboru(v: VyberPrilohy): string {
  const zdroj = v.priloha.ref.zdroj === "chat" ? "Chat" : "E-mail";
  const kdo = (v.kdo ?? "").replace(/\s*[-–]\s*ICTM$/i, "").replace(/<[^>]*>/g, "").trim();
  const nazev = v.priloha.nazev.replace(/[\\/:*?"<>|]/g, "_").trim() || "priloha";
  return [v.den, zdroj, kdo && kdo.slice(0, 40), "–", nazev].filter(Boolean).join(" ").replace(/\s+–\s+/, " – ");
}

export interface ZavislostiPriloh {
  gmail(): Promise<gmail_v1.Gmail>;
  chatToken(): Promise<string>;
  fetchFn?: typeof fetch;
}

/** Obsah přílohy jako proud (Chat media, Gmail) – pro zobrazení v prohlížeči i nahrání na Disk */
export async function stahniPrilohu(zav: ZavislostiPriloh, p: Priloha): Promise<{ proud: Readable; typ: string; delka: number | null }> {
  const fetchFn = zav.fetchFn ?? fetch;
  if (p.ref.zdroj === "chat") {
    if (!p.ref.media) throw new Error("Soubor z Disku se stahuje přímo z Disku (kopie), ne přes Chat.");
    const r = await fetchFn(`https://chat.googleapis.com/v1/media/${p.ref.media}?alt=media`, { headers: { authorization: `Bearer ${await zav.chatToken()}` } });
    if (!r.ok || !r.body) throw new Error(`Chat media: HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const delka = Number(r.headers.get("content-length"));
    return { proud: Readable.fromWeb(r.body as never), typ: r.headers.get("content-type") || p.typ, delka: Number.isFinite(delka) && delka > 0 ? delka : null };
  }
  const gmail = await zav.gmail();
  const { data } = await gmail.users.messages.attachments.get({ userId: "me", messageId: p.ref.zprava, id: p.ref.priloha });
  if (!data.data) throw new Error("Gmail: příloha je prázdná.");
  const buf = Buffer.from(data.data, "base64url");
  return { proud: Readable.from(buf), typ: p.typ, delka: buf.length };
}

/** Uloží přílohu do složky na Disku; vrátí ID souboru. Soubor vložený z Disku se jen zkopíruje. */
export async function ulozPrilohuNaDisk(zav: ZavislostiPriloh, drive: drive_v3.Drive, slozkaId: string, v: VyberPrilohy): Promise<string> {
  const nazev = nazevSouboru(v);
  if (v.priloha.ref.zdroj === "chat" && !v.priloha.ref.media && v.priloha.ref.driveId) {
    const { data } = await drive.files.copy({ fileId: v.priloha.ref.driveId, requestBody: { name: nazev, parents: [slozkaId] }, fields: "id", supportsAllDrives: true });
    return data.id!;
  }
  const { proud, typ } = await stahniPrilohu(zav, v.priloha);
  const { data } = await drive.files.create({ requestBody: { name: nazev, parents: [slozkaId] }, media: { mimeType: typ, body: proud }, fields: "id", supportsAllDrives: true });
  return data.id!;
}

// ---------- evidence ----------

export interface UlozenySoubor {
  klic: string;
  driveId: string;
  nazev: string;
  ulozil: string;
  ulozeno: Date;
}

export const odkazSouboru = (id: string) => `https://drive.google.com/file/d/${id}/view`;

const TABULKA = `CREATE TABLE IF NOT EXISTS soubor_zakazky (
  objednavka text NOT NULL,
  klic       text NOT NULL,
  drive_id   text NOT NULL,
  nazev      text NOT NULL,
  ulozil     text NOT NULL,
  ulozeno    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (objednavka, klic)
)`;

const pripraveno = new WeakMap<Dotaz, Promise<unknown>>();
function priprav(db: Dotaz): Promise<unknown> {
  let p = pripraveno.get(db);
  if (!p) {
    p = db.query(TABULKA).catch((e) => {
      pripraveno.delete(db);
      throw e;
    });
    pripraveno.set(db, p);
  }
  return p;
}

export async function nactiSoubory(db: Dotaz, objednavka: string): Promise<Map<string, UlozenySoubor>> {
  try {
    await priprav(db);
    const { rows } = await db.query<{ klic: string; drive_id: string; nazev: string; ulozil: string; ulozeno: Date }>(
      "SELECT klic, drive_id, nazev, ulozil, ulozeno FROM soubor_zakazky WHERE objednavka = $1",
      [objednavka],
    );
    return new Map(rows.map((r) => [r.klic, { klic: r.klic, driveId: r.drive_id, nazev: r.nazev, ulozil: r.ulozil, ulozeno: new Date(r.ulozeno) }]));
  } catch {
    return new Map(); // detail zakázky nesmí spadnout kvůli evidenci
  }
}

export async function ulozSoubor(db: Dotaz, s: { objednavka: string; klic: string; driveId: string; nazev: string; ulozil: string }): Promise<void> {
  await priprav(db);
  await db.query(
    "INSERT INTO soubor_zakazky (objednavka, klic, drive_id, nazev, ulozil) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (objednavka, klic) DO NOTHING",
    [s.objednavka, s.klic, s.driveId, s.nazev, s.ulozil],
  );
}
