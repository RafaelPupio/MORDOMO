import { cosineDistance, desc, eq, sql } from 'drizzle-orm';
import type { Embedder } from '@/ai/embedder';
import type { Db } from '@/db/client';
import { chunks, documents } from '@/db/schema';

export type Source = { documentId: string; documentTitle: string; excerpt: string; score: number };
export type SearchResult = { sources: Source[]; embeddingTokens: number };

export async function searchKnowledgeBase(
  db: Db,
  embedder: Embedder,
  churchId: string,
  query: string,
  opts: { k?: number; minScore?: number } = {},
): Promise<SearchResult> {
  const { k = 5, minScore = 0.15 } = opts;
  const { embeddings, tokens } = await embedder.embed([query]);
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, embeddings[0])})`;

  const rows = await db
    .select({
      documentId: chunks.documentId,
      documentTitle: documents.title,
      excerpt: chunks.content,
      score: similarity,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(eq(chunks.churchId, churchId))
    .orderBy(desc(similarity))
    .limit(k);

  return {
    sources: rows
      .filter((r) => Number(r.score) >= minScore)
      .map((r) => ({ ...r, score: Number(r.score), excerpt: r.excerpt.slice(0, 400) })),
    embeddingTokens: tokens,
  };
}
