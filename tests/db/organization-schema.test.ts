import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { organizationProfiles, organizations } from '@/db/schema';
import { createTestDb } from '../helpers/db';

describe('organization tenancy migration', () => {
  it('renames an existing church row without changing its id and seeds its profile', async () => {
    const client = new PGlite({ extensions: { vector } });
    const migrationDir = path.join(process.cwd(), 'drizzle');
    for (const name of [
      '0000_true_bug.sql',
      '0001_colossal_valeria_richards.sql',
      '0002_famous_speedball.sql',
      '0003_drop_document_source_text.sql',
      '0004_brief_landau.sql',
    ]) {
      await client.exec(readFileSync(path.join(migrationDir, name), 'utf8'));
    }

    const legacyId = '11111111-1111-1111-1111-111111111111';
    await client.query(
      'INSERT INTO churches (id, slug, name) VALUES ($1, $2, $3)',
      [legacyId, 'demo', 'Igreja da Colina'],
    );
    await client.exec(readFileSync(path.join(migrationDir, '0005_rename_churches_to_organizations.sql'), 'utf8'));

    const db = drizzle(client);
    const [organization] = await db.select().from(organizations);
    const [profile] = await db.select().from(organizationProfiles);

    expect(organization).toMatchObject({ id: legacyId, slug: 'demo' });
    expect(profile).toMatchObject({ organizationId: legacyId, industry: 'church' });
  });

  it('preserves a migrated organization and gives it a default secretary profile', async () => {
    const db = await createTestDb();

    const [organization] = await db
      .insert(organizations)
      .values({ slug: 'demo', name: 'Igreja da Colina' })
      .returning();

    const [profile] = await db
      .insert(organizationProfiles)
      .values({
        organizationId: organization.id,
        industry: 'church',
        defaultLocale: 'pt',
        assistantName: 'Secretária',
        replyTone: 'warm',
        greeting: 'Olá! Como posso ajudar?',
        escalationCopy: 'Vou encaminhar sua mensagem para a equipe responsável.',
        enabledCapabilities: ['knowledge', 'calendar', 'confidential_request', 'escalation'],
      })
      .returning();

    expect(profile.organizationId).toBe(organization.id);
  });

  it('has no active church_id columns after the migration', async () => {
    const db = await createTestDb();
    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'church_id'
    `);

    expect((result as { rows: { column_name: string }[] }).rows).toEqual([]);
  });
});
