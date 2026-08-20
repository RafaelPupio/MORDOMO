import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '@/ai/embedder';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are unit-normalized
}

describe('HashEmbedder', () => {
  it('is deterministic and unit-normalized at 1536 dims', async () => {
    const e = new HashEmbedder();
    const { embeddings } = await e.embed(['culto de domingo', 'culto de domingo']);
    expect(embeddings[0]).toHaveLength(1536);
    expect(embeddings[0]).toEqual(embeddings[1]);
    const norm = Math.sqrt(embeddings[0].reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1);
  });

  it('scores overlapping texts above unrelated ones', async () => {
    const e = new HashEmbedder();
    const { embeddings } = await e.embed([
      'horário do culto de domingo',
      'culto de domingo às 10h',
      'receita de bolo de cenoura',
    ]);
    expect(cosine(embeddings[0], embeddings[1])).toBeGreaterThan(cosine(embeddings[0], embeddings[2]));
  });
});
