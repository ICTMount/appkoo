// Kombinované objednávky: FTTH + IPTV (TVoI, set-top box) a FTTH + MESH (Wi-Fi jednotky navíc).
// Dva zdroje, které se doplňují:
// 1. export MWF: „P8: Základný produkt“ = „FTTH Subscription; TVoI“ (skupiny oddělené „;“ ve stejném pořadí
//    jako v „P9: Kategória TT“ = „All:1|HDD:0/0|bezHDD:0/0|HDDready:0/0|HAG:0|ONT:1|WIFI:0; All:1|HDD:0/0|bezHDD:1/0|…“);
//    ve skupině TVoI je počet set-top boxů v HDD / bezHDD / HDDready (první číslo), WIFI:n > 0 = mesh jednotky.
//    Záložně i sloupec „Produkt“ („INTERNET_CHANNEL(ADD), TV(ADD)“) – některé exporty P8 nemají.
// 2. notifikační PDF: tabulka „Zoznam KZ“ (řádek na každé zařízení: AP – Access Point / Mesh, TVoI – Set-top-box, ONT)
//    včetně způsobu doručení (Technik = přiveze technik), a v instalačním předpisu „Wi-Fi pokrytie: Predpokladaný počet AP : n“.
//    Mesh bývá spolehlivě jen v PDF (u CETIN zakázek export WIFI nenese).

export interface Kombinace {
  iptv: boolean;
  /** počet set-top boxů (0 = neuvedeno) */
  setTopBoxu: number;
  /** počet mesh / Wi-Fi jednotek navíc */
  mesh: number;
  /** Spôsob doručenia ze Zoznamu KZ (např. „Technik“), pokud je v PDF */
  doruceni: { mesh?: string; stb?: string };
  /** odkud to víme */
  zdroj: ("export" | "pdf")[];
}

/** Část notifikačního PDF, která je k tomu potřeba (viz ingest/notifikace.ts) */
export interface NotifikaceProKombinaci {
  zariadenia?: { druh: string; aktivita: string; doruceni: string }[] | null;
  predpis?: string[];
}

const cislo = (s: string, klic: string) => {
  const m = new RegExp(`(?:^|\\|)${klic}:(\\d+)`).exec(s);
  return m ? Number(m[1]) : 0;
};

function zExportu(z: { zakladniProdukt?: string; kategorieTt?: string; produkt?: string }): { iptv: boolean; setTopBoxu: number; mesh: number } {
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
  return { iptv, setTopBoxu, mesh };
}

function zPdf(n: NotifikaceProKombinaci): { setTopBoxu: number; mesh: number; doruceni: Kombinace["doruceni"] } | null {
  if (!n.zariadenia?.length) return null;
  const pridavana = n.zariadenia.filter((x) => !/^(Delete|Remove|Zru)/i.test(x.aktivita));
  const stb = pridavana.filter((x) => x.druh === "stb");
  const ap = pridavana.filter((x) => x.druh === "mesh");
  // počet AP: z předpisu („Predpokladaný počet AP : 2“), řádky tabulky bývají v PDF zdvojené
  const zPredpisu = Number((n.predpis ?? []).map((r) => /Predpokladaný počet AP\s*:\s*(\d+)/i.exec(r)?.[1]).find(Boolean) ?? 0);
  const doruceni: Kombinace["doruceni"] = {};
  if (ap[0]?.doruceni) doruceni.mesh = ap[0].doruceni;
  if (stb[0]?.doruceni) doruceni.stb = stb[0].doruceni;
  return { setTopBoxu: stb.length, mesh: ap.length ? zPredpisu || ap.length : 0, doruceni };
}

export function kombinaceZakazky(
  z: { zakladniProdukt?: string; kategorieTt?: string; produkt?: string },
  n?: NotifikaceProKombinaci | null,
): Kombinace | null {
  const e = zExportu(z);
  const p = n ? zPdf(n) : null;
  const iptv = e.iptv || !!p?.setTopBoxu;
  const setTopBoxu = Math.max(e.setTopBoxu, p?.setTopBoxu ?? 0);
  const mesh = Math.max(e.mesh, p?.mesh ?? 0);
  if (!iptv && !mesh) return null;
  const zdroj: Kombinace["zdroj"] = [];
  if (e.iptv || e.mesh) zdroj.push("export");
  if (p && (p.setTopBoxu || p.mesh)) zdroj.push("pdf");
  return { iptv, setTopBoxu, mesh, doruceni: p?.doruceni ?? {}, zdroj };
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

/** Přiveze zařízení technik (Spôsob doručenia = Technik)? null = v PDF neuvedeno */
export const privezeTechnik = (d?: string): boolean | null => (d ? /technik/i.test(d) : null);
