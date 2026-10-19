import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { MODEL, vytezPoznamky, type Vytezeni } from "../src/ai/noteExtraction.js";
import { local } from "../src/domain/time.js";
import type { Zakazka } from "../src/import/mwfExport.js";

const zakazka = {
  idObjednavky: "O-111111111",
  idS7: "1-AAA111",
  typAktivity: "CETIN_Inst_Pristupu_FTTH",
  infrastruktura: "CETIN",
  psc: "15000",
  stavMwf: "Riešená dodávateľom - akceptovaná",
  parkovani: null,
  vysledek: "Nezastihnutý",
  termin: null,
  zakaznik: "Nováková, Jana",
  telefony: ["777123456"],
  poznamka: "[Editácia] 14.10.2026 9:01, A (Vegacom): Nováková nezvedá, volat 777 123 456",
} as unknown as Zakazka;

const vytezeni: Vytezeni = {
  stav: "DOJEDNAVANI", parkovani: null, kod: null, pocet_mv: 0, strana_priciny_mv: null,
  pokusy: [{ datum: "2026-10-14", cas: "09:01", dovolano: false, sms: false }],
  dalsi_kontakt: null, konec_jp: null, zasuvka: "nezname", swap_fis: "zadny", caseid: null,
  datum_portace: null, patro_byt: null, preferovany_termin: null, pokyn_pep: null, blokace: [],
  priorita: "P2", dalsi_krok: "Zavolat znovu na [TEL_1] po 13:01.",
};

function fakeClient(odpoved: () => unknown) {
  const zadosti: any[] = [];
  const client = {
    beta: { messages: { parse: async (req: unknown) => (zadosti.push(req), odpoved()) } },
  } as unknown as Anthropic;
  return { client: { client, fallbacks: true }, zadosti };
}

describe("vytěžení poznámek přes Claude", () => {
  it("posílá pseudonymizovaný text, správný model a fallback; vrací obnovené údaje", async () => {
    const { client, zadosti } = fakeClient(() => ({ stop_reason: "end_turn", parsed_output: vytezeni }));
    const r = await vytezPoznamky(zakazka, local(2026, 10, 14, 18, 0), client);

    const req = zadosti[0];
    expect(req.model).toBe(MODEL);
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(JSON.stringify(req.messages)).not.toMatch(/Nováková|777/);
    expect(r.zdroj).toBe("claude");
    expect(r.vytezeni!.dalsi_krok).toBe("Zavolat znovu na 777 123 456 po 13:01.");
  });

  it("na Vertex AI neposílá fallbacks (tam nejsou)", async () => {
    const { client, zadosti } = fakeClient(() => ({ stop_reason: "end_turn", parsed_output: vytezeni }));
    await vytezPoznamky(zakazka, local(2026, 10, 14, 18, 0), { ...client, fallbacks: false });
    expect(zadosti[0].fallbacks).toBeUndefined();
    expect(zadosti[0].betas).toBeUndefined();
  });

  it("při odmítnutí vrací nedostupné (použije se vyhodnocení podle klíčových slov)", async () => {
    const { client } = fakeClient(() => ({ stop_reason: "refusal", parsed_output: null }));
    expect(await vytezPoznamky(zakazka, local(2026, 10, 14, 18, 0), client)).toMatchObject({
      zdroj: "nedostupne",
      chyba: "refusal",
    });
  });

  it("výpadek API nezastaví import", async () => {
    const { client } = fakeClient(() => {
      throw new Anthropic.APIError(529, undefined, "overloaded", new Headers());
    });
    const r = await vytezPoznamky(zakazka, local(2026, 10, 14, 18, 0), client);
    expect(r.zdroj).toBe("nedostupne");
    expect(r.chyba).toMatch(/529/);
  });
});

describe("Vertex AI adresa", () => {
  it("multi-region eu/us, global a konkrétní region", async () => {
    const { vertexAdresa } = await import("../src/ai/client.js");
    expect(vertexAdresa("eu")).toBe("https://aiplatform.eu.rep.googleapis.com/v1");
    expect(vertexAdresa("global")).toBe("https://aiplatform.googleapis.com/v1");
    expect(vertexAdresa("europe-west1")).toBe("https://europe-west1-aiplatform.googleapis.com/v1");
  });
});
