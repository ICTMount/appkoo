// Číselníky v sekci Konfigurace: definice, kontrola řádků, import a export CSV.
// Upravuje je vedoucí koordinace – v aplikaci po řádcích, nebo nahráním CSV souboru.
// Import CSV nic neukládá sám: vrátí náhled změn (nové / změněné / odebrané / chyby),
// který vedoucí potvrdí.

import { parseCsv } from "../import/csv.js";
import { PRAVIDLA, type NastaveniKontaktu } from "../domain/contact.js";
import { PODMINKY, PODMINKY_ID, PRIORITY, type PodminkaId, type Priorita, type PravidloPriority } from "../domain/priorita.js";
import { HOUR } from "../domain/time.js";

export type TypSloupce = "text" | "seznam" | "cislo" | "anoNe" | "vyber";

export interface Sloupec {
  klic: string;
  nazev: string; // hlavička v CSV a v aplikaci
  typ: TypSloupce;
  povinny?: boolean;
  hodnoty?: readonly string[]; // pro typ "vyber"
  /** hodnoty musí existovat v jiném číselníku (jen upozornění, ne chyba) */
  odkaz?: CiselnikId;
  /** starší / jiné názvy hlavičky, které import také přijme */
  aliasy?: string[];
}

export type CiselnikId =
  | "technici" | "typyAkci" | "koordinatorky" | "regiony" | "blokovaneLokality" | "kontakty"
  | "pravidlaPriority" | "nastaveniKontaktu";

export interface Ciselnik {
  id: CiselnikId;
  nazev: string;
  /** sloupec, který řádek jednoznačně určuje */
  klic: string;
  sloupce: Sloupec[];
}

export const CISELNIKY: Record<CiselnikId, Ciselnik> = {
  technici: {
    id: "technici",
    nazev: "Technici",
    klic: "jmeno",
    sloupce: [
      { klic: "jmeno", nazev: "Technik", typ: "text", povinny: true },
      { klic: "typyAkci", nazev: "Typy akcí", typ: "seznam", odkaz: "typyAkci" },
      { klic: "regiony", nazev: "Regiony", typ: "seznam", odkaz: "regiony" },
      { klic: "vyjezd", nazev: "Výjezd z (primární adresa)", typ: "text", aliasy: ["Výjezd z (adresa)", "Výjezd z"] },
      { klic: "vyjezd2", nazev: "Výjezd z (2. adresa)", typ: "text" },
      { klic: "kalendar", nazev: "ID kalendáře", typ: "text" },
      { klic: "nazevVKalendari", nazev: "Jméno v kalendáři", typ: "text" },
      { klic: "dovednosti", nazev: "Dovednosti v MWF", typ: "seznam" },
      { klic: "aktivni", nazev: "Aktivní", typ: "anoNe" },
      { klic: "email", nazev: "E-mail", typ: "text", aliasy: ["email", "mail"] },
    ],
  },
  typyAkci: {
    id: "typyAkci",
    nazev: "Typy akcí",
    klic: "kodMwf",
    sloupce: [
      { klic: "kodMwf", nazev: "Typ aktivity v MWF", typ: "text", povinny: true },
      { klic: "nazev", nazev: "Název v aplikaci", typ: "text", povinny: true },
      { klic: "skupina", nazev: "Skupina", typ: "vyber", hodnoty: ["FTTH", "PIV", "SAT/TV"], povinny: true },
      { klic: "delkaMin", nazev: "Délka práce (min)", typ: "cislo" },
      { klic: "routing", nazev: "Nedokončené na", typ: "text" },
    ],
  },
  koordinatorky: {
    id: "koordinatorky",
    nazev: "Koordinátorky",
    klic: "email",
    sloupce: [
      { klic: "email", nazev: "E-mail", typ: "text", povinny: true },
      { klic: "jmeno", nazev: "Jméno", typ: "text", povinny: true },
      { klic: "inicialy", nazev: "Iniciály", typ: "text" },
      { klic: "role", nazev: "Role", typ: "vyber", hodnoty: ["vedoucí", "operátorka"], povinny: true },
      { klic: "regiony", nazev: "Regiony", typ: "seznam", odkaz: "regiony" },
      { klic: "routing", nazev: "Nedokončené", typ: "vyber", hodnoty: ["", "FTTH Praha", "FTTH mimo Prahu", "PIV / SAT"] },
    ],
  },
  regiony: {
    id: "regiony",
    nazev: "Regiony",
    klic: "kod",
    sloupce: [
      { klic: "kod", nazev: "Kód", typ: "text", povinny: true },
      { klic: "nazev", nazev: "Region", typ: "text", povinny: true },
      { klic: "subregiony", nazev: "Subregiony v MWF", typ: "seznam" },
      { klic: "psc", nazev: "PSČ (začátky)", typ: "seznam" },
    ],
  },
  blokovaneLokality: {
    id: "blokovaneLokality",
    nazev: "Blacklist lokalit",
    klic: "adresa",
    sloupce: [
      { klic: "adresa", nazev: "Lokalita", typ: "text", povinny: true },
      { klic: "infrastruktura", nazev: "Infrastruktura", typ: "vyber", hodnoty: ["", "TMCZ", "CETIN", "VDF"] },
      { klic: "duvod", nazev: "Důvod", typ: "text", povinny: true },
      { klic: "od", nazev: "Od", typ: "text" },
    ],
  },
  pravidlaPriority: {
    id: "pravidlaPriority",
    nazev: "Pravidla priority",
    klic: "poradi",
    sloupce: [
      { klic: "poradi", nazev: "Pořadí", typ: "cislo", povinny: true },
      { klic: "podminka", nazev: "Podmínka", typ: "vyber", hodnoty: PODMINKY_ID, povinny: true },
      { klic: "parametr", nazev: "Parametr", typ: "cislo" },
      { klic: "priorita", nazev: "Priorita", typ: "vyber", hodnoty: PRIORITY, povinny: true },
      { klic: "poznamka", nazev: "Poznámka", typ: "text" },
    ],
  },
  nastaveniKontaktu: {
    id: "nastaveniKontaktu",
    nazev: "Nastavení kontaktování",
    klic: "parametr",
    sloupce: [
      { klic: "parametr", nazev: "Parametr", typ: "vyber", hodnoty: [
        "pokusuDenne", "prahObjemu", "odstupPokusuHodin", "dnu", "volaniOd", "volaniDo", "odstupSmsHodin", "minSms", "lhutaZakDni",
      ], povinny: true },
      { klic: "hodnota", nazev: "Hodnota", typ: "text", povinny: true },
      { klic: "poznamka", nazev: "Poznámka", typ: "text" },
    ],
  },
  kontakty: {
    id: "kontakty",
    nazev: "Kontakty",
    klic: "nazev",
    sloupce: [
      { klic: "nazev", nazev: "Kontakt", typ: "text", povinny: true },
      { klic: "cislo", nazev: "Číslo / adresa", typ: "text", povinny: true },
      { klic: "kdy", nazev: "Kdy", typ: "text" },
    ],
  },
};

export type Hodnota = string | number | boolean | string[] | null;
export type Polozka = Record<string, Hodnota>;

export interface Chyba {
  radek: number; // číslo řádku v CSV (hlavička = 1)
  sloupec?: string;
  zprava: string;
  zavaznost: "chyba" | "upozornění";
}

const ANO = new Set(["ano", "a", "yes", "y", "1", "true", "x"]);
const NE = new Set(["ne", "n", "no", "0", "false", ""]);
const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

function prevedHodnotu(s: Sloupec, raw: string): { hodnota: Hodnota; chyba?: string } {
  const v = raw.trim();
  switch (s.typ) {
    case "text":
      return { hodnota: v || null };
    case "seznam":
      return { hodnota: v ? v.split(/[,|]/).map((x) => x.trim()).filter(Boolean) : [] };
    case "cislo": {
      if (!v) return { hodnota: null };
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) ? { hodnota: n } : { hodnota: null, chyba: `„${v}“ není číslo` };
    }
    case "anoNe":
      if (ANO.has(norm(v))) return { hodnota: true };
      if (NE.has(norm(v))) return { hodnota: v ? false : true }; // prázdné = aktivní
      return { hodnota: null, chyba: `„${v}“ – použijte ano / ne` };
    case "vyber": {
      const shoda = s.hodnoty?.find((h) => norm(h) === norm(v));
      return shoda !== undefined
        ? { hodnota: shoda || null }
        : { hodnota: null, chyba: `„${v}“ – povolené hodnoty: ${s.hodnoty?.filter(Boolean).join(", ")}` };
    }
  }
}

export interface NahledImportu {
  polozky: Polozka[];
  nove: Polozka[];
  zmenene: { pred: Polozka; po: Polozka; sloupce: string[] }[];
  bezeZmeny: number;
  /** jsou v aplikaci, v CSV chybí – odeberou se jen v režimu „nahradit“ */
  chybiVCsv: Polozka[];
  chyby: Chyba[];
  lzeUlozit: boolean;
}

function vychozi(def: Ciselnik): Polozka {
  return Object.fromEntries(def.sloupce.map((s) => [s.klic, s.typ === "seznam" ? [] : s.typ === "anoNe" ? true : null]));
}

const stejne = (a: Hodnota | undefined, b: Hodnota | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Načte CSV (oddělovač ; nebo ,, hlavička = názvy sloupců nebo jejich klíče, na pořadí nezáleží)
 * a porovná ho s aktuálním obsahem číselníku.
 * `ostatni` = aktuální obsah ostatních číselníků pro kontrolu odkazů (např. kódy regionů).
 */
export function nahledImportu(
  id: CiselnikId,
  csvText: string,
  aktualni: Polozka[],
  ostatni: Partial<Record<CiselnikId, Polozka[]>> = {},
): NahledImportu {
  const def = CISELNIKY[id];
  const prvniRadek = csvText.split(/\r?\n/, 1)[0] ?? "";
  const oddelovac = (prvniRadek.match(/;/g)?.length ?? 0) >= (prvniRadek.match(/,/g)?.length ?? 0) ? ";" : ",";
  const [hlavicka = [], ...radky] = parseCsv(csvText.replace(/^﻿/, ""), oddelovac);
  const chyby: Chyba[] = [];

  const mapa = new Map<number, Sloupec>();
  hlavicka.forEach((h, i) => {
    const s = def.sloupce.find((x) => [x.nazev, x.klic, ...(x.aliasy ?? [])].some((n) => norm(n) === norm(h)));
    if (s) mapa.set(i, s);
    else if (h.trim()) chyby.push({ radek: 1, sloupec: h, zprava: `neznámý sloupec „${h}“ – bude ignorován`, zavaznost: "upozornění" });
  });
  for (const s of def.sloupce.filter((x) => x.povinny)) {
    if (![...mapa.values()].includes(s)) chyby.push({ radek: 1, sloupec: s.nazev, zprava: `chybí povinný sloupec „${s.nazev}“`, zavaznost: "chyba" });
  }

  const odkazy = new Map<CiselnikId, Set<string>>();
  for (const s of def.sloupce) {
    if (s.odkaz && ostatni[s.odkaz]) {
      const k = CISELNIKY[s.odkaz].klic;
      odkazy.set(s.odkaz, new Set(ostatni[s.odkaz]!.map((p) => norm(String(p[k] ?? "")))));
    }
  }

  const polozky: Polozka[] = [];
  const videne = new Set<string>();
  radky.forEach((r, i) => {
    const cislo = i + 2;
    // Jen sloupce, které v CSV jsou – chybějící sloupce u existujících řádků zůstanou beze změny
    const p: Polozka = {};
    mapa.forEach((s, idx) => {
      const { hodnota, chyba } = prevedHodnotu(s, r[idx] ?? "");
      // sloupec typu seznam může být v CSV víckrát (např. dvakrát „Typy akcí“) – hodnoty se sloučí
      const dosud = p[s.klic];
      p[s.klic] = Array.isArray(dosud) && Array.isArray(hodnota) ? [...new Set([...dosud, ...hodnota])] : hodnota;
      if (chyba) chyby.push({ radek: cislo, sloupec: s.nazev, zprava: chyba, zavaznost: "chyba" });
      if (s.odkaz && Array.isArray(hodnota) && odkazy.has(s.odkaz)) {
        const nezname = hodnota.filter((h) => !odkazy.get(s.odkaz!)!.has(norm(h)));
        if (nezname.length) {
          chyby.push({ radek: cislo, sloupec: s.nazev, zprava: `neznámé: ${nezname.join(", ")} (není v číselníku ${CISELNIKY[s.odkaz].nazev})`, zavaznost: "upozornění" });
        }
      }
    });
    for (const s of def.sloupce.filter((x) => x.povinny)) {
      if (s.klic in p && (p[s.klic] === null || p[s.klic] === "")) chyby.push({ radek: cislo, sloupec: s.nazev, zprava: "povinná hodnota chybí", zavaznost: "chyba" });
    }
    const klic = norm(String(p[def.klic] ?? ""));
    if (klic && videne.has(klic)) chyby.push({ radek: cislo, sloupec: def.sloupce.find((s) => s.klic === def.klic)!.nazev, zprava: "duplicitní řádek – v CSV už je", zavaznost: "chyba" });
    videne.add(klic);
    polozky.push(p);
  });

  const podleKlice = new Map(aktualni.map((p) => [norm(String(p[def.klic] ?? "")), p]));
  const nove: Polozka[] = [];
  const zmenene: NahledImportu["zmenene"] = [];
  let bezeZmeny = 0;
  for (const p of polozky) {
    const pred = podleKlice.get(norm(String(p[def.klic] ?? "")));
    if (!pred) nove.push({ ...vychozi(def), ...p });
    else {
      const sloupce = [...mapa.values()].filter((s) => !stejne(pred[s.klic], p[s.klic])).map((s) => s.nazev);
      if (sloupce.length) zmenene.push({ pred, po: { ...pred, ...p }, sloupce });
      else bezeZmeny++;
    }
  }
  const chybiVCsv = aktualni.filter((p) => !videne.has(norm(String(p[def.klic] ?? ""))));

  return { polozky, nove, zmenene, bezeZmeny, chybiVCsv, chyby, lzeUlozit: !chyby.some((c) => c.zavaznost === "chyba") };
}

/** Export číselníku do CSV (středník, UTF-8 s BOM – Excel ho otevře s diakritikou) */
export function exportCsv(id: CiselnikId, polozky: Polozka[]): string {
  const def = CISELNIKY[id];
  const pole = (v: Hodnota | undefined) => {
    const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "ano" : "ne") : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const radky = [def.sloupce.map((s) => s.nazev).join(";"), ...polozky.map((p) => def.sloupce.map((s) => pole(p[s.klic])).join(";"))];
  return "﻿" + radky.join("\r\n") + "\r\n";
}

// ---------- převod číselníků na nastavení pro výpočty ----------

export function pravidlaPriority(polozky: Polozka[]): PravidloPriority[] {
  return polozky
    .filter((p) => (p.podminka as string) in PODMINKY)
    .map((p) => ({
      poradi: Number(p.poradi),
      podminka: p.podminka as PodminkaId,
      parametr: typeof p.parametr === "number" ? p.parametr : null,
      priorita: p.priorita as Priorita,
      poznamka: (p.poznamka as string | null) ?? null,
    }));
}

export const PARAMETRY_KONTAKTU = {
  pokusuDenne: "Pokusů denně: 1, 2 nebo „auto“ (podle objemu práce)",
  prahObjemu: "Auto: nad kolik zakázek k volání na koordinátorku volat jen 1× denně",
  odstupPokusuHodin: "Odstup pokusů v hodinách (norma TMCZ min. 4)",
  dnu: "Počet pracovních dní kontaktování před ZAK (norma TMCZ min. 3)",
  volaniOd: "Volat od (HH:MM)",
  volaniDo: "Volat do (HH:MM)",
  odstupSmsHodin: "Odstup SMS v hodinách (norma TMCZ min. 18)",
  minSms: "Min. počet SMS za 3 PD (norma TMCZ min. 2)",
  lhutaZakDni: "Lhůta PEP u ZAK v kalendářních dnech",
} as const;

export const VYCHOZI_NASTAVENI_KONTAKTU: Polozka[] = [
  { parametr: "pokusuDenne", hodnota: "auto", poznamka: PARAMETRY_KONTAKTU.pokusuDenne },
  { parametr: "prahObjemu", hodnota: "40", poznamka: PARAMETRY_KONTAKTU.prahObjemu },
  { parametr: "odstupPokusuHodin", hodnota: "4", poznamka: PARAMETRY_KONTAKTU.odstupPokusuHodin },
  { parametr: "dnu", hodnota: "3", poznamka: PARAMETRY_KONTAKTU.dnu },
  { parametr: "volaniOd", hodnota: "08:00", poznamka: PARAMETRY_KONTAKTU.volaniOd },
  { parametr: "volaniDo", hodnota: "19:00", poznamka: PARAMETRY_KONTAKTU.volaniDo },
  { parametr: "odstupSmsHodin", hodnota: "18", poznamka: PARAMETRY_KONTAKTU.odstupSmsHodin },
  { parametr: "minSms", hodnota: "2", poznamka: PARAMETRY_KONTAKTU.minSms },
  { parametr: "lhutaZakDni", hodnota: "5", poznamka: PARAMETRY_KONTAKTU.lhutaZakDni },
];

/**
 * Nastavení kontaktování z číselníku. Minimum normy TMCZ nejde snížit – nižší hodnota se
 * nahradí minimem a vrátí se upozornění. `kVolaniNaKoordinatorku` slouží pro režim „auto“.
 */
export function nastaveniKontaktu(polozky: Polozka[], kVolaniNaKoordinatorku = 0): { nastaveni: NastaveniKontaktu; lhutaZakDni: number; upozorneni: string[] } {
  const v = new Map(polozky.map((p) => [String(p.parametr), String(p.hodnota ?? "").trim()]));
  const upozorneni: string[] = [];
  const cislo = (k: string, vychozi: number, min?: number) => {
    const n = Number((v.get(k) ?? "").replace(",", "."));
    if (!v.has(k) || !Number.isFinite(n) || v.get(k) === "") return vychozi;
    if (min !== undefined && n < min) {
      upozorneni.push(`${k} = ${n} je pod minimem normy TMCZ (${min}) – použito ${min}.`);
      return min;
    }
    return n;
  };
  const cas = (k: string, vychozi: number) => {
    const m = (v.get(k) ?? "").match(/^(\d{1,2})[:.](\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : vychozi;
  };
  const pd = v.get("pokusuDenne") ?? "auto";
  const pokusuDenne = pd.toLowerCase() === "auto" ? (kVolaniNaKoordinatorku > cislo("prahObjemu", 40) ? 1 : 2) : Math.max(1, Math.min(2, cislo("pokusuDenne", 2)));
  return {
    nastaveni: {
      ...PRAVIDLA,
      pokusuDenne,
      odstupPokusu: cislo("odstupPokusuHodin", 4, 4) * HOUR,
      dnu: cislo("dnu", 3, 3),
      volaniOd: cas("volaniOd", PRAVIDLA.volaniOd),
      volaniDo: cas("volaniDo", PRAVIDLA.volaniDo),
      odstupSms: cislo("odstupSmsHodin", 18, 18) * HOUR,
      minSms: cislo("minSms", 2, 2),
    },
    lhutaZakDni: cislo("lhutaZakDni", 5),
    upozorneni,
  };
}
