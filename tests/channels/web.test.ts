import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { handleChatRequest } from '@/channels/web';
import { budgets, churches, conversations, messages, usageLedger } from '@/db/schema';
import { createTestDb } from '../helpers/db';

const VISITOR_COOKIE = 'ccb_visitor';

async function setupDemo() {
  const db = await createTestDb();
  const [church] = await db.insert(churches).values({ slug: 'demo', name: 'Igreja da Colina' }).returning();
  await db.insert(budgets).values({ churchId: church.id, monthlyUsd: 40 });
  return { db, church };
}

// `ip: null` omits x-forwarded-for entirely, simulating a caller behind no proxy header at
// all (F2). `cookie` sets the `ccb_visitor` cookie the way a returning browser would.
function chatReq(body: unknown, opts: { ip?: string | null; cookie?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const ip = opts.ip === undefined ? '9.9.9.9' : opts.ip;
  if (ip !== null) headers['x-forwarded-for'] = ip;
  if (opts.cookie) headers.cookie = `${VISITOR_COOKIE}=${opts.cookie}`;
  return new Request('http://test/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function visitorCookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('expected a Set-Cookie header for a first-time visitor');
  const match = new RegExp(`${VISITOR_COOKIE}=([^;]+)`).exec(setCookie);
  if (!match) throw new Error(`Set-Cookie did not include ${VISITOR_COOKIE}`);
  return match[1];
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

    const first = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId: crypto.randomUUID() }, { ip }));
    expect(first.status).toBe(200); // under the limit: never 429

    let last: Response | null = null;
    for (let i = 0; i < 20; i++) {
      last = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId: crypto.randomUUID() }, { ip }));
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
    const ledger = await db.select().from(usageLedger);
    const replyRow = ledger.find((u) => u.feature === 'chat.reply');
    expect(replyRow).toBeDefined();
    // A row existing isn't enough — assert it carries the actual metered numbers, not
    // zeros that a future SDK usage-shape change could silently coerce in.
    expect(replyRow!.inputTokens).toBeGreaterThan(0);
    expect(replyRow!.outputTokens).toBeGreaterThan(0);
    expect(replyRow!.costUsd).toBeGreaterThan(0);
    expect(saved.every((m) => m.churchId === church.id)).toBe(true);
  });

  describe('F1: conversation ownership rests on the server-set visitor cookie', () => {
    it('sets a Set-Cookie for ccb_visitor on a first-time request, even one that gets rejected', async () => {
      const { db } = await setupDemo();
      const res = await handleChatRequest({ db, embedder: new HashEmbedder(), globalCapUsd: 50 }, chatReq({ nope: true }));
      expect(res.status).toBe(400);
      expect(res.headers.get('set-cookie')).toContain(`${VISITOR_COOKIE}=`);
    });

    // Replaces the old A3 test: the attack is now expressed as a different visitor
    // *cookie* (the actual ownership token), not a different IP.
    it("rejects a different visitor cookie reusing another visitor's conversationId with 403, and blocks the append", async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const deps = { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 };
      const conversationId = crypto.randomUUID();

      const first = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId }));
      expect(first.status).toBe(200);
      await first.text(); // drain so the first visitor's messages are persisted

      const { listMessages } = await import('@/db/repo/chat');
      const before = await listMessages(db, conversationId);
      expect(before.length).toBeGreaterThan(0);

      const second = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId }, { cookie: crypto.randomUUID() }));
      expect(second.status).toBe(403);
      const body = await second.json();
      expect(body.code).toBe('conversation_forbidden');

      const after = await listMessages(db, conversationId);
      expect(after).toHaveLength(before.length); // nothing was appended by the intruder
    });

    // The core F1 reproduction: an attacker who only controls x-forwarded-for (not a
    // cookie) must not gain access to the victim's conversation.
    it("does not grant access to another visitor's conversation by spoofing x-forwarded-for alone", async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const deps = { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 };
      const conversationId = crypto.randomUUID();
      const victimIp = '10.0.0.1';

      const first = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId }, { ip: victimIp }));
      expect(first.status).toBe(200);
      await first.text();

      const { listMessages } = await import('@/db/repo/chat');
      const before = await listMessages(db, conversationId);

      // Same x-forwarded-for as the victim, but no matching visitor cookie.
      const attack = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId }, { ip: victimIp }));
      expect(attack.status).toBe(403);

      const after = await listMessages(db, conversationId);
      expect(after).toHaveLength(before.length);
    });
  });

  describe('F2: header-less callers never collapse into one shared identity', () => {
    it('gives two cookie-less, header-less callers different identities', async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const deps = { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 };
      const conversationId = crypto.randomUUID();

      const first = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId }, { ip: null }));
      expect(first.status).toBe(200);
      await first.text();
      const cookieA = visitorCookieFrom(first);

      const { listMessages } = await import('@/db/repo/chat');
      const before = await listMessages(db, conversationId);
      expect(before.length).toBeGreaterThan(0);

      const second = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId }, { ip: null }));
      expect(second.status).toBe(403); // a second header-less caller must not inherit the first's conversation
      const cookieB = visitorCookieFrom(second);
      expect(cookieB).not.toBe(cookieA);

      const after = await listMessages(db, conversationId);
      expect(after).toHaveLength(before.length);
    });
  });

  describe('F3: malformed bodies are rejected before any side effect', () => {
    const cases: Array<[string, unknown]> = [
      ['message missing role and parts', {}],
      ['message missing parts', { role: 'user' }],
      ['parts is not an array', { role: 'user', parts: 'not-an-array' }],
    ];

    it.each(cases)('%s -> 400, persists nothing', async (_label, message) => {
      const { db } = await setupDemo();
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: [message], conversationId: crypto.randomUUID() }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('bad_request');
      const rows = await db.select().from(messages);
      expect(rows).toHaveLength(0);
    });
  });

  describe('F4: client-supplied history is capped', () => {
    it('rejects a history with more than the max message count', async () => {
      const { db } = await setupDemo();
      const tooMany = Array.from({ length: 51 }, (_, i) => ({
        id: `m${i}`,
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
      }));
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: tooMany, conversationId: crypto.randomUUID() }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects a history over the total character budget', async () => {
      const { db } = await setupDemo();
      const huge = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(24_001) }] }];
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: huge, conversationId: crypto.randomUUID() }),
      );
      expect(res.status).toBe(400);
    });
  });

  // F4/F5 (round 2): a reviewer found the original `totalMessageChars` only summed `text`
  // fields, so a non-text part payload — a tool-output part, a `file` part's `data:` URL,
  // or a stray passthrough field — bypassed the cap by roughly 400x while still reaching
  // the model and being persisted into `messages.parts`. F5 covers a separate defect: NUL
  // and lone-surrogate characters passed shape validation but crashed the Postgres jsonb
  // write with a 500 after a `conversations` row had already been inserted.
  describe('F4/F5 (round 2): serialized-size cap and malformed-UTF-8 rejection', () => {
    it('rejects a single message whose non-text tool-output payload is huge, persisting nothing', async () => {
      const { db } = await setupDemo();
      const conversationId = crypto.randomUUID();
      const bypass = [
        {
          id: 'a',
          role: 'assistant',
          parts: [
            {
              type: 'tool-searchKnowledge',
              toolCallId: 'c1',
              state: 'output-available',
              input: { query: 'oi' },
              output: { sources: [{ excerpt: 'A'.repeat(2_000_000) }] },
            },
          ],
        },
      ];
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: bypass, conversationId }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('bad_request');
      expect(await db.select().from(conversations)).toHaveLength(0);
      expect(await db.select().from(messages)).toHaveLength(0);
    });

    it('rejects many individually-small messages whose serialized total exceeds the cap', async () => {
      const { db } = await setupDemo();
      const conversationId = crypto.randomUUID();
      // 40 messages, each carrying a modest ~780-byte tool-output part (well under any
      // per-message threshold), summing to well over MAX_TOTAL_CHARS (24,000).
      const manySmall = Array.from({ length: 40 }, (_, i) => ({
        id: `m${i}`,
        role: 'assistant',
        parts: [
          {
            type: 'tool-searchKnowledge',
            toolCallId: `c${i}`,
            state: 'output-available',
            output: { sources: [{ excerpt: 'z'.repeat(700) }] },
          },
        ],
      }));
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: manySmall, conversationId }),
      );
      expect(res.status).toBe(400);
      expect(await db.select().from(conversations)).toHaveLength(0);
      expect(await db.select().from(messages)).toHaveLength(0);
    });

    it('rejects a file part with a large data: URL, persisting nothing', async () => {
      const { db } = await setupDemo();
      const conversationId = crypto.randomUUID();
      const dataUrl = `data:image/png;base64,${'A'.repeat(2_000_000)}`;
      const withHugeFile = [
        { id: 'f1', role: 'user', parts: [{ type: 'file', mediaType: 'image/png', data: dataUrl }] },
      ];
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: withHugeFile, conversationId }),
      );
      expect(res.status).toBe(400);
      expect(await db.select().from(conversations)).toHaveLength(0);
      expect(await db.select().from(messages)).toHaveLength(0);
    });

    it('still returns 200 for a normal, realistic multi-turn conversation well under the cap', async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const conversationId = crypto.randomUUID();
      // A realistic exchange, including one assistant message carrying a genuine small
      // tool-output part alongside its reply text — the shape the cap must not punish.
      const realistic = [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Oi, vocês têm culto de jovens?' }] },
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-searchKnowledge',
              toolCallId: 'c1',
              state: 'output-available',
              input: { query: 'culto de jovens' },
              output: { sources: [{ excerpt: 'O culto de jovens acontece aos sábados às 19h.' }] },
            },
            { type: 'text', text: 'Sim! O culto de jovens acontece aos sábados às 19h.' },
          ],
        },
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Perfeito, obrigado!' }] },
      ];
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
        chatReq({ messages: realistic, conversationId }),
      );
      expect(res.status).toBe(200);
      await res.text(); // drain so onEnd persistence runs
      const saved = await db.select().from(messages);
      expect(saved.length).toBeGreaterThan(0);
    });

    it('rejects text containing a NUL character, persisting nothing', async () => {
      const { db } = await setupDemo();
      const conversationId = crypto.randomUUID();
      const withNul = [
        { id: 'n1', role: 'user', parts: [{ type: 'text', text: `a${String.fromCharCode(0)}b` }] },
      ];
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: withNul, conversationId }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('bad_request');
      expect(await db.select().from(conversations)).toHaveLength(0);
      expect(await db.select().from(messages)).toHaveLength(0);
    });

    it('rejects text containing a lone UTF-16 surrogate, persisting nothing', async () => {
      const { db } = await setupDemo();
      const conversationId = crypto.randomUUID();
      const withLoneSurrogate = [
        { id: 'l1', role: 'user', parts: [{ type: 'text', text: `a${String.fromCharCode(0xd800)}b` }] },
      ];
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: withLoneSurrogate, conversationId }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('bad_request');
      expect(await db.select().from(conversations)).toHaveLength(0);
      expect(await db.select().from(messages)).toHaveLength(0);
    });
  });
});
