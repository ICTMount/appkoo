import { describe, expect, it, beforeEach } from "vitest";
import { delegace } from "../src/google/delegace.js";
import { hledejChat, hledejEmaily, prilohyChatu, prilohyEmailu, hledejKalendar, hledejNaLokalite, hledejVsude, ocistitDotaz, poDavkach, uliceCislo, vycistitCacheKalendaru, vycistitCacheChatu, vyrazyZakazky, type ZavislostiZdroju } from "../src/zdroje/hledani.js";
import { sekceZdroju } from "../src/web/html.js";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("výrazy pro hledání", () => {
  it("O-číslo bez přípony, celé O-ID a S7 bez „=“", () => {
    expect(vyrazyZakazky({ idObjednavky: "O-8534367117:1", idObjednavkyZaklad: "O-8534367117", idS7: "=1-D4O3JTD" })).toEqual(["O-8534367117", "O-8534367117:1", "1-D4O3JTD"]);
    expect(vyrazyZakazky({ idObjednavky: "O-8550000001", idObjednavkyZaklad: "O-8550000001", idS7: "=10421480" })).toEqual(["O-8550000001"]);
    expect(ocistitDotaz(' "O-1" (x) ')).toBe("O-1 x");
  });
});

describe("delegace jménem tmcz01", () => {
  it("nechá podepsat JWT, vymění za token a token drží v cache", async () => {
    const volani: string[] = [];
    let ted = 1_800_000_000_000;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      volani.push(url);
      if (url.includes(":signJwt")) {
        const payload = JSON.parse(JSON.parse(String(init!.body)).payload);
        expect(payload).toMatchObject({ iss: "sa@appkoo.iam.gserviceaccount.com", sub: "tmcz01@ictmount.com", aud: "https://oauth2.googleapis.com/token" });
        expect(payload.scope).toContain("gmail.readonly");
        return json({ signedJwt: "JWT" });
      }
      expect(String(init!.body)).toContain("assertion=JWT");
      return json({ access_token: "TOKEN", expires_in: 3600 });
    }) as typeof fetch;
    const d = delegace("sa@appkoo.iam.gserviceaccount.com", "tmcz01@ictmount.com", undefined, { fetchFn, adcToken: async () => "ADC", ted: () => ted });
    expect((await (await d.klient()).getAccessToken()).token).toBe("TOKEN");
    await d.klient();
    expect(volani).toHaveLength(2); // druhé volání z cache
    ted += 56 * 60_000; // 4 min před vypršením → obnovit
    await d.klient();
    expect(volani).toHaveLength(4);
    // deset souběžných požadavků po vypršení → jen jedna obnova (podpis + výměna)
    ted += 60 * 60_000;
    await Promise.all(Array.from({ length: 10 }, () => d.klient()));
    expect(volani).toHaveLength(6);
  });

  it("chybějící delegace v adminu dá srozumitelnou chybu", async () => {
    const fetchFn = (async (url: string) => (url.includes(":signJwt") ? json({ signedJwt: "JWT" }) : json({ error: "unauthorized_client" }, 401))) as typeof fetch;
    const d = delegace("sa@x", "tmcz01@ictmount.com", undefined, { fetchFn, adcToken: async () => "ADC" });
    await expect(d.klient()).rejects.toThrow(/Přenesení|delegace/);
  });
});

describe("zdroje", () => {
  beforeEach(() => vycistitCacheChatu());

  it("e-mail: předmět, odesílatel, úryvek, nejnovější nahoře", async () => {
    const dotazy: string[] = [];
    const gmail = {
      users: {
        messages: {
          list: async (p: { q: string }) => (dotazy.push(p.q), { data: { messages: [{ id: "m1" }, { id: "m2" }] } }),
          get: async (p: { id: string }) => ({
            data: {
              internalDate: String(Date.parse(p.id === "m1" ? "2026-10-14T08:00:00Z" : "2026-10-15T08:00:00Z")),
              snippet: `úryvek ${p.id}`,
              payload: { headers: [{ name: "Subject", value: `Re: O-8550000001 ${p.id}` }, { name: "From", value: "PEP <pep@t-mobile.cz>" }] },
            },
          }),
        },
      },
    } as never;
    const n = await hledejEmaily(gmail, ["O-8550000001", "1-D4O3JTD"]);
    expect(dotazy[0]).toBe('"O-8550000001" OR "1-D4O3JTD" newer_than:365d -to:cml@ictmount.com -cc:cml@ictmount.com -list:cml@ictmount.com');
    expect(n.map((x) => x.titulek)).toEqual(["Re: O-8550000001 m2", "Re: O-8550000001 m1"]);
    expect(n[0]).toMatchObject({ zdroj: "email", kdo: "PEP <pep@t-mobile.cz>", text: "úryvek m2" });
  });

  it("e-mail: interní notifikace na skupinu cml@ictmount.com se nezobrazí", async () => {
    const gmail = {
      users: {
        messages: {
          list: async () => ({ data: { messages: [{ id: "m1" }, { id: "m2" }] } }),
          get: async (p: { id: string }) => ({
            data: {
              internalDate: String(Date.parse("2026-10-15T08:00:00Z")),
              snippet: p.id,
              payload: {
                headers: [
                  { name: "Subject", value: `O-8550000001 ${p.id}` },
                  { name: "From", value: "MWF <noreply@mwf.cz>" },
                  { name: "To", value: p.id === "m1" ? "CML <cml@ictmount.com>" : "tmcz01@ictmount.com" },
                ],
              },
            },
          }),
        },
      },
    } as never;
    const n = await hledejEmaily(gmail, ["O-8550000001"]);
    expect(n.map((x) => x.text)).toEqual(["m2"]);
  });

  it("kalendáře: všechny kalendáře kromě svátků, bez duplicit přes víc výrazů", async () => {
    const hledano: string[] = [];
    const cal = {
      calendarList: { list: async () => ({ data: { items: [{ id: "K1", summary: "Hristov Anton" }, { id: "en.czech#holiday@group.v.calendar.google.com", summary: "Svátky" }] } }) },
      events: {
        list: async (p: { calendarId: string; q: string }) => {
          hledano.push(`${p.calendarId}:${p.q}`);
          return { data: { items: [{ id: "e1", status: "confirmed", summary: "Hristov - FTTH O-8550000001 Novák", location: "Praha", start: { dateTime: "2026-10-16T10:00:00+02:00" }, htmlLink: "https://cal/e1" }] } };
        },
      },
    } as never;
    const n = await hledejKalendar(cal, ["O-8550000001", "1-D4O3JTD"], new Date("2026-04-01"), new Date("2026-12-31"));
    expect(hledano).toEqual(["K1:O-8550000001", "K1:1-D4O3JTD"]);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ zdroj: "kalendar", kde: "Hristov Anton", odkaz: "https://cal/e1" });
  });

  it("chat: zprávy s číslem zakázky i odpovědi ve stejném vlákně", async () => {
    const fetchFn = (async (url: string) => {
      if (url.endsWith("/spaces/S1")) return json({ displayName: "NEDOKONCENE" });
      return json({
        messages: [
          { name: "m1", text: "O-8550000001 MV – zákazník nebyl doma", createTime: "2026-10-15T07:00:00Z", sender: { displayName: "Hristov" }, thread: { name: "spaces/S1/threads/T1" } },
          { name: "m2", text: "beru, volám zákazníkovi", createTime: "2026-10-15T07:30:00Z", sender: { displayName: "Hadravová" }, thread: { name: "spaces/S1/threads/T1" } },
          { name: "m3", text: "jiná zakázka O-8559999999", createTime: "2026-10-15T08:00:00Z", thread: { name: "spaces/S1/threads/T2" } },
        ],
      });
    }) as typeof fetch;
    const n = await hledejChat(["spaces/S1"], ["o-8550000001"], "TOKEN", fetchFn);
    expect(n.map((x) => [x.kdo, x.veVlakne])).toEqual([["Hadravová", true], ["Hristov", false]]);
    expect(n[0]!.titulek).toBe("NEDOKONCENE");
    expect(n[0]!.odkaz).toContain("/space/S1/T1");
  });

  it("výpadek jednoho zdroje nezastaví ostatní, pomalý zdroj vyprší", async () => {
    const zav: ZavislostiZdroju = {
      gmail: async () => { throw new Error("unauthorized_client"); },
      kalendar: async () => ({ calendarList: { list: async () => ({ data: { items: [] } }) } }) as never,
      chatToken: () => new Promise<string>(() => {}),
      prostory: ["spaces/S1"],
    };
    const v = await hledejVsude(zav, ["O-8550000001"], new Date("2026-10-15T10:00:00Z"), 200, 200);
    expect(v.map((x) => [x.zdroj, x.chyba ? "chyba" : "ok"])).toEqual([["email", "chyba"], ["kalendar", "ok"], ["chat", "chyba"]]);
    expect(v[2]!.chyba).toContain("neodpověděl");
    const html = sekceZdroju(v);
    expect(html).toContain("Zdroj nedostupný: unauthorized_client");
    expect(html).toContain("Kalendáře techniků");
    expect(sekceZdroju(null)).toContain("není zapnuté");
  });
});

describe("instalovali jsme v lokalitě", () => {
  it("ulice a číslo popisné z adresy MWF", () => {
    expect(uliceCislo("Praha, Krčská 991/63, 14000")).toEqual({ ulice: "Krčská", cp: "991" });
    expect(uliceCislo("České Budějovice, M. Horákové 1376/10, 37005")).toEqual({ ulice: "M. Horákové", cp: "1376" });
    expect(uliceCislo("Příbram")).toBeNull();
  });

  it("jen události na stejné ulici a č. p., bez této zakázky a volných slotů; nejnovější nahoře", async () => {
    const dotazy: string[] = [];
    const cal = {
      calendarList: { list: async () => ({ data: { items: [{ id: "K1", summary: "Vajc Tomas" }] } }) },
      events: {
        list: async (p: { q: string }) => {
          dotazy.push(p.q);
          return {
            data: {
              items: [
                { id: "a", status: "confirmed", summary: "Vajc - FTTH O-85511111111 Novák", location: "Krčská 991/63, Praha 4", start: { dateTime: "2026-05-04T10:00:00+02:00" }, htmlLink: "https://cal/a" },
                { id: "b", status: "confirmed", summary: "Vajc - FTTH O-85522222222 Malá", location: "Krčská 991/12", start: { dateTime: "2026-08-04T10:00:00+02:00" }, htmlLink: "https://cal/b" },
                { id: "c", status: "confirmed", summary: "Vajc - FTTH O-85533333333 Jiná", location: "Krčská 9911/1", start: { dateTime: "2026-08-05T10:00:00+02:00" } },
                { id: "d", status: "confirmed", summary: "Vajc - VOLNY", location: "Krčská 991", start: { dateTime: "2026-08-06T10:00:00+02:00" } },
                { id: "e", status: "confirmed", summary: "Vajc - FTTH O-85547833023 tato", location: "Krčská 991/63", start: { dateTime: "2026-10-20T10:00:00+02:00" } },
              ],
            },
          };
        },
      },
    } as never;
    const n = await hledejNaLokalite(cal, "Praha, Krčská 991/63, 14000", "O-85547833023", new Date("2026-10-16T12:00:00Z"));
    expect(dotazy).toEqual(["Krčská 991"]);
    expect(n!.map((x) => x.oId)).toEqual(["O-85522222222", "O-85511111111"]);
    expect(n![0]!.odkaz).toBe("https://cal/b");
  });
});


describe("tělo e-mailu", async () => {
  const { teloZpravy } = await import("../src/zdroje/hledani.js");
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  it("text/plain přednostně, citace starší zprávy se uřízne; HTML bez značek", () => {
    expect(teloZpravy({ mimeType: "multipart/alternative", parts: [
      { mimeType: "text/plain", body: { data: b64("Dobrý den,\nprosím odložit.\n\nDne 1. 11. 2026 Novák napsal:\n> stará zpráva") } },
      { mimeType: "text/html", body: { data: b64("<p>x</p>") } },
    ] })).toBe("Dobrý den,\nprosím odložit.");
    expect(teloZpravy({ mimeType: "text/html", body: { data: b64("<div>Řádek 1</div><div>Řádek&nbsp;2</div>") } })).toBe("Řádek 1\n Řádek 2");
    expect(teloZpravy(undefined)).toBe("");
  });
});

describe("poDavkach: omezený souběh dotazů na kalendáře", () => {
  it("spustí nejvýš N úloh naráz, pořadí výsledků zachová", async () => {
    let bezi = 0;
    let max = 0;
    const ulohy = Array.from({ length: 20 }, (_, i) => async () => {
      bezi++;
      max = Math.max(max, bezi);
      await new Promise((r) => setTimeout(r, 2));
      bezi--;
      return i * 2;
    });
    const v = await poDavkach(ulohy, 4);
    expect(v).toEqual(ulohy.map((_, i) => i * 2));
    expect(max).toBe(4);
    expect(await poDavkach([], 4)).toEqual([]);
  });
});

describe("seznam kalendářů v cache", () => {
  it("calendarList.list se volá jednou za 10 min na stejný API objekt, hledání i lokalita ho sdílí", async () => {
    let seznamu = 0;
    const cal = {
      calendarList: { list: async () => (seznamu++, { data: { items: [{ id: "K1", summary: "Hristov Anton" }] } }) },
      events: { list: async () => ({ data: { items: [] } }) },
    } as never;
    const od = new Date("2026-01-01T00:00:00Z");
    await hledejKalendar(cal, ["O-1234567"], od, new Date("2026-12-31T00:00:00Z"));
    await hledejKalendar(cal, ["O-7654321"], od, new Date("2026-12-31T00:00:00Z"));
    await hledejNaLokalite(cal, "Praha, Krčská 991/63", "O-1", new Date("2026-11-04T10:00:00Z"));
    expect(seznamu).toBe(1);
    vycistitCacheKalendaru(cal);
    await hledejKalendar(cal, ["O-1234567"], od, new Date("2026-12-31T00:00:00Z"));
    expect(seznamu).toBe(2);
  });
});

describe("přílohy zpráv (fotky, PDF) – krok 1: zobrazit", () => {
  it("e-mail: části s názvem a attachmentId, vložené obrázky bez názvu ne", () => {
    const p = prilohyEmailu("m9", {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: "aGk=" } },
        { mimeType: "image/jpeg", filename: "IMG_2041.jpg", body: { attachmentId: "A1", size: 2_300_000 } },
        { mimeType: "image/png", filename: "", body: { attachmentId: "A2", size: 500 } },
        { mimeType: "multipart/alternative", parts: [{ mimeType: "application/pdf", filename: "protokol.pdf", body: { attachmentId: "A3", size: 90_000 } }] },
      ],
    });
    expect(p).toEqual([
      { nazev: "IMG_2041.jpg", typ: "image/jpeg", velikost: 2_300_000, odkaz: null, ref: { zdroj: "email", zprava: "m9", priloha: "A1" } },
      { nazev: "protokol.pdf", typ: "application/pdf", velikost: 90_000, odkaz: null, ref: { zdroj: "email", zprava: "m9", priloha: "A3" } },
    ]);
  });

  it("chat: nahraný soubor (media) i soubor z Disku; bez reference se přeskočí", () => {
    const p = prilohyChatu([
      { contentName: "foto.jpg", contentType: "image/jpeg", downloadUri: "https://chat.google.com/dl/1", attachmentDataRef: { resourceName: "spaces/S1/messages/m1/attachments/a1" } },
      { contentType: "video/mp4", driveDataRef: { driveFileId: "D1" } },
      { contentName: "nic" },
    ]);
    expect(p).toEqual([
      { nazev: "foto.jpg", typ: "image/jpeg", velikost: null, odkaz: "https://chat.google.com/dl/1", ref: { zdroj: "chat", media: "spaces/S1/messages/m1/attachments/a1" } },
      { nazev: "soubor z Disku", typ: "video/mp4", velikost: null, odkaz: "https://drive.google.com/file/d/D1/view", ref: { zdroj: "chat", driveId: "D1" } },
    ]);
  });

  it("karta zdroje ukáže přílohy s velikostí a odkazem", () => {
    const html = sekceZdroju([{ zdroj: "chat", nalezy: [{ zdroj: "chat", cas: null, titulek: "NEDOKONCENE", text: "foto", prilohy: [{ nazev: "foto.jpg", typ: "image/jpeg", velikost: 2_300_000, odkaz: "https://chat.google.com/dl/1", ref: { zdroj: "chat", media: "x" } }] }] }]);
    expect(html).toContain("📎");
    expect(html).toContain('<a href="https://chat.google.com/dl/1" target="_blank" rel="noopener">foto.jpg (2.3 MB)</a>');
  });
});
