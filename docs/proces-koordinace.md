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
NOVÁ ──► DOJEDNÁVÁNÍ ──dovoláno──► TERMÍN ──► INSTALACE OK
           │    ▲                    │
           │    │                    └─► marný výjezd ──► mv_1 ──► zpět do DOJEDNÁVÁNÍ
           │    │                                   └──► mv_2 (jen po mv_1) ──► viz kap. 8, bod 4
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
| Překážka TMCZ / po marném výjezdu | volný text | r_3 / mv_1 / mv_2 | Legislatívně problémy (DOD) | mv_2 nabídne jen tam, kde v historii už je mv_1 |
| Počasí (záfuky, PIV) | volný text | viz kap. 8, bod 5 | Počasie (DOD) | vrátí zakázku do fronty v daný den |
| 3 pracovní dny nedovoláno | viz kap. 8, bod 6 | r_1 | Zákazník - nedostupný (ZAK) | přesun do „čeká na PEP“ |
| Nefunkční aplikace | volný text | r_0 | viz kap. 8, bod 3 | – |
| Kapacita Vegacom | volný text | r_4 | viz kap. 8, bod 3 | – |

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

> Pozor: dashboard v4.3 (`mvEval`) má mv_1 / mv_2 jako „marný výjezd kvůli zákazníkovi /
> kvůli infrastruktuře“ a nezná r_0. Platí tato tabulka.

## 5. Parkování v MWF

Podle tabulky koordinace (14.10.2026). V MWF existují jen tyto čtyři druhy parkování,
rozdělené do dvou skupin: DOD (parkuje dodavatel – Vegacom) a ZAK (zákazník, řeší PEP).

| Parkování v MWF | Skupina | Kdy | Následný krok |
|---|---|---|---|
| Zákazník - odklad termínu | DOD | zákazníkovi jsme se dovolali a žádá o kontaktování později | kontaktuji následně, dle požadavku zákazníka |
| Legislatívně problémy | DOD | po MV technika | po MV, nebo instalace před, kde je překážka k naplánování termínu ze strany TMCZ (nesedí předpis, není přístup atp.) |
| Počasie | DOD | záfuky, PIV, etc. | čekáme na změnu podmínek a opět plánujeme |
| Zákazník - nedostupný | ZAK | zákazník je nedostupný, byl kontaktován dle pravidel, tj. 3 (pracovní) dny po sobě | řeší PEP |

## 6. Co z poznámek vytěžuje Claude

Po každém importu, jen u zakázek se změněnými poznámkami. Odpověď je ve strukturovaném
výstupu (pevné schéma), výsledek je vždy návrh, který potvrzuje koordinátorka.

| Pole | Typ | Popis |
|---|---|---|
| `stav` | NOVÁ / DOJEDNÁVÁNÍ / TERMÍN / PARKOVÁNO_DOD / PARKOVÁNO_ZAK | odhad stavu z poznámek |
| `parkovani` | odklad / legislativa / pocasi / nedostupny / null | druh parkování |
| `kod` | r_0 … r_4 / mv_1 / mv_2 / null | poslední použitý kód |
| `pokusy` | seznam {datum, čas, výsledek, sms} | pokusy o kontakt z poznámek |
| `dalsi_kontakt` | datum / null | datum dalšího kontaktu |
| `konec_JP` | datum / null | konec smlouvy s jiným poskytovatelem |
| `pokyn_PEP` | text / null | pokyn z poslední odpovědi PEP |
| `dalsi_krok` | text | co má koordinátorka udělat |

Když Claude neodpoví, aplikace použije vyhodnocení podle klíčových slov (jako dashboard)
a zobrazí upozornění.

## 7. Kontroly v aplikaci

- mv_2 nelze zvolit bez předchozího mv_1 u stejné zakázky.
- r_2 (smlouva s JP) blokuje plánování termínu do data dalšího kontaktu.
- Parkování DOD bez data dalšího kontaktu nelze uložit.
- Parkování ZAK lze navrhnout až po 6 neúspěšných pokusech ve 3 pracovních dnech;
  dřív jen s ručním potvrzením a důvodem.

## 8. Otevřené body

| # | Otázka | Stav |
|---|---|---|
| 1 | 3 dny po sobě = pracovní dny? | **ano, pracovní dny** |
| 2 | SMS po každém pokusu, nebo jednou denně? | **podle situace, typicky jednou denně** |
| 3 | Pod jaké parkování v MWF patří r_0 (nefunkční app) a r_4 (kapacita)? | otevřené – v tabulce parkování nejsou; parkuje se u nich vůbec? |
| 4 | Co následuje po mv_2 (eskalace na PEP, storno, jiné)? | otevřené |
| 5 | Počasie a Legislatívně problémy: je kód vždy r_3, nebo podle situace? | otevřené |
| 6 | Přesná fráze pro parkování ZAK (Zákazník - nedostupný)? | otevřené |
| 7 | Počítají se státní svátky jako nepracovní dny? | předpoklad: ano |
| 8 | Pracovní doba pro volání (od–do)? | předpoklad: 8:00–17:00 (jako v dashboardu) |
