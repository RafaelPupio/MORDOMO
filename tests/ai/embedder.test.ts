import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { HashEmbedder } from '@/ai/embedder';
import { recordUsage } from '@/ai/usage';
import { usageLedger } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

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

  it('normalizes decomposed and precomposed accented Portuguese to identical embeddings', async () => {
    const e = new HashEmbedder();
    const nfc = 'café'; // precomposed é
    const nfd = 'café'.normalize('NFD'); // decomposed e + combining acute
    const { embeddings } = await e.embed([nfc, nfd]);
    expect(cosine(embeddings[0], embeddings[1])).toBeCloseTo(1);
  });
});

describe('recordUsage with HashEmbedder', () => {
  it('does not throw and records zero cost with the test embedder', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const embedder = new HashEmbedder();

    await recordUsage(db, {
      organizationId: church.id,
      feature: 'embed',
      model: embedder.model,
      inputTokens: 100,
      outputTokens: 0,
    });

    const [row] = await db.select({ costUsd: usageLedger.costUsd }).from(usageLedger).where(eq(usageLedger.organizationId, church.id));
    expect(row.costUsd).toBe(0);
  });
});
