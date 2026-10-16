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
//   POVOLENI_UZIVATELE   e-maily nebo domény (@ictmount.com), čárkami; výchozí @ictmount.com
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
import type { Dotaz } from "../db/db.js";
import { pgDb } from "../db/db.js";
import { tedPraha } from "../domain/time.js";
import { faktaZakazky } from "../domain/priorita.js";
import { kalendarApi, obsadVolnySlot, SlotObsazen, udalostZakazky, vratitNaVolny } from "../gcal/kalendar.js";
import { sestavUdalost } from "../gcal/udalost.js";
import { odhadVzdalenosti } from "../plan/geo.js";
import { googleGeokoder, sCache } from "../plan/geokod.js";
import { slaKonec } from "../plan/kpi.js";
import { kontrolaBran, nabidniProZakazku, nactiKalendare, navrhyProSlot, pracovniDny, prehledDne, textProMwf, type Nabidka, type ZavislostiPlanovace } from "../plan/planovac.js";
import { addDays, atTime, isoDate } from "../domain/time.js";
import { calendar as calendarApi } from "@googleapis/calendar";
import { gmail as gmailApi } from "@googleapis/gmail";
import { delegace, SCOPY_KALENDAR } from "../google/delegace.js";
import { hledejVsude, ocistitDotaz, vyrazyZakazky, type ZavislostiZdroju } from "../zdroje/hledani.js";
import { najdiAktivitu, nactiDetail, nactiFrontu, nactiStavImportu } from "./data.js";
import { strankaChyby, strankaTechnika, strankaUvod, strankaVysledku, strankaZakazky, strankaZapisu, strankaZapsano, type StrankaTechnika } from "./html.js";
import { chybejiciPotvrzeni, inicialy, kandidatiKDoplneni, nactiKontext, presunZParametru, smazUdalost, smiZapisovat, udajeZFormulare, ulozUdalost } from "./planovani.js";

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

async function ctiFormular(req: IncomingMessage, max = 64 * 1024): Promise<URLSearchParams> {
  const casti: Buffer[] = [];
  let delka = 0;
  for await (const c of req) {
    delka += (c as Buffer).length;
    if (delka > max) throw new Error("Formulář je příliš velký.");
    casti.push(c as Buffer);
  }
  return new URLSearchParams(Buffer.concat(casti).toString("utf8"));
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
export function temaZCookie(cookie: string | undefined): "light" | "dark" | null {
  const v = (cookie ?? "").match(/(?:^|;\s*)tema=(light|dark)(?:;|$)/)?.[1];
  return v === "light" || v === "dark" ? v : null;
}

function posli(res: ServerResponse, kod: number, html: string) {
  const tema = temaOdpovedi.get(res);
  if (tema) html = html.replace('<html lang="cs">', `<html lang="cs" data-theme="${tema}">`);
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

export function vytvorHandler(db: Dotaz, n: NastaveniWebu) {
  const ted = n.ted ?? (() => tedPraha());
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
      const zapisCesta = /^\/zakazka\/[^/]+\/zapis$/.test(url.pathname);
      if (req.method !== "GET" && !(req.method === "POST" && zapisCesta)) return posli(res, 405, strankaChyby(405, "Nepovolená operace."));

      const email = await uzivatel(req, n);
      if (!email) return posli(res, 401, strankaChyby(401, "Nepřihlášený uživatel – aplikace se otevírá přes přihlášení Google."));
      if (!povolenUzivatel(email, n.povoleni)) return posli(res, 403, strankaChyby(403, `Účet ${email} nemá do aplikace přístup.`));

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
      const zapis = n.zapis ?? { zapnuty: false, technici: [] };
      const smiTechnik = (t: string) => smiZapisovat(t, zapis.technici);

      // ---------- Plánovat zakázku: hledání → zakázka ----------
      if (url.pathname === "/") {
        const q = ocistitDotaz(url.searchParams.get("q") ?? "");
        if (!q) return posli(res, 200, strankaUvod(stav, email));
        const presne = await najdiAktivitu(db, q);
        if (presne.length === 1) return presmeruj(`/zakazka/${encodeURIComponent(presne[0]!)}`);
        // telefon, jméno, adresa – v otevřených zakázkách
        const volne = presne.length || q.length < 3 ? [] : (await nactiFrontu(db, now, { hledat: q })).polozky.slice(0, 30);
        if (!presne.length && volne.length === 1) return presmeruj(`/zakazka/${encodeURIComponent(volne[0]!.z.idAktivity)}`);
        const polozky = presne.length
          ? (await Promise.all(presne.map((id) => nactiDetail(db, id, now)))).flatMap((d) => (d ? [{ z: d.z, priorita: d.priorita }] : []))
          : volne.map((p) => ({ z: p.z, priorita: p.priorita }));
        const zdroje = n.zdroje && q.length >= 5 ? await hledejVsude(n.zdroje(), [q], now) : null;
        return posli(res, 200, strankaVysledku(q, polozky, zdroje, stav, email));
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
        const vyb = vyb0 && { ...vyb0, presun };
        const technik = vyb && kontext.technici.find((t) => t.jmeno === vyb.t && t.kalendar === vyb.k);
        const puvodni = presun && kontext.technici.find((t) => t.jmeno === presun.pt && t.kalendar === presun.pk);
        if (!vyb || !technik || (presun && (!puvodni || !detail.z.termin))) return posli(res, 400, strankaChyby(400, "Neplatný výběr slotu – vyberte termín znovu z nabídky."));
        const brany = kontrolaBran(detail.z, faktaZakazky(detail.z, now), kontext.blokovane, { presun: !!presun });
        const povolen = zapis.zapnuty && smiTechnik(technik.jmeno) && (!puvodni || smiTechnik(puvodni.jmeno)) && !brany.blokace.length;
        if (req.method === "GET") return posli(res, 200, strankaZapisu(detail, vyb, brany, povolen, stav, email));

        if (!zVlastniStranky(req)) return posli(res, 403, strankaChyby(403, "Formulář nepřišel ze stránky aplikace."));
        if (!povolen) return posli(res, 403, strankaChyby(403, brany.blokace[0] ?? "Zápis do kalendáře tohoto technika není povolený."));
        const chybi = chybejiciPotvrzeni(formular);
        if (chybi.length) return posli(res, 422, strankaZapisu(detail, vyb, brany, povolen, stav, email, chybi.map((c) => `Chybí potvrzení: ${c}`), formular));
        if (!n.planovac) return posli(res, 503, strankaChyby(503, "Kalendář není dostupný."));

        const sla = slaKonec(detail.z, stav.posledniExport ?? now);
        const udalost = sestavUdalost(detail.z, technik.nazevVKalendari, vyb.od, vyb.do, udajeZFormulare(formular), sla, inicialy(kontext.koordinatorky, email));
        const { api } = await n.planovac();
        try {
          // přesun: nejdřív ověřit, že původní událost opravdu patří zakázce (nic se zatím nezměnilo)
          if (presun && !udalostZakazky((await api.events.get({ calendarId: presun.pk, eventId: presun.pe })).data, detail.z)) {
            throw new SlotObsazen("Původní termín zakázky v kalendáři nenalezen (mezitím změněn?). Načtěte návrhy znovu.");
          }
          const r = await obsadVolnySlot(api, technik.kalendar, vyb.e, udalost, vyb.od);
          await ulozUdalost(db, detail.z.idAktivity, technik.kalendar, r.eventId, vyb.od, vyb.do);
          let vysledekPresunu: { ok: boolean; zprava: string } | null = null;
          if (presun && puvodni) {
            try {
              await vratitNaVolny(api, presun.pk, presun.pe, puvodni.nazevVKalendari, detail.z);
              await smazUdalost(db, presun.pk, presun.pe);
              vysledekPresunu = { ok: true, zprava: `Původní termín (${puvodni.jmeno}) vrácen v kalendáři na VOLNY.` };
            } catch (e) {
              vysledekPresunu = { ok: false, zprava: `Původní termín (${puvodni.jmeno}) se nepodařilo vrátit na VOLNY – upravte ho v kalendáři ručně: ${e instanceof Error ? e.message : String(e)}` };
            }
          }
          console.log(JSON.stringify({ severity: "INFO", message: `Termín zapsán: ${detail.z.idObjednavky} → ${technik.jmeno} ${vyb.od.toISOString()}${presun ? " (přesun flex)" : ""}`, uzivatel: email, objednavka: detail.z.idObjednavky, technik: technik.jmeno, eventId: r.eventId, presun }));
          return posli(res, 200, strankaZapsano(detail, technik.jmeno, vyb.od, vyb.do, textProMwf(detail.z.zakaznik, vyb.od, vyb.do), r.htmlLink, stav, email, vysledekPresunu));
        } catch (e) {
          if (e instanceof SlotObsazen) return posli(res, 409, strankaZapisu(detail, vyb, brany, povolen, stav, email, [e.message], formular));
          throw e;
        }
      }

      // zakázka: nahoře detail se všemi podklady, dole kam naplánovat (zdroje a nabídka se počítají souběžně)
      const m = url.pathname.match(/^\/zakazka\/([^/]+)$/);
      if (m) {
        const detail = await nactiDetail(db, decodeURIComponent(m[1]!), now);
        if (!detail) return posli(res, 404, strankaChyby(404, "Zakázka nenalezena."));
        const kontext = await nactiKontext(db);
        const brany = kontrolaBran(detail.z, faktaZakazky(detail.z, now), kontext.blokovane);
        const planovac = n.planovac;
        const spocitat = !brany.blokace.length && !detail.uzavreno && planovac;
        const [zdroje, nabidka] = await Promise.all([
          n.zdroje ? hledejVsude(n.zdroje(), vyrazyZakazky(detail.z), now) : Promise.resolve(null),
          spocitat
            ? (async (): Promise<Nabidka> => {
                try {
                  const sla = slaKonec(detail.z, stav.posledniExport ?? now);
                  return await nabidniProZakazku(detail.z, detail.priorita, sla, kontext.technici, await planovac(), now, { adresyZMwf: kontext.adresyZMwf });
                } catch (e) {
                  console.log(JSON.stringify({ severity: "ERROR", message: `Nabídka termínů: ${e instanceof Error ? e.message : String(e)}`, objednavka: detail.z.idObjednavky }));
                  return { moznosti: [], nedostupne: [], bezZakladny: [], bezPolohy: 0, technikuCelkem: 0, chyba: `Nabídku se nepodařilo spočítat: ${e instanceof Error ? e.message : String(e)}` };
                }
              })()
            : Promise.resolve(null),
        ]);
        return posli(res, 200, strankaZakazky(detail, stav, email, now, zdroje, { brany, nabidka, zapis: { zapnuty: zapis.zapnuty, smiTechnik }, nedostupne: !planovac }));
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
        const predchozi = den > dnes ? (addDays(den, -7) > dnes ? addDays(den, -7) : dnes) : null;
        const s: StrankaTechnika = {
          technici: [...kontext.technici].sort((a, b) => a.jmeno.localeCompare(b.jmeno, "cs")),
          technik,
          den,
          predchozi,
          dalsi: addDays(den, 7),
          dny: [],
          prehled: null,
          slot: null,
          navrhy: null,
          zapis: { zapnuty: zapis.zapnuty, smiTechnik },
        };
        if (technik) {
          const rozsah = pracovniDny(den, 5);
          const kal = await nactiKalendare(zav.api, [technik], atTime(rozsah[0]!, 0), atTime(addDays(rozsah.at(-1)!, 1), 0));
          if (kal.nedostupne.length) s.chyba = `Kalendář technika ${technik.jmeno} nejde přečíst.`;
          s.dny = rozsah.map((d) => ({ datum: d, udalosti: kal.udalosti.filter((u) => isoDate(u.od) === d).sort((a, b) => a.od.getTime() - b.od.getTime()) }));
          const vyb = vybranySlot(p);
          if (vyb && vyb.t === technik.jmeno && vyb.k === technik.kalendar) {
            s.slot = { technik, eventId: vyb.e, od: vyb.od, do: vyb.do };
            const kandidati = await kandidatiKDoplneni(db, now, kontext.blokovane, stav.posledniExport ?? now);
            s.navrhy = await navrhyProSlot(s.slot, kandidati, kontext.technici, zav, { adresyZMwf: kontext.adresyZMwf });
          }
        } else {
          s.prehled = await prehledDne(zav.api, kontext.technici, den);
        }
        return posli(res, 200, strankaTechnika(s, stav, email));
      }

      return posli(res, 404, strankaChyby(404, "Stránka neexistuje."));
    } catch (e) {
      console.log(JSON.stringify({ severity: "ERROR", message: `Web: ${e instanceof Error ? e.message : String(e)}`, cesta: url.pathname, stack: e instanceof Error ? e.stack : undefined }));
      posli(res, 500, strankaChyby(500, "Chyba aplikace – zkuste to znovu, případně dejte vědět správci."));
    }
  };
}

function main() {
  const env = process.env;
  if (!env.DATABASE_URL) throw new Error("Chybí proměnná DATABASE_URL.");
  const db = pgDb(env.DATABASE_URL);
  const handler = vytvorHandler(db, {
    povoleni: (env.POVOLENI_UZIVATELE ?? "@ictmount.com").split(",").map((s) => s.trim()).filter(Boolean),
    overIap: env.IAP_AUDIENCE ? overovacIap(env.IAP_AUDIENCE) : undefined,
    devUser: env.DEV_USER,
    planovac: (() => {
      // Kalendáře techniků jménem tmcz01 (delegace) – odpadá sdílení každého kalendáře servisnímu účtu.
      // Bez delegace čte a zapisuje servisní účet sám (kalendáře mu musí být nasdílené).
      const geokoder = sCache(db, googleGeokoder());
      const vzdalenosti = odhadVzdalenosti();
      if (env.DELEGACE_UZIVATEL && env.SERVISNI_UCET) {
        const d = delegace(env.SERVISNI_UCET, env.DELEGACE_UZIVATEL, SCOPY_KALENDAR);
        return async () => ({ api: calendarApi({ version: "v3", auth: (await d.klient()) as never }), geokoder, vzdalenosti });
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
