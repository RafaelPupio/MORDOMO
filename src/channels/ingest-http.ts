import type { LanguageModel } from 'ai';
import { checkBudget } from '@/ai/usage';
import type { Embedder } from '@/ai/embedder';
import { INGEST_LIMIT } from '@/core/config';
import { readStaffSession } from '@/core/staff-auth';
import { STAFF_COOKIE_NAME } from '@/core/staff-session';
import { runIngest } from '@/core/ingest';
import { parseDocument, UnsupportedMediaTypeError } from '@/core/parse-document';
import { checkRateLimit } from '@/core/rate-limit';
import { hasUnstorableChars } from '@/core/text-safety';
import type { Db } from '@/db/client';
import { DEMO_ORGANIZATION_SLUG, getOrganizationBySlug } from '@/db/repo/organizations';
import { createDocument, getDocument } from '@/db/repo/documents';

export type IngestChannelDeps = {
  db: Db;
  embedder: Embedder;
  globalCapUsd: number;
  /**
   * Secret used to verify the staff session cookie (see `src/core/staff-session.ts`).
   * `POST /api/ingest` is authorised the same way every other staff mutation is: a valid,
   * unexpired session, never a shared bearer token. Plan 2 shipped `INGEST_TOKEN` as an
   * explicit placeholder for exactly this and recorded that it must be retired, not
   * stacked, once staff auth existed — see the 2026-08-20 Plan 2 decision and the Plan 3
   * entry in `brain/log/decisions.md`.
   */
  staffSessionSecret: string | undefined;
  extractorModel?: LanguageModel;
  verifierModel?: LanguageModel;
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// A 1 MB title was accepted and persisted before this bound existed — nothing downstream
// needs more than a short label, so this is deliberately generous for any real title while
// still ruling out someone using the field to stash arbitrary payload.
const MAX_TITLE_CHARS = 300;
// `documents.id` is a Postgres `uuid` column — a malformed value passed straight to a
// query would surface as a raw driver error deep inside `getDocument`, which would fall
// into this handler's generic 500 catch instead of the 400 a client-supplied bad value
// deserves. Checked at the door instead, before any DB round trip.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Re-exported for backward compatibility: this used to be declared here, and
// tests/channels/ingest-http.test.ts still imports it from this module. The real
// declaration now lives in src/core/config.ts — shared with the staff dashboard's own
// upload action (src/app/staff/(dashboard)/documentos/actions.ts), which runs the same
// pipeline behind the same session and used to rate-limit itself against a second, separate
// key (M5) — same "one neutral module, not one route's" reasoning, and the same
// re-export-for-compatibility pattern, as DEFAULT_GLOBAL_CAP_USD/parseGlobalCapUsd in
// src/app/api/chat/route.ts.
export { INGEST_LIMIT };

// Minimal `Cookie` header parser — deliberately not `next/headers`' `cookies()`, so this
// handler (and its auth check) can run against a plain `Request` in tests, the same way
// `src/core/staff-auth.ts`'s `readStaffSession` is kept free of `next/headers` for the
// same reason.
function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function handleIngestRequest(deps: IngestChannelDeps, req: Request): Promise<Response> {
  // Same session that guards every staff page and Server Action — no separate shared
  // secret. `readStaffSession` already fails closed: a missing cookie, an unconfigured
  // secret, a bad signature, or an expired session all return null here.
  const session = readStaffSession(
    readCookie(req.headers.get('cookie'), STAFF_COOKIE_NAME),
    deps.staffSessionSecret,
  );
  if (!session) {
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

  // Optional `documentId` field: its presence is how a caller expresses "re-ingest this
  // document" rather than "upload a new one" — the only way to reach that path, since
  // `createDocument` otherwise always inserts a fresh row (see the organization-scoped ownership
  // check below for the other half of this fix). Malformed input is rejected here, before
  // any DB round trip; ownership is checked after the organization is resolved below.
  const documentIdRaw = form.get('documentId');
  const documentId = typeof documentIdRaw === 'string' && documentIdRaw.trim() !== ''
    ? documentIdRaw.trim()
    : undefined;
  if (documentId !== undefined && !UUID_RE.test(documentId)) {
    return Response.json({ code: 'bad_request' }, { status: 400 });
  }

  // Everything below can throw on a DB failure — a realistic Neon path is a scale-to-zero
  // cold start surfacing as "connection terminated unexpectedly" mid-query — or on an
  // unexpected pipeline failure. This one try/catch, matching src/channels/web.ts's
  // posture, guarantees every one of those paths still returns a controlled Response
  // instead of an uncaught rejection that would either crash the handler or leak a stack
  // trace. Auth and body validation above stay OUTSIDE it so a 401/400 always stays a
  // 401/400, never getting reclassified as a 500.
  let organizationId: string | undefined;
  try {
    const organization = await getOrganizationBySlug(deps.db, DEMO_ORGANIZATION_SLUG);
    if (!organization) return Response.json({ code: 'not_seeded' }, { status: 500 });
    // A session signed for a organization that was later re-seeded (a fresh `organizations` row with
    // a new id, same demo slug) must not be silently admitted just because the cookie
    // still verifies — same reasoning, and the same check, as `requireStaffContext` in
    // `src/core/staff-context.ts`.
    if (session.organizationId !== organization.id) {
      return Response.json({ code: 'unauthorized' }, { status: 401 });
    }
    organizationId = organization.id;

    // A re-ingest target must belong to THIS organization. `getDocument` already scopes its
    // query by organizationId, so a documentId that exists but belongs to another tenant comes
    // back exactly the same as one that doesn't exist at all — undefined either way —
    // and gets the same 404, never distinguishing the two. Checked before the rate limit
    // and budget gates, same reasoning as those gates' own ordering: a request that will
    // be rejected anyway should not consume either.
    if (documentId !== undefined) {
      const existing = await getDocument(deps.db, organization.id, documentId);
      if (!existing) return Response.json({ code: 'not_found' }, { status: 404 });
    }

    const rate = await checkRateLimit(deps.db, `ingest:${organization.id}`, INGEST_LIMIT);
    if (!rate.allowed) return Response.json({ code: 'rate_limited' }, { status: 429 });

    const budget = await checkBudget(deps.db, organization.id, deps.globalCapUsd);
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

    // `documentId` present (and already confirmed to belong to this organization, above) means
    // re-ingest: reuse it instead of `createDocument`, which would otherwise insert a
    // fresh row every time — the ONLY caller of `runIngest` reachable over HTTP, so
    // without this branch, re-uploading the same bulletin always duplicated it instead of
    // replacing it, no matter how carefully `runIngest` itself implements replace.
    const targetDocumentId = documentId ?? (await createDocument(deps.db, {
      organizationId: organization.id, title, kind: 'upload', sourcePath: file.name,
    })).id;

    const result = await runIngest(
      {
        db: deps.db, embedder: deps.embedder,
        extractorModel: deps.extractorModel, verifierModel: deps.verifierModel,
      },
      { organizationId: organization.id, documentId: targetDocumentId, bytes, mimeType },
    );

    // `runIngest` never throws — it fails closed internally and returns a normal
    // IngestResult with `status: 'failed'` instead (see src/core/ingest.ts). Returning
    // 201 unconditionally would tell a caller a failed run — zero chunks, zero events,
    // nothing published — succeeded. 500 for `failed`, matching this handler's other
    // internal-failure responses; the body still carries the full IngestResult so a
    // caller that wants the detail (which stage failed, whether previous events survived)
    // still gets it, just under a status code that doesn't claim success.
    return Response.json(result, { status: result.status === 'failed' ? 500 : 201 });
  } catch (error) {
    // runIngest itself already fails closed internally (it parks the document as
    // `failed` and returns a normal IngestResult rather than throwing) — this catch is
    // the backstop for every failure that can happen outside that contract: the three DB
    // gates above (organization lookup, rate limit, budget), reading the upload body, or
    // createDocument itself. Log the real error server-side; the client only ever sees
    // a generic code, never a stack trace or raw SQL.
    console.error('handleIngestRequest: unexpected failure', { organizationId, error });
    return Response.json({ code: 'internal_error' }, { status: 500 });
  }
}
