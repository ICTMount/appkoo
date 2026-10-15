// Google Calendar API: čtení kalendářů techniků a zápis událostí.
// Kalendáře techniků jsou nasdílené servisnímu účtu aplikace s právem „Provádět změny v událostech“.

import { calendar as calendarApi, type calendar_v3 } from "@googleapis/calendar";
import { GoogleAuth } from "google-auth-library";
import { tedPraha } from "../domain/time.js";
import type { UdalostTechnika } from "./kontrola.js";
import type { UdalostKalendare } from "./udalost.js";

export function kalendarApi(): calendar_v3.Calendar {
  return calendarApi({ version: "v3", auth: new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/calendar.events"] }) });
}

/** Popis události bývá i v HTML (<br>, <u>) – pro kontrolu ho převedeme na prostý text */
export function zHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** RFC 3339 čas z API → „Praha v UTC“ */
function zApi(t: calendar_v3.Schema$EventDateTime | undefined): Date | null {
  if (t?.dateTime) return tedPraha(new Date(t.dateTime));
  return null; // celodenní události (dovolená) se jako zakázky ani okna nepočítají
}

export async function nactiUdalosti(
  api: calendar_v3.Calendar,
  kalendare: { technik: string; kalendar: string }[],
  od: Date,
  do_: Date,
): Promise<UdalostTechnika[]> {
  const vysledek: UdalostTechnika[] = [];
  for (const { technik, kalendar } of kalendare) {
    let pageToken: string | undefined;
    do {
      const { data } = await api.events.list({
        calendarId: kalendar,
        timeMin: od.toISOString(),
        timeMax: do_.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });
      for (const e of data.items ?? []) {
        const zacatek = zApi(e.start);
        const konec = zApi(e.end);
        if (!zacatek || !konec || e.status === "cancelled") continue;
        vysledek.push({
          kalendar,
          technik,
          id: e.id!,
          summary: e.summary ?? "",
          description: zHtml(e.description ?? ""),
          location: e.location ?? "",
          od: zacatek,
          do: konec,
          appkoo: e.extendedProperties?.private?.appkoo ?? undefined,
        });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return vysledek;
}

/**
 * Zapíše událost zakázky do kalendáře technika. Pokud tam už událost této zakázky je
 * (podle skrytého ID), upraví ji – nikdy nevzniknou dvě události pro jednu zakázku.
 * Při přeplánování k jinému technikovi smaže starou událost v jeho kalendáři.
 * Když se termín zapisuje do volného okna, přepíše událost „VOLNY“ – v kalendáři tak
 * nevzniknou dvě překrývající se události.
 */
export async function zapisUdalost(
  api: calendar_v3.Calendar,
  kalendar: string,
  u: UdalostKalendare,
  puvodni?: { kalendar: string; eventId: string },
  volneOknoEventId?: string,
): Promise<{ eventId: string; akce: "vytvořeno" | "upraveno" | "obsazeno okno" }> {
  if (puvodni && puvodni.kalendar !== kalendar) {
    await api.events.delete({ calendarId: puvodni.kalendar, eventId: puvodni.eventId }).catch(() => undefined);
  }
  const { data } = await api.events.list({
    calendarId: kalendar,
    privateExtendedProperty: [`appkoo=${u.extendedProperties.private.appkoo}`],
    singleEvents: true,
    maxResults: 5,
  });
  const existujici = data.items?.find((e) => e.status !== "cancelled");
  if (existujici?.id) {
    await api.events.patch({ calendarId: kalendar, eventId: existujici.id, requestBody: u });
    return { eventId: existujici.id, akce: "upraveno" };
  }
  if (volneOknoEventId) {
    await api.events.patch({ calendarId: kalendar, eventId: volneOknoEventId, requestBody: { ...u, colorId: null } as never });
    return { eventId: volneOknoEventId, akce: "obsazeno okno" };
  }
  const vytvorena = await api.events.insert({ calendarId: kalendar, requestBody: u });
  return { eventId: vytvorena.data.id!, akce: "vytvořeno" };
}
