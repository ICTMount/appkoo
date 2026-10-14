# Cesta zakázky koordinací – specifikace pro plánovací aplikaci

Verze: 0.1 · 14.10.2026 · stav: rozpracováno (otevřené body v kap. 8)

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
           │    │                    └─► marný výjezd ──► mv_N ──► PARKOVÁNO (DOD) Legislatívně problémy
           │    │                        (mv_1, mv_2, mv_3 … se číslují      └─► opětovné dojednání termínu
           │    │                         po sobě až do uzavření)
           │    │
           │    │   Uzavřít lze jen dvěma způsoby: INSTALACE OK, nebo STORNO.
           │    │
           │    └── v den příštího kontaktu ◄── PARKOVÁNO (DOD)
           │                                    ├ Zákazník - odklad termínu
           │                                    ├ Legislatívně problémy (po MV technika)
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
| PARKOVÁNO ZAK | zákazník nedostupný, řeší PEP | ne – čeká na novou poznámku od PEP |

## 2. Pravidlo kontaktování (dojednání termínu)

- **2 pokusy denně** s odstupem **minimálně 4 hodin**.
- **3 po sobě jdoucí pracovní dny** (Po–Pá). Víkend se nepočítá a nepřerušuje řadu.
  Státní svátky se berou jako nepracovní dny (předpoklad, viz kap. 8).
- **SMS** se posílá podle situace, **typicky jednou denně**, po prvním nedovolaném pokusu dne.
- **Nepodaří se kontaktovat** (6 neúspěšných pokusů) → **parkujeme** jako
  *Zákazník - nedostupný (ZAK)*. Ticket řeší PEP T-Mobile a odpověď (další postup)
  vrátí formou nové poznámky v MWF.

### Chování aplikace

1. Koordinátorka zapíše výsledek hovoru jedním klikem: **Nedovoláno** nebo **Dovoláno**.
2. Po **Nedovoláno** aplikace:
   - uloží čas pokusu,
   - u prvního nedovolaného pokusu dne nabídne frázi se SMS (`zkz. nezvedá tlf., sms`)
     a připomene odeslat SMS; u druhého pokusu nabídne frázi bez SMS
     (`zkz. nezvedá tlf.`). Koordinátorka může SMS zapnout nebo vypnout ručně,
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
| Překážka TMCZ / po marném výjezdu | volný text | mv_N + r_3 (po MV vždy r_3) | Legislatívně problémy (DOD) | po MV nabídne další číslo v řadě (mv_1 → mv_2 → mv_3 …), doplní r_3 a vrátí zakázku k opětovnému dojednání |
| Počasí (záfuky, PIV) | volný text | r_3 | Počasie (DOD) | vrátí zakázku do fronty v daný den |
| 3 pracovní dny nedovoláno | viz kap. 8, bod 6 | r_1 | Zákazník - nedostupný (ZAK) | přesun do „čeká na PEP“ |
| Nefunkční aplikace | volný text | r_0 | Legislatívně problémy (DOD) | vrátí zakázku do fronty v den dalšího kontaktu |
| Kapacita Vegacom | volný text | r_4 | Legislatívně problémy (DOD) | vrátí zakázku do fronty v den dalšího kontaktu |

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

Po každém marném výjezdu (mv_N) následuje parkování *Legislatívně problémy (DOD)* a opětovné
dojednání termínu. Řada mv pokračuje, dokud zakázka neskončí instalací, nebo stornem.

> Pozor: dashboard v4.3 (`mvEval`) má mv_1 / mv_2 jako „marný výjezd kvůli zákazníkovi /
> kvůli infrastruktuře“ a nezná r_0. Platí tato tabulka.

## 5. Parkování v MWF

Podle tabulky koordinace (14.10.2026). V MWF existují jen tyto čtyři druhy parkování,
rozdělené do dvou skupin: DOD (parkuje dodavatel – Vegacom) a ZAK (zákazník, řeší PEP).

| Parkování v MWF | Skupina | Kdy | Následný krok |
|---|---|---|---|
| Zákazník - odklad termínu | DOD | zákazníkovi jsme se dovolali a žádá o kontaktování později | kontaktuji následně, dle požadavku zákazníka |
| Legislatívně problémy | DOD | po MV technika; také při nefunkční aplikaci (r_0) a nedostatečné kapacitě Vegacom (r_4) | po MV, nebo instalace před, kde je překážka k naplánování termínu ze strany TMCZ (nesedí předpis, není přístup atp.) |
| Počasie | DOD | záfuky, PIV, etc. | čekáme na změnu podmínek a opět plánujeme |
| Zákazník - nedostupný | ZAK | zákazník je nedostupný, byl kontaktován dle pravidel, tj. 3 (pracovní) dny po sobě | řeší PEP |

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
| `dalsi_krok` | text | co má koordinátorka udělat |

Když Claude neodpoví, aplikace použije vyhodnocení podle klíčových slov (jako dashboard)
a zobrazí upozornění.

## 7. Kontroly v aplikaci

- Číslo marného výjezdu dopočítá aplikace: mv_N lze zvolit jen tehdy, když už zakázka má mv_(N-1).
- Od mv_2 výš aplikace zakázku zvýrazní (opakovaný marný výjezd) a pomůže koordinátorce rozhodnout, jestli pokračovat, nebo navrhnout storno.
- r_2 (smlouva s JP) blokuje plánování termínu do data dalšího kontaktu.
- Parkování DOD bez data dalšího kontaktu nelze uložit.
- Parkování ZAK lze navrhnout až po 6 neúspěšných pokusech ve 3 pracovních dnech;
  dřív jen s ručním potvrzením a důvodem.

## 8. Otevřené body

| # | Otázka | Stav |
|---|---|---|
| 1 | 3 dny po sobě = pracovní dny? | **ano, pracovní dny** |
| 2 | SMS po každém pokusu, nebo jednou denně? | **podle situace, typicky jednou denně** |
| 3 | Pod jaké parkování v MWF patří r_0 (nefunkční app) a r_4 (kapacita)? | **Legislatívně problémy (DOD)** |
| 4 | Co následuje po mv_2 (eskalace na PEP, storno, jiné)? | **parkování a opětovné dojednání; mv_N pokračují po sobě až do uzavření (instalace, nebo storno)** |
| 5 | Počasie a Legislatívně problémy: je kód vždy r_3, nebo podle situace? | **ano – Počasie vždy r_3; Legislatívně problémy po marném výjezdu vždy r_3 (spolu s mv_N); r_0 a r_4 zůstávají pro nefunkční app a kapacitu** |
| 6 | Přesná fráze pro parkování ZAK (Zákazník - nedostupný)? | otevřené |
| 7 | Počítají se státní svátky jako nepracovní dny? | předpoklad: ano |
| 8 | Pracovní doba pro volání (od–do)? | předpoklad: 8:00–17:00 (jako v dashboardu) |
