import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { driveZdroj, gmailZdroj } from "../src/ingest/google.js";
import { casExportu, povolenyOdesilatel, posudExport, zpracujDosle, type DoslyExport, type StavPrijmu } from "../src/ingest/prijem.js";
import { local, tedPraha } from "../src/domain/time.js";

const HLAVICKA = "ID aktivity;ID objednávky;ID obj. v ext. systéme;Stav;Typ aktivity;Poznámka";
const csv = (radky: string[]) => iconv.encode([HLAVICKA, ...radky].join("\r\n"), "win1250");
const EXPORT_A = csv(["1;11;O-1000000001;Zaparkovaná;Inst_Pristupu_FTTH;"]);
const EXPORT_B = csv(["1;11;O-1000000001;Zaparkovaná;Inst_Pristupu_FTTH;", "2;12;O-1000000002;Riešená dodávateľom - odovzdaná;Inst_Pristupu_FTTH;"]);

const dosly = (o: Partial<DoslyExport>): DoslyExport => ({
  zdroj: "upload", nazev: "zakazky paw-grid-export-csv 20261014 18_01.csv", obsah: EXPORT_A, prijato: local(2026, 10, 14, 18, 5), ...o,
});
const stav = (o: Partial<StavPrijmu> = {}): StavPrijmu => ({ posledniExportAt: null, zpracovane: new Set(), ...o });

describe("příjem exportu", () => {
  it("čas exportu z názvu souboru, jinak čas přijetí", () => {
    expect(casExportu("zakazky paw-grid-export-csv 20261014 18_01.csv", new Date(0))).toEqual({ at: local(2026, 10, 14, 18, 1), zNazvu: true });
    expect(casExportu("export.csv", local(2026, 10, 15, 9, 0)).zNazvu).toBe(false);
  });

  it("importuje platný export", () => {
    const p = posudExport(dosly({}), stav());
    expect(p.akce).toBe("importovat");
    if (p.akce === "importovat") expect(p.import.zakazky).toHaveLength(1);
  });

  it("odmítne ne-CSV a export bez klíčových sloupců", () => {
    expect(posudExport(dosly({ nazev: "export.xlsx" }), stav()).akce).toBe("odmitnout");
    const bezSloupcu = posudExport(dosly({ obsah: Buffer.from("ID aktivity;Stav\n1;Zaparkovaná") }), stav());
    expect(bezSloupcu).toMatchObject({ akce: "odmitnout", duvod: expect.stringMatching(/Typ aktivity/) });
  });

  it("stejný soubor podruhé (jinou cestou) přeskočí", () => {
    const s = stav();
    const [prvni, druhy] = zpracujDosle([dosly({ zdroj: "drive" }), dosly({ zdroj: "email", odesilatel: "Adéla <adela@ictmount.com>" })], s);
    expect(prvni!.posouzeni.akce).toBe("importovat");
    expect(druhy!.posouzeni).toMatchObject({ akce: "preskocit", duvod: expect.stringMatching(/už byl zpracován/) });
  });

  it("starší export nepřepíše novější stav; dávka se zpracuje od nejstaršího", () => {
    const s = stav();
    const vysledek = zpracujDosle(
      [dosly({ nazev: "zakazky paw-grid-export-csv 20261014 18_01.csv", obsah: EXPORT_B }), dosly({ nazev: "zakazky paw-grid-export-csv 20261014 15_00.csv" })],
      s,
    );
    expect(vysledek.map((v) => [v.export.nazev.slice(-9), v.posouzeni.akce])).toEqual([["15_00.csv", "importovat"], ["18_01.csv", "importovat"]]);
    expect(s.posledniExportAt).toEqual(local(2026, 10, 14, 18, 1));
    const pozde = posudExport(dosly({ nazev: "zakazky paw-grid-export-csv 20261014 16_00.csv", obsah: csv(["9;9;O-9;Zaparkovaná;x;"]) }), s);
    expect(pozde).toMatchObject({ akce: "preskocit", duvod: expect.stringMatching(/starší/) });
  });

  it("e-mail jen od povoleného odesílatele; odmítnutý soubor jde poslat znovu", () => {
    expect(povolenyOdesilatel("Adéla <Adela@ICTMOUNT.com>", ["@ictmount.com"])).toBe(true);
    expect(povolenyOdesilatel("cizi@example.com", ["@ictmount.com", "mwf@t-mobile.cz"])).toBe(false);
    const s = stav();
    const [cizi] = zpracujDosle([dosly({ zdroj: "email", odesilatel: "cizi@example.com" })], s);
    expect(cizi!.posouzeni.akce).toBe("odmitnout");
    expect(zpracujDosle([dosly({ zdroj: "upload" })], s)[0]!.posouzeni.akce).toBe("importovat");
  });

  it("tedPraha převede UTC na pražský čas (letní i zimní)", () => {
    expect(tedPraha(new Date("2026-07-01T10:00:00Z"))).toEqual(local(2026, 7, 1, 12, 0));
    expect(tedPraha(new Date("2026-12-01T10:00:00Z"))).toEqual(local(2026, 12, 1, 11, 0));
  });
});

describe("napojení na Google", () => {
  it("Drive: hledá exporty ve složce od posledního importu a stáhne je", async () => {
    const dotazy: any[] = [];
    const api = {
      files: {
        list: async (p: any) => (dotazy.push(p), { data: { files: [{ id: "f1", name: "zakazky paw-grid-export-csv 20261015 09_00.csv", createdTime: "2026-10-15T07:01:00Z" }] } }),
        get: async () => ({ data: EXPORT_A.buffer.slice(EXPORT_A.byteOffset, EXPORT_A.byteOffset + EXPORT_A.length) }),
      },
    } as any;
    const soubory = await driveZdroj("SLOZKA", api).nacti(new Date("2026-10-14T16:00:00Z"));
    expect(dotazy[0].q).toContain("'SLOZKA' in parents");
    expect(dotazy[0].q).toContain("createdTime > '2026-10-14T16:00:00.000Z'");
    expect(soubory[0]).toMatchObject({ zdroj: "drive", zdrojId: "f1" });
    expect(soubory[0]!.obsah.equals(EXPORT_A)).toBe(true);
  });

  it("Drive: přeskočí Google tabulku a nečitelný soubor, ostatní exporty stáhne", async () => {
    const api = {
      files: {
        list: async () => ({ data: { files: [
          { id: "g1", name: "zakazky paw-grid-export-csv 20261015 14_05", createdTime: "2026-10-15T12:06:00Z", mimeType: "application/vnd.google-apps.spreadsheet" },
          { id: "x1", name: "zakazky paw-grid-export-csv 20261015 15_00.csv", createdTime: "2026-10-15T13:01:00Z", mimeType: "text/csv" },
          { id: "f2", name: "zakazky paw-grid-export-csv 20261015 17_11.csv", createdTime: "2026-10-15T15:12:00Z", mimeType: "text/csv" },
        ] } }),
        get: async (p: any) => {
          if (p.fileId === "g1") throw new Error("Google tabulka se nesmí stahovat");
          if (p.fileId === "x1") throw new Error("Request failed with status code 403");
          return { data: EXPORT_A.buffer.slice(EXPORT_A.byteOffset, EXPORT_A.byteOffset + EXPORT_A.length) };
        },
      },
    } as any;
    const soubory = await driveZdroj("SLOZKA", api).nacti(null);
    expect(soubory.map((s) => s.zdrojId)).toEqual(["f2"]);
  });

  it("Drive: projde všechny stránky výpisu a znovu nestahuje už zpracované soubory", async () => {
    const stazene: string[] = [];
    const api = {
      files: {
        list: async (p: any) => ({
          data: p.pageToken
            ? { files: [{ id: "f3", name: "zakazky paw-grid-export-csv 20261015 11_00.csv", createdTime: "2026-10-15T09:01:00Z", mimeType: "text/csv" }] }
            : { nextPageToken: "s2", files: [
                { id: "f1", name: "zakazky paw-grid-export-csv 20261015 09_00.csv", createdTime: "2026-10-15T07:01:00Z", mimeType: "text/csv" },
                { id: "f2", name: "zakazky paw-grid-export-csv 20261015 10_00.csv", createdTime: "2026-10-15T08:01:00Z", mimeType: "text/csv" },
              ] },
        }),
        get: async (p: any) => (stazene.push(p.fileId), { data: EXPORT_A.buffer.slice(EXPORT_A.byteOffset, EXPORT_A.byteOffset + EXPORT_A.length) }),
      },
    } as any;
    const soubory = await driveZdroj("SLOZKA", api).nacti(null, new Set(["f1"]));
    expect(soubory.map((s) => s.zdrojId)).toEqual(["f2", "f3"]);
    expect(stazene).toEqual(["f2", "f3"]);
  });

  it("Gmail: vezme CSV přílohy nezpracovaných zpráv a označí je štítkem", async () => {
    const zmeny: any[] = [];
    const api = {
      users: {
        messages: {
          list: async (p: any) => ({ data: { messages: p.q.includes("-label:appkoo-zpracovano") ? [{ id: "m1" }] : [] } }),
          get: async () => ({
            data: {
              internalDate: String(Date.parse("2026-10-15T07:05:00Z")),
              payload: { headers: [{ name: "From", value: "Adéla <adela@ictmount.com>" }], parts: [
                { filename: "poznamka.txt", body: { attachmentId: "a0" } },
                { filename: "zakazky paw-grid-export-csv 20261015 09_00.csv", body: { attachmentId: "a1" } },
              ] },
            },
          }),
          attachments: { get: async () => ({ data: { data: EXPORT_A.toString("base64url") } }) },
          modify: async (p: any) => zmeny.push(p),
        },
        labels: { list: async () => ({ data: { labels: [{ id: "L1", name: "appkoo-zpracovano" }] } }), create: async () => ({ data: { id: "L2" } }) },
      },
    } as any;
    const z = gmailZdroj({ schranka: "mwf-export@ictmount.com" }, api);
    const soubory = await z.nacti(null);
    expect(soubory).toHaveLength(1);
    expect(soubory[0]).toMatchObject({ zdroj: "email", odesilatel: "Adéla <adela@ictmount.com>", zdrojId: "m1" });
    await z.oznacZpracovano(soubory[0]!);
    expect(zmeny[0]).toEqual({ userId: "me", id: "m1", requestBody: { addLabelIds: ["L1"] } });
  });
});
