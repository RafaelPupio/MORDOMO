import { describe, expect, it, vi } from 'vitest';
import type { Embedder } from '@/ai/embedder';
import { HashEmbedder } from '@/ai/embedder';
import { priceableModelId, runSecretary, secretaryTools } from '@/agent/secretary';
import { CHAT_MODEL, FAST_MODEL } from '@/ai/pricing';
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

  // recordUsage must not be able to destroy a successful search. costUsd() throws for a
  // model with no configured price, so an embedder reporting an unpriced model id
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

  it('getCalendar lists upcoming, verified events', async () => {
    const { db, church, tools } = await setup();
    await db.insert(events).values({
      churchId: church.id, title: 'Retiro', startsAt: new Date(Date.now() + 86_400_000), verified: true,
    });
    // An unverified event (the schema default) must never show up here — events.verified
    // is the verifier's whole guarantee; see tests/db/repos.test.ts for the dedicated test.
    await db.insert(events).values({
      churchId: church.id, title: 'Nao verificado', startsAt: new Date(Date.now() + 86_400_000),
    });
    const out = (await tools.getCalendar.execute!({}, {} as never)) as ToolOutput<typeof tools.getCalendar.execute>;
    expect(out.events.map((e: { title: string }) => e.title)).toContain('Retiro');
    expect(out.events.map((e: { title: string }) => e.title)).not.toContain('Nao verificado');
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

// `deps.model` may be a plain model-id string or a LanguageModel OBJECT (as every other
// test in this file passes via MockLanguageModelV3); an object carries no id to price by.
describe('priceableModelId', () => {
  it('prices under the actual model id when it is a plain string override', () => {
    expect(priceableModelId(FAST_MODEL)).toBe(FAST_MODEL);
    expect(priceableModelId(CHAT_MODEL)).toBe(CHAT_MODEL);
  });

  it('falls back to CHAT_MODEL when given a model object with no id to price by', async () => {
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3();
    expect(priceableModelId(model)).toBe(CHAT_MODEL);
  });
});

describe('runSecretary', () => {
  // Same fixture shape as tests/channels/web.test.ts's mockModel(): a minimal successful
  // stream, so onFinish's usage-recording path actually runs.
  async function mockModel() {
    const { MockLanguageModelV3 } = await import('ai/test');
    const { simulateReadableStream } = await import('ai');
    const streamChunks: import('@ai-sdk/provider').LanguageModelV3StreamPart[] = [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Olá!' },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 8, text: 8, reasoning: undefined },
        },
      },
    ];
    return new MockLanguageModelV3({ doStream: async () => ({ stream: simulateReadableStream({ chunks: streamChunks }) }) });
  }

  // Mirrors the searchKnowledge ledger-write-guard test above, but for the OTHER recordUsage
  // call in this file — the one runSecretary's onFinish makes for 'chat.reply', which must
  // not throw or go unlogged either. "Poisoning the insert" here means a churchId that
  // doesn't exist in `churches`, so usage_ledger's church_id foreign key fails on write — a
  // failure independent of model pricing, unlike the searchKnowledge test's approach.
  it('logs, rather than throws, when recording chat.reply usage fails — the failure is never silent', async () => {
    const db = await createTestDb();
    const model = await mockModel();
    const conversationId = crypto.randomUUID();
    const missingChurchId = crypto.randomUUID();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await runSecretary(
        { db, embedder: new HashEmbedder(), model },
        {
          churchId: missingChurchId,
          churchName: 'Igreja Inexistente',
          conversationId,
          visitorKey: 'test',
          uiMessages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Oi' }] }] as never,
        },
      );
      const res = result.toUIMessageStreamResponse();
      await res.text(); // drain so onFinish actually runs

      expect(errorSpy).toHaveBeenCalledWith(
        'runSecretary: failed to record usage ledger entry',
        expect.objectContaining({ churchId: missingChurchId, conversationId, model: CHAT_MODEL }),
      );
      const ledger = await db.select().from(usageLedger);
      expect(ledger.some((u) => u.feature === 'chat.reply')).toBe(false); // the record never landed
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('still records chat.reply usage normally when nothing is poisoned (regression guard)', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const model = await mockModel();
    const result = await runSecretary(
      { db, embedder: new HashEmbedder(), model },
      {
        churchId: church.id,
        churchName: church.name,
        conversationId: crypto.randomUUID(),
        visitorKey: 'test',
        uiMessages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Oi' }] }] as never,
      },
    );
    const res = result.toUIMessageStreamResponse();
    await res.text();

    const ledger = await db.select().from(usageLedger);
    const replyRow = ledger.find((u) => u.feature === 'chat.reply');
    expect(replyRow).toBeDefined();
    expect(replyRow!.model).toBe(CHAT_MODEL);
  });
});
