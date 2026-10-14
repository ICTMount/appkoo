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

export function vytvorKlienta(env: NodeJS.ProcessEnv = process.env): ClaudeKlient {
  if (env.CLAUDE_PROVIDER === "vertex") {
    return {
      client: new AnthropicVertex({
        projectId: env.GOOGLE_CLOUD_PROJECT,
        region: env.CLAUDE_VERTEX_REGION ?? "eu",
      }),
      fallbacks: false,
    };
  }
  return { client: new Anthropic(), fallbacks: true };
}
