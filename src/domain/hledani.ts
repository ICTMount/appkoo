// Hledání zakázky podle jména, adresy nebo ID: bez diakritiky, v libovolném pořadí slov
// („Šimková Lucie“ = „lucie simkova“) a s tolerancí k překlepu („šimkova luci“, „simkva“).
// Každé slovo dotazu musí sedět na některé slovo hledaných polí: jako začátek slova, podřetězec,
// nebo s malým překlepem (1 chyba u slov od 4 znaků, 2 chyby od 8 znaků).

export const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const slova = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Levenshteinova vzdálenost s horní mezí (dál se nepočítá) */
export function vzdalenost(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let min = i;
    for (let j = 1; j <= b.length; j++) {
      const c = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(c);
      if (c < min) min = c;
    }
    if (min > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

const tolerance = (slovo: string) => (slovo.length >= 8 ? 2 : slovo.length >= 4 ? 1 : 0);

/** Sedí jedno slovo dotazu na slovo textu? (začátek slova / podřetězec / překlep, u delších i překlep v začátku) */
function sediSlovo(q: string, w: string): boolean {
  if (w.includes(q)) return true;
  const t = tolerance(q);
  if (!t) return false;
  if (vzdalenost(q, w, t) <= t) return true;
  // dotaz je zkomolený začátek delšího slova („luci“ → „lucie“ řeší includes; „simkva“ → „simkova“ řeší vzdálenost; „simkov“ → „simkova“ taky)
  return w.length > q.length && vzdalenost(q, w.slice(0, q.length), t) <= t;
}

/**
 * Všechna slova dotazu sedí na slova polí (v libovolném pořadí). Čísla (telefon, ID) se porovnávají jako podřetězec
 * celého textu, aby „603 111 222“ sedělo i přes mezery.
 */
export function sediText(pole: string[], dotaz: string): boolean {
  const q = norm(dotaz.trim());
  if (!q) return true;
  const cely = pole.map(norm);
  if (cely.some((p) => p.includes(q))) return true;
  const qs = slova(q);
  if (!qs.length) return false;
  const ws = pole.flatMap(slova);
  // čísla a ID (obsahují číslici) se neopravují – musí být v textu přesně
  return qs.every((qw) => (/\d/.test(qw) ? cely.some((p) => p.includes(qw)) : ws.some((w) => sediSlovo(qw, w))));
}
