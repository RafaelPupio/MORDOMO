import { GatewayEmbedder } from '@/ai/embedder';
import { handleChatRequest } from '@/channels/web';
import { getDb } from '@/db/client';

// Node runtime only: getDb()/Neon and the AI SDK's tool loop are not edge-safe here.
// Deliberately do NOT export `runtime = 'edge'`.
export const maxDuration = 60;

// C1: this is the only cost control set by hand in a dashboard, so it's also the only one
// that can be typo'd. `Number("abc")` is `NaN`, and every `spend >= NaN` comparison in
// checkBudget() is false — a malformed value doesn't just misconfigure the cap, it deletes
// it (fails OPEN). checkBudget already fails closed when a tenant has no budget row at all;
// this parse must fail closed the same way. A missing OR malformed value both degrade to the
// same conservative default rather than "no cap" — the only difference is that malformed
// values are logged, since they indicate an operator mistake worth noticing.
export const DEFAULT_GLOBAL_CAP_USD = 50;

export function parseGlobalCapUsd(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_GLOBAL_CAP_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error('DEMO_GLOBAL_MONTHLY_USD_CAP is not a valid positive number; falling back to the default cap', {
      raw,
      defaultUsd: DEFAULT_GLOBAL_CAP_USD,
    });
    return DEFAULT_GLOBAL_CAP_USD;
  }
  return parsed;
}

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
