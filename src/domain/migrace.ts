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
