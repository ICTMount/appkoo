// Webové rozhraní AppKoo (Cloud Run služba za Identity-Aware Proxy).
// Fronta k volání, detail zakázky s hledáním ve všech zdrojích, plánování – režim A (zakázka → slot,
// /zakazka/:id/terminy) a režim B (slot → zakázky, /planovani) – a zápis do kalendáře technika.
// Bez externích knihoven – node:http.
//
// Přihlášení: IAP pustí jen účty, které mají v projektu roli „IAP-secured Web App User“,
// a pošle e-mail uživatele v hlavičce x-goog-authenticated-user-email. Aplikace navíc
// kontroluje seznam POVOLENI_UZIVATELE a (pokud je nastavené IAP_AUDIENCE) podpis IAP.
//
// Proměnné prostředí:
//   DATABASE_URL         připojení k Cloud SQL (secret)
//   PORT                 nastavuje Cloud Run (výchozí 8080)
//   SPRAVCI              e-maily správců (vždy přístup + Konfigurace), čárkami; výchozí davidh@ictmount.com
//   POVOLENI_UZIVATELE   přechodně, dokud je číselník Uživatelé prázdný: e-maily nebo domény (@ictmount.com)
//   IAP_AUDIENCE         volitelně: /projects/<číslo>/locations/<region>/services/<služba> – ověření podpisu IAP
//   DEV_USER             jen pro lokální vývoj: e-mail, pod kterým se jde bez IAP
//   ZAPIS_KALENDARE      „ano“ = zápis termínů do kalendářů techniků zapnutý (jinak jen náhled nabídky)
//   ZAPIS_TECHNICI       komu se smí zapisovat: jména techniků čárkami, nebo „vsichni“ (výchozí nikdo)
//   GOOGLE_MAPS_API_KEY  geokódování adres (secret)
//   DELEGACE_UZIVATEL    účet Workspace, jehož jménem se čte e-mail, kalendáře a chat (tmcz01@ictmount.com)
//   SERVISNI_UCET        e-mail servisního účtu aplikace (appkoo-runner@appkoo.iam.gserviceaccount.com)
//   CHAT_PROSTORY        chatové prostory k prohledání, čárkami (spaces/AAQA…)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { OAuth2Client } from "google-auth-library";
import type { Db } from "../db/db.js";
import { CISELNIKY, nahledImportu, nastaveniPlanovani, VYCHOZI_POLOZKY, exportCsv, type CiselnikId } from "../config/ciselniky.js";
import { nactiCiselnik, ulozImport } from "../db/ciselniky.js";

import { decodeExport } from "../import/csv.js";
import { nactiHistorii, nactiPolozky, nactiPrehled, strankaCiselniku, strankaKonfigurace, strankaNahledu } from "./konfigurace.js";
import { akcePozadavku, nactiLog, strankaLogu, strankaNotifikaci, zaznamenej } from "./log.js";
import { dohledejNotifikaci, prehledNotifikaci, type UlozenaNotifikace } from "../ingest/notifikace.js";
import { drive as driveApi } from "@googleapis/drive";
import { GoogleAuth } from "google-auth-library";
import { POPIS_ROLE, roleUzivatele, type Role } from "./uzivatele.js";
import { pgDb } from "../db/db.js";
import { tedPraha } from "../domain/time.js";
import { faktaZakazky } from "../domain/priorita.js";
import { kalendarApi, obsadVolnySlot, SlotObsazen, udalostZakazky, vratitNaVolny } from "../gcal/kalendar.js";
import { sestavUdalost } from "../gcal/udalost.js";
import { odhadVzdalenosti } from "../plan/geo.js";
import { googleGeokoder, sCache } from "../plan/geokod.js";
import { slaKonec } from "../plan/kpi.js";
import { webcalendar } from "../domain/webcalendar.js";
import { geokodujVse, kontrolaBran, nabidniProZakazku, nactiKalendare, najdiTerminVKalendari, zapomenKalendar, navrhyProSlot, pracovniDny, prehledDne, textProMwf, type Nabidka, type ZavislostiPlanovace } from "../plan/planovac.js";
import { addDays, atTime, isoDate } from "../domain/time.js";
import { isWorkday } from "../domain/workdays.js";
import { calendar as calendarApi } from "@googleapis/calendar";
import { gmail as gmailApi } from "@googleapis/gmail";
import { delegace, SCOPY_KALENDAR } from "../google/delegace.js";
import { hledejNaLokalite, hledejVsude, ocistitDotaz, sLimitem, vyrazyZakazky, type ZavislostiZdroju } from "../zdroje/hledani.js";
import { hledejZakazky, najdiAktivitu, nactiDetail, nactiFrontu, nactiStavImportu } from "./data.js";
import type { Lokalita } from "./html.js";
import { nastavZobrazeniPriorit, strankaChyby, strankaTechnika, strankaUvod, strankaVysledku, strankaZakazky, strankaZapisu, strankaZapsano, type StrankaTechnika } from "./html.js";
import { chybejiciPotvrzeni, inicialy, kandidatiKDoplneni, mestskeCasti, nactiKontext, nestandardZFormulare, presunZParametru, smazUdalost, smiZapisovat, udajeZFormulare, ulozUdalost } from "./planovani.js";
import type { OkoliZapisu } from "./html.js";
import { jeBlok, jeVolneOkno } from "../gcal/kontrola.js";
import type { TechnikPlanu } from "../plan/planovac.js";
import type { Zakazka } from "../import/mwfExport.js";

export interface NastaveniWebu {
  povoleni: string[];
  /** ověří podpis IAP; vrátí e-mail nebo null */
  overIap?: (jwt: string) => Promise<string | null>;
  devUser?: string;
  ted?: () => Date;
  /** kalendáře, geokódování a vzdálenosti pro nabídku termínů (vytvoří se při prvním použití) */
  planovac?: () => ZavislostiPlanovace | Promise<ZavislostiPlanovace>;
  zapis?: { zapnuty: boolean; technici: string[] | "vsichni" };
  /** e-mail, kalendáře a chat (pilíř 1 – hledání ve všech zdrojích) */
  zdroje?: () => ZavislostiZdroju;
  /** správci (e-maily) – vždy role správce, i když nejsou v číselníku Uživatelé */
  spravci?: string[];
  /** dohledání notifikačního PDF na Drive, když ho detail ještě nemá (web má NOTIFIKACE_SLOZKA) */
  notifikace?: (idAktivity: string, klice: { idObjednavkyZaklad?: string | null; idS7?: string | null }) => Promise<UlozenaNotifikace | null>;
}

/** Formulář smí přijít jen z vlastní stránky (ochrana proti podvrženému odeslání z cizího webu) */
export function zVlastniStranky(req: IncomingMessage): boolean {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const zdroj = req.headers.origin ?? req.headers.referer;
  if (typeof host !== "string" || typeof zdroj !== "string") return false;
  try {
    return new URL(zdroj).host === host;
  } catch {
    return false;
  }
}

class PrilisVelke extends Error {}

async function ctiTelo(req: IncomingMessage, max: number): Promise<Buffer> {
  const casti: Buffer[] = [];
  let delka = 0;
  for await (const c of req) {
    delka += (c as Buffer).length;
    if (delka > max) throw new PrilisVelke("Formulář je příliš velký.");
    casti.push(c as Buffer);
  }
  return Buffer.concat(casti);
}

async function ctiFormular(req: IncomingMessage, max = 64 * 1024): Promise<URLSearchParams> {
  return new URLSearchParams((await ctiTelo(req, max)).toString("utf8"));
}

/** multipart/form-data (nahrání souboru): pole → { obsah, soubor } */
export function rozlozMultipart(telo: Buffer, contentType: string): Map<string, { obsah: Buffer; soubor?: string }> {
  const vysledek = new Map<string, { obsah: Buffer; soubor?: string }>();
  const hranice = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!hranice) return vysledek;
  const oddelovac = Buffer.from(`--${hranice[1] ?? hranice[2]}`);
  let pozice = telo.indexOf(oddelovac);
  while (pozice >= 0) {
    const dalsi = telo.indexOf(oddelovac, pozice + oddelovac.length);
    if (dalsi < 0) break;
    const cast = telo.subarray(pozice + oddelovac.length + 2, dalsi - 2); // bez \r\n na začátku a konci
    const konecHlavicek = cast.indexOf("\r\n\r\n");
    if (konecHlavicek > 0) {
      const hlavicky = cast.subarray(0, konecHlavicek).toString("utf8");
      const jmeno = hlavicky.match(/name="([^"]*)"/i)?.[1];
      const soubor = hlavicky.match(/filename="([^"]*)"/i)?.[1];
      if (jmeno) vysledek.set(jmeno, { obsah: cast.subarray(konecHlavicek + 4), ...(soubor !== undefined ? { soubor } : {}) });
    }
    pozice = dalsi;
  }
  return vysledek;
}

/** Vybraný slot z parametrů (k = kalendář, e = událost VOLNY, t = technik, od/do) */
function vybranySlot(p: URLSearchParams) {
  const k = p.get("k") ?? "";
  const e = p.get("e") ?? "";
  const t = p.get("t") ?? "";
  const od = new Date(p.get("od") ?? "");
  const do_ = new Date(p.get("do") ?? "");
  if (!k || !e || !t || Number.isNaN(od.getTime()) || Number.isNaN(do_.getTime()) || do_ <= od) return null;
  return { k, e, t, od, do: do_ };
}

export function povolenUzivatel(email: string, povoleni: string[]): boolean {
  const e = email.trim().toLowerCase();
  return povoleni.some((p) => {
    const v = p.trim().toLowerCase();
    return v.startsWith("@") ? e.endsWith(v) : e === v;
  });
}

/** Ověření podpisu IAP (hlavička x-goog-iap-jwt-assertion) */
export function overovacIap(audience: string): (jwt: string) => Promise<string | null> {
  const client = new OAuth2Client();
  return async (jwt) => {
    try {
      const { pubkeys } = await client.getIapPublicKeys();
      const ticket = await client.verifySignedJwtWithCertsAsync(jwt, pubkeys, audience, ["https://cloud.google.com/iap"]);
      return ticket.getPayload()?.email ?? null;
    } catch {
      return null;
    }
  };
}

async function uzivatel(req: IncomingMessage, n: NastaveniWebu): Promise<string | null> {
  const hlavicka = req.headers["x-goog-authenticated-user-email"];
  let email = typeof hlavicka === "string" ? hlavicka.replace(/^accounts\.google\.com:/, "") : null;
  if (n.overIap) {
    const jwt = req.headers["x-goog-iap-jwt-assertion"];
    const overeny = typeof jwt === "string" ? await n.overIap(jwt) : null;
    if (!overeny) return null;
    email = overeny;
  }
  return email ?? n.devUser ?? null;
}

/** Vzhled zvolený přepínačem (cookie „tema“): light / dark; bez cookie podle systému */
const temaOdpovedi = new WeakMap<ServerResponse, "light" | "dark">();
/** Role přihlášeného uživatele – do lišty se doplní role a (správci) záložka Konfigurace */
const roleOdpovedi = new WeakMap<ServerResponse, Role>();
export function temaZCookie(cookie: string | undefined): "light" | "dark" | null {
  const v = (cookie ?? "").match(/(?:^|;\s*)tema=(light|dark)(?:;|$)/)?.[1];
  return v === "light" || v === "dark" ? v : null;
}

function posli(res: ServerResponse, kod: number, html: string) {
  const tema = temaOdpovedi.get(res);
  if (tema) html = html.replace('<html lang="cs">', `<html lang="cs" data-theme="${tema}">`);
  const role = roleOdpovedi.get(res);
  html = html
    .replace(/<!--konfigurace:(on|off)-->/, (_, on) => (role === "spravce" ? `<a href="/konfigurace" class="konfig${on === "on" ? " on" : ""}">⚙ Konfigurace</a>` : ""))
    .replace("<!--role-->", role ? ` · ${POPIS_ROLE[role]}` : "")
    .replace(/<!--doplnit:(on|off)-->/, (_, on) => (role === "technik" ? "" : `<a href="/technik" class="${on === "on" ? "on" : ""}">Doplnit technika</a>`));
  res.writeHead(kod, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    // mapa adresy: jen vložená Google mapa (iframe), jinak nic z cizích domén
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.google.com; form-action 'self'; frame-ancestors 'none'",
  });
  res.end(html);
}

export function vytvorHandler(db: Db, n: NastaveniWebu) {
  const ted = n.ted ?? (() => tedPraha());
  const geokoderWebu = async () => {
    try {
      return n.planovac ? (await n.planovac()).geokoder : null;
    } catch {
      return null;
    }
  };
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const tema = temaZCookie(req.headers.cookie);
    if (tema) temaOdpovedi.set(res, tema);
    try {
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      const postCesta = /^\/zakazka\/[^/]+\/zapis$/.test(url.pathname) || /^\/konfigurace\/[A-Za-z]+\/(nahled|ulozit)$/.test(url.pathname);
      if (req.method !== "GET" && !(req.method === "POST" && postCesta)) return posli(res, 405, strankaChyby(405, "Nepovolená operace."));

      const email = await uzivatel(req, n);
      // historie uživatelů: po odeslání odpovědi zapsat, co požadavek znamenal (chyba logu nevadí)
      if (email) {
        res.once("finish", () => {
          const a = akcePozadavku(req.method ?? "GET", url, res.statusCode);
          if (a) void zaznamenej(db, { email, ...a });
        });
      }
      if (!email) return posli(res, 401, strankaChyby(401, "Nepřihlášený uživatel – aplikace se otevírá přes přihlášení Google."));
      const role = await roleUzivatele(db, email, n.spravci ?? [], (e) => povolenUzivatel(e, n.povoleni));
      if (!role) return posli(res, 403, strankaChyby(403, `Účet ${email} nemá do aplikace přístup – požádejte správce o přidání do Konfigurace → Uživatelé.`));
      roleOdpovedi.set(res, role);
      // priority P1–P0 do odvolání vypnuté – zobrazí se jen při pouzivatPriority = 1 v Nastavení plánování
      nastavZobrazeniPriorit(nastaveniPlanovani(await nactiCiselnik(db, "nastaveniPlanovani")).pouzivatPriority);

      // přepínač světlý / tmavý / podle systému – uloží volbu do cookie a vrátí se na stránku, odkud přišel
      if (url.pathname === "/tema") {
        const t = url.searchParams.get("t");
        const cookie = t === "light" || t === "dark" ? `tema=${t}; Max-Age=31536000` : "tema=; Max-Age=0";
        let zpet = "/";
        try {
          const ref = new URL(String(req.headers.referer ?? ""));
          if (ref.host === (req.headers["x-forwarded-host"] ?? req.headers.host)) zpet = ref.pathname + ref.search + ref.hash;
        } catch {
          /* bez platného Refereru zpět na úvod */
        }
        res.writeHead(302, { location: zpet, "set-cookie": `${cookie}; Path=/; SameSite=Lax; Secure; HttpOnly` });
        res.end();
        return;
      }

      const now = ted();
      const stav = await nactiStavImportu(db, now);

      const presmeruj = (kam: string) => {
        res.writeHead(302, { location: kam });
        res.end();
      };
      const zapis = role === "cteni" || role === "technik" ? { zapnuty: false, technici: [] as string[] } : (n.zapis ?? { zapnuty: false, technici: [] });
      // technik: jen prohlížení zakázky – plánování, zápis a Doplnit technika nejsou dostupné
      const jenNahled = role === "technik";
      if (jenNahled && (url.pathname === "/technik" || /^\/zakazka\/[^/]+\/zapis$/.test(url.pathname))) {
        return posli(res, 403, strankaChyby(403, "Role technik může zakázky jen prohlížet – plánování není dostupné."));
      }
      const smiTechnik = (t: string) => smiZapisovat(t, zapis.technici);

      // ---------- Plánovat zakázku: hledání → zakázka ----------
      if (url.pathname === "/") {
        const q = ocistitDotaz(url.searchParams.get("q") ?? "");
        if (!q) return posli(res, 200, strankaUvod(stav, email));
        const presne = await najdiAktivitu(db, q);
        if (presne.length === 1) return presmeruj(`/zakazka/${encodeURIComponent(presne[0]!)}`);
        // telefon, jméno, adresa: otevřené zakázky (bez ohledu na diakritiku) + všechny zakázky v DB (i uzavřené)
        const volne = presne.length || q.length < 3 ? [] : (await nactiFrontu(db, now, { hledat: q })).polozky.slice(0, 30).map((p) => p.z.idAktivity);
        const ids = presne.length ? presne : [...new Set([...volne, ...(await hledejZakazky(db, q))])].slice(0, 30);
        if (!presne.length && ids.length === 1) return presmeruj(`/zakazka/${encodeURIComponent(ids[0]!)}`);
        const polozky = (await Promise.all(ids.map((id) => nactiDetail(db, id, now)))).flatMap((d) => (d ? [{ z: d.z, priorita: d.priorita, uzavreno: d.uzavreno }] : []));
        const zdroje = n.zdroje && q.length >= 5 ? await hledejVsude(n.zdroje(), [q], now) : null;
        const casti = await mestskeCasti(await geokoderWebu(), polozky.map((p) => [p.z.adresa, p.z.psc.replace(/^=+/, "")].filter(Boolean).join(", ")));
        return posli(res, 200, strankaVysledku(q, polozky, zdroje, stav, email, casti));
      }
      if (url.pathname === "/hledat") return presmeruj(`/?q=${encodeURIComponent(url.searchParams.get("q") ?? "")}`);
      if (url.pathname === "/planovani" || url.pathname === "/planovani/slot") return presmeruj(`/technik?${url.searchParams}`);
      const mt = url.pathname.match(/^\/zakazka\/([^/]+)\/terminy$/);
      if (mt) return presmeruj(`/zakazka/${mt[1]}#planovani`);

      const mp = url.pathname.match(/^\/zakazka\/([^/]+)\/(zapis)$/);
      if (mp) {
        const detail = await nactiDetail(db, decodeURIComponent(mp[1]!), now);
        if (!detail) return posli(res, 404, strankaChyby(404, "Zakázka nenalezena."));
        const kontext = await nactiKontext(db);

        // zapis: GET = formulář, POST = zápis do kalendáře
        const formular = req.method === "POST" ? await ctiFormular(req) : url.searchParams;
        const vyb0 = vybranySlot(formular);
        const presun = presunZParametru(formular);
        // pp = doplnit / přeplánovat bez původní události v kalendáři (např. webcalendar: termín je jen v MWF)
        const pp = formular.get("pp") === "1";
        const vyb = vyb0 && { ...vyb0, presun, pp };
        const technik = vyb && kontext.technici.find((t) => t.jmeno === vyb.t && t.kalendar === vyb.k);
        const puvodni = presun && kontext.technici.find((t) => t.jmeno === presun.pt && t.kalendar === presun.pk);
        if (!vyb || !technik || (presun && (!puvodni || !detail.z.termin))) return posli(res, 400, strankaChyby(400, "Neplatný výběr slotu – vyberte termín znovu z nabídky."));
        const brany = kontrolaBran(detail.z, faktaZakazky(detail.z, now), kontext.blokovane, { presun: !!presun, doplnit: pp && !presun });
        const povolen = role !== "cteni" && role !== "technik" && zapis.zapnuty && smiTechnik(technik.jmeno) && (!puvodni || smiTechnik(puvodni.jmeno)) && !brany.blokace.length;
        // nestandardní úprava: vlastní název / čas události (výrazně označeno, zapíše se do GCAL tak, jak je)
        const nestd = nestandardZFormulare(formular, vyb.od, vyb.do);
        const casOd = nestd?.od ?? vyb.od;
        const casDo = nestd?.do ?? vyb.do;
        // náhled události (nadpis a místo tak, jak budou v kalendáři) – formulář vypadá jako událost v Google Kalendáři
        const nahled = (() => {
          const u = sestavUdalost(detail.z, technik.nazevVKalendari, casOd, casDo, udajeZFormulare(formular), slaKonec(detail.z, stav.posledniExport ?? now), inicialy(kontext.koordinatorky, email));
          return { summary: nestd?.nadpis ?? u.summary, location: u.location ?? "" };
        })();
        // pravý sloupec: den technika v kalendáři (s vyznačeným slotem) a zakázky naplánované ten den v okolí
        const okoli = await okoliZapisu(n, kontext.technici, technik.jmeno, vyb, detail.z);
        if (req.method === "GET") return posli(res, 200, strankaZapisu(detail, vyb, brany, povolen, stav, email, [], url.searchParams, nahled, okoli));

        if (!zVlastniStranky(req)) return posli(res, 403, strankaChyby(403, "Formulář nepřišel ze stránky aplikace."));
        if (!povolen) return posli(res, 403, strankaChyby(403, brany.blokace[0] ?? "Zápis do kalendáře tohoto technika není povolený."));
        const chybi = chybejiciPotvrzeni(formular);
        if (chybi.length) return posli(res, 422, strankaZapisu(detail, vyb, brany, povolen, stav, email, chybi.map((c) => `Chybí potvrzení: ${c}`), formular, nahled, okoli));
        if (!n.planovac) return posli(res, 503, strankaChyby(503, "Kalendář není dostupný."));

        const sla = slaKonec(detail.z, stav.posledniExport ?? now);
        const udalost = sestavUdalost(detail.z, technik.nazevVKalendari, casOd, casDo, udajeZFormulare(formular), sla, inicialy(kontext.koordinatorky, email));
        if (nestd?.nadpis) udalost.summary = nestd.nadpis;
        const { api } = await n.planovac();
        try {
          // přesun: nejdřív ověřit, že původní událost opravdu patří zakázce (nic se zatím nezměnilo)
          if (presun && !udalostZakazky((await api.events.get({ calendarId: presun.pk, eventId: presun.pe })).data, detail.z)) {
            throw new SlotObsazen("Původní termín zakázky v kalendáři nenalezen (mezitím změněn?). Načtěte návrhy znovu.");
          }
          const r = await obsadVolnySlot(api, technik.kalendar, vyb.e, udalost, vyb.od);
          zapomenKalendar(api, technik.kalendar);
          await ulozUdalost(db, detail.z.idAktivity, technik.kalendar, r.eventId, casOd, casDo);
          let vysledekPresunu: { ok: boolean; zprava: string } | null = null;
          if (presun && puvodni) {
            try {
              await vratitNaVolny(api, presun.pk, presun.pe, puvodni.nazevVKalendari, detail.z);
              zapomenKalendar(api, presun.pk);
              await smazUdalost(db, presun.pk, presun.pe);
              vysledekPresunu = { ok: true, zprava: `Původní termín (${puvodni.jmeno}) vrácen v kalendáři na VOLNY.` };
            } catch (e) {
              vysledekPresunu = { ok: false, zprava: `Původní termín (${puvodni.jmeno}) se nepodařilo vrátit na VOLNY – upravte ho v kalendáři ručně: ${e instanceof Error ? e.message : String(e)}` };
            }
          }
          console.log(JSON.stringify({ severity: "INFO", message: `Termín zapsán: ${detail.z.idObjednavky} → ${technik.jmeno} ${casOd.toISOString()}${presun ? " (přesun flex)" : ""}${nestd ? " (NESTANDARDNÍ ÚPRAVA)" : ""}`, uzivatel: email, objednavka: detail.z.idObjednavky, technik: technik.jmeno, eventId: r.eventId, presun, nestandard: nestd }));
          return posli(res, 200, strankaZapsano(detail, technik.jmeno, casOd, casDo, textProMwf(detail.z.zakaznik, casOd, casDo), r.htmlLink, stav, email, vysledekPresunu));
        } catch (e) {
          zapomenKalendar(api, technik.kalendar); // po konfliktu ukázat čerstvý stav kalendáře
          if (e instanceof SlotObsazen) return posli(res, 409, strankaZapisu(detail, vyb, brany, povolen, stav, email, [e.message], formular, nahled, okoli));
          throw e;
        }
      }

      // zakázka: nahoře detail se všemi podklady, dole kam naplánovat (zdroje a nabídka se počítají souběžně)
      const m = url.pathname.match(/^\/zakazka\/([^/]+)$/);
      if (m) {
        const detail = await nactiDetail(db, decodeURIComponent(m[1]!), now);
        if (!detail) return posli(res, 404, strankaChyby(404, "Zakázka nenalezena."));
        // PDF chybí, nebo bylo načteno starší verzí bez tabulky Priebeh → dohledat / přečíst znovu hned
        if ((!detail.notifikace || !detail.notifikace.priebeh) && n.notifikace) detail.notifikace = await n.notifikace(detail.z.idAktivity, { idObjednavkyZaklad: detail.z.idObjednavkyZaklad, idS7: detail.z.idS7 });
        const kontext = await nactiKontext(db);
        const planovac = n.planovac;
        // webcalendar: zakázka přišla s termínem jen v MWF → ověřit, zda je v kalendáři technika
        // přeplánovat: zakázka s termínem se smí naplánovat znovu (původní událost se vrátí na VOLNY)
        const wc = webcalendar(detail.z);
        const preplanovat = url.searchParams.get("preplanovat") === "1" && !!detail.z.termin;
        let puvodni: Awaited<ReturnType<typeof najdiTerminVKalendari>> = null;
        if (detail.z.termin && (wc || preplanovat) && planovac && !detail.uzavreno) {
          try {
            puvodni = await najdiTerminVKalendari((await planovac()).api, kontext.technici, detail.z);
          } catch {
            puvodni = null;
          }
        }
        const doplnit = !!detail.z.termin && !puvodni && (!!wc || preplanovat);
        const presunPlan = preplanovat && puvodni ? puvodni : null;
        const brany = kontrolaBran(detail.z, faktaZakazky(detail.z, now), kontext.blokovane, { presun: !!presunPlan, doplnit });
        const odP = url.searchParams.get("od") ?? "";
        const odData = /^\d{4}-\d{2}-\d{2}$/.test(odP) && !Number.isNaN(Date.parse(odP)) && odP > isoDate(now) ? odP : undefined;
        const spocitat = !brany.blokace.length && !detail.uzavreno && planovac && !jenNahled;
        const adresaZ = [detail.z.adresa, detail.z.psc.replace(/^=+/, "")].filter(Boolean).join(", ");
        const [zdroje, nabidka, lokalita] = await Promise.all([
          n.zdroje ? hledejVsude(n.zdroje(), vyrazyZakazky(detail.z), now) : Promise.resolve(null),
          spocitat
            ? (async (): Promise<Nabidka> => {
                try {
                  const sla = slaKonec(detail.z, stav.posledniExport ?? now);
                  return await nabidniProZakazku(detail.z, kontext.nastaveni.pouzivatPriority ? detail.priorita : "P3", sla, kontext.technici, await planovac(), now, {
                    adresyZMwf: kontext.adresyZMwf,
                    nastaveni: kontext.nastaveni.plan,
                    dni: kontext.nastaveni.dniNabidky,
                    trvaniMin: kontext.nastaveni.delkaPraceMin,
                    ...(odData ? { odData } : {}),
                    ...(doplnit && detail.z.termin ? { dohodnuty: detail.z.termin } : {}),
                  });
                } catch (e) {
                  console.log(JSON.stringify({ severity: "ERROR", message: `Nabídka termínů: ${e instanceof Error ? e.message : String(e)}`, objednavka: detail.z.idObjednavky }));
                  return { moznosti: [], nedostupne: [], bezZakladny: [], bezPolohy: 0, technikuCelkem: 0, chyba: `Nabídku se nepodařilo spočítat: ${e instanceof Error ? e.message : String(e)}` };
                }
              })()
            : Promise.resolve(null),
          // „Instalovali jsme v lokalitě“: události techniků na stejné adrese
          n.zdroje && detail.z.adresa
            ? (async (): Promise<Lokalita> => {
                try {
                  const nalezy = await sLimitem(12_000, (async () => hledejNaLokalite(await n.zdroje!().kalendar(), adresaZ, detail.z.idObjednavkyZaklad, now))());
                  return { nalezy };
                } catch (e) {
                  return { nalezy: [], chyba: e instanceof Error ? e.message : String(e) };
                }
              })()
            : Promise.resolve(null),
        ]);
        const casti = await mestskeCasti(await geokoderWebu(), [
          [detail.z.adresa, detail.z.psc.replace(/^=+/, "")].filter(Boolean).join(", "),
          ...(nabidka?.moznosti ?? []).flatMap((m) => [m.sousede?.pred.adresa, m.sousede?.po.adresa]),
        ]);
        return posli(res, 200, strankaZakazky(detail, stav, email, now, zdroje, { brany, nabidka, zapis: { zapnuty: zapis.zapnuty, smiTechnik }, nedostupne: !planovac, casti, lokalita, ...(odData ? { odData } : {}),
          webcal: wc ? { ...wc, vKalendari: puvodni } : null,
          preplanovat,
          doplnit,
          presun: presunPlan,
          jenNahled,
        }));
      }

      // ---------- Doplnit technika: jeho dny nahoře, vhodné zakázky do vybraného slotu dole ----------
      if (url.pathname === "/technik") {
        if (!n.planovac) return posli(res, 503, strankaChyby(503, "Kalendáře techniků nejsou dostupné."));
        const p = url.searchParams;
        const dnes = isoDate(now);
        const denP = p.get("den") ?? "";
        const den = /^\d{4}-\d{2}-\d{2}$/.test(denP) && !Number.isNaN(Date.parse(denP)) && denP >= dnes ? pracovniDny(denP, 1)[0]! : pracovniDny(dnes, 1)[0]!;
        const kontext = await nactiKontext(db);
        const zav = await n.planovac();
        const technik = kontext.technici.find((t) => t.jmeno === p.get("t")) ?? null;
        // posun: přehled po jednom pracovním dni, technik po týdnu (5 pracovních dní); ne do minulosti
        const zpetDny = (d: string, n: number) => {
          let x = d;
          for (let i = 0; i < n; ) {
            x = addDays(x, -1);
            if (isWorkday(x)) i++;
          }
          return x;
        };
        const krok = technik ? 5 : 1;
        const predchozi = den > dnes ? (zpetDny(den, krok) >= dnes ? zpetDny(den, krok) : pracovniDny(dnes, 1)[0]!) : null;
        const s: StrankaTechnika = {
          technici: [...kontext.technici].sort((a, b) => a.jmeno.localeCompare(b.jmeno, "cs")),
          technik,
          den,
          predchozi,
          dalsi: pracovniDny(den, krok + 1).at(-1)!,
          rychleDny: pracovniDny(dnes, 6),
          adresy: kontext.adresyZMwf,
          dny: [],
          prehled: null,
          slot: null,
          navrhy: null,
          zapis: { zapnuty: zapis.zapnuty, smiTechnik },
          tolerance: p.get("tol") === "1",
          tolerancePct: Math.round(kontext.nastaveni.tolerance * 100),
        };
        if (technik) {
          const rozsah = pracovniDny(den, 5);
          const kal = await nactiKalendare(zav.api, [technik], atTime(rozsah[0]!, 0), atTime(addDays(rozsah.at(-1)!, 1), 0));
          if (kal.nedostupne.length) s.chyba = `Kalendář technika ${technik.jmeno} nejde přečíst.`;
          s.dny = rozsah.map((d) => ({ datum: d, udalosti: kal.udalosti.filter((u) => isoDate(u.od) === d).sort((a, b) => a.od.getTime() - b.od.getTime()) }));
          const vyb = vybranySlot(p);
          if (vyb && vyb.t === technik.jmeno && vyb.k === technik.kalendar) {
            s.slot = { technik, eventId: vyb.e, od: vyb.od, do: vyb.do };
            const kandidati = await kandidatiKDoplneni(db, now, kontext.blokovane, stav.posledniExport ?? now, kontext.nastaveni.pouzivatPriority);
            s.navrhy = await navrhyProSlot(s.slot, kandidati, kontext.technici, zav, {
              adresyZMwf: kontext.adresyZMwf,
              // „Zvýšit toleranci“: pozdější příjezd na další zakázku o % délky slotu a o stejné % delší zajížďka
              nastaveni: s.tolerance
                ? {
                    ...kontext.nastaveni.doplneni,
                    tolerance: kontext.nastaveni.tolerance,
                    maxZajizdkaKm: Math.round((kontext.nastaveni.doplneni.maxZajizdkaKm ?? 75) * (1 + kontext.nastaveni.tolerance)),
                  }
                : kontext.nastaveni.doplneni,
              flexDni: kontext.nastaveni.flexDni,
            });
          }
        } else {
          s.prehled = await prehledDne(zav.api, kontext.technici, den);
        }
        const adresaUdalosti = (u: { summary: string; location: string }) => {
          const o = u.summary.match(/O-\d{6,}/)?.[0];
          return (o && kontext.adresyZMwf.get(o)) || u.location;
        };
        s.casti = await mestskeCasti(zav.geokoder, [
          ...s.dny.flatMap((d) => d.udalosti.map(adresaUdalosti)),
          ...(s.prehled?.dny ?? []).flatMap((d) => d.zakazky.map(adresaUdalosti)),
          ...(s.navrhy?.navrhy ?? []).map((x) => [x.kandidat.z.adresa, x.kandidat.z.psc.replace(/^=+/, "")].filter(Boolean).join(", ")),
        ]);
        return posli(res, 200, strankaTechnika(s, stav, email));
      }

      // ---------- Konfigurace (jen správce) ----------
      if (url.pathname === "/konfigurace" || url.pathname.startsWith("/konfigurace/")) {
        if (role !== "spravce") return posli(res, 403, strankaChyby(403, "Konfiguraci může měnit jen správce."));
        if (url.pathname === "/konfigurace") return posli(res, 200, strankaKonfigurace(await nactiPrehled(db), stav, email));
        if (url.pathname === "/konfigurace/notifikace") {
          const q = url.searchParams.get("q")?.trim() ?? "";
          return posli(res, 200, strankaNotifikaci(await prehledNotifikaci(db, q), q, stav, email));
        }
        if (url.pathname === "/konfigurace/log") {
          const dni = [1, 7, 30, 90, 180].includes(Number(url.searchParams.get("dni"))) ? Number(url.searchParams.get("dni")) : 7;
          const filtr = { email: url.searchParams.get("u")?.trim().toLowerCase() || undefined, akce: url.searchParams.get("a") || undefined, dni };
          return posli(res, 200, strankaLogu(await nactiLog(db, filtr), filtr, stav, email));
        }
        const mk = url.pathname.match(/^\/konfigurace\/([A-Za-z]+)(?:\/(csv|nahled|ulozit))?$/);
        const id = mk?.[1] as CiselnikId | undefined;
        if (!mk || !id || !(id in CISELNIKY)) return posli(res, 404, strankaChyby(404, "Číselník neexistuje."));
        const akce = mk[2];
        if (!akce) {
          const p = url.searchParams;
          const zprava = p.has("ulozeno") ? `Uloženo: přidáno ${p.get("pridano") ?? 0}, změněno ${p.get("zmeneno") ?? 0}, deaktivováno ${p.get("odebrano") ?? 0}.` : null;
          return posli(res, 200, strankaCiselniku(id, await nactiPolozky(db, id), await nactiHistorii(db, id), zprava, stav, email));
        }
        if (akce === "csv") {
          const polozky = await nactiCiselnik(db, id, false);
          const csv = exportCsv(id, polozky.length ? polozky : (VYCHOZI_POLOZKY[id] ?? []));
          res.writeHead(200, {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${id}.csv"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          });
          res.end(csv);
          return;
        }
        if (!zVlastniStranky(req)) return posli(res, 403, strankaChyby(403, "Formulář nepřišel ze stránky aplikace."));
        const ostatni = { regiony: await nactiCiselnik(db, "regiony"), typyAkci: await nactiCiselnik(db, "typyAkci") };
        const nahled = async (text: string) => nahledImportu(id, text, await nactiCiselnik(db, id, false), Object.fromEntries(Object.entries(ostatni).filter(([, v]) => v.length)));
        try {
          if (akce === "nahled") {
            const ct = String(req.headers["content-type"] ?? "");
            let obsah: Buffer | undefined;
            let soubor = "CSV";
            let nahradit = false;
            if (ct.startsWith("multipart/form-data")) {
              const pole = rozlozMultipart(await ctiTelo(req, 2 * 1024 * 1024), ct);
              obsah = pole.get("soubor")?.obsah;
              soubor = pole.get("soubor")?.soubor || soubor;
              nahradit = pole.get("nahradit")?.obsah.toString("utf8") === "ano";
            } else {
              const f = await ctiFormular(req, 2 * 1024 * 1024);
              obsah = f.get("csv") !== null ? Buffer.from(f.get("csv")!, "utf8") : undefined;
              nahradit = f.get("nahradit") === "ano";
            }
            if (!obsah?.length) return posli(res, 400, strankaChyby(400, "Vyberte soubor CSV."));
            const text = decodeExport(obsah);
            return posli(res, 200, strankaNahledu(id, await nahled(text), Buffer.from(text, "utf8").toString("base64"), soubor, nahradit, stav, email));
          }
          // ulozit: náhled se spočítá znovu nad aktuálním stavem (mezitím mohl někdo číselník změnit)
          const f = await ctiFormular(req, 4 * 1024 * 1024);
          const text = Buffer.from(f.get("csv") ?? "", "base64").toString("utf8");
          const n2 = await nahled(text);
          if (!n2.lzeUlozit) return posli(res, 422, strankaNahledu(id, n2, f.get("csv") ?? "", f.get("soubor") ?? "CSV", f.get("nahradit") === "ano", stav, email));
          const r = await ulozImport(db, id, n2, `web: ${(f.get("soubor") ?? "CSV").slice(0, 80)}`, email, f.get("nahradit") === "ano");
          console.log(JSON.stringify({ severity: "INFO", message: `Konfigurace: ${CISELNIKY[id].nazev} uložen`, uzivatel: email, ...r }));
          res.writeHead(303, { location: `/konfigurace/${id}?ulozeno=1&pridano=${r.pridano}&zmeneno=${r.zmeneno}&odebrano=${r.odebrano}` });
          res.end();
          return;
        } catch (e) {
          if (e instanceof PrilisVelke) return posli(res, 413, strankaChyby(413, "Soubor je příliš velký (max. 2 MB)."));
          throw e;
        }
      }

      return posli(res, 404, strankaChyby(404, "Stránka neexistuje."));
    } catch (e) {
      console.log(JSON.stringify({ severity: "ERROR", message: `Web: ${e instanceof Error ? e.message : String(e)}`, cesta: url.pathname, stack: e instanceof Error ? e.stack : undefined }));
      posli(res, 500, strankaChyby(500, "Chyba aplikace – zkuste to znovu, případně dejte vědět správci."));
    }
  };
}

const OKOLI_DNI = 5;
const OKOLI_KM = 30;

/**
 * Pravý sloupec stránky zápisu: události technika v den termínu (s vyznačeným slotem)
 * a zakázky naplánované ±5 dní kolem termínu do 30 km od adresy zakázky (všichni technici).
 */
async function okoliZapisu(n: NastaveniWebu, technici: TechnikPlanu[], jmeno: string, vyb: { e: string; od: Date }, z: Zakazka): Promise<OkoliZapisu | null> {
  if (!n.planovac) return null;
  try {
    const zav = await n.planovac();
    const den = isoDate(vyb.od);
    // kalendáře všech techniků ±5 dní kolem termínu (cache 30 s)
    const kal = await nactiKalendare(zav.api, technici, atTime(addDays(den, -OKOLI_DNI), 0), atTime(addDays(den, OKOLI_DNI + 1), 0));
    const denTechnika = kal.udalosti.filter((u) => u.technik === jmeno && isoDate(u.od) === den).sort((a, b) => a.od.getTime() - b.od.getTime());
    const cizi = kal.udalosti.filter((u) => u.id !== vyb.e && !jeVolneOkno(u) && !jeBlok(u) && u.location);
    const adresa = [z.adresa, z.psc.replace(/^=+/, "")].filter(Boolean).join(", ");
    const body = await geokodujVse(zav.geokoder, [adresa, ...cizi.map((u) => u.location)]);
    const stred = body.get(adresa);
    const okoli = stred
      ? cizi
          .flatMap((u) => {
            const b = body.get(u.location);
            return b ? [{ u, km: Math.round(zav.vzdalenosti.km(stred, b) * 10) / 10 }] : [];
          })
          .filter((x) => x.km <= OKOLI_KM)
          .sort((a, b) => a.km - b.km || a.u.od.getTime() - b.u.od.getTime())
          .slice(0, 15)
      : [];
    return { den, denTechnika, slotId: vyb.e, okoli, bezAdresy: !stred, adresaZakazky: adresa };
  } catch (e) {
    console.log(JSON.stringify({ severity: "WARNING", message: `Okolí zápisu se nepodařilo načíst: ${e instanceof Error ? e.message : String(e)}` }));
    return null;
  }
}

function main() {
  const env = process.env;
  if (!env.DATABASE_URL) throw new Error("Chybí proměnná DATABASE_URL.");
  const db = pgDb(env.DATABASE_URL);
  const handler = vytvorHandler(db, {
    povoleni: (env.POVOLENI_UZIVATELE ?? "@ictmount.com").split(",").map((s) => s.trim()).filter(Boolean),
    spravci: (env.SPRAVCI ?? "davidh@ictmount.com").split(",").map((s) => s.trim()).filter(Boolean),
    overIap: env.IAP_AUDIENCE ? overovacIap(env.IAP_AUDIENCE) : undefined,
    devUser: env.DEV_USER,
    notifikace: env.NOTIFIKACE_SLOZKA
      ? (() => {
          const drive = driveApi({ version: "v3", auth: new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/drive.readonly"] }) });
          return (idAktivity, klice) => dohledejNotifikaci(db, drive, env.NOTIFIKACE_SLOZKA!, idAktivity, klice);
        })()
      : undefined,
    planovac: (() => {
      // Kalendáře techniků jménem tmcz01 (delegace) – odpadá sdílení každého kalendáře servisnímu účtu.
      // Bez delegace čte a zapisuje servisní účet sám (kalendáře mu musí být nasdílené).
      const geokoder = sCache(db, googleGeokoder());
      const vzdalenosti = odhadVzdalenosti();
      if (env.DELEGACE_UZIVATEL && env.SERVISNI_UCET) {
        const d = delegace(env.SERVISNI_UCET, env.DELEGACE_UZIVATEL, SCOPY_KALENDAR);
        // jeden API objekt na běh (klient delegace jen obnovuje token) – drží cache kalendářů
        let api: ReturnType<typeof calendarApi> | null = null;
        return async () => {
          const klient = await d.klient();
          api ??= calendarApi({ version: "v3", auth: klient as never });
          return { api, geokoder, vzdalenosti };
        };
      }
      const zav: ZavislostiPlanovace = { api: kalendarApi(), geokoder, vzdalenosti };
      return () => zav;
    })(),
    zdroje:
      env.DELEGACE_UZIVATEL && env.SERVISNI_UCET
        ? (() => {
            const d = delegace(env.SERVISNI_UCET!, env.DELEGACE_UZIVATEL!);
            const prostory = (env.CHAT_PROSTORY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            return () => ({
              gmail: async () => gmailApi({ version: "v1", auth: (await d.klient()) as never }),
              kalendar: async () => calendarApi({ version: "v3", auth: (await d.klient()) as never }),
              chatToken: async () => (await (await d.klient()).getAccessToken()).token ?? "",
              prostory,
            });
          })()
        : undefined,
    zapis: {
      zapnuty: env.ZAPIS_KALENDARE === "ano",
      technici: env.ZAPIS_TECHNICI === "vsichni" ? "vsichni" : (env.ZAPIS_TECHNICI ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    },
  });
  const port = Number(env.PORT ?? 8080);
  createServer((req, res) => void handler(req, res)).listen(port, () => {
    console.log(JSON.stringify({ severity: "INFO", message: `AppKoo web běží na portu ${port}` }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
