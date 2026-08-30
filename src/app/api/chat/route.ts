import { GatewayEmbedder } from '@/ai/embedder';
import { handleChatRequest } from '@/channels/web';
import { parseGlobalCapUsd } from '@/core/config';
import { getDb } from '@/db/client';

// Node runtime only: getDb()/Neon and the AI SDK's tool loop are not edge-safe here.
// Deliberately do NOT export `runtime = 'edge'`.
export const maxDuration = 60;

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
