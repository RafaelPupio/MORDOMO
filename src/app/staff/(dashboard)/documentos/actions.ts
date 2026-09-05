'use server';

import { revalidatePath } from 'next/cache';
import { describeIngest } from '@/core/ingest-summary';
import { GatewayEmbedder } from '@/ai/embedder';
import { FAST_MODEL } from '@/ai/pricing';
import { checkBudget } from '@/ai/usage';
import { INGEST_LIMIT, parseGlobalCapUsd } from '@/core/config';
import { runIngest } from '@/core/ingest';
import { UnsupportedMediaTypeError, parseDocument } from '@/core/parse-document';
import { checkRateLimit } from '@/core/rate-limit';
import { requireStaffContext } from '@/core/staff-context';
import { hasUnstorableChars } from '@/core/text-safety';
import { getDb } from '@/db/client';
import { createDocument } from '@/db/repo/documents';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type UploadState = { error?: string; ok?: string };

/**
 * Runs an uploaded file through the SAME pipeline the public ingest endpoint uses
 * (`runIngest`, src/core/ingest.ts). `churchId` comes ONLY from `requireStaffContext()` —
 * never from `formData` — so this action can never be pointed at another tenant's
 * knowledge base by crafting a form field.
 *
 * Everything from the rate-limit check onward hits Postgres (or the AI gateway), so it all
 * lives inside one try/catch — a Neon cold start or any other unexpected DB failure returns
 * the Portuguese error shape instead of an uncaught Server Action rejection (I2). Only
 * `requireStaffContext()` and the synchronous form-shape checks above stay outside it, same
 * reasoning as everywhere else in the staff area: a DB failure inside `requireStaffContext`
 * is `src/app/staff/(dashboard)/error.tsx`'s problem (I3), not this action's.
 */
export async function uploadDocument(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const { churchId } = await requireStaffContext();
  const db = getDb();

  const file = formData.get('file');
  const title = String(formData.get('title') ?? '').trim();
  if (!(file instanceof File) || !title) return { error: 'Escolha um arquivo e informe um título.' };
  if (title.length > 300) return { error: 'Título muito longo.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'Arquivo maior que 5 MB.' };

  try {
    // Shares ONE rate-limit key/bucket with `POST /api/ingest` (`ingest:${churchId}`,
    // src/channels/ingest-http.ts) rather than a second `staff-ingest:` bucket of its own
    // (M5): both paths run the same `runIngest` pipeline for the same tenant and are BOTH
    // reachable by the same authenticated staff session (that route accepts the same
    // `ccb_staff` cookie this dashboard form does) — two separate 10/hour buckets would let
    // one session run the pipeline 20 times/hour instead of the 10 either limit intends.
    // Reusing `INGEST_LIMIT` (not just the same key string) means the two paths also can't
    // silently drift to different numbers later.
    const rate = await checkRateLimit(db, `ingest:${churchId}`, INGEST_LIMIT);
    if (!rate.allowed) return { error: 'Muitos envios nesta hora. Tente novamente mais tarde.' };

    // `parseGlobalCapUsd` already falls back to its own default (DEFAULT_GLOBAL_CAP_USD)
    // when the env var is unset — the `?? String(DEFAULT_GLOBAL_CAP_USD)` this used to carry
    // was a redundant second default (M9); the API routes pass the raw env var through the
    // same way.
    const budget = await checkBudget(db, churchId, parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP));
    if (!budget.allowed) return { error: 'O limite de uso do mês foi atingido.' };

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';

    // Parsed here — before any `documents` row exists — purely to reject an unsupported
    // media type or unstorable text early. `runIngest` parses the same bytes again as its
    // own first pipeline stage (see src/channels/ingest-http.ts for the same double-parse
    // and the same reasoning: a rejected upload must leave no orphan document row behind).
    let parsed: Awaited<ReturnType<typeof parseDocument>>;
    try {
      parsed = await parseDocument(bytes, mimeType);
    } catch (error) {
      if (error instanceof UnsupportedMediaTypeError) {
        return { error: 'Formato não suportado. Envie PDF ou Markdown.' };
      }
      return { error: 'Não foi possível ler o arquivo.' };
    }
    if (hasUnstorableChars(parsed.text)) return { error: 'O arquivo contém caracteres inválidos.' };

    const doc = await createDocument(db, { churchId, title, kind: 'upload', sourcePath: file.name });
    const result = await runIngest(
      { db, embedder: new GatewayEmbedder(), extractorModel: FAST_MODEL, verifierModel: FAST_MODEL },
      { churchId, documentId: doc.id, bytes, mimeType },
    );

    revalidatePath('/staff/documentos');
    revalidatePath('/staff/agenda');

    if (result.status === 'failed') return { error: 'A leitura do documento falhou. Veja o status na lista.' };

    // Report the whole outcome, not just `published`. `runIngest` already distinguishes
    // "this document has no dated events" from "candidates were found and every one was
    // rejected" from "the extractor never ran" — and collapsing all three into a bare
    // "0 evento(s) publicado(s)" is what let a pipeline bug that rejected 100% of correct
    // candidates look exactly like a bulletin with nothing in it. See
    // src/agent/time-convention.ts for the bug that hid here.
    return { ok: describeIngest(result) };
  } catch (error) {
    console.error('uploadDocument: unexpected failure', { churchId, fileName: file.name, error });
    return { error: 'Não foi possível processar o documento. Tente novamente.' };
  }
}
