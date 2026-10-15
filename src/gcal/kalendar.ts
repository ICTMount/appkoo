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
          appkoo: e.extendedProperties?.private?.appkoo || undefined,
          barva: e.colorId ?? undefined,
        });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return vysledek;
}

/** Volný slot tak, jak ho vytváří SHEET2CAL: „Hristov - VOLNY“, zelená barva (colorId 10) */
export function volnySlot(technik: string): calendar_v3.Schema$Event {
  return {
    summary: `${technik} - VOLNY`,
    colorId: "10",
    description: "",
    location: "",
    extendedProperties: { private: { appkoo: "", objednavka: "", s7: "" } },
  };
}

export interface PuvodniUdalost {
  kalendar: string;
  eventId: string;
  technik: string;
}

/**
 * Zapíše termín zakázky do kalendáře technika.
 * - Do volného okna: přepíše událost „VOLNY“ na zakázku (bez překryvu).
 * - Přesun zakázky: původní událost se vrátí na „VOLNY“, aby se volný slot neztratil
 *   (SKILLS v5, část 22: „Při přesunu zakázky zajistit, aby původní volný slot nebyl ztracen“).
 * - Stejný slot, jen úprava údajů: upraví existující událost (podle skrytého ID zakázky).
 * - Jinak (mimo sloty): vytvoří novou událost.
 * Nikdy nevzniknou dvě události pro jednu zakázku.
 */
export async function zapisUdalost(
  api: calendar_v3.Calendar,
  kalendar: string,
  u: UdalostKalendare,
  puvodni?: PuvodniUdalost,
  volneOknoEventId?: string,
): Promise<{ eventId: string; akce: "vytvořeno" | "upraveno" | "obsazeno okno"; uvolneno?: string }> {
  // existující událost zakázky: zadaná, nebo dohledaná podle skrytého ID v cílovém kalendáři
  let stara = puvodni;
  if (!stara) {
    const { data } = await api.events.list({
      calendarId: kalendar,
      privateExtendedProperty: [`appkoo=${u.extendedProperties.private.appkoo}`],
      singleEvents: true,
      maxResults: 5,
    });
    const e = data.items?.find((x) => x.status !== "cancelled");
    if (e?.id) stara = { kalendar, eventId: e.id, technik: "" };
  }

  if (volneOknoEventId && !(stara && stara.kalendar === kalendar && stara.eventId === volneOknoEventId)) {
    await api.events.patch({ calendarId: kalendar, eventId: volneOknoEventId, requestBody: { ...u, colorId: null } as never });
    let uvolneno: string | undefined;
    if (stara) {
      await api.events.patch({ calendarId: stara.kalendar, eventId: stara.eventId, requestBody: volnySlot(stara.technik || u.summary.split(" - ")[0]!.replace(/^Bridge /, "")) });
      uvolneno = stara.eventId;
    }
    return { eventId: volneOknoEventId, akce: "obsazeno okno", ...(uvolneno ? { uvolneno } : {}) };
  }

  if (stara && stara.kalendar === kalendar) {
    await api.events.patch({ calendarId: kalendar, eventId: stara.eventId, requestBody: u });
    return { eventId: stara.eventId, akce: "upraveno" };
  }

  const vytvorena = await api.events.insert({ calendarId: kalendar, requestBody: u });
  if (stara) {
    await api.events.patch({ calendarId: stara.kalendar, eventId: stara.eventId, requestBody: volnySlot(stara.technik) });
    return { eventId: vytvorena.data.id!, akce: "vytvořeno", uvolneno: stara.eventId };
  }
  return { eventId: vytvorena.data.id!, akce: "vytvořeno" };
}
