// Rozklad pole „Poznámka“ z MWF na jednotlivé záznamy.
// Formát záznamu: "[Dojednávania] 2.7.2026 14:23, Šimon Taišl (Vegacom): text"

import { najdiKody, type Kod } from "../domain/mwf.js";
import type { Pokus } from "../domain/contact.js";
import { parseCzDateTime } from "../domain/time.js";

export interface Zaznam {
  typ: string; // Dojednávania | Editácia | Parkovanie | …
  at: Date;
  autor: string;
  /** zápis někoho z Vegacomu (koordinátorka nebo technik) */
  vegacom: boolean;
  text: string;
  kody: Kod[];
}

const HLAVICKA = /\[([^\]\n]{2,40})\] (\d{1,2}\.\d{1,2}\.\d{4} \d{1,2}:\d{2}), ([^:\n]{2,80}?): /g;

export function rozlozPoznamku(poznamka: string): { uvod: string; zaznamy: Zaznam[] } {
  const hlavicky = [...poznamka.matchAll(HLAVICKA)];
  const zaznamy: Zaznam[] = [];
  hlavicky.forEach((m, i) => {
    const at = parseCzDateTime(m[2]!);
    if (!at) return;
    const start = m.index! + m[0].length;
    const end = hlavicky[i + 1]?.index ?? poznamka.length;
    const text = poznamka.slice(start, end).trim();
    const autor = m[3]!.trim();
    zaznamy.push({ typ: m[1]!, at, autor, vegacom: /\(Vegacom\)/i.test(autor), text, kody: najdiKody(text) });
  });
  return { uvod: poznamka.slice(0, hlavicky[0]?.index ?? poznamka.length).trim(), zaznamy };
}

const NEDOVOLANO = /nezved|nedovol|nezasti|nebere|nedostupn|mimo provoz|vytípnut|bez reakce/i;
const DOVOLANO = /spojeno|dovoláno|domluven|dohodnut|na přání|na žádost|potvrzuje|souhlasí|^Zákazník: .+\(\d/i;

/**
 * Pokusy o kontakt odvozené ze záznamů koordinace (deterministicky, bez AI).
 * Počítají se jen zápisy Vegacomu po poslední reakci mimo Vegacom (typicky PEP) –
 * odpověď PEP vrací zakázku do dojednávání a nuluje počítadlo (spec kap. 2, bod 7).
 */
export function pokusyZPoznamky(zaznamy: Zaznam[]): Pokus[] {
  const posledniCizi = zaznamy.findLastIndex((z) => !z.vegacom);
  return zaznamy
    .slice(posledniCizi + 1)
    .filter((z) => z.typ === "Dojednávania" || z.typ === "Editácia")
    .flatMap((z): Pokus[] => {
      if (NEDOVOLANO.test(z.text)) return [{ at: z.at, dovolano: false, sms: /\bsms\b/i.test(z.text) }];
      if (DOVOLANO.test(z.text)) return [{ at: z.at, dovolano: true, sms: false }];
      return [];
    });
}
