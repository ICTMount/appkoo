// Vytěžení poznámek zakázky pomocí Claude (spec kap. 6).
// Výstup je strukturovaný (pevné schéma) a je to vždy jen NÁVRH – potvrzuje koordinátorka.
// Když Claude neodpoví nebo odmítne, volající použije deterministické vyhodnocení (pokusyZPoznamky).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Zakazka } from "../import/mwfExport.js";
import { fmtDate } from "../domain/time.js";
import { pseudonymizuj } from "./pseudonym.js";
import { vytvorKlienta, type ClaudeKlient } from "./client.js";

export const MODEL = "claude-opus-5-5";
/** Verze promptu – ukládá se k výsledku, aby šlo poznat, čím byl vyhodnocen */
export const PROMPT_VERZE = "2026-10-14.1";

const datum = z.string().describe("datum ve tvaru YYYY-MM-DD");

export const VytezeniSchema = z.object({
  stav: z.enum(["NOVA", "DOJEDNAVANI", "TERMIN", "PARKOVANO_DOD", "PARKOVANO_ZAK", "UZAVRENO"]),
  parkovani: z.enum(["odklad", "legislativa", "pocasi", "nedostupny"]).nullable(),
  kod: z.string().nullable().describe("poslední použitý kód: r_0 až r_4 nebo mv_N"),
  pocet_mv: z.number().int(),
  strana_priciny_mv: z.enum(["tmcz", "zakaznik"]).nullable().describe("jen po marném výjezdu"),
  pokusy: z.array(
    z.object({ datum, cas: z.string().describe("HH:MM"), dovolano: z.boolean(), sms: z.boolean() }),
  ),
  dalsi_kontakt: datum.nullable(),
  konec_jp: datum.nullable().describe("konec smlouvy u jiného poskytovatele"),
  zasuvka: z.enum(["FREE", "USED", "nova_instalace", "nezname"]),
  swap_fis: z.enum(["SWAP", "FIS_MOP", "zadny"]),
  caseid: z.string().nullable(),
  datum_portace: datum.nullable(),
  patro_byt: z.string().nullable(),
  preferovany_termin: datum.nullable().describe("termín přání zákazníka z poznámky prodejce"),
  pokyn_pep: z.string().nullable().describe("pokyn z poslední odpovědi PEP / T-Mobile"),
  blokace: z.array(z.string()).describe("důvody, proč teď NEPLÁNOVAT termín (zlatá pravidla)"),
  priorita: z.enum(["P1", "P2", "P3", "P0"]),
  dalsi_krok: z.string().describe("jedna věta: co má koordinátorka udělat"),
});
export type Vytezeni = z.infer<typeof VytezeniSchema>;

// Systémový prompt je neměnný (kvůli cache) – vše proměnné jde do zprávy uživatele.
const SYSTEM = `Jsi asistent koordinace instalací FTTH/PIV/SAT ve firmě Vegacom (instalační partner T-Mobile CZ).
Dostaneš poznámky jedné zakázky z MWF a vytěžíš z nich strukturovaný stav podle procesu koordinace.
Osobní údaje jsou nahrazené značkami ([ZÁKAZNÍK], [TEL_1], …) – nikdy je nedomýšlej.

PROCES DOJEDNÁVÁNÍ
- Kontakt: 2 pokusy denně s odstupem min. 4 h, 3 po sobě jdoucí pracovní dny (Po–Pá bez svátků), SMS typicky 1× denně. Volá se 8:00–19:00.
- Nepodaří se kontaktovat → parkování „Zákazník - nedostupný“ (ZAK), řeší PEP T-Mobile, odpověď PEP přijde novou poznámkou.
- Zápisy autorů bez „(Vegacom)“ jsou od PEP / T-Mobile.

KÓDY
r_0 nefunkční aplikace | r_1 zákazník | r_2 smlouva s jiným poskytovatelem (JP) | r_3 T-Mobile | r_4 kapacita Vegacom
mv_N = N-tý marný výjezd u zákazníka (mv_1, mv_2, mv_3 … po sobě až do instalace nebo storna).

PARKOVÁNÍ (MWF)
- odklad = „Zákazník - odklad termínu“ (DOD): zákazník žádá kontakt později; také MV z příčiny na straně zákazníka.
- legislativa = „Legislatívne problémy“ (DOD): MV nebo překážka na straně T-Mobile (předpis, přístup, infrastruktura) – kód r_3; také r_0 a r_4.
- pocasi = „Počasie“ (DOD): záfuky, PIV – kód r_3.
- nedostupny = „Zákazník - nedostupný“ (ZAK): nedostupný zákazník po 3 PD, nebo jiná situace vyžadující zásah T-Mobile.

ZLATÁ PRAVIDLA – do „blokace“ uveď každé, které brání naplánovat termín:
- zákazník má smlouvu s JP a výpověď není podaná / JP ještě neskončila
- zásuvka USED a čeká se na PEP
- neznámé patro / byt
- IRU bez potvrzeného data ukončení JP
- SWAP: instalace musí proběhnout do 7 dní od CASEID
- FIS MOP: termín až po datu portace
- adresa Praha Pravá 245/19 (CETIN blacklist) nebo Beroun Nepilova (VDF splitter) – neplánovat
- BYOD zakázka → předat DH/JT

PRIORITA
P1 volat dnes (nová bez hovoru, urgence, promeškaný datum kontaktu, MV k zavolání, nedovoláno 3+ dny)
P2 volat brzy (kontakt dnes/zítra, nedovoláno, rozjednáno)
P3 sledovat (kontakt do 4 dnů, čeká na PEP/CETIN/VDF déle než 7 dní)
P0 nevolat – čeká na jiné (kontakt později, čeká na PEP/CETIN/VDF, ozve se sám)

PRAVIDLA VÝSTUPU
- Relativní data („za 14 dní“, „v pátek“) přepočítej na konkrétní datum od data záznamu.
- Pokusy: jen pokusy o telefonický kontakt se zákazníkem od posledního zápisu PEP / T-Mobile.
- Co v poznámkách není, nech null / „nezname“. Nevymýšlej.`;

export interface VysledekVytezeni {
  vytezeni: Vytezeni | null;
  zdroj: "claude" | "nedostupne";
  model: string;
  promptVerze: string;
  chyba?: string;
}

export async function vytezPoznamky(
  zakazka: Zakazka,
  dnes: Date,
  { client, fallbacks }: ClaudeKlient = vytvorKlienta(),
): Promise<VysledekVytezeni> {
  const p = pseudonymizuj(zakazka.poznamka, zakazka.zakaznik);
  const kontext = [
    `Dnes je ${fmtDate(dnes)}.`,
    `Zakázka ${zakazka.idObjednavky || zakazka.idS7}: typ ${zakazka.typAktivity}, infrastruktura ${zakazka.infrastruktura}, ` +
      `obec/PSČ ${zakazka.psc}, stav MWF „${zakazka.stavMwf}“, parkování „${zakazka.parkovani ?? "–"}“, ` +
      `výsledek dojednávání „${zakazka.vysledek ?? "–"}“, termín ${zakazka.termin ? fmtDate(zakazka.termin.od) : "–"}.`,
  ].join("\n");

  const zaklad = { model: MODEL, promptVerze: PROMPT_VERZE };
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low", format: betaZodOutputFormat(VytezeniSchema) },
      messages: [{ role: "user", content: `${kontext}\n\nPoznámky z MWF:\n"""\n${p.text}\n"""` }],
    });

    if (response.stop_reason === "refusal") return { ...zaklad, vytezeni: null, zdroj: "nedostupne", chyba: "refusal" };
    if (response.stop_reason === "max_tokens") return { ...zaklad, vytezeni: null, zdroj: "nedostupne", chyba: "max_tokens" };
    const v = response.parsed_output;
    if (!v) return { ...zaklad, vytezeni: null, zdroj: "nedostupne", chyba: "neplatný výstup" };

    return {
      ...zaklad,
      zdroj: "claude",
      vytezeni: {
        ...v,
        dalsi_krok: p.obnov(v.dalsi_krok),
        pokyn_pep: v.pokyn_pep && p.obnov(v.pokyn_pep),
        blokace: v.blokace.map(p.obnov),
      },
    };
  } catch (error) {
    // Výpadek API nesmí zastavit import – zakázka se vyhodnotí deterministicky.
    if (error instanceof Anthropic.APIError) {
      return { ...zaklad, vytezeni: null, zdroj: "nedostupne", chyba: `API ${error.status}: ${error.message}` };
    }
    throw error;
  }
}
