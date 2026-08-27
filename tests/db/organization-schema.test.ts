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
    const documentId = '22222222-2222-2222-2222-222222222222';
    const chunkId = '33333333-3333-3333-3333-333333333333';
    const eventId = '44444444-4444-4444-4444-444444444444';
    const conversationId = '55555555-5555-5555-5555-555555555555';
    const messageId = '66666666-6666-6666-6666-666666666666';
    const prayerId = '77777777-7777-7777-7777-777777777777';
    const ticketId = '88888888-8888-8888-8888-888888888888';
    const usageId = '99999999-9999-9999-9999-999999999999';
    const reportId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await client.query(
      'INSERT INTO churches (id, slug, name) VALUES ($1, $2, $3)',
      [legacyId, 'demo', 'Igreja da Colina'],
    );
    await client.query(
      'INSERT INTO budgets (church_id, monthly_usd) VALUES ($1, $2)',
      [legacyId, 40],
    );
    await client.query(
      'INSERT INTO documents (id, church_id, title, kind) VALUES ($1, $2, $3, $4)',
      [documentId, legacyId, 'Horários', 'schedule'],
    );
    await client.query(
      'INSERT INTO chunks (id, church_id, document_id, seq, content, embedding) VALUES ($1, $2, $3, $4, $5, $6::vector)',
      [chunkId, legacyId, documentId, 0, 'Domingo às 10h', `[${Array.from({ length: 1536 }, () => 0.1).join(',')}]`],
    );
    await client.query(
      'INSERT INTO events (id, church_id, title, starts_at) VALUES ($1, $2, $3, $4)',
      [eventId, legacyId, 'Culto', '2026-09-06T10:00:00Z'],
    );
    await client.query(
      'INSERT INTO conversations (id, church_id, visitor_key) VALUES ($1, $2, $3)',
      [conversationId, legacyId, 'visitor-1'],
    );
    await client.query(
      'INSERT INTO messages (id, church_id, conversation_id, role, parts) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [messageId, legacyId, conversationId, 'user', JSON.stringify([{ type: 'text', text: 'Olá' }])],
    );
    await client.query(
      'INSERT INTO prayer_requests (id, church_id, conversation_id, request) VALUES ($1, $2, $3, $4)',
      [prayerId, legacyId, conversationId, 'Pela minha família'],
    );
    await client.query(
      'INSERT INTO tickets (id, church_id, conversation_id, topic) VALUES ($1, $2, $3, $4)',
      [ticketId, legacyId, conversationId, 'Preciso de ajuda'],
    );
    await client.query(
      'INSERT INTO usage_ledger (id, church_id, feature, model, input_tokens, output_tokens, cost_usd) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [usageId, legacyId, 'chat.reply', 'test-model', 10, 2, 0.001],
    );
    await client.query(
      'INSERT INTO reports (id, church_id, period_start, period_end, findings, body) VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
      [reportId, legacyId, '2026-09-01T00:00:00Z', '2026-09-07T00:00:00Z', JSON.stringify({}), 'Resumo'],
    );
    await client.exec(readFileSync(path.join(migrationDir, '0005_rename_churches_to_organizations.sql'), 'utf8'));

    const db = drizzle(client);
    const [organization] = await db.select().from(organizations);
    const [profile] = await db.select().from(organizationProfiles);

    expect(organization).toMatchObject({ id: legacyId, slug: 'demo' });
    expect(profile).toMatchObject({ organizationId: legacyId, industry: 'church' });
    for (const [table, id] of [
      ['chunks', chunkId],
      ['conversations', conversationId],
      ['documents', documentId],
      ['events', eventId],
      ['messages', messageId],
      ['prayer_requests', prayerId],
      ['reports', reportId],
      ['tickets', ticketId],
      ['usage_ledger', usageId],
    ]) {
      const result = await client.query(`SELECT organization_id FROM ${table} WHERE id = $1`, [id]);
      expect(result.rows).toEqual([{ organization_id: legacyId }]);
    }
    const budget = await client.query('SELECT organization_id FROM budgets WHERE organization_id = $1', [legacyId]);
    expect(budget.rows).toEqual([{ organization_id: legacyId }]);
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

  it('renames foreign-key constraints with the organization domain', async () => {
    const db = await createTestDb();
    const result = await db.execute(sql`
      SELECT conname
      FROM pg_constraint
      WHERE conname LIKE '%church%'
    `);

    expect((result as { rows: { conname: string }[] }).rows).toEqual([]);
  });
});
