# appkoo – plánovací aplikace koordinace FTTH/PIV/SAT

Aplikace pro koordinátorky Vegacom (instalační partner T-Mobile CZ). Nahrazuje práci
v exportech z MWF: importuje zakázky, hlídá pravidla kontaktování, připravuje fráze do MWF
a události do kalendáře techniků a pomocí Claude vytěžuje poznámky.

Proces, ze kterého aplikace vychází: [`docs/proces-koordinace.md`](docs/proces-koordinace.md).
Architektura systému: [`docs/architektura.md`](docs/architektura.md) · provoz v Google Cloudu: [`docs/architektura-gcp.md`](docs/architektura-gcp.md).

## Stav

Priority (15.10.2026): **automatický import MWF exportu**, **propojení s kalendáři techniků**
(méně chyb při přepisu) a **optimalizace plánování** (trasy s časovými okny, KPI zakázky).
Převzetí všech funkcí dashboardu není cíl.

| Část | Soubor | Stav |
|---|---|---|
| Příjem exportu: e-mail / nahrání / Google Drive, kontrola, duplicity, starší export | `src/ingest/` | hotovo |
| Automatický import do databáze (zakázky, historie, uzavřené zakázky, log) | `src/jobs/importJob.ts`, `src/db/` | hotovo, čeká na nasazení |
| Kalendář: šablona události, zápis s ID zakázky, obsazení okna VOLNY | `src/gcal/udalost.ts`, `src/gcal/kalendar.ts` | hotovo, ověřeno na formátu skutečných událostí |
| Kontrola MWF ↔ kalendář (technik, den, čas, telefon, adresa) | `src/gcal/kontrola.ts` | hotovo, ověřeno na skutečných datech |
| Trasa dne technika – TSP s časovými okny | `src/plan/trasa.ts` | hotovo |
| Nabídka termínů a návrh plánu podle km, SLA a priority | `src/plan/sloty.ts` | hotovo |
| Dny techniků z kalendáře, geokódování adres s cache | `src/plan/dny.ts`, `src/plan/geokod.ts` | hotovo, geokódování čeká na klíč |
| KPI zakázek a plánu | `src/plan/kpi.ts` | hotovo |
| Import CSV (windows-1250), rozklad poznámek, pokusy o kontakt | `src/import/` | hotovo |
| Pravidla kontaktování, priorita, číselníky s CSV | `src/domain/`, `src/config/` | hotovo |
| Vytěžení poznámek přes Claude | `src/ai/` | hotovo, čeká na API / Vertex AI |
| Nasazení v Google Cloudu: projekt `appkoo`, Cloud SQL, servisní účty, přístup k Drive a kalendářům | – | hotovo (15.10.2026) |
| Spouštěcí skript importu pro Cloud Run job + Dockerfile | `src/jobs/run.ts`, `Dockerfile` | hotovo, čeká na nasazení |
| Webové rozhraní | – | další krok |

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

## Import v Google Cloudu (Cloud Run job)

```bash
npm run job:import       # lokálně; potřebuje DATABASE_URL a MWF_SLOZKA
```

| Proměnná | Povinná | Význam |
|---|---|---|
| `DATABASE_URL` | ano | připojení k Cloud SQL (secret) |
| `MWF_SLOZKA` | ano | ID složky s MWF exporty na Drive (nasdílená servisnímu účtu) |
| `GMAIL_SCHRANKA` | ne | schránka s exporty v příloze (delegace v rámci domény) |
| `POVOLENI_ODESILATELE` | ne | povolení odesílatelé, čárkami (výchozí `@ictmount.com`) |
| `STARY_EXPORT_HODIN` | ne | varování, když nový export nepřišel déle (výchozí 6 h) |

Job píše řádky JSON pro Cloud Logging. Výpadek zdroje = `severity: ERROR` a návratový kód 1
(→ neúspěšné spuštění, upozornění z Monitoringu); starý export = `WARNING` s `stary_export: true`.

## Claude

- Model `claude-opus-5-5`, strukturovaný výstup podle schématu `VytezeniSchema`, nízké `effort`.
- Poskytovatel: `CLAUDE_PROVIDER=vertex` (Vertex AI, proměnné `GOOGLE_CLOUD_PROJECT`, `CLAUDE_VERTEX_REGION`,
  výchozí `eu`), jinak Claude API s `ANTHROPIC_API_KEY`.
- Před odesláním se z poznámek odstraní jméno zákazníka, telefony a e-maily (`src/ai/pseudonym.ts`).
- Na Claude API je zapnutý server-side fallback (`fallbacks: "default"`); na Vertex AI není dostupný.
- Výsledek je vždy návrh. Když Claude neodpoví, použije se deterministické vyhodnocení
  (`pokusyZPoznamky`) a import pokračuje.
