// Před odesláním do Claude se z textu odstraní osobní údaje zákazníka (jméno, telefony, e-maily)
// a nahradí zástupnými značkami. Aplikace si je po odpovědi doplní zpět.

export interface Pseudonymizace {
  text: string;
  obnov: (s: string) => string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function pseudonymizuj(text: string, zakaznik: string): Pseudonymizace {
  const mapa = new Map<string, string>();
  let out = text;

  const nahrad = (re: RegExp, znacka: (i: number) => string) => {
    let i = 0;
    out = out.replace(re, (m) => {
      const existujici = [...mapa].find(([, v]) => v === m)?.[0];
      if (existujici) return existujici;
      const z = znacka(++i);
      mapa.set(z, m);
      return z;
    });
  };

  // Jméno zákazníka v MWF bývá "Příjmení, Jméno" nebo "Příjmení Jméno".
  // \b v JS nezná česká písmena, proto hranice slova přes \p{L}.
  const casti = zakaznik.split(/[\s,]+/).filter((c) => c.length >= 3);
  if (casti.length) {
    nahrad(new RegExp(`(?<![\\p{L}\\d])(?:${casti.map(escape).join("|")})(?![\\p{L}\\d])`, "giu"), () => "[ZÁKAZNÍK]");
  }
  nahrad(/[\w.+-]+@[\w-]+\.[\w.]+/g, (i) => `[EMAIL_${i}]`);
  // Telefon = 9 číslic (volitelně +420 a mezery); ne součást ID typu O-123456789
  nahrad(/(?<![\w-])(?:\+?420\s?)?\d{3}\s?\d{3}\s?\d{3}(?!\d)/g, (i) => `[TEL_${i}]`);

  return {
    text: out,
    obnov: (s) => {
      let r = s;
      for (const [z, v] of mapa) if (z !== "[ZÁKAZNÍK]") r = r.split(z).join(v);
      return r;
    },
  };
}
