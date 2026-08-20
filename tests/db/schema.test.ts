import { describe, expect, it } from 'vitest';
import { chunks, churches } from '@/db/schema';
import { createTestDb, seedChurch } from '../helpers/db';

describe('schema + migrations', () => {
  it('applies migrations to PGlite and round-trips a church', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db, 'Igreja Alpha');
    const rows = await db.select().from(churches);
    expect(rows.map((r) => r.id)).toContain(church.id);
  });

  it('stores and reads a 1536-dim vector', async () => {
    const db = await createTestDb();
    const church = await seedChurch(db);
    const { documents } = await import('@/db/schema');
    const [doc] = await db
      .insert(documents)
      .values({ churchId: church.id, title: 'Doc', kind: 'faq' })
      .returning();
    const embedding = Array.from({ length: 1536 }, () => 0.1);
    await db.insert(chunks).values({ churchId: church.id, documentId: doc.id, seq: 0, content: 'hello', embedding });
    const stored = await db.select().from(chunks);
    expect(stored[0].embedding).toHaveLength(1536);
  });
});
