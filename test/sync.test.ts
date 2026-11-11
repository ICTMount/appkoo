import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { Db } from "../src/db/db.js";
import { hledejChatDb, hledejKalendarDb, hledejNaLokaliteDb, odemkniSync, stavSynchronizace, synchronizujChat, synchronizujKalendare, udalostiMrizky, zamekSync } from "../src/zdroje/sync.js";
import { hledejVsude, synchronizovano, type ZavislostiZdroju } from "../src/zdroje/hledani.js";

const pgliteDb = (pg: PGlite): Db => ({
  query: (sql, params) => pg.query(sql, params) as never,
  tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never })),
});
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

describe("synchronizace kalendářů a Chatu do databáze", () => {
  it("kalendáře: nahraje události, hledá zakázku i lokalitu z databáze; druhý běh nahradí řádky", async () => {
    const db = pgliteDb(new PGlite());
    let kolo = 0;
    const volani: { updatedMin?: string; showDeleted?: boolean }[] = [];
    const cal = {
      calendarList: { list: async () => ({ data: { items: [{ id: "K1", summary: "Vajc Tomas", backgroundColor: "#3f51b5" }, { id: "svatky@group.v.calendar.google.com", summary: "Svátky" }] } }) },
      events: {
        list: async (p: { updatedMin?: string; showDeleted?: boolean }) => {
          volani.push({ updatedMin: p.updatedMin, showDeleted: p.showDeleted });
          return {
            data: {
              items: kolo === 0
                ? [
                    { id: "a", status: "confirmed", summary: "Vajc - FTTH O-85511111111 Novák", location: "Krčská 991/63, Praha 4", start: { dateTime: "2026-05-04T10:00:00+02:00" }, htmlLink: "https://cal/a" },
                    { id: "b", status: "confirmed", summary: "Vajc - FTTH O-85522222222 Malá", description: "S7 1-D4O3JTD", location: "Krčská 991/12", start: { dateTime: "2026-08-04T10:00:00+02:00" } },
                    { id: "c", status: "confirmed", summary: "Vajc - VOLNY", location: "Krčská 991", colorId: "10", start: { dateTime: "2026-08-06T10:00:00+02:00" }, end: { dateTime: "2026-08-06T12:00:00+02:00" } },
                    { id: "cely", status: "confirmed", summary: "Vajc dovolená", start: { date: "2026-08-06" }, end: { date: "2026-08-07" } },
                  ]
                : [
                    // přírůstek: jedna nová, jedna zrušená
                    { id: "d", status: "confirmed", summary: "Vajc - FTTH O-85533333333 Nová", location: "Jinde 1", start: { dateTime: "2026-10-20T10:00:00+02:00" } },
                    { id: "c", status: "cancelled" },
                  ],
            },
          };
        },
      },
    } as never;
    const now = new Date("2026-10-16T12:00:00Z");
    expect(await stavSynchronizace(db, "kalendare")).toBeNull();
    const r = await synchronizujKalendare(db, cal, now);
    expect(r).toMatchObject({ kalendaru: 1, udalosti: 4 });
    // mřížka kalendáře: konec, barva události i kalendáře; celodenní se nevrací
    const mr = await udalostiMrizky(db, ["K1"], new Date("2026-08-06T00:00:00Z"), new Date("2026-08-07T00:00:00Z"));
    expect(mr.map((x) => [x.summary, x.od.toISOString(), x.do.toISOString(), x.barvaId, x.kalendarBarva])).toEqual([["Vajc - VOLNY", "2026-08-06T10:00:00.000Z", "2026-08-06T12:00:00.000Z", "10", "#3f51b5"]]);
    expect(await stavSynchronizace(db, "kalendare")).not.toBeNull();
    expect(await synchronizovano(db, "kalendare")).toBe(true);

    const n = await hledejKalendarDb(db, ["O-85511111111", "1-d4o3jtd"], new Date("2026-01-01"), new Date("2026-12-31"));
    expect(n.map((x) => x.titulek)).toEqual(["Vajc - FTTH O-85522222222 Malá", "Vajc - FTTH O-85511111111 Novák"]);
    expect(n[1]).toMatchObject({ kde: "Vajc Tomas", text: "Krčská 991/63, Praha 4", odkaz: "https://cal/a" });

    const l = await hledejNaLokaliteDb(db, "Praha, Krčská 991/63, 14000", "O-85599999999", now);
    expect(l!.map((x) => x.oId)).toEqual(["O-85522222222", "O-85511111111"]); // VOLNY ne, 991/12 i 991/63 ano (stejné č. p.)

    expect(r.plne).toBe(1);
    expect(volani[0]!.updatedMin).toBeUndefined(); // první běh: plné nahrání

    kolo = 1;
    const r2 = await synchronizujKalendare(db, cal, now);
    expect(r2).toMatchObject({ udalosti: 1, plne: 0 }); // druhý běh: jen změny od minula
    expect(volani[1]!.showDeleted).toBe(true);
    expect(volani[1]!.updatedMin).toBeDefined();
    expect((await hledejKalendarDb(db, ["O-85533333333"], new Date("2026-01-01"), new Date("2026-12-31"))).length).toBe(1);
    expect((await hledejKalendarDb(db, ["O-85511111111"], new Date("2026-01-01"), new Date("2026-12-31"))).length).toBe(1); // staré zůstaly
    expect((await hledejNaLokaliteDb(db, "Praha, Krčská 991, 14000", "O-0", now))!.map((x) => x.titulek)).not.toContain("Vajc - VOLNY"); // zrušená smazána

    // zámek proti souběhu dvou běhů úlohy
    expect(await zamekSync(db)).toBe(true);
    expect(await zamekSync(db)).toBe(false);
    await odemkniSync(db);
    expect(await zamekSync(db)).toBe(true);
  }, 60_000); // první start PGlite (WASM) trvá několik sekund

  it("chat: první běh stáhne 60 dní, druhý jen novější; hledání vrátí shody i odpovědi ve vlákně s přílohami", async () => {
    const db = pgliteDb(new PGlite());
    const filtry: string[] = [];
    let kolo = 0;
    const fetchFn = (async (url: string) => {
      if (url.endsWith("/spaces/S1")) return json({ displayName: "NEDOKONCENE" });
      filtry.push(decodeURIComponent(new URL(url).searchParams.get("filter") ?? ""));
      return json({
        messages: kolo === 0
          ? [
              { name: "spaces/S1/messages/m1", text: "O-8550000001 MV – zákazník nebyl doma", createTime: "2026-10-15T07:00:00Z", sender: { displayName: "Hristov" }, thread: { name: "spaces/S1/threads/T1" }, attachment: [{ contentName: "foto.jpg", contentType: "image/jpeg", attachmentDataRef: { resourceName: "abc==" } }] },
              { name: "spaces/S1/messages/m2", text: "beru, volám zákazníkovi", createTime: "2026-10-15T07:30:00Z", sender: { displayName: "Hadravová" }, thread: { name: "spaces/S1/threads/T1" } },
              { name: "spaces/S1/messages/m3", text: "jiná zakázka O-8559999999", createTime: "2026-10-15T08:00:00Z", thread: { name: "spaces/S1/threads/T2" } },
            ]
          : [{ name: "spaces/S1/messages/m4", text: "O-8550000001 nový termín", createTime: "2026-10-16T08:00:00Z", sender: { displayName: "Vajc" }, thread: { name: "spaces/S1/threads/T3" } }],
      });
    }) as typeof fetch;
    const r1 = await synchronizujChat(db, ["spaces/S1"], "TOK", fetchFn);
    expect(r1).toMatchObject({ prostoru: 1, novych: 3 });
    kolo = 1;
    const r2 = await synchronizujChat(db, ["spaces/S1"], "TOK", fetchFn);
    expect(r2.novych).toBe(1);
    expect(filtry[1]).toBe('createTime > "2026-10-15T08:00:00.000Z"'); // dočítá jen od poslední známé

    const n = await hledejChatDb(db, ["spaces/S1"], ["o-8550000001"]);
    expect(n.map((x) => [x.kdo, x.veVlakne])).toEqual([["Vajc", false], ["Hadravová", true], ["Hristov", false]]);
    expect(n[0]!.titulek).toBe("NEDOKONCENE");
    expect(n[2]!.odkaz).toContain("/space/S1/T1");
    expect(n[2]!.prilohy).toEqual([{ nazev: "foto.jpg", typ: "image/jpeg", velikost: null, odkaz: null, ref: { zdroj: "chat", media: "abc==" } }]);

    // hledejVsude s databází: kalendář ani Chat nevolá Google
    const zav: ZavislostiZdroju = {
      db,
      gmail: async () => ({ users: { messages: { list: async () => ({ data: { messages: [] } }) } } }) as never,
      kalendar: async () => { throw new Error("kalendář se nemá volat"); },
      chatToken: async () => { throw new Error("chat se nemá volat"); },
      prostory: ["spaces/S1"],
    };
    await synchronizujKalendare(db, { calendarList: { list: async () => ({ data: { items: [] } }) }, events: { list: async () => ({ data: { items: [] } }) } } as never, new Date("2026-10-16T12:00:00Z"));
    const v = await hledejVsude(zav, ["O-8550000001"], new Date("2026-10-16T12:00:00Z"));
    expect(v.map((x) => [x.zdroj, x.nalezy.length, x.chyba ?? null])).toEqual([["email", 0, null], ["kalendar", 0, null], ["chat", 3, null]]);
  }, 60_000);
});
