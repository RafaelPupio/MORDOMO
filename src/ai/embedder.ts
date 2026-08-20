import { embedMany } from 'ai';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, TEST_EMBEDDING_MODEL } from './pricing';

export type EmbedResult = { embeddings: number[][]; tokens: number };

export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<EmbedResult>;
}

// Production embedder: Vercel AI Gateway resolves the plain model string.
export class GatewayEmbedder implements Embedder {
  readonly model = EMBEDDING_MODEL;

  async embed(texts: string[]): Promise<EmbedResult> {
    const { embeddings, usage } = await embedMany({ model: EMBEDDING_MODEL, values: texts });
    return { embeddings, tokens: usage?.tokens ?? 0 };
  }
}

// Deterministic bag-of-words embedding for tests and offline seeding: word overlap
// produces cosine similarity, so retrieval behaves realistically without an API.
export class HashEmbedder implements Embedder {
  readonly model = TEST_EMBEDDING_MODEL;

  async embed(texts: string[]): Promise<EmbedResult> {
    return { embeddings: texts.map(hashVector), tokens: 0 };
  }
}

function hashVector(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % EMBEDDING_DIMENSIONS] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
