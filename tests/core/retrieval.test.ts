import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';
import { chunkMarkdown } from '@/core/chunking';
import { searchKnowledgeBase } from '@/core/retrieval';
import type { Db } from '@/db/client';
import { chunks, documents } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

const embedder = new HashEmbedder();

async function seedDoc(db: Db, organizationId: string, title: string, markdown: string) {
  const [doc] = await db.insert(documents).values({ organizationId, title, kind: 'faq' }).returning();
  const pieces = chunkMarkdown(markdown);
  const { embeddings } = await embedder.embed(pieces.map((p) => p.content));
  await db.insert(chunks).values(
    pieces.map((p, i) => ({ organizationId, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i] })),
  );
  return doc;
}

describe('searchKnowledgeBase', () => {
  it('ranks the on-topic document first and carries citation fields', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
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
    const a = await seedOrganization(db, 'A');
    const b = await seedOrganization(db, 'B');
    await seedDoc(db, b.id, 'Segredo de B', '## Culto\n\nCulto secreto da igreja B às 10h de domingo.');
    const { sources } = await searchKnowledgeBase(db, embedder, a.id, 'culto de domingo');
    expect(sources).toHaveLength(0);
  });

  it('filters below minScore and caps at k', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    await seedDoc(db, church.id, 'Horários', '## Culto\n\nCulto de domingo às 10h.');
    const none = await searchKnowledgeBase(db, embedder, church.id, 'xyzzy quux', { minScore: 0.9 });
    expect(none.sources).toHaveLength(0);
    const capped = await searchKnowledgeBase(db, embedder, church.id, 'culto', { k: 1, minScore: 0 });
    expect(capped.sources.length).toBeLessThanOrEqual(1);
  });

  it('centers the excerpt on matching text when it sits near the end of a long chunk', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const filler = 'Texto de preenchimento sem relação com a consulta feita, apenas para alongar o trecho e testar o recorte da citação. '.repeat(4);
    const relevant = 'A reunião extraordinária do conselho fiscal acontece às 20h no salão paroquial.';
    await seedDoc(db, church.id, 'Avisos', `## Aviso\n\n${filler}${relevant}`);
    const { sources } = await searchKnowledgeBase(db, embedder, church.id, 'reunião extraordinária conselho fiscal', { minScore: 0 });
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].excerpt).toContain('conselho fiscal');
    expect(sources[0].excerpt.length).toBeLessThanOrEqual(400);
  });

  it('marks a mid-chunk excerpt as truncated on both ends', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const fillerA = 'Texto de preenchimento inicial sem relação com a consulta, apenas para alongar o trecho testado. '.repeat(3);
    const fillerB = 'Outro trecho de preenchimento final, também sem relação alguma com a busca em questão aqui. '.repeat(3);
    const relevant = 'A escola dominical especial para adolescentes será realizada no salão anexo às 15h30.';
    await seedDoc(db, church.id, 'Avisos', `## Aviso\n\n${fillerA}${relevant}${fillerB}`);
    const { sources } = await searchKnowledgeBase(db, embedder, church.id, 'escola dominical adolescentes salão anexo', { minScore: 0 });
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].excerpt.startsWith('…')).toBe(true);
    expect(sources[0].excerpt.endsWith('…')).toBe(true);
    expect(sources[0].excerpt).toContain('escola dominical');
    expect(sources[0].excerpt.length).toBeLessThanOrEqual(400);
  });

  it('returns a short chunk verbatim without any ellipsis', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const markdown = '## Contato\n\nA secretaria atende de segunda a sexta, das 9h às 17h.';
    await seedDoc(db, church.id, 'Contato', markdown);
    const { sources } = await searchKnowledgeBase(db, embedder, church.id, 'secretaria atende segunda sexta');
    expect(sources).toHaveLength(1);
    expect(sources[0].excerpt).toBe(markdown);
    expect(sources[0].excerpt).not.toContain('…');
  });

  it('never returns an excerpt longer than 400 characters, across chunk lengths', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    await seedDoc(db, church.id, 'Curto', '## Oração\n\nEncontro de oração às 7h.');
    const mediumFiller = 'Texto de preenchimento médio sem relação direta com a busca realizada aqui. '.repeat(5);
    await seedDoc(db, church.id, 'Médio', `## Oração\n\n${mediumFiller}O grupo de oração se reúne às 19h.`);
    const longFiller = 'Texto de preenchimento mais longo, repetido várias vezes para estender o trecho de teste. '.repeat(10);
    await seedDoc(db, church.id, 'Longo', `## Oração\n\n${longFiller}A vigília de oração acontece à meia-noite.`);
    const { sources } = await searchKnowledgeBase(db, embedder, church.id, 'oração', { k: 5, minScore: 0 });
    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const source of sources) {
      expect(source.excerpt.length).toBeLessThanOrEqual(400);
    }
  });
});
