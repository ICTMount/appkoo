// Společný pohyb po dnech pro Doplnit technika i Kalendář techniků: stejné prvky, stejné pořadí,
// stejný vzhled – „Dnes“, šipky zpět / dál, datum slovy a rychlá volba nejbližších pracovních dnů.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const DNY = ["ne", "po", "út", "st", "čt", "pá", "so"];

/** Styly navigace – vkládají se do CSS obou stránek (používají společné proměnné --line, --panel, --text, --accent) */
export const CSS_NAV = `
.dnav{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dn-tl,.dn-sipka{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--panel);font-weight:600;color:var(--text)}
.dn-sipka{min-width:36px;padding:0 6px;font-size:18px}
.dn-tl:hover,.dn-sipka:hover{background:var(--line);text-decoration:none}
.dn-sipka.off{opacity:.35;pointer-events:none}
.dn-datum{font-size:18px;font-weight:600;white-space:nowrap}
.rychle{display:flex;gap:6px;flex-wrap:wrap}.rychle a{padding:4px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--text);white-space:nowrap}
.rychle a.on{border-color:var(--accent);background:var(--accent);color:#fff}.rychle a:hover{text-decoration:none}
`;

export interface NavDne {
  /** odkaz na dnešek */
  dnes: string;
  /** odkaz o krok zpět; null = zpět nelze (šipka zůstane, jen neaktivní) */
  zpet: string | null;
  dal: string;
  /** datum slovy, např. „středa 11. listopadu 2026“ */
  datum: string;
  /** popisek kroku pro čtečky a nápovědu: „den“ / „týden“ */
  krok?: string;
}

export function navDne(n: NavDne): string {
  const krok = n.krok ?? "den";
  return `<div class="dnav"><a class="dn-tl" href="${esc(n.dnes)}">Dnes</a>${
    n.zpet ? `<a class="dn-sipka" href="${esc(n.zpet)}" title="O ${krok} zpět" aria-label="O ${krok} zpět">‹</a>` : `<span class="dn-sipka off" aria-hidden="true">‹</span>`
  }<a class="dn-sipka" href="${esc(n.dal)}" title="O ${krok} dál" aria-label="O ${krok} dál">›</a><span class="dn-datum">${esc(n.datum)}</span></div>`;
}

/** Rychlá volba dnů („st 11.11.“) – vybraný den zvýrazněný */
export function rychleDny(dny: string[], vybrany: string, odkaz: (den: string) => string): string {
  return `<div class="rychle">${dny
    .map((d) => {
      const t = new Date(`${d}T00:00:00Z`);
      return `<a class="${d === vybrany ? "on" : ""}" href="${esc(odkaz(d))}">${DNY[t.getUTCDay()]} ${t.getUTCDate()}.${t.getUTCMonth() + 1}.</a>`;
    })
    .join("")}</div>`;
}
