import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { Embedder } from '@/ai/embedder';
import { HashEmbedder } from '@/ai/embedder';
import { MAX_CANDIDATES, MAX_EXTRACTION_CHARS, runIngest } from '@/core/ingest';
import { createDocument, getDocument } from '@/db/repo/documents';
import { listUpcomingEvents } from '@/db/repo/events';
import { chunks, documents, events, usageLedger } from '@/db/schema';
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

// Simulates a total agent-call outage (e.g. a gateway 503) — `doGenerate` itself throws,
// rather than resolving with an error-shaped payload, matching how `generateObject` sees
// a real network/gateway failure.
async function throwingModel(message: string) {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({
    doGenerate: async () => { throw new Error(message); },
  });
}

const ONE_CONFIRMED = {
  events: [
    { title: 'Encontro de jovens OTB', startsAt: '2026-10-10T22:00:00Z', location: 'Quadra coberta',
      description: null, confidence: 0.9, sourceQuote: 'Encontro de jovens OTB — 10/10 (sábado)' },
  ],
};

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

    // The document ends in a terminal state.
    const after = await getDocument(db, church.id, doc.id);
    expect(after.ingestStatus).toBe('published');
    expect(after.ingestError).toBeNull();
    expect(result.eventsReplaced).toBe(true);
    expect(result.extractionFailed).toBe(false);

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

  it('a failed re-ingest does not destroy the document’s existing, previously published chunks', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });
    const input = { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' };

    // First ingest succeeds and publishes with real, retrievable chunks.
    const first = await runIngest({ db, embedder: new HashEmbedder() }, input);
    expect(first.status).toBe('published');
    expect(first.chunkCount).toBeGreaterThan(0);
    const chunksBefore = await db.select().from(chunks).orderBy(chunks.seq);
    expect(chunksBefore.length).toBe(first.chunkCount);

    // Re-ingest hits a transient embedding-API outage.
    const throwingEmbedder: Embedder = {
      model: 'throwing-embedder',
      embed: async () => { throw new Error('embedding API unavailable'); },
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = await runIngest({ db, embedder: throwingEmbedder }, input);
    errSpy.mockRestore();

    expect(second.status).toBe('failed');
    const after = await getDocument(db, church.id, doc.id);
    expect(after.ingestStatus).toBe('failed');
    expect(after.ingestError).toMatch(/embedding API unavailable/);

    // The ORIGINAL chunks must still be present: a failed re-ingest must never leave a
    // previously published document with zero retrievable chunks.
    const chunksAfter = await db.select().from(chunks).orderBy(chunks.seq);
    expect(chunksAfter.map((c) => c.content)).toEqual(chunksBefore.map((c) => c.content));
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

  it('a corrupted ingest_status is parked in failed, with a diagnostic, instead of stuck forever', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });

    // Simulate a hand-edited or stale row: a value outside the known IngestStatus set.
    await db.update(documents).set({ ingestStatus: 'archived' }).where(eq(documents.id, doc.id));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runIngest(
      { db, embedder: new HashEmbedder() },
      { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' },
    );
    errSpy.mockRestore();

    const after = await getDocument(db, church.id, doc.id);
    expect(after.ingestStatus).toBe('failed');
    expect(after.ingestError).toBeTruthy();
    // The returned status must match what was actually persisted.
    expect(result.status).toBe(after.ingestStatus);
  });

  it('does not falsely claim failed when the forced recovery write itself fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });

    // Corrupt the status first (this write must succeed)...
    await db.update(documents).set({ ingestStatus: 'archived' }).where(eq(documents.id, doc.id));

    // ...then make every subsequent write fail, simulating the DB going unreachable
    // right as the pipeline tries to park the document in `failed`. Nothing in the
    // reachable code path calls `db.update` before the recovery write for this
    // scenario: `beginIngestRun` throws `UnknownIngestStatusError` before it ever
    // reaches the database.
    const updateSpy = vi.spyOn(db, 'update').mockImplementation(() => {
      throw new Error('db unreachable');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runIngest(
      { db, embedder: new HashEmbedder() },
      { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' },
    );
    errSpy.mockRestore();
    updateSpy.mockRestore();

    // The DB still holds the original (corrupted) status — the caller must not be told
    // 'failed' when the database does not actually hold that state.
    const after = await getDocument(db, church.id, doc.id);
    expect(after.ingestStatus).toBe('archived');
    expect(result.status).not.toBe('failed');
    expect(result.status).toBe(after.ingestStatus);
  });

  // F2 (part b): the outer crash-recovery catch's OWN write must never fail. This
  // reproduces the exact chain from the review: a downstream failure whose error message
  // itself carries a raw NUL byte (well-formed UTF-16, but a Postgres text column refuses
  // to store it). Without sanitizing the message first, `forceIngestFailed`'s write would
  // fail for the SAME reason the original write did, leaving the document stuck at a
  // non-terminal status (`parsing`, here) forever instead of ever reaching 'failed'.
  it('sanitizes an error message that itself contains unstorable bytes, so the recovery write cannot fail the same way the original write did', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });

    const throwingEmbedder: Embedder = {
      model: 'throwing-embedder',
      embed: async () => {
        throw new Error(`embedding API unavailable ${String.fromCharCode(0)} nul byte inside`);
      },
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runIngest(
      { db, embedder: throwingEmbedder },
      { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' },
    );
    errSpy.mockRestore();

    expect(result.status).toBe('failed');
    const after = await getDocument(db, church.id, doc.id);
    expect(after.ingestStatus).toBe('failed');
    expect(after.ingestError).toContain('embedding API unavailable');
    expect(after.ingestError).not.toContain(String.fromCharCode(0));
  });

  // F3: extractEvents/verifyEvents pass whatever text they're given straight into the model
  // prompt with no truncation of their own — bounding it is runIngest's job. This proves the
  // bound is real (captured via a mock model, not just trusted from reading the code), that
  // the result signals truncation happened, and that chunking still covers the WHOLE
  // document even though the agent stages only saw the first MAX_EXTRACTION_CHARS of it.
  it('bounds the text handed to the extractor when the document exceeds MAX_EXTRACTION_CHARS, while chunking still covers the whole document', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim Longo', kind: 'bulletin' });

    const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit ';
    const paragraphs = Array.from({ length: 250 }, (_, i) => `Paragrafo ${i}: ${filler.repeat(6)}`);
    const marker = 'MARCADOR_FINAL_QUE_NAO_DEVE_CHEGAR_AO_EXTRATOR';
    paragraphs.push(marker);
    const longText = paragraphs.join('\n\n');
    expect(longText.length).toBeGreaterThan(MAX_EXTRACTION_CHARS);

    const { MockLanguageModelV3 } = await import('ai/test');
    const capturingModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        content: [{ type: 'text', text: JSON.stringify({ events: [] }) }],
        warnings: [],
      }),
    });

    const result = await runIngest(
      { db, embedder: new HashEmbedder(), extractorModel: capturingModel },
      { churchId: church.id, documentId: doc.id, bytes: new TextEncoder().encode(longText), mimeType: 'text/markdown' },
    );

    expect(result.status).toBe('published');
    expect(result.truncatedForExtraction).toBe(true);

    // The extractor never saw the tail of the document (where `marker` lives) — proof the
    // bound was actually applied to what got sent, not just computed and ignored.
    expect(capturingModel.doGenerateCalls).toHaveLength(1);
    const sentToModel = JSON.stringify(capturingModel.doGenerateCalls[0].prompt);
    expect(sentToModel.length).toBeLessThan(longText.length);
    expect(sentToModel).not.toContain(marker);

    // Chunking/embedding still ran over the WHOLE document — the last chunk (by seq) still
    // carries the marker that was cut from the extractor's view.
    const storedChunks = await db.select().from(chunks).orderBy(chunks.seq);
    expect(storedChunks.length).toBeGreaterThan(0);
    expect(storedChunks[storedChunks.length - 1].content).toContain(marker);
  });

  // C1: a swallowed extractor failure must not be indistinguishable from "this document
  // genuinely has no events" — before the fix, `extractEvents` returning `[]` on ANY
  // `generateObject` failure meant the events delete+insert ran anyway, wiping the
  // document's previously verified events and reporting success.
  it('an extraction outage leaves the document’s previously published events untouched (C1)', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });
    const input = { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' };

    const first = await runIngest(
      {
        db, embedder: new HashEmbedder(),
        extractorModel: await objectModel([ONE_CONFIRMED]),
        verifierModel: await objectModel([{ decision: 'confirmed', note: 'Confere.' }]),
      },
      input,
    );
    expect(first.status).toBe('published');
    expect(first.published).toBe(1);
    const eventsBefore = await db.select().from(events);
    expect(eventsBefore).toHaveLength(1);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const second = await runIngest(
      {
        db, embedder: new HashEmbedder(),
        extractorModel: await throwingModel('gateway 503'),
        verifierModel: await objectModel([{ decision: 'confirmed', note: 'Confere.' }]),
      },
      input,
    );
    errSpy.mockRestore();
    warnSpy.mockRestore();

    // The run still reports success — chunks re-published fine — but must be honest that
    // nothing about events was actually decided this time.
    expect(second.status).toBe('published');
    expect(second.extractionFailed).toBe(true);
    expect(second.eventsReplaced).toBe(false);
    expect(second.extracted).toBe(0);
    expect(second.published).toBe(0);
    expect(second.rejected).toBe(0);

    const eventsAfter = await db.select().from(events);
    expect(eventsAfter).toHaveLength(1);
    expect(eventsAfter[0].title).toBe(eventsBefore[0].title);
  });

  // C1's other reproduction: extraction succeeds, but verification is entirely
  // unavailable, so every candidate comes back `rejected` for an outage reason (correct,
  // fail-closed) — the bug was that this STILL replaced the previous events with an empty
  // set, destroying a previously verified event on the strength of "we couldn't check",
  // not "the document doesn't support it".
  it('a verification outage leaves previously published events untouched even though every candidate is (correctly) rejected (C1)', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });
    const input = { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' };

    const first = await runIngest(
      {
        db, embedder: new HashEmbedder(),
        extractorModel: await objectModel([ONE_CONFIRMED]),
        verifierModel: await objectModel([{ decision: 'confirmed', note: 'Confere.' }]),
      },
      input,
    );
    expect(first.published).toBe(1);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const second = await runIngest(
      {
        db, embedder: new HashEmbedder(),
        extractorModel: await objectModel([ONE_CONFIRMED]),
        verifierModel: await throwingModel('gateway down'),
      },
      input,
    );
    errSpy.mockRestore();
    warnSpy.mockRestore();

    expect(second.status).toBe('published');
    expect(second.extractionFailed).toBe(false);
    expect(second.extracted).toBe(1);
    expect(second.rejected).toBe(1); // correctly rejected — but for an outage, not a verdict
    expect(second.published).toBe(0);
    expect(second.eventsReplaced).toBe(false);

    const eventsAfter = await db.select().from(events);
    expect(eventsAfter).toHaveLength(1);
  });

  // I2: omitting `verifierModel` while `extractorModel` IS set (and finds real candidates)
  // must not fall through to `verifyEvents`'s own `deps.model ?? FAST_MODEL` default,
  // which would resolve a bare model-id string against the real, billed AI Gateway. It
  // must also, per C1, not destroy previously published events on the strength of a
  // verification stage that never ran.
  it('omitting verifierModel while candidates exist rejects them as an outage instead of making a live gateway call (I2)', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });
    const input = { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' };

    const first = await runIngest(
      {
        db, embedder: new HashEmbedder(),
        extractorModel: await objectModel([ONE_CONFIRMED]),
        verifierModel: await objectModel([{ decision: 'confirmed', note: 'Confere.' }]),
      },
      input,
    );
    expect(first.published).toBe(1);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // verifierModel deliberately omitted. If this reached a live gateway call, the test
    // would either hang, fail on missing credentials, or make a real network request —
    // none of which this asserts directly, but the point is it must never get the chance:
    // deps.verifierModel gates the call entirely (mirrors deps.extractorModel's gate).
    const second = await runIngest(
      { db, embedder: new HashEmbedder(), extractorModel: await objectModel([ONE_CONFIRMED]) },
      input,
    );
    errSpy.mockRestore();
    warnSpy.mockRestore();

    expect(second.extracted).toBe(1);
    expect(second.rejected).toBe(1);
    expect(second.published).toBe(0);
    expect(second.eventsReplaced).toBe(false);

    const eventsAfter = await db.select().from(events);
    expect(eventsAfter).toHaveLength(1); // untouched — neither wiped nor silently confirmed
  });

  // I3: an unbounded verifier fan-out means cost scales with however many candidates the
  // extractor's output claims. MAX_CANDIDATES caps how many of them ever reach the
  // verifier, regardless of how many the extractor returned.
  it('bounds candidate fan-out into the verifier at MAX_CANDIDATES, however many the extractor returns (I3)', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const doc = await createDocument(db, { churchId: church.id, title: 'Boletim', kind: 'bulletin' });

    const manyCandidates = {
      events: Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) => ({
        title: `Evento ${i}`, startsAt: '2026-10-10T22:00:00Z', location: null, description: null,
        confidence: 0.9, sourceQuote: 'Encontro de jovens OTB — 10/10 (sábado)',
      })),
    };

    const { MockLanguageModelV3 } = await import('ai/test');
    let verifyCalls = 0;
    const verifierModel = new MockLanguageModelV3({
      doGenerate: async () => {
        verifyCalls += 1;
        return {
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 50, noCache: 50, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 10, text: 10, reasoning: undefined },
          },
          content: [{ type: 'text', text: JSON.stringify({ decision: 'confirmed', note: 'Confere.' }) }],
          warnings: [],
        };
      },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runIngest(
      { db, embedder: new HashEmbedder(), extractorModel: await objectModel([manyCandidates]), verifierModel },
      { churchId: church.id, documentId: doc.id, bytes: bytes(), mimeType: 'text/markdown' },
    );
    warnSpy.mockRestore();

    expect(result.extracted).toBe(MAX_CANDIDATES + 5); // the extractor really did return that many
    expect(verifyCalls).toBe(MAX_CANDIDATES); // only MAX_CANDIDATES were ever sent to the verifier
    expect(result.published + result.rejected).toBe(MAX_CANDIDATES);
  });
});
