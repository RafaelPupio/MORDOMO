import { parseGlobalCapUsd } from '@/app/api/chat/route';
import { GatewayEmbedder } from '@/ai/embedder';
import { FAST_MODEL } from '@/ai/pricing';
import { handleIngestRequest } from '@/channels/ingest-http';
import { getDb } from '@/db/client';

// Node runtime only: getDb()/Neon, pdf parsing (unpdf) and the AI SDK's tool loop are not
// edge-safe here. Deliberately do NOT export `runtime = 'edge'`.
export const maxDuration = 300;

export async function POST(req: Request) {
  return handleIngestRequest(
    {
      db: getDb(),
      embedder: new GatewayEmbedder(),
      // Reuses the chat route's validated-cap parser rather than a raw `Number(...)` here —
      // a raw parse would reintroduce the fail-open budget bug that was already fixed once
      // (a malformed env value silently becoming "no cap" instead of the safe default).
      globalCapUsd: parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP),
      ingestToken: process.env.INGEST_TOKEN,
      extractorModel: FAST_MODEL,
      verifierModel: FAST_MODEL,
    },
    req,
  );
}
