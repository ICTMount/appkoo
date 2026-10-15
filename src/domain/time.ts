// Všechny časy v aplikaci jsou „místní čas Praha“ uložený jako UTC Date.
// Tj. new Date(Date.UTC(2026, 9, 14, 9, 30)) znamená 14.10.2026 9:30 v Praze.
// Odpadá tím závislost na časové zóně serveru i přechodech letního času –
// MWF i kalendář pracují s místním časem.

export type IsoDate = string; // "YYYY-MM-DD"

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export function local(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min));
}

export function isoDate(t: Date): IsoDate {
  return t.toISOString().slice(0, 10);
}

export function fromIso(d: IsoDate): Date {
  return new Date(`${d}T00:00:00Z`);
}

export function atTime(d: IsoDate, hour: number, minute = 0): Date {
  return new Date(fromIso(d).getTime() + hour * HOUR + minute * 60 * 1000);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return isoDate(new Date(fromIso(d).getTime() + n * DAY));
}

export function minutesOfDay(t: Date): number {
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 14.10.2026 – formát dat ve frázích do MWF */
export function fmtDate(d: IsoDate | Date): string {
  const s = typeof d === "string" ? d : isoDate(d);
  const [y, m, day] = s.split("-");
  return `${day}.${m}.${y}`;
}

export function fmtTime(t: Date): string {
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** "14.10.2026 9:07" nebo "14.10.2026 09:07:33" → Date; jinak null */
export function parseCzDateTime(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  return local(Number(y), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0));
}

/** Aktuální čas jako „místní čas Praha uložený v UTC“ (viz začátek souboru) */
export function tedPraha(now: Date = new Date()): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return local(Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute));
}
