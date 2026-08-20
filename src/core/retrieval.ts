import { and, cosineDistance, desc, eq, sql } from 'drizzle-orm';
import type { Embedder } from '@/ai/embedder';
import type { Db } from '@/db/client';
import { chunks, documents } from '@/db/schema';

export type Source = { documentId: string; documentTitle: string; excerpt: string; score: number };
export type SearchResult = { sources: Source[]; embeddingTokens: number };

const EXCERPT_CHARS = 400;

// Tokenize like `hashVector` in `src/ai/embedder.ts`, so excerpt selection agrees
// with the embedding's notion of a "word": lowercase, NFC-normalized, letters/digits.
function tokenize(text: string): string[] {
  return text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// Pick the ≤EXCERPT_CHARS window of `content` most likely to contain the text that
// matched `query`, so a citation shows the relevant sentence instead of always the
// first 400 characters. Falls back to the start of the chunk when nothing matches.
export function selectExcerpt(content: string, query: string): string {
  if (content.length <= EXCERPT_CHARS) return content;

  const queryTokens = new Set(tokenize(query));
  let center = 0;

  if (queryTokens.size > 0) {
    // Find the match position (by character offset) that has the most other query
    // token matches within one window's width of it — i.e. the densest cluster.
    const matches: number[] = [];
    const re = /[\p{L}\p{N}]+/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const word = m[0].normalize('NFC').toLowerCase();
      if (queryTokens.has(word)) matches.push(m.index);
    }

    if (matches.length > 0) {
      let bestIndex = matches[0];
      let bestScore = -1;
      for (const pos of matches) {
        const score = matches.filter((other) => Math.abs(other - pos) <= EXCERPT_CHARS / 2).length;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = pos;
        }
      }
      center = bestIndex;
    }
  }

  let start = Math.max(0, center - Math.floor(EXCERPT_CHARS / 2));
  let end = Math.min(content.length, start + EXCERPT_CHARS);
  start = Math.max(0, end - EXCERPT_CHARS);

  // Prefer not to cut mid-word: nudge start/end out to the nearest whitespace.
  if (start > 0) {
    const nextSpace = content.indexOf(' ', start);
    const prevSpace = content.lastIndexOf(' ', start);
    if (nextSpace !== -1 && nextSpace - start < 20) start = nextSpace + 1;
    else if (prevSpace !== -1 && start - prevSpace < 20) start = prevSpace + 1;
  }
  if (end < content.length) {
    const nextSpace = content.indexOf(' ', end);
    const prevSpace = content.lastIndexOf(' ', end);
    if (prevSpace !== -1 && prevSpace >= start && end - prevSpace < 20) end = prevSpace;
    else if (nextSpace !== -1 && nextSpace - end < 20) end = nextSpace;
  }

  const prefixEllipsis = start > 0;
  const suffixEllipsis = end < content.length;

  // The ellipsis characters count toward the budget, so trim the window to make room.
  const budget = EXCERPT_CHARS - (prefixEllipsis ? 1 : 0) - (suffixEllipsis ? 1 : 0);
  if (end - start > budget) end = start + budget;

  const windowText = content.slice(start, end);
  return `${prefixEllipsis ? '…' : ''}${windowText}${suffixEllipsis ? '…' : ''}`;
}

// Deliberately does NOT filter on `documents.ingest_status` (e.g. to `published` only).
// `runIngest` (src/core/ingest.ts) writes a document's chunks as soon as they're computed
// — at the `extracting` transition — well before the agent stages that decide `published`
// even run, on purpose: a document's retrievability must not depend on whether its
// extractor/verifier stages later succeed. Filtering here would ALSO hide a previously
// published document's still-good chunks the moment a later re-ingest attempt fails and
// parks it at `failed` — exactly the chunks C1's delete-ordering fix (see the comment on
// the chunks delete in `runIngest`) exists to keep serving. A `parsing`/`extracting`/
// `verifying` document briefly has no chunks yet (nothing to filter), and a `failed`
// document's chunks are either its still-valid previous version or none at all — there is
// no state where filtering on this column would hide something bad without also hiding
// something good.
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
    .where(and(eq(chunks.churchId, churchId), eq(documents.churchId, churchId)))
    .orderBy(desc(similarity))
    .limit(k);

  return {
    sources: rows
      .filter((r) => Number(r.score) >= minScore)
      .map((r) => ({ ...r, score: Number(r.score), excerpt: selectExcerpt(r.excerpt, query) })),
    embeddingTokens: tokens,
  };
}
