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
// A 1 MB title was accepted and persisted before this bound existed — nothing downstream
// needs more than a short label, so this is deliberately generous for any real title while
// still ruling out someone using the field to stash arbitrary payload.
const MAX_TITLE_CHARS = 300;
// Exported so tests can assert against the actual value instead of duplicating a magic
// number that could silently drift out of sync with this file (same pattern as
// src/channels/web.ts's CHAT_LIMIT).
export const INGEST_LIMIT = { limit: 10, windowSeconds: 3600 };

// Constant-time comparison so, once both buffers are known to be the same length, a
// wrong-but-close guess cannot be distinguished from a wrong-and-far guess by response
// latency. `timingSafeEqual` requires equal-length buffers, so length is checked (and
// rejected on mismatch) first. That pre-check itself leaks one bit over timing: whether
// the PRESENTED token's length equals the SECRET's length — not, as an earlier version of
// this comment claimed, the presented length itself (which the caller trivially already
// knows). This is accepted as a small, unavoidable leak: learning the secret's length only
// tells an attacker which length to brute-force, it does not narrow the token's contents,
// and timingSafeEqual has no way to compare two different-length buffers without throwing.
function tokenMatches(expected: string, presented: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const presentedBuf = Buffer.from(presented);
  if (expectedBuf.length !== presentedBuf.length) return false;
  return timingSafeEqual(expectedBuf, presentedBuf);
}

// `String.prototype.isWellFormed()` (ES2024) is false exactly for strings holding an
// unpaired UTF-16 surrogate. NUL is well-formed UTF-16 but still unstorable in a Postgres
// text/jsonb column, so it needs its own check. Same check src/channels/web.ts applies to
// chat message text, applied here to a parsed document's extracted text.
function hasUnstorableChars(text: string): boolean {
  return text.includes('\u0000') || !text.isWellFormed();
}

export async function handleIngestRequest(deps: IngestChannelDeps, req: Request): Promise<Response> {
  // Without a configured token the endpoint is closed, not open: an unset secret must
  // never mean "anyone may ingest". `deps.ingestToken` being empty/undefined always
  // fails this check, regardless of what the caller presents.
  const expected = deps.ingestToken;
  // Requires the literal "Bearer " prefix (case-insensitive) before extracting the token —
  // `.replace(/^Bearer\s+/i, '')` on a header with NO such prefix is a no-op, not a
  // rejection, so a bare `Authorization: <token>` used to authenticate successfully. A
  // header that doesn't match the pattern at all now yields `undefined`, which the check
  // below already treats as "not presented".
  const authHeader = req.headers.get('authorization');
  const presented = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
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
  if (title.length > MAX_TITLE_CHARS) {
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }
  // Checked from File.size — a property the runtime fills in from the upload's declared
  // length — before the body is ever read into memory, so an oversized upload is rejected
  // without buffering it first.
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ code: 'file_too_large' }, { status: 413 });
  }

  // Everything below can throw on a DB failure — a realistic Neon path is a scale-to-zero
  // cold start surfacing as "connection terminated unexpectedly" mid-query — or on an
  // unexpected pipeline failure. This one try/catch, matching src/channels/web.ts's
  // posture, guarantees every one of those paths still returns a controlled Response
  // instead of an uncaught rejection that would either crash the handler or leak a stack
  // trace. Auth and body validation above stay OUTSIDE it so a 401/400 always stays a
  // 401/400, never getting reclassified as a 500.
  let churchId: string | undefined;
  try {
    const church = await getChurchBySlug(deps.db, DEMO_CHURCH_SLUG);
    if (!church) return Response.json({ code: 'not_seeded' }, { status: 500 });
    churchId = church.id;

    const rate = await checkRateLimit(deps.db, `ingest:${church.id}`, INGEST_LIMIT);
    if (!rate.allowed) return Response.json({ code: 'rate_limited' }, { status: 429 });

    const budget = await checkBudget(deps.db, church.id, deps.globalCapUsd);
    if (!budget.allowed) {
      return Response.json({ code: 'budget_exhausted', reason: budget.reason }, { status: 402 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';

    // Parse once here, before creating the document row, purely to reject an unsupported
    // media type — or unstorable text (see below) — early: a rejected upload must leave
    // no orphan `documents` row behind. `runIngest` below parses the same bytes again as
    // its own first pipeline stage — this double-parse is deliberate and cheap for
    // demo-sized documents, and it keeps the "no orphan row on rejection" guarantee
    // simple rather than threading a pre-parsed result through `runIngest`'s public
    // contract.
    let parsed: Awaited<ReturnType<typeof parseDocument>>;
    try {
      parsed = await parseDocument(bytes, mimeType);
    } catch (error) {
      if (error instanceof UnsupportedMediaTypeError) {
        return Response.json({ code: 'unsupported_media_type' }, { status: 415 });
      }
      return Response.json({ code: 'bad_request' }, { status: 400 });
    }

    // Postgres text/jsonb columns reject an embedded NUL byte or a lone (unpaired) UTF-16
    // surrogate outright. Left unchecked here, that rejection surfaces deep inside
    // runIngest's chunk insert instead of at the door — and the pipeline's own recovery
    // write (which tries to park the document as `failed`) can carry that same unstorable
    // byte in ITS error message and fail too, leaving a `documents` row stuck at a
    // non-terminal status forever (see forceIngestFailed's sanitization in
    // src/core/ingest.ts for the other half of this fix). Reject here instead, before any
    // row exists — matching src/channels/web.ts's guard on chat message text.
    if (hasUnstorableChars(parsed.text)) {
      return Response.json({ code: 'bad_request' }, { status: 400 });
    }

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
    // the backstop for every failure that can happen outside that contract: the three DB
    // gates above (church lookup, rate limit, budget), reading the upload body, or
    // createDocument itself. Log the real error server-side; the client only ever sees
    // a generic code, never a stack trace or raw SQL.
    console.error('handleIngestRequest: unexpected failure', { churchId, error });
    return Response.json({ code: 'internal_error' }, { status: 500 });
  }
}
