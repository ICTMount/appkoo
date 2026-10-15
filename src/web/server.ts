// Webové rozhraní AppKoo (Cloud Run služba za Identity-Aware Proxy).
// Jen čtení: fronta k volání a detail zakázky. Bez externích knihoven – node:http.
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

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { OAuth2Client } from "google-auth-library";
import type { Dotaz } from "../db/db.js";
import { pgDb } from "../db/db.js";
import { tedPraha } from "../domain/time.js";
import { PRIORITY, type Priorita } from "../domain/priorita.js";
import { najdiAktivitu, nactiDetail, nactiFrontu, nactiStavImportu, type Filtr } from "./data.js";
import { strankaChyby, strankaDetailu, strankaFronty, strankaVysledkuHledani } from "./html.js";

export interface NastaveniWebu {
  povoleni: string[];
  /** ověří podpis IAP; vrátí e-mail nebo null */
  overIap?: (jwt: string) => Promise<string | null>;
  devUser?: string;
  ted?: () => Date;
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

function posli(res: ServerResponse, kod: number, html: string) {
  res.writeHead(kod, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  });
  res.end(html);
}

export function vytvorHandler(db: Dotaz, n: NastaveniWebu) {
  const ted = n.ted ?? (() => tedPraha());
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      if (req.method !== "GET") return posli(res, 405, strankaChyby(405, "Aplikace je zatím jen ke čtení."));

      const email = await uzivatel(req, n);
      if (!email) return posli(res, 401, strankaChyby(401, "Nepřihlášený uživatel – aplikace se otevírá přes přihlášení Google."));
      if (!povolenUzivatel(email, n.povoleni)) return posli(res, 403, strankaChyby(403, `Účet ${email} nemá do aplikace přístup.`));

      const now = ted();
      const stav = await nactiStavImportu(db, now);

      if (url.pathname === "/") {
        const p = url.searchParams;
        const priorita = p.get("priorita");
        const filtr: Filtr = {
          zdroj: p.get("zdroj") || undefined,
          subregion: p.get("subregion") || undefined,
          hledat: p.get("hledat") || undefined,
          priorita: PRIORITY.includes(priorita as Priorita) ? (priorita as Priorita) : undefined,
        };
        return posli(res, 200, strankaFronty(await nactiFrontu(db, now, filtr), filtr, stav, email, now));
      }

      const m = url.pathname.match(/^\/zakazka\/([^/]+)$/);
      if (m) {
        const detail = await nactiDetail(db, decodeURIComponent(m[1]!), now);
        if (!detail) return posli(res, 404, strankaChyby(404, "Zakázka nenalezena."));
        return posli(res, 200, strankaDetailu(detail, stav, email, now));
      }

      if (url.pathname === "/hledat") {
        const q = url.searchParams.get("q") ?? "";
        const nalezene = await najdiAktivitu(db, q);
        if (nalezene.length === 1) {
          res.writeHead(302, { location: `/zakazka/${encodeURIComponent(nalezene[0]!)}` });
          res.end();
          return;
        }
        return posli(res, 200, strankaVysledkuHledani(q, nalezene.map((id) => ({ id })), stav, email));
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
  const handler = vytvorHandler(pgDb(env.DATABASE_URL), {
    povoleni: (env.POVOLENI_UZIVATELE ?? "@ictmount.com").split(",").map((s) => s.trim()).filter(Boolean),
    overIap: env.IAP_AUDIENCE ? overovacIap(env.IAP_AUDIENCE) : undefined,
    devUser: env.DEV_USER,
  });
  const port = Number(env.PORT ?? 8080);
  createServer((req, res) => void handler(req, res)).listen(port, () => {
    console.log(JSON.stringify({ severity: "INFO", message: `AppKoo web běží na portu ${port}` }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
