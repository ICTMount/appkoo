import { describe, expect, it } from "vitest";
import { obsadVolnySlot, SlotObsazen } from "../src/gcal/kalendar.js";
import { nactiKalendare, type TechnikPlanu } from "../src/plan/planovac.js";
import { sestavMrizku, strankaMrizky, type TechnikMrizky, type VolbyMrizky } from "../src/web/mrizka.js";
import type { UdalostMrizky } from "../src/zdroje/sync.js";

// Souběžná práce 10 koordinátorek: kalendář se čte jednou pro všechny, stejný slot získá jen jedna,
// a vykreslení velké mřížky je dost rychlé na to, aby se požadavky navzájem nebrzdily.

const cekej = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kalendář s jedním slotem VOLNY; patch respektuje If-Match jako Google (412 při změně mezi čtením a zápisem) */
function kalendarSeSlotem() {
  let etag = "v1";
  let summary = "Vajc - VOLNY";
  const stat = { get: 0, patch: 0, list: 0 };
  const api = {
    events: {
      get: async () => {
        stat.get++;
        await cekej(5);
        return { data: { id: "slot", status: "confirmed", summary, colorId: summary.includes("VOLNY") ? "10" : undefined, etag, description: "", start: { dateTime: "2026-11-16T10:00:00+01:00" }, end: { dateTime: "2026-11-16T12:00:00+01:00" } } };
      },
      patch: async (p: { requestBody: { summary: string } }, o: { headers?: Record<string, string> } = {}) => {
        stat.patch++;
        await cekej(5);
        if (o.headers?.["If-Match"] && o.headers["If-Match"] !== etag) throw Object.assign(new Error("Precondition Failed"), { code: 412 });
        etag = `v${Number(etag.slice(1)) + 1}`;
        summary = p.requestBody.summary;
        return { data: { id: "slot", htmlLink: "https://cal/slot" } };
      },
      list: async () => {
        stat.list++;
        await cekej(20);
        return { data: { items: [{ id: "slot", status: "confirmed", summary, colorId: "10", start: { dateTime: "2026-11-16T10:00:00+01:00" }, end: { dateTime: "2026-11-16T12:00:00+01:00" } }] } };
      },
    },
  };
  return { api: api as never, stat, stav: () => summary };
}

describe("souběh 10 koordinátorek", () => {
  it("stejný VOLNY slot získá právě jedna, ostatních 9 dostane srozumitelné odmítnutí a kalendář se nepřepíše dvakrát", async () => {
    const k = kalendarSeSlotem();
    const od = new Date("2026-11-16T10:00:00Z");
    const pokusy = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => obsadVolnySlot(k.api, "K1", "slot", { summary: `Vajc - FTTH O-855000000${i} Zákazník ${i}`, description: "", location: "", start: {}, end: {} } as never, od)),
    );
    const ok = pokusy.filter((p) => p.status === "fulfilled");
    const odmitnute = pokusy.filter((p) => p.status === "rejected") as PromiseRejectedResult[];
    expect(ok.length).toBe(1);
    expect(odmitnute.length).toBe(9);
    expect(odmitnute.every((p) => p.reason instanceof SlotObsazen)).toBe(true);
    expect(k.stav()).toMatch(/^Vajc - FTTH O-855000000\d/); // v kalendáři je právě jedna zakázka
    // další pokus už slot jako volný nevidí
    await expect(obsadVolnySlot(k.api, "K1", "slot", { summary: "Vajc - FTTH O-8559999999 Pozdě", description: "" } as never, od)).rejects.toBeInstanceOf(SlotObsazen);
  });

  it("10 souběžných otevření kalendáře čte každý kalendář z Googlu jen jednou (sdílená paměť 30 s)", async () => {
    const k = kalendarSeSlotem();
    const technici: TechnikPlanu[] = Array.from({ length: 23 }, (_, i) => ({ jmeno: `T${i}`, nazevVKalendari: `T${i}`, kalendar: `K${i}`, vyjezd: "", skupiny: ["FTTH"] }));
    const od = new Date("2026-11-16T00:00:00Z");
    const do_ = new Date("2026-11-17T00:00:00Z");
    const vysledky = await Promise.all(Array.from({ length: 10 }, () => nactiKalendare(k.api, technici, od, do_)));
    expect(k.stat.list).toBe(23); // ne 230
    expect(vysledky.every((v) => v.udalosti.length === 23 && v.nedostupne.length === 0)).toBe(true);
  });

  it("vykreslení týdne 23 techniků (805 událostí) zvládne 10 souběžných požadavků bez znatelného zdržení", () => {
    const technici: TechnikMrizky[] = Array.from({ length: 23 }, (_, i) => ({ jmeno: `Technik ${i}`, nazevVKalendari: `T${i}`, kalendar: `K${i}`, vyjezd: "Praha" }));
    const sloty = [["08:00", "10:00"], ["10:00", "12:00"], ["12:00", "13:30"], ["13:30", "15:00"], ["15:00", "17:00"]] as const;
    const ud: UdalostMrizky[] = [];
    for (let d = 16; d <= 22; d++) technici.forEach((t, i) => sloty.forEach(([a, b], s) => ud.push({
      kalendar: t.kalendar, id: `${i}-${d}-${s}`, summary: (i + d + s) % 3 ? `${t.nazevVKalendari} - FTTH O-85599${String(i).padStart(2, "0")}${d}${s} Zákazník SLA 20.11.2026 13:39 (AP)` : `${t.nazevVKalendari} - VOLNY`,
      location: "Bellušova 1827/53, Praha 13 Stodůlky", description: "TEL: 605 000 000\nČASOVÉ MOŽNOSTI: pevný termín\nINSTALAČNÍ PŘEDPIS\n…", od: new Date(`2026-11-${d}T${a}:00Z`), do: new Date(`2026-11-${d}T${b}:00Z`),
      barvaId: (i + d + s) % 3 ? null : "10", kalendarBarva: "#3f51b5", odkaz: null,
    })));
    expect(ud.length).toBe(805);
    const v: VolbyMrizky = { pohled: "tyden", den: "2026-11-16", vybrani: [], jenVolny: false };
    const t0 = performance.now();
    let delka = 0;
    for (let i = 0; i < 10; i++) delka = strankaMrizky({ volby: v, technici, barvy: new Map(), mrizka: sestavMrizku(ud, technici, v), synchronizace: null, uzivatel: "a@b.cz", zive: true, nacteno: new Date() }, "2026-11-11").length;
    const naJeden = (performance.now() - t0) / 10;
    expect(delka).toBeGreaterThan(100_000);
    expect(naJeden).toBeLessThan(250); // ms CPU na jednu stránku – 10 požadavků naráz se na jednom jádře odbaví do pár sekund
  });
});
