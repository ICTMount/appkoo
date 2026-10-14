// Fráze do MWF (spec kap. 3). Hlavičku záznamu ([Dojednávania] datum, autor) doplňuje MWF samo –
// aplikace připravuje jen text, který koordinátorka vloží.

import { fmtDate, type IsoDate } from "./time.js";
import type { Kod } from "./mwf.js";

export const fraze = {
  nezvedá: (sms: boolean) => (sms ? "zkz. nezvedá tlf., sms" : "zkz. nezvedá tlf."),

  odklad: (kontakt: IsoDate) => `na přání kontaktovat ${fmtDate(kontakt)} r_1`,

  smlouvaJp: (kontakt: IsoDate) =>
    `zkz. má smlouvu s JP, ověřuje si výpovědní dobu, přeje si kontaktovat ${fmtDate(kontakt)} r_2`,

  instalaceNaPrani: (den: IsoDate) => `na přání zákazníka instalace dne ${fmtDate(den)} r_1`,

  marnyVyjezd: (kody: Kod[], popis: string, kontakt?: IsoDate) =>
    [kody.join(" "), popis.trim(), kontakt ? `kontaktovat ${fmtDate(kontakt)}` : ""].filter(Boolean).join(" – "),

  /** Návrh pro ZAK „Zákazník - nedostupný“ – koordinátorka text vždy potvrdí (spec kap. 5) */
  zakNedostupny: (od: IsoDate, do_: IsoDate, pokusu: number, sms: number) =>
    `zkz. nedostupný, kontaktován dle pravidel 3 prac. dny (${fmtDate(od)}–${fmtDate(do_)}), ` +
    `${pokusu}× tlf.${sms ? `, ${sms}× sms` : ""} – prosíme o součinnost PEP`,
};
