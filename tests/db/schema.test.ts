import { describe, expect, it } from 'vitest';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { chunks, organizations, secretaryProfileVersions } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

describe('schema + migrations', () => {
  it('applies migrations to PGlite and round-trips a church', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db, 'Igreja Alpha');
    const rows = await db.select().from(organizations);
    expect(rows.map((r) => r.id)).toContain(church.id);
  });

  it('stores and reads a 1536-dim vector', async () => {
    const db = await createTestDb();
    const church = await seedOrganization(db);
    const { documents } = await import('@/db/schema');
    const [doc] = await db
      .insert(documents)
      .values({ organizationId: church.id, title: 'Doc', kind: 'faq' })
      .returning();
    const embedding = Array.from({ length: 1536 }, () => 0.1);
    await db.insert(chunks).values({ organizationId: church.id, documentId: doc.id, seq: 0, content: 'hello', embedding });
    const stored = await db.select().from(chunks);
    expect(stored[0].embedding).toHaveLength(1536);
  });

  it('declares the partial unique published-profile index in Drizzle metadata', () => {
    const index = getTableConfig(secretaryProfileVersions).indexes.find(
      (candidate) => candidate.config.name === 'secretary_profile_versions_one_published_organization',
    );

    expect(index?.config.unique).toBe(true);
    expect(index?.config.where).toBeDefined();
    expect(new PgDialect().sqlToQuery(index!.config.where!)).toMatchObject({
      sql: '"secretary_profile_versions"."status" = \'published\'',
      params: [],
    });
  });
});
