// Klient pro Claude. Aplikace poběží v Google Cloudu, proto umí obě cesty:
//  - CLAUDE_PROVIDER=vertex   → Claude přes Vertex AI ve vlastním GCP projektu
//                                (přihlášení servisním účtem, data v regionu EU, platba přes Google)
//  - jinak                    → Claude API od Anthropic (ANTHROPIC_API_KEY ze Secret Manageru)

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

export interface ClaudeKlient {
  client: Anthropic | AnthropicVertex;
  /** server-side fallback při odmítnutí – jen Claude API, na Vertex AI není */
  fallbacks: boolean;
}

/**
 * Adresa Vertex AI podle lokace: multi-region „eu“ / „us“ má vlastní hostitele (aiplatform.eu.rep.googleapis.com),
 * „global“ společného, konkrétní region (europe-west1) tvar „europe-west1-aiplatform.googleapis.com“.
 * Nejnovější modely Claude jsou v EU jen na multi-regionu „eu“.
 */
export function vertexAdresa(region: string): string {
  if (region === "global") return "https://aiplatform.googleapis.com/v1";
  if (region === "eu" || region === "us") return `https://aiplatform.${region}.rep.googleapis.com/v1`;
  return `https://${region}-aiplatform.googleapis.com/v1`;
}

export function vytvorKlienta(env: NodeJS.ProcessEnv = process.env): ClaudeKlient {
  if (env.CLAUDE_PROVIDER === "vertex") {
    const region = env.CLAUDE_VERTEX_REGION ?? "eu";
    return {
      client: new AnthropicVertex({
        projectId: env.GOOGLE_CLOUD_PROJECT ?? env.CLAUDE_VERTEX_PROJECT ?? "appkoo",
        region,
        baseURL: vertexAdresa(region),
      }),
      fallbacks: false,
    };
  }
  return { client: new Anthropic(), fallbacks: true };
}
