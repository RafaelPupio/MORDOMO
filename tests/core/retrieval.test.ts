import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { chunkMarkdown } from '@/core/chunking';
import { searchKnowledgeBase } from '@/core/retrieval';
import type { Db } from '@/db/client';
import { chunks, documents } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

const embedder = new HashEmbedder();

async function seedDoc(db: Db, churchId: string, title: string, markdown: string) {
  const [doc] = await db.insert(documents).values({ churchId, title, kind: 'faq' }).returning();
  const pieces = chunkMarkdown(markdown);
  const { embeddings } = await embedder.embed(pieces.map((p) => p.content));
  await db.insert(chunks).values(
    pieces.map((p, i) => ({ churchId, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i] })),
  );
  return doc;
}

describe('searchKnowledgeBase', () => {
  it('ranks the on-topic document first and carries citation fields', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await seedDoc(db, church.id, 'Horários', '## Culto de domingo\n\nO culto de domingo acontece às 10h e às 18h.');
    await seedDoc(db, church.id, 'Ministérios', '## OTB Jovens\n\nEncontro dos jovens aos sábados às 19h.');
    const { sources } = await searchKnowledgeBase(db, embedder, church.id, 'que horas é o culto de domingo?');
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].documentTitle).toBe('Horários');
    expect(sources[0].excerpt).toContain('10h');
    expect(sources[0].score).toBeGreaterThan(0);
  });

  it('never returns another tenant’s chunks', async () => {
    const db = await createTestDb();
    const a = await seedChurch(db, 'A');
    const b = await seedChurch(db, 'B');
    await seedDoc(db, b.id, 'Segredo de B', '## Culto\n\nCulto secreto da igreja B às 10h de domingo.');
    const { sources } = await searchKnowledgeBase(db, embedder, a.id, 'culto de domingo');
    expect(sources).toHaveLength(0);
  });

  it('filters below minScore and caps at k', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    await seedDoc(db, church.id, 'Horários', '## Culto\n\nCulto de domingo às 10h.');
    const none = await searchKnowledgeBase(db, embedder, church.id, 'xyzzy quux', { minScore: 0.9 });
    expect(none.sources).toHaveLength(0);
    const capped = await searchKnowledgeBase(db, embedder, church.id, 'culto', { k: 1, minScore: 0 });
    expect(capped.sources.length).toBeLessThanOrEqual(1);
  });
});
