import { describe, expect, it, vi } from 'vitest';
import { draftReply } from '@/agent/reply-drafter';
import { HashEmbedder } from '@/ai/embedder';
import { chunkMarkdown } from '@/core/chunking';
import type { Db } from '@/db/client';
import { chunks, documents, usageLedger } from '@/db/schema';
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

async function seedDoc(db: Db, churchId: string) {
  const embedder = new HashEmbedder();
  const [doc] = await db.insert(documents)
    .values({ churchId, title: 'Horários e Contato', kind: 'schedule' }).returning();
  const pieces = chunkMarkdown('## Batismo\n\nOs batismos acontecem no último domingo do mês, às 18h30.');
  const { embeddings } = await embedder.embed(pieces.map((p) => p.content));
  await db.insert(chunks).values(pieces.map((p, i) => ({
    churchId, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i],
  })));
}

describe('draftReply', () => {
  it('drafts a reply grounded in the knowledge base and meters both calls', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db, 'Igreja da Colina');
    await seedDoc(db, church.id);

    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('Olá! Os batismos acontecem no último domingo do mês, às 18h30.') },
      { churchId: church.id, churchName: church.name, ticketId: crypto.randomUUID(), topic: 'quando é o batismo?' },
    );

    expect(out.reply).toContain('18h30');
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.sources[0].documentTitle).toBe('Horários e Contato');

    const ledger = await db.select().from(usageLedger);
    expect(ledger.some((u) => u.feature === 'support.draft')).toBe(true);
    expect(ledger.some((u) => u.feature === 'support.retrieval')).toBe(true);
  });

  it('still returns a draft when the knowledge base has nothing relevant', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('Não encontrei essa informação; vou verificar e retorno.') },
      { churchId: church.id, churchName: church.name, ticketId: crypto.randomUUID(), topic: 'xyzzy quux' },
    );
    expect(out.reply.length).toBeGreaterThan(0);
    expect(out.sources).toEqual([]);
  });

  it('never surfaces another tenant’s documents', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    await seedDoc(db, b.id);
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('...') },
      { churchId: a.id, churchName: a.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );
    expect(out.sources).toEqual([]);
  });

  it('returns a safe fallback instead of throwing when the model fails', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('gateway down'); } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model },
      { churchId: church.id, churchName: church.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );
    expect(out.reply).toBe('');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
