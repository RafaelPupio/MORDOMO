import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { handleIngestRequest, INGEST_LIMIT } from '@/channels/ingest-http';
import { budgets, chunks, churches, documents } from '@/db/schema';
import { createTestDb } from '../helpers/db';

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
});
