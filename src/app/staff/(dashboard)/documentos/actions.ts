'use server';

import { revalidatePath } from 'next/cache';
import { GatewayEmbedder } from '@/ai/embedder';
import { FAST_MODEL } from '@/ai/pricing';
import { checkBudget } from '@/ai/usage';
import { DEFAULT_GLOBAL_CAP_USD, parseGlobalCapUsd } from '@/core/config';
import { runIngest } from '@/core/ingest';
import { UnsupportedMediaTypeError, parseDocument } from '@/core/parse-document';
import { checkRateLimit } from '@/core/rate-limit';
import { requireStaffContext } from '@/core/staff-context';
import { hasUnstorableChars } from '@/core/text-safety';
import { getDb } from '@/db/client';
import { createDocument } from '@/db/repo/documents';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const STAFF_INGEST_LIMIT = { limit: 10, windowSeconds: 3600 };

export type UploadState = { error?: string; ok?: string };

/**
 * Runs an uploaded file through the SAME pipeline the public ingest endpoint uses
 * (`runIngest`, src/core/ingest.ts). `churchId` comes ONLY from `requireStaffContext()` —
 * never from `formData` — so this action can never be pointed at another tenant's
 * knowledge base by crafting a form field.
 */
export async function uploadDocument(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const { churchId } = await requireStaffContext();
  const db = getDb();

  const file = formData.get('file');
  const title = String(formData.get('title') ?? '').trim();
  if (!(file instanceof File) || !title) return { error: 'Escolha um arquivo e informe um título.' };
  if (title.length > 300) return { error: 'Título muito longo.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'Arquivo maior que 5 MB.' };

  const rate = await checkRateLimit(db, `staff-ingest:${churchId}`, STAFF_INGEST_LIMIT);
  if (!rate.allowed) return { error: 'Muitos envios nesta hora. Tente mais tarde.' };

  const budget = await checkBudget(
    db, churchId, parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP ?? String(DEFAULT_GLOBAL_CAP_USD)),
  );
  if (!budget.allowed) return { error: 'O limite de uso do mês foi atingido.' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';

  // Parsed here — before any `documents` row exists — purely to reject an unsupported
  // media type or unstorable text early. `runIngest` parses the same bytes again as its
  // own first pipeline stage (see src/channels/ingest-http.ts for the same double-parse
  // and the same reasoning: a rejected upload must leave no orphan document row behind).
  try {
    const parsed = await parseDocument(bytes, mimeType);
    if (hasUnstorableChars(parsed.text)) return { error: 'O arquivo contém caracteres inválidos.' };
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) return { error: 'Formato não suportado. Envie PDF ou Markdown.' };
    return { error: 'Não foi possível ler o arquivo.' };
  }

  // Everything below can throw on a DB failure (e.g., Neon scale-to-zero cold start) or
  // an unexpected pipeline failure. Wrap in try/catch to guarantee a controlled error
  // response instead of an uncaught rejection, matching src/channels/ingest-http.ts's
  // posture. Log the real error server-side; the staff member only sees a Portuguese
  // message, never a stack trace.
  try {
    const doc = await createDocument(db, { churchId, title, kind: 'upload', sourcePath: file.name });
    const result = await runIngest(
      { db, embedder: new GatewayEmbedder(), extractorModel: FAST_MODEL, verifierModel: FAST_MODEL },
      { churchId, documentId: doc.id, bytes, mimeType },
    );

    revalidatePath('/staff/documentos');
    revalidatePath('/staff/agenda');

    if (result.status === 'failed') return { error: 'A leitura do documento falhou. Veja o status na lista.' };
    return {
      ok: `Documento processado: ${result.chunkCount} trechos, ${result.published} evento(s) publicado(s).`,
    };
  } catch (error) {
    console.error('uploadDocument: unexpected failure', { churchId, fileName: file.name, error });
    return { error: 'Não foi possível processar o documento. Tente novamente.' };
  }
}
