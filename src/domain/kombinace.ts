// Kombinované objednávky: FTTH + IPTV (TVoI, set-top box) a FTTH + MESH (Wi-Fi jednotky navíc).
// Z exportu MWF: „P8: Základný produkt“ = „FTTH Subscription; TVoI“ (skupiny oddělené „;“ ve stejném pořadí
// jako v „P9: Kategória TT“ = „All:1|HDD:0/0|bezHDD:0/0|HDDready:0/0|HAG:0|ONT:1|WIFI:0; All:1|HDD:0/0|bezHDD:1/0|…“).
// Ve skupině TVoI je počet set-top boxů v HDD / bezHDD / HDDready (první číslo), WIFI:n > 0 = mesh jednotky.
// Záložně i sloupec „Produkt“ („INTERNET_CHANNEL(ADD), TV(ADD)“) – některé exporty P8 nemají.

export interface Kombinace {
  iptv: boolean;
  /** počet set-top boxů (0 = v P9 neuvedeno) */
  setTopBoxu: number;
  /** počet mesh / Wi-Fi jednotek navíc */
  mesh: number;
}

const cislo = (s: string, klic: string) => {
  const m = new RegExp(`(?:^|\\|)${klic}:(\\d+)`).exec(s);
  return m ? Number(m[1]) : 0;
};

export function kombinaceZakazky(z: { zakladniProdukt?: string; kategorieTt?: string; produkt?: string }): Kombinace | null {
  const p8 = z.zakladniProdukt ?? "";
  const p9 = z.kategorieTt ?? "";
  const iptv = /TVoI/i.test(p8) || /\bTV\((ADD|MODIFY)\)/i.test(z.produkt ?? "");
  let setTopBoxu = 0;
  let mesh = 0;
  const produkty = p8.split(";").map((s) => s.trim());
  p9.split(";").forEach((skupina, i) => {
    const s = skupina.trim();
    mesh += cislo(s, "WIFI");
    if (/TVoI/i.test(produkty[i] ?? "") || (!produkty[i] && (cislo(s, "HDD") || cislo(s, "bezHDD") || cislo(s, "HDDready")))) {
      setTopBoxu += cislo(s, "HDD") + cislo(s, "bezHDD") + cislo(s, "HDDready");
    }
  });
  if (!iptv && !mesh) return null;
  return { iptv, setTopBoxu, mesh };
}

/** „FTTH + IPTV (1× set-top box) + MESH (2)“ */
export function popisKombinace(k: Kombinace): string {
  const casti = ["FTTH"];
  if (k.iptv) casti.push(`IPTV${k.setTopBoxu ? ` (${k.setTopBoxu}× set-top box)` : ""}`);
  if (k.mesh) casti.push(`MESH (${k.mesh})`);
  return casti.join(" + ");
}

/** Krátký tvar do názvu události v kalendáři: „FTTH+IPTV“, „FTTH+MESH“, „FTTH+IPTV+MESH“ */
export const zkratkaKombinace = (k: Kombinace) => ["FTTH", ...(k.iptv ? ["IPTV"] : []), ...(k.mesh ? ["MESH"] : [])].join("+");
