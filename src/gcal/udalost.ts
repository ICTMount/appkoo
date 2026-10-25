// Událost v kalendáři technika podle šablony z call scriptu (kap. „Kalendář v Google Workspace“).
// Aplikace ji vyplní z MWF a z kontrolního seznamu hovoru – koordinátorka nic nepřepisuje ručně.
// Do skrytých vlastností události se uloží ID zakázky, takže párování s MWF nezávisí na textu.

import type { Zakazka } from "../import/mwfExport.js";
import { fmtDate, fmtTime } from "../domain/time.js";

/** Údaje zjištěné při hovoru (kontrolní seznam call scriptu) */
export interface UdajeHovoru {
  novaInstalace?: boolean;
  zasuvka?: string; // číslo nebo „foto“
  /** časová flexibilita zákazníka: ne = pevný termín, den = flex ten den, obecne = flex obecně (důchodce, rodičovská, HO) */
  flex?: "ne" | "den" | "obecne";
  /** upřesnění flexu („jen do 14 h – odchod k lékaři“) */
  flexPoznamka?: string;
  iptv?: boolean;
  patro?: string;
  byt?: string;
  patraPristupna?: boolean | null;
  stoupacka?: "ANO" | "NE" | "NEVÍM";
  vzdalenostOdStoupackyM?: number | null;
  listyOmezeniSvj?: "ANO" | "NE" | "NEVÍM";
  souhlasSVrtanim?: boolean | null;
  umisteniKz?: string;
  elZasuvka?: boolean | null;
  kz?: string; // ROUTE / BRIDGE + STB
  predpojen?: boolean | null;
  podb?: string;
  instalacniPredpis?: string;
  caseid?: string;
}

export interface UdalostKalendare {
  summary: string;
  location: string;
  description: string;
  start: { dateTime: string; timeZone: "Europe/Prague" };
  end: { dateTime: string; timeZone: "Europe/Prague" };
  extendedProperties: { private: { appkoo: string; objednavka: string; s7: string } };
}

const ano = (v: boolean | null | undefined) => (v === true ? "ANO" : v === false ? "NE" : "?");
/** Date („Praha v UTC“) → "2026-10-16T10:00:00" pro pole s timeZone Europe/Prague */
const mistni = (d: Date) => d.toISOString().slice(0, 19);

/** Řádek FLEX v popisu události – plánovač pozná „flex“ a zakázku nabídne k přesunu; „FLEX: NE“ pozná jako pevný termín */
export function textFlex(flex: NonNullable<UdajeHovoru["flex"]>, poznamka?: string): string {
  const p = poznamka ? ` – ${poznamka}` : "";
  if (flex === "ne") return `FLEX: NE – pevný termín${p}`;
  if (flex === "den") return `FLEX ten den${p}`;
  return `FLEX obecně (důchodce / rodičovská / HO)${p}`;
}

export function sestavUdalost(
  z: Zakazka,
  technik: string,
  od: Date,
  do_: Date,
  h: UdajeHovoru = {},
  slaKonec?: Date | null,
  koordinatorka?: string, // iniciály, např. „AP“
): UdalostKalendare {
  const sluzba = z.typAktivity.includes("PIV") ? "PIV" : "FTTH";
  // Stejný tvar jako dnešní události v kalendářích techniků:
  // „Bridge Hristov - FTTH CETIN O-8553401092 Bažantová SLA 17.10.2026 17:42 (AP)“
  const infra = z.infrastruktura === "TMCZ" ? "" : ` ${z.infrastruktura}`;
  const sla = slaKonec ? ` SLA ${fmtDate(slaKonec)} ${fmtTime(slaKonec)}` : "";
  const bridge = /bridge/i.test(h.kz ?? "") ? "Bridge " : "";
  const ini = koordinatorka ? ` (${koordinatorka})` : "";
  const radky = [
    `ZAKÁZKA: ${z.idObjednavkyZaklad}${z.idS7 ? ` · S7 ${z.idS7}` : ""}`,
    `TEL: ${z.telefony.join(", ")}`,
    ...(h.flex ? [textFlex(h.flex, h.flexPoznamka)] : []),
    `${h.novaInstalace === false ? "Existující" : "Nová instalace"}${h.zasuvka ? ` – zásuvka ${h.zasuvka}` : ""}`,
    `INSTALACE: Optický internet${h.iptv ? " / IPTV" : ""}`,
    `ČÍSLO PATRA A BYTU: ${h.patro ?? "?"} / ${h.byt ?? "?"}`,
    `PATRA VOLNĚ PŘÍSTUPNÁ: ${ano(h.patraPristupna)}`,
    `STOUPAČKA JE ZAJIŠTĚNA (nebo jen čtyřhran): ${h.stoupacka ?? "NEVÍM"}`,
    `VZDÁLENOST OD STOUPAČKY (řádově): ${h.vzdalenostOdStoupackyM ?? "?"} metrů`,
    `STÁVAJÍCÍ LIŠTY/OMEZENÍ V LIŠTOVÁNÍ OD SVJ: ${h.listyOmezeniSvj ?? "NEVÍM"}`,
    `SOUHLAS S VRTÁNÍM: ${ano(h.souhlasSVrtanim)}${h.souhlasSVrtanim === false ? " = vrátit na PEP, nebo STORNO" : ""}`,
    `KONCOVÉ ZAŘÍZENÍ UMÍSTÍME V: ${h.umisteniKz ?? "dle konzultace s technikem"} – EL. ZÁSUVKA: ${ano(h.elZasuvka)}`,
    `KZ: ${h.kz ?? (z.balik || "?")}`,
    `PŘEDPOJEN: ${ano(h.predpojen)}`,
    ...(z.infrastruktura === "TMCZ" ? [`PODB (adresa): ${h.podb ?? ""}`] : []),
    ...(h.caseid ? [`CASEID: ${h.caseid}`] : []),
    "",
    "INSTALAČNÍ PŘEDPIS:",
    h.instalacniPredpis ?? "(zkopírovat z ticketu)",
  ];
  return {
    summary: `${bridge}${technik} - ${sluzba}${infra} ${z.idObjednavkyZaklad} ${z.zakaznik}${sla}${ini}`,
    location: [z.adresa, z.psc.replace(/^=+/, "")].filter(Boolean).join(", "),
    description: radky.join("\n"),
    start: { dateTime: mistni(od), timeZone: "Europe/Prague" },
    end: { dateTime: mistni(do_), timeZone: "Europe/Prague" },
    extendedProperties: { private: { appkoo: z.idAktivity, objednavka: z.idObjednavkyZaklad, s7: z.idS7 } },
  };
}
