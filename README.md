# appkoo – plánovací aplikace koordinace FTTH/PIV/SAT

Aplikace pro koordinátorky Vegacom (instalační partner T-Mobile CZ). Nahrazuje práci
v exportech z MWF: importuje zakázky, hlídá pravidla kontaktování, připravuje fráze do MWF
a události do kalendáře techniků a pomocí Claude vytěžuje poznámky.

Fáze 1 (tři pilíře): [`docs/faze1.md`](docs/faze1.md).
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
| Webové rozhraní: fronta k volání + detail zakázky (přihlášení Google přes IAP) | `src/web/` | nasazeno (appkoo-web) |
| Pilíř 1: hledání ve všech zdrojích (MWF, e-mail, kalendáře, Chat) na jedné stránce | `src/zdroje/`, `src/google/delegace.ts` | hotovo, čeká na delegaci a nasazení |
| Nabídka termínů a zápis do kalendáře technika z webu | `src/plan/planovac.ts`, `src/web/planovani.ts` | hotovo, čeká na nasazení (pilot) |

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

## Webové rozhraní (Cloud Run služba `appkoo-web`)

```bash
DATABASE_URL=… DEV_USER=ja@ictmount.com npm run web   # lokálně na http://localhost:8080
```

Dva pohledy (záložky nahoře), pod nimi hledání zakázky přes celou šířku; vpravo stáří exportu MWF
(zelená do 1 h, oranžová do 2 h, červená přes 2 h).
- **Plánovat zakázku** – `/?q=O-…` najde zakázku (O-ID, S7, telefon, jméno, adresa) → `/zakazka/<ID>`: nahoře detail
  se všemi podklady (vlastník infrastruktury, MWF, poznámky, historie, e-mail, kalendáře, chat), dole „Kam naplánovat“ –
  nejlepší volné sloty VOLNY podle zaplnění dne, SLA a trasy; brány podle zlatých pravidel (ZAK, smlouva s JP, blacklist lokalit).
- **Doplnit technika** – `/technik`: bez výběru přehled dne (technici od nejméně vytížených); po výběru technika jeho
  5 pracovních dní, klik na volný slot → dole zakázky, které ho nejlépe doplní (vč. přesunu „flex“).
- `/zakazka/<ID>/zapis` formulář podle call scriptu → přepis slotu VOLNY na zakázku (patička SHEET2CAL zůstane,
  obsazený slot se nepřepíše) → evidence v `gcal_udalost` → text „Zákazník: … (datum, čas)“ pro MWF.
  Zápis zapíná `ZAPIS_KALENDARE=ano` a `ZAPIS_TECHNICI` (jména čárkami nebo `vsichni`).
- **Uživatelé a role** (číselník Uživatelé): správce = Konfigurace, koordinátorka = plánování a zápis, jen čtení.
  Správci ze `SPRAVCI` (výchozí davidh@ictmount.com) mají přístup vždy. Dokud je číselník prázdný, platí `POVOLENI_UZIVATELE`.
  IAP pouští celou doménu (`domain:ictmount.com`), o přístupu rozhoduje aplikace.
- **Konfigurace** (`/konfigurace`, jen správce): přehled číselníků, obsah, stažení CSV, nahrání CSV → náhled změn a chyb
  → uložení; historie kdo / kdy / co. Nastavení plánování (limit km, zaplnění dne, SLA, okno, horizont) čte plánovač.
- Číselníky (technici, blacklist lokalit…) se nahrávají z CSV: `npm run ciselnik -- technici technici.csv --ulozit`, blacklist `npm run ciselnik -- blacklist blacklist.csv --ulozit`.
- Přístup hlídá IAP (role *IAP-secured Web App User*) a navíc seznam `POVOLENI_UZIVATELE`
  (e-maily nebo `@doména`, čárkami). `IAP_AUDIENCE` zapne i ověření podpisu IAP.

## Claude

- Model `claude-opus-5-5`, strukturovaný výstup podle schématu `VytezeniSchema`, nízké `effort`.
- Poskytovatel: `CLAUDE_PROVIDER=vertex` (Vertex AI, proměnné `GOOGLE_CLOUD_PROJECT`, `CLAUDE_VERTEX_REGION`,
  výchozí `eu`), jinak Claude API s `ANTHROPIC_API_KEY`.
- Před odesláním se z poznámek odstraní jméno zákazníka, telefony a e-maily (`src/ai/pseudonym.ts`).
- Na Claude API je zapnutý server-side fallback (`fallbacks: "default"`); na Vertex AI není dostupný.
- Výsledek je vždy návrh. Když Claude neodpoví, použije se deterministické vyhodnocení
  (`pokusyZPoznamky`) a import pokračuje.
