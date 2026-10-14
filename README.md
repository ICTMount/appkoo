# appkoo – plánovací aplikace koordinace FTTH/PIV/SAT

Aplikace pro koordinátorky Vegacom (instalační partner T-Mobile CZ). Nahrazuje práci
v exportech z MWF: importuje zakázky, hlídá pravidla kontaktování, připravuje fráze do MWF
a události do kalendáře techniků a pomocí Claude vytěžuje poznámky.

Proces, ze kterého aplikace vychází: [`docs/proces-koordinace.md`](docs/proces-koordinace.md).
Provoz v Google Cloudu: [`docs/architektura-gcp.md`](docs/architektura-gcp.md).

## Stav – fáze F0 (jádro)

| Část | Soubor | Stav |
|---|---|---|
| Import MWF exportu (windows-1250, `;`) | `src/import/mwfExport.ts`, `src/import/csv.ts` | hotovo |
| Rozklad poznámek na záznamy, pokusy o kontakt | `src/import/notes.ts` | hotovo |
| Číselníky MWF (parkování, výsledek dojednávání, kódy r/mv) | `src/domain/mwf.ts` | hotovo |
| Pracovní dny vč. svátků ČR | `src/domain/workdays.ts` | hotovo |
| Pravidla kontaktování (2×/den, 4 h, 3 PD, SMS 18 h, ZAK, lhůta PEP) | `src/domain/contact.ts` | hotovo |
| Fráze do MWF | `src/domain/phrases.ts` | hotovo |
| Vytěžení poznámek přes Claude + pseudonymizace | `src/ai/` | hotovo, čeká na API klíč |
| Schéma databáze (PostgreSQL) | `db/schema.sql` | hotovo, zatím bez zápisu |
| Ukládání importu do DB, automatický import z Drive | – | další krok |
| Webové rozhraní (fronty, plánovač) | – | F1 |

## Spuštění

```bash
npm install
npm test                 # testy (bez sítě a bez API klíče)
npm run typecheck

# souhrn z MWF exportu (čas exportu se čte z názvu souboru)
npm run import -- "zakazky paw-grid-export-csv 20261014 18_01.csv"

# + vytěžení poznámek 3 zakázek přes Claude
ANTHROPIC_API_KEY=… npm run import -- "zakazky paw-grid-export-csv 20261014 18_01.csv" --ai 3
```

MWF exporty obsahují osobní údaje zákazníků – do repozitáře se necommitují (`*.csv` je v `.gitignore`).

## Claude

- Model `claude-opus-5-5`, strukturovaný výstup podle schématu `VytezeniSchema`, nízké `effort`.
- Poskytovatel: `CLAUDE_PROVIDER=vertex` (Vertex AI, proměnné `GOOGLE_CLOUD_PROJECT`, `CLAUDE_VERTEX_REGION`,
  výchozí `eu`), jinak Claude API s `ANTHROPIC_API_KEY`.
- Před odesláním se z poznámek odstraní jméno zákazníka, telefony a e-maily (`src/ai/pseudonym.ts`).
- Na Claude API je zapnutý server-side fallback (`fallbacks: "default"`); na Vertex AI není dostupný.
- Výsledek je vždy návrh. Když Claude neodpoví, použije se deterministické vyhodnocení
  (`pokusyZPoznamky`) a import pokračuje.
