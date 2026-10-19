// Ověření propojení na Claude (Vertex AI nebo Claude API) – jedna krátká zpráva, výpis výsledku nebo srozumitelné chyby.
//   npm run claude:test
// Vertex AI: CLAUDE_PROVIDER=vertex, volitelně CLAUDE_VERTEX_REGION (výchozí eu), GOOGLE_CLOUD_PROJECT (výchozí appkoo).

import { vertexAdresa, vytvorKlienta } from "../ai/client.js";
import { MODEL } from "../ai/noteExtraction.js";

const env = process.env;
const vertex = env.CLAUDE_PROVIDER === "vertex";
const region = env.CLAUDE_VERTEX_REGION ?? "eu";
const model = env.CLAUDE_MODEL ?? MODEL;
console.log(
  vertex
    ? `Vertex AI · projekt ${env.GOOGLE_CLOUD_PROJECT ?? "appkoo"} · lokace ${region} · ${vertexAdresa(region)} · model ${model}`
    : `Claude API (ANTHROPIC_API_KEY) · model ${model}`,
);

try {
  const { client } = vytvorKlienta();
  const r = await client.messages.create({
    model,
    max_tokens: 50,
    messages: [{ role: "user", content: "Odpověz jedním slovem: funguje propojení?" }],
  });
  const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
  console.log(`OK – Claude odpověděl: „${text}“ (vstup ${r.usage.input_tokens} / výstup ${r.usage.output_tokens} tokenů)`);
} catch (e) {
  const err = e as { status?: number; message?: string };
  console.error(`CHYBA ${err.status ?? ""}: ${err.message ?? String(e)}`);
  const rada: Record<number, string> = {
    401: "Chybí přihlášení – v Cloud Shellu spusťte: gcloud auth application-default login",
    403: "Chybí oprávnění: účtu (nebo servisnímu účtu) přidejte roli Vertex AI User (roles/aiplatform.user), případně zapněte API aiplatform.googleapis.com.",
    404: "Model není v této lokaci povolený: v Model Garden zapněte Claude (Enable) a zkuste CLAUDE_VERTEX_REGION=eu nebo global.",
    429: "Kvóta: v konzoli požádejte o navýšení kvóty pro Claude v dané lokaci.",
  };
  if (err.status && rada[err.status]) console.error(`→ ${rada[err.status]}`);
  process.exit(1);
}
