import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { HISTORY_ABUSE_MAX_CHARS, MAX_MESSAGES, MODEL_HISTORY_CHARS, handleChatRequest } from '@/channels/web';
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

const userMessages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Olá!' }] }];

// Builds one realistic "grounded" turn: a short user question and an assistant reply that
// cites five knowledge-base sources (the shape the regression is about — a real grounded
// reply is not just a few words of text, it's a tool-output part carrying source excerpts).
// Each part's text carries a MARK_* token unique to its turn number and role, so a test can
// tell, just by substring search on the serialized prompt, which turns survived trimming.
// Sized (repeat count tuned against this exact fixture) to land close to the ~3,100
// characters/turn the reviewer measured against the live handler.
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

    // (Round 3) This used to assert 400: a single message just over the old MAX_TOTAL_CHARS
    // (24,000) was treated as abuse. That was the regression itself — a single honest,
    // long message is nowhere near abusive, and it's also the newest (only) message, which
    // trimHistoryForModel must never drop. It is now well under HISTORY_ABUSE_MAX_CHARS
    // (256,000), so it is accepted and reaches the model whole, unstrimmed, even though it
    // is over MODEL_HISTORY_CHARS on its own.
    it('still returns 200 for a single huge newest user message under the abuse bound (not trimmed away)', async () => {
      const { db } = await setupDemo();
      const { model, prompts } = await mockModelCapturingPrompts();
      const bigText = `MARK_ONLY ${'x'.repeat(100_000)}`;
      const huge = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: bigText }] }];
      const res = await handleChatRequest(
        { db, embedder: new HashEmbedder(), model, globalCapUsd: 50 },
        chatReq({ messages: huge, conversationId: crypto.randomUUID() }),
      );
      expect(res.status).toBe(200);
      await res.text();
      // The message reached the model whole — trimming never drops the newest message, no
      // matter how far over MODEL_HISTORY_CHARS it is on its own.
      expect(JSON.stringify(prompts[0])).toContain('MARK_ONLY');
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

    // (Round 3) This used to assert 400: 40 small messages summing to ~33,000 characters is
    // well over the old single MAX_TOTAL_CHARS (24,000) but nowhere near abusive — it's
    // comfortably under HISTORY_ABUSE_MAX_CHARS (256,000). That "reject an honest, merely
    // long history" behavior was the regression. It now gets trimmed for the model (see the
    // dedicated F4 (round 3) tests below) and the request completes normally.
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

  // F4 (round 3): a reviewer measured that a normal, non-abusive conversation where the
  // secretary cites sources costs ~3,100 serialized characters per grounded turn. Once a
  // visitor crossed the old single MAX_TOTAL_CHARS (24,000, around turn 9), every
  // subsequent turn 400'd — permanently, because the client keeps resending the whole
  // growing history. The fix splits one bound into two: HISTORY_ABUSE_MAX_CHARS (256,000)
  // still hard-rejects genuinely abusive requests before any DB write; MODEL_HISTORY_CHARS
  // (24,000, unchanged in value, changed in role) now silently trims what's sent to the
  // model instead of rejecting the request.
  describe('F4 (round 3): history over MODEL_HISTORY_CHARS is trimmed, not rejected', () => {
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

      // Turn 9's history alone is already ~28,000 characters (over the old 24,000 cap) —
      // this is exactly the point the reviewer found permanently broken. Turn 12 proves it
      // isn't a one-time fluke: the conversation keeps working as it keeps growing.
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
});
