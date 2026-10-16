// Přístup ke Google Workspace jménem uživatele (delegace v rámci domény) bez souboru s klíčem.
//
// Cloud Run nemá privátní klíč servisního účtu. Token se proto získá takto:
//   1. aplikace (servisní účet appkoo-runner) nechá IAM Credentials API podepsat JWT
//      s „sub“ = uživatel Workspace (tmcz01@ictmount.com) a požadovanými scopy,
//   2. podepsaný JWT vymění na oauth2.googleapis.com za přístupový token uživatele.
//
// Předpoklady (jednorázově):
//   - správce Workspace povolí Client ID servisního účtu a scopy v „Přenesení pravomocí v rámci domény“,
//   - servisní účet má roli „Service Account Token Creator“ sám na sobě (smí podepisovat své JWT),
//   - v projektu je zapnuté iamcredentials.googleapis.com.

import { GoogleAuth, OAuth2Client } from "google-auth-library";

export const SCOPY_CTENI = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
];

export interface Delegace {
  /** OAuth klient s platným tokenem uživatele (obnoví se 5 min před vypršením) */
  klient(): Promise<OAuth2Client>;
}

type Fetch = typeof fetch;

export function delegace(
  servisniUcet: string,
  uzivatel: string,
  scopy: string[] = SCOPY_CTENI,
  deps: { fetchFn?: Fetch; adcToken?: () => Promise<string>; ted?: () => number } = {},
): Delegace {
  const fetchFn = deps.fetchFn ?? fetch;
  const ted = deps.ted ?? (() => Date.now());
  const adc = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const adcToken = deps.adcToken ?? (async () => (await adc.getAccessToken()) ?? "");
  let cache: { token: string; vyprsi: number } | null = null;

  async function token(): Promise<string> {
    if (cache && cache.vyprsi - 5 * 60_000 > ted()) return cache.token;
    const iat = Math.floor(ted() / 1000);
    const payload = { iss: servisniUcet, sub: uzivatel, scope: scopy.join(" "), aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 };

    const podpis = await fetchFn(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(servisniUcet)}:signJwt`, {
      method: "POST",
      headers: { authorization: `Bearer ${await adcToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(payload) }),
    });
    if (!podpis.ok) throw new Error(`Podpis JWT selhal (HTTP ${podpis.status}): ${(await podpis.text()).slice(0, 300)}`);
    const { signedJwt } = (await podpis.json()) as { signedJwt: string };

    const vymena = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedJwt }).toString(),
    });
    if (!vymena.ok) {
      const text = (await vymena.text()).slice(0, 300);
      const napoveda = /unauthorized_client/.test(text) ? " – v adminu Workspace chybí delegace pro Client ID servisního účtu nebo některý scope." : "";
      throw new Error(`Výměna tokenu selhala (HTTP ${vymena.status}): ${text}${napoveda}`);
    }
    const t = (await vymena.json()) as { access_token: string; expires_in: number };
    cache = { token: t.access_token, vyprsi: ted() + t.expires_in * 1000 };
    return t.access_token;
  }

  return {
    async klient() {
      const c = new OAuth2Client();
      c.setCredentials({ access_token: await token() });
      return c;
    },
  };
}
