// Načte MWF export (CSV) a vypíše souhrn: stavy, parkování, plán kontaktů, upozornění.
// Použití: npm run import -- <cesta.csv> [--ai N]
//   --ai N  vytěží poznámky N zakázek v dojednávání přes Claude (vyžaduje ANTHROPIC_API_KEY)

import { readFileSync } from "node:fs";
import { lhutaZak, planKontaktu } from "../domain/contact.js";
import { fmtDate, fmtTime, tedPraha } from "../domain/time.js";
import { casExportu } from "../ingest/prijem.js";
import { importExport } from "../import/mwfExport.js";
import { pokusyZPoznamky } from "../import/notes.js";
import { vytezPoznamky } from "../ai/noteExtraction.js";

const count = <T>(xs: T[]) =>
  Object.fromEntries([...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>())].sort((a, b) => b[1] - a[1]));

async function main() {
  const [soubor, ...args] = process.argv.slice(2);
  if (!soubor) throw new Error("Chybí cesta k MWF exportu.");
  const { at: now, zNazvu } = casExportu(soubor, tedPraha());
  if (!zNazvu) console.log("Čas exportu nejde zjistit z názvu souboru – použit aktuální čas.");
  const { zakazky, chybejiciSloupce } = importExport(readFileSync(soubor), now);

  console.log(`Export ${fmtDate(now)} ${fmtTime(now)} – ${zakazky.length} zakázek`);
  if (chybejiciSloupce.length) console.log("Chybějící sloupce:", chybejiciSloupce);
  console.log("Stav MWF:", count(zakazky.map((z) => z.stavMwf)));
  console.log("Parkování:", count(zakazky.map((z) => z.parkovani ?? z.parkovaniNestandardni ?? "–")));
  console.log("Výsledek dojednávání:", count(zakazky.map((z) => z.vysledek ?? "–")));

  const nestandardni = zakazky.filter((z) => z.parkovaniNestandardni);
  for (const z of nestandardni) console.log(`! nestandardní parkování ${z.idObjednavky}: ${z.parkovaniNestandardni}`);

  const kDojednani = zakazky.filter((z) => !z.predobjednavka && !z.termin && !z.parkovani);
  const plany = kDojednani.map((z) => ({ z, plan: planKontaktu(pokusyZPoznamky(z.zaznamy), now) }));
  console.log(`\nK dojednání (bez termínu a parkování): ${kDojednani.length}`);
  console.log("Stav kontaktu:", count(plany.map((p) => p.plan.stav)));
  for (const { z, plan } of plany.filter((p) => p.plan.stav === "navrh_zak")) {
    console.log(`→ návrh ZAK ${z.idObjednavky} (${plan.kompletniDny} dny × 2 pokusy, SMS ${plan.sms.odeslano})`);
  }

  const zak = zakazky.filter((z) => z.parkovaniSkupina === "ZAK");
  for (const z of zak) {
    const zaparkovano = z.zaznamy.findLast((x) => x.typ === "Parkovanie")?.at;
    if (!zaparkovano) continue;
    const l = lhutaZak(zaparkovano, now);
    const kdy = `${fmtDate(l.konec)} ${fmtTime(l.konec)}`;
    if (l.uplynula) console.log(`⚠ ZAK ${z.idObjednavky}: lhůta PEP uplynula ${kdy} – ověřit, zda PEP zakázku nezamítl`);
    else if (l.urgovat) console.log(`⚠ ZAK ${z.idObjednavky}: lhůta PEP končí ${kdy} – urgovat PEP`);
  }

  const aiIdx = args.indexOf("--ai");
  if (aiIdx >= 0) {
    const n = Number(args[aiIdx + 1] ?? 3);
    for (const { z } of plany.slice(0, n)) {
      const r = await vytezPoznamky(z, now);
      console.log(`\n${z.idObjednavky} [${r.zdroj}${r.chyba ? `: ${r.chyba}` : ""}]`, JSON.stringify(r.vytezeni, null, 2));
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
