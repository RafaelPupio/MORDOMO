import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { Embedder } from '@/ai/embedder';
import { HashEmbedder } from '@/ai/embedder';
import { handleIngestRequest, INGEST_LIMIT } from '@/channels/ingest-http';
import { SESSION_TTL_SECONDS, signSession, STAFF_COOKIE_NAME } from '@/core/staff-session';
import { createDocument } from '@/db/repo/documents';
import { budgets, chunks, churches, documents } from '@/db/schema';
import { createTestDb } from '../helpers/db';

// parseDocument is mocked at the module level, by default delegating to the real
// implementation (same pattern as tests/agent/extractor.test.ts's `generateObjectMock`), so
// every test except the lone-surrogate one below still exercises the actual parser. That
// one test overrides it for a single call via mockImplementationOnce, to reach a text shape
// (an unpaired UTF-16 surrogate) that a real file upload cannot actually produce here: both
// the Blob/File API's own UTF-8 encoding step and the WHATWG-conformant TextDecoder that
// parseDocument uses for text uploads replace an unpaired surrogate with U+FFFD before it
// could ever reach this guard. It IS reachable in production via a malicious PDF's
// font/CMap text extraction (unpdf/pdf.js resolves glyphs to arbitrary Unicode code points,
// not via UTF-8 decoding) — mocking the parse result exercises the guard the same way that
// path would, without depending on a hand-built PDF fixture.
const parseDocumentMock = vi.hoisted(() => vi.fn());
vi.mock('@/core/parse-document', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/parse-document')>();
  parseDocumentMock.mockImplementation(actual.parseDocument);
  return { ...actual, parseDocument: parseDocumentMock };
});

const SECRET = 'test-staff-session-secret';

async function setupDemo() {
  const db = await createTestDb();
  const [church] = await db.insert(churches).values({ slug: 'demo', name: 'Igreja da Colina' }).returning();
  await db.insert(budgets).values({ churchId: church.id, monthlyUsd: 40 });
  const cookie = sessionCookieFor(church.id);
  return { db, church, cookie };
}

function deps(db: unknown, over: Record<string, unknown> = {}) {
  return { db, embedder: new HashEmbedder(), globalCapUsd: 50, staffSessionSecret: SECRET, ...over } as never;
}

function sessionCookieFor(
  churchId: string,
  opts: { secret?: string; expired?: boolean } = {},
): string {
  const issuedAt = Date.now();
  const expiresAt = opts.expired ? issuedAt - 1000 : issuedAt + SESSION_TTL_SECONDS * 1000;
  return signSession({ churchId, issuedAt, expiresAt }, opts.secret ?? SECRET);
}

// `cookie` defaults to a valid session for the demo church, matching the previous helper's
// "valid token unless told otherwise" default — pass `cookie: null` to omit the header, or
// any other string to present a specific (possibly invalid) session.
function ingestReq(body: FormData, defaultCookie: string, opts: { cookie?: string | null } = {}) {
  const headers = new Headers();
  const cookie = opts.cookie === undefined ? defaultCookie : opts.cookie;
  if (cookie) headers.set('cookie', `${STAFF_COOKIE_NAME}=${cookie}`);
  return new Request('http://test/api/ingest', { method: 'POST', headers, body });
}

function form(text: string, name = 'boletim.md', type = 'text/markdown', title = 'Boletim', documentId?: string) {
  const fd = new FormData();
  fd.set('file', new File([text], name, { type }));
  fd.set('title', title);
  if (documentId !== undefined) fd.set('documentId', documentId);
  return fd;
}

describe('handleIngestRequest', () => {
  // POST /api/ingest is authorised by the same staff session cookie that guards the rest
  // of /staff — not a separate shared secret. Plan 2 shipped `INGEST_TOKEN` as an explicit
  // placeholder for exactly this and recorded that it must be retired once staff auth
  // existed, not stacked underneath it (brain/log/decisions.md).
  describe('session auth', () => {
    it('rejects a request with no session cookie', async () => {
      const { db, cookie } = await setupDemo();
      const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), cookie, { cookie: null }));
      expect(res.status).toBe(401);
    });

    it('rejects a garbage cookie value', async () => {
      const { db, cookie } = await setupDemo();
      const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), cookie, { cookie: 'garbage' }));
      expect(res.status).toBe(401);
    });

    it('rejects a session signed with the wrong secret', async () => {
      const { db, church, cookie } = await setupDemo();
      const wrongSecret = sessionCookieFor(church.id, { secret: 'not-the-configured-secret' });
      const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), cookie, { cookie: wrongSecret }));
      expect(res.status).toBe(401);
    });

    it('rejects an expired session', async () => {
      const { db, church, cookie } = await setupDemo();
      const expired = sessionCookieFor(church.id, { expired: true });
      const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), cookie, { cookie: expired }));
      expect(res.status).toBe(401);
    });

    // A session's churchId must match the actual church row, not just verify — the same
    // check `requireStaffContext` (src/core/staff-context.ts) makes, guarding against a
    // session signed for a church that was later re-seeded under a fresh id.
    it('rejects a session signed for a different church', async () => {
      const { db, cookie } = await setupDemo();
      const otherChurchCookie = sessionCookieFor('11111111-1111-1111-1111-111111111111');
      const res = await handleIngestRequest(
        deps(db), ingestReq(form('# Doc\n\nTexto.'), cookie, { cookie: otherChurchCookie }),
      );
      expect(res.status).toBe(401);
    });

    it('rejects every request when no session secret is configured, even with an otherwise valid cookie', async () => {
      const { db, cookie } = await setupDemo();
      const res = await handleIngestRequest(
        deps(db, { staffSessionSecret: undefined }), ingestReq(form('# Doc\n\nTexto.'), cookie),
      );
      expect(res.status).toBe(401);
    });

    it('accepts a valid session and ingests the document', async () => {
      const { db, cookie } = await setupDemo();
      const res = await handleIngestRequest(
        deps(db), ingestReq(form('# Boletim\n\n## Culto\n\nDomingo às 10h.'), cookie),
      );
      expect(res.status).toBe(201);
    });
  });

  it('rejects a request with no file', async () => {
    const { db, cookie } = await setupDemo();
    const fd = new FormData();
    fd.set('title', 'Sem arquivo');
    const res = await handleIngestRequest(deps(db), ingestReq(fd, cookie));
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported media type with 415 and persists nothing', async () => {
    const { db, cookie } = await setupDemo();
    const res = await handleIngestRequest(
      deps(db), ingestReq(form('binary', 'x.png', 'image/png'), cookie),
    );
    expect(res.status).toBe(415);
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  it('rejects an oversized file with 413', async () => {
    const { db, cookie } = await setupDemo();
    const big = 'a'.repeat(6 * 1024 * 1024);
    const res = await handleIngestRequest(deps(db), ingestReq(form(big), cookie));
    expect(res.status).toBe(413);
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  it('ingests a markdown document and reports the result', async () => {
    const { db, cookie } = await setupDemo();
    const res = await handleIngestRequest(
      deps(db), ingestReq(form('# Boletim\n\n## Culto\n\nDomingo às 10h.'), cookie),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('published');
    expect(body.chunkCount).toBeGreaterThan(0);
    expect((await db.select().from(documents))[0].title).toBe('Boletim');
    expect((await db.select().from(chunks)).length).toBe(body.chunkCount);
  });

  it('returns 402 when the budget is exhausted, without creating a document', async () => {
    const { db, cookie } = await setupDemo();
    const res = await handleIngestRequest(
      deps(db, { globalCapUsd: 0 }), ingestReq(form('# Doc\n\nTexto.'), cookie),
    );
    expect(res.status).toBe(402);
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  // The brief's HTTP contract documents 429 as a reachable status, but the verbatim test
  // block above (from the task brief) does not exercise it. Added the same way
  // tests/channels/web.test.ts proves CHAT_LIMIT trips 429: send one more request than the
  // window allows and assert the last one is rejected.
  it('returns 429 after the per-church ingest limit, and not before', async () => {
    const { db, cookie } = await setupDemo();
    let last: Response | undefined;
    for (let i = 0; i < INGEST_LIMIT.limit + 1; i++) {
      last = await handleIngestRequest(deps(db), ingestReq(form(`# Doc ${i}\n\nTexto ${i}.`), cookie));
    }
    expect(last!.status).toBe(429);
  });

  // F1: the church lookup, the rate-limit write, and the budget check all run before the
  // handler's try/catch used to start — a thrown DB error at any of the three used to
  // escape the function entirely instead of producing a Response, violating the declared
  // `Promise<Response>` contract. Each of the next three tests forces exactly one of those
  // three gates to throw (simulating a realistic Neon cold-start "connection terminated
  // unexpectedly") and asserts the handler still returns a controlled 500 with nothing
  // leaked, and that no document row was created.
  describe('DB failures at each pre-flight gate return a controlled 500, never a thrown rejection', () => {
    it('church lookup fails', async () => {
      const { db, cookie } = await setupDemo();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => {
        throw new Error('connection terminated unexpectedly');
      });

      const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), cookie));

      selectSpy.mockRestore();
      errSpy.mockRestore();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ code: 'internal_error' });
      expect(await db.select().from(documents)).toHaveLength(0);
    });

    it('rate-limit write fails', async () => {
      const { db, cookie } = await setupDemo();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // getChurchBySlug uses db.select (must succeed to reach checkRateLimit); checkRateLimit
      // is the only db.insert call reached before the handler would otherwise return.
      const insertSpy = vi.spyOn(db, 'insert').mockImplementation(() => {
        throw new Error('connection terminated unexpectedly');
      });

      const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), cookie));

      insertSpy.mockRestore();
      errSpy.mockRestore();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ code: 'internal_error' });
      expect(await db.select().from(documents)).toHaveLength(0);
    });

    it('budget check fails', async () => {
      const { db, cookie } = await setupDemo();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Call 1 is getChurchBySlug's own select, which must succeed so the flow actually
      // reaches checkBudget; call 2 is checkBudget's first select, which is the one made to
      // fail here. (checkRateLimit, in between, uses db.insert, not db.select.)
      const originalSelect = db.select.bind(db);
      let selectCalls = 0;
      const selectSpy = vi.spyOn(db, 'select').mockImplementation(((...args: unknown[]) => {
        selectCalls += 1;
        if (selectCalls === 2) throw new Error('connection terminated unexpectedly');
        return (originalSelect as (...a: unknown[]) => unknown)(...args);
      }) as typeof db.select);

      const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), cookie));

      selectSpy.mockRestore();
      errSpy.mockRestore();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ code: 'internal_error' });
      expect(await db.select().from(documents)).toHaveLength(0);
    });
  });

  // F2: a NUL byte (well-formed UTF-16, but a Postgres text/jsonb column refuses to store
  // it) used to sail through as a normal 201, leaving a `documents` row stuck at the
  // non-terminal `parsing` status once the chunk insert failed downstream. Rejecting it here
  // — before any row exists — matches src/channels/web.ts's guard on chat message text.
  it('rejects a file containing a NUL byte, persisting no document row', async () => {
    const { db, cookie } = await setupDemo();
    const withNul = `# Boletim\n\nTexto ${String.fromCharCode(0)} com byte nulo.`;
    const res = await handleIngestRequest(deps(db), ingestReq(form(withNul), cookie));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'bad_request' });
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  it('rejects text containing a lone UTF-16 surrogate, persisting no document row', async () => {
    const { db, cookie } = await setupDemo();
    parseDocumentMock.mockImplementationOnce(async () => ({
      text: `Boletim ${String.fromCharCode(0xd800)} evento`,
      pageCount: 1,
    }));

    const res = await handleIngestRequest(
      deps(db),
      ingestReq(form('conteudo irrelevante — parseDocument is mocked for this call', 'x.pdf', 'application/pdf'), cookie),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'bad_request' });
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  // M4: a 1 MB title used to be accepted and persisted as-is.
  it('rejects a title over the length bound with 400, persisting nothing', async () => {
    const { db, cookie } = await setupDemo();
    const hugeTitle = 'A'.repeat(400);
    const res = await handleIngestRequest(
      deps(db), ingestReq(form('# Doc\n\nTexto.', 'boletim.md', 'text/markdown', hugeTitle), cookie),
    );
    expect(res.status).toBe(400);
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  // I1: `runIngest` never throws — it fails closed internally and returns a normal
  // IngestResult with `status: 'failed'` (see src/core/ingest.ts). Before the fix, this
  // handler returned 201 unconditionally, so a run that produced zero chunks and zero
  // events still read as success to any caller checking only the HTTP status.
  it('returns a non-201 status when the run itself fails, not 201 (I1)', async () => {
    const { db, cookie } = await setupDemo();
    const throwingEmbedder: Embedder = {
      model: 'throwing-embedder',
      embed: async () => { throw new Error('embedding API unavailable'); },
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleIngestRequest(
      deps(db, { embedder: throwingEmbedder }), ingestReq(form('# Boletim\n\n## Culto\n\nDomingo às 10h.'), cookie),
    );
    errSpy.mockRestore();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.chunkCount).toBe(0);
  });

  // C2: the only shipped entry point always called `createDocument`, so a bulletin
  // uploaded twice always got two documents and two sets of chunks — the "re-ingest
  // replaces rather than appends" design (src/core/ingest.ts) had no caller. An optional
  // `documentId` field is how a caller now expresses "re-ingest this document".
  describe('re-ingest via an optional documentId field (C2)', () => {
    it('re-ingest with a valid documentId replaces rather than duplicates', async () => {
      const { db, cookie } = await setupDemo();
      const first = await handleIngestRequest(
        deps(db), ingestReq(form('# Boletim\n\n## Culto\n\nDomingo às 10h.'), cookie),
      );
      expect(first.status).toBe(201);
      const firstBody = await first.json();
      const documentId = firstBody.documentId as string;

      const second = await handleIngestRequest(
        deps(db),
        ingestReq(form('# Boletim\n\n## Culto (horário atualizado)\n\nDomingo às 11h.', 'boletim.md', 'text/markdown', 'Boletim', documentId), cookie),
      );
      expect(second.status).toBe(201);
      const secondBody = await second.json();
      expect(secondBody.documentId).toBe(documentId);

      const docs = await db.select().from(documents);
      expect(docs).toHaveLength(1); // still exactly one document, not two
      expect(docs[0].id).toBe(documentId);
      const storedChunks = await db.select().from(chunks);
      expect(storedChunks.length).toBe(secondBody.chunkCount); // no accumulation from the first run
      expect(storedChunks.some((c) => c.content.includes('11h'))).toBe(true);
      expect(storedChunks.some((c) => c.content.includes('10h'))).toBe(false);
    });

    it('a documentId belonging to another church is rejected with 404 and nothing is written', async () => {
      const { db, church, cookie } = await setupDemo();
      const [otherChurch] = await db.insert(churches).values({ slug: 'outra-igreja', name: 'Outra Igreja' }).returning();
      const otherDoc = await createDocument(db, { churchId: otherChurch.id, title: 'Documento de outra igreja', kind: 'upload' });

      const res = await handleIngestRequest(
        deps(db), ingestReq(form('# Boletim\n\nTexto.', 'boletim.md', 'text/markdown', 'Boletim', otherDoc.id), cookie),
      );

      expect(res.status).toBe(404);
      // Nothing was written for the demo church, and the other church's document is untouched.
      expect(await db.select().from(documents).where(eq(documents.churchId, church.id))).toHaveLength(0);
      const otherAfter = await db.select().from(documents).where(eq(documents.id, otherDoc.id));
      expect(otherAfter).toHaveLength(1);
      expect(otherAfter[0].ingestStatus).toBe(otherDoc.ingestStatus);
    });

    it('a malformed documentId is rejected with 400, persisting nothing', async () => {
      const { db, cookie } = await setupDemo();
      const res = await handleIngestRequest(
        deps(db), ingestReq(form('# Boletim\n\nTexto.', 'boletim.md', 'text/markdown', 'Boletim', 'not-a-uuid'), cookie),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: 'bad_request' });
      expect(await db.select().from(documents)).toHaveLength(0);
    });
  });
});
