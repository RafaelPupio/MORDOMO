import { describe, expect, it, vi } from 'vitest';
import type { Embedder } from '@/ai/embedder';
import { HashEmbedder } from '@/ai/embedder';
import { secretaryTools } from '@/agent/secretary';
import { chunkMarkdown } from '@/core/chunking';
import { listPrayerRequests } from '@/db/repo/prayer';
import { listTickets } from '@/db/repo/tickets';
import { chunks, documents, events, usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

// The installed `ai` version types a tool's `execute` return as
// `AsyncIterable<OUTPUT> | PromiseLike<OUTPUT> | OUTPUT` (streaming tool results are
// supported in general), so `await execute(...)` types as `OUTPUT | AsyncIterable<OUTPUT>`.
// None of these tools ever return an async iterable; narrow the awaited result back to
// OUTPUT for the assertions below instead of weakening the production tool types.
type ToolOutput<T> = T extends (...args: never[]) => infer R ? Exclude<Awaited<R>, AsyncIterable<unknown>> : never;

async function setup() {
  const db = await createTestDb();
  const church = await seedChurch(db, 'Igreja da Colina');
  const conversationId = crypto.randomUUID();
  const { ensureConversation } = await import('@/db/repo/chat');
  await ensureConversation(db, { id: conversationId, churchId: church.id, visitorKey: 'test' });
  const tools = secretaryTools(
    { db, embedder: new HashEmbedder() },
    { churchId: church.id, conversationId },
  );
  return { db, church, conversationId, tools };
}

describe('secretaryTools', () => {
  it('searchKnowledge returns sources and meters the embedding call', async () => {
    const { db, church, tools } = await setup();
    const embedder = new HashEmbedder();
    const [doc] = await db.insert(documents).values({ churchId: church.id, title: 'Horários', kind: 'schedule' }).returning();
    const pieces = chunkMarkdown('## Culto\n\nCulto de domingo às 10h.');
    const { embeddings } = await embedder.embed(pieces.map((p) => p.content));
    await db.insert(chunks).values(pieces.map((p, i) => ({ churchId: church.id, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i] })));

    const out = (await tools.searchKnowledge.execute!({ query: 'culto de domingo' }, {} as never)) as ToolOutput<
      typeof tools.searchKnowledge.execute
    >;
    expect(out.sources[0].documentTitle).toBe('Horários');
    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'chat.retrieval')).toBe(true);
  });

  // A4: recordUsage must not be able to destroy a successful search. costUsd() throws
  // for a model with no configured price, so an embedder reporting an unpriced model id
  // (while still producing valid vectors, via the real HashEmbedder underneath) forces
  // the ledger write to fail without touching retrieval itself.
  it('still returns sources when metering the retrieval fails', async () => {
    const { db, church } = await setup();
    const [doc] = await db.insert(documents).values({ churchId: church.id, title: 'Horários', kind: 'schedule' }).returning();
    const realEmbedder = new HashEmbedder();
    const pieces = chunkMarkdown('## Culto\n\nCulto de domingo às 10h.');
    const { embeddings } = await realEmbedder.embed(pieces.map((p) => p.content));
    await db.insert(chunks).values(pieces.map((p, i) => ({ churchId: church.id, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i] })));

    class UnpricedEmbedder implements Embedder {
      readonly model = 'test/unpriced-embedder'; // deliberately absent from src/ai/pricing.ts
      embed(texts: string[]) {
        return realEmbedder.embed(texts); // real vectors, so retrieval still matches
      }
    }
    const tools = secretaryTools({ db, embedder: new UnpricedEmbedder() }, { churchId: church.id, conversationId: crypto.randomUUID() });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = (await tools.searchKnowledge.execute!({ query: 'culto de domingo' }, {} as never)) as ToolOutput<
        typeof tools.searchKnowledge.execute
      >;
      expect(out.sources[0].documentTitle).toBe('Horários');
      expect(errorSpy).toHaveBeenCalled(); // the failure was logged, not silently swallowed
    } finally {
      errorSpy.mockRestore();
    }
  });

  // Companion to the A4 test above: A4 proves a failure *recording usage* is swallowed.
  // This proves a failure in the search itself is NOT swallowed — searchKnowledgeBase is
  // called outside the try/catch in secretary.ts, so a broken embedder must still fail the
  // tool call instead of silently returning as if nothing was found.
  it('propagates a failure from searchKnowledgeBase itself, not just from recording usage', async () => {
    const { db, church } = await setup();
    class ThrowingEmbedder implements Embedder {
      readonly model = 'test/throwing-embedder';
      embed(): Promise<{ embeddings: number[][]; tokens: number }> {
        return Promise.reject(new Error('embedder unavailable'));
      }
    }
    const tools = secretaryTools({ db, embedder: new ThrowingEmbedder() }, { churchId: church.id, conversationId: crypto.randomUUID() });
    await expect(tools.searchKnowledge.execute!({ query: 'culto de domingo' }, {} as never)).rejects.toThrow('embedder unavailable');
  });

  it('getCalendar lists upcoming events', async () => {
    const { db, church, tools } = await setup();
    await db.insert(events).values({ churchId: church.id, title: 'Retiro', startsAt: new Date(Date.now() + 86_400_000) });
    const out = (await tools.getCalendar.execute!({}, {} as never)) as ToolOutput<typeof tools.getCalendar.execute>;
    expect(out.events.map((e: { title: string }) => e.title)).toContain('Retiro');
  });

  it('createPrayerRequest persists with the conversation id', async () => {
    const { db, church, conversationId, tools } = await setup();
    const out = (await tools.createPrayerRequest.execute!({ request: 'Pela minha avó', name: 'Ana' }, {} as never)) as ToolOutput<
      typeof tools.createPrayerRequest.execute
    >;
    expect(out.saved).toBe(true);
    const list = await listPrayerRequests(db, church.id);
    expect(list[0].conversationId).toBe(conversationId);
  });

  it('escalateToHuman opens a ticket', async () => {
    const { db, church, tools } = await setup();
    const out = (await tools.escalateToHuman.execute!({ topic: 'Agendar aconselhamento' }, {} as never)) as ToolOutput<
      typeof tools.escalateToHuman.execute
    >;
    expect(out.ticketId).toBeDefined();
    expect((await listTickets(db, church.id))[0].topic).toBe('Agendar aconselhamento');
  });
});
