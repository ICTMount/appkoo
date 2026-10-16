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
| Google Kalendář techniků | čtení a zápis jménem tmcz01 (delegace, rozsah `calendar.events`) | hotovo v kódu |

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

Pořadí kritérií (odpověď 16.10.): **zaplnit den** > SLA > km. Prázdný den technika má penalizaci 100 km,
každá zakázka, kterou už technik ten den má, slot zvýhodní o 6 km (nejvýš za 4 zakázky).

Aplikace **navrhne technika i slot**, koordinátorka vybere z nabídky, zavolá zákazníkovi, vyplní call script
a po potvrzení aplikace **přepíše slot VOLNY** na zakázku (patička SHEET2CAL zůstane). Termín pak koordinátorka
zapíše do MWF (aplikace připraví text „Zákazník: …“).

Stav: hotovo v kódu (`src/plan/planovac.ts`, `src/plan/sloty.ts`, stránka „Navrhnout termín“ u zakázky).

## 5. Plánování – režim B: slot → zakázky (doplnění technika)

Vidíme, že technik má na nejbližší den(y) v kalendáři málo zakázek. Koordinátorka **vybere time slot**
(technik + den + okno) a aplikace **doplní zakázky, které se do něj ideálně hodí** – opačný pohled k režimu A,
ze stejných zdrojů a podle stejných kritérií (trasa dne, SLA, priorita, zaplnění).

Postup v aplikaci: **Plánování** (horní lišta) → den → technici seřazení od nejméně vytížených → u volného
slotu „doplnit“ → seznam vhodných zakázek → „Vybrat“ → call script → zápis.

Kandidáti:
- otevřené zakázky **bez termínu**, které projdou branami (ZAK, smlouva s JP, blokovaná lokalita, adresa) a mají prioritu P1–P3,
- **už naplánované zakázky s poznámkou „flex“** (pozitivní – „flex“, „flexibilní“; „ne flex“, „není flex“ se nepočítá)
  v poznámce MWF nebo v události kalendáře, jen **přesun dopředu** (slot je dřív než současný termín).
  Po zápisu se původní událost vrátí na **VOLNY** (patička SHEET2CAL zůstane) a koordinátorka změní termín v MWF.
- dovednost technika (FTTH / PIV / SAT/TV) musí odpovídat typu zakázky.

Řazení: naléhavost SLA (prošlé +60, do 48 h +40, do 5 dní +20) a priorita (P1 +20, P2 +10), pak km navíc
oproti trase dne. Zajížďka nad **75 km** se nenabízí (limit se bude zpřesňovat).

Stav: hotovo v kódu (`src/plan/doplneni.ts`, `navrhyProSlot` v `src/plan/planovac.ts`, stránky `/planovani`).

## Rozhodnutí (16.10.2026)

1. Aplikace přepíše slot VOLNY v kalendáři po potvrzení koordinátorkou – **ano**.
2. Aplikace navrhne technika a slot, koordinátorka vybírá z nabídky – **ano**.
3. Režim B nabízí i naplánované zakázky s pozitivní poznámkou „flex“ (jdou přeplánovat) – **ano**.
4. Limit zajížďky 75 km na začátek, bude se zpřesňovat.
5. Pořadí kritérií: **zaplnit den** jako první.

## Zbývá

- Nahrání exportu MWF přímo v aplikaci.
- Fulltext přes všechna data (e-mail a chat ukládat do DB každých 15 min) – návrh, čeká na potvrzení.
