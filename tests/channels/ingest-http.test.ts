import { describe, expect, it, vi } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { handleIngestRequest, INGEST_LIMIT } from '@/channels/ingest-http';
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

const TOKEN = 'test-ingest-token';

async function setupDemo() {
  const db = await createTestDb();
  const [church] = await db.insert(churches).values({ slug: 'demo', name: 'Igreja da Colina' }).returning();
  await db.insert(budgets).values({ churchId: church.id, monthlyUsd: 40 });
  return { db, church };
}

function deps(db: unknown, over: Record<string, unknown> = {}) {
  return { db, embedder: new HashEmbedder(), globalCapUsd: 50, ingestToken: TOKEN, ...over } as never;
}

function ingestReq(body: FormData, opts: { token?: string | null } = {}) {
  const headers = new Headers();
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('http://test/api/ingest', { method: 'POST', headers, body });
}

function form(text: string, name = 'boletim.md', type = 'text/markdown', title = 'Boletim') {
  const fd = new FormData();
  fd.set('file', new File([text], name, { type }));
  fd.set('title', title);
  return fd;
}

describe('handleIngestRequest', () => {
  it('rejects a request with no token', async () => {
    const { db } = await setupDemo();
    const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), { token: null }));
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const { db } = await setupDemo();
    const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.'), { token: 'nope' }));
    expect(res.status).toBe(401);
  });

  it('rejects a request with no file', async () => {
    const { db } = await setupDemo();
    const fd = new FormData();
    fd.set('title', 'Sem arquivo');
    const res = await handleIngestRequest(deps(db), ingestReq(fd));
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported media type with 415 and persists nothing', async () => {
    const { db } = await setupDemo();
    const res = await handleIngestRequest(
      deps(db), ingestReq(form('binary', 'x.png', 'image/png')),
    );
    expect(res.status).toBe(415);
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  it('rejects an oversized file with 413', async () => {
    const { db } = await setupDemo();
    const big = 'a'.repeat(6 * 1024 * 1024);
    const res = await handleIngestRequest(deps(db), ingestReq(form(big)));
    expect(res.status).toBe(413);
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  it('ingests a markdown document and reports the result', async () => {
    const { db } = await setupDemo();
    const res = await handleIngestRequest(
      deps(db), ingestReq(form('# Boletim\n\n## Culto\n\nDomingo às 10h.')),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('published');
    expect(body.chunkCount).toBeGreaterThan(0);
    expect((await db.select().from(documents))[0].title).toBe('Boletim');
    expect((await db.select().from(chunks)).length).toBe(body.chunkCount);
  });

  it('returns 402 when the budget is exhausted, without creating a document', async () => {
    const { db } = await setupDemo();
    const res = await handleIngestRequest(
      deps(db, { globalCapUsd: 0 }), ingestReq(form('# Doc\n\nTexto.')),
    );
    expect(res.status).toBe(402);
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  // The brief's HTTP contract documents 429 as a reachable status, but the verbatim test
  // block above (from the task brief) does not exercise it. Added the same way
  // tests/channels/web.test.ts proves CHAT_LIMIT trips 429: send one more request than the
  // window allows and assert the last one is rejected.
  it('returns 429 after the per-church ingest limit, and not before', async () => {
    const { db } = await setupDemo();
    let last: Response | undefined;
    for (let i = 0; i < INGEST_LIMIT.limit + 1; i++) {
      last = await handleIngestRequest(deps(db), ingestReq(form(`# Doc ${i}\n\nTexto ${i}.`)));
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
      const { db } = await setupDemo();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const selectSpy = vi.spyOn(db, 'select').mockImplementation(() => {
        throw new Error('connection terminated unexpectedly');
      });

      const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.')));

      selectSpy.mockRestore();
      errSpy.mockRestore();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ code: 'internal_error' });
      expect(await db.select().from(documents)).toHaveLength(0);
    });

    it('rate-limit write fails', async () => {
      const { db } = await setupDemo();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // getChurchBySlug uses db.select (must succeed to reach checkRateLimit); checkRateLimit
      // is the only db.insert call reached before the handler would otherwise return.
      const insertSpy = vi.spyOn(db, 'insert').mockImplementation(() => {
        throw new Error('connection terminated unexpectedly');
      });

      const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.')));

      insertSpy.mockRestore();
      errSpy.mockRestore();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ code: 'internal_error' });
      expect(await db.select().from(documents)).toHaveLength(0);
    });

    it('budget check fails', async () => {
      const { db } = await setupDemo();
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

      const res = await handleIngestRequest(deps(db), ingestReq(form('# Doc\n\nTexto.')));

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
    const { db } = await setupDemo();
    const withNul = `# Boletim\n\nTexto ${String.fromCharCode(0)} com byte nulo.`;
    const res = await handleIngestRequest(deps(db), ingestReq(form(withNul)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'bad_request' });
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  it('rejects text containing a lone UTF-16 surrogate, persisting no document row', async () => {
    const { db } = await setupDemo();
    parseDocumentMock.mockImplementationOnce(async () => ({
      text: `Boletim ${String.fromCharCode(0xd800)} evento`,
      pageCount: 1,
    }));

    const res = await handleIngestRequest(
      deps(db), ingestReq(form('conteudo irrelevante — parseDocument is mocked for this call', 'x.pdf', 'application/pdf')),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'bad_request' });
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  // M4: a 1 MB title used to be accepted and persisted as-is.
  it('rejects a title over the length bound with 400, persisting nothing', async () => {
    const { db } = await setupDemo();
    const hugeTitle = 'A'.repeat(400);
    const res = await handleIngestRequest(
      deps(db), ingestReq(form('# Doc\n\nTexto.', 'boletim.md', 'text/markdown', hugeTitle)),
    );
    expect(res.status).toBe(400);
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  // M1: `.replace(/^Bearer\s+/i, '')` on a header with no "Bearer " prefix is a no-op, not a
  // rejection — a bare `Authorization: <token>` used to authenticate successfully.
  it('rejects a bare token with no "Bearer" prefix', async () => {
    const { db } = await setupDemo();
    const headers = new Headers({ authorization: TOKEN });
    const res = await handleIngestRequest(
      deps(db),
      new Request('http://test/api/ingest', { method: 'POST', headers, body: form('# Doc\n\nTexto.') }),
    );
    expect(res.status).toBe(401);
  });

  it('still accepts a lowercase "bearer" prefix', async () => {
    const { db } = await setupDemo();
    const headers = new Headers({ authorization: `bearer ${TOKEN}` });
    const res = await handleIngestRequest(
      deps(db),
      new Request('http://test/api/ingest', {
        method: 'POST', headers, body: form('# Boletim\n\n## Culto\n\nDomingo às 10h.'),
      }),
    );
    expect(res.status).toBe(201);
  });
});
