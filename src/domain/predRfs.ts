// Instalace před datem RFS (postup TMCZ „Postup technika – Instalace služby před datem RFS“ v1.0).
// MWF export příznak „Inštalácia pred RFS“ nenese (je jen v detailu MWF / PDA, kde je datum RFS červeně);
// podle postupu ho ale poznáme z exportu: aktivita Inst_Pristupu_FTTH, vlastník sítě TMCZ, vyplněné datum RFS v budoucnu a ID S7.
// Předobjednávky (Predobjednavka_*) jsou jiný případ – mají vlastní štítek a pravidla.

import { isoDate } from "./time.js";

export interface InstalacePredRfs {
  /** datum RFS („Praha v UTC“) */
  rfs: Date;
  /** „11.11.2026“ */
  rfsText: string;
}

export function instalacePredRfs(
  z: { typAktivity: string; infrastruktura: string; predobjednavka: boolean; rfs: Date | null; idS7: string },
  now: Date,
): InstalacePredRfs | null {
  if (z.predobjednavka || !z.rfs) return null;
  if (z.infrastruktura !== "TMCZ") return null;
  if (!/Inst_Pristupu_FTTH/i.test(z.typAktivity)) return null;
  if (!z.idS7.replace(/^=+/, "").trim()) return null; // taková aktivita musí mít ID S7 (bez něj nejde o instalaci před RFS)
  if (isoDate(z.rfs) <= isoDate(now)) return null; // RFS dnes nebo v minulosti = běžná zakázka
  return { rfs: z.rfs, rfsText: isoDate(z.rfs).split("-").reverse().join(".") };
}

/** Jedna věta pro koordinátorku do upozornění plánovače */
export const upozorneniPredRfs = (p: InstalacePredRfs) =>
  `Instalace před RFS ${p.rfsText} (postup TMCZ): termín lze domluvit hned. Zákazníkovi: službu instalujeme v předstihu, aby po uvolnění lokality nečekal na technika; o spuštění přijde SMS. Neříkat „nebude fungovat“.`;

/** Řádek do popisu události v kalendáři technika */
export const radekUdalostiPredRfs = (p: InstalacePredRfs) =>
  `INSTALACE PŘED RFS ${p.rfsText}: standardní instalace + měření, aktivace ONT (Power + PON), pak vytáhnout napájecí zdroj. Do PP Výhrady technika: „Aktivace služby: ${p.rfsText}“. Zákazník v den RFS zapojí ONT (SMS), nechá zapnuté kvůli FW.`;
