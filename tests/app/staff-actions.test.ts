import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { applyPrayerStatus, sendTicketReply, suggestTicketReply } from '@/core/staff-operations';
import type { Db } from '@/db/client';
import { ensureConversation, listMessages, saveMessage } from '@/db/repo/chat';
import { listPrayerRequests, createPrayerRequest } from '@/db/repo/prayer';
import { createTicket, getTicket } from '@/db/repo/tickets';
import { createTestDb, seedChurch } from '../helpers/db';

async function textModel(text: string) {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 90, noCache: 90, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 25, text: 25, reasoning: undefined },
      },
      content: [{ type: 'text', text }],
      warnings: [],
    }),
  });
}

async function throwingModel() {
  const { MockLanguageModelV3 } = await import('ai/test');
  return new MockLanguageModelV3({ doGenerate: async () => { throw new Error('gateway down'); } });
}

async function seedConversation(db: Db, churchId: string) {
  const id = crypto.randomUUID();
  await ensureConversation(db, { id, churchId, visitorKey: 'visitor-1' });
  return id;
}

describe('applyPrayerStatus', () => {
  it('moves a request through statuses, scoped to the church passed in', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const req = await createPrayerRequest(db, { churchId: a.id, request: 'Pela minha avó' });

    await applyPrayerStatus(db, a.id, req.id, 'praying');
    expect((await listPrayerRequests(db, a.id))[0].status).toBe('praying');

    // Passing a different church's id must not touch a's row — this is the operation
    // layer trusting the repo's own WHERE-scoped update, not re-deriving anything.
    await applyPrayerStatus(db, b.id, req.id, 'done');
    expect((await listPrayerRequests(db, a.id))[0].status).toBe('praying');
  });
});

describe('suggestTicketReply', () => {
  it('drafts a reply, persists it on the ticket, and returns it', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const ticket = await createTicket(db, { churchId: church.id, topic: 'Horário do culto de domingo' });

    const out = await suggestTicketReply(
      { db, embedder: new HashEmbedder(), model: await textModel('O culto é às 10h.') },
      { churchId: church.id, churchName: church.name, ticketId: ticket.id },
    );

    expect(out.reply).toBe('O culto é às 10h.');
    expect((await getTicket(db, church.id, ticket.id))?.suggestedReply).toBe('O culto é às 10h.');
  });

  it('never overwrites an existing good draft with an empty string when the drafter fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const ticket = await createTicket(db, { churchId: church.id, topic: 'Horário do culto' });

    const good = await suggestTicketReply(
      { db, embedder: new HashEmbedder(), model: await textModel('O culto é às 10h.') },
      { churchId: church.id, churchName: church.name, ticketId: ticket.id },
    );
    expect(good.reply).toBe('O culto é às 10h.');

    const failed = await suggestTicketReply(
      { db, embedder: new HashEmbedder(), model: await throwingModel() },
      { churchId: church.id, churchName: church.name, ticketId: ticket.id },
    );

    // The staff member must still see the last good draft, both in what's returned...
    expect(failed.reply).toBe('O culto é às 10h.');
    // ...and in what's persisted — the failure must not have clobbered the row.
    expect((await getTicket(db, church.id, ticket.id))?.suggestedReply).toBe('O culto é às 10h.');
  });

  it('returns an empty draft and touches nothing for a ticket that belongs to another church', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const ticket = await createTicket(db, { churchId: a.id, topic: 'Horário do culto' });

    const out = await suggestTicketReply(
      { db, embedder: new HashEmbedder(), model: await textModel('Nunca deveria ser salvo.') },
      { churchId: b.id, churchName: 'B', ticketId: ticket.id },
    );

    expect(out.reply).toBe('');
    expect(out.sources).toEqual([]);
    expect((await getTicket(db, a.id, ticket.id))?.suggestedReply).toBeNull();
  });

  it('grounds the draft in the ticket’s own conversation, not just its topic summary', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const conversationId = await seedConversation(db, church.id);
    await saveMessage(db, {
      churchId: church.id,
      conversationId,
      role: 'user',
      parts: [{ type: 'text', text: 'Minha avó Maria está internada, podem orar por ela?' }],
    });
    const ticket = await createTicket(db, { churchId: church.id, conversationId, topic: 'Pedido de oração urgente' });

    let capturedPrompt = '';
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({
      doGenerate: async (params) => {
        capturedPrompt = JSON.stringify(params.prompt);
        return {
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          content: [{ type: 'text', text: 'Vamos orar pela sua avó Maria.' }],
          warnings: [],
        };
      },
    });

    await suggestTicketReply(
      { db, embedder: new HashEmbedder(), model },
      { churchId: church.id, churchName: church.name, ticketId: ticket.id },
    );

    expect(capturedPrompt).toContain('Maria');
  });
});

describe('sendTicketReply', () => {
  it('persists the reply as an assistant message on the conversation and marks the ticket answered', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const conversationId = await seedConversation(db, church.id);
    const ticket = await createTicket(db, { churchId: church.id, conversationId, topic: 'Agendar batismo' });

    await sendTicketReply(db, church.id, ticket.id, 'Podemos agendar para o próximo domingo!');

    const history = await listMessages(db, conversationId);
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('assistant');
    expect(JSON.stringify(history[0].parts)).toContain('próximo domingo');

    expect((await getTicket(db, church.id, ticket.id))?.status).toBe('answered');
  });

  it('refuses an empty reply: nothing written, status unchanged', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const conversationId = await seedConversation(db, church.id);
    const ticket = await createTicket(db, { churchId: church.id, conversationId, topic: 'Agendar batismo' });

    await sendTicketReply(db, church.id, ticket.id, '   ');

    expect(await listMessages(db, conversationId)).toHaveLength(0);
    expect((await getTicket(db, church.id, ticket.id))?.status).toBe('open');
  });

  it('refuses a ticket belonging to another church: nothing written, status unchanged', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const conversationId = await seedConversation(db, a.id);
    const ticket = await createTicket(db, { churchId: a.id, conversationId, topic: 'Agendar batismo' });

    await sendTicketReply(db, b.id, ticket.id, 'Resposta indevida.');

    expect(await listMessages(db, conversationId)).toHaveLength(0);
    expect((await getTicket(db, a.id, ticket.id))?.status).toBe('open');
  });

  it('marks a ticket with no conversation as answered without throwing', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const ticket = await createTicket(db, { churchId: church.id, topic: 'Pergunta geral' });

    await expect(sendTicketReply(db, church.id, ticket.id, 'Aqui está a resposta.')).resolves.toBeUndefined();
    expect((await getTicket(db, church.id, ticket.id))?.status).toBe('answered');
  });
});
