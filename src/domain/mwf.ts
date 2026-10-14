// Číselníky MWF – přesné hodnoty tak, jak je MWF exportuje (spec kap. 4, 5, 9.3, 9.5).

export const PARKOVANI = {
  ODKLAD: "Zákazník - odklad termínu",
  LEGISLATIVA: "Legislatívne problémy",
  POCASIE: "Počasie",
  NEDOSTUPNY: "Zákazník - nedostupný",
} as const;
export type Parkovani = (typeof PARKOVANI)[keyof typeof PARKOVANI];

/** DOD = parkuje Vegacom, ZAK = řeší PEP (T-Mobile) */
export const SKUPINA_PARKOVANI: Record<Parkovani, "DOD" | "ZAK"> = {
  [PARKOVANI.ODKLAD]: "DOD",
  [PARKOVANI.LEGISLATIVA]: "DOD",
  [PARKOVANI.POCASIE]: "DOD",
  [PARKOVANI.NEDOSTUPNY]: "ZAK",
};

/** MWF je umožňuje, Vegacom je nepoužívá – při importu jen označit (spec 9.4 C) */
export const PARKOVANI_NESTANDARDNI = [
  "Materiál",
  "Zákazník - termín - rieši dodávateľ",
  "Zákazník - termín - rieši BO",
] as const;

export function jeParkovani(s: string): s is Parkovani {
  return Object.values(PARKOVANI).includes(s as Parkovani);
}

/** Sloupec „Výsledok dojednávania“ */
export const VYSLEDEK = [
  "Dohodnutý termín",
  "Nezastihnutý",
  "Odklad",
  "Márny výjazd",
  "Storno",
  "Chybný kontakt",
  "Problém",
] as const;
export type Vysledek = (typeof VYSLEDEK)[number];

/** Důvody zamítnutí povolené normou R-280-244 (spec 9.5) */
export const ZAMITNUTI = [
  "Storno – zákazník",
  "Nesprávně založená objednávka",
  "N-Technické překážky realizace SAT TV",
  "N-Technické překážky realizace PIV - kapacita",
  "N-Technické překážky realizace PIV - kvalita",
  "N-legislatívní/technická překážka – Optický internet / Optická TV",
] as const;

export const KODY_R = {
  r_0: "nefunkční aplikace",
  r_1: "zákazník",
  r_2: "zákazník – smlouva s jiným poskytovatelem (JP)",
  r_3: "T-Mobile",
  r_4: "kapacita Vegacom",
} as const;
export type KodR = keyof typeof KODY_R;
export type KodMv = `mv_${number}`;
export type Kod = KodR | KodMv;

const KOD_RE = /\b(r_[0-4]|mv_\d{1,2})\b/gi;

/** Všechny kódy r_X / mv_N v textu, v pořadí výskytu (malými písmeny) */
export function najdiKody(text: string): Kod[] {
  return [...text.matchAll(KOD_RE)].map((m) => m[1]!.toLowerCase() as Kod);
}

/** Nejvyšší dosavadní mv_N v poznámkách (0 = žádný marný výjezd) */
export function pocetMv(text: string): number {
  return najdiKody(text)
    .filter((k): k is KodMv => k.startsWith("mv_"))
    .reduce((max, k) => Math.max(max, Number(k.slice(3))), 0);
}

/** Další číslo marného výjezdu v řadě (spec kap. 4: mv_N lze jen po mv_(N-1)) */
export function dalsiMv(text: string): KodMv {
  return `mv_${pocetMv(text) + 1}`;
}

export type StranaPricinyMv = "tmcz" | "zakaznik";

/** Parkování a kódy po marném výjezdu podle strany příčiny (spec 9.4 A, B) */
export function parkovaniPoMv(strana: StranaPricinyMv, dosavadniPoznamky: string) {
  const mv = dalsiMv(dosavadniPoznamky);
  return strana === "tmcz"
    ? { parkovani: PARKOVANI.LEGISLATIVA, kody: [mv, "r_3"] as Kod[], volitelneKody: [] as Kod[] }
    : { parkovani: PARKOVANI.ODKLAD, kody: [mv] as Kod[], volitelneKody: ["r_1"] as Kod[] };
}
