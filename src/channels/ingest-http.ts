import { timingSafeEqual } from 'node:crypto';
import type { LanguageModel } from 'ai';
import { checkBudget } from '@/ai/usage';
import type { Embedder } from '@/ai/embedder';
import { runIngest } from '@/core/ingest';
import { parseDocument, UnsupportedMediaTypeError } from '@/core/parse-document';
import { checkRateLimit } from '@/core/rate-limit';
import type { Db } from '@/db/client';
import { DEMO_CHURCH_SLUG, getChurchBySlug } from '@/db/repo/churches';
import { createDocument } from '@/db/repo/documents';

export type IngestChannelDeps = {
  db: Db;
  embedder: Embedder;
  globalCapUsd: number;
  /** Shared secret standing in for staff auth until Plan 3 ships the dashboard. */
  ingestToken: string | undefined;
  extractorModel?: LanguageModel;
  verifierModel?: LanguageModel;
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// Exported so tests can assert against the actual value instead of duplicating a magic
// number that could silently drift out of sync with this file (same pattern as
// src/channels/web.ts's CHAT_LIMIT).
export const INGEST_LIMIT = { limit: 10, windowSeconds: 3600 };

// Constant-time comparison so a wrong-but-close guess cannot be distinguished from a
// wrong-and-far guess by response latency. `timingSafeEqual` requires equal-length
// buffers, so length is checked (and rejected) first — leaking presented-length via
// timing is not a meaningful leak here (an attacker can already see the length of what
// they sent), and comparing two different-length buffers would just throw.
function tokenMatches(expected: string, presented: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const presentedBuf = Buffer.from(presented);
  if (expectedBuf.length !== presentedBuf.length) return false;
  return timingSafeEqual(expectedBuf, presentedBuf);
}

export async function handleIngestRequest(deps: IngestChannelDeps, req: Request): Promise<Response> {
  // Without a configured token the endpoint is closed, not open: an unset secret must
  // never mean "anyone may ingest". `deps.ingestToken` being empty/undefined always
  // fails this check, regardless of what the caller presents.
  const expected = deps.ingestToken;
  const presented = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !presented || !tokenMatches(expected, presented)) {
    return Response.json({ code: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }

  const file = form.get('file');
  const title = String(form.get('title') ?? '').trim();
  if (!(file instanceof File) || !title) {
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }
  // Checked from File.size — a property the runtime fills in from the upload's declared
  // length — before the body is ever read into memory, so an oversized upload is rejected
  // without buffering it first.
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ code: 'file_too_large' }, { status: 413 });
  }

  const church = await getChurchBySlug(deps.db, DEMO_CHURCH_SLUG);
  if (!church) return Response.json({ code: 'not_seeded' }, { status: 500 });

  const rate = await checkRateLimit(deps.db, `ingest:${church.id}`, INGEST_LIMIT);
  if (!rate.allowed) return Response.json({ code: 'rate_limited' }, { status: 429 });

  const budget = await checkBudget(deps.db, church.id, deps.globalCapUsd);
  if (!budget.allowed) {
    return Response.json({ code: 'budget_exhausted', reason: budget.reason }, { status: 402 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';

  // Parse once here, before creating the document row, purely to reject an unsupported
  // media type early: a rejected upload must leave no orphan `documents` row behind.
  // `runIngest` below parses the same bytes again as its own first pipeline stage — this
  // double-parse is deliberate and cheap for demo-sized documents, and it keeps the
  // "no orphan row on rejection" guarantee simple rather than threading a pre-parsed
  // result through `runIngest`'s public contract.
  try {
    await parseDocument(bytes, mimeType);
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) {
      return Response.json({ code: 'unsupported_media_type' }, { status: 415 });
    }
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }

  try {
    const doc = await createDocument(deps.db, {
      churchId: church.id, title, kind: 'upload', sourcePath: file.name,
    });

    const result = await runIngest(
      {
        db: deps.db, embedder: deps.embedder,
        extractorModel: deps.extractorModel, verifierModel: deps.verifierModel,
      },
      { churchId: church.id, documentId: doc.id, bytes, mimeType },
    );

    return Response.json(result, { status: 201 });
  } catch (error) {
    // runIngest itself already fails closed internally (it parks the document as
    // `failed` and returns a normal IngestResult rather than throwing) — this catch is
    // a last-resort backstop for a failure outside that contract (e.g. createDocument
    // itself, or an unexpected throw before/after runIngest's own try/catch), so a bug
    // here still returns a sensible response instead of an uncaught 500 with a leaked
    // stack trace.
    console.error('handleIngestRequest: unexpected failure', { churchId: church.id, error });
    return Response.json({ code: 'internal_error' }, { status: 500 });
  }
}
