import { describe, expect, it, vi } from 'vitest';
import { draftReply } from '@/agent/reply-drafter';
import { HashEmbedder } from '@/ai/embedder';
import { chunkMarkdown } from '@/core/chunking';
import type { Db } from '@/db/client';
import { chunks, documents, usageLedger } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

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

async function seedDoc(db: Db, organizationId: string) {
  const embedder = new HashEmbedder();
  const [doc] = await db.insert(documents)
    .values({ organizationId, title: 'Horários e Contato', kind: 'schedule' }).returning();
  const pieces = chunkMarkdown('## Batismo\n\nOs batismos acontecem no último domingo do mês, às 18h30.');
  const { embeddings } = await embedder.embed(pieces.map((p) => p.content));
  await db.insert(chunks).values(pieces.map((p, i) => ({
    organizationId, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i],
  })));
}

describe('draftReply', () => {
  it('drafts a reply grounded in the knowledge base and meters both calls', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db, 'Igreja da Colina');
    await seedDoc(db, church.id);

    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('Olá! Os batismos acontecem no último domingo do mês, às 18h30.') },
      { organizationId: church.id, organizationName: church.name, ticketId: crypto.randomUUID(), topic: 'quando é o batismo?' },
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
    const church = await seedOrganization(db);
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('Não encontrei essa informação; vou verificar e retorno.') },
      { organizationId: church.id, organizationName: church.name, ticketId: crypto.randomUUID(), topic: 'xyzzy quux' },
    );
    expect(out.reply.length).toBeGreaterThan(0);
    expect(out.sources).toEqual([]);
  });

  it('never surfaces another tenant’s documents', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'A');
    const b = await seedOrganization(db, 'B');
    await seedDoc(db, b.id);
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('...') },
      { organizationId: a.id, organizationName: a.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );
    expect(out.sources).toEqual([]);
  });

  it('returns a safe fallback instead of throwing when the model fails', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const { MockLanguageModelV3 } = await import('ai/test');
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('gateway down'); } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model },
      { organizationId: church.id, organizationName: church.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );
    expect(out.reply).toBe('');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not throw when the embedder fails synchronously; continues with empty grounding and logs', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    // Embedder that throws synchronously
    const throwingEmbedder = {
      model: 'test-embedder',
      embed: () => { throw new Error('embedder crashed'); },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await draftReply(
      { db, embedder: throwingEmbedder, model: await textModel('Não encontrei essa informação; vou verificar e retorno.') },
      { organizationId: church.id, organizationName: church.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );
    // Should return a draft (not throw) with empty sources because the embedder failed
    expect(out.reply).toContain('verificar');
    expect(out.sources).toEqual([]);
    // Should log the retrieval failure
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('support.retrieval failed'),
      expect.objectContaining({
        organizationId: church.id,
        ticketId: expect.any(String),
        error: expect.any(Error),
      }),
    );
    spy.mockRestore();
  });

  it('does not throw when the embedder fails asynchronously; continues with empty grounding and logs', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    // Embedder that rejects asynchronously
    const throwingEmbedder = {
      model: 'test-embedder',
      embed: async () => { throw new Error('network timeout'); },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await draftReply(
      { db, embedder: throwingEmbedder, model: await textModel('Não encontrei essa informação; vou verificar e retorno.') },
      { organizationId: church.id, organizationName: church.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );
    // Should return a draft (not throw) with empty sources because the embedder failed
    expect(out.reply).toContain('verificar');
    expect(out.sources).toEqual([]);
    // Should log the retrieval failure
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('support.retrieval failed'),
      expect.objectContaining({
        organizationId: church.id,
        ticketId: expect.any(String),
        error: expect.any(Error),
      }),
    );
    spy.mockRestore();
  });

  it('treats whitespace-only model output as empty', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('   \n\t  ') },
      { organizationId: church.id, organizationName: church.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );
    // Whitespace-only should be trimmed to empty string
    expect(out.reply).toBe('');
  });

  it('trims leading and trailing whitespace from model output while preserving content', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const out = await draftReply(
      { db, embedder: new HashEmbedder(), model: await textModel('  \n  Olá!  \n  ') },
      { organizationId: church.id, organizationName: church.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );
    // Should be trimmed to exactly 'Olá!' with content preserved
    expect(out.reply).toBe('Olá!');
  });

  it('does not record a retrieval row when the embedder throws', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const throwingEmbedder = {
      model: 'test-embedder',
      embed: async () => { throw new Error('embedder failed'); },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await draftReply(
      { db, embedder: throwingEmbedder, model: await textModel('Não encontrei essa informação; vou verificar e retorno.') },
      { organizationId: church.id, organizationName: church.name, ticketId: crypto.randomUUID(), topic: 'batismo' },
    );

    // Should still return a draft with empty sources
    expect(out.reply).toContain('verificar');
    expect(out.sources).toEqual([]);

    // Should NOT have written a support.retrieval row, only support.draft
    const ledger = await db.select().from(usageLedger);
    const retrievalRows = ledger.filter((u) => u.feature === 'support.retrieval');
    expect(retrievalRows.length).toBe(0);
    expect(ledger.some((u) => u.feature === 'support.draft')).toBe(true);

    spy.mockRestore();
  });
});
