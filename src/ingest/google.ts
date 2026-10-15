// Napojení příjmu exportu na Google Drive a Gmail.
// Aplikace běží pod servisním účtem v Google Cloudu:
//  - Drive: složka s exporty je nasdílená servisnímu účtu (čtenář) – stačí běžné přihlášení (ADC).
//  - Gmail: schránka pro exporty se čte jménem uživatele přes delegaci v rámci domény
//    (scope gmail.modify – kvůli štítku „zpracováno“). Nastavuje správce Google Workspace.

import { drive as driveApi, type drive_v3 } from "@googleapis/drive";
import { gmail as gmailApi, type gmail_v1 } from "@googleapis/gmail";
import { GoogleAuth } from "google-auth-library";
import type { DoslyExport } from "./prijem.js";

export interface ZdrojExportu {
  /** nové soubory od daného okamžiku (nebo všechny nezpracované) */
  nacti(od: Date | null): Promise<DoslyExport[]>;
  /** označí soubor jako zpracovaný (u e-mailu štítek) */
  oznacZpracovano(d: DoslyExport): Promise<void>;
}

/** Varování do logu (řádek JSON pro Cloud Logging) – soubor se přeskočí, běh pokračuje. */
function varovani(message: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ severity: "WARNING", message, ...data }));
}

// ---------- Google Drive ----------

export function driveZdroj(slozkaId: string, api: drive_v3.Drive = driveApi({ version: "v3", auth: new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/drive.readonly"] }) })): ZdrojExportu {
  return {
    async nacti(od) {
      const q = [`'${slozkaId}' in parents`, "trashed = false", "name contains 'paw-grid-export-csv'"];
      if (od) q.push(`createdTime > '${od.toISOString()}'`);
      const { data } = await api.files.list({ q: q.join(" and "), orderBy: "createdTime", pageSize: 50, fields: "files(id,name,createdTime,mimeType)" });
      const vysledek: DoslyExport[] = [];
      for (const f of data.files ?? []) {
        // Export otevřený a uložený jako Google tabulka už není CSV z MWF (nejde stáhnout, jiné kódování) – přeskočit
        if (f.mimeType?.startsWith("application/vnd.google-apps.")) {
          varovani(`Drive: „${f.name}“ je Google dokument (${f.mimeType}), ne CSV z MWF – přeskočeno.`, { soubor: f.name, zdrojId: f.id });
          continue;
        }
        try {
          const res = await api.files.get({ fileId: f.id!, alt: "media" }, { responseType: "arraybuffer" });
          vysledek.push({ zdroj: "drive", nazev: f.name!, obsah: Buffer.from(res.data as ArrayBuffer), prijato: new Date(f.createdTime!), zdrojId: f.id! });
        } catch (e) {
          // Jeden nečitelný soubor nesmí zablokovat ostatní exporty
          varovani(`Drive: „${f.name}“ nejde stáhnout – přeskočeno (${e instanceof Error ? e.message : String(e)}).`, { soubor: f.name, zdrojId: f.id });
        }
      }
      return vysledek;
    },
    async oznacZpracovano() {
      // Na Drive se nic neoznačuje – opakované čtení zachytí kontrola otisku (duplicita).
    },
  };
}

// ---------- Gmail ----------

export interface NastaveniEmailu {
  /** schránka, kterou aplikace čte (např. mwf-export@ictmount.com) */
  schranka: string;
  /** název štítku pro zpracované zprávy */
  stitek?: string;
}

export function gmailZdroj(n: NastaveniEmailu, api?: gmail_v1.Gmail): ZdrojExportu {
  const gm =
    api ??
    gmailApi({
      version: "v1",
      auth: new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/gmail.modify"], clientOptions: { subject: n.schranka } }),
    });
  const stitek = n.stitek ?? "appkoo-zpracovano";
  let stitekId: string | undefined;

  async function idStitku(): Promise<string> {
    if (stitekId) return stitekId;
    const { data } = await gm.users.labels.list({ userId: "me" });
    stitekId = data.labels?.find((l) => l.name === stitek)?.id ?? undefined;
    if (!stitekId) stitekId = (await gm.users.labels.create({ userId: "me", requestBody: { name: stitek } })).data.id!;
    return stitekId;
  }

  return {
    async nacti() {
      const { data } = await gm.users.messages.list({ userId: "me", q: `has:attachment filename:csv -label:${stitek} newer_than:7d`, maxResults: 20 });
      const vysledek: DoslyExport[] = [];
      for (const { id } of data.messages ?? []) {
        const msg = (await gm.users.messages.get({ userId: "me", id: id! })).data;
        const od = msg.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
        for (const cast of priloha(msg.payload)) {
          const a = await gm.users.messages.attachments.get({ userId: "me", messageId: id!, id: cast.body!.attachmentId! });
          vysledek.push({
            zdroj: "email",
            nazev: cast.filename!,
            obsah: Buffer.from(a.data.data!, "base64url"),
            prijato: new Date(Number(msg.internalDate)),
            odesilatel: od,
            zdrojId: id!,
          });
        }
      }
      return vysledek;
    },
    async oznacZpracovano(d) {
      if (!d.zdrojId) return;
      await gm.users.messages.modify({ userId: "me", id: d.zdrojId, requestBody: { addLabelIds: [await idStitku()] } });
    },
  };
}

function priloha(p: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!p) return [];
  const vlastni = p.filename && /\.csv$/i.test(p.filename) && p.body?.attachmentId ? [p] : [];
  return [...vlastni, ...(p.parts ?? []).flatMap(priloha)];
}
