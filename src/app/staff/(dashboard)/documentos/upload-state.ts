import { describeIngest, ingestNeedsAttention, type IngestOutcome } from '@/core/ingest-summary';
import type { IngestStatus } from '@/core/ingest-status';

// Mirrors `GenerateReportState` (relatorios/generate-report-state.ts): a plain function,
// not exported from `actions.ts` — a `'use server'` file may only export async Server
// Actions — and pure, so mapping each ingest outcome to the right on-screen slot is
// unit-testable without Next.js request context.
export type UploadState = { ok?: string; notice?: string; error?: string };

/**
 * `notice` is the amber "not wrong, but look" slot. The review that followed the first
 * version found "a leitura de eventos falhou" and "todos rejeitados" rendering in the green
 * success slot with role="status": the sentence had changed, the channel still said
 * success. Only a run that ended `failed` is an `error`; everything the secretary should
 * act on but that did not break lands here; a clean publish is `ok`.
 */
export function buildUploadState(result: IngestOutcome & { status: IngestStatus }): UploadState {
  if (result.status === 'failed') {
    return { error: 'A leitura do documento falhou. Veja o status na lista.' };
  }
  const message = describeIngest(result);
  return ingestNeedsAttention(result) ? { notice: message } : { ok: message };
}
