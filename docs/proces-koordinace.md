# Cesta zakázky koordinací – specifikace pro plánovací aplikaci

Verze: 0.1 · 14.10.2026 · stav: body 1–6 vyjasněné, předpoklady 7–8 k potvrzení

Tento dokument popisuje, jak koordinátorka vede zakázku od příchodu z MWF po termín
nebo zaparkování. Je to podklad pro frontu k volání, počítadlo pokusů o kontakt,
tlačítka s frázemi do MWF a schéma, podle kterého Claude vytěžuje poznámky.

MWF zůstává hlavní evidencí. Aplikace jen navrhuje a připravuje text, zápis do MWF
dělá koordinátorka.

---

## 1. Stavy zakázky

```
NOVÁ ──► DOJEDNÁVÁNÍ ──dovoláno──► TERMÍN ──► INSTALACE OK (uzavřeno)
           │    ▲                    │
           │    │                    └─► marný výjezd ──► mv_N ──► PARKOVÁNO (DOD) podle příčiny:
           │    │                        (mv_1, mv_2, mv_3 …          ├ strana TMCZ → Legislatívne problémy
           │    │                         se číslují po sobě         └ strana zákazníka → Zákazník - odklad termínu
           │    │                         až do uzavření)              └─► opětovné dojednání termínu
           │    │
           │    │   Uzavřít lze jen dvěma způsoby: INSTALACE OK, nebo STORNO.
           │    │
           │    └── v den příštího kontaktu ◄── PARKOVÁNO (DOD)
           │                                    ├ Zákazník - odklad termínu
           │                                    ├ Legislatívne problémy (po MV technika)
           │                                    └ Počasie
           │
           └─ 6 neúspěšných pokusů (3 pracovní dny × 2) ──► PARKOVÁNO (ZAK) Zákazník - nedostupný
                                                             → řeší PEP T-Mobile
                                                             → odpověď PEP = nová poznámka v MWF
                                                             → zpět do DOJEDNÁVÁNÍ
```

| Stav | Význam | Ve frontě k volání |
|---|---|---|
| NOVÁ | přišla z MWF, ještě bez kontaktu | ano, nejvyšší priorita |
| DOJEDNÁVÁNÍ | probíhají pokusy o kontakt | ano, když je pokus na řadě |
| TERMÍN | dohodnutý termín instalace | ne (hlídá se shoda MWF ↔ GCal) |
| PARKOVÁNO DOD | parkuje Vegacom (dodavatel), datum dalšího kontaktu je známé | až v den dalšího kontaktu |
| PARKOVÁNO ZAK | situace, kterou Vegacom nevyřeší a potřebuje zásah zadavatele (T-Mobile); typicky nedostupný zákazník. Řeší PEP | ne – čeká na novou poznámku od PEP |

## 2. Pravidlo kontaktování (dojednání termínu)

- **2 pokusy denně** s odstupem **minimálně 4 hodin**.
- **3 po sobě jdoucí pracovní dny** (Po–Pá). Víkend se nepočítá a nepřerušuje řadu.
  Státní svátky se berou jako nepracovní dny (předpoklad, viz kap. 8).
- **SMS** se posílá podle situace, **typicky jednou denně**, po prvním nedovolaném pokusu dne.
- Závazné minimum podle normy TMCZ R-280-244 (kap. 9): **min. 3 pokusy během 3 PD s rozestupem 4 h**
  a **min. 2 SMS během 3 PD s odstupem min. 18 h, jen v čase 8:00–22:00**. Interní pravidlo
  (6 pokusů) je přísnější, aplikace ale musí hlídat hlavně odstup SMS 18 h.
- **Nepodaří se kontaktovat** (6 neúspěšných pokusů) → **parkujeme** jako
  *Zákazník - nedostupný (ZAK)*. Ticket řeší PEP T-Mobile a odpověď (další postup)
  vrátí formou nové poznámky v MWF.

### Chování aplikace

0. Před prvním voláním aplikace zkontroluje, jestli zakázka nemá **rezervační termín od prodejce**
   (MWF „Zjednané = Áno“) – ten platí a zakázka jde rovnou na technika. Dále ukáže **Poznámku
   EXT/PAW** a sloupec **Preferovaný dátum**, kde může být termín přání zákazníka od prodejce.
1. Koordinátorka zapíše výsledek hovoru jedním klikem: **Nedovoláno** nebo **Dovoláno**.
2. Po **Nedovoláno** aplikace:
   - uloží čas pokusu,
   - u prvního nedovolaného pokusu dne nabídne frázi se SMS (`zkz. nezvedá tlf., sms`)
     a připomene odeslat SMS; u druhého pokusu nabídne frázi bez SMS
     (`zkz. nezvedá tlf.`). Koordinátorka může SMS zapnout nebo vypnout ručně,
   - SMS nenabídne dřív než 18 h od předchozí SMS (např. Po 16:00 → Út nejdřív 10:00)
     a upozorní, když by do konce 3. PD nebyly odeslané alespoň 2 SMS,
   - naplánuje další pokus za 4 hodiny. Když by vyšel po konci pracovní doby,
     přesune ho na další pracovní den ráno.
3. Ve frontě je u zakázky vidět stav, např. `den 2/3 · pokus 1/2 · další pokus 14:10`.
   Fronta se řadí podle toho, kdy je pokus na řadě.
4. Aby se 2 pokusy denně stihly, musí první pokus proběhnout nejpozději
   **4 hodiny před koncem pracovní doby** (při konci v 17:00 tedy do 13:00).
   Aplikace u zakázek, které na to nestihnou, zobrazí upozornění.
5. Po **6. neúspěšném pokusu** aplikace navrhne parkování *Zákazník - nedostupný (ZAK)*
   a připraví zápis. Zakázka se přesune do skupiny „čeká na PEP – nevolat“.
6. Pokusy zapsané do MWF mimo aplikaci se po importu dopočítají z poznámek
   (Claude spočítá zápisy „nezvedá“ podle data). Počítadlo tak sedí, i když
   koordinátorka volá bez aplikace.
7. Když PEP vrátí odpověď novou poznámkou, Claude z ní vytáhne pokyn a další krok.
   Zakázka se vrátí do DOJEDNÁVÁNÍ a počítadlo pokusů se vynuluje.
8. Při **Dovoláno** koordinátorka vybere výsledek: termín, odklad, smlouva s JP,
   nebo jiná překážka (kap. 3).

### 2.1 SWAP migrace a FIS MOP – součást dojednávání

Koordinátorka je řeší **ještě před dohodnutím termínu se zákazníkem**. Aplikace proto u zakázky
se zásuvkou USED nenabídne termín, dokud nejsou splněné podmínky:

| Typ | Kdy | Postup koordinátorky před termínem | Podmínka pro termín |
|---|---|---|---|
| **SWAP migrace** | v bytě optika CETIN a na ní DSL T-Mobile | 1. ověřit v ticketu Servisní požadavek (SP); 2. SP je → zavolat Hnízdilovou (603 602 634, 8–16:30) a vyžádat **CASEID**; 3. SP chybí → objednávku upravit / založit novou přes **storno linku** (8–18) a nové O- číslo hned řešit s PEP (8–17) k přidělení; 4. CASEID zapsat do MWF a do události v GCal | instalace **nejpozději do 7 dní od vygenerování CASEID** – jinak se stará služba zruší a zákazník zůstane bez internetu |
| **FIS MOP** | v bytě optika CETIN a na ní služba O2 (nebo spřízněný dodavatel) | CASEID a datum portace jsou v ticketu; zapsat do MWF a GCal | termín **až po datu portace** |

Aplikace u SWAP odpočítává 7 dní od CASEID a v plánovači nabídne jen sloty v tomto okně.
U FIS MOP nabídne jen sloty po datu portace.

## 3. Fráze do MWF

Datum se zapisuje jako `DD.MM.RRRR`. Koordinátorka ho vybere v kalendáři, nebo ho
Claude dopočítá z volného textu („za 14 dní“, „příští pátek“). Datum je u odkladu
povinné – bez něj chybí další krok.

| Situace | Fráze | Kód | Parkování v MWF | Co udělá aplikace |
|---|---|---|---|---|
| Nedovoláno (1. pokus dne) | `zkz. nezvedá tlf., sms` | – | do 6. pokusu ne | další pokus za 4 h |
| Nedovoláno (2. pokus dne) | `zkz. nezvedá tlf.` | – | do 6. pokusu ne | další pokus další pracovní den |
| Odklad na přání zákazníka | `na přání/na žádost kontaktovat DD.MM.RRRR` | r_1 | Zákazník - odklad termínu (DOD) | vrátí zakázku do fronty v daný den |
| Smlouva s jiným poskytovatelem | `zkz. má smlouvu s JP, ověřuje si výpovědní dobu, přeje si kontaktovat DD.MM.RRRR` | r_2 | Zákazník - odklad termínu (DOD) | do daného data **zablokuje plánování termínu** |
| Pozdější termín na přání zákazníka | `na přání zákazníka instalace dne DD.MM.RRRR r_1` | r_1 | – (je to termín) | zapíše termín, překročení SLA zdůvodní kódem r_1 |
| Marný výjezd – příčina na straně TMCZ (operátor, infrastruktura, předpis, přístup) | volný text | mv_N + r_3 | Legislatívne problémy (DOD) | nabídne další číslo v řadě (mv_1 → mv_2 → mv_3 …), doplní r_3 a vrátí zakázku k opětovnému dojednání |
| Marný výjezd – příčina na straně zákazníka (nepřipravená trasa, zásuvka, polička…) | volný text + `kontaktovat DD.MM.RRRR` | mv_N + r_1 (k potvrzení, kap. 9.4 A) | Zákazník - odklad termínu (DOD) | nabídne další číslo v řadě, vrátí zakázku do fronty v den dalšího kontaktu |
| Počasí (záfuky, PIV) | volný text | r_3 | Počasie (DOD) | vrátí zakázku do fronty v daný den |
| 3 pracovní dny nedovoláno | popis důvodu – návrh: `zkz. nedostupný, kontaktován dle pravidel 3 prac. dny (DD.MM.–DD.MM.RRRR), 6× tlf., sms – prosíme o součinnost PEP` | r_1 | Zákazník - nedostupný (ZAK) | přesun do „čeká na PEP“ |
| Jiná situace, kterou nevyřešíme bez T-Mobile | volný popis důvodu (co se stalo, co jsme zkusili, co potřebujeme od TMCZ) | podle situace | Zákazník - nedostupný (ZAK) | přesun do „čeká na PEP“ |
| Nefunkční aplikace | volný text | r_0 | Legislatívne problémy (DOD) | vrátí zakázku do fronty v den dalšího kontaktu |
| Kapacita Vegacom | volný text | r_4 | Legislatívne problémy (DOD) | vrátí zakázku do fronty v den dalšího kontaktu |

## 4. Kódy důvodů

| Kód | Význam |
|---|---|
| r_0 | nefunkční aplikace |
| r_1 | zákazník |
| r_2 | zákazník – smlouva s jiným poskytovatelem (JP) |
| r_3 | T-Mobile |
| r_4 | kapacita Vegacom |
| mv_1 | první marný výjezd u zákazníka |
| mv_2 | druhý marný výjezd u stejného zákazníka (musí mu předcházet mv_1) |
| mv_N | další marné výjezdy; číslují se po sobě, dokud se zakázka neuzavře (instalace, nebo storno) |

Po každém marném výjezdu (mv_N) následuje parkování podle příčiny – strana TMCZ →
*Legislatívne problémy (DOD)*, strana zákazníka → *Zákazník - odklad termínu (DOD)* – a opětovné
dojednání termínu. Řada mv pokračuje, dokud zakázka neskončí instalací, nebo stornem.

> Pozor: dashboard v4.3 (`mvEval`) má mv_1 / mv_2 jako „marný výjezd kvůli zákazníkovi /
> kvůli infrastruktuře“ a nezná r_0. Platí tato tabulka.

## 5. Parkování v MWF

Podle tabulky koordinace (14.10.2026). Vegacom používá jen tyto čtyři druhy parkování,
rozdělené do dvou skupin: DOD (parkuje dodavatel – Vegacom) a ZAK (zákazník, řeší PEP).
MWF umožňuje i *Materiál*, *Zákazník - termín - rieši dodávateľ* a *Zákazník - termín - rieši BO* –
ty se nepoužívají; aplikace je nenabízí, jen je při importu rozpozná a označí (kap. 9.4 C).

| Parkování v MWF | Skupina | Kdy | Následný krok |
|---|---|---|---|
| Zákazník - odklad termínu | DOD | zákazníkovi jsme se dovolali a žádá o kontaktování později | kontaktuji následně, dle požadavku zákazníka |
| Legislatívne problémy | DOD | po MV technika; také při nefunkční aplikaci (r_0) a nedostatečné kapacitě Vegacom (r_4) | po MV, nebo instalace před, kde je překážka k naplánování termínu ze strany TMCZ (nesedí předpis, není přístup atp.) |
| Počasie | DOD | záfuky, PIV, etc. | čekáme na změnu podmínek a opět plánujeme |
| Zákazník - nedostupný | ZAK | zákazník je nedostupný, byl kontaktován dle pravidel, tj. 3 (pracovní) dny po sobě; obecně každá situace, kterou nejsme schopni vyřešit a potřebuje zásah zadavatele (T-Mobile) | řeší PEP |

U parkování ZAK se nepoužívá pevná fráze. Do zápisu se popíše důvod parkování: co se stalo,
co Vegacom zkusil a co potřebuje od T-Mobile. Aplikace pro nedostupného zákazníka předvyplní
návrh z historie pokusů (data a počet) a u jiných situací může návrh popisu připravit Claude
z poznámek zakázky. Text vždy potvrdí koordinátorka.

## 6. Co z poznámek vytěžuje Claude

Po každém importu, jen u zakázek se změněnými poznámkami. Odpověď je ve strukturovaném
výstupu (pevné schéma), výsledek je vždy návrh, který potvrzuje koordinátorka.

| Pole | Typ | Popis |
|---|---|---|
| `stav` | NOVÁ / DOJEDNÁVÁNÍ / TERMÍN / PARKOVÁNO_DOD / PARKOVÁNO_ZAK | odhad stavu z poznámek |
| `parkovani` | odklad / legislativa / pocasi / nedostupny / null | druh parkování |
| `kod` | r_0 … r_4 / mv_N / null | poslední použitý kód |
| `pocet_mv` | číslo | kolik marných výjezdů už zakázka měla (podle mv_N v poznámkách) |
| `pokusy` | seznam {datum, čas, výsledek, sms} | pokusy o kontakt z poznámek |
| `dalsi_kontakt` | datum / null | datum dalšího kontaktu |
| `konec_JP` | datum / null | konec smlouvy s jiným poskytovatelem |
| `pokyn_PEP` | text / null | pokyn z poslední odpovědi PEP |
| `preferovany_termin` | datum / null | termín přání zákazníka z Poznámky prodejce |
| `dalsi_krok` | text | co má koordinátorka udělat |

Když Claude neodpoví, aplikace použije vyhodnocení podle klíčových slov (jako dashboard)
a zobrazí upozornění.

## 7. Kontroly v aplikaci

- Číslo marného výjezdu dopočítá aplikace: mv_N lze zvolit jen tehdy, když už zakázka má mv_(N-1).
- Od mv_2 výš aplikace zakázku zvýrazní (opakovaný marný výjezd) a pomůže koordinátorce rozhodnout, jestli pokračovat, nebo navrhnout storno.
- r_2 (smlouva s JP) blokuje plánování termínu do data dalšího kontaktu.
- Parkování DOD bez data dalšího kontaktu nelze uložit.
- Parkování ZAK bez popisu důvodu nelze uložit.
- U ZAK aplikace počítá **5 kalendářních dní** od zaparkování: pokud do té doby nepřijde
  reakce, PEP podle normy objednávku finálně zamítne (kap. 9).
- Aplikace sama navrhne ZAK po 6 neúspěšných pokusech ve 3 pracovních dnech. Z jiného důvodu
  (situace pro T-Mobile) ho koordinátorka zvolí ručně a popíše důvod.

## 8. Otevřené body

| # | Otázka | Stav |
|---|---|---|
| 1 | 3 dny po sobě = pracovní dny? | **ano, pracovní dny** |
| 2 | SMS po každém pokusu, nebo jednou denně? | **podle situace, typicky jednou denně** |
| 3 | Pod jaké parkování v MWF patří r_0 (nefunkční app) a r_4 (kapacita)? | **Legislatívne problémy (DOD)** |
| 4 | Co následuje po mv_2 (eskalace na PEP, storno, jiné)? | **parkování a opětovné dojednání; mv_N pokračují po sobě až do uzavření (instalace, nebo storno)** |
| 5 | Počasie a Legislatívne problémy: je kód vždy r_3, nebo podle situace? | **ano – Počasie vždy r_3; Legislatívne problémy po marném výjezdu vždy r_3 (spolu s mv_N); r_0 a r_4 zůstávají pro nefunkční app a kapacitu** |
| 6 | Přesná fráze pro parkování ZAK (Zákazník - nedostupný)? | **pevná fráze není – popisuje se důvod parkování (situace, kterou nevyřešíme a potřebuje zásah T-Mobile)** |
| 7 | Počítají se státní svátky jako nepracovní dny? | předpoklad: ano |
| 8 | Pracovní doba pro volání (od–do)? | předpoklad: 8:00–17:00 (jako v dashboardu) |

## 9. Ověření proti manuálům a MWF exportu (14.10.2026)

Zdroje: složka *Skills + manuály* na Drive – `call script 202602.docx`, `parkování v mwf`,
`call/skoleni 20260814`, `callscript strukturovany 20260416`, norma TMCZ
**R-280-244 v10** (Kontaktování zákazníka, rezervace termínu, parkování, zamítání aktivity)
a MWF export `paw-grid-export-csv 20261014 18_01` (856 zakázek).

### 9.1 Co sedí

- Pravidla kontaktování, fráze, kódy r_0–r_4 / mv_1–mv_2 a tabulka parkování odpovídají
  call scriptu 202602 a tabulce `parkování v mwf`.
- V exportu se vyskytuje i **mv_3** (2×) – potvrzuje řadu mv_N.
- SWAP (CASEID, 7 dní) a FIS MOP (termín až po datu portace) odpovídají call scriptu.
- Routing nedokončených zakázek: FTTH Praha → Hadravová, FTTH mimo Prahu → Kraitlová,
  PIV/SAT → Havlíčková.

### 9.2 Opraveno ve specifikaci

| Co | Zdroj | Úprava |
|---|---|---|
| Název parkování | MWF export | V MWF je **„Legislatívne problémy“** (slovensky), ne „Legislatívně“. Aplikace musí používat přesné hodnoty z MWF. |
| SMS | R-280-244 | min. 2 SMS za 3 PD, odstup **min. 18 h**, jen 8:00–22:00 (kap. 2). |
| Termín od prodejce | R-280-244 | „Zjednané = Áno“ → rezervační termín platí, nedojednává se; vždy číst Poznámku EXT/PAW (kap. 2). |
| Lhůta PEP | R-280-244 | PEP denně filtruje „Zákazník – nedostupný“; bez reakce prodejce do **5 KD** objednávku finálně zamítne (kap. 7). |

### 9.3 Výsledek dojednávání (sloupec MWF „Výsledok dojednávania“)

V exportu je vyplněný u 424 zakázek a má pevné hodnoty. Aplikace je bude importovat a
zapisovat jako strukturovaný výsledek hovoru – je to spolehlivější signál než čtení poznámek.

| Hodnota | Výskyt | Vazba v aplikaci |
|---|---|---|
| Dohodnutý termín | 147 | stav TERMÍN |
| Nezastihnutý | 100 | pokus „Nedovoláno“, počítadlo pokusů |
| Odklad | 108 | parkování Zákazník - odklad termínu |
| Márny výjazd | 58 | mv_N |
| Storno | 8 | zamítnutí (kap. 9.5) |
| Chybný kontakt | 3 | ZAK – PEP ověří kontakt |
| Problém | 1 | Legislatívne problémy |

Norma R-280-244 říká, že poznámka k parkování ZAK se uvádí právě do záložky
„Výsledok dojednávania“. U ZAK se v exportu objevují hodnoty *Nezastihnutý*, *Chybný kontakt*,
*Márny výjazd* a *Odklad* – to jsou podtypy ZAK, které aplikace nabídne.

### 9.4 Rozdíly, které je potřeba rozhodnout

| # | Rozdíl | Zdroje | Otázka |
|---|---|---|---|
| A | **Po MV vždy r_3** (vaše odpověď) × praxe | MWF export | V exportu je u zakázek po MV nejčastěji **bez kódu r_x** (94×), pak r_1 (9×), r_3 jen 2×. Call script navíc rozlišuje MV podle příčiny: PRB zákazník / PRB operátor / PRB aplikace. Má aplikace vynucovat r_3, nebo kód podle příčiny (zákazník → r_1, operátor → r_3, aplikace → r_0)? |
| B | **Parkování po MV** | MWF export | **Rozhodnuto 14.10.2026: obojí podle příčiny.** Příčina na straně TMCZ → *Legislatívne problémy*; příčina na straně zákazníka → *Zákazník - odklad termínu*. Aplikace se při zápisu MV zeptá na stranu příčiny a podle ní zvolí parkování. |
| C | **Další parkovací důvody** | R-280-244, MWF export | **Rozhodnuto 14.10.2026: nepoužíváme, ale MWF je umožňuje.** Aplikace *Materiál*, *Zákazník - termín - rieši dodávateľ* ani *Zákazník - termín - rieši BO* nenabízí. Při importu je ale rozpozná (v exportu 1× a 1×), zakázku zařadí podle významu a označí upozorněním „nestandardní parkování – zkontrolovat“. |
| D | **Kanál hlášení MV** | call script × dashboard | **Rozhodnuto 14.10.2026: platí Google Chat**, skupina „ICTM - TMCZ / NEDOKONCENE - NESTANDARDNI ZAKAZKY“. Zmínka o Telegramu v call scriptu 202602 je zastaralá – doporučeno opravit v manuálu. |
| E | **SWAP migrace** | call script × školení 14.08.2026 × STORNO LINKA 20260826 | **Rozhodnuto 14.10.2026:** řeší koordinátorka ještě před dohodnutím termínu, je součástí dojednávání (kap. 2.1). Výklad: CASEID přes Hnízdilovou; storno linka tam, kde je potřeba objednávku upravit nebo založit novou (chybí Servisní požadavek). *K potvrzení.* |
| F | **ZAK pro jiné situace** | R-280-244 | Norma zná ZAK jen jako „Zákazník – nedostupný“ a PEP po 5 KD objednávku zamítne. Když se ZAK použije pro jinou situaci pro T-Mobile, hrozí, že PEP zakázku zamítne. Opravdu takto parkovat? |

### 9.5 Doplnit do aplikace

- **Zamítnutí (storno)** – jen hodnoty z normy: *Storno – zákazník*, *Nesprávně založená objednávka*,
  *N-Technické překážky realizace SAT TV*, *N-Technické překážky realizace PIV – kapacita / kvalita*,
  *N-legislatívní/technická překážka – Optický internet / Optická TV*. Nesouhlasí-li jméno nebo
  adresa se zakázkou → storno (Nesprávně založená objednávka) a nová zakázka.
- **Kombinované objednávky (SAT + PIV)** – „všechno, nebo nic“; před instalací ověřit obě služby.
- **Checklist hovoru podle call scriptu** – shoda jména a adresy (100 %), ověření adresy na
  mapy.com, infrastruktura (TMCZ / CETIN / VDF), existující zásuvka + QR + aktivní služba a
  operátor, patro a byt, volný přístup do pater, souhlas s vrtáním (NE → dotaz na PEP),
  elektrická zásuvka u KZ, router/bridge (+ STB), instalační předpis. Vyplněná pole se rovnou
  použijí v události GCal.
- **Šablona události v GCal** (podle call scriptu) – aplikace ji vyplní sama:

```
Název:  Technik - FTTH (CETIN/VDF) ID-S7, zákazník, SLA xx
TEL:
Nová instalace/existující - číslo nebo foto zásuvky
INSTALACE: Optický internet / IPTV
ČÍSLO PATRA A BYTU: xx / xx
PATRA VOLNĚ PŘÍSTUPNÁ: ANO/NE
STOUPAČKA JE ZAJIŠTĚNA (nebo jen čtyřhran): ANO/NE/NEVÍM
VZDÁLENOST OD STOUPAČKY (řádově): xx metrů
STÁVAJÍCÍ LIŠTY/OMEZENÍ V LIŠTOVÁNÍ OD SVJ: ANO/NE/NEVÍM
SOUHLAS S VRTÁNÍM: ANO/NE = dotaz na PEP
KONCOVÉ ZAŘÍZENÍ UMÍSTÍME V: předsíň / obývací pokoj / jinde – EL. ZÁSUVKA: ANO/NE
KZ: typ KZ / ROUTE/BRIDGE + ev. STB
PŘEDPOJEN: ANO/NE
PODB (adresa):            (pro T-Mobile instalace)
INSTALAČNÍ PŘEDPIS:       (celý zkopírovat z ticketu)
CASEID:                   (SWAP / FIS MOP)
```

- **Zápis MV od technika** (call script) – technik hlásí do **Google Chatu** (skupina NEDOKONCENE - NESTANDARDNI ZAKAZKY), aplikace zprávy čte a páruje podle ID O- / S7; formát `ID / popis stavu / kam hlášeno / další postup /
  komentář`; podle typu PRB (zákazník / operátor / aplikace) se zakázka přesune na profil podle
  routingu (kap. 9.1).
- **Pracovní doba** – norma připouští volání technika na poruchy 8:00–21:00 a SMS 8:00–22:00.
  Pokud by koordinace volala i po 17:00, odpadne omezení „první pokus do 13:00“ (kap. 2).
