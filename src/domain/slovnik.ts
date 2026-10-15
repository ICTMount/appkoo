// Slovník MWF (slovensky) ↔ aplikace (česky).
// Pravidlo: aplikace mluví česky. Kde koordinátorka musí stejnou věc najít nebo vybrat v MWF
// (tlačítko, sloupec, hodnota číselníku), ukazuje aplikace vedle českého názvu i přesný
// slovenský název z MWF („v MWF: …“). Hodnoty číselníků, které se v MWF vybírají
// (parkování, výsledek dojednávání), zůstávají v přesném znění MWF.

export type Oblast = "objekt" | "stav" | "akce" | "zalozka" | "pole" | "hodnota";

export interface Pojem {
  mwf: string;
  cz: string;
  oblast: Oblast;
  popis?: string;
}

export const SLOVNIK: Pojem[] = [
  // Objekty
  { oblast: "objekt", mwf: "Aktivita", cz: "Zakázka", popis: "jedna práce u zákazníka; v aplikaci vždy „zakázka“" },
  { oblast: "objekt", mwf: "Objednávka", cz: "Objednávka", popis: "obchodní objednávka T-Mobile (O-…)" },
  { oblast: "objekt", mwf: "Pracovný zdroj", cz: "Řešitel", popis: "koordinátorka nebo technik, na kterém zakázka leží" },
  { oblast: "objekt", mwf: "Dodávateľ", cz: "Dodavatel", popis: "Vegacom (7121)" },
  { oblast: "objekt", mwf: "Pracovisko", cz: "Pracoviště", popis: "CZ_INPA_Vegacom_D" },
  { oblast: "objekt", mwf: "Subregión", cz: "Subregion", popis: "např. CZ_V_PHA_2002 – podle něj se určí region" },
  { oblast: "objekt", mwf: "Požadované schopnosti", cz: "Požadované dovednosti", popis: "např. PRIP_GPON, Spolupraca" },
  { oblast: "objekt", mwf: "Vlastník siete", cz: "Vlastník sítě", popis: "TMCZ / CETIN / VODAFONE" },

  // Stavy aktivity
  { oblast: "stav", mwf: "Riešená dodávateľom - odovzdaná", cz: "Předaná Vegacomu", popis: "čeká na dojednání termínu" },
  { oblast: "stav", mwf: "Riešená dodávateľom - akceptovaná", cz: "Přijatá", popis: "převzatá, většinou s dohodnutým termínem" },
  { oblast: "stav", mwf: "Riešená dodávateľom - v realizácii", cz: "V realizaci", popis: "technik na místě" },
  { oblast: "stav", mwf: "Zaparkovaná", cz: "Zaparkovaná" },
  { oblast: "stav", mwf: "Ručne potvrdená", cz: "Ručně potvrzená" },
  { oblast: "stav", mwf: "Vyriešená", cz: "Vyřešená", popis: "uzavřená technikem" },

  // Akce (tlačítka v MWF)
  { oblast: "akce", mwf: "Výsledok zjednávania", cz: "Výsledek dojednávání" },
  { oblast: "akce", mwf: "Zapísať dohodnutý termín", cz: "Zapsat dohodnutý termín" },
  { oblast: "akce", mwf: "História zjednávania / parkovanie", cz: "Historie dojednávání a parkování" },
  { oblast: "akce", mwf: "Odparkovať", cz: "Odparkovat" },
  { oblast: "akce", mwf: "Odovzdanie aktivít", cz: "Předání zakázek", popis: "přesun na jiného řešitele" },
  { oblast: "akce", mwf: "Poznámky EXT / PAW", cz: "Poznámky" },
  { oblast: "akce", mwf: "Fotodokumentácia", cz: "Fotodokumentace" },
  { oblast: "akce", mwf: "Vyriešiť", cz: "Vyřešit", popis: "uzavření / storno (Závěrečný protokol)" },
  { oblast: "akce", mwf: "Export aktivity", cz: "Export zakázek", popis: "zdroj importu do aplikace (CSV)" },

  // Záložky detailu
  { oblast: "zalozka", mwf: "Detail aktivity", cz: "Detail zakázky" },
  { oblast: "zalozka", mwf: "Záverečný protokol", cz: "Závěrečný protokol" },
  { oblast: "zalozka", mwf: "Pripojené súbory", cz: "Přílohy" },
  { oblast: "zalozka", mwf: "Evidencia rozsahu práce", cz: "Rozsah práce" },
  { oblast: "zalozka", mwf: "História stavov aktivít", cz: "Historie stavů" },
  { oblast: "zalozka", mwf: "Nadväzné aktivity - závislosť aktivít", cz: "Navazující zakázky" },
  { oblast: "zalozka", mwf: "Výpis telefónnych hovorov", cz: "Výpis hovorů" },

  // Pole a sloupce
  { oblast: "pole", mwf: "ID aktivity", cz: "ID zakázky (MWF)" },
  { oblast: "pole", mwf: "ID objednávky", cz: "Číslo objednávky (MWF)", popis: "interní číslo, např. 21892159" },
  { oblast: "pole", mwf: "ID obj. v ext. systéme", cz: "Číslo objednávky O-", popis: "hlavní identifikátor v aplikaci" },
  { oblast: "pole", mwf: "ID S7 obj.", cz: "ID S7" },
  { oblast: "pole", mwf: "Zjednané", cz: "Termín od prodejce", popis: "Áno = rezervační termín zadal prodejce, nedojednává se" },
  { oblast: "pole", mwf: "Časový typ", cz: "Typ termínu", popis: "Rezervačná = s rezervací termínu" },
  { oblast: "pole", mwf: "Časová náročnosť", cz: "Délka práce", popis: "např. 1h,50m – použije plánovač" },
  { oblast: "pole", mwf: "Dohodnutý termín", cz: "Dohodnutý termín" },
  { oblast: "pole", mwf: "Čas postúpenia dod.", cz: "Přiděleno Vegacomu" },
  { oblast: "pole", mwf: "Pož. realizácia", cz: "Požadovaná realizace" },
  { oblast: "pole", mwf: "LT ST (Dátum realizácie)", cz: "Termín realizace (SLA)" },
  { oblast: "pole", mwf: "Do splnění", cz: "Zbývá do SLA" },
  { oblast: "pole", mwf: "Dátum RFS", cz: "Datum RFS" },
  { oblast: "pole", mwf: "Dátum ukončenia obj.", cz: "Datum ukončení objednávky" },
  { oblast: "pole", mwf: "Dôvod parkovania", cz: "Důvod parkování" },
  { oblast: "pole", mwf: "Posledný dôvod parkovania", cz: "Poslední důvod parkování" },
  { oblast: "pole", mwf: "Výsledok dojednávania", cz: "Výsledek dojednávání" },
  { oblast: "pole", mwf: "Preferovaný dátum", cz: "Termín přání zákazníka" },
  { oblast: "pole", mwf: "Prvý možný termín", cz: "První možný termín" },
  { oblast: "pole", mwf: "Prvý ponúknutý termín", cz: "První nabídnutý termín" },
  { oblast: "pole", mwf: "Blokácia", cz: "Blokace" },
  { oblast: "pole", mwf: "P3: Typ balíka", cz: "Typ balíčku" },
  { oblast: "pole", mwf: "Partner ID obj.", cz: "Partner ID" },
  { oblast: "pole", mwf: "Service ID", cz: "Service ID" },

  // Hodnoty
  { oblast: "hodnota", mwf: "Zákazník - odklad termínu", cz: "Zákazník – odklad termínu" },
  { oblast: "hodnota", mwf: "Legislatívne problémy", cz: "Legislativní problémy" },
  { oblast: "hodnota", mwf: "Počasie", cz: "Počasí" },
  { oblast: "hodnota", mwf: "Zákazník - nedostupný", cz: "Zákazník – nedostupný" },
  { oblast: "hodnota", mwf: "Nezastihnutý", cz: "Nezastižen" },
  { oblast: "hodnota", mwf: "Márny výjazd", cz: "Marný výjezd" },
  { oblast: "hodnota", mwf: "Chybný kontakt", cz: "Chybný kontakt" },
];

const podleMwf = new Map(SLOVNIK.map((p) => [p.mwf, p]));

/** Český název pro hodnotu z MWF; neznámou hodnotu vrátí beze změny */
export function cesky(mwf: string): string {
  return podleMwf.get(mwf)?.cz ?? mwf;
}

/** Popisek do aplikace: „Legislativní problémy (v MWF: Legislatívne problémy)“ – jen když se liší */
export function sMwf(mwf: string): string {
  const cz = cesky(mwf);
  return cz === mwf ? cz : `${cz} (v MWF: ${mwf})`;
}

/**
 * Číslo objednávky pro párování. V MWF bývá s příponou: "O-8532577900:1",
 * "O-8541450094-13075814", v detailu "O-8538322609:1-D6OZZL8#1-D6P0P85".
 */
export function zakladniCisloObjednavky(id: string): string {
  return id.trim().match(/^O-\d+/i)?.[0].toUpperCase() ?? id.trim();
}
