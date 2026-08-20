import { describe, expect, it, vi } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { runIngest } from '@/core/ingest';
import { createDocument, getDocument } from '@/db/repo/documents';
import { listUpcomingEvents } from '@/db/repo/events';
import { chunks, events, usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

const DOC = [
  '# Boletim de Outubro',
  '',
  '## Encontro de jovens OTB — 10/10 (sábado)',
  '',
  'Às 19h, na quadra coberta.',
  '',
  '## Noite de louvor — 31/10 (sábado)',
  '',
  'Com o coral, às 19h30.',
].join('\n');

const bytes = () => new TextEncoder().encode(DOC);

// Adapted from the brief's fixture the same way tests/agent/extractor.test.ts and
// tests/agent/verifier.test.ts already were: this installed SDK version's
// LanguageModelV3Usage requires cacheRead/cacheWrite on inputTokens and reasoning on
// outputTokens as present keys (each typed `number | undefined`, but the key itself is
// not optional) — omitting them type-checks under vitest's transform-only run but fails
// `tsc --noEmit`.
async function objectModel(payloads: unknown[]) {
  const { MockLanguageModelV3 } = await import('ai/test');
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 30, text: 30, reasoning: undefined },
      },
      content: [{ type: 'text', text: JSON.stringify(payloads[Math.min(call++, payloads.length - 1)]) }],
      warnings: [],
    }),
  });
}

const TWO_CANDIDATES = {
  events: [
    { title: 'Encontro de jovens OTB', startsAt: '2026-10-10T22:00:00Z', location: 'Quadra coberta',
      description: null, confidence: 0.9, sourceQuote: 'Encontro de jovens OTB — 10/10 (sábado)' },
    { title: 'Noite de louvor', startsAt: '2026-10-31T22:30:00Z', location: null,
      description: null, confidence: 0.8, sourceQuote: 'Noite de louvor — 31/10 (sábado)' },
  ],
};

describe('runIngest', () => {
  it('parses, chunks, embeds, extracts, verifies and publishes', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });

    const result = await runIngest(
      {
        db,
        embedder: new HashEmbedder(),
        extractorModel: await objectModel([TWO_CANDIDATES]),
        verifierModel: await objectModel([
          { decision: 'confirmed', note: 'Confere.' },
          { decision: 'rejected', note: 'Nao confere.' },
        ]),
      },
      { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' },
    );

    expect(result.status).toBe('published');
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.extracted).toBe(2);
    expect(result.published + result.rejected).toBe(2);

    // Only confirmed events reach the calendar, and they carry their provenance.
    const stored = await db.select().from(events);
    expect(stored).toHaveLength(result.published);
    for (const e of stored) {
      expect(e.verified).toBe(true);
      expect(e.sourceDocumentId).toBe(doc.id);
      expect(e.sourceQuote).toBeTruthy();
    }

    // Chunks are searchable and tenant-scoped.
    const storedChunks = await db.select().from(chunks);
    expect(storedChunks.length).toBe(result.chunkCount);
    expect(storedChunks.every((c) => c.churchId === church.id)).toBe(true);

    // The document ends in a terminal state with its parsed text retained.
    const after = await getDocument(db, church.id, doc.id);
    expect(after.ingestStatus).toBe('published');
    expect(after.sourceText).toContain('Encontro de jovens');
    expect(after.ingestError).toBeNull();

    // Both agent stages were metered.
    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'ingest.extract')).toBe(true);
    expect(ledger.some((u) => u.feature === 'ingest.verify')).toBe(true);
  });

  it('publishes no events when every candidate is rejected, but still publishes the document', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });

    const result = await runIngest(
      {
        db, embedder: new HashEmbedder(),
        extractorModel: await objectModel([TWO_CANDIDATES]),
        verifierModel: await objectModel([{ decision: 'rejected', note: 'Nao confere.' }]),
      },
      { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' },
    );

    expect(result.published).toBe(0);
    expect(result.rejected).toBe(2);
    expect(result.status).toBe('published');
    expect(await listUpcomingEvents(db, church.id, 10, new Date('2026-10-01'))).toHaveLength(0);
    // Retrieval still works even when extraction yields nothing.
    expect((await db.select().from(chunks)).length).toBeGreaterThan(0);
  });

  it('marks the document failed and records the reason when parsing fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Imagem', kind: 'upload' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runIngest(
      { db, embedder: new HashEmbedder() },
      { churchId: church.id, documentId: doc.id, bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
    );

    expect(result.status).toBe('failed');
    const after = await getDocument(db, church.id, doc.id);
    expect(after.ingestStatus).toBe('failed');
    expect(after.ingestError).toMatch(/image\/png/);
    expect(await db.select().from(chunks)).toHaveLength(0);
    spy.mockRestore();
  });

  it('re-ingesting replaces the previous chunks instead of duplicating them', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });
    const deps = () => ({
      db, embedder: new HashEmbedder(),
      extractorModel: undefined, verifierModel: undefined,
    });
    const input = { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' };

    const first = await runIngest({ ...deps(), extractorModel: undefined }, input);
    const countAfterFirst = (await db.select().from(chunks)).length;
    expect(countAfterFirst).toBe(first.chunkCount);

    // A published document is re-ingested as a fresh run; chunks must not accumulate.
    const second = await runIngest({ ...deps() }, input);
    expect(second.status).toBe('published');
    expect((await db.select().from(chunks)).length).toBe(second.chunkCount);
  });

  it('never touches another tenant’s data', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const docB = await createDocument(db, { churchId: b.id, title: 'B', kind: 'bulletin' });

    await expect(
      runIngest({ db, embedder: new HashEmbedder() },
        { churchId: a.id, documentId: docB.id, bytes: bytes(), mimeType: 'text/markdown' }),
    ).rejects.toThrow(/not found/i);
  });
});
