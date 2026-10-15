-- Schéma databáze plánovací aplikace (PostgreSQL 16).
-- Časy jsou místní čas Praha (timestamp without time zone), stejně jako v MWF.

CREATE TABLE import_run (
  id            bigserial PRIMARY KEY,
  soubor        text NOT NULL,
  export_at     timestamp NOT NULL,
  importovano   timestamptz NOT NULL DEFAULT now(),
  pocet         integer NOT NULL,
  chybejici_sloupce text[] NOT NULL DEFAULT '{}'
);

-- Aktuální stav zakázky podle posledního importu (upsert podle ID aktivity)
CREATE TABLE zakazka (
  id_aktivity       text PRIMARY KEY,
  id_objednavky     text NOT NULL,           -- O-… (ID obj. v ext. systéme)
  id_objednavky_mwf text,                    -- interní ID objednávky v MWF
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
CREATE INDEX ON zakazka (id_objednavky);
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
