// Migrace zákazníka od jiného poskytovatele – poznají se z poznámky MWF a mají tvrdá pravidla termínu:
//   SWAP   (DSL T-Mobile na CETIN) – instalace DO 7 DNÍ od CASEID, jinak je zákazník bez internetu.
//   FIS MOP (O2 na CETIN)          – termín instalace NESMÍ být před datem portace.

import type { Zaznam } from "../import/notes.js";

const DEN = 24 * 60 * 60 * 1000;

export interface Migrace {
  typ: "SWAP" | "FIS MOP";
  /** CASEID z poznámky (SWAP i FIS MOP), pokud je uvedený */
  caseId: string | null;
  /** kdy byl CASEID / SWAP zapsán – od toho běží 7 dní */
  od: Date | null;
  /** SWAP: nejzazší den instalace (od + 7 dní) */
  nejpozdeji: Date | null;
  /** FIS MOP: datum portace z poznámky („portace 28.10.2026“) */
  portace: Date | null;
}

const datum = (s: string | undefined): Date | null => {
  const m = s?.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  return m ? new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!)) : null;
};

export function migrace(z: { poznamka?: string; uvodPoznamky?: string; zaznamy?: Zaznam[] }): Migrace | null {
  const zaznamy = z.zaznamy ?? [];
  const cely = [z.poznamka ?? "", z.uvodPoznamky ?? "", ...zaznamy.map((r) => r.text)].join("\n");
  const fisMop = /FIS\s*MOP|\bMOP\b/i.test(cely);
  const swap = /\bSWAP\b/i.test(cely);
  if (!fisMop && !swap) return null;
  const caseId = cely.match(/CASE\s*ID\s*[:.]?\s*([A-Z0-9-]{4,})/i)?.[1] ?? null;
  // záznam, kde se migrace / CASEID objevuje poprvé (nejstarší) – od něj běží lhůta
  const relevantni = zaznamy.filter((r) => /\bSWAP\b|FIS\s*MOP|\bMOP\b|CASE\s*ID/i.test(r.text)).sort((a, b) => a.at.getTime() - b.at.getTime());
  const od = relevantni[0]?.at ?? null;
  if (fisMop) {
    const portace = datum(cely.match(/portac\w*[^\d]{0,40}(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/i)?.[1]);
    return { typ: "FIS MOP", caseId, od, nejpozdeji: null, portace };
  }
  return { typ: "SWAP", caseId, od, nejpozdeji: od ? new Date(od.getTime() + 7 * DEN) : null, portace: null };
}

/**
 * Obsazená zásuvka (stav vlákna USED) – zlaté pravidlo 3: termín NEPLÁNOVAT, dokud PEP nepotvrdí uvolnění.
 * Pozná se z poznámky („USED“, „obsazená zásuvka“, „zásuvka je obsazená“, „čeká na uvolnění zásuvky“…).
 * Když je SWAP / FIS MOP, řídí se zakázka jejich pravidly a tenhle příznak se nehlásí.
 * Novější zápis „FREE“ / „zásuvka uvolněná“ příznak ruší.
 */
export interface ZasuvkaUsed {
  /** kdy byl stav zapsán (nejnovější zmínka) */
  at: Date | null;
  /** úryvek zápisu */
  text: string;
}

const USED = /\bUSED\b|obsazen[áaéou]\w*\s+(?:opt\w*\s+)?z[áa]suvk|z[áa]suvk\w*\s+(?:je\s+|byla\s+)?obsazen|uvoln[ěe]n[íi]\s+z[áa]suvk|z[áa]suvk\w*\s+(?:na\s+)?uvoln[ěe]n[íi]|[čc]ek[áa]\w*\s+na\s+PEP/i;
const FREE = /\bFREE\b|z[áa]suvk\w*\s+(?:je\s+|už\s+|byla\s+)?(?:uvoln[ěe]n[áaé]|voln[áaé])|uvoln[ěe]n[áaé]\s+z[áa]suvk/i;

export function zasuvkaUsed(z: { poznamka?: string; uvodPoznamky?: string; zaznamy?: Zaznam[] }): ZasuvkaUsed | null {
  if (migrace(z)) return null;
  const zaznamy = [...(z.zaznamy ?? [])].sort((a, b) => b.at.getTime() - a.at.getTime()); // nejnovější první
  const posledni = zaznamy.find((r) => USED.test(r.text) || FREE.test(r.text));
  if (posledni) {
    if (FREE.test(posledni.text) && !USED.test(posledni.text)) return null;
    if (USED.test(posledni.text)) return { at: posledni.at, text: posledni.text.trim().slice(0, 160) };
  }
  const uvod = z.uvodPoznamky ?? z.poznamka ?? "";
  if (USED.test(uvod) && !FREE.test(uvod)) return { at: null, text: uvod.trim().slice(0, 160) };
  return null;
}
