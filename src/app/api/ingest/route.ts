import { GatewayEmbedder } from '@/ai/embedder';
import { FAST_MODEL } from '@/ai/pricing';
import { handleIngestRequest } from '@/channels/ingest-http';
import { parseGlobalCapUsd } from '@/core/config';
import { getDb } from '@/db/client';

// Node runtime only: getDb()/Neon, pdf parsing (unpdf) and the AI SDK's tool loop are not
// edge-safe here. Deliberately do NOT export `runtime = 'edge'`.
export const maxDuration = 300;

export async function POST(req: Request) {
  return handleIngestRequest(
    {
      db: getDb(),
      embedder: new GatewayEmbedder(),
      // Reuses the shared validated-cap parser (src/core/config.ts) rather than a raw
      // `Number(...)` here — a raw parse would reintroduce the fail-open budget bug that
      // was already fixed once (a malformed env value silently becoming "no cap" instead
      // of the safe default). Imported from the neutral module, not from the chat route,
      // so this bundle doesn't drag in the chat route's whole module graph just to reuse
      // one function (see M6 in the ingest security review).
      globalCapUsd: parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP),
      staffSessionSecret: process.env.STAFF_SESSION_SECRET,
      extractorModel: FAST_MODEL,
      verifierModel: FAST_MODEL,
    },
    req,
  );
}
