// Uživatelé a role. Přihlášení dělá Google (IAP); kdo smí do aplikace a co v ní smí, určuje
// číselník Uživatelé (v Konfiguraci). Správci ze SPRAVCI mají přístup vždy – nejde se tak vyřadit.
//
//   správce        plánování + zápis + Konfigurace (číselníky, uživatelé)
//   koordinátorka  plánování + zápis do kalendáře
//   jen čtení      vidí zakázky a nabídky, nezapisuje

import { nactiCiselnik } from "../db/ciselniky.js";
import type { Dotaz } from "../db/db.js";

export type Role = "spravce" | "koordinator" | "cteni";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export function roleZCiselniku(v: unknown): Role | null {
  const r = norm(String(v ?? ""));
  if (r === "spravce" || r === "vedouci") return "spravce";
  if (r === "koordinatorka" || r === "koordinator" || r === "operatorka") return "koordinator";
  if (r === "jen cteni" || r === "cteni") return "cteni";
  return null;
}

export const POPIS_ROLE: Record<Role, string> = { spravce: "správce", koordinator: "koordinátorka", cteni: "jen čtení" };

/**
 * Role přihlášeného uživatele, nebo null = nemá přístup.
 * Dokud je číselník Uživatelé prázdný, platí přechodně seznam `povoleni` (POVOLENI_UZIVATELE) s rolí koordinátorka.
 */
export async function roleUzivatele(
  db: Dotaz,
  email: string,
  spravci: string[],
  povoleni: (email: string) => boolean,
): Promise<Role | null> {
  const e = email.trim().toLowerCase();
  if (spravci.some((s) => s.trim().toLowerCase() === e)) return "spravce";
  const uzivatele = await nactiCiselnik(db, "koordinatorky");
  if (!uzivatele.length) return povoleni(e) ? "koordinator" : null;
  const u = uzivatele.find((p) => String(p.email ?? "").trim().toLowerCase() === e);
  if (!u || u.aktivni === false) return null;
  return roleZCiselniku(u.role) ?? "cteni";
}
