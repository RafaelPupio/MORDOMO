import { GatewayEmbedder } from '@/ai/embedder';
import { handleChatRequest } from '@/channels/web';
import { DEFAULT_GLOBAL_CAP_USD, parseGlobalCapUsd } from '@/core/config';
import { getDb } from '@/db/client';

// Node runtime only: getDb()/Neon and the AI SDK's tool loop are not edge-safe here.
// Deliberately do NOT export `runtime = 'edge'`.
export const maxDuration = 60;

// Re-exported for backward compatibility: this used to be defined here, and
// tests/app/api/chat/route.test.ts still imports it from this module. The real
// implementation now lives in src/core/config.ts (a neutral module with no route-specific
// dependencies) so src/app/api/ingest/route.ts can use it without pulling this whole chat
// route's module graph into the ingest bundle — see M6 in the ingest security review.
export { DEFAULT_GLOBAL_CAP_USD, parseGlobalCapUsd };

export async function POST(req: Request) {
  return handleChatRequest(
    {
      db: getDb(),
      embedder: new GatewayEmbedder(),
      globalCapUsd: parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP),
    },
    req,
  );
}
