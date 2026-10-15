# Slovník MWF ↔ aplikace

MWF je slovensky, aplikace česky. Kde koordinátorka musí stejnou věc najít nebo vybrat v MWF,
aplikace ukáže vedle českého názvu i přesné znění z MWF („v MWF: …“). Hodnoty, které se v MWF
vybírají (parkování, výsledek dojednávání), se do MWF zapisují vždy v přesném slovenském znění.

Soubor je generovaný příkazem `npm run slovnik` ze `src/domain/slovnik.ts` – needitovat ručně.

## Objekty

| MWF (SK) | Aplikace (CZ) | Poznámka |
|---|---|---|
| Aktivita | Zakázka | jedna práce u zákazníka; v aplikaci vždy „zakázka“ |
| Objednávka | Objednávka | obchodní objednávka T-Mobile (O-…) |
| Pracovný zdroj | Řešitel | koordinátorka nebo technik, na kterém zakázka leží |
| Dodávateľ | Dodavatel | Vegacom (7121) |
| Pracovisko | Pracoviště | CZ_INPA_Vegacom_D |
| Subregión | Subregion | např. CZ_V_PHA_2002 – podle něj se určí region |
| Požadované schopnosti | Požadované dovednosti | např. PRIP_GPON, Spolupraca |
| Vlastník siete | Vlastník sítě | TMCZ / CETIN / VODAFONE |

## Stavy zakázky

| MWF (SK) | Aplikace (CZ) | Poznámka |
|---|---|---|
| Riešená dodávateľom - odovzdaná | Předaná Vegacomu | čeká na dojednání termínu |
| Riešená dodávateľom - akceptovaná | Přijatá | převzatá, většinou s dohodnutým termínem |
| Riešená dodávateľom - v realizácii | V realizaci | technik na místě |
| Zaparkovaná | Zaparkovaná |  |
| Ručne potvrdená | Ručně potvrzená |  |
| Vyriešená | Vyřešená | uzavřená technikem |

## Akce (tlačítka v MWF)

| MWF (SK) | Aplikace (CZ) | Poznámka |
|---|---|---|
| Výsledok zjednávania | Výsledek dojednávání |  |
| Zapísať dohodnutý termín | Zapsat dohodnutý termín |  |
| História zjednávania / parkovanie | Historie dojednávání a parkování |  |
| Odparkovať | Odparkovat |  |
| Odovzdanie aktivít | Předání zakázek | přesun na jiného řešitele |
| Poznámky EXT / PAW | Poznámky |  |
| Fotodokumentácia | Fotodokumentace |  |
| Vyriešiť | Vyřešit | uzavření / storno (Závěrečný protokol) |
| Export aktivity | Export zakázek | zdroj importu do aplikace (CSV) |

## Záložky detailu

| MWF (SK) | Aplikace (CZ) | Poznámka |
|---|---|---|
| Detail aktivity | Detail zakázky |  |
| Záverečný protokol | Závěrečný protokol |  |
| Pripojené súbory | Přílohy |  |
| Evidencia rozsahu práce | Rozsah práce |  |
| História stavov aktivít | Historie stavů |  |
| Nadväzné aktivity - závislosť aktivít | Navazující zakázky |  |
| Výpis telefónnych hovorov | Výpis hovorů |  |

## Pole a sloupce

| MWF (SK) | Aplikace (CZ) | Poznámka |
|---|---|---|
| ID aktivity | ID zakázky (MWF) |  |
| ID objednávky | Číslo objednávky (MWF) | interní číslo, např. 21892159 |
| ID obj. v ext. systéme | Číslo objednávky O- | hlavní identifikátor v aplikaci |
| ID S7 obj. | ID S7 |  |
| Zjednané | Termín od prodejce | Áno = rezervační termín zadal prodejce, nedojednává se |
| Časový typ | Typ termínu | Rezervačná = s rezervací termínu |
| Časová náročnosť | Délka práce | např. 1h,50m – použije plánovač |
| Dohodnutý termín | Dohodnutý termín |  |
| Čas postúpenia dod. | Přiděleno Vegacomu |  |
| Pož. realizácia | Požadovaná realizace |  |
| LT ST (Dátum realizácie) | Termín realizace (SLA) |  |
| Do splnění | Zbývá do SLA |  |
| Dátum RFS | Datum RFS |  |
| Dátum ukončenia obj. | Datum ukončení objednávky |  |
| Dôvod parkovania | Důvod parkování |  |
| Posledný dôvod parkovania | Poslední důvod parkování |  |
| Výsledok dojednávania | Výsledek dojednávání |  |
| Preferovaný dátum | Termín přání zákazníka |  |
| Prvý možný termín | První možný termín |  |
| Prvý ponúknutý termín | První nabídnutý termín |  |
| Blokácia | Blokace |  |
| P3: Typ balíka | Typ balíčku |  |
| Partner ID obj. | Partner ID |  |
| Service ID | Service ID |  |

## Hodnoty číselníků

| MWF (SK) | Aplikace (CZ) | Poznámka |
|---|---|---|
| Zákazník - odklad termínu | Zákazník – odklad termínu |  |
| Legislatívne problémy | Legislativní problémy |  |
| Počasie | Počasí |  |
| Zákazník - nedostupný | Zákazník – nedostupný |  |
| Nezastihnutý | Nezastižen |  |
| Márny výjazd | Marný výjezd |  |
| Chybný kontakt | Chybný kontakt |  |
