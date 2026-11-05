-- Schéma databáze plánovací aplikace (PostgreSQL 16).
-- Časy jsou místní čas Praha (timestamp without time zone), stejně jako v MWF.

-- Každý došlý export (e-mail / nahrání v aplikaci / Google Drive) a co se s ním stalo
CREATE TABLE import_run (
  id            bigserial PRIMARY KEY,
  zdroj         text NOT NULL CHECK (zdroj IN ('email', 'upload', 'drive', 'cli')),
  soubor        text NOT NULL,
  hash          text NOT NULL,                -- SHA-256 obsahu; stejný soubor jinou cestou = duplicita
  odesilatel    text,                         -- e-mail odesílatele / uživatel, který nahrál
  zdroj_id      text,                         -- ID zprávy v Gmailu / ID souboru na Drive
  prijato       timestamptz NOT NULL DEFAULT now(),
  export_at     timestamp,                    -- čas exportu (z názvu souboru)
  vysledek      text NOT NULL CHECK (vysledek IN ('importovano', 'preskoceno', 'odmitnuto')),
  duvod         text,
  pocet         integer,
  chybejici_sloupce text[] NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX ON import_run (hash) WHERE vysledek = 'importovano';

-- Aktuální stav zakázky podle posledního importu (upsert podle ID aktivity)
CREATE TABLE zakazka (
  id_aktivity       text PRIMARY KEY,
  id_objednavky     text NOT NULL,           -- O-… (ID obj. v ext. systéme)
  id_objednavky_mwf text,                    -- interní ID objednávky v MWF
  id_objednavky_zaklad text NOT NULL,        -- O- bez přípon (:1, -13075814) – párování s GCal a chatem
  id_s7             text,
  technik           text,                    -- Pracovný zdroj
  stav_mwf          text NOT NULL,
  typ_aktivity      text NOT NULL,
  infrastruktura    text NOT NULL CHECK (infrastruktura IN ('TMCZ', 'CETIN', 'VDF', 'jiná')),
  predobjednavka    boolean NOT NULL,
  zakaznik          text,
  telefony          text[] NOT NULL DEFAULT '{}',
  psc               text,
  adresa            text,
  subregion         text,
  balik             text,
  produkt           text,
  prideleno         timestamp,
  termin_od         timestamp,
  termin_do         timestamp,
  parkovani         text,
  parkovani_skupina text CHECK (parkovani_skupina IN ('DOD', 'ZAK')),
  parkovani_nestandardni text,
  vysledek          text,
  preferovany_datum timestamp,
  rfs               timestamp,
  do_splneni_min    integer,
  poznamka          text NOT NULL DEFAULT '',
  poznamka_hash     text NOT NULL,           -- Claude se volá jen při změně
  pocet_mv          integer NOT NULL DEFAULT 0,
  prvni_import      bigint NOT NULL REFERENCES import_run(id),
  posledni_import   bigint NOT NULL REFERENCES import_run(id),
  uzavreno          timestamp                -- zmizela z exportu (instalace / storno)
);
CREATE INDEX ON zakazka (id_objednavky_zaklad);
CREATE INDEX ON zakazka (id_s7);

-- Historie stavů (nahrazuje stav_zakazek_hist.json z dashboardu)
CREATE TABLE zakazka_historie (
  id_aktivity  text NOT NULL REFERENCES zakazka(id_aktivity),
  import_id    bigint NOT NULL REFERENCES import_run(id),
  stav_mwf     text NOT NULL,
  parkovani    text,
  vysledek     text,
  termin_od    timestamp,
  technik      text,
  PRIMARY KEY (id_aktivity, import_id)
);

-- Pokusy o kontakt zapsané v aplikaci (z MWF se dopočítávají z poznámek)
CREATE TABLE pokus (
  id           bigserial PRIMARY KEY,
  id_aktivity  text NOT NULL REFERENCES zakazka(id_aktivity),
  at           timestamp NOT NULL,
  dovolano     boolean NOT NULL,
  sms          boolean NOT NULL DEFAULT false,
  koordinatorka text NOT NULL,
  fraze        text                          -- text připravený pro MWF
);

-- Vytěžení poznámek přes Claude – vždy návrh, potvrzuje koordinátorka
CREATE TABLE note_eval (
  id            bigserial PRIMARY KEY,
  id_aktivity   text NOT NULL REFERENCES zakazka(id_aktivity),
  poznamka_hash text NOT NULL,
  zdroj         text NOT NULL CHECK (zdroj IN ('claude', 'klicova_slova')),
  model         text,
  prompt_verze  text,
  vysledek      jsonb NOT NULL,
  vytvoreno     timestamptz NOT NULL DEFAULT now(),
  -- oprava koordinátorky = podklad pro testovací sadu
  opraveno      jsonb,
  opravila      text,
  UNIQUE (id_aktivity, poznamka_hash, prompt_verze)
);

-- Číselníky v sekci Konfigurace (technici, typy akcí, koordinátorky, regiony, blokované lokality, kontakty)
CREATE TABLE ciselnik_polozka (
  ciselnik   text NOT NULL,
  klic       text NOT NULL,
  data       jsonb NOT NULL,
  aktivni    boolean NOT NULL DEFAULT true,
  zmeneno    timestamptz NOT NULL DEFAULT now(),
  zmenil     text NOT NULL,
  PRIMARY KEY (ciselnik, klic)
);

-- Historie změn číselníků – kdo, kdy, co a odkud (formulář / CSV)
CREATE TABLE ciselnik_zmena (
  id         bigserial PRIMARY KEY,
  ciselnik   text NOT NULL,
  klic       text NOT NULL,
  akce       text NOT NULL CHECK (akce IN ('pridano', 'zmeneno', 'odebrano')),
  pred       jsonb,
  po         jsonb,
  zdroj      text NOT NULL,              -- 'formulář' nebo 'csv: <název souboru>'
  zmenil     text NOT NULL,
  kdy        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ciselnik_zmena (ciselnik, kdy DESC);

-- Souřadnice adres (geokódování se volá jen jednou na adresu)
CREATE TABLE geokod (
  adresa     text PRIMARY KEY,               -- normalizovaná adresa + PSČ
  lat        double precision,
  lon        double precision,
  presnost   text NOT NULL,                  -- 'adresa' | 'ulice' | 'obec' | 'nenalezeno'
  zdroj      text NOT NULL,                  -- 'google' | 'mapy.com' | 'rucne'
  vytvoreno  timestamptz NOT NULL DEFAULT now(),
  mestska_cast text                          -- „Praha 4 – Krč“; '' = služba ji nevrátila, NULL = zatím nezjišťováno
);

-- Události v kalendářích techniků, které vytvořila / spáruje aplikace
CREATE TABLE gcal_udalost (
  id_aktivity   text NOT NULL REFERENCES zakazka(id_aktivity),
  kalendar      text NOT NULL,               -- ID kalendáře technika
  event_id      text NOT NULL,
  zacatek       timestamp NOT NULL,
  konec         timestamp NOT NULL,
  vytvorila_app boolean NOT NULL,            -- false = existující událost spárovaná podle ID
  zmeneno       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kalendar, event_id)
);
CREATE INDEX ON gcal_udalost (id_aktivity);

-- Historie aktivit uživatelů (Konfigurace → Historie uživatelů); záznamy starší 180 dní se mažou
CREATE TABLE IF NOT EXISTS uzivatel_log (
  id      bigserial PRIMARY KEY,
  kdy     timestamptz NOT NULL DEFAULT now(),
  email   text NOT NULL,
  akce    text NOT NULL,                     -- hledani | detail | terminy | formular | zapis | technik | konfigurace | ulozeni | odepreno | uvod
  objekt  text,                              -- ID aktivity zakázky
  detail  text,
  stav    integer NOT NULL                   -- HTTP stav odpovědi
);
CREATE INDEX IF NOT EXISTS uzivatel_log_email_kdy ON uzivatel_log (email, kdy DESC);

-- Notifikační PDF z MWF (Drive složka NOTIFIKACE_SLOZKA, soubor = <MWF ID aktivity>.pdf); vytváří si i aplikace sama
CREATE TABLE IF NOT EXISTS notifikace_pdf (
  soubor_id     text PRIMARY KEY,            -- ID souboru na Drive
  nazev         text NOT NULL,
  vznik         timestamptz NOT NULL,        -- createdTime souboru
  id_aktivity   text,                        -- MWF ID aktivity z textu PDF
  id_objednavky text,                        -- Identifikátor O-…
  id_objednavky_zaklad text,                 -- O- bez přípon – stačí shoda O-čísla se zakázkou
  id_s7         text[],                      -- ID S7 z PDF (ID objednávky/TT, část za # v Identifikátoru) – párování s „ID S7 obj.“
  predpis       text[],                      -- řádky oddílu „Inštalačný predpis k“
  cpe_mode      text,                        -- Zoznam KZ → CPE Mode
  zoznam        text,                        -- Zoznam KZ → Zoznam kompatibilných zariadení
  priebeh       jsonb,                       -- Priebeh optický: [{nazovLinky, aUzol, zAkcia}]
  chyba         text,                        -- proč se PDF nepodařilo přečíst (NULL = v pořádku)
  nacteno       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifikace_pdf_aktivita ON notifikace_pdf (id_aktivity, vznik DESC);
CREATE INDEX IF NOT EXISTS notifikace_pdf_objednavka ON notifikace_pdf (id_objednavky_zaklad, vznik DESC);

-- Složka zakázky na Disku (zakládá se jen tlačítkem v detailu; src/google/slozky.ts si tabulku založí i sama)
CREATE TABLE IF NOT EXISTS slozka_zakazky (
  objednavka text PRIMARY KEY,               -- O-číslo bez přípon
  slozka_id  text NOT NULL,                  -- ID složky na Disku
  cesta      text NOT NULL,                  -- „2026 / 2026_45 / APPKOO / AppKoo O-…“
  zalozil    text NOT NULL,
  zalozeno   timestamptz NOT NULL DEFAULT now()
);

-- Přílohy zpráv (Chat, e-mail) uložené do složky zakázky (src/google/prilohy.ts)
CREATE TABLE IF NOT EXISTS soubor_zakazky (
  objednavka text NOT NULL,
  klic       text NOT NULL,                  -- chat:<media> | chat:drive:<id> | email:<zpráva>:<příloha>
  drive_id   text NOT NULL,
  nazev      text NOT NULL,
  ulozil     text NOT NULL,
  ulozeno    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (objednavka, klic)
);

-- Synchronizace kalendářů techniků a Google Chatu (importní úloha, src/zdroje/sync.ts) – web v nich hledá bez volání Google
CREATE TABLE IF NOT EXISTS kalendar_udalost (
  kalendar       text NOT NULL,                -- ID kalendáře technika
  id             text NOT NULL,                -- ID události
  kalendar_nazev text NOT NULL,
  summary        text NOT NULL,
  location       text NOT NULL,
  description    text NOT NULL,                -- zkráceno na 2000 znaků
  cas            timestamptz,                  -- začátek („Praha v UTC“)
  odkaz          text,
  hledani        text NOT NULL,                -- summary + description + location, malá písmena bez diakritiky
  PRIMARY KEY (kalendar, id)
);
CREATE INDEX IF NOT EXISTS kalendar_udalost_cas ON kalendar_udalost (cas);
CREATE TABLE IF NOT EXISTS chat_zprava (
  name        text PRIMARY KEY,                -- spaces/…/messages/…
  prostor     text NOT NULL,
  vlakno      text,
  create_time timestamptz NOT NULL,
  odesilatel  text,
  text        text NOT NULL,
  prilohy     jsonb,                           -- Priloha[] (hledani.ts)
  hledani     text NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_zprava_prostor_cas ON chat_zprava (prostor, create_time DESC);
CREATE TABLE IF NOT EXISTS sync_stav (
  klic   text PRIMARY KEY,                     -- kalendare | chat | chat:<prostor>
  kdy    timestamptz NOT NULL DEFAULT now(),
  pocet  integer NOT NULL DEFAULT 0,
  nazev  text
);
-- trigramový index pro LIKE '%…%' (když je rozšíření povolené; aplikace si ho zkusí založit sama)
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS kalendar_udalost_hledani_trgm ON kalendar_udalost USING gin (hledani gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS chat_zprava_hledani_trgm ON chat_zprava USING gin (hledani gin_trgm_ops);
