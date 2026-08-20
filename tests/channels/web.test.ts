import { describe, expect, it, vi } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { CHAT_LIMIT, HISTORY_ABUSE_MAX_CHARS, MAX_MESSAGES, MODEL_HISTORY_CHARS, handleChatRequest } from '@/channels/web';
import { budgets, churches, conversations, messages, rateLimits, usageLedger } from '@/db/schema';
import { createTestDb } from '../helpers/db';

const VISITOR_COOKIE = 'ccb_visitor';

async function setupDemo() {
  const db = await createTestDb();
  const [church] = await db.insert(churches).values({ slug: 'demo', name: 'Igreja da Colina' }).returning();
  await db.insert(budgets).values({ churchId: church.id, monthlyUsd: 40 });
  return { db, church };
}

// `ip: null` omits x-forwarded-for entirely, simulating a caller behind no proxy header at
// all. `cookie` sets the `ccb_visitor` cookie the way a returning browser would.
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

// Same fixture as mockModel(), but also records the `prompt` (the model-messages array
// produced from `uiMessages` by convertToModelMessages) on every doStream call, so a test
// can inspect exactly what history the server actually handed to the model — the thing
// server-side trimming is supposed to shrink.
async function mockModelCapturingPrompts() {
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
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt);
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  return { model, prompts };
}

// Simulates a model/gateway failure mid-call — the AI SDK catches a thrown doStream and
// turns it into an 'error' part inside the UI message stream rather than a non-2xx HTTP
// response, so no text/tool-output chunks are ever produced and the accumulated
// responseMessage.parts handed to onEnd stays empty.
async function mockFailingModel() {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({
    doStream: async () => {
      throw new Error('simulated model/gateway failure');
    },
  });
}

const userMessages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Olá!' }] }];

// Builds one realistic "grounded" turn: a short user question and an assistant reply that
// cites five knowledge-base sources (the shape the regression is about — a real grounded
// reply is not just a few words of text, it's a tool-output part carrying source excerpts).
// Each part's text carries a MARK_* token unique to its turn number and role, so a test can
// tell, just by substring search on the serialized prompt, which turns survived trimming.
// Sized (repeat count tuned against this exact fixture) to land close to the ~3,100
// characters/turn a real grounded reply measures against the live handler.
const GROUNDED_EXCERPT_SENTENCE = 'Este e um trecho de exemplo extraido da base de conhecimento da igreja. ';

function groundedTurnMessages(turn: number) {
  const userMsg = {
    id: `u${turn}`,
    role: 'user',
    parts: [{ type: 'text', text: `MARK_USER_${turn} pergunta sobre o culto numero ${turn}` }],
  };
  const sources = Array.from({ length: 5 }, (_, i) => ({
    title: `Fonte ${turn}-${i}`,
    excerpt: `MARK_SOURCE_${turn}_${i} ${GROUNDED_EXCERPT_SENTENCE.repeat(8)}`,
  }));
  const assistantMsg = {
    id: `a${turn}`,
    role: 'assistant',
    parts: [
      {
        type: 'tool-searchKnowledge',
        toolCallId: `c${turn}`,
        state: 'output-available',
        input: { query: `pergunta ${turn}` },
        output: { sources },
      },
      { type: 'text', text: `MARK_ASSISTANT_${turn} resposta grounded citando as fontes acima para o turno ${turn}.` },
    ],
  };
  return { userMsg, assistantMsg };
}

// Builds the full client-supplied history for a conversation that has just reached
// `turnCount` turns: every prior turn's user question AND grounded assistant reply, plus
// the newest turn's user question only (its reply hasn't happened yet — this is what the
// client sends to ask for it), matching how a real chat client resends the whole growing
// history on every request.
function buildGroundedHistory(turnCount: number) {
  const msgs: unknown[] = [];
  for (let turn = 1; turn <= turnCount; turn++) {
    const { userMsg, assistantMsg } = groundedTurnMessages(turn);
    msgs.push(userMsg);
    if (turn < turnCount) msgs.push(assistantMsg);
  }
  return msgs;
}

describe('handleChatRequest', () => {
  it('rejects a malformed body with 400', async () => {
    const { db } = await setupDemo();
    const res = await handleChatRequest({ db, embedder: new HashEmbedder(), globalCapUsd: 50 }, chatReq({ nope: true }));
    expect(res.status).toBe(400);
  });

  // Prove the per-visitor limit itself trips 429, independent of the budget gate.
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
    expect(last!.status).toBe(429); // 21st request from this visitor (1 + 20) exceeds 20/hour (I4)
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

  describe('conversation ownership rests on the server-set visitor cookie', () => {
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

  describe('header-less callers never collapse into one shared identity', () => {
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

  describe('malformed bodies are rejected before any side effect', () => {
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

  describe('client-supplied history is capped', () => {
    it('rejects a history with more than the max message count', async () => {
      const { db } = await setupDemo();
      const tooMany = Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => ({
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

    // A single message well under HISTORY_ABUSE_MAX_CHARS (256,000) but over
    // MODEL_HISTORY_CHARS (24,000) must not reach the model whole, unstrimmed, just because
    // trimHistoryForModel never drops the newest message no matter its size. A public
    // endpoint whose cost protection is a pre-request budget check must never let a single
    // request hand the model more than the model-history budget. A legitimate chat turn is a
    // message, not a document, so this is a 400 instead of a silent pass-through — see the
    // "a single message over MODEL_HISTORY_CHARS" group below for the full boundary coverage
    // this test is a proxy for.
    it('rejects a single huge newest user message that alone exceeds MODEL_HISTORY_CHARS, persisting nothing', async () => {
      const { db } = await setupDemo();
      const bigText = `MARK_ONLY ${'x'.repeat(100_000)}`;
      const huge = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: bigText }] }];
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: huge, conversationId: crypto.randomUUID() }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('bad_request');
      expect(await db.select().from(conversations)).toHaveLength(0);
      expect(await db.select().from(messages)).toHaveLength(0);
    });
  });

  // A cap that only summed `part.text` fields would miss a non-text part payload — a
  // tool-output part, a `file` part's `data:` URL, or a stray passthrough field — bypassing
  // the cap by roughly 400x while it still reached the model and got persisted into
  // `messages.parts`. Separately, NUL and lone-surrogate characters pass shape validation
  // but would crash the Postgres jsonb write with a 500 after a `conversations` row had
  // already been inserted.
  describe('serialized-size cap and malformed-UTF-8 rejection', () => {
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

    // 40 small messages summing to ~33,000 characters is well over MODEL_HISTORY_CHARS
    // (24,000) but nowhere near abusive — comfortably under HISTORY_ABUSE_MAX_CHARS
    // (256,000). Rejecting an honest, merely long history would be wrong: it gets trimmed
    // for the model instead (see the dedicated "history over MODEL_HISTORY_CHARS is
    // trimmed" tests below) and the request completes normally.
    it('still returns 200 for many individually-small messages whose serialized total exceeds MODEL_HISTORY_CHARS but not the abuse bound', async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const conversationId = crypto.randomUUID();
      // 40 small tool-output messages (~830 bytes each, ~33,000 total: over
      // MODEL_HISTORY_CHARS but far under HISTORY_ABUSE_MAX_CHARS), plus the newest user
      // turn a real client would append before asking for the next reply.
      const manySmall: unknown[] = Array.from({ length: 40 }, (_, i) => ({
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
      manySmall.push({ id: 'newest', role: 'user', parts: [{ type: 'text', text: 'E o horário de domingo?' }] });
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
        chatReq({ messages: manySmall, conversationId }),
      );
      expect(res.status).toBe(200);
      await res.text();
      expect(await db.select().from(conversations)).toHaveLength(1);
      const { listMessages } = await import('@/db/repo/chat');
      const saved = await listMessages(db, conversationId);
      expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']); // newest user turn + the reply, persisted as always
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

  // A normal, non-abusive conversation where the secretary cites sources costs ~3,100
  // serialized characters per grounded turn. A single bound that rejects once history
  // crosses 24,000 characters (around turn 9) would 400 every subsequent turn permanently,
  // because the client keeps resending the whole growing history. So the bound is split in
  // two: HISTORY_ABUSE_MAX_CHARS (256,000) hard-rejects genuinely abusive requests before
  // any DB write; MODEL_HISTORY_CHARS (24,000) silently trims what's sent to the model
  // instead of rejecting the request.
  describe('history over MODEL_HISTORY_CHARS is trimmed, not rejected', () => {
    it('still returns 200 turn after turn, past the point that used to 400 (the regression)', async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const deps = { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 };
      const conversationId = crypto.randomUUID();

      let cookie: string | undefined;
      let history: unknown[] = [];
      const statusByTurn = new Map<number, number>();
      for (let turn = 1; turn <= 12; turn++) {
        const { userMsg, assistantMsg } = groundedTurnMessages(turn);
        history = [...history, userMsg];
        const res = await handleChatRequest(deps, chatReq({ messages: history, conversationId }, cookie ? { cookie } : {}));
        if (!cookie) cookie = visitorCookieFrom(res);
        statusByTurn.set(turn, res.status);
        await res.text(); // drain so onEnd persistence completes before the next turn
        history = [...history, assistantMsg];
      }

      // Turn 9's history alone is already ~28,000 characters (over MODEL_HISTORY_CHARS) —
      // exactly the point where a single hard-reject bound would break permanently. Turn 12
      // proves it isn't a one-time fluke: the conversation keeps working as it keeps growing.
      expect(statusByTurn.get(9)).toBe(200);
      expect(statusByTurn.get(12)).toBe(200);
      // Every turn, not just 9 and 12 — the fix isn't turn-specific.
      expect([...statusByTurn.values()]).toEqual(Array(12).fill(200));
    });

    it('keeps the newest user message and drops the oldest ones from what the model receives', async () => {
      const { db } = await setupDemo();
      const { model, prompts } = await mockModelCapturingPrompts();
      const turnCount = 20;
      const history = buildGroundedHistory(turnCount); // ~67,000 chars: over MODEL_HISTORY_CHARS, under the abuse bound
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
        chatReq({ messages: history, conversationId: crypto.randomUUID() }),
      );
      expect(res.status).toBe(200);
      await res.text();

      const promptJson = JSON.stringify(prompts[0]);
      expect(promptJson).toContain(`MARK_USER_${turnCount}`); // newest message: always present
      expect(promptJson).not.toContain('MARK_USER_1 '); // oldest turn: dropped by trimming
      expect(promptJson).not.toContain('MARK_ASSISTANT_1 ');
    });

    it('keeps a contiguous suffix when trimming — no turns dropped from the middle', async () => {
      const { db } = await setupDemo();
      const { model, prompts } = await mockModelCapturingPrompts();
      const turnCount = 20;
      const history = buildGroundedHistory(turnCount);
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
        chatReq({ messages: history, conversationId: crypto.randomUUID() }),
      );
      expect(res.status).toBe(200);
      await res.text();

      const promptJson = JSON.stringify(prompts[0]);
      const presentTurns: number[] = [];
      for (let turn = 1; turn <= turnCount; turn++) {
        const present = promptJson.includes(`MARK_USER_${turn} `) || promptJson.includes(`MARK_ASSISTANT_${turn} `);
        if (present) presentTurns.push(turn);
      }

      expect(presentTurns.length).toBeGreaterThan(0);
      expect(presentTurns.length).toBeLessThan(turnCount); // trimming actually happened
      expect(presentTurns[presentTurns.length - 1]).toBe(turnCount); // ends at the newest turn
      // A contiguous suffix means the kept turns are exactly the last N — no gaps, nothing
      // missing from the middle of that range.
      const expectedSuffix = Array.from({ length: presentTurns.length }, (_, i) => turnCount - presentTurns.length + 1 + i);
      expect(presentTurns).toEqual(expectedSuffix);
    });

    it('still returns 400 for a body over the hard abuse bound, persisting nothing', async () => {
      const { db } = await setupDemo();
      const conversationId = crypto.randomUUID();
      // Comfortably over HISTORY_ABUSE_MAX_CHARS (256,000) but far below the 2MB payloads
      // used elsewhere in this file — proves the exact new boundary is enforced, not just
      // that wildly oversized bodies happen to get caught too.
      const abusive = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(HISTORY_ABUSE_MAX_CHARS + 4_000) }] }];
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: abusive, conversationId }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('bad_request');
      expect(await db.select().from(conversations)).toHaveLength(0);
      expect(await db.select().from(messages)).toHaveLength(0);
    });

    it('MODEL_HISTORY_CHARS stays well under HISTORY_ABUSE_MAX_CHARS (the two bounds do not contradict each other)', () => {
      expect(MODEL_HISTORY_CHARS).toBeLessThan(HISTORY_ABUSE_MAX_CHARS);
    });
  });

  // trimHistoryForModel always keeps the newest message whole (correct — the user's current
  // turn must never be trimmed away), but that alone would let a single oversized newest
  // message bypass MODEL_HISTORY_CHARS entirely and reach the model at up to
  // HISTORY_ABUSE_MAX_CHARS. This group proves the guarding rule: a single message over
  // MODEL_HISTORY_CHARS is a 400, the boundary itself is exact (not off-by-one in the
  // rejecting direction), and trimming (not rejecting) still holds when the TOTAL is large
  // but every individual message is small.
  describe('a single message over MODEL_HISTORY_CHARS is rejected, not silently sent to the model', () => {
    // Builds a message whose JSON.stringify(...).length is exactly `targetChars`, so the
    // boundary tests below can target MODEL_HISTORY_CHARS +/- 1 precisely instead of an
    // approximate fixture size. Padding with plain ASCII 'x' characters adds exactly
    // `padLen` to the serialized length — no JSON escaping changes the count.
    function messageOfSerializedSize(id: string, role: 'user' | 'assistant', targetChars: number) {
      const base = { id, role, parts: [{ type: 'text', text: '' }] };
      const baseLen = JSON.stringify(base).length;
      const padLen = targetChars - baseLen;
      if (padLen < 0) {
        throw new Error(`targetChars ${targetChars} is smaller than the empty-message overhead ${baseLen}`);
      }
      return { id, role, parts: [{ type: 'text', text: 'x'.repeat(padLen) }] };
    }

    it('rejects a single message just over MODEL_HISTORY_CHARS with 400, persisting nothing', async () => {
      const { db } = await setupDemo();
      const conversationId = crypto.randomUUID();
      const oversized = [messageOfSerializedSize('m1', 'user', MODEL_HISTORY_CHARS + 1)];
      expect(JSON.stringify(oversized[0]).length).toBe(MODEL_HISTORY_CHARS + 1); // fixture sanity check
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), globalCapUsd: 50 },
        chatReq({ messages: oversized, conversationId }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('bad_request');
      expect(await db.select().from(conversations)).toHaveLength(0);
      expect(await db.select().from(messages)).toHaveLength(0);
    });

    it('accepts a single message exactly at MODEL_HISTORY_CHARS with 200 (boundary is not off-by-one in the rejecting direction)', async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const conversationId = crypto.randomUUID();
      const atBoundary = [messageOfSerializedSize('m1', 'user', MODEL_HISTORY_CHARS)];
      expect(JSON.stringify(atBoundary[0]).length).toBe(MODEL_HISTORY_CHARS); // fixture sanity check
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
        chatReq({ messages: atBoundary, conversationId }),
      );
      expect(res.status).toBe(200);
      await res.text();
      expect(await db.select().from(messages)).not.toHaveLength(0);
    });

    // Regression guard: the per-message cap must not reintroduce hard-rejecting an honest,
    // long conversation once its TOTAL crosses the character cap. Every individual message
    // here stays well under MODEL_HISTORY_CHARS; only the running
    // total across the whole conversation grows past it. That must still be 200 with the
    // model-side history trimmed, never a 400 — a per-message cap is not a reintroduced
    // total-history cap.
    it('still returns 200 for a long honest conversation whose TOTAL exceeds MODEL_HISTORY_CHARS but whose every individual message is small', async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const turnCount = 20;
      const history = buildGroundedHistory(turnCount);

      // Fixture sanity check: every individual message is small, but the total is not — this
      // is the exact shape the regression guard is about.
      const sizes = history.map((m) => JSON.stringify(m).length);
      for (const size of sizes) expect(size).toBeLessThan(MODEL_HISTORY_CHARS);
      const total = sizes.reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(MODEL_HISTORY_CHARS);
      expect(total).toBeLessThan(HISTORY_ABUSE_MAX_CHARS);

      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
        chatReq({ messages: history, conversationId: crypto.randomUUID() }),
      );
      expect(res.status).toBe(200); // trimmed for the model, not rejected
      await res.text();
    });
  });

  // trimHistoryForModel cuts on size alone, so which role ends up first depends only on
  // message sizes — a realistic conversation (long visitor questions, short replies, per the
  // system prompt's "keep answers short") regularly lands the cut on an assistant message.
  // The Anthropic Messages API requires the first message to be role 'user'.
  describe('the prompt handed to the model always starts on a user turn', () => {
    // Alternating long-user / short-assistant turns, sized so that size-based trimming alone
    // (without advancing to the next user turn) would cut right after an assistant reply,
    // landing the kept suffix on that assistant message.
    function longUserShortAssistantHistory(turns: number, userChars: number) {
      const msgs: unknown[] = [];
      for (let turn = 1; turn <= turns; turn++) {
        msgs.push({
          id: `u${turn}`,
          role: 'user',
          parts: [{ type: 'text', text: `MARK_USER_${turn} ${'x'.repeat(userChars)}` }],
        });
        if (turn < turns) {
          msgs.push({ id: `a${turn}`, role: 'assistant', parts: [{ type: 'text', text: `MARK_ASSISTANT_${turn} ok` }] });
        }
      }
      return msgs;
    }

    it.each([
      [8, 3000],
      [10, 3000],
      [6, 4000],
    ])('turns=%i userChars=%i: the model never receives a prompt starting with an assistant message', async (turns, userChars) => {
      const { db } = await setupDemo();
      const { model, prompts } = await mockModelCapturingPrompts();
      const history = longUserShortAssistantHistory(turns, userChars);
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
        chatReq({ messages: history, conversationId: crypto.randomUUID() }),
      );
      expect(res.status).toBe(200);
      await res.text();

      // `system` is sent to the model as its own leading message with role 'system' in the
      // AI SDK's internal prompt representation (providers split it back out into Anthropic's
      // separate top-level `system` field) — the invariant under test is about the actual
      // conversation turns, so look past that leading system entry.
      const prompt = prompts[0] as Array<{ role: string }>;
      const conversationTurns = prompt.filter((m) => m.role !== 'system');
      expect(conversationTurns.length).toBeGreaterThan(0);
      expect(conversationTurns[0].role).toBe('user');
    });
  });

  // Falling back to the per-request visitorId whenever no platform IP header is present
  // would be wrong — that visitorId is a FRESH UUID whenever the caller also has no existing
  // cookie, so a cookie-less, header-less caller would get a brand-new bucket every single
  // request (`curl` in a loop, no cookie jar). Instead that traffic shares one constant
  // bucket.
  describe('cookie-less, header-less callers share one rate-limit bucket', () => {
    it('trips 429 well before 30 requests, and creates only one rate_limits row for all of them', async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const deps = { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 };

      const statuses: number[] = [];
      for (let i = 0; i < 30; i++) {
        // ip: null omits x-forwarded-for; no `cookie` option means no cookie is sent back —
        // together, cookie-less AND header-less, on every one of the 30 requests.
        const res = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId: crypto.randomUUID() }, { ip: null }));
        statuses.push(res.status);
        await res.text();
      }

      // Before the fix: every request minted its own visitorId-keyed bucket, so all 30 would
      // succeed (200) or fail only on conversation ownership — never 429. After the fix, the
      // shared 'anon' bucket exhausts CHAT_LIMIT.limit well before 30 requests.
      const rateLimited = statuses.filter((s) => s === 429).length;
      expect(rateLimited).toBeGreaterThan(0);
      expect(rateLimited).toBe(30 - CHAT_LIMIT.limit);

      const rows = await db.select().from(rateLimits);
      // One shared bucket for this church, not one per request.
      expect(rows).toHaveLength(1);
    });
  });

  // The per-visitor window must actually be an hour, not just documented as one — prove the
  // limit does NOT reset 10 minutes in.
  describe('the per-visitor limit window is calibrated to the demo budget (hourly, not 10-minute)', () => {
    it('exports the hourly limit', () => {
      expect(CHAT_LIMIT).toEqual({ limit: 20, windowSeconds: 3600 });
    });

    it('stays exhausted 10 minutes after the limit trips, not just a 10-minute window', async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const deps = { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 };
      const ip = '7.7.7.7';

      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-08-19T12:00:00Z'));
        let last: Response | null = null;
        for (let i = 0; i < 21; i++) {
          last = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId: crypto.randomUUID() }, { ip }));
        }
        expect(last!.status).toBe(429); // limit exhausted within the first window

        // 10 minutes and 1 second later: under the OLD 600s window this would already be a
        // fresh window (request allowed again). Under the fixed 3600s window it is still the
        // SAME window, so the caller must still be blocked.
        vi.setSystemTime(new Date('2026-08-19T12:10:01Z'));
        const stillBlocked = await handleChatRequest(
          deps,
          chatReq({ messages: userMessages, conversationId: crypto.randomUUID() }, { ip }),
        );
        expect(stillBlocked.status).toBe(429);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // Persistence must not be unconditional on either side of the exchange — a failed model
  // call should not write an empty assistant row, and a retried turn (regenerate() resends
  // the same history) should not write a second, duplicate user row for the same client
  // message id.
  describe('failed and retried turns do not corrupt the transcript', () => {
    it('does not persist an empty assistant row when the model call fails', async () => {
      const { db } = await setupDemo();
      const model = await mockFailingModel();
      const conversationId = crypto.randomUUID();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await handleChatRequest(
          { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
          chatReq({ messages: userMessages, conversationId }),
        );
        await res.text(); // drain so onEnd runs regardless of how the failure surfaced

        const { listMessages } = await import('@/db/repo/chat');
        const saved = await listMessages(db, conversationId);
        // The user's turn is still saved (it's written before the model is ever called) —
        // only the empty assistant row must be missing.
        expect(saved.map((m) => m.role)).toEqual(['user']);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('does not duplicate the user row when the same turn is sent twice (retry)', async () => {
      const { db } = await setupDemo();
      const model = await mockModel();
      const deps = { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 };
      const conversationId = crypto.randomUUID();

      const first = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId }));
      const cookie = visitorCookieFrom(first);
      await first.text();

      // regenerate() resends the exact same history — same message id ('m1') — for a retry
      // of the same turn.
      const second = await handleChatRequest(deps, chatReq({ messages: userMessages, conversationId }, { cookie }));
      await second.text();

      const { listMessages } = await import('@/db/repo/chat');
      const saved = await listMessages(db, conversationId);
      expect(saved.filter((m) => m.role === 'user')).toHaveLength(1); // not duplicated
      expect(saved.filter((m) => m.role === 'assistant')).toHaveLength(2); // each call still gets its own reply
    });
  });
});
