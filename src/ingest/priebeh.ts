// „Priebeh optický“ z notifikačního PDF: tabulka linek (Názov linky, A uzol, …, Z akcia).
// Buňky jsou úzké a text v nich zalomený i uprostřed slova, proto se čte z pozic slov
// (`pdftotext -bbox-layout`): sloupce podle záhlaví, řádky podle svislých mezer ve sloupci „Z akcia“.
// Koordinátorku zajímají řádky se „Z akcia: Vytvoriť“ – tam musí technik něco udělat.

import { execFile } from "node:child_process";

export interface RadekPriebehu {
  nazovLinky: string;
  aUzol: string;
  /** Akcia na linke (EXIST / NEW) */
  akciaNaLinke?: string;
  zAkcia: string;
}

interface Slovo {
  x: number; // střed
  y: number; // střed
  yMin: number;
  yMax: number;
  xMin: number;
  xMax: number;
  text: string;
}

/** Slova stránek z XHTML výstupu `pdftotext -bbox-layout` */
export function slovaZBbox(html: string): Slovo[][] {
  const stranky: Slovo[][] = [];
  for (const m of html.matchAll(/<page[^>]*>([\s\S]*?)<\/page>/g)) {
    const slova: Slovo[] = [];
    for (const w of m[1]!.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      const xMin = +w[1]!, yMin = +w[2]!, xMax = +w[3]!, yMax = +w[4]!;
      slova.push({ xMin, xMax, yMin, yMax, x: (xMin + xMax) / 2, y: (yMin + yMax) / 2, text: odXml(w[5]!) });
    }
    stranky.push(slova);
  }
  return stranky;
}

const odXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Text buňky: řádky podle y, slova na řádku mezerou; zalomené řádky se spojí (zlom bývá uprostřed slova). */
export function textBunky(slova: Slovo[]): string {
  const s = [...slova].sort((a, b) => a.y - b.y || a.x - b.x);
  const radky: string[] = [];
  let aktualni: Slovo[] = [];
  for (const w of s) {
    if (aktualni.length && Math.abs(w.y - aktualni[0]!.y) > 3) {
      radky.push(aktualni.sort((a, b) => a.x - b.x).map((x) => x.text).join(" "));
      aktualni = [];
    }
    aktualni.push(w);
  }
  if (aktualni.length) radky.push(aktualni.sort((a, b) => a.x - b.x).map((x) => x.text).join(" "));
  let vysledek = "";
  for (const r of radky) {
    if (!vysledek) {
      vysledek = r;
      continue;
    }
    const konec = vysledek.at(-1)!;
    const zacatek = r[0]!;
    const pismeno = (c: string) => /\p{L}/u.test(c);
    const cislice = (c: string) => /\d/.test(c);
    const mezera = (pismeno(konec) && cislice(zacatek)) || (cislice(konec) && pismeno(zacatek)) || (/\p{Ll}/u.test(konec) && /\p{Lu}/u.test(zacatek));
    vysledek += (mezera ? " " : "") + r;
  }
  return vysledek;
}

interface Sloupce {
  nazov: [number, number];
  aUzol: [number, number];
  akciaNaLinke: [number, number];
  zAkcia: [number, number];
}

/** Hranice sloupců ze záhlaví tabulky (středy popisků, hranice = poloviny mezi sousedy) */
function sloupceZeZahlavi(slova: Slovo[], odY: number): { sloupce: Sloupce; konecZahlavi: number } | null {
  const nazov = slova.find((w) => w.text === "Názov" && w.y >= odY);
  if (!nazov) return null;
  const vZahlavi = slova.filter((w) => w.y >= nazov.yMin - 2 && w.y <= nazov.yMin + 28);
  const uzly = vZahlavi.filter((w) => w.text === "uzol").sort((a, b) => a.x - b.x);
  const porty = vZahlavi.filter((w) => w.text === "port").sort((a, b) => a.x - b.x);
  const akcia = vZahlavi.find((w) => w.text === "akcia");
  const akciaNaLinke = vZahlavi.find((w) => w.text === "Akcia");
  const farba = vZahlavi.find((w) => w.text === "Farba");
  const typ = vZahlavi.find((w) => w.text === "Typ");
  if (uzly.length < 2 || !porty.length || !akcia || !typ) return null;
  const stred = (w: Slovo) => {
    // popisek „A uzol“ – přičíst předcházející jednopísmenné slovo
    const pred = vZahlavi.find((p) => Math.abs(p.y - w.y) < 3 && p.xMax <= w.xMin && w.xMin - p.xMax < 6 && p.text.length === 1);
    return ((pred ? pred.xMin : w.xMin) + w.xMax) / 2;
  };
  const cNazov = nazov.x, cAUzol = stred(uzly[0]!), cAPort = stred(porty[0]!), cZUzol = stred(uzly[1]!), cZAkcia = stred(akcia), cTyp = typ.x;
  const cAkcia = akciaNaLinke?.x ?? (cAPort + cZUzol) / 2;
  const cFarba = farba?.x ?? (cAPort + cAkcia) / 2;
  const konecZahlavi = Math.max(...vZahlavi.map((w) => w.yMax));
  return {
    sloupce: {
      nazov: [cNazov - (cAUzol - cNazov), (cNazov + cAUzol) / 2],
      aUzol: [(cNazov + cAUzol) / 2, (cAUzol + cAPort) / 2],
      akciaNaLinke: [(cFarba + cAkcia) / 2, (cAkcia + cZUzol) / 2],
      zAkcia: [(cZUzol + cZAkcia) / 2, (cZAkcia + cTyp) / 2],
    },
    konecZahlavi,
  };
}

const vRozsahu = (w: Slovo, [od, do_]: [number, number]) => w.x >= od && w.x < do_;

/** Řádky tabulky „Priebeh optický“ ze všech stránek (tabulka může pokračovat na další straně) */
export function parsujPriebeh(bboxHtml: string): RadekPriebehu[] {
  const stranky = slovaZBbox(bboxHtml);
  const vysledek: RadekPriebehu[] = [];
  let vSekci = false;
  let sloupce: Sloupce | null = null;
  for (const slova of stranky) {
    const nadpisy = slova.filter((w) => w.text === "Priebeh").sort((a, b) => a.y - b.y);
    const dalsi = (w: Slovo) => slova.find((n) => Math.abs(n.y - w.y) < 3 && n.xMin > w.xMax && n.xMin - w.xMax < 8)?.text ?? "";
    let odY = vSekci ? -Infinity : Infinity;
    let doY = Infinity;
    for (const n of nadpisy) {
      const t = dalsi(n);
      if (/^optick/i.test(t)) {
        odY = n.yMax;
        vSekci = true;
      } else if (vSekci && n.yMax > odY) {
        doY = Math.min(doY, n.yMin);
      }
    }
    if (!vSekci || odY === Infinity) continue;
    const zahlavi = sloupceZeZahlavi(slova, odY);
    let zacatek = odY;
    if (zahlavi) {
      sloupce = zahlavi.sloupce;
      zacatek = zahlavi.konecZahlavi;
    }
    if (!sloupce) continue;
    const oblast = slova.filter((w) => w.y > zacatek && w.y < doY);
    // řádky: skupiny slov ve sloupci „Z akcia“ oddělené svislou mezerou
    const kotvy = oblast.filter((w) => vRozsahu(w, sloupce!.zAkcia)).sort((a, b) => a.y - b.y);
    const skupiny: Slovo[][] = [];
    for (const w of kotvy) {
      const posl = skupiny.at(-1);
      if (posl && w.yMin - posl.at(-1)!.yMax < 6) posl.push(w);
      else skupiny.push([w]);
    }
    for (let i = 0; i < skupiny.length; i++) {
      const sk = skupiny[i]!;
      const horni = i === 0 ? zacatek : (skupiny[i - 1]!.at(-1)!.yMax + sk[0]!.yMin) / 2;
      const dolni = i === skupiny.length - 1 ? doY : (sk.at(-1)!.yMax + skupiny[i + 1]![0]!.yMin) / 2;
      const vRadku = oblast.filter((w) => w.y >= horni && w.y < dolni);
      vysledek.push({
        nazovLinky: textBunky(vRadku.filter((w) => vRozsahu(w, sloupce!.nazov))),
        aUzol: textBunky(vRadku.filter((w) => vRozsahu(w, sloupce!.aUzol))),
        akciaNaLinke: textBunky(vRadku.filter((w) => vRozsahu(w, sloupce!.akciaNaLinke))),
        zAkcia: textBunky(sk),
      });
    }
    if (doY !== Infinity) vSekci = false; // sekce skončila (další nadpis „Priebeh …“)
  }
  return vysledek;
}

/** Jeden řádek pro koordinátorku: Názov linky / A uzol / Akcia na linke / Z akcia */
export const radekPriebehu = (r: RadekPriebehu) => [r.nazovLinky, r.aUzol, r.akciaNaLinke, r.zAkcia].filter((x) => x).join(" / ");

/** Řádky, kde má technik něco udělat: 5. sloupec „Akcia na linke“ = NEW nebo Vytvoriť (záloha: Z akcia = Vytvoriť) */
export const kVytvoreni = (radky: RadekPriebehu[]) =>
  radky.filter((r) => {
    const a = (r.akciaNaLinke ?? "").replace(/\s+/g, "");
    return a ? /^(new|vytvor)/i.test(a) : /vytvor/i.test(r.zAkcia.replace(/\s+/g, ""));
  });

/** XHTML s pozicemi slov (`pdftotext -bbox-layout`) */
export function bboxZPdf(pdf: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = execFile("pdftotext", ["-bbox-layout", "-enc", "UTF-8", "-", "-"], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) reject(new Error(`pdftotext (bbox) selhal: ${err.message}`));
      else resolve(stdout);
    });
    p.stdin?.on("error", () => undefined);
    p.stdin?.end(pdf);
  });
}
