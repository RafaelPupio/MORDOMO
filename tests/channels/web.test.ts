import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { handleChatRequest } from '@/channels/web';
import { budgets, churches } from '@/db/schema';
import { createTestDb } from '../helpers/db';

async function setupDemo() {
  const db = await createTestDb();
  const [church] = await db.insert(churches).values({ slug: 'demo', name: 'Igreja da Colina' }).returning();
  await db.insert(budgets).values({ churchId: church.id, monthlyUsd: 40 });
  return { db, church };
}

function chatReq(body: unknown, ip = '9.9.9.9'): Request {
  return new Request('http://test/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

// Stream part shapes follow the installed AI SDK's LanguageModelV3StreamPart (verified
// against node_modules/@ai-sdk/provider/dist/index.d.ts). Two shapes differ from the
// brief's fixture in this installed version:
// 1. `finish.usage` is LanguageModelV3Usage, which nests inputTokens/outputTokens as
//    { total, ... } breakdown objects, not the flat numbers the brief used — that flat
//    shape is LanguageModelUsage, the higher-level type streamText's own onFinish hands
//    back after flattening this raw provider usage (src/agent/secretary.ts already
//    consumes the flattened form correctly, so no production code needed changing).
// 2. `finish.finishReason` is LanguageModelV3FinishReason, an object
//    { unified: 'stop' | ..., raw: string | undefined }, not a bare string literal.
async function mockModel() {
  const { MockLanguageModelV3 } = await import('ai/test');
  const { simulateReadableStream } = await import('ai');
  const chunks: import('@ai-sdk/provider').LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: 'Olá! Como posso ajudar?' },
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
  return new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks }) }),
  });
}

const userMessages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Olá!' }] }];

describe('handleChatRequest', () => {
  it('rejects a malformed body with 400', async () => {
    const { db } = await setupDemo();
    const res = await handleChatRequest({ db, embedder: new HashEmbedder(), globalCapUsd: 50 }, chatReq({ nope: true }));
    expect(res.status).toBe(400);
  });

  // A5: prove the per-visitor limit itself trips 429, independent of the budget gate.
  // The model is mocked so the within-limit requests can run their full course (rate
  // limiting is checked before the budget gate, and the budget gate is checked before
  // the model is ever invoked) without any network call.
  it('returns 429 after the per-visitor limit, and not before', async () => {
    const { db } = await setupDemo();
    const model = await mockModel();
    const deps = { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 };
    const ip = '5.5.5.5';

    const first = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId: crypto.randomUUID() }, ip));
    expect(first.status).toBe(200); // under the limit: never 429

    let last: Response | null = null;
    for (let i = 0; i < 20; i++) {
      last = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId: crypto.randomUUID() }, ip));
    }
    expect(last!.status).toBe(429); // 21st request from this visitor (1 + 20) exceeds 20/10min
  });

  it('returns 402 when the global budget is exhausted', async () => {
    const { db } = await setupDemo();
    const res = await handleChatRequest(
      { db, embedder: new HashEmbedder(), globalCapUsd: 0 },
      chatReq({ messages: userMessages, conversationId: crypto.randomUUID() }),
    );
    expect(res.status).toBe(402);
  });

  it('streams a reply and persists both sides of the exchange', async () => {
    const { db, church } = await setupDemo();
    const model = await mockModel();
    const conversationId = crypto.randomUUID();
    const res = await handleChatRequest(
      { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
      chatReq({ messages: userMessages, conversationId }),
    );
    expect(res.status).toBe(200);
    await res.text(); // drain the stream so onFinish/onEnd runs
    const { listMessages } = await import('@/db/repo/chat');
    const saved = await listMessages(db, conversationId);
    expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']);
    const { usageLedger } = await import('@/db/schema');
    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'chat.reply')).toBe(true);
    expect(saved.every((m) => m.churchId === church.id)).toBe(true);
  });

  // A3: ensureConversation alone (onConflictDoNothing) would let a visitor who guesses
  // or steals another visitor's conversationId silently append to it. Verify ownership
  // is actually enforced: a second visitor (different x-forwarded-for) reusing the
  // first visitor's conversationId must be rejected, and must not be able to append.
  it('rejects a different visitor reusing another visitor\'s conversationId with 403, and blocks the append', async () => {
    const { db } = await setupDemo();
    const model = await mockModel();
    const deps = { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 };
    const conversationId = crypto.randomUUID();

    const first = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId }, '1.1.1.1'));
    expect(first.status).toBe(200);
    await first.text(); // drain so the first visitor's messages are persisted

    const { listMessages } = await import('@/db/repo/chat');
    const before = await listMessages(db, conversationId);
    expect(before.length).toBeGreaterThan(0);

    const second = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId }, '2.2.2.2'));
    expect(second.status).toBe(403);
    const body = await second.json();
    expect(body.code).toBe('conversation_forbidden');

    const after = await listMessages(db, conversationId);
    expect(after).toHaveLength(before.length); // nothing was appended by the intruder
  });
});
