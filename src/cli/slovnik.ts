// Vygeneruje docs/slovnik-mwf.md ze src/domain/slovnik.ts (jediný zdroj pravdy).
import { writeFileSync } from "node:fs";
import { SLOVNIK, type Oblast } from "../domain/slovnik.js";

const NADPISY: Record<Oblast, string> = {
  objekt: "Objekty",
  stav: "Stavy zakázky",
  akce: "Akce (tlačítka v MWF)",
  zalozka: "Záložky detailu",
  pole: "Pole a sloupce",
  hodnota: "Hodnoty číselníků",
};

const radky = [
  "# Slovník MWF ↔ aplikace",
  "",
  "MWF je slovensky, aplikace česky. Kde koordinátorka musí stejnou věc najít nebo vybrat v MWF,",
  "aplikace ukáže vedle českého názvu i přesné znění z MWF („v MWF: …“). Hodnoty, které se v MWF",
  "vybírají (parkování, výsledek dojednávání), se do MWF zapisují vždy v přesném slovenském znění.",
  "",
  "Soubor je generovaný příkazem `npm run slovnik` ze `src/domain/slovnik.ts` – needitovat ručně.",
];
for (const oblast of Object.keys(NADPISY) as Oblast[]) {
  radky.push("", `## ${NADPISY[oblast]}`, "", "| MWF (SK) | Aplikace (CZ) | Poznámka |", "|---|---|---|");
  for (const p of SLOVNIK.filter((x) => x.oblast === oblast)) radky.push(`| ${p.mwf} | ${p.cz} | ${p.popis ?? ""} |`);
}
writeFileSync("docs/slovnik-mwf.md", radky.join("\n") + "\n");
console.log(`docs/slovnik-mwf.md – ${SLOVNIK.length} pojmů`);
