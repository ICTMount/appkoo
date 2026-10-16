# Fáze 1 – zadání

Verze: 16.10.2026 · podle zadání vedoucího koordinace

**Cíl:** nástroj, který koordinátorkám výrazně zjednoduší plánování. Na jednom místě vidí všechno o zakázce
a aplikace jim navrhne, kam zakázku umístit (nebo čím doplnit kalendář technika).

## 1. Zdroje dat (napojení)

| Zdroj | Jak se dostane do aplikace | Stav |
|---|---|---|
| Export MWF (CSV) | 3 cesty: složka na Google Drive, e-mail na schránku, nahrání přímo v aplikaci | Drive hotovo a běží (každých 15 min); e-mail hotovo v kódu (čeká na delegaci); **nahrání v aplikaci chybí** |
| E-mail (schránka koordinace) | čtení jménem tmcz01 (delegace) | hotovo v kódu – hledá se živě v Gmailu |
| Google Chat | čtení jménem tmcz01 (delegace), vybrané prostory | hotovo v kódu – hledá se živě |
| Google Kalendář techniků | čtení (a pro plánování zápis) jménem tmcz01 | čtení hotovo v kódu |

## 2. Hledání (horní lišta)

- Jedno pole nahoře na každé stránce.
- Hledá se podle: všech ID zakázky (O-ID, S7, ID aktivity), telefonu, adresy – a ideálně **fulltextově přes všechna data**
  (poznámky MWF, e-maily, chat, kalendář).
- Najde-li jednu zakázku → rovnou její přehled; jinak seznam shod.

## 3. Přehled zakázky (jedna obrazovka)

Jedna velká stránka, uvnitř samostatné sekce (menší okna):

| Sekce | Obsah | Stav |
|---|---|---|
| Stav zakázky (MWF) | stav, parkování, termín, SLA, priorita, kontaktování | hotovo |
| Poznámky a historie MWF | záznamy poznámky, změny mezi exporty | hotovo |
| Kalendář | události zakázky u techniků (minulé i budoucí) | hotovo v kódu |
| E-mailová korespondence | zprávy k zakázce | hotovo v kódu |
| Google Chat | zprávy k zakázce + odpovědi ve vlákně | hotovo v kódu |

## 4. Plánování – režim A: zakázka → slot

Koordinátorka zadá **jednu konkrétní zakázku**. Aplikace nabídne **ideální umístění**:
- s ohledem na **SLA**,
- na **trasu technika** (problém obchodního cestujícího – co nejméně km navíc, návaznost na sousední zakázky),
- na **zaplnění kalendáře** (doplnit rozpracované dny, ne otevírat prázdné),
- zdroj: export MWF (zakázky, adresy, SLA) **spárovaný** s Google Kalendářem (volné sloty VOLNY, naplánované zakázky).

Stav: výpočet hotový v kódu (`src/plan/planovac.ts`), čeká na upřesnění detailů a čtení kalendářů přes delegaci.

## 5. Plánování – režim B: slot → zakázky (doplnění technika)

Vidíme, že technik má na nejbližší den(y) v kalendáři málo zakázek. Koordinátorka **vybere time slot**
(technik + den + okno) a aplikace **doplní zakázky, které se do něj ideálně hodí** – opačný pohled k režimu A,
ze stejných zdrojů a podle stejných kritérií (trasa dne, SLA, priorita, zaplnění).

Stav: připravuje se.

## Otevřené otázky

Viz konverzace 16.10.2026 – doplní se sem s odpověďmi.
