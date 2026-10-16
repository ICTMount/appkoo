# Workflow aplikace – jak ho dnes implementuje kód

Verze: 15.10.2026 · odvozeno z kódu ve větvi `claude/dashboard-planning-app-6gcm7h` (commit f764b79)

Stav kroků: **KÓD** = naprogramováno a otestováno · **NÁVRH** = jen v klikacím návrhu ·
**PLÁN** = zatím není.

## 1. Přehled

```mermaid
flowchart LR
  A[MWF export CSV<br/>na Drive] -->|KÓD ruční spuštění<br/>PLÁN každých 15 min| B[Import<br/>importExport]
  B --> C[Rozklad poznámek<br/>rozlozPoznamku]
  C --> D[Zařazení zakázky<br/>kap. 2]
  C --> E[Claude: vytěžení poznámek<br/>vytezPoznamky]
  D --> F[Fronta koordinátorky<br/>NÁVRH]
  E --> F
  F --> G[Hovor → výsledek<br/>kap. 4]
  G --> H[Fráze do MWF<br/>KÓD fraze]
  G --> I[Plánovač → kalendář technika<br/>NÁVRH]
  H -->|koordinátorka vloží ručně| A
  I -->|PLÁN kontrola po dalším importu| A
```

| Krok | Funkce | Stav |
|---|---|---|
| Načtení CSV (windows-1250, `;`) | `src/import/csv.ts` | KÓD |
| Převod řádku na zakázku | `importExport` | KÓD |
| Rozklad poznámky na záznamy `[Typ] datum, autor: text` | `rozlozPoznamku` | KÓD |
| Vytěžení poznámek přes Claude (bez jmen a telefonů) | `vytezPoznamky` | KÓD, spouští se ručně (`--ai`), výsledek se zatím neukládá |
| Příjem exportu: e-mail, nahrání v aplikaci, Google Drive (kontrola, duplicity, starší export) | `src/ingest/` | KÓD, bez spouštění v cloudu |
| Priorita P1–P0 podle pravidel z Konfigurace | `urciPrioritu` | KÓD |
| Ukládání do databáze, plánované spouštění | – | PLÁN |
| Fronty, plánovač, zápis do kalendáře | – | NÁVRH |

## 2. Zařazení zakázky po importu

```mermaid
flowchart TD
  Z[Zakázka z exportu] --> P{Typ aktivity<br/>Predobjednavka_FTTH?}
  P -->|ano| PO[Předobjednávka<br/>mimo frontu]
  P -->|ne| K{Dôvod parkovania?}
  K -->|Odklad / Legislatívne / Počasie| DOD[Parkováno DOD]
  K -->|Zákazník - nedostupný| ZAK[Parkováno ZAK<br/>kap. 6]
  K -->|Materiál / rieši dodávateľ / rieši BO| NS[Nestandardní parkování<br/>upozornění]
  K -->|prázdné| T{Dohodnutý termín?}
  T -->|ano| TE[Termín<br/>mimo frontu]
  T -->|ne| KD[K dojednání<br/>plán kontaktu, kap. 3]
```

Co si import u zakázky zjistí (`importExport`):
- číslo O- (ze sloupce *ID obj. v ext. systéme*) a jeho základ bez přípon `:1`, `-13075814`,
- infrastrukturu podle *P17: Vlastník siete* a typu aktivity: TMCZ / CETIN / VDF,
- termín; když MWF vypíše jen čas (`11:00 / 12:59`), bere se den exportu,
- *Do splnění* v minutách (`-41t,5d,1h,15m`, t = týdny),
- počet marných výjezdů = nejvyšší `mv_N` v poznámkách.

## 3. Kontaktování zákazníka (`planKontaktu`)

Pokusy se berou z poznámek (`pokusyZPoznamky`):
- jen zápisy typu *Dojednávania* a *Editácia*,
- jen **po posledním zápisu autora bez „(Vegacom)“** – to je reakce PEP a nuluje počítadlo,
- **nedovoláno** = text obsahuje *nezved, nedovol, nezasti, nebere, nedostupn, mimo provoz, vytípnut, bez reakce*;
  SMS = ve stejném zápisu slovo *sms*,
- **dovoláno** = *spojeno, dovoláno, domluven, dohodnut, na přání, na žádost, potvrzuje, souhlasí*
  nebo řádek `Zákazník: … (datum)`,
- souhrnný zápis při parkování ZAK (*dle pravidel*, *součinnost PEP*) se nepočítá.

```mermaid
flowchart TD
  S[Pokusy od poslední reakce PEP<br/>a od posledního dovolání] --> D{Poslední pokus<br/>dovoláno?}
  D -->|ano| OK[Dovoláno – řada končí]
  D -->|ne| K{3 navolané dny?<br/>den = aspoň 1 pokus}
  K -->|ano| ZAK[Návrh parkování ZAK<br/>+ kontrola minima normy]
  K -->|ne| W{Dnes pracovní den?}
  W -->|ne| N1[Další pokus: příští PD 8:00]
  W -->|ano| C{Pokusů dnes}
  C -->|0| N2[Volat hned<br/>v čase 8:00–19:00]
  C -->|méně než cíl dne| N3[Další pokus za 4 h<br/>když vyjde před 19:00,<br/>jinak příští PD 8:00]
  C -->|cíl splněn<br/>1 nebo 2 podle objemu| N1
```

SMS: aplikace doporučí SMS, když byl dnes nedovolaný pokus, dnes ještě žádná SMS neodešla a od
poslední SMS uběhlo aspoň 18 h (okno 8:00–22:00, pracovní dny).

Upozornění: vynechaný pracovní den v řadě · první pokus dne po 15:00 · po 3 PD méně než 2 SMS
s odstupem 18 h · návrh ZAK, ale pokusy nesplňují minimum normy (3 pokusy s odstupem 4 h, 2 SMS).

Pracovní den = Po–Pá bez státních svátků ČR včetně Velkého pátku a Velikonočního pondělí.

## 4. Výsledek hovoru → fráze a parkování (`fraze`, `parkovaniPoMv`)

| Výsledek | Fráze do MWF | Kód | Parkování | Výsledok dojednávania |
|---|---|---|---|---|
| Nedovoláno | `zkz. nezvedá tlf., sms` / `zkz. nezvedá tlf.` | – | – | Nezastihnutý |
| Odklad | `na přání kontaktovat DD.MM.RRRR r_1` | r_1 | Zákazník - odklad termínu | Odklad |
| Smlouva s JP | `zkz. má smlouvu s JP, ověřuje si výpovědní dobu, přeje si kontaktovat DD.MM.RRRR r_2` | r_2 | Zákazník - odklad termínu | Odklad |
| Termín na přání | `na přání zákazníka instalace dne DD.MM.RRRR r_1` | r_1 | – | Dohodnutý termín |
| Termín | `Zákazník: Příjmení, Jméno (DD.MM.RRRR, HH:MM - HH:MM)` | – | – | Dohodnutý termín |
| ZAK nedostupný | `zkz. nedostupný, kontaktován dle pravidel 3 prac. dny (OD–DO), N× tlf., N× sms – prosíme o součinnost PEP` | r_1 | Zákazník - nedostupný | Nezastihnutý |

Fráze, kódy a parkování: KÓD. Tlačítka v obrazovce: NÁVRH.

## 5. Marný výjezd (`parkovaniPoMv`)

```mermaid
flowchart TD
  MV[Technik nahlásí MV<br/>Google Chat NEDOKONČENÉ] --> N[Číslo = nejvyšší mv_N + 1]
  N --> S{Na čí straně je příčina?}
  S -->|T-Mobile / infrastruktura| L[Legislatívne problémy<br/>kódy mv_N r_3]
  S -->|zákazník| O[Zákazník - odklad termínu<br/>kód mv_N, r_1 volitelně<br/>+ datum dalšího kontaktu]
  L --> R[Znovu dojednat termín]
  O --> R
  R -->|další MV| MV
  R -->|instalace / storno| X[Uzavřeno]
```

Výpočet čísla mv a parkování: KÓD. Čtení Google Chatu: PLÁN.

## 6. ZAK a PEP (`lhutaZak`)

```mermaid
flowchart LR
  Z[Parkováno ZAK] --> L[Lhůta 5 kalendářních dní<br/>od posledního záznamu Parkovanie]
  L -->|zbývá ≤ 24 h| U[Upozornění: urgovat PEP]
  L -->|uplynula| V[Ověřit, zda PEP<br/>zakázku nezamítl]
  Z --> P[PEP odpoví novou poznámkou]
  P --> R[Počítadlo pokusů od nuly<br/>zpět do dojednávání]
```

## 7. Konfigurace – číselníky (`nahledImportu`, `exportCsv`)

```mermaid
flowchart LR
  F[Vedoucí nahraje CSV] --> H[Rozpoznání sloupců<br/>podle názvu, pořadí nevadí]
  H --> K[Kontrola řádků<br/>povinné, výběr, čísla, duplicity]
  K --> N[Náhled: nové / změněné /<br/>beze změny / v souboru chybí]
  N -->|chyba| X[Nelze uložit]
  N -->|bez chyb| P[Vedoucí potvrdí<br/>PLÁN uložení + historie]
```

Číselníky s CSV: technici, typy akcí, koordinátorky, regiony, blokované lokality, kontakty (KÓD).
Sloupce, které v CSV nejsou, se u existujících řádků nemění. Řádky chybějící v CSV se jen nahlásí.

## 8. K ověření s realitou

1. **Slova v poznámkách.** Pozná kód pokus správně podle výrazů v kap. 3? Chybí nějaký, který koordinátorky běžně píšou?
2. **Reset počítadla.** Nuluje ho každý zápis autora bez „(Vegacom)“. Jsou v poznámkách i jiní autoři než PEP (BO, systém MWF), u kterých by se nulovat nemělo?
3. ~~Dva pokusy dnes blíž než 4 h.~~ **Vyřešeno 15.10.:** den je navolaný už s 1 pokusem, počet pokusů denně (1/2/auto podle objemu) je v Konfiguraci.
4. **Tři dny po sobě.** Kód vyžaduje 3 kompletní dny, ale přerušenou řadu jen hlásí. Má se po vynechaném dni začít znovu od dne 1?
5. **Předobjednávky.** Pravidlo priority `predobjednavka_po_rfs` je dává od data RFS do P1 – ověřit, zda je volat už pár dní před RFS (parametr).
6. **Termín v minulosti.** Pravidlo `termin_probehl` ji dá do P1 – ověřit, že tak má být.
7. **Lhůta ZAK.** Počítá se od posledního záznamu `[Parkovanie]`. Zapisuje MWF tento záznam při každém zaparkování?
8. ~~Priorita P1–P0.~~ **Vyřešeno 15.10.:** pravidla priority jsou číselník v Konfiguraci (i CSV), výpočet `urciPrioritu`.
9. **Blacklist lokalit.** Zatím je hlídá jen Claude podle textu, kontrola adresy proti číselníku chybí.
