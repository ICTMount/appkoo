// Příjem MWF exportu do aplikace – společný pro všechny cesty:
//   e-mail na definovanou adresu · nahrání přímo v aplikaci · nahrání do složky na Google Drive.
// Každý soubor projde stejným posouzením: formát, úplnost sloupců, duplicita (stejný obsah
// už přišel jinou cestou) a stáří (starší export než poslední importovaný se nepoužije,
// aby nepřepsal novější stav).

import { createHash } from "node:crypto";
import { basename } from "node:path";
import { local } from "../domain/time.js";
import { importExport, type VysledekImportu } from "../import/mwfExport.js";

export type Zdroj = "email" | "upload" | "drive";

export interface DoslyExport {
  zdroj: Zdroj;
  nazev: string;
  obsah: Buffer;
  /** kdy soubor do aplikace dorazil (e-mail přijat, soubor nahrán / vytvořen na Drive) */
  prijato: Date;
  /** e-mail odesílatele nebo uživatel, který soubor nahrál */
  odesilatel?: string;
  /** ID zprávy v Gmailu / ID souboru na Drive – aby se stejný zdroj nečetl dvakrát */
  zdrojId?: string;
}

export interface StavPrijmu {
  /** čas exportu posledního úspěšně importovaného souboru */
  posledniExportAt: Date | null;
  /** otisky (SHA-256) už zpracovaných souborů */
  zpracovane: Set<string>;
}

export type Posouzeni =
  | { akce: "importovat"; hash: string; exportAt: Date; import: VysledekImportu }
  | { akce: "preskocit"; hash: string; duvod: string }
  | { akce: "odmitnout"; hash: string; duvod: string };

export const MAX_VELIKOST = 20 * 1024 * 1024;

/** Sloupce, bez kterých import nedává smysl */
const KLICOVE_SLOUPCE = ["ID aktivity", "ID obj. v ext. systéme", "Stav", "Typ aktivity", "Poznámka"];

/**
 * Čas exportu z názvu souboru „zakazky paw-grid-export-csv 20261014 18_01.csv“.
 * MWF ho při exportu nedává do obsahu, proto: název souboru, jinak čas přijetí.
 */
export function casExportu(nazev: string, prijato: Date): { at: Date; zNazvu: boolean } {
  const m = basename(nazev).match(/(20\d{2})(\d{2})(\d{2})[ _-]?(\d{2})[_:.-]?(\d{2})/);
  if (!m) return { at: prijato, zNazvu: false };
  const [, y, mo, d, h, mi] = m.map(Number) as number[];
  return { at: local(y!, mo!, d!, h!, mi!), zNazvu: true };
}

export function otisk(obsah: Buffer): string {
  return createHash("sha256").update(obsah).digest("hex");
}

export function posudExport(d: DoslyExport, stav: StavPrijmu): Posouzeni {
  const hash = otisk(d.obsah);
  if (!/\.csv$/i.test(d.nazev)) return { akce: "odmitnout", hash, duvod: `„${d.nazev}“ není CSV – exportujte v MWF přes Exportovať tabuľku: CSV.` };
  if (d.obsah.length > MAX_VELIKOST) return { akce: "odmitnout", hash, duvod: "Soubor je větší než 20 MB." };
  if (stav.zpracovane.has(hash)) return { akce: "preskocit", hash, duvod: "Stejný export už byl zpracován (přišel jinou cestou nebo podruhé)." };

  const { at } = casExportu(d.nazev, d.prijato);
  const vysledek = importExport(d.obsah, at);
  const chybi = KLICOVE_SLOUPCE.filter((s) => vysledek.chybejiciSloupce.includes(s));
  if (chybi.length) return { akce: "odmitnout", hash, duvod: `V exportu chybí sloupce: ${chybi.join(", ")}. Zkontrolujte uložené nastavení tabulky v MWF.` };
  if (!vysledek.zakazky.length) return { akce: "odmitnout", hash, duvod: "Export neobsahuje žádné zakázky." };
  if (stav.posledniExportAt && at <= stav.posledniExportAt) {
    return { akce: "preskocit", hash, duvod: "Export je starší než poslední importovaný – novější stav se nepřepisuje." };
  }
  return { akce: "importovat", hash, exportAt: at, import: vysledek };
}

/**
 * Zpracuje dávku došlých souborů (např. několik e-mailů najednou) od nejstaršího exportu po nejnovější.
 * Vrací rozhodnutí ke každému souboru; stav (poslední export, otisky) průběžně aktualizuje.
 */
export function zpracujDosle(
  dosle: DoslyExport[],
  stav: StavPrijmu,
  povoleniOdesilatele: string[] = ["@ictmount.com"],
): { export: DoslyExport; posouzeni: Posouzeni }[] {
  const serazene = [...dosle].sort((a, b) => casExportu(a.nazev, a.prijato).at.getTime() - casExportu(b.nazev, b.prijato).at.getTime());
  return serazene.map((d) => {
    const posouzeni: Posouzeni =
      d.zdroj === "email" && !povolenyOdesilatel(d.odesilatel ?? "", povoleniOdesilatele)
        ? { akce: "odmitnout", hash: otisk(d.obsah), duvod: `Odesílatel ${d.odesilatel || "neznámý"} není mezi povolenými.` }
        : posudExport(d, stav);
    // odmítnutý soubor se smí poslat znovu (opravený nebo od povoleného odesílatele)
    if (posouzeni.akce !== "odmitnout") stav.zpracovane.add(posouzeni.hash);
    if (posouzeni.akce === "importovat") stav.posledniExportAt = posouzeni.exportAt;
    return { export: d, posouzeni };
  });
}

/** E-mail smí poslat jen povolený odesílatel: celá adresa nebo doména začínající „@“ */
export function povolenyOdesilatel(odesilatel: string, povoleni: string[]): boolean {
  const adresa = (odesilatel.match(/<([^>]+)>/)?.[1] ?? odesilatel).trim().toLowerCase();
  return povoleni.some((p) => {
    const v = p.trim().toLowerCase();
    return v.startsWith("@") ? adresa.endsWith(v) : adresa === v;
  });
}
