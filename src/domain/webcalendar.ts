// Zakázka z webového kalendáře (webcalendar): zákazník si termín vybral sám na webu operátora,
// zakázka nám přišla už přidělená s dohodnutým termínem. V poznámce MWF je záznam s autorem „webcalendar“
// nebo se značkou „WBCS_WEB_CZ“ (jako autor, nebo v textu záznamu):
//   "[Dojednávania] 20.10.2026 8:54, webcalendar: Zákazník: Bára_Kynclová (23.10.2026, 08:00 - 10:00)"

import type { Zaznam } from "../import/notes.js";

export interface Webcalendar {
  /** kdy záznam vznikl */
  at: Date;
  /** termín, který si zákazník vybral („23.10.2026 08:00–10:00“), pokud ho jde z textu přečíst */
  termin: string | null;
}

const ZNACKA = /web\s*-?\s*calendar|webkalend|WBCS[_\s-]*WEB[_\s-]*CZ/i;

export function webcalendar(z: { zaznamy?: Zaznam[] }): Webcalendar | null {
  // autor záznamu „webcalendar“, nebo značka WBCS_WEB_CZ (autor i text záznamu – např. „WBCS_WEB_CZ: Zákazník: …“)
  const r = (z.zaznamy ?? []).find((x) => ZNACKA.test(x.autor) || /WBCS[_\s-]*WEB[_\s-]*CZ/i.test(x.text));
  if (!r) return null;
  const m = r.text.match(/\((\d{1,2}\.\d{1,2}\.\d{4}),?\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\)/);
  return { at: r.at, termin: m ? `${m[1]} ${m[2]}–${m[3]}` : null };
}
