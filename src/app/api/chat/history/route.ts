import { handleChatHistoryRequest } from '@/channels/web';
import { getDb } from '@/db/client';

// Node runtime only: getDb()/Neon is not edge-safe here. Deliberately do NOT export
// `runtime = 'edge'` — matches the posture of every other route in this app (see
// src/app/api/chat/route.ts and src/app/api/ingest/route.ts).
export const maxDuration = 30;

export async function GET(req: Request) {
  return handleChatHistoryRequest({ db: getDb() }, req);
}
