# Architektura v Google Cloudu

Verze: 0.1 · 14.10.2026 · stav: návrh k odsouhlasení

## Přehled

```
                 Google Workspace (ictmount.com)
   Drive: MWF exporty ─┐      Kalendáře techniků ◄──┐      Google Chat NEDOKONČENÉ ─┐
                       │                            │                               │
 Cloud Scheduler       ▼                            │                               ▼
 (každých 15 min) ─► Cloud Run job „appkoo-import“  │                   (čtení zpráv techniků)
                       │  nový export? → import → upsert zakázek → Claude na změněné poznámky
                       ▼                            │
                 Cloud SQL (PostgreSQL 16) ◄──── Cloud Run služba „appkoo-web“ ◄── koordinátorky
                       ▲                            │  fronty, plánovač, fráze do MWF,       (přihlášení
                       │                            │  zápis událostí do GCal                Google účtem
                 Vertex AI – Claude (region EU) ◄───┘                                        přes IAP)
```

Vše v jednom GCP projektu, v regionu EU. Nejbližší regiony: **europe-central2 (Varšava)**
nebo **europe-west3 (Frankfurt)**.

## Komponenty

| Komponenta | Služba GCP | Poznámka |
|---|---|---|
| Webová aplikace | **Cloud Run** (služba) | škáluje na nulu, platí se jen za běh |
| Přihlášení | **Identity-Aware Proxy (IAP)** | jen účty `@ictmount.com` ve skupině koordinace; aplikace nemusí řešit hesla |
| Automatický import | **Cloud Run job** + **Cloud Scheduler** | každých 15 min (Po–So 6–22); nový soubor `paw-grid-export-csv` ve složce MWF exportů → import |
| Databáze | **Cloud SQL for PostgreSQL 16** | privátní IP, denní zálohy, nejmenší instance stačí |
| Claude | **Vertex AI** (doporučeno) nebo Claude API | viz níže |
| Tajné údaje | **Secret Manager** | jen pokud se použije Claude API (klíč); s Vertex AI není potřeba |
| Logy a upozornění | **Cloud Logging / Monitoring** | upozornění e-mailem, když import selže nebo nepřijde nový export > 6 h |

## Claude: Vertex AI, nebo Claude API?

Aplikace umí obojí (`src/ai/client.ts`, přepíná se proměnnou `CLAUDE_PROVIDER`).

| | **Vertex AI** (doporučeno) | Claude API (Anthropic) |
|---|---|---|
| Smlouva a platba | přes stávající účet Google Cloud | samostatný účet a fakturace u Anthropic |
| Přihlášení | servisní účet GCP, žádný klíč | API klíč v Secret Manageru |
| Kde se zpracovávají data | region EU (`eu`) | podle nastavení účtu |
| Ochrana osobních údajů | v rámci smlouvy s Google Cloud | samostatná smlouva (DPA) s Anthropic |
| Fallback při odmítnutí | není – použije se vyhodnocení podle klíčových slov | server-side fallback |

Doporučení: **Vertex AI** – vše zůstane u jednoho dodavatele a v EU, odpadá správa API klíče.
V projektu je potřeba povolit Vertex AI API a v Model Garden zapnout model Claude Opus 5.5.

## Přístup k Google Workspace

Aplikace běží pod servisním účtem (např. `appkoo@<projekt>.iam.gserviceaccount.com`).

| Co | Jak | Kdo nastaví |
|---|---|---|
| Složka MWF exportů na Drive | sdílet složku se servisním účtem (čtenář) | vlastník složky (tmcz01) |
| Kalendáře techniků | sdílet každý kalendář se servisním účtem s právem „Provádět změny v událostech“ | správce kalendářů |
| Google Chat – skupina NEDOKONČENÉ | delegace v rámci domény (scope `chat.messages.readonly`) jménem jednoho uživatele | správce Google Workspace |

Delegace v rámci domény je potřeba jen pro Chat – Drive a kalendáře stačí nasdílet.

## Odhad měsíčních nákladů (orientační)

| Položka | Odhad |
|---|---|
| Cloud Run (web + import job) | do 10 USD |
| Cloud SQL (nejmenší instance, 10 GB, zálohy) | 15–30 USD |
| Claude (asi 300 vyhodnocení denně) | 80–120 USD |
| Ostatní (Scheduler, Secret Manager, logy) | do 5 USD |

## Co je potřeba od vás

1. **GCP projekt** – založit (např. `appkoo-prod`) s fakturačním účtem a dát mi informaci, kdo bude správce.
2. **Region** – Varšava (`europe-central2`), nebo Frankfurt (`europe-west3`)?
3. **Claude** – Vertex AI, nebo Claude API s vlastním klíčem?
4. **Správce Google Workspace** – kvůli delegaci pro čtení Google Chatu.
5. **Skupina uživatelů** – kdo smí aplikaci používat (např. Google skupina `koordinace@ictmount.com`).

## Kalendáře techniků – navázání na dnešní stav (15.10.2026)

Ověřeno na kalendáři technika: události zakázek mají název
`Hristov - FTTH CETIN O-8553361721 Zákazník SLA 17.10.2026 14:51 (AP)`, volná okna jsou události
`Hristov - VOLNY` po 2 hodinách vytvořené skriptem **SHEET2CAL** z tabulky, blokovaný čas
`Hristov - NEPLANOVAT`. Aplikace:

- čte volná okna z událostí VOLNY (vstup pro nabídku termínů a optimalizaci tras),
- při dohodnutí termínu **přepíše událost VOLNY** na událost zakázky (stejný tvar názvu + šablona
  z call scriptu + skryté ID zakázky) – nevznikají překryvy ani dvojí zápis,
- po každém importu porovná termíny MWF s kalendáři a hlásí rozpory.

**Rozhodnuto 15.10.2026: volná okna (směny techniků) zůstávají zatím mimo aplikaci** – generuje je
SHEET2CAL z tabulky (1–2× měsíčně, zelená barva = colorId 10). Aplikace okna jen čte a obsazuje.
Při přesunu zakázky vrátí původní událost zpět na „VOLNY“ (zelená), aby se slot neztratil
(SKILLS v5, část 22). Zápis zakázek do kalendáře převezme aplikace.
