import { describe, expect, it } from "vitest";
import { dekodujVyber, klicPrilohy, kodujVyber, nazevSouboru, stahniPrilohu, ulozPrilohuNaDisk, type VyberPrilohy } from "../src/google/prilohy.js";

const foto: VyberPrilohy = {
  priloha: { nazev: "15254.jpeg", typ: "image/jpeg", velikost: null, odkaz: null, ref: { zdroj: "chat", media: "spaces/AAQAoP43WQk/messages/pDvoVmrrWfM.pDvoVmrrWfM/attachments/AATUf-ISRUoc7Y8MRI1Ocbtt6uvs" } },
  den: "2026-11-04",
  kdo: "David Krechter",
};
const mail: VyberPrilohy = { priloha: { nazev: "protokol.pdf", typ: "application/pdf", velikost: null, odkaz: null, ref: { zdroj: "email", zprava: "19a1b2c3", priloha: "ANGjdJ8-abc_def" } }, den: null, kdo: "PEP <pep@t-mobile.cz>" };

describe("přílohy → složka zakázky", () => {
  it("hodnota formuláře: zakóduje a dekóduje, podvržené reference odmítne", () => {
    expect(dekodujVyber(kodujVyber(foto))).toEqual(foto);
    expect(dekodujVyber(kodujVyber(mail))).toEqual(mail);
    expect(dekodujVyber("nesmysl")).toBeNull();
    expect(dekodujVyber(Buffer.from(JSON.stringify({ n: "x", t: "y", r: { zdroj: "chat", media: "../etc/passwd" } })).toString("base64url"))).toBeNull();
    expect(dekodujVyber(Buffer.from(JSON.stringify({ n: "x", t: "y", r: { zdroj: "email", zprava: "a b", priloha: "c" } })).toString("base64url"))).toBeNull();
    expect(dekodujVyber(Buffer.from(JSON.stringify({ n: "x", t: "y", r: { zdroj: "chat", driveId: "1AbC_-9" } })).toString("base64url"))?.priloha.ref).toEqual({ zdroj: "chat", driveId: "1AbC_-9" });
  });

  it("klíč evidence a název souboru na Disku", () => {
    expect(klicPrilohy(foto.priloha.ref)).toBe("chat:spaces/AAQAoP43WQk/messages/pDvoVmrrWfM.pDvoVmrrWfM/attachments/AATUf-ISRUoc7Y8MRI1Ocbtt6uvs");
    expect(klicPrilohy({ zdroj: "chat", driveId: "D1" })).toBe("chat:drive:D1");
    expect(klicPrilohy(mail.priloha.ref)).toBe("email:19a1b2c3:ANGjdJ8-abc_def");
    expect(nazevSouboru(foto)).toBe("2026-11-04 Chat David Krechter – 15254.jpeg");
    expect(nazevSouboru({ ...foto, kdo: "Petra Ohemova - ICTM" })).toBe("2026-11-04 Chat Petra Ohemova – 15254.jpeg");
    expect(nazevSouboru(mail)).toBe("E-mail PEP – protokol.pdf");
    expect(nazevSouboru({ ...mail, priloha: { ...mail.priloha, nazev: 'a/b:c?"d".pdf' } })).toBe("E-mail PEP – a_b_c__d_.pdf");
  });

  it("stažení: Chat media s tokenem tmcz01, Gmail příloha z base64url", async () => {
    const volani: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      volani.push(`${url} ${(init!.headers as Record<string, string>).authorization}`);
      return new Response(Buffer.from("JPEGDATA"), { status: 200, headers: { "content-type": "image/jpeg", "content-length": "8" } });
    }) as typeof fetch;
    const zav = {
      gmail: async () => ({ users: { messages: { attachments: { get: async (p: { messageId: string; id: string }) => ({ data: { data: Buffer.from(`PDF ${p.messageId} ${p.id}`).toString("base64url") } }) } } } }) as never,
      chatToken: async () => "TOK",
      fetchFn,
    };
    const c = await stahniPrilohu(zav, foto.priloha);
    expect(volani).toEqual(["https://chat.googleapis.com/v1/media/spaces/AAQAoP43WQk/messages/pDvoVmrrWfM.pDvoVmrrWfM/attachments/AATUf-ISRUoc7Y8MRI1Ocbtt6uvs?alt=media Bearer TOK"]);
    expect(c.typ).toBe("image/jpeg");
    expect(c.delka).toBe(8);
    expect(Buffer.concat(await c.proud.toArray()).toString()).toBe("JPEGDATA");
    const m = await stahniPrilohu(zav, mail.priloha);
    expect(Buffer.concat(await m.proud.toArray()).toString()).toBe("PDF 19a1b2c3 ANGjdJ8-abc_def");
    expect(m.typ).toBe("application/pdf");
  });

  it("uložení na Disk: nahrání proudu do složky, soubor z Disku se kopíruje", async () => {
    const vytvoreno: { name: string; parents: string[]; mime: string; obsah: string }[] = [];
    const kopie: { fileId: string; name: string; parents: string[] }[] = [];
    const drive = {
      files: {
        create: async (p: { requestBody: { name: string; parents: string[] }; media: { mimeType: string; body: NodeJS.ReadableStream & { toArray(): Promise<Buffer[]> } } }) => {
          vytvoreno.push({ name: p.requestBody.name, parents: p.requestBody.parents, mime: p.media.mimeType, obsah: Buffer.concat(await p.media.body.toArray()).toString() });
          return { data: { id: `F${vytvoreno.length}` } };
        },
        copy: async (p: { fileId: string; requestBody: { name: string; parents: string[] } }) => {
          kopie.push({ fileId: p.fileId, ...p.requestBody });
          return { data: { id: "K1" } };
        },
      },
    } as never;
    const zav = {
      gmail: async () => ({}) as never,
      chatToken: async () => "TOK",
      fetchFn: (async () => new Response(Buffer.from("JPEGDATA"), { status: 200, headers: { "content-type": "image/jpeg" } })) as typeof fetch,
    };
    expect(await ulozPrilohuNaDisk(zav, drive, "SLOZKA", foto)).toBe("F1");
    expect(vytvoreno).toEqual([{ name: "2026-11-04 Chat David Krechter – 15254.jpeg", parents: ["SLOZKA"], mime: "image/jpeg", obsah: "JPEGDATA" }]);
    const zDisku: VyberPrilohy = { priloha: { nazev: "video.mp4", typ: "video/mp4", velikost: null, odkaz: null, ref: { zdroj: "chat", driveId: "D9" } }, den: "2026-11-03", kdo: "Jan" };
    expect(await ulozPrilohuNaDisk(zav, drive, "SLOZKA", zDisku)).toBe("K1");
    expect(kopie).toEqual([{ fileId: "D9", name: "2026-11-03 Chat Jan – video.mp4", parents: ["SLOZKA"] }]);
  });
});
