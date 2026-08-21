import { describe, expect, it } from 'vitest';
import { gatherWeekActivity, MAX_ITEM_CHARS, MAX_ITEMS_PER_KIND } from '@/core/week-activity';
import type { Db } from '@/db/client';
import { conversations, messages, prayerRequests, tickets, usageLedger } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

const PERIOD_START = new Date('2026-08-10T00:00:00Z');
const PERIOD_END = new Date('2026-08-17T00:00:00Z');
const IN_WINDOW = new Date('2026-08-12T12:00:00Z');

async function seedConversation(db: Db, churchId: string, visitorKey = 'v1') {
  const id = crypto.randomUUID();
  await db.insert(conversations).values({ id, churchId, visitorKey });
  return id;
}

async function seedMessage(
  db: Db,
  churchId: string,
  conversationId: string,
  role: 'user' | 'assistant',
  parts: unknown,
  createdAt: Date,
) {
  await db.insert(messages).values({ churchId, conversationId, role, parts, createdAt });
}

describe('gatherWeekActivity', () => {
  it('only includes role: user messages as visitorQuestions — assistant turns are excluded', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const convId = await seedConversation(db, church.id);
    await seedMessage(db, church.id, convId, 'user', [{ type: 'text', text: 'Qual o horário do culto?' }], IN_WINDOW);
    await seedMessage(db, church.id, convId, 'assistant', [{ type: 'text', text: 'O culto é às 10h.' }], IN_WINDOW);

    const activity = await gatherWeekActivity(db, church.id, PERIOD_START, PERIOD_END);

    expect(activity.visitorQuestions).toEqual(['Qual o horário do culto?']);
    expect(activity.counts.visitorMessages).toBe(1);
  });

  it('excludes a row exactly at periodEnd and includes a row exactly at periodStart', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const convId = await seedConversation(db, church.id);

    await seedMessage(db, church.id, convId, 'user', [{ type: 'text', text: 'antes do início' }], new Date(PERIOD_START.getTime() - 1));
    await seedMessage(db, church.id, convId, 'user', [{ type: 'text', text: 'exatamente no início' }], PERIOD_START);
    await seedMessage(db, church.id, convId, 'user', [{ type: 'text', text: 'exatamente no fim' }], PERIOD_END);

    const activity = await gatherWeekActivity(db, church.id, PERIOD_START, PERIOD_END);

    expect(activity.visitorQuestions).toEqual(['exatamente no início']);
    expect(activity.counts.visitorMessages).toBe(1);
  });

  it('never includes another church’s rows', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const convA = await seedConversation(db, a.id);
    const convB = await seedConversation(db, b.id);

    await seedMessage(db, a.id, convA, 'user', [{ type: 'text', text: 'pergunta da igreja A' }], IN_WINDOW);
    await seedMessage(db, b.id, convB, 'user', [{ type: 'text', text: 'pergunta da igreja B' }], IN_WINDOW);
    await db.insert(prayerRequests).values({ churchId: b.id, request: 'oração de B', createdAt: IN_WINDOW });
    await db.insert(tickets).values({ churchId: b.id, topic: 'ticket de B', createdAt: IN_WINDOW });
    await db.insert(usageLedger).values({
      churchId: b.id, feature: 'chat.reply', model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 9.99, createdAt: IN_WINDOW,
    });

    const activity = await gatherWeekActivity(db, a.id, PERIOD_START, PERIOD_END);

    expect(activity.visitorQuestions).toEqual(['pergunta da igreja A']);
    expect(activity.prayerRequests).toEqual([]);
    expect(activity.ticketTopics).toEqual([]);
    expect(activity.costUsd).toBe(0);
    expect(activity.counts).toEqual({ conversations: 1, visitorMessages: 1, prayerRequests: 0, tickets: 0 });
  });

  it('counts match what was seeded, across all four kinds', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const conv1 = await seedConversation(db, church.id, 'v1');
    const conv2 = await seedConversation(db, church.id, 'v2');

    await seedMessage(db, church.id, conv1, 'user', [{ type: 'text', text: 'pergunta 1' }], IN_WINDOW);
    await seedMessage(db, church.id, conv1, 'assistant', [{ type: 'text', text: 'resposta 1' }], IN_WINDOW);
    await seedMessage(db, church.id, conv2, 'user', [{ type: 'text', text: 'pergunta 2' }], IN_WINDOW);

    await db.insert(prayerRequests).values([
      { churchId: church.id, request: 'oração 1', createdAt: IN_WINDOW },
      { churchId: church.id, request: 'oração 2', createdAt: IN_WINDOW },
    ]);
    await db.insert(tickets).values({ churchId: church.id, topic: 'ticket 1', createdAt: IN_WINDOW });

    const activity = await gatherWeekActivity(db, church.id, PERIOD_START, PERIOD_END);

    expect(activity.counts).toEqual({
      conversations: 2, // conv1 and conv2 both had activity in the window
      visitorMessages: 2,
      prayerRequests: 2,
      tickets: 1,
    });
  });

  it('costUsd sums only that church’s usage_ledger rows inside the window', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');

    await db.insert(usageLedger).values([
      { churchId: a.id, feature: 'chat.reply', model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 1.5, createdAt: IN_WINDOW },
      { churchId: a.id, feature: 'chat.retrieval', model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 0.25, createdAt: IN_WINDOW },
      // Outside the window — must not be summed.
      { churchId: a.id, feature: 'chat.reply', model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 100, createdAt: new Date(PERIOD_START.getTime() - 1) },
      // Another church, inside the window — must not be summed.
      { churchId: b.id, feature: 'chat.reply', model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 50, createdAt: IN_WINDOW },
    ]);

    const activity = await gatherWeekActivity(db, a.id, PERIOD_START, PERIOD_END);

    expect(activity.costUsd).toBeCloseTo(1.75, 6);
  });

  it('caps each list at MAX_ITEMS_PER_KIND and truncates a long item to MAX_ITEM_CHARS', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const convId = await seedConversation(db, church.id);

    const total = MAX_ITEMS_PER_KIND + 10;
    for (let i = 0; i < total; i++) {
      // Increasing timestamps so ordering (newest-first) is deterministic.
      const createdAt = new Date(IN_WINDOW.getTime() + i * 1000);
      await seedMessage(db, church.id, convId, 'user', [{ type: 'text', text: `pergunta ${i}` }], createdAt);
    }
    const longRequest = 'a'.repeat(MAX_ITEM_CHARS + 500);
    await db.insert(prayerRequests).values({ churchId: church.id, request: longRequest, createdAt: IN_WINDOW });

    const activity = await gatherWeekActivity(db, church.id, PERIOD_START, PERIOD_END);

    expect(activity.visitorQuestions).toHaveLength(MAX_ITEMS_PER_KIND);
    // Newest first: the last-seeded message (index `total - 1`) must be the first item.
    expect(activity.visitorQuestions[0]).toBe(`pergunta ${total - 1}`);
    expect(activity.counts.visitorMessages).toBe(total);

    expect(activity.prayerRequests).toHaveLength(1);
    expect(activity.prayerRequests[0].length).toBeLessThanOrEqual(MAX_ITEM_CHARS + 1); // +1 for the ellipsis char
    expect(activity.prayerRequests[0].length).toBeLessThan(longRequest.length);
  });

  it('extracts text from AI-SDK parts; a message with only a tool part yields nothing', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const convId = await seedConversation(db, church.id);

    await seedMessage(db, church.id, convId, 'user', [{ type: 'text', text: 'com texto' }], IN_WINDOW);
    await seedMessage(
      db,
      church.id,
      convId,
      'user',
      [{ type: 'tool-call', toolName: 'searchKnowledgeBase', input: {} }],
      new Date(IN_WINDOW.getTime() + 1000),
    );

    const activity = await gatherWeekActivity(db, church.id, PERIOD_START, PERIOD_END);

    expect(activity.visitorQuestions).toEqual(['com texto']);
    expect(activity.visitorQuestions.join()).not.toContain('[object Object]');
    expect(activity.visitorQuestions.join()).not.toContain('undefined');
    // The tool-only message still counts as a real visitor message even though it
    // contributes no text to the sample list.
    expect(activity.counts.visitorMessages).toBe(2);
  });
});
