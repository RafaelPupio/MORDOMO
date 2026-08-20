import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import {
  applyPrayerStatus, applyTicketStatus, getSentTicketReply, sendTicketReply, suggestTicketReply,
} from '@/core/staff-operations';
import type { Db } from '@/db/client';
import { ensureConversation, listMessages, saveMessage } from '@/db/repo/chat';
import { listPrayerRequests, createPrayerRequest } from '@/db/repo/prayer';
import { createTicket, getTicket, setTicketStatus } from '@/db/repo/tickets';
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

  it('treats a malformed (non-uuid) id as a no-op, never a thrown DB error', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await createPrayerRequest(db, { churchId: church.id, request: 'Pela minha avó' });

    await expect(applyPrayerStatus(db, church.id, 'not-a-uuid', 'done')).resolves.toBeUndefined();
    expect((await listPrayerRequests(db, church.id))[0].status).toBe('new');
  });
});

describe('applyTicketStatus', () => {
  it('moves a ticket through statuses, scoped to the church passed in', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    const ticket = await createTicket(db, { churchId: a.id, topic: 'Horário do culto' });

    await applyTicketStatus(db, a.id, ticket.id, 'closed');
    expect((await getTicket(db, a.id, ticket.id))?.status).toBe('closed');

    // A different church's id must not touch a's row.
    await applyTicketStatus(db, b.id, ticket.id, 'answered');
    expect((await getTicket(db, a.id, ticket.id))?.status).toBe('closed');
  });

  it('treats a malformed (non-uuid) id as a no-op, never a thrown DB error', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);

    await expect(applyTicketStatus(db, church.id, 'not-a-uuid', 'closed')).resolves.toBeUndefined();
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
    expect(out.generated).toBe(true);
    expect((await getTicket(db, church.id, ticket.id))?.suggestedReply).toBe('O culto é às 10h.');
  });

  it('never overwrites an existing good draft with an empty string when the drafter fails, and reports the fallback as not generated (I2)', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const ticket = await createTicket(db, { churchId: church.id, topic: 'Horário do culto' });

    const good = await suggestTicketReply(
      { db, embedder: new HashEmbedder(), model: await textModel('O culto é às 10h.') },
      { churchId: church.id, churchName: church.name, ticketId: ticket.id },
    );
    expect(good.reply).toBe('O culto é às 10h.');
    expect(good.generated).toBe(true);

    const failed = await suggestTicketReply(
      { db, embedder: new HashEmbedder(), model: await throwingModel() },
      { churchId: church.id, churchName: church.name, ticketId: ticket.id },
    );

    // The staff member must still see the last good draft, both in what's returned...
    expect(failed.reply).toBe('O culto é às 10h.');
    // ...and in what's persisted — the failure must not have clobbered the row.
    expect((await getTicket(db, church.id, ticket.id))?.suggestedReply).toBe('O culto é às 10h.');
    // ...but the caller can now tell this was a stale fallback, not a fresh draft — the
    // identical `reply` text alone can't distinguish the two (I2).
    expect(failed.generated).toBe(false);
  });

  it('returns an empty, ungenerated draft and touches nothing for a ticket that belongs to another church', async () => {
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
    expect(out.generated).toBe(false);
    expect((await getTicket(db, a.id, ticket.id))?.suggestedReply).toBeNull();
  });

  it('treats a malformed (non-uuid) ticket id as a controlled empty result, never a thrown DB error', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);

    const out = await suggestTicketReply(
      { db, embedder: new HashEmbedder(), model: await textModel('Nunca deveria ser chamado.') },
      { churchId: church.id, churchName: church.name, ticketId: 'not-a-uuid' },
    );

    expect(out).toEqual({ reply: '', sources: [], generated: false });
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

    await expect(sendTicketReply(db, church.id, ticket.id, 'Aqui está a resposta.')).resolves.toEqual({ sent: true });
    expect((await getTicket(db, church.id, ticket.id))?.status).toBe('answered');
  });

  it('refuses a second send once the ticket has left `open`: only one message lands, status unchanged', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const conversationId = await seedConversation(db, church.id);
    const ticket = await createTicket(db, { churchId: church.id, conversationId, topic: 'Agendar batismo' });

    const first = await sendTicketReply(db, church.id, ticket.id, 'Podemos agendar para o próximo domingo!');
    expect(first).toEqual({ sent: true });

    const second = await sendTicketReply(db, church.id, ticket.id, 'Podemos agendar para o próximo domingo!');
    expect(second).toEqual({ sent: false, reason: 'not-open' });

    expect(await listMessages(db, conversationId)).toHaveLength(1);
    expect((await getTicket(db, church.id, ticket.id))?.status).toBe('answered');
  });

  it('refuses to send on a `closed` ticket: nothing written, status stays closed', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const conversationId = await seedConversation(db, church.id);
    const ticket = await createTicket(db, { churchId: church.id, conversationId, topic: 'Agendar batismo' });
    await setTicketStatus(db, church.id, ticket.id, 'closed');

    const result = await sendTicketReply(db, church.id, ticket.id, 'Não deveria ser enviado.');

    expect(result).toEqual({ sent: false, reason: 'not-open' });
    expect(await listMessages(db, conversationId)).toHaveLength(0);
    expect((await getTicket(db, church.id, ticket.id))?.status).toBe('closed');
  });

  it('treats a malformed (non-uuid) ticket id as a controlled refusal, never a thrown DB error', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);

    await expect(sendTicketReply(db, church.id, 'not-a-uuid', 'Resposta.')).resolves.toEqual({
      sent: false,
      reason: 'invalid-id',
    });
  });
});

describe('getSentTicketReply', () => {
  it('exposes the text staff actually sent, not the (possibly different) AI draft column (I3)', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const conversationId = await seedConversation(db, church.id);
    const ticket = await createTicket(db, { churchId: church.id, conversationId, topic: 'Agendar batismo' });

    // A draft was suggested and saved to `suggestedReply`...
    await suggestTicketReply(
      { db, embedder: new HashEmbedder(), model: await textModel('Rascunho: podemos agendar em breve.') },
      { churchId: church.id, churchName: church.name, ticketId: ticket.id },
    );
    // ...but staff edited it before sending, so the ACTUAL sent text differs from the draft.
    await sendTicketReply(db, church.id, ticket.id, 'Editado: pode ser no próximo domingo às 10h!');

    const sent = await getSentTicketReply(db, church.id, ticket.id);
    expect(sent).toEqual({ found: true, text: 'Editado: pode ser no próximo domingo às 10h!' });

    // Confirm the two really do disagree — this is the bug I3 fixes.
    expect((await getTicket(db, church.id, ticket.id))?.suggestedReply).toBe('Rascunho: podemos agendar em breve.');
  });

  it("excludes the bot's own escalation-turn message even when it lands after the ticket row exists", async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const conversationId = await seedConversation(db, church.id);
    const ticket = await createTicket(db, { churchId: church.id, conversationId, topic: 'Pergunta difícil' });

    // Simulates `web.ts`'s onEnd: the assistant turn that called `escalateToHuman` (creating
    // this very ticket) is only persisted AFTER the tool call resolves, so its `createdAt`
    // can land after `ticket.createdAt`. It must not be mistaken for a staff-sent reply —
    // it carries a non-text part for the tool call, unlike anything `sendTicketReply` saves.
    await saveMessage(db, {
      churchId: church.id,
      conversationId,
      role: 'assistant',
      parts: [
        { type: 'tool-invocation', toolName: 'escalateToHuman' },
        { type: 'text', text: 'Vou conectar você com a nossa equipe.' },
      ],
    });

    expect(await getSentTicketReply(db, church.id, ticket.id)).toEqual({ found: false, reason: 'no-reply' });

    await sendTicketReply(db, church.id, ticket.id, 'Aqui está a resposta da equipe.');
    expect(await getSentTicketReply(db, church.id, ticket.id)).toEqual({
      found: true,
      text: 'Aqui está a resposta da equipe.',
    });
  });

  it('reports no-conversation for a ticket with no attached conversation', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const ticket = await createTicket(db, { churchId: church.id, topic: 'Pergunta geral' });

    expect(await getSentTicketReply(db, church.id, ticket.id)).toEqual({
      found: false,
      reason: 'no-conversation',
    });
  });

  it('reports no-reply for a ticket closed without ever sending one', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const conversationId = await seedConversation(db, church.id);
    const ticket = await createTicket(db, { churchId: church.id, conversationId, topic: 'Agendar batismo' });
    await setTicketStatus(db, church.id, ticket.id, 'closed');

    expect(await getSentTicketReply(db, church.id, ticket.id)).toEqual({ found: false, reason: 'no-reply' });
  });
});
