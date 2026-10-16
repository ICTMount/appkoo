// Import číselníku z CSV do databáze.
// Použití: npm run ciselnik -- <číselník> <soubor.csv> [--ulozit] [--nahradit]
//   bez --ulozit jen vypíše náhled (co přibude, co se změní, chyby)
//   --nahradit  položky, které v CSV chybí, se deaktivují
// Příklad: npm run ciselnik -- technici technici.csv --ulozit

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { CISELNIKY, nahledImportu, type CiselnikId } from "../config/ciselniky.js";
import { nactiCiselnik, ulozImport } from "../db/ciselniky.js";
import { pgDb } from "../db/db.js";

async function main() {
  const [zadano, soubor, ...prepinace] = process.argv.slice(2);
  const ALIASY: Record<string, string> = { blacklist: "blokovaneLokality", uzivatele: "koordinatorky", planovani: "nastaveniPlanovani" };
  const id = (zadano && ALIASY[zadano]) || zadano;
  if (!id || !soubor || !(id in CISELNIKY)) {
    throw new Error(`Použití: npm run ciselnik -- <${[...Object.keys(CISELNIKY), "blacklist", "uzivatele", "planovani"].join("|")}> <soubor.csv> [--ulozit] [--nahradit]`);
  }
  const db = pgDb();
  const cid = id as CiselnikId;
  const n = nahledImportu(cid, readFileSync(soubor, "utf8"), await nactiCiselnik(db, cid, false));
  console.log(`${CISELNIKY[cid].nazev}: ${n.polozky.length} řádků – nové ${n.nove.length}, změněné ${n.zmenene.length}, beze změny ${n.bezeZmeny}, v CSV chybí ${n.chybiVCsv.length}`);
  for (const c of n.chyby) console.log(`  ${c.zavaznost === "chyba" ? "CHYBA" : "pozor"} ř. ${c.radek}${c.sloupec ? ` (${c.sloupec})` : ""}: ${c.zprava}`);
  for (const z of n.zmenene) console.log(`  změna ${String(z.po[CISELNIKY[cid].klic])}: ${z.sloupce.join(", ")}`);
  if (!prepinace.includes("--ulozit")) {
    console.log("Náhled – nic neuloženo. Uložte přidáním --ulozit.");
    return;
  }
  const r = await ulozImport(db, cid, n, `csv: ${basename(soubor)}`, process.env.USER ?? "cli", prepinace.includes("--nahradit"));
  console.log(`Uloženo: přidáno ${r.pridano}, změněno ${r.zmeneno}, deaktivováno ${r.odebrano}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
