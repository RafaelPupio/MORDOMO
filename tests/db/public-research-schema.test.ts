import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  dataControlEvents,
  researchBriefs,
  researchFacts,
  researchSources,
} from '@/db/schema';
import type { Db } from '@/db/client';
import { createTestDb, seedOrganization } from '../helpers/db';

function activeBrief(organizationId: string) {
  return {
    organizationId,
    requestedByClerkUserId: 'user_test',
    segment: 'church',
    locale: 'en',
    requestedUrl: 'https://example.org/',
    consentVersion: 'public-research-v2',
    consentedAt: new Date('2026-09-01T12:00:00Z'),
  };
}

async function seededResearch() {
  const db = await createTestDb();
  const organization = await seedOrganization(db);
  const [brief] = await db.insert(researchBriefs).values(activeBrief(organization.id)).returning();
  const [source] = await db.insert(researchSources).values({
    organizationId: organization.id,
    briefId: brief.id,
    url: 'https://example.org/',
    title: 'Example Organization',
    excerpt: 'Open Monday.',
    retrievedAt: new Date('2026-09-01T12:01:00Z'),
  }).returning();
  return { db, organization, brief, source };
}

async function tableColumns(db: Db, tableName: string): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
    ORDER BY ordinal_position
  `);
  return (result as { rows: Array<{ column_name: string }> }).rows.map((row) => row.column_name);
}

describe('public research schema', () => {
  it('carries organization_id on every research and audit table', async () => {
    const db = await createTestDb();

    for (const table of ['research_briefs', 'research_sources', 'research_facts', 'data_control_events']) {
      expect(await tableColumns(db, table), table).toContain('organization_id');
    }
  });

  it('allows only one active research brief per Organization', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);

    await db.insert(researchBriefs).values(activeBrief(organization.id));
    await expect(db.insert(researchBriefs).values(activeBrief(organization.id))).rejects.toThrow();
  });

  it('defaults a new brief to retrieving with zero proposal attempts', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);

    const [brief] = await db.insert(researchBriefs).values(activeBrief(organization.id)).returning();

    expect(brief).toMatchObject({ status: 'retrieving', proposalAttempts: 0, errorCode: null });
  });

  it('stores at most one source per Organization brief', async () => {
    const { db, organization, brief, source } = await seededResearch();

    await expect(db.insert(researchSources).values({
      organizationId: organization.id,
      briefId: brief.id,
      url: source.url,
      title: source.title,
      excerpt: source.excerpt,
      retrievedAt: source.retrievedAt,
    })).rejects.toThrow();
  });

  it('defaults facts to proposed and enforces reviewer metadata as one shape', async () => {
    const { db, organization, brief, source } = await seededResearch();
    const baseFact = {
      organizationId: organization.id,
      briefId: brief.id,
      sourceId: source.id,
      proposedText: 'Open Monday.',
      supportingQuote: 'Open Monday.',
    };

    const [fact] = await db.insert(researchFacts).values(baseFact).returning();
    expect(fact).toMatchObject({
      reviewStatus: 'proposed',
      acceptedText: null,
      reviewedByClerkUserId: null,
      reviewedAt: null,
    });

    await expect(db.insert(researchFacts).values({
      ...baseFact,
      reviewStatus: 'accepted',
    })).rejects.toThrow();
    await expect(db.insert(researchFacts).values({
      ...baseFact,
      reviewStatus: 'rejected',
      acceptedText: 'Rejected text must stay empty.',
      reviewedByClerkUserId: 'user_test',
      reviewedAt: new Date('2026-09-01T12:02:00Z'),
    })).rejects.toThrow();
  });

  it('bounds persisted public content at the database boundary', async () => {
    const { db, organization, brief, source } = await seededResearch();

    await expect(db
      .update(researchSources)
      .set({ title: 'x'.repeat(201) })
      .where(eq(researchSources.id, source.id))).rejects.toThrow();
    await expect(db.insert(researchFacts).values({
      organizationId: organization.id,
      briefId: brief.id,
      sourceId: source.id,
      proposedText: 'x'.repeat(281),
      supportingQuote: 'Open Monday.',
    })).rejects.toThrow();
  });

  it('keeps data-control events metadata-only', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);

    await db.insert(dataControlEvents).values({
      organizationId: organization.id,
      actorClerkUserId: 'user_test',
      action: 'research.started',
      targetType: 'research_brief',
      targetId: crypto.randomUUID(),
      outcome: 'succeeded',
    });

    expect(await tableColumns(db, 'data_control_events')).toEqual([
      'id',
      'organization_id',
      'actor_clerk_user_id',
      'action',
      'target_type',
      'target_id',
      'outcome',
      'created_at',
    ]);
  });

  it('declares Organization-first indexes for tenant-scoped lookups', () => {
    for (const table of [researchBriefs, researchSources, researchFacts, dataControlEvents]) {
      const config = getTableConfig(table);
      const hasOrganizationFirstIndex = config.indexes.some((candidate) => (
        (candidate.config.columns[0] as { name?: string } | undefined)?.name === 'organization_id'
      ));
      expect(hasOrganizationFirstIndex, config.name).toBe(true);
    }
  });
});
